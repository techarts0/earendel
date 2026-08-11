import { globalIPCBus } from '../ipcBus';
import { globalVFS } from '../../core/vfs';
import { globalTaskScheduler } from '../taskScheduler';
import { FileDescriptor, IPCMessage, ProcessControlBlock } from '../types';

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

  private getPCB(pid: number): ProcessControlBlock & { fds: Map<number, FileDescriptor> } {
    let pcb = globalTaskScheduler.getProcess(pid);
    if (!pcb) {
      pcb = globalTaskScheduler.createProcess({
        pid,
        ppid: 1,
        name: `proc_${pid}`,
        user: 'hello',
        state: 'RUNNING',
        startTime: new Date(),
        vszKB: 32000,
        rssKB: 8000,
        cpuUsagePercent: 0.1,
        cwd: '/home/hello',
        fds: new Map([
          [0, { fd: 0, path: '/dev/stdin', offset: 0, flags: 'r' }],
          [1, { fd: 1, path: '/dev/stdout', offset: 0, flags: 'w' }],
          [2, { fd: 2, path: '/dev/stderr', offset: 0, flags: 'w' }],
        ]),
      });
    }
    if (!pcb.fds) {
      pcb.fds = new Map([
        [0, { fd: 0, path: '/dev/stdin', offset: 0, flags: 'r' }],
        [1, { fd: 1, path: '/dev/stdout', offset: 0, flags: 'w' }],
        [2, { fd: 2, path: '/dev/stderr', offset: 0, flags: 'w' }],
      ]);
    }
    return pcb as ProcessControlBlock & { fds: Map<number, FileDescriptor> };
  }

  private async handleIPCMessage(msg: IPCMessage): Promise<any> {
    const { action, payload } = msg;

    switch (action) {
      case 'SYS_OPEN': {
        const pcb = this.getPCB(msg.senderPid);
        let nextFd = 3;
        while (pcb.fds.has(nextFd)) nextFd++;

        const flags = payload.flags || 'r';
        const fileDesc: FileDescriptor = {
          fd: nextFd,
          path: payload.path,
          offset: flags === 'a' ? (globalVFS.readFile(payload.path)?.length ?? 0) : 0,
          flags,
        };
        pcb.fds.set(nextFd, fileDesc);
        return { fd: nextFd, path: payload.path };
      }

      case 'SYS_CLOSE': {
        const pcb = this.getPCB(msg.senderPid);
        const ok = pcb.fds.delete(payload.fd);
        return { success: ok };
      }

      case 'SYS_STAT': {
        const node = globalVFS.getNodeByPath(payload.path);
        return {
          exists: !!node,
          type: node ? node.type : null,
          size: node ? node.size : 0,
          permissions: node ? node.permissions : '000',
        };
      }

      case 'SYS_READ': {
        if (typeof payload.fd === 'number') {
          const pcb = this.getPCB(msg.senderPid);
          const desc = pcb.fds.get(payload.fd);
          if (!desc) return { content: null, error: 'EBADF: Bad file descriptor' };
          const fullContent = globalVFS.readFile(desc.path) ?? '';
          const count = typeof payload.count === 'number' ? payload.count : fullContent.length;
          const readChunk = fullContent.slice(desc.offset, desc.offset + count);
          desc.offset += readChunk.length;
          return { content: readChunk, bytesRead: readChunk.length };
        }
        const content = globalVFS.readFile(payload.path);
        return { content };
      }

      case 'SYS_WRITE': {
        if (typeof payload.fd === 'number') {
          const pcb = this.getPCB(msg.senderPid);
          const desc = pcb.fds.get(payload.fd);
          if (!desc) return { success: false, error: 'EBADF: Bad file descriptor' };
          let fullContent = globalVFS.readFile(desc.path) ?? '';
          const writeStr = payload.content || '';
          if (desc.flags === 'a') {
            fullContent += writeStr;
            desc.offset = fullContent.length;
          } else {
            fullContent = fullContent.slice(0, desc.offset) + writeStr + fullContent.slice(desc.offset + writeStr.length);
            desc.offset += writeStr.length;
          }
          const ok = globalVFS.writeFile(desc.path, fullContent);
          return { success: ok, bytesWritten: writeStr.length };
        }
        const ok = globalVFS.writeFile(payload.path, payload.content || '');
        return { success: ok };
      }

      case 'SYS_LSEEK': {
        const pcb = this.getPCB(msg.senderPid);
        const desc = pcb.fds.get(payload.fd);
        if (!desc) return { offset: -1, error: 'EBADF: Bad file descriptor' };
        const fileSize = globalVFS.readFile(desc.path)?.length ?? 0;
        const whence = payload.whence ?? 0; // 0=SEEK_SET, 1=SEEK_CUR, 2=SEEK_END
        if (whence === 0) desc.offset = payload.offset;
        else if (whence === 1) desc.offset += payload.offset;
        else if (whence === 2) desc.offset = fileSize + payload.offset;
        if (desc.offset < 0) desc.offset = 0;
        return { offset: desc.offset };
      }

      default:
        throw new Error(`[vfsd Error] Unknown action '${action}' received.`);
    }
  }
}

export const globalVFSDaemon = new VFSDaemonService();
