// Earendel Linux Virtual File System (VFS) with IndexedDB Persistence
import { globalCommandRegistry } from './commandRegistry';
import { globalHostMountEngine } from './hostMountEngine';
import { globalTaskScheduler } from '../kernel/taskScheduler';

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
    this.mkdir('/var/cache/apt/archives', true);
    this.mkdir('/var/lib/dpkg', true);
    this.mkdir('/var/lib/dpkg/info', true);

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
      'NAME="Earendel"\nVERSION="0.1.1"\nID=ubuntu\nPRETTY_NAME="Earendel POSIX WebOS"\n'
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
      'root:$6$earendel$salt$earendel_hash:19000:0:99999:7:::\nhello:$6$earendel$salt$earendel_hash:19000:0:99999:7:::\n'
    );

    this.writeFile(
      '/etc/group',
      'root:x:0:\nhello:x:1000:hello\nsudo:x:27:hello\n'
    );

    // Sync physical binary symbols to /usr/bin/
    try {
      globalCommandRegistry.syncAllSymbolsToVFS();
    } catch (e) { }
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
            if (sNode.path === '/' || sNode.path === '/home/hello') continue;

            const existing = this.getNodeByPath(sNode.path);
            if (!existing) {
              if (sNode.type === 'directory') {
                this.mkdir(sNode.path, true);
              } else if (sNode.type === 'symlink') {
                this.symlink(sNode.symlinkTarget || '', sNode.path);
              } else {
                this.writeFile(sNode.path, sNode.content ?? '');
              }
              const node = this.getNodeByPath(sNode.path);
              if (node) {
                node.type = sNode.type;
                node.permissions = (sNode.path.startsWith('/bin/') || sNode.path.startsWith('/usr/bin/')) ? 'rwxr-xr-x' : sNode.permissions;
                node.owner = sNode.owner;
                node.group = sNode.group;
                if (sNode.symlinkTarget) node.symlinkTarget = sNode.symlinkTarget;
              }
            }
          }
          this.notify();
          globalCommandRegistry.syncAllSymbolsToVFS();
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
        symlinkTarget: node.symlinkTarget,
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

  resolvePath(pathStr: string, customHome?: string): string {
    if (!pathStr || pathStr === '.') return this.getPwd();
    const homeDir = customHome || (typeof window !== 'undefined' && (window as any).globalShellEngine?.getEnv('HOME')) || '/home/hello';
    if (pathStr === '~') return homeDir;
    if (pathStr.startsWith('~/')) return homeDir + pathStr.slice(1);

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
    if (absPath.startsWith('/proc') || absPath === '/proc') {
      const procNode = this.generateProcNode(absPath);
      if (procNode) return procNode;
    }
    if (absPath === '/') return this.root;

    const parts = absPath.split('/').filter(Boolean);
    let curr = this.root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (curr.type !== 'directory' || !curr.children) return null;
      let next = curr.children.get(part);

      // If missing in VFS memory tree, check if managed by HostMountEngine
      if (!next) {
        const subPath = '/' + parts.slice(0, i + 1).join('/');
        const match = globalHostMountEngine.getMatchingMount(subPath);
        if (match) {
          const isMountRoot = match.relativePath === '';
          const isFile = !isMountRoot && match.relativePath.includes('.');
          next = {
            id: 'host_' + Math.random().toString(36).substring(2, 9),
            name: part,
            type: isFile ? 'file' : 'directory',
            permissions: isFile ? 'rw-r--r--' : 'rwxr-xr-x',
            owner: 'hello',
            group: 'hello',
            size: 4096,
            updatedAt: new Date(),
            children: isFile ? undefined : new Map(),
            parent: curr,
          };
          curr.children.set(part, next);
        } else {
          return null;
        }
      }
      curr = next;
    }

    // Trigger host physical directory scan and sync if node is a mounted host directory
    if (curr.type === 'directory' && globalHostMountEngine.getMatchingMount(absPath)) {
      globalHostMountEngine.syncHostDirectoryToVFS(absPath, curr);
    }

    return curr;
  }

  mkdir(pathStr: string, recursive = false): boolean {
    const absPath = this.resolvePath(pathStr);
    const parts = absPath.split('/').filter(Boolean);
    let curr = this.root;

    // Create real physical directory if under host mount point
    if (globalHostMountEngine.getMatchingMount(absPath)) {
      globalHostMountEngine.createDirectory(absPath);
    }

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

  public checkPermission(node: VFSNode, requiredBit: 'r' | 'w' | 'x', currentUser: string = 'hello'): boolean {
    if (currentUser === 'root') return true;
    const isOwner = node.owner === currentUser;
    const isGroup = node.group === currentUser;
    const offset = isOwner ? 0 : (isGroup ? 3 : 6);
    const bitOffset = requiredBit === 'r' ? 0 : requiredBit === 'w' ? 1 : 2;
    const bits = node.permissions.padEnd(9, '-');
    return bits[offset + bitOffset] !== '-';
  }

  writeFile(pathStr: string, content: string, currentUser = 'hello'): boolean {
    const absPath = this.resolvePath(pathStr);

    if (globalHostMountEngine.getMatchingMount(absPath)) {
      globalHostMountEngine.writeFile(absPath, content);
    }

    const dirPath = absPath.substring(0, absPath.lastIndexOf('/')) || '/';
    const fileName = absPath.substring(absPath.lastIndexOf('/') + 1);

    const dirNode = this.getNodeByPath(dirPath);
    if (!dirNode || dirNode.type !== 'directory' || !dirNode.children) {
      return false;
    }

    let fileNode = dirNode.children.get(fileName);
    if (fileNode) {
      if (fileNode.type === 'directory') return false;
      if (!this.checkPermission(fileNode, 'w', currentUser)) return false;
      fileNode.content = content;
      fileNode.size = new TextEncoder().encode(content).length;
      fileNode.updatedAt = new Date();
    } else {
      if (!this.checkPermission(dirNode, 'w', currentUser)) return false;
      const byteLength = new TextEncoder().encode(content).length;
      const isBinDir = dirPath === '/bin' || dirPath === '/usr/bin' || dirPath === '/sbin' || dirPath === '/usr/sbin';
      fileNode = {
        id: Math.random().toString(36).substring(2, 9),
        name: fileName,
        type: 'file',
        permissions: isBinDir ? 'rwxr-xr-x' : 'rw-r--r--',
        owner: currentUser,
        group: currentUser,
        size: byteLength,
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

  readFile(pathStr: string, currentUser = 'hello'): string | null {
    const absPath = this.resolvePath(pathStr);

    const node = this.getNodeByPath(absPath);
    if (node && node.type === 'file') {
      if (!this.checkPermission(node, 'r', currentUser)) return null;
      return node.content ?? '';
    }
    return null;
  }

  remove(pathStr: string, recursive = false, currentUser = 'hello'): boolean {
    const absPath = this.resolvePath(pathStr);

    if (globalHostMountEngine.getMatchingMount(absPath)) {
      globalHostMountEngine.removeEntry(absPath);
    }

    const node = this.getNodeByPath(absPath);
    if (!node || !node.parent || node === this.root) return false;

    if (!this.checkPermission(node.parent, 'w', currentUser)) return false;

    if (node.type === 'directory' && node.children && node.children.size > 0 && !recursive) {
      return false;
    }

    node.parent.children?.delete(node.name);

    const deleteSubtreeIDB = (n: VFSNode, currPath: string) => {
      if (n.type === 'directory' && n.children) {
        for (const child of n.children.values()) {
          const childPath = currPath === '/' ? `/${child.name}` : `${currPath}/${child.name}`;
          deleteSubtreeIDB(child, childPath);
        }
      }
      this.deleteNodeFromIndexedDB(currPath);
    };

    deleteSubtreeIDB(node, absPath);
    this.notify();
    return true;
  }

  changeDirectory(pathStr: string, currentUser = 'hello'): boolean {
    const absPath = this.resolvePath(pathStr);
    const target = this.getNodeByPath(absPath);

    if (target) {
      const match = globalHostMountEngine.getMatchingMount(absPath);
      if (match && match.relativePath === '') {
        target.type = 'directory';
        if (!target.children) target.children = new Map();
      }

      if (target.type === 'directory') {
        if (!this.checkPermission(target, 'x', currentUser)) return false;
        this.currentDirectory = target;
        this.notify();
        return true;
      }
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
        targetNode.permissions = `${modeMap[mode[0]]}${modeMap[mode[1]]}${modeMap[mode[2]]}`;
      } else {
        const match = mode.match(/^([ugoa]*)([\+\-\=])([rwx]+)$/);
        if (match) {
          const who = match[1] || 'a';
          const op = match[2];
          const perm = match[3];

          let u = targetNode.permissions.slice(0, 3).split('');
          let g = targetNode.permissions.slice(3, 6).split('');
          let o = targetNode.permissions.slice(6, 9).split('');

          const updateChar = (groupArr: string[], char: string, action: string) => {
            const idx = char === 'r' ? 0 : char === 'w' ? 1 : 2;
            if (action === '+') groupArr[idx] = char;
            else if (action === '-') groupArr[idx] = '-';
            else if (action === '=') groupArr[idx] = perm.includes(char) ? char : '-';
          };

          for (const char of ['r', 'w', 'x']) {
            if (perm.includes(char) || op === '=') {
              if (who.includes('u') || who.includes('a')) updateChar(u, char, op);
              if (who.includes('g') || who.includes('a')) updateChar(g, char, op);
              if (who.includes('o') || who.includes('a')) updateChar(o, char, op);
            }
          }
          targetNode.permissions = `${u.join('')}${g.join('')}${o.join('')}`;
        } else {
          targetNode.permissions = mode;
        }
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

  private bootTimestamp = Date.now();

  private generateProcNode(absPath: string): VFSNode | null {
    const cleanPath = absPath.replace(/\/proc\/self(\/|$)/, '/proc/100$1').replace(/\/$/, '') || '/proc';

    if (cleanPath === '/proc') {
      const childrenMap = new Map<string, VFSNode>();
      const createDummyChild = (name: string, type: 'file' | 'directory') => {
        childrenMap.set(name, {
          id: `proc_${name}`,
          name,
          type,
          permissions: type === 'directory' ? 'rwxr-xr-x' : 'r--r--r--',
          owner: 'root',
          group: 'root',
          size: 4096,
          updatedAt: new Date(),
          children: type === 'directory' ? new Map() : undefined,
          parent: this.root,
        });
      };

      ['cpuinfo', 'meminfo', 'version', 'uptime', 'mounts'].forEach((f) => createDummyChild(f, 'file'));
      ['self'].forEach((d) => createDummyChild(d, 'directory'));

      const processes = globalTaskScheduler ? globalTaskScheduler.getAllProcesses() : [];
      const pids = processes.length > 0 ? processes.map((p) => p.pid) : [1, 2, 3, 4, 100];
      pids.forEach((pid) => createDummyChild(pid.toString(), 'directory'));

      return {
        id: 'proc_root',
        name: 'proc',
        type: 'directory',
        permissions: 'rwxr-xr-x',
        owner: 'root',
        group: 'root',
        size: 4096,
        updatedAt: new Date(),
        children: childrenMap,
        parent: this.root,
      };
    }

    if (cleanPath === '/proc/version') {
      return {
        id: 'proc_version',
        name: 'version',
        type: 'file',
        permissions: 'r--r--r--',
        owner: 'root',
        group: 'root',
        size: 120,
        updatedAt: new Date(),
        content: 'Earendel POSIX WebOS version 1.0.0 (Native Pure TypeScript Microkernel) (gcc version 12.2.0) #1 SMP PREEMPT 2026\n',
        parent: this.root,
      };
    }

    if (cleanPath === '/proc/cpuinfo') {
      return {
        id: 'proc_cpuinfo',
        name: 'cpuinfo',
        type: 'file',
        permissions: 'r--r--r--',
        owner: 'root',
        group: 'root',
        size: 512,
        updatedAt: new Date(),
        content: `processor\t: 0\nvendor_id\t: EarendelCPU\ncpu family\t: 6\nmodel\t\t: 158\nmodel name\t: Earendel POSIX Microkernel Virtual CPU @ 3.60GHz\nstepping\t: 10\ncpu MHz\t\t: 3600.000\ncache size\t: 16384 KB\nbogomips\t: 7200.00\nflags\t\t: fpu vme de pse tsc msr pae mce cx8 apic sep mtrr pge mca cmov pat pse36 clflush mmx fxsr sse sse2 ht syscall nx lm constant_tsc rep_good nopl\n\n`,
        parent: this.root,
      };
    }

    if (cleanPath === '/proc/meminfo') {
      return {
        id: 'proc_meminfo',
        name: 'meminfo',
        type: 'file',
        permissions: 'r--r--r--',
        owner: 'root',
        group: 'root',
        size: 256,
        updatedAt: new Date(),
        content: `MemTotal:        4194304 kB\nMemFree:         3145728 kB\nMemAvailable:    3500000 kB\nBuffers:          131072 kB\nCached:           524288 kB\nSwapTotal:       1048576 kB\nSwapFree:        1048576 kB\n`,
        parent: this.root,
      };
    }

    if (cleanPath === '/proc/uptime') {
      const upSecs = Math.floor((Date.now() - this.bootTimestamp) / 1000);
      return {
        id: 'proc_uptime',
        name: 'uptime',
        type: 'file',
        permissions: 'r--r--r--',
        owner: 'root',
        group: 'root',
        size: 32,
        updatedAt: new Date(),
        content: `${upSecs}.00 ${Math.floor(upSecs * 0.9)}.00\n`,
        parent: this.root,
      };
    }

    if (cleanPath === '/proc/mounts') {
      return {
        id: 'proc_mounts',
        name: 'mounts',
        type: 'file',
        permissions: 'r--r--r--',
        owner: 'root',
        group: 'root',
        size: 128,
        updatedAt: new Date(),
        content: `/dev/root / ext4 rw,relatime 0 0\nproc /proc proc rw,nosuid,nodev,noexec,relatime 0 0\n`,
        parent: this.root,
      };
    }

    const procMatch = cleanPath.match(/^\/proc\/(\d+)(?:\/(status|cmdline|cwd|environ))?$/);
    if (procMatch) {
      const targetPid = parseInt(procMatch[1], 10);
      const subItem = procMatch[2];
      const pcb = globalTaskScheduler ? globalTaskScheduler.getProcess(targetPid) : null;

      const procName = pcb ? pcb.name : (targetPid === 1 ? 'init' : targetPid === 2 ? 'vfsd' : targetPid === 3 ? 'pmd' : targetPid === 4 ? 'driverd' : 'bash');
      const procUser = pcb ? pcb.user : 'hello';
      const procCwd = pcb ? pcb.cwd : '/home/hello';
      const procPpid = pcb ? pcb.ppid : 1;
      const vsz = pcb ? pcb.vszKB : 32000;
      const rss = pcb ? pcb.rssKB : 8000;

      if (!subItem) {
        const pcbChildren = new Map<string, VFSNode>();
        const mkProcChild = (n: string, t: 'file' | 'symlink') => {
          pcbChildren.set(n, {
            id: `proc_${targetPid}_${n}`,
            name: n,
            type: t,
            permissions: t === 'symlink' ? 'rwxrwxrwx' : 'r--r--r--',
            owner: procUser,
            group: procUser,
            size: 64,
            updatedAt: new Date(),
            parent: this.root,
          });
        };
        ['status', 'cmdline', 'environ'].forEach((f) => mkProcChild(f, 'file'));
        mkProcChild('cwd', 'symlink');

        return {
          id: `proc_${targetPid}`,
          name: targetPid.toString(),
          type: 'directory',
          permissions: 'r-xr-xr-x',
          owner: procUser,
          group: procUser,
          size: 4096,
          updatedAt: new Date(),
          children: pcbChildren,
          parent: this.root,
        };
      }

      if (subItem === 'status') {
        const content = `Name:\t${procName}\nUmask:\t0022\nState:\tS (sleeping)\nTgid:\t${targetPid}\nNgid:\t0\nPid:\t${targetPid}\nPPid:\t${procPpid}\nTracerPid:\t0\nUid:\t1000\t1000\t1000\t1000\nGid:\t1000\t1000\t1000\t1000\nFDSize:\t${pcb?.fds?.size || 64}\nGroups:\t1000\nVmSize:\t${vsz} kB\nVmRSS:\t${rss} kB\nThreads:\t1\n`;
        return {
          id: `proc_${targetPid}_status`,
          name: 'status',
          type: 'file',
          permissions: 'r--r--r--',
          owner: procUser,
          group: procUser,
          size: content.length,
          updatedAt: new Date(),
          content,
          parent: this.root,
        };
      }

      if (subItem === 'cmdline') {
        const content = `${procName}\0`;
        return {
          id: `proc_${targetPid}_cmdline`,
          name: 'cmdline',
          type: 'file',
          permissions: 'r--r--r--',
          owner: procUser,
          group: procUser,
          size: content.length,
          updatedAt: new Date(),
          content,
          parent: this.root,
        };
      }

      if (subItem === 'cwd') {
        return {
          id: `proc_${targetPid}_cwd`,
          name: 'cwd',
          type: 'symlink',
          permissions: 'rwxrwxrwx',
          owner: procUser,
          group: procUser,
          size: procCwd.length,
          updatedAt: new Date(),
          symlinkTarget: procCwd,
          parent: this.root,
        };
      }

      if (subItem === 'environ') {
        const content = `USER=${procUser}\nHOME=/home/${procUser}\nPATH=/bin:/usr/bin\nSHELL=/bin/bash\nTERM=xterm-256color\n`;
        return {
          id: `proc_${targetPid}_environ`,
          name: 'environ',
          type: 'file',
          permissions: 'r--r--r--',
          owner: procUser,
          group: procUser,
          size: content.length,
          updatedAt: new Date(),
          content,
          parent: this.root,
        };
      }
    }

    return null;
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
