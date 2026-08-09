// Earendel Host FileSystem Direct Mount Engine (FileSystem Access API)
import { VFSNode } from './vfs';

export interface HostMountPoint {
  targetPath: string;
  handle: any; // FileSystemDirectoryHandle
  mountedAt: Date;
}

export class HostMountEngine {
  private mountPoints: Map<string, HostMountPoint> = new Map();

  /**
   * Prompts user to select a local directory on their PC and mounts it into VFS targetPath
   */
  public async mountDirectoryPicker(targetPath: string = '/mnt/host'): Promise<{ success: boolean; message: string }> {
    if (typeof window === 'undefined' || !(window as any).showDirectoryPicker) {
      return {
        success: false,
        message: 'FileSystem Access API (window.showDirectoryPicker) is not supported in this browser context.',
      };
    }

    try {
      const handle = await (window as any).showDirectoryPicker({
        mode: 'readwrite',
      });

      const cleanPath = this.normalizePath(targetPath);
      this.mountPoints.set(cleanPath, {
        targetPath: cleanPath,
        handle,
        mountedAt: new Date(),
      });

      return {
        success: true,
        message: `Mounted host directory '${handle.name}' onto ${cleanPath} (rw)`,
      };
    } catch (e: any) {
      if (e.name === 'AbortError') {
        return { success: false, message: 'Mount operation cancelled by user.' };
      }
      return { success: false, message: `Failed to mount host directory: ${e.message}` };
    }
  }

  /**
   * Unmounts a host directory by path
   */
  public unmountDirectory(targetPath: string): boolean {
    const cleanPath = this.normalizePath(targetPath);
    return this.mountPoints.delete(cleanPath);
  }

  /**
   * Returns all active host mount points
   */
  public getMountPoints(): HostMountPoint[] {
    return Array.from(this.mountPoints.values());
  }

  /**
   * Checks if a VFS path falls under a mounted host directory
   */
  public getMatchingMount(vfsPath: string): { mount: HostMountPoint; relativePath: string } | null {
    const cleanPath = this.normalizePath(vfsPath);
    for (const [mountPath, mount] of this.mountPoints.entries()) {
      if (cleanPath === mountPath || cleanPath.startsWith(mountPath + '/')) {
        const relativePath = cleanPath === mountPath ? '' : cleanPath.slice(mountPath.length + 1);
        return { mount, relativePath };
      }
    }
    return null;
  }

  /**
   * Reads file content from host file handle
   */
  public async readFile(vfsPath: string): Promise<string | null> {
    const match = this.getMatchingMount(vfsPath);
    if (!match) return null;

    try {
      const fileHandle = await this.getFileHandle(match.mount.handle, match.relativePath, false);
      if (!fileHandle) return null;
      const file = await fileHandle.getFile();
      return await file.text();
    } catch (e) {
      return null;
    }
  }

  /**
   * Writes file content to real host PC file
   */
  public async writeFile(vfsPath: string, content: string): Promise<boolean> {
    const match = this.getMatchingMount(vfsPath);
    if (!match) return false;

    try {
      const fileHandle = await this.getFileHandle(match.mount.handle, match.relativePath, true);
      if (!fileHandle) return false;
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Creates a directory on real host PC hard drive
   */
  public async createDirectory(vfsPath: string): Promise<boolean> {
    const match = this.getMatchingMount(vfsPath);
    if (!match) return false;

    try {
      await this.getDirHandle(match.mount.handle, match.relativePath, true);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Removes an entry on real host PC hard drive
   */
  public async removeEntry(vfsPath: string): Promise<boolean> {
    const match = this.getMatchingMount(vfsPath);
    if (!match || !match.relativePath) return false;

    try {
      const parts = match.relativePath.split('/').filter(Boolean);
      const parentRelPath = parts.slice(0, -1).join('/');
      const nameToRemove = parts[parts.length - 1];

      let parentDirHandle = match.mount.handle;
      if (parentRelPath) {
        parentDirHandle = await this.getDirHandle(match.mount.handle, parentRelPath, false);
      }
      if (parentDirHandle && parentDirHandle.removeEntry) {
        await parentDirHandle.removeEntry(nameToRemove, { recursive: true });
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  /**
   * Scans real PC host directory entries and populates VFSNode children map
   */
  public async syncHostDirectoryToVFS(vfsPath: string, dirNode: VFSNode): Promise<void> {
    const match = this.getMatchingMount(vfsPath);
    if (!match || !dirNode.children) return;

    try {
      let targetDirHandle = match.mount.handle;
      if (match.relativePath) {
        targetDirHandle = await this.getDirHandle(match.mount.handle, match.relativePath, false);
      }
      if (!targetDirHandle) return;

      for await (const [name, handle] of targetDirHandle.entries()) {
        const isFile = handle.kind === 'file';
        let size = 4096;
        let fileContent = '';

        if (isFile) {
          try {
            const f = await handle.getFile();
            size = f.size;
            // Read content sample for small files (< 1MB)
            if (size < 1024 * 1024) {
              fileContent = await f.text();
            }
          } catch (e) {}
        }

        const existing = dirNode.children.get(name);
        if (!existing) {
          const childNode: VFSNode = {
            id: 'host_' + Math.random().toString(36).substring(2, 9),
            name,
            type: isFile ? 'file' : 'directory',
            permissions: isFile ? 'rw-r--r--' : 'rwxr-xr-x',
            owner: 'hello',
            group: 'hello',
            size,
            updatedAt: new Date(),
            content: isFile ? fileContent : undefined,
            children: isFile ? undefined : new Map(),
            parent: dirNode,
          };
          dirNode.children.set(name, childNode);
        } else if (isFile && existing.type === 'file') {
          existing.content = fileContent;
          existing.size = size;
        }
      }
    } catch (e) {}
  }

  // Helpers to traverse FileSystemHandle tree
  private async getFileHandle(dirHandle: any, relativePath: string, create: boolean): Promise<any | null> {
    const parts = relativePath.split('/').filter(Boolean);
    let curr = dirHandle;
    for (let i = 0; i < parts.length - 1; i++) {
      curr = await curr.getDirectoryHandle(parts[i], { create });
    }
    return await curr.getFileHandle(parts[parts.length - 1], { create });
  }

  private async getDirHandle(dirHandle: any, relativePath: string, create: boolean): Promise<any | null> {
    const parts = relativePath.split('/').filter(Boolean);
    let curr = dirHandle;
    for (const part of parts) {
      curr = await curr.getDirectoryHandle(part, { create });
    }
    return curr;
  }

  private normalizePath(path: string): string {
    const p = path.replace(/\/+/g, '/');
    return p.endsWith('/') && p.length > 1 ? p.slice(0, -1) : p;
  }
}

export const globalHostMountEngine = new HostMountEngine();
