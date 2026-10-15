import { globalIPCBus } from '../ipcBus';
import { globalVFS, VirtualFileSystem } from '../../core/vfs';
import { globalTaskScheduler } from '../taskScheduler';
import { FileDescriptor, IPCMessage, ProcessControlBlock } from '../types';
import { CapabilityType, globalCapabilityManager } from '../capability';
import { resolveProcessPath } from '../processPath';

export class VFSDaemonService {
  public static readonly PID = 2;
  public static readonly SERVICE_NAME = 'vfsd';
  public static readonly MAX_OPEN_FILES_PER_PROCESS = 256;
  private operationTails = new WeakMap<object, Promise<void>>();

  /** Serialize operations by shared identity (open descriptions or per-process tables). */
  private async withOperationLock<T>(key: object, operation: () => Promise<T>): Promise<T> {
    const previous = this.operationTails.get(key);
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.operationTails.set(key, current);
    if (previous) await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.operationTails.get(key) === current) this.operationTails.delete(key);
    }
  }

  constructor() {
    this.startServer();
  }

  public startServer() {
    globalIPCBus.registerService(
      VFSDaemonService.SERVICE_NAME,
      VFSDaemonService.PID,
      async (msg: IPCMessage) => this.handleIPCMessage(msg)
    );
  }

  private getPCB(pid: number): (ProcessControlBlock & { fds: Map<number, FileDescriptor> }) | null {
    const pcb = globalTaskScheduler.getProcess(pid);
    if (!pcb || pcb.state !== 'RUNNING') return null;
    if (!pcb.fds) {
      pcb.fds = new Map([
        [0, { fd: 0, path: '/dev/stdin', offset: 0, flags: 'r' }],
        [1, { fd: 1, path: '/dev/stdout', offset: 0, flags: 'w' }],
        [2, { fd: 2, path: '/dev/stderr', offset: 0, flags: 'w' }],
      ]);
    }
    return pcb as ProcessControlBlock & { fds: Map<number, FileDescriptor> };
  }

  private authorize(pid: number, capability: CapabilityType, path: string): boolean {
    return globalCapabilityManager.hasCapability(pid, capability, path);
  }

  private authorizeDeviceRead(pid: number, path: string): boolean {
    return path !== '/dev/ai' || globalCapabilityManager.hasCapability(pid, 'CAP_DEVICE_IO', '/dev/ai');
  }

  private resolvePath(path: unknown, pcb: ProcessControlBlock): string | null {
    const user = pcb.user || 'hello';
    const processPath = resolveProcessPath(path, pcb.cwd, globalVFS.getHomeDir(user));
    return processPath ? globalVFS.resolveSymlinkPath(processPath, true, user) : null;
  }

  private canTraverse(path: string, user: string): boolean {
    const parts = path.split('/').filter(Boolean);
    let directoryPath = '/';
    const root = globalVFS.getNodeByPath(directoryPath);
    if (!root || root.type !== 'directory' || !globalVFS.checkPermission(root, 'x', user)) return false;
    for (const part of parts.slice(0, -1)) {
      directoryPath = directoryPath === '/' ? `/${part}` : `${directoryPath}/${part}`;
      const directory = globalVFS.getNodeByPath(directoryPath);
      if (!directory || directory.type !== 'directory' || !globalVFS.checkPermission(directory, 'x', user)) return false;
    }
    return true;
  }

  private async writeDevice(pid: number, path: string, content: string): Promise<{ success: boolean; error?: string } | null> {
    if (!path.startsWith('/dev/')) return null;
    if (path === '/dev/null') return { success: true };
    const initialPcb = this.getPCB(pid);
    if (!initialPcb) return { success: false, error: `ESRCH: process ${pid} is not running` };
    if (!this.authorize(pid, 'CAP_VFS_WRITE', path) || !this.canTraverse(path, initialPcb.user || 'hello')) {
      return { success: false, error: `EACCES: PID ${pid} lost write authority for '${path}'` };
    }
    if (path === '/dev/skill') {
      return { success: false, error: 'EOPNOTSUPP: use the skill command with explicit permission grants' };
    }

    let service = 'driverd';
    let action = '';
    let payload: Record<string, unknown> = {};
    let devicePath = path;
    switch (path) {
      case '/dev/ai':
        action = 'DEV_WRITE_AI';
        payload = { prompt: content };
        break;
      case '/dev/net/fetch':
        service = 'netd';
        action = 'SYS_NET_FETCH';
        payload = { url: content.trim() };
        break;
      case '/dev/net/dns':
        service = 'netd';
        action = 'SYS_NET_RESOLVE';
        payload = { hostname: content.trim() };
        break;
      case '/dev/fb0':
        action = 'DEV_WRITE_FB0';
        payload = { color: content.trim() || '#000000' };
        break;
      case '/dev/ttyUSB0':
        action = 'DEV_WRITE_TTYUSB';
        payload = { data: content };
        break;
      case '/dev/dsp':
        action = 'DEV_WRITE_DSP';
        payload = { data: content };
        break;
      case '/dev/can0':
        action = 'DEV_GATEWAY_TUNNEL';
        payload = { url: content.trim() };
        break;
      default:
        return { success: false, error: `ENODEV: no write handler for '${path}'` };
    }

    if (service === 'driverd' && path !== '/dev/ai' &&
        !globalCapabilityManager.hasCapability(pid, 'CAP_DEVICE_IO', devicePath)) {
      return { success: false, error: `EACCES: PID ${pid} lacks CAP_DEVICE_IO for '${devicePath}'` };
    }

    try {
      const response = await globalIPCBus.sendIPC(globalIPCBus.getProcessEndpoint(pid), service, action, payload);
      const currentPcb = this.getPCB(pid);
      if (!currentPcb) return { success: false, error: `ESRCH: process ${pid} exited during device write` };
      if (!this.authorize(pid, 'CAP_VFS_WRITE', path) || !this.canTraverse(path, currentPcb.user || 'hello')) {
        return { success: false, error: `EACCES: PID ${pid} lost write authority for '${path}'` };
      }
      if (response?.error) return { success: false, error: response.error };
      if (path === '/dev/net/fetch') {
        if (!response?.ok) return { success: false, error: response?.error || 'EIO: network fetch failed' };
        const node = globalVFS.getNodeByPath(path);
        if (node?.type === 'file') node.content = response.body || '';
      } else if (path === '/dev/net/dns') {
        if (!response?.ip) return { success: false, error: response?.error || 'EHOSTUNREACH' };
        const node = globalVFS.getNodeByPath(path);
        if (node?.type === 'file') node.content = `${content.trim()} -> ${response.ip}\n`;
      } else if (path === '/dev/ai') {
        const node = globalVFS.getNodeByPath(path);
        if (node?.type === 'file' && response?.response) node.content = response.response;
      } else if (response?.success === false) {
        return { success: false, error: response.error || 'EIO: device write failed' };
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'EIO: device service unavailable' };
    }
  }

  private async handleIPCMessage(msg: IPCMessage): Promise<any> {
    const { action, payload } = msg;

    switch (action) {
      case 'SYS_OPEN': {
        const pcb = this.getPCB(msg.senderPid);
        if (!pcb) return { fd: undefined, error: 'ESRCH: Caller process is not running' };
        if (typeof payload?.path !== 'string' || !payload.path) return { fd: undefined, error: 'EINVAL: Missing path' };
        const requestedPath = payload.path;
        const rawFlags = payload?.flags;
        const rawMode = rawFlags === undefined || rawFlags === null || rawFlags === 0
          ? 'r'
          : rawFlags === 1
            ? 'w'
            : rawFlags === 2
              ? 'rw'
              : typeof rawFlags === 'string'
                ? rawFlags.toLowerCase()
                : '';
        if (!(['r', 'w', 'a', 'r+', 'w+', 'a+', 'rw'] as string[]).includes(rawMode)) {
          return { fd: undefined, error: 'EINVAL: Invalid open mode' };
        }
        return this.withOperationLock(pcb, async () => {
        if (this.getPCB(msg.senderPid) !== pcb) return { fd: undefined, error: 'ESRCH: Caller exited during open' };
        if (pcb.fds.size >= VFSDaemonService.MAX_OPEN_FILES_PER_PROCESS) {
          return { fd: undefined, error: `EMFILE: process open-file limit (${VFSDaemonService.MAX_OPEN_FILES_PER_PROCESS}) reached` };
        }
        const flags = rawMode as FileDescriptor['flags'];
        const path = this.resolvePath(requestedPath, pcb);
        if (!path) return { fd: undefined, error: 'EINVAL: Invalid or overlong path' };
        if (!this.canTraverse(path, pcb.user || 'hello')) return { fd: undefined, error: 'EACCES: Directory traversal denied' };
        const wantsRead = flags.includes('r') || flags.includes('+');
        const wantsWrite = flags !== 'r';
        if ((wantsRead || wantsWrite) && path === '/dev/ai' &&
            !globalCapabilityManager.hasCapability(msg.senderPid, 'CAP_DEVICE_IO', '/dev/ai')) {
          return { fd: undefined, error: 'EACCES: CAP_DEVICE_IO required for /dev/ai' };
        }
        if (wantsRead && !this.authorize(msg.senderPid, 'CAP_VFS_READ', path)) return { fd: undefined, error: 'EACCES: Capability denied for read' };
        if (wantsWrite && path !== '/dev/null' && !this.authorize(msg.senderPid, 'CAP_VFS_WRITE', path)) {
          return { fd: undefined, error: 'EACCES: Capability denied for write' };
        }
        let node = globalVFS.getNodeByPath(path);
        if (!node && wantsWrite) {
          const created = await globalVFS.writeFileAsync(path, '', pcb.user || 'hello', () => {
            const current = this.getPCB(msg.senderPid);
            return current === pcb && this.authorize(msg.senderPid, 'CAP_VFS_WRITE', path) &&
              this.canTraverse(path, current.user || 'hello');
          });
          if (!created) return { fd: undefined, error: 'EACCES: Cannot create file' };
          if (this.getPCB(msg.senderPid) !== pcb) return { fd: undefined, error: 'ESRCH: Caller exited during open' };
          node = globalVFS.getNodeByPath(path);
        }
        if (node?.type === 'directory') return { fd: undefined, error: 'EISDIR: Is a directory' };
        if (!node) return { fd: undefined, error: 'ENOENT: No such file' };
        if (node.type !== 'file') return { fd: undefined, error: 'ENXIO: Path is not a regular file' };
        if (wantsRead && !globalVFS.checkPermission(node, 'r', pcb.user || 'hello')) return { fd: undefined, error: 'EACCES: Permission denied' };
        if (wantsWrite && !globalVFS.checkPermission(node, 'w', pcb.user || 'hello')) return { fd: undefined, error: 'EACCES: Permission denied' };
        if (flags.startsWith('w') && !path.startsWith('/dev/')) {
          const truncated = await globalVFS.writeFileAsync(path, '', pcb.user || 'hello', () => {
            const current = this.getPCB(msg.senderPid);
            return current === pcb && this.authorize(msg.senderPid, 'CAP_VFS_WRITE', path) &&
              this.canTraverse(path, current.user || 'hello');
          });
          if (!truncated) return { fd: undefined, error: 'EACCES: Permission denied' };
          if (this.getPCB(msg.senderPid) !== pcb) return { fd: undefined, error: 'ESRCH: Caller exited during open' };
        }
        let nextFd = 3;
        while (pcb.fds.has(nextFd)) nextFd++;

        const fileDesc: FileDescriptor = {
          fd: nextFd,
          path,
          offset: flags.startsWith('a')
            ? new TextEncoder().encode(globalVFS.readFile(path, pcb.user || 'hello') ?? '').byteLength
            : 0,
          flags,
        };
        pcb.fds.set(nextFd, fileDesc);
        return { fd: nextFd, path: payload.path };
        });
      }

      case 'SYS_CLOSE': {
        if (!Number.isSafeInteger(payload?.fd) || payload.fd < 0) return { success: false, error: 'EBADF: Invalid file descriptor' };
        const pcb = this.getPCB(msg.senderPid);
        if (!pcb) return { success: false, error: 'ESRCH: Caller process is not running' };
        const ok = pcb.fds.delete(payload.fd);
        return { success: ok };
      }

      case 'SYS_STAT': {
        if (typeof payload?.path !== 'string' || !payload.path) {
          return { exists: false, error: 'EINVAL: Missing or invalid path' };
        }
        const pcb = this.getPCB(msg.senderPid);
        if (!pcb) return { exists: false, error: 'ESRCH: Caller process is not running' };
        const path = this.resolvePath(payload.path, pcb);
        if (!path) return { exists: false, error: 'EINVAL: Invalid or overlong path' };
        if (!this.canTraverse(path, pcb.user || 'hello')) return { exists: false, error: 'EACCES: Directory traversal denied' };
        if (!this.authorizeDeviceRead(msg.senderPid, path)) return { exists: false, error: 'EACCES: CAP_DEVICE_IO required for /dev/ai' };
        if (!this.authorize(msg.senderPid, 'CAP_VFS_READ', path)) return { exists: false, error: 'EACCES: Capability denied for stat' };
        const node = globalVFS.getNodeByPath(path);
        return {
          exists: !!node,
          type: node ? node.type : null,
          size: node ? node.size : 0,
          permissions: node ? node.permissions : '000',
        };
      }

      case 'SYS_READ': {
        if (!payload || typeof payload !== 'object') return { content: null, error: 'EINVAL: Invalid read request' };
        const pcb = this.getPCB(msg.senderPid);
        if (!pcb) return { content: null, error: 'ESRCH: Caller process is not running' };
        if (payload.fd !== undefined && typeof payload.fd !== 'number') {
          return { content: null, error: 'EINVAL: File descriptor must be numeric' };
        }
        if (typeof payload.fd === 'number') {
          if (!Number.isSafeInteger(payload.fd) || payload.fd < 0) return { content: null, error: 'EBADF: Invalid file descriptor' };
          const desc = pcb.fds.get(payload.fd);
          if (!desc) return { content: null, error: 'EBADF: Bad file descriptor' };
          return this.withOperationLock(desc, async () => {
          if (this.getPCB(msg.senderPid) !== pcb || pcb.fds.get(payload.fd as number) !== desc) return { content: null, error: 'EBADF: File descriptor was closed during read' };
          if (!desc.flags.includes('r') && !desc.flags.includes('+')) return { content: null, error: 'EBADF: File descriptor is not open for reading' };
          if (!this.authorizeDeviceRead(msg.senderPid, desc.path)) return { content: null, error: 'EACCES: CAP_DEVICE_IO required for /dev/ai' };
          if (!this.authorize(msg.senderPid, 'CAP_VFS_READ', desc.path)) return { content: null, error: 'EACCES: Capability denied for read' };
          if (!this.canTraverse(desc.path, pcb.user || 'hello')) return { content: null, error: 'EACCES: Directory traversal denied' };
          if (payload.count !== undefined && (!Number.isSafeInteger(payload.count) || payload.count < 0)) {
            return { content: null, error: 'EINVAL: Invalid read length' };
          }
          if (payload.count === 0) return { content: '', bytesRead: 0 };
          const fullContent = globalVFS.readFile(desc.path, pcb.user || 'hello');
          if (fullContent === null) {
            const currentNode = globalVFS.getResolvedNodeByPath(desc.path, pcb.user || 'hello');
            return currentNode
              ? { content: null, error: 'EACCES: File is no longer readable' }
              : { content: null, error: 'ENOENT: Open file no longer exists' };
          }
          const fileBytes = new TextEncoder().encode(fullContent);
          const endOffset = Math.min(fileBytes.byteLength, desc.offset + (payload.count ?? fileBytes.byteLength));
          const readBytes = fileBytes.subarray(desc.offset, endOffset);
          const readChunk = new TextDecoder().decode(readBytes);
          desc.offset += readBytes.byteLength;
          return { content: readChunk, bytesRead: readBytes.byteLength };
          });
        }
        if (typeof payload.path !== 'string' || !payload.path) return { content: null, error: 'EINVAL: Missing or invalid path' };
        const path = this.resolvePath(payload.path, pcb);
        if (!path) return { content: null, error: 'EINVAL: Invalid or overlong path' };
        if (!this.canTraverse(path, pcb.user || 'hello')) return { content: null, error: 'EACCES: Directory traversal denied' };
        if (!this.authorizeDeviceRead(msg.senderPid, path)) return { content: null, error: 'EACCES: CAP_DEVICE_IO required for /dev/ai' };
        if (!this.authorize(msg.senderPid, 'CAP_VFS_READ', path)) return { content: null, error: 'EACCES: Capability denied for read' };
        const node = globalVFS.getResolvedNodeByPath(path, pcb.user || 'hello');
        if (node?.type === 'directory') return { content: null, error: 'EISDIR: Is a directory' };
        if (!node) return { content: null, error: 'ENOENT: No such file' };
        if (!globalVFS.checkPermission(node, 'r', pcb.user || 'hello')) return { content: null, error: 'EACCES: Permission denied' };
        const content = globalVFS.readFile(path, pcb.user || 'hello');
        return content === null
          ? { content: null, error: 'EIO: VFS read failed' }
          : { content };
      }

      case 'SYS_WRITE': {
        if (typeof payload?.content !== 'string') return { success: false, error: 'EINVAL: Write content must be a string' };
        if (payload.content.length > VirtualFileSystem.MAX_FILE_BYTES) {
          return { success: false, error: `EFBIG: File write exceeds ${VirtualFileSystem.MAX_FILE_BYTES} bytes` };
        }
        const encodedWrite = new TextEncoder().encode(payload.content);
        if (encodedWrite.byteLength > VirtualFileSystem.MAX_FILE_BYTES) {
          return { success: false, error: `EFBIG: File write exceeds ${VirtualFileSystem.MAX_FILE_BYTES} bytes` };
        }
        if (typeof payload.fd === 'number') {
          if (!Number.isSafeInteger(payload.fd) || payload.fd < 0) return { success: false, error: 'EBADF: Invalid file descriptor' };
          const pcb = this.getPCB(msg.senderPid);
          if (!pcb) return { success: false, error: 'ESRCH: Caller process is not running' };
          const desc = pcb.fds.get(payload.fd);
          if (!desc) return { success: false, error: 'EBADF: Bad file descriptor' };
          return this.withOperationLock(desc, async () => {
            if (this.getPCB(msg.senderPid) !== pcb || pcb.fds.get(payload.fd) !== desc) {
              return { success: false, error: 'EBADF: File descriptor was closed during write' };
            }
            if (!desc.flags.includes('w') && !desc.flags.includes('a') && !desc.flags.includes('+')) return { success: false, error: 'EBADF: File descriptor is not open for writing' };
            if (desc.path !== '/dev/null' && !this.authorize(msg.senderPid, 'CAP_VFS_WRITE', desc.path)) {
              return { success: false, error: 'EACCES: Capability denied for write' };
            }
            if (!this.canTraverse(desc.path, pcb.user || 'hello')) return { success: false, error: 'EACCES: Directory traversal denied' };
            if (encodedWrite.byteLength === 0) return { success: true, bytesWritten: 0 };
            const deviceResult = await this.writeDevice(msg.senderPid, desc.path, payload.content);
            const currentPcb = this.getPCB(msg.senderPid);
            if (!currentPcb) return { success: false, error: `ESRCH: process ${msg.senderPid} exited during write` };
            if (currentPcb.fds.get(payload.fd) !== desc) return { success: false, error: 'EBADF: File descriptor was closed during write' };
            if (desc.path !== '/dev/null' && !this.authorize(msg.senderPid, 'CAP_VFS_WRITE', desc.path)) {
              return { success: false, error: 'EACCES: Capability denied for write' };
            }
            if (!this.canTraverse(desc.path, currentPcb.user || 'hello')) return { success: false, error: 'EACCES: Directory traversal denied' };
            if (deviceResult) {
              const bytesWritten = encodedWrite.byteLength;
              if (deviceResult.success && desc.flags.startsWith('a')) desc.offset += bytesWritten;
              return { ...deviceResult, bytesWritten: deviceResult.success ? bytesWritten : undefined };
            }
            const node = globalVFS.getNodeByPath(desc.path);
            if (!node || node.type !== 'file') return { success: false, error: 'ENOENT: Open file no longer exists' };
            const fullBytes = new TextEncoder().encode(node.content ?? '');
            const writeBytes = encodedWrite;
            let nextOffset: number;
            let updatedBytes: Uint8Array;
            if (desc.flags.startsWith('a')) {
              if (writeBytes.byteLength > VirtualFileSystem.MAX_FILE_BYTES - fullBytes.byteLength) {
                return { success: false, error: `EFBIG: File write exceeds ${VirtualFileSystem.MAX_FILE_BYTES} bytes` };
              }
              updatedBytes = new Uint8Array(fullBytes.byteLength + writeBytes.byteLength);
              updatedBytes.set(fullBytes);
              updatedBytes.set(writeBytes, fullBytes.byteLength);
              nextOffset = updatedBytes.byteLength;
            } else {
              const endOffset = desc.offset + writeBytes.byteLength;
              if (!Number.isSafeInteger(endOffset) || endOffset > VirtualFileSystem.MAX_FILE_BYTES) {
                return { success: false, error: `EFBIG: File write exceeds ${VirtualFileSystem.MAX_FILE_BYTES} bytes` };
              }
              updatedBytes = new Uint8Array(Math.max(fullBytes.byteLength, endOffset));
              updatedBytes.set(fullBytes);
              updatedBytes.set(writeBytes, desc.offset);
              nextOffset = desc.offset + writeBytes.byteLength;
            }
            const nextContent = new TextDecoder().decode(updatedBytes);
            const ok = await globalVFS.writeFileAsync(desc.path, nextContent, currentPcb.user || 'hello', () => {
              const latestPcb = this.getPCB(msg.senderPid);
              return latestPcb === currentPcb && latestPcb.fds.get(payload.fd) === desc &&
                this.authorize(msg.senderPid, 'CAP_VFS_WRITE', desc.path) &&
                this.canTraverse(desc.path, latestPcb.user || 'hello');
            });
            if (this.getPCB(msg.senderPid) !== currentPcb) return { success: false, error: `ESRCH: process ${msg.senderPid} exited during write` };
            if (currentPcb.fds.get(payload.fd) !== desc) return { success: false, error: 'EBADF: File descriptor was closed during write' };
            if (!this.authorize(msg.senderPid, 'CAP_VFS_WRITE', desc.path)) return { success: false, error: 'EACCES: Capability denied for write' };
            if (ok) desc.offset = nextOffset;
            return { success: ok, bytesWritten: ok ? writeBytes.byteLength : undefined };
          });
        }
        const pcb = this.getPCB(msg.senderPid);
        if (!pcb) return { success: false, error: 'ESRCH: Caller process is not running' };
        if (typeof payload?.path !== 'string' || !payload.path) return { success: false, error: 'EINVAL: Missing path' };
        const path = this.resolvePath(payload.path, pcb);
        if (!path) return { success: false, error: 'EINVAL: Invalid or overlong path' };
        if (!this.canTraverse(path, pcb.user || 'hello')) return { success: false, error: 'EACCES: Directory traversal denied' };
        if (path !== '/dev/null' && !this.authorize(msg.senderPid, 'CAP_VFS_WRITE', path)) {
          return { success: false, error: 'EACCES: Capability denied for write' };
        }
        const deviceResult = await this.writeDevice(msg.senderPid, path, payload.content);
        const currentPcb = this.getPCB(msg.senderPid);
        if (!currentPcb) return { success: false, error: `ESRCH: process ${msg.senderPid} exited during write` };
        if (path !== '/dev/null' && !this.authorize(msg.senderPid, 'CAP_VFS_WRITE', path)) {
          return { success: false, error: 'EACCES: Capability denied for write' };
        }
        if (!this.canTraverse(path, currentPcb.user || 'hello')) return { success: false, error: 'EACCES: Directory traversal denied' };
        if (deviceResult) return deviceResult;
        const content = payload.content || '';
        const ok = await globalVFS.writeFileAsync(path, content, currentPcb.user || 'hello', () => {
          const latestPcb = this.getPCB(msg.senderPid);
          return latestPcb === currentPcb && this.authorize(msg.senderPid, 'CAP_VFS_WRITE', path) &&
            this.canTraverse(path, latestPcb.user || 'hello');
        });
        if (this.getPCB(msg.senderPid) !== currentPcb) return { success: false, error: `ESRCH: process ${msg.senderPid} exited during write` };
        if (!this.authorize(msg.senderPid, 'CAP_VFS_WRITE', path)) return { success: false, error: 'EACCES: Capability denied for write' };
        return {
          success: ok,
          bytesWritten: ok ? encodedWrite.byteLength : undefined,
          error: ok ? undefined : 'EACCES: Write failed',
        };
      }

      case 'SYS_LSEEK': {
        if (!Number.isSafeInteger(payload?.fd) || payload.fd < 0) return { offset: -1, error: 'EBADF: Invalid file descriptor' };
        const pcb = this.getPCB(msg.senderPid);
        if (!pcb) return { offset: -1, error: 'ESRCH: Caller process is not running' };
        const desc = pcb.fds.get(payload.fd);
        if (!desc) return { offset: -1, error: 'EBADF: Bad file descriptor' };
        return this.withOperationLock(desc, async () => {
        if (this.getPCB(msg.senderPid) !== pcb || pcb.fds.get(payload.fd) !== desc) return { offset: -1, error: 'EBADF: File descriptor was closed during seek' };
        const canRead = (desc.flags.includes('r') || desc.flags.includes('+')) && this.authorize(msg.senderPid, 'CAP_VFS_READ', desc.path);
        const canWrite = (desc.flags.includes('w') || desc.flags.includes('a') || desc.flags.includes('+')) && this.authorize(msg.senderPid, 'CAP_VFS_WRITE', desc.path);
        if (!canRead && !canWrite) return { offset: -1, error: 'EACCES: Capability denied for seek' };
        if (!this.canTraverse(desc.path, pcb.user || 'hello')) return { offset: -1, error: 'EACCES: Directory traversal denied' };
        if (!Number.isSafeInteger(payload.offset) || ![0, 1, 2].includes(payload.whence ?? 0)) return { offset: -1, error: 'EINVAL: Invalid seek offset or origin' };
        const node = globalVFS.getResolvedNodeByPath(desc.path, pcb.user || 'hello');
        if (node?.type === 'directory') return { offset: -1, error: 'EISDIR: Cannot seek a directory descriptor' };
        if (!node || node.type !== 'file') return { offset: -1, error: 'EBADF: Descriptor is not seekable' };
        // This VFS models device nodes as files in the tree, but character
        // devices do not have regular-file offsets (for example tty and audio).
        if (desc.path === '/dev' || desc.path.startsWith('/dev/')) {
          return { offset: -1, error: 'ESPIPE: Cannot seek a device descriptor' };
        }
        const fileSize = node.size;
        const whence = payload.whence ?? 0; // 0=SEEK_SET, 1=SEEK_CUR, 2=SEEK_END
        const nextOffset = whence === 0
          ? payload.offset
          : whence === 1
            ? desc.offset + payload.offset
            : fileSize + payload.offset;
        if (!Number.isSafeInteger(nextOffset) || nextOffset < 0) return { offset: -1, error: 'EINVAL: Resulting offset is invalid' };
        desc.offset = nextOffset;
        return { offset: desc.offset };
        });
      }

      default:
        throw new Error(`[vfsd Error] Unknown action '${action}' received.`);
    }
  }
}

export const globalVFSDaemon = new VFSDaemonService();
