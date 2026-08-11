import { ProcessControlBlock, TaskState } from './types';

export type SchedPolicy = 'CFS' | 'RR' | 'FIFO' | 'PRIORITY';

export interface SchedStatEntry {
  pid: number;
  name: string;
  policy: SchedPolicy;
  prio: number;
  cpuTimeSec: number;
  switches: number;
}

export class TaskScheduler {
  private pcbTable: Map<number, ProcessControlBlock> = new Map();
  private currentPolicy: SchedPolicy = 'CFS';
  private timeQuantumMs: number = 50;
  private processSwitches: Map<number, number> = new Map();

  constructor() {
    this.initKernelProcess();
  }

  public getPolicy(): SchedPolicy {
    return this.currentPolicy;
  }

  public setPolicy(p: SchedPolicy): void {
    this.currentPolicy = p;
  }

  public getSchedStats(): SchedStatEntry[] {
    const processes = this.getAllProcesses();
    return processes.map((p) => ({
      pid: p.pid,
      name: p.name,
      policy: this.currentPolicy,
      prio: p.pid === 1 ? 99 : 20,
      cpuTimeSec: parseFloat((0.01 + Math.random() * 0.08).toFixed(2)),
      switches: (this.processSwitches.get(p.pid) || 4) + Math.floor(Math.random() * 3),
    }));
  }

  private initKernelProcess() {
    // PID 1: /sbin/init (Systemd Init Process)
    this.createProcess({
      pid: 1,
      ppid: 0,
      name: '/sbin/init splash',
      user: 'root',
      state: 'RUNNING',
      startTime: new Date(),
      vszKB: 168000,
      rssKB: 12000,
      cpuUsagePercent: 0.1,
      cwd: '/',
      fds: new Map([
        [0, { fd: 0, path: '/dev/stdin', offset: 0, flags: 'r' }],
        [1, { fd: 1, path: '/dev/stdout', offset: 0, flags: 'w' }],
        [2, { fd: 2, path: '/dev/stderr', offset: 0, flags: 'w' }],
      ]),
      isKernelDaemon: true,
    });

    // PID 2: /lib/systemd/systemd-vfsd (User-space Virtual File System Daemon)
    this.createProcess({
      pid: 2,
      ppid: 1,
      name: '[vfsd]',
      user: 'root',
      state: 'RUNNING',
      startTime: new Date(),
      vszKB: 34000,
      rssKB: 11000,
      cpuUsagePercent: 0.1,
      cwd: '/',
      isKernelDaemon: true,
    });

    // PID 3: /lib/systemd/systemd-pmd (User-space Process Manager Daemon)
    this.createProcess({
      pid: 3,
      ppid: 1,
      name: '[pmd]',
      user: 'root',
      state: 'RUNNING',
      startTime: new Date(),
      vszKB: 28000,
      rssKB: 9000,
      cpuUsagePercent: 0.1,
      cwd: '/',
      isKernelDaemon: true,
    });

    // PID 4: /lib/systemd/systemd-driverd (User-space Device Driver Daemon)
    this.createProcess({
      pid: 4,
      ppid: 1,
      name: '[driverd]',
      user: 'root',
      state: 'RUNNING',
      startTime: new Date(),
      vszKB: 42000,
      rssKB: 14000,
      cpuUsagePercent: 0.1,
      cwd: '/',
      isKernelDaemon: true,
    });

    // PID 5: /usr/sbin/kagentd (Kernel Crash Self-Healing Daemon)
    this.createProcess({
      pid: 5,
      ppid: 1,
      name: '/usr/sbin/kagentd',
      user: 'root',
      state: 'RUNNING',
      startTime: new Date(),
      vszKB: 48000,
      rssKB: 16000,
      cpuUsagePercent: 0.1,
      cwd: '/',
      isKernelDaemon: true,
    });

    // PID 6: /usr/sbin/capAgentd (Kernel AI Capability Intent Firewall Daemon)
    this.createProcess({
      pid: 6,
      ppid: 1,
      name: '/usr/sbin/capAgentd',
      user: 'root',
      state: 'RUNNING',
      startTime: new Date(),
      vszKB: 52000,
      rssKB: 18000,
      cpuUsagePercent: 0.2,
      cwd: '/',
      isKernelDaemon: true,
    });
  }

  public createProcess(pcb: ProcessControlBlock): ProcessControlBlock {
    if (!pcb.fds || pcb.fds.size === 0) {
      pcb.fds = new Map([
        [0, { fd: 0, path: '/dev/stdin', offset: 0, flags: 'r' }],
        [1, { fd: 1, path: '/dev/stdout', offset: 0, flags: 'w' }],
        [2, { fd: 2, path: '/dev/stderr', offset: 0, flags: 'w' }],
      ]);
    }
    this.pcbTable.set(pcb.pid, pcb);
    this.processSwitches.set(pcb.pid, 1);
    return pcb;
  }

  public getProcess(pid: number): ProcessControlBlock | null {
    return this.pcbTable.get(pid) || null;
  }

  public getAllProcesses(): ProcessControlBlock[] {
    return Array.from(this.pcbTable.values());
  }

  public getProcesses(): ProcessControlBlock[] {
    return this.getAllProcesses();
  }

  public updateState(pid: number, state: TaskState): boolean {
    const pcb = this.pcbTable.get(pid);
    if (!pcb) return false;
    pcb.state = state;
    return true;
  }

  public terminateProcess(pid: number): boolean {
    const pcb = this.pcbTable.get(pid);
    if (!pcb || pcb.isKernelDaemon) return false;
    pcb.state = 'ZOMBIE';
    this.pcbTable.delete(pid);
    return true;
  }
}

export const globalTaskScheduler = new TaskScheduler();
