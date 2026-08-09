// Earendel User-space VFS Daemon Server (vfsd)
import { globalIPCBus } from '../ipcBus';
import { globalVFS } from '../../core/vfs';
import { IPCMessage } from '../types';

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

  private async handleIPCMessage(msg: IPCMessage): Promise<any> {
    const { action, payload } = msg;

    switch (action) {
      case 'SYS_OPEN':
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
        const content = globalVFS.readFile(payload.path);
        return { content };
      }

      case 'SYS_WRITE': {
        const ok = globalVFS.writeFile(payload.path, payload.content || '');
        return { success: ok };
      }

      default:
        throw new Error(`[vfsd Error] Unknown action '${action}' received.`);
    }
  }
}

export const globalVFSDaemon = new VFSDaemonService();
