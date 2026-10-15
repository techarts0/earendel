import { globalIPCBus } from '../ipcBus';
import { globalVFS } from '../../core/vfs';
import { globalTaskScheduler } from '../taskScheduler';
import { FileDescriptor, IPCMessage, ProcessControlBlock } from '../types';
import { CapabilityType, globalCapabilityManager } from '../capability';

export class VFSDaemonService {
  public static readonly PID = 2;
  public static readonly SERVICE_NAME = 'vfsd';

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
        const flags: FileDescriptor['flags'] = rawFlags === 0 ? 'r' : rawFlags === 1 ? 'w' : rawFlags === 2 ? 'rw' : String(rawFlags || 'r') as FileDescriptor['flags'];
        if (!['r', 'w', 'a', 'r+', 'w+', 'a+', 'rw'].includes(flags)) {
          return { fd: undefined, error: 'EINVAL: Invalid open mode' };
        }
        const path = globalVFS.resolvePath(requestedPath, pcb.user || 'hello');
        if (!this.canTraverse(path, pcb.user || 'hello')) return { fd: undefined, error: 'EACCES: Directory traversal denied' };
        const wantsRead = flags.includes('r') || flags.includes('+');
        const wantsWrite = flags !== 'r';
        if (wantsRead && !this.authorize(msg.senderPid, 'CAP_VFS_READ', path)) return { fd: undefined, error: 'EACCES: Capability denied for read' };
        if (wantsWrite && path !== '/dev/null' && !this.authorize(msg.senderPid, 'CAP_VFS_WRITE', path)) {
          return { fd: undefined, error: 'EACCES: Capability denied for write' };
        }
        let node = globalVFS.getNodeByPath(path);
        if (!node && wantsWrite) {
          if (!globalVFS.writeFile(path, '', pcb.user || 'hello')) return { fd: undefined, error: 'EACCES: Cannot create file' };
          node = globalVFS.getNodeByPath(path);
        }
        if (!node || node.type !== 'file') return { fd: undefined, error: 'ENOENT: No such file' };
        if (wantsRead && !globalVFS.checkPermission(node, 'r', pcb.user || 'hello')) return { fd: undefined, error: 'EACCES: Permission denied' };
        if (wantsWrite && !globalVFS.checkPermission(node, 'w', pcb.user || 'hello')) return { fd: undefined, error: 'EACCES: Permission denied' };
        if (flags.startsWith('w') && !path.startsWith('/dev/') && !globalVFS.writeFile(path, '', pcb.user || 'hello')) {
          return { fd: undefined, error: 'EACCES: Permission denied' };
        }
        let nextFd = 3;
        while (pcb.fds.has(nextFd)) nextFd++;

        const fileDesc: FileDescriptor = {
          fd: nextFd,
          path,
          offset: flags.startsWith('a') ? (globalVFS.readFile(path, pcb.user || 'hello')?.length ?? 0) : 0,
          flags,
        };
        pcb.fds.set(nextFd, fileDesc);
        return { fd: nextFd, path: payload.path };
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
        const path = globalVFS.resolvePath(payload.path, pcb.user || 'hello');
        if (!this.canTraverse(path, pcb.user || 'hello')) return { exists: false, error: 'EACCES: Directory traversal denied' };
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
          if (!desc.flags.includes('r') && !desc.flags.includes('+')) return { content: null, error: 'EBADF: File descriptor is not open for reading' };
          if (!this.authorize(msg.senderPid, 'CAP_VFS_READ', desc.path)) return { content: null, error: 'EACCES: Capability denied for read' };
          if (!this.canTraverse(desc.path, pcb.user || 'hello')) return { content: null, error: 'EACCES: Directory traversal denied' };
          if (payload.count !== undefined && (!Number.isSafeInteger(payload.count) || payload.count < 0)) {
            return { content: null, error: 'EINVAL: Invalid read length' };
          }
          const fullContent = globalVFS.readFile(desc.path, pcb.user || 'hello') ?? '';
          const count = payload.count === undefined ? fullContent.length : payload.count;
          const readChunk = fullContent.slice(desc.offset, desc.offset + count);
          desc.offset += readChunk.length;
          return { content: readChunk, bytesRead: readChunk.length };
        }
        if (typeof payload.path !== 'string' || !payload.path) return { content: null, error: 'EINVAL: Missing or invalid path' };
        const path = globalVFS.resolvePath(payload.path, pcb.user || 'hello');
        if (!this.canTraverse(path, pcb.user || 'hello')) return { content: null, error: 'EACCES: Directory traversal denied' };
        if (!this.authorize(msg.senderPid, 'CAP_VFS_READ', path)) return { content: null, error: 'EACCES: Capability denied for read' };
        const content = globalVFS.readFile(path, pcb.user || 'hello');
        return content === null ? { content: null, error: 'ENOENT: No such file' } : { content };
      }

      case 'SYS_WRITE': {
        if (typeof payload?.content !== 'string') return { success: false, error: 'EINVAL: Write content must be a string' };
        if (typeof payload.fd === 'number') {
          if (!Number.isSafeInteger(payload.fd) || payload.fd < 0) return { success: false, error: 'EBADF: Invalid file descriptor' };
          const pcb = this.getPCB(msg.senderPid);
          if (!pcb) return { success: false, error: 'ESRCH: Caller process is not running' };
          const desc = pcb.fds.get(payload.fd);
          if (!desc) return { success: false, error: 'EBADF: Bad file descriptor' };
          if (!desc.flags.includes('w') && !desc.flags.includes('a') && !desc.flags.includes('+')) return { success: false, error: 'EBADF: File descriptor is not open for writing' };
          if (desc.path !== '/dev/null' && !this.authorize(msg.senderPid, 'CAP_VFS_WRITE', desc.path)) {
            return { success: false, error: 'EACCES: Capability denied for write' };
          }
          if (!this.canTraverse(desc.path, pcb.user || 'hello')) return { success: false, error: 'EACCES: Directory traversal denied' };
          const deviceResult = await this.writeDevice(msg.senderPid, desc.path, payload.content);
          if (deviceResult) {
            if (deviceResult.success && desc.flags.startsWith('a')) desc.offset += payload.content.length;
            return deviceResult;
          }
          const node = globalVFS.getNodeByPath(desc.path);
          if (!node || node.type !== 'file') return { success: false, error: 'ENOENT: Open file no longer exists' };
          let fullContent = node.content ?? '';
          const writeStr = payload.content;
          if (desc.flags.startsWith('a')) {
            fullContent += writeStr;
            desc.offset = fullContent.length;
          } else {
            if (desc.offset > fullContent.length) fullContent = fullContent.padEnd(desc.offset, '\0');
            fullContent = fullContent.slice(0, desc.offset) + writeStr + fullContent.slice(desc.offset + writeStr.length);
            desc.offset += writeStr.length;
          }
          const ok = globalVFS.writeFile(desc.path, fullContent, pcb.user || 'hello');
          return { success: ok, bytesWritten: writeStr.length };
        }
        const pcb = this.getPCB(msg.senderPid);
        if (!pcb) return { success: false, error: 'ESRCH: Caller process is not running' };
        if (typeof payload?.path !== 'string' || !payload.path) return { success: false, error: 'EINVAL: Missing path' };
        const path = globalVFS.resolvePath(payload.path, pcb.user || 'hello');
        if (!this.canTraverse(path, pcb.user || 'hello')) return { success: false, error: 'EACCES: Directory traversal denied' };
        if (path !== '/dev/null' && !this.authorize(msg.senderPid, 'CAP_VFS_WRITE', path)) {
          return { success: false, error: 'EACCES: Capability denied for write' };
        }
        const deviceResult = await this.writeDevice(msg.senderPid, path, payload.content);
        if (deviceResult) return deviceResult;
        const ok = globalVFS.writeFile(path, payload.content || '', pcb.user || 'hello');
        return { success: ok, error: ok ? undefined : 'EACCES: Write failed' };
      }

      case 'SYS_LSEEK': {
        if (!Number.isSafeInteger(payload?.fd) || payload.fd < 0) return { offset: -1, error: 'EBADF: Invalid file descriptor' };
        const pcb = this.getPCB(msg.senderPid);
        if (!pcb) return { offset: -1, error: 'ESRCH: Caller process is not running' };
        const desc = pcb.fds.get(payload.fd);
        if (!desc) return { offset: -1, error: 'EBADF: Bad file descriptor' };
        const canRead = (desc.flags.includes('r') || desc.flags.includes('+')) && this.authorize(msg.senderPid, 'CAP_VFS_READ', desc.path);
        const canWrite = (desc.flags.includes('w') || desc.flags.includes('a') || desc.flags.includes('+')) && this.authorize(msg.senderPid, 'CAP_VFS_WRITE', desc.path);
        if (!canRead && !canWrite) return { offset: -1, error: 'EACCES: Capability denied for seek' };
        if (!this.canTraverse(desc.path, pcb.user || 'hello')) return { offset: -1, error: 'EACCES: Directory traversal denied' };
        if (!Number.isSafeInteger(payload.offset) || ![0, 1, 2].includes(payload.whence ?? 0)) return { offset: -1, error: 'EINVAL: Invalid seek offset or origin' };
        const fileSize = globalVFS.getNodeByPath(desc.path)?.size ?? 0;
        const whence = payload.whence ?? 0; // 0=SEEK_SET, 1=SEEK_CUR, 2=SEEK_END
        const nextOffset = whence === 0
          ? payload.offset
          : whence === 1
            ? desc.offset + payload.offset
            : fileSize + payload.offset;
        if (!Number.isSafeInteger(nextOffset) || nextOffset < 0) return { offset: -1, error: 'EINVAL: Resulting offset is invalid' };
        desc.offset = nextOffset;
        return { offset: desc.offset };
      }

      default:
        throw new Error(`[vfsd Error] Unknown action '${action}' received.`);
    }
  }
}

export const globalVFSDaemon = new VFSDaemonService();
