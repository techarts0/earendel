// Earendel Process & Container Namespace Manager
export interface ProcessNamespace {
  nsId: string;
  utsHostname: string;
  cwd: string;
  env: Record<string, string>;
  chrootPath: string;
  pidNsMap: Map<number, number>; // Container PID -> Host PID
}

class NamespaceManager {
  private namespaces: Map<string, ProcessNamespace> = new Map();
  private processNsMapping: Map<number, string> = new Map(); // PID -> nsId
  private nextNsId = 1;

  constructor() {
    this.createNamespace('ns_root', {
      utsHostname: 'earendel',
      cwd: '/home/hello',
      env: { USER: 'hello', HOME: '/home/hello', PATH: '/bin:/usr/bin', SHELL: '/bin/bash', TERM: 'xterm-256color' },
      chrootPath: '/',
    });
  }

  public createNamespace(idStr?: string, initial?: Partial<ProcessNamespace>): ProcessNamespace {
    const nsId = idStr || `ns_${this.nextNsId++}`;
    const ns: ProcessNamespace = {
      nsId,
      utsHostname: initial?.utsHostname || 'earendel-container',
      cwd: initial?.cwd || '/home/hello',
      env: initial?.env ? { ...initial.env } : { USER: 'hello', HOME: '/home/hello', PATH: '/bin:/usr/bin' },
      chrootPath: initial?.chrootPath || '/',
      pidNsMap: initial?.pidNsMap ? new Map(initial.pidNsMap) : new Map([[1, 1]]),
    };
    this.namespaces.set(nsId, ns);
    return ns;
  }

  public cloneNamespace(parentNsId: string, overrides?: Partial<ProcessNamespace>): ProcessNamespace {
    const parent = this.namespaces.get(parentNsId) || this.namespaces.get('ns_root')!;
    const newNs = this.createNamespace(undefined, {
      utsHostname: overrides?.utsHostname || parent.utsHostname,
      cwd: overrides?.cwd || parent.cwd,
      env: overrides?.env ? { ...overrides.env } : { ...parent.env },
      chrootPath: overrides?.chrootPath || parent.chrootPath,
    });
    return newNs;
  }

  public attachProcess(pid: number, nsId: string): void {
    this.processNsMapping.set(pid, nsId);
  }

  public getNamespaceForProcess(pid: number): ProcessNamespace {
    const nsId = this.processNsMapping.get(pid) || 'ns_root';
    return this.namespaces.get(nsId) || this.namespaces.get('ns_root')!;
  }

  public getAllNamespaces(): ProcessNamespace[] {
    return Array.from(this.namespaces.values());
  }
}

export const globalNamespaceManager = new NamespaceManager();
