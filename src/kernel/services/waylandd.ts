// Earendel Microkernel Wayland Display Compositor Service Daemon (waylandd - PID 7)
import { globalIPCBus } from '../ipcBus';
import { IPCMessage } from '../types';
import { globalFramebufferEngine } from '../../core/framebufferEngine';
import { globalCapabilityManager } from '../capability';
import { globalTaskScheduler } from '../taskScheduler';

export interface WaylandSurface {
  id: string;
  ownerPid: number;
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
    globalIPCBus.onProcessExit((pid) => this.removeClientSurfaces(pid));
    this.initService();
  }

  private removeClientSurfaces(pid: number): void {
    let removedAny = false;
    for (const [id, surface] of this.surfaces) {
      if (surface.ownerPid !== pid) continue;
      this.surfaces.delete(id);
      removedAny = true;
    }
    if (removedAny && this.surfaces.size === 0) {
      try { globalFramebufferEngine.closeWindow(); } catch (_) {}
    }
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
    this.pruneExitedClients();
    const caller = globalTaskScheduler.getProcess(msg.senderPid);
    if (!caller || caller.state !== 'RUNNING') return { success: false, error: 'ESRCH: inactive Wayland client' };
    const isAdmin = globalCapabilityManager.hasCapability(msg.senderPid, 'CAP_SYS_ADMIN');
    const owns = (id: unknown): id is string => typeof id === 'string' && this.surfaces.get(id)?.ownerPid === msg.senderPid;

    switch (action) {
      case 'SYS_WAYLAND_CREATE_SURFACE': {
        if (!globalCapabilityManager.hasCapability(msg.senderPid, 'CAP_DEVICE_IO', '/dev/wayland') && !isAdmin) {
          return { success: false, error: 'EACCES: creating a Wayland surface requires CAP_DEVICE_IO for /dev/wayland' };
        }
        const id = `surf_${msg.senderPid}_${Math.random().toString(36).substring(2, 10)}`;
        const dimension = (value: unknown, fallback: number) => {
          const parsed = Number(value);
          return Number.isFinite(parsed) ? Math.max(64, Math.min(4096, Math.floor(parsed))) : fallback;
        };
        this.topZIndex += 1;
        const surface: WaylandSurface = {
          id,
          ownerPid: msg.senderPid,
          title: payload?.title || 'Earendel Wayland Surface',
          width: dimension(payload?.width, 800),
          height: dimension(payload?.height, 600),
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
          if (!isAdmin) return { success: false, error: 'EPERM: destroying all Wayland surfaces requires CAP_SYS_ADMIN' };
          this.surfaces.clear();
          removed = true;
        } else {
          if (!owns(id) && !isAdmin) return { success: false, error: 'EACCES: surface belongs to another process' };
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
        if (surface && surface.ownerPid !== msg.senderPid && !isAdmin) {
          return { success: false, error: 'EACCES: surface belongs to another process' };
        }
        if (surface) {
          this.topZIndex += 1;
          surface.zIndex = this.topZIndex;
          this.surfaces.forEach((s) => (s.focused = s.id === id));
          return { success: true, surface };
        }
        return { success: false, error: 'Surface not found' };
      }

      case 'SYS_WAYLAND_LIST_SURFACES': {
        const visibleSurfaces = Array.from(this.surfaces.values()).filter(surface => isAdmin || surface.ownerPid === msg.senderPid);
        return {
          compositor: 'Earendel Wayland Display Server 1.24.0',
          surfaces: visibleSurfaces,
          activeCount: visibleSurfaces.length,
        };
      }

      case 'SYS_WAYLAND_FLUSH_FRAMEBUFFER': {
        if (!owns(payload?.id) && !isAdmin) return { success: false, error: 'EACCES: framebuffer surface belongs to another process' };
        if (!globalCapabilityManager.hasCapability(msg.senderPid, 'CAP_DEVICE_IO', '/dev/fb0') && !isAdmin) {
          return { success: false, error: 'EACCES: framebuffer access requires CAP_DEVICE_IO for /dev/fb0' };
        }
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

  private pruneExitedClients(): void {
    const exitedOwners = new Set<number>();
    for (const [id, surface] of this.surfaces) {
      const owner = globalTaskScheduler.getProcess(surface.ownerPid);
      if (!owner || owner.state === 'ZOMBIE') {
        exitedOwners.add(surface.ownerPid);
      }
    }
    for (const pid of exitedOwners) this.removeClientSurfaces(pid);
  }
}

export const globalWaylandDaemon = new WaylandCompositorDaemon();
