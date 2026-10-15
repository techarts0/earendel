import { globalCapabilityManager, CapabilityType } from '../kernel/capability';
import { globalTaskScheduler } from '../kernel/taskScheduler';
import { resolveProcessPath as normalizeProcessPath } from '../kernel/processPath';
import { VFSNode, VirtualFileSystem } from './vfs';

const MAX_VIEW_SNAPSHOT_NODES = 10_000;
const MAX_VIEW_SNAPSHOT_WORK = 20_000;
const MAX_VIEW_SNAPSHOT_CONTENT_BYTES = 32 * 1024 * 1024;
const capabilityViewBases = new WeakMap<VirtualFileSystem, VirtualFileSystem>();

/** Count UTF-8 bytes without allocating an encoded copy of potentially huge content. */
function boundedUtf8ByteLength(value: string, limit: number): number | null {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes++;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else bytes += 3;
    } else bytes += 3;
    if (bytes > limit) return null;
  }
  return bytes;
}

/**
 * Read/write view for one simulated process. Returned nodes are detached snapshots,
 * so callers cannot mutate the backing VFS through `root`, `children`, or `content`.
 */
export function createCapabilityVfsView(
  vfs: VirtualFileSystem,
  pid: number,
  user: string,
  options: { allowChangeDirectory?: boolean; liveCwd?: boolean; abortSignal?: AbortSignal } = {},
): VirtualFileSystem {
  // Re-scoping an already scoped view (for forked commands or Skills) must apply
  // the new PID's policy once, not stack proxy layers that repeat whole-tree
  // permission checks for every filesystem operation.
  vfs = capabilityViewBases.get(vfs) || vfs;
  let processCwd = globalTaskScheduler.getProcess(pid)?.cwd || vfs.getPwd();
  const getProcessCwd = () => options.liveCwd
    ? globalTaskScheduler.getProcess(pid)?.cwd || processCwd
    : processCwd;
  const resolveForProcess = (path: string) => normalizeProcessPath(
    path,
    getProcessCwd(),
    vfs.getHomeDir(user),
  ) ?? '\0invalid-path';
  const resolveCapabilityPath = (path: string, followFinal = true) => {
    const resolved = resolveForProcess(path);
    return vfs.resolveSymlinkPath(resolved, followFinal, user) ?? '\0invalid-path';
  };
  const can = (capability: CapabilityType, path: string, followFinal = true) => {
    if (options.abortSignal?.aborted) return false;
    const canonicalPath = resolveCapabilityPath(path, followFinal);
    if (canonicalPath === '\0invalid-path' || !globalCapabilityManager.hasCapability(pid, capability, canonicalPath)) return false;
    // /dev/ai also contains the last inference response in the VFS mirror.
    // Keep that shared buffer behind the device capability, not just /dev's
    // ordinary filesystem read grant.
    if (capability === 'CAP_VFS_READ' && canonicalPath === '/dev/ai' &&
        !globalCapabilityManager.hasCapability(pid, 'CAP_DEVICE_IO', '/dev/ai')) return false;
    return true;
  };
  const canTraverse = (path: string) => {
    const traversedPath = vfs.resolveSymlinkPath(resolveForProcess(path), false, user);
    if (!traversedPath) return false;
    const parts = traversedPath.split('/').filter(Boolean);
    let directoryPath = '/';
    for (const part of parts.slice(0, -1)) {
      const canonicalDirectory = vfs.resolveSymlinkPath(directoryPath, true, user);
      const directory = canonicalDirectory ? vfs.getNodeByPath(canonicalDirectory, user) : null;
      if (!directory || directory.type !== 'directory' || !vfs.checkPermission(directory, 'x', user)) return false;
      directoryPath = canonicalDirectory === '/' ? `/${part}` : `${canonicalDirectory}/${part}`;
    }
    const canonicalParent = vfs.resolveSymlinkPath(directoryPath, true, user);
    const parent = canonicalParent ? vfs.getNodeByPath(canonicalParent, user) : null;
    return !!parent && parent.type === 'directory' && vfs.checkPermission(parent, 'x', user);
  };
  const canCreateInParent = (path: string, recursive = false) => {
    const resolved = vfs.resolveSymlinkPath(resolveForProcess(path), false, user);
    if (!resolved) return false;
    const parentParts = resolved.split('/').filter(Boolean).slice(0, -1);
    let directoryPath = '/';
    for (const part of parentParts) {
      const canonicalDirectory = vfs.resolveSymlinkPath(directoryPath, true, user);
      const directory = canonicalDirectory ? vfs.getNodeByPath(canonicalDirectory, user) : null;
      if (!directory || directory.type !== 'directory' || !vfs.checkPermission(directory, 'x', user)) return false;
      const nextPath = canonicalDirectory === '/' ? `/${part}` : `${canonicalDirectory}/${part}`;
      const nextCanonical = vfs.resolveSymlinkPath(nextPath, true, user);
      const next = nextCanonical ? vfs.getNodeByPath(nextCanonical, user) : null;
      if (!next) {
        return recursive && can('CAP_VFS_WRITE', canonicalDirectory || directoryPath) &&
          vfs.checkPermission(directory, 'w', user) && vfs.checkPermission(directory, 'x', user);
      }
      if (next.type !== 'directory') return false;
      directoryPath = nextCanonical || nextPath;
    }
    const canonicalParent = vfs.resolveSymlinkPath(directoryPath, true, user);
    const parent = canonicalParent ? vfs.getNodeByPath(canonicalParent, user) : null;
    return !!parent && parent.type === 'directory' && canTraverse(directoryPath) &&
      can('CAP_VFS_WRITE', canonicalParent || directoryPath) &&
      vfs.checkPermission(parent, 'w', user) && vfs.checkPermission(parent, 'x', user);
  };
  const canRemoveTree = (path: string, recursive: boolean): boolean => {
    const resolved = resolveForProcess(path);
    const node = vfs.getNodeByPath(resolved, user);
    if (!node || !can('CAP_VFS_WRITE', resolved, false) || !canTraverse(resolved)) return false;
    const parentPath = resolved.slice(0, resolved.lastIndexOf('/')) || '/';
    const canonicalParentPath = vfs.resolveSymlinkPath(parentPath, true, user);
    const parent = canonicalParentPath ? vfs.getNodeByPath(canonicalParentPath, user) : null;
    if (!parent || !vfs.checkPermission(parent, 'w', user) || !vfs.checkPermission(parent, 'x', user)) return false;
    if (node.type !== 'directory' || !node.children?.size) return true;
    if (!recursive || !vfs.checkPermission(node, 'r', user) || !vfs.checkPermission(node, 'x', user)) return false;
    for (const [name, child] of node.children) {
      const childPath = resolved === '/' ? `/${name}` : `${resolved}/${name}`;
      if (!canRemoveTree(childPath, true)) return false;
    }
    return true;
  };
  const canMutatePath = (path: string, includeParent = false, recursive = false, followFinal = true) => {
    let current = resolveCapabilityPath(path, followFinal);
    if (current === '\0invalid-path') return false;
    if (!can('CAP_VFS_WRITE', current, followFinal)) return false;
    if (!includeParent && !recursive) return true;
    if (!includeParent && !vfs.exists(current, user)) includeParent = true;
    if (!includeParent) return true;
    while (current !== '/') {
      const parent = current.slice(0, current.lastIndexOf('/')) || '/';
      if (!can('CAP_VFS_WRITE', parent)) return false;
      if (vfs.exists(parent, user)) break;
      current = parent;
    }
    return true;
  };

  const snapshotNode = (node: VFSNode | null, path: string): VFSNode | null => {
    if (!node || !can('CAP_VFS_READ', path) || !canTraverse(path) || !vfs.checkPermission(node, 'r', user)) return null;
    let copiedNodes = 0;
    let examinedNodes = 0;
    let copiedContentBytes = 0;
    const cloneEntry = (source: VFSNode): VFSNode => {
      copiedNodes++;
      if (copiedNodes > MAX_VIEW_SNAPSHOT_NODES) throw new Error('E2BIG: VFS node snapshot exceeds the 10,000-node limit.');
      const readableFile = source.type === 'file' && vfs.checkPermission(source, 'r', user);
      let content = readableFile ? source.content : undefined;
      if (content !== undefined) {
        const encodedLength = boundedUtf8ByteLength(content, MAX_VIEW_SNAPSHOT_CONTENT_BYTES - copiedContentBytes);
        if (encodedLength === null) throw new Error('E2BIG: VFS node snapshot exceeds the 32 MiB content limit.');
        copiedContentBytes += encodedLength;
      }
      return {
        ...source,
        updatedAt: new Date(source.updatedAt.getTime()),
        content,
        parent: null,
        children: source.type === 'directory' ? new Map() : undefined,
      };
    };
    const copy = cloneEntry(node);
    const pending: Array<{ source: VFSNode; clone: VFSNode; path: string }> = [{ source: node, clone: copy, path }];
    const seen = new WeakSet<VFSNode>([node]);
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (!current.source.children || !current.clone.children ||
          !vfs.checkPermission(current.source, 'x', user)) continue;
      for (const [name, child] of current.source.children) {
        examinedNodes++;
        if (examinedNodes > MAX_VIEW_SNAPSHOT_WORK) throw new Error('E2BIG: VFS directory snapshot exceeded its traversal budget.');
        const childPath = current.path === '/' ? `/${name}` : `${current.path}/${name}`;
        if (seen.has(child) || !can('CAP_VFS_READ', childPath) || !canTraverse(childPath)) continue;
        seen.add(child);
        const childCopy = cloneEntry(child);
        current.clone.children.set(name, childCopy);
        // Only directory execute permission is needed to enumerate descendants.
        if (child.type === 'directory' && vfs.checkPermission(child, 'x', user)) {
          pending.push({ source: child, clone: childCopy, path: childPath });
        }
      }
    }
    return copy;
  };

  const emptyDirectory = (id: string, name: string): VFSNode => ({
    id, name, type: 'directory', permissions: '---------', owner: '', group: '',
    size: 0, updatedAt: new Date(0), children: new Map(), parent: null,
  });

  const guarded = new Proxy(vfs, {
    get(target, property) {
      if (property === 'root') return snapshotNode(target.root, '/') || emptyDirectory('denied-root', '');
      if (property === 'currentDirectory') {
        const cwd = getProcessCwd();
        const node = target.getNodeByPath(cwd, user);
        return snapshotNode(node, cwd) || emptyDirectory('denied-cwd', cwd.split('/').pop() || '/');
      }
      if (property === 'db' || property === 'listeners' || property === 'saveNodeToIndexedDB' || property === 'deleteNodeFromIndexedDB') return undefined;
      if (property === 'subscribe') return () => () => undefined;
      if (property === 'getPwd') return () => getProcessCwd();
      if (property === 'getHomeDir') return () => target.getHomeDir(user);
      if (property === 'resolvePath') return (path: string) => resolveForProcess(path);
      if (property === 'getNodeByPath') {
        return (path: string, _ignoredUser?: string) => {
          const resolved = resolveForProcess(path);
          return snapshotNode(target.getNodeByPath(resolved, user), resolved);
        };
      }
      if (property === 'exists') {
        return (path: string, _ignoredUser?: string) => {
          const resolved = resolveForProcess(path);
          const node = can('CAP_VFS_READ', resolved) ? target.getResolvedNodeByPath(resolved, user) : null;
          return !!node && canTraverse(resolved) && target.checkPermission(node, 'r', user);
        };
      }
      if (property === 'readFile') {
        return (path: string, _ignoredUser?: string) => {
          const resolved = resolveForProcess(path);
          const canonical = resolveCapabilityPath(resolved);
          return canonical !== '\0invalid-path' && can('CAP_VFS_READ', resolved) && canTraverse(resolved)
            ? target.readFile(canonical, user)
            : null;
        };
      }
      if (property === 'writeFile') {
        return (path: string, content: string, _ignoredUser?: string) => {
          const resolved = resolveForProcess(path);
          const canonical = resolveCapabilityPath(resolved);
          if (canonical === '\0invalid-path') return false;
          // Device writes dispatch to AI, network, and hardware services.
          if (canonical.startsWith('/dev/') && canonical !== '/dev/null') return false;
          if (!can('CAP_VFS_WRITE', canonical) || !canTraverse(canonical)) return false;
          const creating = !target.exists(canonical, user);
          if (creating && !canCreateInParent(canonical)) return false;
          if (!canMutatePath(canonical, creating)) return false;
          return target.writeFileWithAuthorization(canonical, content, user, () =>
            can('CAP_VFS_WRITE', canonical) && canTraverse(canonical) &&
            (!creating || canCreateInParent(canonical)) && canMutatePath(canonical, creating));
        };
      }
      if (property === 'touch') {
        return (path: string, _ignoredUser?: string, timestamp = new Date(), noCreate = false) => {
          const resolved = resolveForProcess(path);
          const canonical = resolveCapabilityPath(resolved);
          if (canonical === '\0invalid-path' || !can('CAP_VFS_WRITE', canonical) || !canTraverse(canonical)) return false;
          const existing = target.getResolvedNodeByPath(canonical, user);
          if (!existing && !noCreate &&
              (!canMutatePath(canonical, true) || !canCreateInParent(canonical))) return false;
          return target.touch(canonical, user, timestamp, noCreate);
        };
      }
      if (property === 'isExecutable') {
        return (path: string) => {
          const resolved = resolveForProcess(path);
          const canonical = resolveCapabilityPath(resolved);
          if (canonical === '\0invalid-path' || !can('CAP_VFS_READ', canonical) || !canTraverse(canonical)) return false;
          const node = target.getResolvedNodeByPath(canonical, user);
          if (!node || node.type !== 'file' || !node.permissions.includes('x')) return false;
          // Linux root may execute a file when any execute bit is set, but
          // ordinary users must match their owner/group/other execute class.
          return user === 'root' || target.checkPermission(node, 'x', user);
        };
      }
      if (property === 'mkdir') {
        return (path: string, recursive = false) => {
          const resolved = resolveForProcess(path);
          const canonical = resolveCapabilityPath(resolved, false);
          if (canonical === '\0invalid-path' || !canMutatePath(canonical, true, recursive, false) || (!recursive && !canTraverse(canonical))) return false;
          const exists = target.getNodeByPath(canonical, user);
          return exists?.type === 'directory' || (canCreateInParent(canonical, recursive) && target.mkdir(canonical, recursive));
        };
      }
      if (property === 'remove') {
        return (path: string, recursive = false, _ignoredUser?: string) => {
          const resolved = resolveForProcess(path);
          const parentPath = resolved.slice(0, resolved.lastIndexOf('/')) || '/';
          return canMutatePath(resolved, true, recursive, false) && canTraverse(parentPath) && canRemoveTree(resolved, recursive) &&
            target.remove(resolved, recursive, user);
        };
      }
      if (property === 'removeAsync') {
        return async (path: string, recursive = false, _ignoredUser?: string) => {
          const resolved = resolveForProcess(path);
          const parentPath = resolved.slice(0, resolved.lastIndexOf('/')) || '/';
          if (!canMutatePath(resolved, true, recursive, false) || !canTraverse(parentPath) || !canRemoveTree(resolved, recursive)) return false;
          return target.removeAsync(resolved, recursive, user, () =>
            !options.abortSignal?.aborted &&
            canMutatePath(resolved, true, recursive, false) &&
            canTraverse(parentPath) && canRemoveTree(resolved, recursive));
        };
      }
      if (property === 'chmod') {
        return (path: string, mode: string, recursive = false) => {
          const resolved = resolveForProcess(path);
          const canonical = resolveCapabilityPath(resolved);
          return canonical !== '\0invalid-path' && can('CAP_VFS_WRITE', canonical) && canTraverse(canonical) && target.chmod(canonical, mode, recursive, user);
        };
      }
      if (property === 'chown') {
        return (path: string, ownerGroup: string, recursive = false) => {
          const resolved = resolveForProcess(path);
          const canonical = resolveCapabilityPath(resolved);
          return canonical !== '\0invalid-path' && can('CAP_VFS_WRITE', canonical) &&
            canTraverse(canonical) && target.chown(canonical, ownerGroup, recursive, user);
        };
      }
      if (property === 'symlink') {
        return (targetPath: string, linkPath: string) => {
          const resolvedLink = resolveForProcess(linkPath);
          return canMutatePath(resolvedLink, !target.exists(resolvedLink, user), false, false) &&
            canCreateInParent(resolvedLink) && target.symlink(targetPath, resolvedLink);
        };
      }
      // Interactive shell commands may change the session CWD, but only after
      // capability, traversal, and execute checks. Skill views remain read-only.
      if (property === 'changeDirectory') {
        return (path: string) => {
          if (!options.allowChangeDirectory) return false;
          const resolved = resolveForProcess(path);
          const canonical = resolveCapabilityPath(resolved);
          const node = canonical !== '\0invalid-path' ? target.getResolvedNodeByPath(canonical, user) : null;
          return !!node && node.type === 'directory' &&
            can('CAP_VFS_READ', canonical) && canTraverse(canonical) &&
            target.checkPermission(node, 'x', user) && (() => {
              // CWD belongs to the caller's PCB. Calling the backing VFS
              // changeDirectory() here would mutate one global directory and
              // make independent process views interfere with each other.
              processCwd = canonical;
              const pcb = globalTaskScheduler.getProcess(pid);
              if (pcb) pcb.cwd = canonical;
              return true;
            })();
        };
      }
      if (property === 'checkPermission') {
        return (node: VFSNode, bit: 'r' | 'w' | 'x') => target.checkPermission(node, bit, user);
      }
      // This view is an allowlist. Unknown methods and all unreviewed state are hidden.
      return undefined;
    },
    set(target, property, value) {
      void target;
      void property;
      void value;
      return false;
    },
    defineProperty: () => false,
    deleteProperty: () => false,
    setPrototypeOf: () => false,
    getPrototypeOf: () => null,
    ownKeys: () => [],
    getOwnPropertyDescriptor: () => undefined,
  });

  capabilityViewBases.set(guarded, vfs);
  return guarded;
}
