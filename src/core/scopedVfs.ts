import { globalCapabilityManager, CapabilityType } from '../kernel/capability';
import { VFSNode, VirtualFileSystem } from './vfs';

const capabilityViewBases = new WeakMap<VirtualFileSystem, VirtualFileSystem>();

/**
 * Read/write view for one simulated process. Returned nodes are detached snapshots,
 * so callers cannot mutate the backing VFS through `root`, `children`, or `content`.
 */
export function createCapabilityVfsView(
  vfs: VirtualFileSystem,
  pid: number,
  user: string,
  options: { allowChangeDirectory?: boolean; liveCwd?: boolean } = {},
): VirtualFileSystem {
  // Re-scoping an already scoped view (for forked commands or Skills) must apply
  // the new PID's policy once, not stack proxy layers that repeat whole-tree
  // permission checks for every filesystem operation.
  vfs = capabilityViewBases.get(vfs) || vfs;
  const processCwd = vfs.getPwd();
  const can = (capability: CapabilityType, path: string) =>
    globalCapabilityManager.hasCapability(pid, capability, vfs.resolvePath(path, user));
  const canTraverse = (path: string) => {
    const parts = vfs.resolvePath(path, user).split('/').filter(Boolean);
    let directoryPath = '/';
    for (const part of parts.slice(0, -1)) {
      const directory = vfs.getNodeByPath(directoryPath, user);
      if (!directory || directory.type !== 'directory' || !vfs.checkPermission(directory, 'x', user)) return false;
      directoryPath = directoryPath === '/' ? `/${part}` : `${directoryPath}/${part}`;
    }
    const parent = vfs.getNodeByPath(directoryPath, user);
    return !!parent && parent.type === 'directory' && vfs.checkPermission(parent, 'x', user);
  };
  const canCreateInParent = (path: string, recursive = false) => {
    const resolved = vfs.resolvePath(path, user);
    const parentParts = resolved.split('/').filter(Boolean).slice(0, -1);
    let directoryPath = '/';
    for (const part of parentParts) {
      const directory = vfs.getNodeByPath(directoryPath, user);
      if (!directory || directory.type !== 'directory' || !vfs.checkPermission(directory, 'x', user)) return false;
      const nextPath = directoryPath === '/' ? `/${part}` : `${directoryPath}/${part}`;
      const next = vfs.getNodeByPath(nextPath, user);
      if (!next) {
        return recursive && can('CAP_VFS_WRITE', directoryPath) &&
          vfs.checkPermission(directory, 'w', user) && vfs.checkPermission(directory, 'x', user);
      }
      if (next.type !== 'directory') return false;
      directoryPath = nextPath;
    }
    const parent = vfs.getNodeByPath(directoryPath, user);
    return !!parent && parent.type === 'directory' && canTraverse(directoryPath) &&
      vfs.checkPermission(parent, 'w', user) && vfs.checkPermission(parent, 'x', user);
  };
  const canRemoveTree = (path: string, recursive: boolean): boolean => {
    const resolved = vfs.resolvePath(path, user);
    const node = vfs.getNodeByPath(resolved, user);
    if (!node || !can('CAP_VFS_WRITE', resolved) || !canTraverse(resolved)) return false;
    const parentPath = resolved.slice(0, resolved.lastIndexOf('/')) || '/';
    const parent = vfs.getNodeByPath(parentPath, user);
    if (!parent || !vfs.checkPermission(parent, 'w', user) || !vfs.checkPermission(parent, 'x', user)) return false;
    if (node.type !== 'directory' || !node.children?.size) return true;
    if (!recursive || !vfs.checkPermission(node, 'r', user) || !vfs.checkPermission(node, 'x', user)) return false;
    for (const [name, child] of node.children) {
      const childPath = resolved === '/' ? `/${name}` : `${resolved}/${name}`;
      if (!canRemoveTree(childPath, true)) return false;
    }
    return true;
  };
  const canMutatePath = (path: string, includeParent = false, recursive = false) => {
    let current = vfs.resolvePath(path, user);
    if (!can('CAP_VFS_WRITE', current)) return false;
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
    const cloneEntry = (source: VFSNode): VFSNode => ({
      ...source,
      content: source.type === 'file' && vfs.checkPermission(source, 'r', user) ? source.content : undefined,
      parent: null,
      children: source.type === 'directory' ? new Map() : undefined,
    });
    const copy = cloneEntry(node);
    const pending: Array<{ source: VFSNode; clone: VFSNode; path: string }> = [{ source: node, clone: copy, path }];
    const seen = new WeakSet<VFSNode>([node]);
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (!current.source.children || !current.clone.children ||
          !vfs.checkPermission(current.source, 'x', user)) continue;
      for (const [name, child] of current.source.children) {
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
        const cwd = options.liveCwd ? target.getPwd() : processCwd;
        const node = target.getNodeByPath(cwd, user);
        return snapshotNode(node, cwd) || emptyDirectory('denied-cwd', cwd.split('/').pop() || '/');
      }
      if (property === 'db' || property === 'listeners' || property === 'saveNodeToIndexedDB' || property === 'deleteNodeFromIndexedDB') return undefined;
      if (property === 'subscribe') return () => () => undefined;
      if (property === 'getPwd') return () => options.liveCwd ? target.getPwd() : processCwd;
      if (property === 'getHomeDir') return () => target.getHomeDir(user);
      if (property === 'resolvePath') return (path: string) => target.resolvePath(path, user);
      if (property === 'getNodeByPath') {
        return (path: string, _ignoredUser?: string) => {
          const resolved = target.resolvePath(path, user);
          return snapshotNode(target.getNodeByPath(resolved, user), resolved);
        };
      }
      if (property === 'exists') {
        return (path: string, _ignoredUser?: string) => {
          const resolved = target.resolvePath(path, user);
          const node = can('CAP_VFS_READ', resolved) ? target.getNodeByPath(resolved, user) : null;
          return !!node && canTraverse(resolved) && target.checkPermission(node, 'r', user);
        };
      }
      if (property === 'readFile') {
        return (path: string, _ignoredUser?: string) => {
          const resolved = target.resolvePath(path, user);
          return can('CAP_VFS_READ', resolved) && canTraverse(resolved) ? target.readFile(resolved, user) : null;
        };
      }
      if (property === 'writeFile') {
        return (path: string, content: string, _ignoredUser?: string) => {
          const resolved = target.resolvePath(path, user);
          // Device writes dispatch to AI, network, and hardware services.
          if (resolved.startsWith('/dev/') && resolved !== '/dev/null') return false;
          if (!can('CAP_VFS_WRITE', resolved) || !canTraverse(resolved)) return false;
          const creating = !target.exists(resolved, user);
          if (creating && !canCreateInParent(resolved)) return false;
          return canMutatePath(resolved, creating) && target.writeFile(resolved, content, user);
        };
      }
      if (property === 'isExecutable') {
        return (path: string) => {
          const resolved = target.resolvePath(path, user);
          return can('CAP_VFS_READ', resolved) && target.isExecutable(resolved);
        };
      }
      if (property === 'mkdir') {
        return (path: string, recursive = false) => {
          const resolved = target.resolvePath(path, user);
          if (!canMutatePath(resolved, true, recursive) || (!recursive && !canTraverse(resolved))) return false;
          const exists = target.getNodeByPath(resolved, user);
          return exists?.type === 'directory' || (canCreateInParent(resolved, recursive) && target.mkdir(resolved, recursive));
        };
      }
      if (property === 'remove') {
        return (path: string, recursive = false, _ignoredUser?: string) => {
          const resolved = target.resolvePath(path, user);
          const parentPath = resolved.slice(0, resolved.lastIndexOf('/')) || '/';
          return canMutatePath(resolved, true, recursive) && canTraverse(parentPath) && canRemoveTree(resolved, recursive) &&
            target.remove(resolved, recursive, user);
        };
      }
      if (property === 'chmod') {
        return (path: string, mode: string, recursive = false) => {
          const resolved = target.resolvePath(path, user);
          return can('CAP_VFS_WRITE', resolved) && canTraverse(resolved) && target.chmod(resolved, mode, recursive, user);
        };
      }
      if (property === 'chown') {
        return (path: string, ownerGroup: string, recursive = false) => {
          const resolved = target.resolvePath(path, user);
          return can('CAP_VFS_WRITE', resolved) && target.chown(resolved, ownerGroup, recursive, user);
        };
      }
      if (property === 'symlink') {
        return (targetPath: string, linkPath: string) => {
          const resolvedTarget = target.resolvePath(targetPath, user);
          const resolvedLink = target.resolvePath(linkPath, user);
          if (!can('CAP_VFS_READ', resolvedTarget) || !canTraverse(resolvedTarget)) return false;
          return canMutatePath(resolvedLink, !target.exists(resolvedLink, user)) &&
            canCreateInParent(resolvedLink) && target.symlink(resolvedTarget, resolvedLink);
        };
      }
      // Interactive shell commands may change the session CWD, but only after
      // capability, traversal, and execute checks. Skill views remain read-only.
      if (property === 'changeDirectory') {
        return (path: string) => {
          if (!options.allowChangeDirectory) return false;
          const resolved = target.resolvePath(path, user);
          const node = target.getNodeByPath(resolved, user);
          return !!node && node.type === 'directory' &&
            can('CAP_VFS_READ', resolved) && canTraverse(resolved) &&
            target.checkPermission(node, 'x', user) && target.changeDirectory(resolved, user);
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
