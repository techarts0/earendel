// Earendel Full System Snapshot & Time Machine Engine
import { globalVFS } from './vfs';

export interface SnapshotRecord {
  name: string;
  created: string;
  nodeCount: number;
  data: string; // Base64 encoded JSON representation of VFS tree
}

class SnapshotEngine {
  private snapshots: Map<string, SnapshotRecord> = new Map();

  constructor() {
    this.loadFromLocalStorage();
  }

  private loadFromLocalStorage() {
    try {
      const saved = localStorage.getItem('earendel_snapshots_v1');
      if (saved) {
        const records: SnapshotRecord[] = JSON.parse(saved);
        records.forEach((r) => this.snapshots.set(r.name, r));
      }
    } catch (e) {}
  }

  private saveToLocalStorage() {
    try {
      const records = Array.from(this.snapshots.values());
      localStorage.setItem('earendel_snapshots_v1', JSON.stringify(records));
    } catch (e) {}
  }

  public saveSnapshot(name: string): { success: boolean; nodeCount: number; message: string } {
    if (!name) return { success: false, nodeCount: 0, message: 'missing snapshot name' };

    const nodesData: Record<string, any> = {};
    let count = 0;

    const walk = (pathStr: string) => {
      const node = globalVFS.getNodeByPath(pathStr);
      if (!node) return;

      count++;
      nodesData[pathStr] = {
        name: node.name,
        type: node.type,
        permissions: node.permissions,
        owner: node.owner,
        group: node.group,
        content: node.content || '',
      };

      if (node.type === 'directory' && node.children) {
        for (const childName of node.children.keys()) {
          const childPath = pathStr === '/' ? `/${childName}` : `${pathStr}/${childName}`;
          walk(childPath);
        }
      }
    };

    walk('/');

    const payload = btoa(unescape(encodeURIComponent(JSON.stringify(nodesData))));
    const record: SnapshotRecord = {
      name,
      created: new Date().toLocaleString(),
      nodeCount: count,
      data: payload,
    };

    this.snapshots.set(name, record);
    this.saveToLocalStorage();

    return { success: true, nodeCount: count, message: `Created full system snapshot '${name}' (${count} nodes captured).` };
  }

  public restoreSnapshot(name: string): { success: boolean; message: string } {
    const record = this.snapshots.get(name);
    if (!record) {
      return { success: false, message: `Snapshot '${name}' not found.` };
    }

    try {
      const rawJson = decodeURIComponent(escape(atob(record.data)));
      const nodesData = JSON.parse(rawJson);

      for (const pathStr of Object.keys(nodesData)) {
        const item = nodesData[pathStr];
        if (pathStr === '/') continue;

        if (item.type === 'directory') {
          globalVFS.mkdir(pathStr, true);
        } else if (item.type === 'file') {
          globalVFS.writeFile(pathStr, item.content);
        }
        globalVFS.chmod(pathStr, item.permissions);
        globalVFS.chown(pathStr, `${item.owner}:${item.group}`);
      }

      return {
        success: true,
        message: `Restored system state back to '${name}'. All VFS nodes successfully rollbacked! ⏱️`,
      };
    } catch (e) {
      return { success: false, message: `Failed to restore snapshot '${name}': Corrupted payload.` };
    }
  }

  public getSnapshots(): SnapshotRecord[] {
    return Array.from(this.snapshots.values());
  }

  public deleteSnapshot(name: string): boolean {
    const ok = this.snapshots.delete(name);
    if (ok) this.saveToLocalStorage();
    return ok;
  }
}

export const globalSnapshotEngine = new SnapshotEngine();
