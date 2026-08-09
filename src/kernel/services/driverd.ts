// Earendel User-space Device Driver Daemon Server (driverd)
import { globalIPCBus } from '../ipcBus';
import { globalFramebufferEngine } from '../../core/framebufferEngine';
import { IPCMessage } from '../types';

export class DriverDaemonService {
  public static readonly PID = 4;
  public static readonly SERVICE_NAME = 'driverd';

  constructor() {
    this.startServer();
  }

  public startServer() {
    globalIPCBus.registerService(
      DriverDaemonService.SERVICE_NAME,
      DriverDaemonService.PID,
      async (msg: IPCMessage) => this.handleIPCMessage(msg)
    );
  }

  private async handleIPCMessage(msg: IPCMessage): Promise<any> {
    const { action, payload } = msg;

    switch (action) {
      case 'DEV_READ_NULL':
        return { data: '' };

      case 'DEV_READ_ZERO':
        return { data: '\0\0\0\0\0\0\0\0' };

      case 'DEV_WRITE_FB0':
        globalFramebufferEngine.clearScreen(payload.color || '#000000');
        return { success: true, device: '/dev/fb0' };

      case 'DEV_GET_DISPLAY_INFO':
        return {
          device: '/dev/fb0',
          width: 640,
          height: 480,
          bpp: 32,
          colorFormat: 'RGBA',
          isOpen: globalFramebufferEngine.getIsOpen(),
        };

      default:
        throw new Error(`[driverd Error] Unknown device driver action '${action}' received.`);
    }
  }
}

export const globalDriverDaemon = new DriverDaemonService();
