// Earendel Real Browser Telemetry Engine (Performance, Storage Estimate, WebWorker Monitoring)
export interface RealMemoryMetrics {
  totalMB: number;
  usedMB: number;
  freeMB: number;
  availableMB: number;
  buffCacheMB: number;
  jsHeapLimitMB: number;
  deviceRamGB: number;
}

export interface RealStorageMetrics {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usePercent: number;
}

export interface ProcessItem {
  pid: number;
  user: string;
  command: string;
  type: 'main' | 'worker' | 'wasm' | 'network' | 'daemon';
  vsz: string;
  rss: string;
  cpuPercent: number;
  memPercent: number;
  status: string;
  startTime: string;
}

export class WebTelemetryEngine {
  private registeredWorkers: Map<string, { pid: number; name: string; worker: Worker | null; startTime: Date }> = new Map();
  private basePid = 100;

  constructor() {
    this.registerDefaultSystemProcesses();
  }

  private registerDefaultSystemProcesses() {
    // Registered core Web OS background workers/daemons
    this.registeredWorkers.set('systemd', {
      pid: 1,
      name: '/sbin/init splash',
      worker: null,
      startTime: new Date(),
    });
    this.registeredWorkers.set('sound_engine', {
      pid: 102,
      name: 'web-audio-daemon (sound)',
      worker: null,
      startTime: new Date(),
    });
    this.registeredWorkers.set('p2p_mesh', {
      pid: 108,
      name: 'earendel-mesh-daemon (p2p)',
      worker: null,
      startTime: new Date(),
    });
    this.registeredWorkers.set('wasm_runtime', {
      pid: 115,
      name: 'wasm-worker-pool (python/node)',
      worker: null,
      startTime: new Date(),
    });
  }

  /**
   * Register a new active WebWorker into process list
   */
  public registerWorker(name: string, worker: Worker): number {
    const pid = ++this.basePid;
    this.registeredWorkers.set(name, {
      pid,
      name: `web-worker [${name}]`,
      worker,
      startTime: new Date(),
    });
    return pid;
  }

  /**
   * Unregister a WebWorker when terminated
   */
  public unregisterWorker(name: string) {
    this.registeredWorkers.delete(name);
  }

  /**
   * Gets real browser JS Heap memory and System Device RAM
   */
  public getRealMemoryInfo(): RealMemoryMetrics {
    const perf = typeof window !== 'undefined' ? (window.performance as any) : null;
    const memory = perf && perf.memory ? perf.memory : null;
    const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;

    const deviceRamGB = nav && nav.deviceMemory ? nav.deviceMemory : 8; // e.g. 8GB or 16GB
    const totalSystemRAMMB = deviceRamGB * 1024;

    if (memory) {
      const usedMB = Math.round(memory.usedJSHeapSize / (1024 * 1024));
      const allocatedHeapMB = Math.round(memory.totalJSHeapSize / (1024 * 1024));
      const heapLimitMB = Math.round(memory.jsHeapSizeLimit / (1024 * 1024));
      const freeMB = Math.max(0, allocatedHeapMB - usedMB);
      const buffCacheMB = Math.max(0, allocatedHeapMB - usedMB);
      const availableMB = Math.max(0, totalSystemRAMMB - usedMB);

      return {
        totalMB: totalSystemRAMMB,
        usedMB,
        freeMB: availableMB,
        availableMB,
        buffCacheMB,
        jsHeapLimitMB: heapLimitMB,
        deviceRamGB,
      };
    }

    // Fallback for browsers without performance.memory (Firefox/Safari)
    const fallbackUsedMB = 480;
    return {
      totalMB: totalSystemRAMMB,
      usedMB: fallbackUsedMB,
      freeMB: totalSystemRAMMB - fallbackUsedMB,
      availableMB: totalSystemRAMMB - fallbackUsedMB,
      buffCacheMB: 256,
      jsHeapLimitMB: 4096,
      deviceRamGB,
    };
  }

  /**
   * Queries real browser storage quota & IndexedDB / Cache usage
   */
  public async getRealStorageEstimate(): Promise<RealStorageMetrics> {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        const quota = estimate.quota || 100 * 1024 * 1024 * 1024; // Default 100 GB
        const usage = estimate.usage || 16 * 1024 * 1024; // Default 16 MB
        const available = Math.max(0, quota - usage);
        const usePercent = Math.min(100, Math.round((usage / quota) * 100));

        return {
          totalBytes: quota,
          usedBytes: usage,
          availableBytes: available,
          usePercent,
        };
      } catch (e) {}
    }

    // Fallback estimate
    const defaultQuota = 64 * 1024 * 1024 * 1024;
    const defaultUsed = 32 * 1024 * 1024;
    return {
      totalBytes: defaultQuota,
      usedBytes: defaultUsed,
      availableBytes: defaultQuota - defaultUsed,
      usePercent: 1,
    };
  }

  /**
   * Returns active system tasks and WebWorker processes for ps / top / htop
   */
  public getProcessList(): ProcessItem[] {
    const mem = this.getRealMemoryInfo();
    const list: ProcessItem[] = [
      {
        pid: 1,
        user: 'root',
        command: '/sbin/init splash',
        type: 'daemon',
        vsz: '168M',
        rss: '12M',
        cpuPercent: 0.1,
        memPercent: 0.1,
        status: 'S',
        startTime: '00:00:01',
      },
      {
        pid: 24,
        user: 'hello',
        command: 'xterm-256color (terminal-main)',
        type: 'main',
        vsz: `${mem.usedMB + 64}M`,
        rss: `${mem.usedMB}M`,
        cpuPercent: 0.5,
        memPercent: parseFloat(((mem.usedMB / mem.totalMB) * 100).toFixed(1)),
        status: 'R',
        startTime: '00:00:02',
      },
    ];

    for (const [_, item] of this.registeredWorkers.entries()) {
      if (item.pid === 1) continue;
      list.push({
        pid: item.pid,
        user: 'hello',
        command: item.name,
        type: 'worker',
        vsz: '64M',
        rss: '16M',
        cpuPercent: Math.min(2.5, Math.random() * 0.8),
        memPercent: 0.2,
        status: 'S',
        startTime: item.startTime.toTimeString().substring(0, 8),
      });
    }

    return list;
  }
}

export const globalWebTelemetryEngine = new WebTelemetryEngine();
