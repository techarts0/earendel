// Earendel Full System Snapshot & Time Machine Engine
import { globalVFS, VirtualFileSystem } from './vfs';
import { globalTaskScheduler } from '../kernel/taskScheduler';
import { globalCapabilityManager } from '../kernel/capability';

const SNAPSHOT_STORAGE_KEY = 'earendel_snapshots_v1';
const MAX_SNAPSHOT_JSON_BYTES = 1.5 * 1024 * 1024;
const MAX_SNAPSHOT_STORE_CHARS = 2 * 1024 * 1024;
const MAX_SNAPSHOT_COUNT = 16;
const VOLATILE_RUNTIME_PATHS = ['/dev', '/proc', '/sys', '/run'];

function isVolatileRuntimePath(path: string): boolean {
  return VOLATILE_RUNTIME_PATHS.some((root) => path === root || path.startsWith(`${root}/`));
}

export interface SnapshotRecord {
  name: string;
  created: string;
  nodeCount: number;
  data: string; // Base64 encoded JSON representation of VFS tree
}

class SnapshotEngine {
  private snapshots: Map<string, SnapshotRecord> = new Map();

  private hasAdminProcess(pid: number): boolean {
    const process = globalTaskScheduler.getProcess(pid);
    return !!process && process.state === 'RUNNING' && globalCapabilityManager.hasCapability(pid, 'CAP_SYS_ADMIN');
  }

  constructor() {
    this.loadFromLocalStorage();
  }

  private loadFromLocalStorage() {
    try {
      const saved = globalThis.localStorage?.getItem(SNAPSHOT_STORAGE_KEY);
      if (!saved || saved.length > MAX_SNAPSHOT_STORE_CHARS) return;
      const records: unknown = JSON.parse(saved);
      if (!Array.isArray(records)) return;
      for (const record of records.slice(0, MAX_SNAPSHOT_COUNT)) {
        if (record && typeof record.name === 'string' && record.name.length > 0 &&
            typeof record.created === 'string' && Number.isSafeInteger(record.nodeCount) &&
            typeof record.data === 'string' && record.data.length <= MAX_SNAPSHOT_STORE_CHARS) {
          this.snapshots.set(record.name, record as SnapshotRecord);
        }
      }
    } catch { /* Storage may be disabled or contain malformed data. */ }
  }

  private persistSnapshotSet(snapshots: Map<string, SnapshotRecord>): boolean {
    if (snapshots.size > MAX_SNAPSHOT_COUNT) return false;
    try {
      const serialized = JSON.stringify(Array.from(snapshots.values()));
      if (serialized.length > MAX_SNAPSHOT_STORE_CHARS) return false;
      if (!globalThis.localStorage) return false;
      globalThis.localStorage.setItem(SNAPSHOT_STORAGE_KEY, serialized);
      return true;
    } catch { return false; }
  }

  public saveSnapshot(name: string, callerPid: number): { success: boolean; nodeCount: number; message: string } {
    if (!this.hasAdminProcess(callerPid)) {
      return { success: false, nodeCount: 0, message: 'EACCES: CAP_SYS_ADMIN is required to save a system snapshot.' };
    }
    if (!name) return { success: false, nodeCount: 0, message: 'missing snapshot name' };

    const nodesData: Record<string, any> = {};
    let count = 0;
    let contentBytes = 0;
    let tooLarge = false;

    const pendingPaths = ['/'];
    while (pendingPaths.length > 0 && !tooLarge) {
      const pathStr = pendingPaths.pop()!;
      if (isVolatileRuntimePath(pathStr)) continue;
      const node = globalVFS.getNodeByPath(pathStr);
      if (!node) continue;

      count++;
      if (count > 250_000) { tooLarge = true; break; }
      if (node.type === 'file') {
        contentBytes += new TextEncoder().encode(node.content || '').byteLength;
        if (contentBytes > MAX_SNAPSHOT_JSON_BYTES) { tooLarge = true; break; }
      }
      nodesData[pathStr] = {
        name: node.name,
        type: node.type,
        permissions: node.permissions,
        owner: node.owner,
        group: node.group,
        content: node.content || '',
        symlinkTarget: node.symlinkTarget,
      };

      if (node.type === 'directory' && node.children) {
        for (const childName of node.children.keys()) {
          const childPath = pathStr === '/' ? `/${childName}` : `${pathStr}/${childName}`;
          pendingPaths.push(childPath);
        }
      }
    }
    if (tooLarge) return { success: false, nodeCount: 0, message: 'Snapshot exceeds the browser storage safety limit.' };

    let payload: string;
    try {
      const json = JSON.stringify(nodesData);
      if (new TextEncoder().encode(json).byteLength > MAX_SNAPSHOT_JSON_BYTES) {
        return { success: false, nodeCount: 0, message: 'Snapshot exceeds the browser storage safety limit.' };
      }
      payload = btoa(unescape(encodeURIComponent(json)));
    } catch {
      return { success: false, nodeCount: 0, message: 'Snapshot could not be encoded.' };
    }
    const record: SnapshotRecord = {
      name,
      created: new Date().toLocaleString(),
      nodeCount: count,
      data: payload,
    };

    const nextSnapshots = new Map(this.snapshots);
    nextSnapshots.set(name, record);
    if (!this.persistSnapshotSet(nextSnapshots)) {
      return { success: false, nodeCount: 0, message: 'Snapshot was not saved: browser storage is unavailable, full, or over its safety limit.' };
    }
    this.snapshots = nextSnapshots;

    return { success: true, nodeCount: count, message: `Created full system snapshot '${name}' (${count} nodes captured).` };
  }

  public restoreSnapshot(name: string, callerPid: number): { success: boolean; message: string } {
    if (!this.hasAdminProcess(callerPid)) {
      return { success: false, message: 'EACCES: CAP_SYS_ADMIN is required to restore a system snapshot.' };
    }
    const record = this.snapshots.get(name);
    if (!record) {
      return { success: false, message: `Snapshot '${name}' not found.` };
    }

    try {
      if (typeof record.data !== 'string' || record.data.length > MAX_SNAPSHOT_STORE_CHARS) {
        return { success: false, message: `Failed to restore snapshot '${name}': Invalid or oversized payload.` };
      }
      const rawJson = decodeURIComponent(escape(atob(record.data)));
      const nodesData = JSON.parse(rawJson);
      if (!nodesData || typeof nodesData !== 'object' || Array.isArray(nodesData) ||
          Object.keys(nodesData).length !== record.nodeCount || Object.keys(nodesData).length > 250_000 ||
          !nodesData['/'] || nodesData['/'].type !== 'directory') {
        return { success: false, message: `Failed to restore snapshot '${name}': Invalid node table.` };
      }
      const nodePaths = Object.keys(nodesData);
      const nodePathSet = new Set(nodePaths);
      const toChmodMode = (permissions: unknown): string | null => {
        if (typeof permissions !== 'string') return null;
        if (/^0?[0-7]{3}$/.test(permissions)) return permissions;
        if (!/^(r|-)(w|-)(x|-)(r|-)(w|-)(x|-)(r|-)(w|-)(x|-)$/.test(permissions)) return null;
        const triplet = (value: string) => (value[0] === 'r' ? 4 : 0) + (value[1] === 'w' ? 2 : 0) + (value[2] === 'x' ? 1 : 0);
        return `${triplet(permissions.slice(0, 3))}${triplet(permissions.slice(3, 6))}${triplet(permissions.slice(6, 9))}`;
      };
      let aggregateFileBytes = 0;
      for (const [pathStr, rawItem] of Object.entries(nodesData)) {
        if (pathStr === '/') {
          const rootItem = rawItem as any;
          if (rootItem.permissions && !toChmodMode(rootItem.permissions)) {
            return { success: false, message: `Failed to restore snapshot '${name}': Invalid root permissions.` };
          }
          continue;
        }
        const item = rawItem as any;
        if (!pathStr.startsWith('/') || pathStr.length > 4096 || pathStr.includes('\0') ||
            globalVFS.resolvePath(pathStr) !== pathStr || !item || typeof item !== 'object' ||
            !['directory', 'file', 'symlink'].includes(item.type)) {
          return { success: false, message: `Failed to restore snapshot '${name}': Invalid node at '${pathStr}'.` };
        }
        const parentPath = pathStr.slice(0, pathStr.lastIndexOf('/')) || '/';
        if (!nodePathSet.has(parentPath) || nodesData[parentPath]?.type !== 'directory' ||
            typeof item.owner !== 'string' || !/^[a-zA-Z0-9_.-]{1,255}$/.test(item.owner) ||
            typeof item.group !== 'string' || !/^[a-zA-Z0-9_.-]{1,255}$/.test(item.group) ||
            !toChmodMode(item.permissions)) {
          return { success: false, message: `Failed to restore snapshot '${name}': Invalid metadata or parent for '${pathStr}'.` };
        }
        if (item.type === 'symlink' && (typeof item.symlinkTarget !== 'string' || !item.symlinkTarget || item.symlinkTarget.length > 4096)) {
          return { success: false, message: `Failed to restore snapshot '${name}': Invalid symbolic link at '${pathStr}'.` };
        }
        if (item.type === 'file' && (typeof item.content !== 'string' ||
            item.content.length > VirtualFileSystem.MAX_FILE_BYTES ||
            new TextEncoder().encode(item.content).byteLength > VirtualFileSystem.MAX_FILE_BYTES)) {
          return { success: false, message: `Failed to restore snapshot '${name}': File '${pathStr}' exceeds the VFS file-size limit or has invalid content.` };
        }
        if (item.type === 'file') aggregateFileBytes += new TextEncoder().encode(item.content).byteLength;
        if (aggregateFileBytes > MAX_SNAPSHOT_JSON_BYTES) {
          return { success: false, message: `Failed to restore snapshot '${name}': Aggregate file data exceeds the snapshot safety limit.` };
        }
      }

      // Apply parent directories before children even if the stored JSON keys
      // were reordered. Runtime pseudo-filesystems are live kernel state and
      // must be retained, not reconstructed from a stale browser snapshot.
      const orderedPaths = nodePaths.filter((path) => path !== '/' && !isVolatileRuntimePath(path))
        .sort((left, right) => left.split('/').length - right.split('/').length);
      for (const pathStr of orderedPaths) {
        const item = nodesData[pathStr];

        if (item.type === 'directory') {
          if (!globalVFS.mkdir(pathStr, true)) return { success: false, message: `Failed to restore snapshot '${name}': Could not create '${pathStr}'.` };
        } else if (item.type === 'file') {
          if (!globalVFS.writeFile(pathStr, item.content, 'root')) return { success: false, message: `Failed to restore snapshot '${name}': Could not write '${pathStr}'.` };
        } else if (item.type === 'symlink') {
          const existing = globalVFS.getNodeByPath(pathStr, 'root');
          if (existing && !globalVFS.remove(pathStr, false, 'root')) {
            return { success: false, message: `Failed to restore snapshot '${name}': Could not replace '${pathStr}'.` };
          }
          if (!globalVFS.symlink(item.symlinkTarget, pathStr)) {
            return { success: false, message: `Failed to restore snapshot '${name}': Could not create symbolic link '${pathStr}'.` };
          }
        }
        if (item.type !== 'symlink' && (!globalVFS.chmod(pathStr, toChmodMode(item.permissions)!, false, 'root') ||
            !globalVFS.chown(pathStr, `${item.owner}:${item.group}`, false, 'root'))) {
          return { success: false, message: `Failed to restore snapshot '${name}': Could not restore metadata for '${pathStr}'.` };
        }
      }

      return {
        success: true,
        message: `Restored system state back to '${name}'. All VFS nodes successfully rollbacked! ⏱️`,
      };
    } catch (e) {
      return { success: false, message: `Failed to restore snapshot '${name}': Corrupted payload.` };
    }
  }

  public getSnapshots(callerPid: number): SnapshotRecord[] {
    if (!this.hasAdminProcess(callerPid)) return [];
    return Array.from(this.snapshots.values()).map((record) => ({ ...record }));
  }

  public deleteSnapshot(name: string, callerPid: number): boolean {
    if (!this.hasAdminProcess(callerPid)) return false;
    if (!this.snapshots.has(name)) return false;
    const nextSnapshots = new Map(this.snapshots);
    nextSnapshots.delete(name);
    if (!this.persistSnapshotSet(nextSnapshots)) return false;
    this.snapshots = nextSnapshots;
    return true;
  }
}

export const globalSnapshotEngine = new SnapshotEngine();
