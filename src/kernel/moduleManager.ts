// Earendel Kernel Module Manager (lsmod / modprobe / rmmod)
export interface KernelModuleInfo {
  name: string;
  sizeBytes: number;
  useCount: number;
  status: 'Live' | 'Loading' | 'Unloading';
  description: string;
}

export class ModuleManager {
  private modules: Map<string, KernelModuleInfo> = new Map();

  constructor() {
    this.registerDefaultModules();
  }

  private registerDefaultModules() {
    this.modules.set('vfs_driver', {
      name: 'vfs_driver',
      sizeBytes: 32768,
      useCount: 4,
      status: 'Live',
      description: 'Virtual File System Core Storage Driver',
    });
    this.modules.set('fb0_driver', {
      name: 'fb0_driver',
      sizeBytes: 65536,
      useCount: 1,
      status: 'Live',
      description: 'Virtual Framebuffer Display Character Device Driver (/dev/fb0)',
    });
    this.modules.set('sound_driver', {
      name: 'sound_driver',
      sizeBytes: 16384,
      useCount: 2,
      status: 'Live',
      description: 'WebAudio Synthesizer & PCM Sound Device Driver (/dev/audio)',
    });
  }

  public getLoadedModules(): KernelModuleInfo[] {
    return Array.from(this.modules.values());
  }

  public loadModule(name: string): boolean {
    if (this.modules.has(name)) return true;
    this.modules.set(name, {
      name,
      sizeBytes: 24576,
      useCount: 1,
      status: 'Live',
      description: `Dynamically loaded kernel module '${name}'`,
    });
    return true;
  }

  public unloadModule(name: string): boolean {
    return this.modules.delete(name);
  }
}

export const globalModuleManager = new ModuleManager();
