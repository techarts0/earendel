// Earendel Linux Virtual File System (VFS) with IndexedDB Persistence

export interface VFSNode {
  id: string;
  name: string;
  type: 'file' | 'directory' | 'symlink';
  permissions: string; // e.g. "rwxr-xr-x" or "644"
  owner: string;
  group: string;
  size: number;
  updatedAt: Date;
  content?: string; // For files
  children?: Map<string, VFSNode>; // For directories
  parent: VFSNode | null;
  symlinkTarget?: string;
}

interface StoredNode {
  path: string;
  name: string;
  type: 'file' | 'directory' | 'symlink';
  permissions: string;
  owner: string;
  group: string;
  size: number;
  updatedAt: string;
  content?: string;
  symlinkTarget?: string;
}

export class VirtualFileSystem {
  root: VFSNode;
  currentDirectory: VFSNode;

  private listeners: Array<() => void> = [];
  private db: IDBDatabase | null = null;

  constructor() {
    this.root = {
      id: 'root',
      name: '',
      type: 'directory',
      permissions: 'rwxr-xr-x',
      owner: 'root',
      group: 'root',
      size: 4096,
      updatedAt: new Date(),
      children: new Map(),
      parent: null,
    };

    this.currentDirectory = this.root;
    this.initDefaultStructure();
    this.initIndexedDB();
  }

  // Initialize Linux FHS (Filesystem Hierarchy Standard)
  private initDefaultStructure() {
    // Standard FHS Root Directory Skeleton
    this.mkdir('/bin', true);
    this.mkdir('/boot', true);
    this.mkdir('/dev', true);
    this.mkdir('/etc', true);
    this.mkdir('/home/hello', true);
    this.mkdir('/lib', true);
    this.mkdir('/lib64', true);
    this.mkdir('/media', true);
    this.mkdir('/mnt', true);
    this.mkdir('/opt', true);
    this.mkdir('/proc', true);
    this.mkdir('/root', true);
    this.mkdir('/run', true);
    this.mkdir('/sbin', true);
    this.mkdir('/srv', true);
    this.mkdir('/sys', true);
    this.mkdir('/tmp', true);
    this.mkdir('/usr/bin', true);
    this.mkdir('/usr/lib', true);
    this.mkdir('/usr/local', true);
    this.mkdir('/usr/share/man', true);
    this.mkdir('/var/log', true);
    this.mkdir('/var/www', true);

    this.writeFile('/dev/null', '');
    this.writeFile('/dev/zero', '');
    this.writeFile(
      '/var/log/syslog',
      'Aug  8 02:00:01 earendel systemd[1]: Starting System Logging Service...\nAug  8 02:00:01 earendel systemd[1]: Started System Logging Service.\nAug  8 02:00:02 earendel kernel: [    0.000000] Linux version 5.15.0-88-generic (buildd@bos02-amd64-035)\nAug  8 02:00:05 earendel login: hello logged in on tty1\n'
    );

    const helloDir = this.getNodeByPath('/home/hello');
    if (helloDir && helloDir.type === 'directory') {
      this.currentDirectory = helloDir;
    }

    this.writeFile(
      '/home/hello/welcome.txt',
      '欢迎开启 Linux 星尘之旅！这是你的第一份测试文件。\n使用 cat welcome.txt 查看内容，或使用 chmod 修改本文件的权限。\n'
    );

    this.writeFile(
      '/home/hello/demo.sh',
      '#!/bin/bash\n# Earendel 第一脚本示例\nNAME="Ubuntu 探索者"\necho "你好，$NAME！祝贺你在 Earendel 成功运行首个 Shell 脚本！"\nfor i in 1 2 3\ndo\n  echo "计数: $i"\ndone\n'
    );
    this.chmod('/home/hello/demo.sh', 'rwxr-xr-x');

    this.writeFile(
      '/home/hello/demo.py',
      '#!/usr/bin/env python3\n# Earendel Python 脚本示例\nx = 10\ny = 20\nprint("X + Y 的计算结果:")\nprint(x + y)\nfor i in range(3):\n    print(i)\n'
    );
    this.chmod('/home/hello/demo.py', 'rwxr-xr-x');

    this.writeFile(
      '/home/hello/demo.js',
      '#!/usr/bin/env node\n// Earendel ES6+ Node.js 脚本示例\nconst numbers = [10, 20, 30, 40];\nconst squared = numbers.map(x => x * x);\nconsole.log("ES6+ Array.map 平方计算结果:", squared);\nconsole.log("Process Argv 列表:", process.argv);\n'
    );
    this.chmod('/home/hello/demo.js', 'rwxr-xr-x');

    this.writeFile(
      '/home/hello/.bashrc',
      '# Earendel User .bashrc configuration\nalias ll=\'ls -la\'\nalias la=\'ls -A\'\nalias cls=\'clear\'\n'
    );

    this.writeFile(
      '/etc/os-release',
      'NAME="Earendel"\nVERSION="0.1.1"\nID=ubuntu\nPRETTY_NAME="Earendel Linux Terminal Alpha"\n'
    );

    this.writeFile(
      '/etc/hosts',
      '127.0.0.1\tlocalhost earendel.local\n192.168.1.100\tearendel-server\n::1\t\tlocalhost ip6-localhost ip6-loopback\n'
    );

    this.writeFile(
      '/etc/passwd',
      'root:x:0:0:root:/root:/bin/bash\nhello:x:1000:1000:hello:/home/hello:/bin/bash\n'
    );

    this.writeFile(
      '/etc/shadow',
      'root:123456:19000:0:99999:7:::\nhello:123456:19000:0:99999:7:::\n'
    );

    this.writeFile(
      '/etc/group',
      'root:x:0:\nhello:x:1000:hello\nsudo:x:27:hello\n'
    );
  }

  // IndexedDB Auto-Persistence Engine
  private initIndexedDB() {
    if (typeof window === 'undefined' || !window.indexedDB) return;

    const request = indexedDB.open('earendel_vfs_db', 1);

    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains('vfs_nodes')) {
        db.createObjectStore('vfs_nodes', { keyPath: 'path' });
      }
    };

    request.onsuccess = (e) => {
      this.db = (e.target as IDBOpenDBRequest).result;
      this.loadFromIndexedDB();
    };
  }

  private async loadFromIndexedDB() {
    if (!this.db) return;
    try {
      const tx = this.db.transaction('vfs_nodes', 'readonly');
      const store = tx.objectStore('vfs_nodes');
      const request = store.getAll();

      request.onsuccess = () => {
        const storedNodes: StoredNode[] = request.result || [];
        if (storedNodes.length > 0) {
          // Sort by path depth to build tree in order
          storedNodes.sort((a, b) => a.path.split('/').length - b.path.split('/').length);

          for (const sNode of storedNodes) {
            if (sNode.path === '/') continue;
            if (sNode.path.startsWith('/home/student')) continue; // Skip legacy student home
            if (sNode.path === '/home/hello') continue;

            const existing = this.getNodeByPath(sNode.path);
            if (!existing) {
              if (sNode.path === '/etc/passwd' && sNode.content?.includes('student:')) {
                sNode.content = sNode.content.replace(/student:x:1000:1000:student:\/home\/student:\/bin\/bash/g, 'hello:x:1000:1000:hello:/home/hello:/bin/bash');
              }
              if (sNode.path === '/etc/shadow' && sNode.content?.includes('student:')) {
                sNode.content = sNode.content.replace(/student:123456/g, 'hello:123456');
              }
              this.writeFile(sNode.path, sNode.content ?? '');
              const node = this.getNodeByPath(sNode.path);
              if (node) {
                node.permissions = sNode.permissions;
                node.owner = sNode.owner === 'student' ? 'hello' : sNode.owner;
                node.group = sNode.group === 'student' ? 'hello' : sNode.group;
              }
            } else {
              if (existing.owner === 'student') existing.owner = 'hello';
              if (existing.group === 'student') existing.group = 'hello';
            }
          }
          this.notify();
        }
      };
    } catch (err) {
      console.warn('Failed to load VFS from IndexedDB:', err);
    }
  }

  private saveNodeToIndexedDB(pathStr: string, node: VFSNode) {
    if (!this.db) return;
    try {
      const tx = this.db.transaction('vfs_nodes', 'readwrite');
      const store = tx.objectStore('vfs_nodes');
      const record: StoredNode = {
        path: pathStr,
        name: node.name,
        type: node.type,
        permissions: node.permissions,
        owner: node.owner,
        group: node.group,
        size: node.size,
        updatedAt: node.updatedAt.toISOString(),
        content: node.content,
      };
      store.put(record);
    } catch (err) {
      // Ignore IDB write error
    }
  }

  private deleteNodeFromIndexedDB(pathStr: string) {
    if (!this.db) return;
    try {
      const tx = this.db.transaction('vfs_nodes', 'readwrite');
      const store = tx.objectStore('vfs_nodes');
      store.delete(pathStr);
    } catch (err) {
      // Ignore IDB delete error
    }
  }

  // Subscribe to VFS changes
  subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach((listener) => listener());
  }

  public isExecutable(pathStr: string): boolean {
    const node = this.getNodeByPath(pathStr);
    if (!node || node.type !== 'file') return false;
    const p = node.permissions;
    // Check if any 'x' bit is set (e.g. rwxr-xr-x or rwxrwxrwx)
    return p.includes('x');
  }

  getPwd(): string {
    if (this.currentDirectory === this.root) return '/';
    const pathParts: string[] = [];
    let curr: VFSNode | null = this.currentDirectory;
    while (curr && curr.parent) {
      pathParts.unshift(curr.name);
      curr = curr.parent;
    }
    return '/' + pathParts.join('/');
  }

  resolvePath(pathStr: string): string {
    if (!pathStr || pathStr === '.') return this.getPwd();
    if (pathStr === '~') return '/home/hello';
    if (pathStr.startsWith('~/')) return '/home/hello' + pathStr.slice(1);

    let absolute = pathStr.startsWith('/')
      ? pathStr
      : (this.getPwd() === '/' ? '' : this.getPwd()) + '/' + pathStr;

    const parts = absolute.split('/').filter(Boolean);
    const resolvedParts: string[] = [];

    for (const part of parts) {
      if (part === '.') continue;
      if (part === '..') {
        if (resolvedParts.length > 0) resolvedParts.pop();
      } else {
        resolvedParts.push(part);
      }
    }

    return '/' + resolvedParts.join('/');
  }

  getNodeByPath(pathStr: string): VFSNode | null {
    const absPath = this.resolvePath(pathStr);
    if (absPath === '/') return this.root;

    const parts = absPath.split('/').filter(Boolean);
    let curr = this.root;

    for (const part of parts) {
      if (curr.type !== 'directory' || !curr.children) return null;
      const next = curr.children.get(part);
      if (!next) return null;
      curr = next;
    }

    return curr;
  }

  mkdir(pathStr: string, recursive = false): boolean {
    const absPath = this.resolvePath(pathStr);
    const parts = absPath.split('/').filter(Boolean);
    let curr = this.root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!curr.children) return false;

      let next = curr.children.get(part);
      if (!next) {
        if (i < parts.length - 1 && !recursive) return false;
        next = {
          id: Math.random().toString(36).substring(2, 9),
          name: part,
          type: 'directory',
          permissions: 'rwxr-xr-x',
          owner: 'hello',
          group: 'hello',
          size: 4096,
          updatedAt: new Date(),
          children: new Map(),
          parent: curr,
        };
        curr.children.set(part, next);
        const subPath = '/' + parts.slice(0, i + 1).join('/');
        this.saveNodeToIndexedDB(subPath, next);
      } else if (next.type !== 'directory') {
        return false;
      }
      curr = next;
    }

    this.notify();
    return true;
  }

  writeFile(pathStr: string, content: string): boolean {
    const absPath = this.resolvePath(pathStr);
    const lastSlashIndex = absPath.lastIndexOf('/');
    const dirPath = absPath.substring(0, lastSlashIndex) || '/';
    const fileName = absPath.substring(lastSlashIndex + 1);

    const dirNode = this.getNodeByPath(dirPath);
    if (!dirNode || dirNode.type !== 'directory' || !dirNode.children) {
      return false;
    }

    let fileNode = dirNode.children.get(fileName);
    if (fileNode) {
      if (fileNode.type === 'directory') return false;
      fileNode.content = content;
      fileNode.size = new Blob([content]).size;
      fileNode.updatedAt = new Date();
    } else {
      fileNode = {
        id: Math.random().toString(36).substring(2, 9),
        name: fileName,
        type: 'file',
        permissions: 'rw-r--r--',
        owner: 'hello',
        group: 'hello',
        size: new Blob([content]).size,
        updatedAt: new Date(),
        content: content,
        parent: dirNode,
      };
      dirNode.children.set(fileName, fileNode);
    }

    this.saveNodeToIndexedDB(absPath, fileNode);
    this.notify();
    return true;
  }

  readFile(pathStr: string): string | null {
    const node = this.getNodeByPath(pathStr);
    if (node && node.type === 'file') {
      return node.content ?? '';
    }
    return null;
  }

  remove(pathStr: string, recursive = false): boolean {
    const absPath = this.resolvePath(pathStr);
    const node = this.getNodeByPath(absPath);
    if (!node || !node.parent || node === this.root) return false;

    if (node.type === 'directory' && node.children && node.children.size > 0 && !recursive) {
      return false;
    }

    node.parent.children?.delete(node.name);
    this.deleteNodeFromIndexedDB(absPath);
    this.notify();
    return true;
  }

  changeDirectory(pathStr: string): boolean {
    const target = this.getNodeByPath(pathStr);
    if (target && target.type === 'directory') {
      this.currentDirectory = target;
      this.notify();
      return true;
    }
    return false;
  }

  chmod(pathStr: string, mode: string, recursive: boolean = false): boolean {
    const absPath = this.resolvePath(pathStr);
    const node = this.getNodeByPath(absPath);
    if (!node) return false;

    const applyChmod = (targetNode: VFSNode, nodeAbsPath: string) => {
      if (/^[0-7]{3}$/.test(mode)) {
        const modeMap: { [key: string]: string } = {
          '7': 'rwx', '6': 'rw-', '5': 'r-x', '4': 'r--', '3': '-wx', '2': '-w-', '1': '--x', '0': '---'
        };
        const u = modeMap[mode[0]];
        const g = modeMap[mode[1]];
        const o = modeMap[mode[2]];
        targetNode.permissions = `${u}${g}${o}`;
      } else if (mode.includes('+x')) {
        targetNode.permissions = 'rwxr-xr-x';
      } else {
        targetNode.permissions = mode;
      }

      targetNode.updatedAt = new Date();
      this.saveNodeToIndexedDB(nodeAbsPath, targetNode);

      if (recursive && targetNode.type === 'directory' && targetNode.children) {
        for (const [childName, childNode] of targetNode.children.entries()) {
          const childPath = nodeAbsPath === '/' ? `/${childName}` : `${nodeAbsPath}/${childName}`;
          applyChmod(childNode, childPath);
        }
      }
    };

    applyChmod(node, absPath);
    this.notify();
    return true;
  }

  chown(pathStr: string, ownerGroupStr: string, recursive: boolean = false): boolean {
    const absPath = this.resolvePath(pathStr);
    const node = this.getNodeByPath(absPath);
    if (!node) return false;

    const [owner, group] = ownerGroupStr.split(':');

    const applyChown = (targetNode: VFSNode, nodeAbsPath: string) => {
      if (owner) targetNode.owner = owner;
      if (group) targetNode.group = group;

      targetNode.updatedAt = new Date();
      this.saveNodeToIndexedDB(nodeAbsPath, targetNode);

      if (recursive && targetNode.type === 'directory' && targetNode.children) {
        for (const [childName, childNode] of targetNode.children.entries()) {
          const childPath = nodeAbsPath === '/' ? `/${childName}` : `${nodeAbsPath}/${childName}`;
          applyChown(childNode, childPath);
        }
      }
    };

    applyChown(node, absPath);
    this.notify();
    return true;
  }

  symlink(targetPath: string, linkPathStr: string): boolean {
    const absLinkPath = this.resolvePath(linkPathStr);
    const lastSlashIndex = absLinkPath.lastIndexOf('/');
    const dirPath = absLinkPath.substring(0, lastSlashIndex) || '/';
    const linkName = absLinkPath.substring(lastSlashIndex + 1);

    const dirNode = this.getNodeByPath(dirPath);
    if (!dirNode || dirNode.type !== 'directory' || !dirNode.children) {
      return false;
    }

    const symlinkNode: VFSNode = {
      id: Math.random().toString(36).substring(2, 9),
      name: linkName,
      type: 'symlink',
      permissions: 'rwxrwxrwx',
      owner: 'hello',
      group: 'hello',
      size: targetPath.length,
      updatedAt: new Date(),
      symlinkTarget: targetPath,
      parent: dirNode,
    };

    dirNode.children.set(linkName, symlinkNode);
    this.saveNodeToIndexedDB(absLinkPath, symlinkNode);
    this.notify();
    return true;
  }
}

export const globalVFS = new VirtualFileSystem();
