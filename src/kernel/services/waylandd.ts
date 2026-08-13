// Earendel Microkernel Wayland Display Compositor Service Daemon (waylandd - PID 7)
import { globalIPCBus } from '../ipcBus';
import { IPCMessage } from '../types';
import { globalFramebufferEngine } from '../../core/framebufferEngine';

export interface WaylandSurface {
  id: string;
  title: string;
  width: number;
  height: number;
  x: number;
  y: number;
  zIndex: number;
  mode: 'web_native' | 'framebuffer_wasm';
  focused: boolean;
  minimized: boolean;
  maximized: boolean;
}

export class WaylandCompositorDaemon {
  public static readonly PID = 7;
  public static readonly SERVICE_NAME = 'waylandd';

  private surfaces: Map<string, WaylandSurface> = new Map();
  private topZIndex: number = 100;

  constructor() {
    this.initService();
  }

  private initService() {
    globalIPCBus.registerService(
      WaylandCompositorDaemon.SERVICE_NAME,
      WaylandCompositorDaemon.PID,
      async (msg: IPCMessage) => this.handleIPCMessage(msg)
    );
  }

  private async handleIPCMessage(msg: IPCMessage): Promise<any> {
    const { action, payload } = msg;

    switch (action) {
      case 'SYS_WAYLAND_CREATE_SURFACE': {
        const id = payload?.id || `surf_${Math.random().toString(36).substring(2, 9)}`;
        this.topZIndex += 1;
        const surface: WaylandSurface = {
          id,
          title: payload?.title || 'Earendel Wayland Surface',
          width: payload?.width || 800,
          height: payload?.height || 600,
          x: payload?.x || 100,
          y: payload?.y || 80,
          zIndex: this.topZIndex,
          mode: payload?.mode || 'web_native',
          focused: true,
          minimized: false,
          maximized: false,
        };
        this.surfaces.set(id, surface);
        try {
          globalFramebufferEngine.clearScreen('#0f172a');
        } catch (_) {}
        return { success: true, surface };
      }

      case 'SYS_WAYLAND_DESTROY_SURFACE': {
        const id = payload?.id;
        let removed = false;
        if (!id || id === 'all') {
          this.surfaces.clear();
          removed = true;
        } else {
          removed = this.surfaces.delete(id);
        }
        if (this.surfaces.size === 0) {
          try {
            globalFramebufferEngine.closeWindow();
          } catch (_) {}
        }
        return { success: removed, surfaceId: id };
      }

      case 'SYS_WAYLAND_FOCUS_SURFACE': {
        const id = payload?.id;
        const surface = this.surfaces.get(id);
        if (surface) {
          this.topZIndex += 1;
          surface.zIndex = this.topZIndex;
          this.surfaces.forEach((s) => (s.focused = s.id === id));
          return { success: true, surface };
        }
        return { success: false, error: 'Surface not found' };
      }

      case 'SYS_WAYLAND_LIST_SURFACES': {
        return {
          compositor: 'Earendel Wayland Display Server 1.24.0',
          surfaces: Array.from(this.surfaces.values()),
          activeCount: this.surfaces.size,
        };
      }

      case 'SYS_WAYLAND_FLUSH_FRAMEBUFFER': {
        try {
          if (payload?.pixels && Array.isArray(payload.pixels)) {
            globalFramebufferEngine.drawPixelBuffer(payload.pixels);
          } else {
            globalFramebufferEngine.openWindow();
          }
        } catch (_) {}
        return {
          success: true,
          device: '/dev/fb0',
          compositedBytes: payload?.bytesWritten || 1228800,
          fps: 60,
        };
      }

      default:
        return { error: `[waylandd Error] Unknown action: ${action}` };
    }
  }
}

export const globalWaylandDaemon = new WaylandCompositorDaemon();
