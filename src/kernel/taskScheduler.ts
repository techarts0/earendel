import { ProcessControlBlock, TaskState } from './types';
import { globalIPCBus } from './ipcBus';
import { globalCapabilityManager } from './capability';
import { globalVMPageTable } from './vmPageTable';

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
  private childWaiters = new Map<number, { parentPid: number; resolve: (result: { status?: number; error?: string }) => void }>();

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

    // PID 7: /usr/bin/waylandd (Earendel-Wayland Display Compositor Daemon)
    this.createProcess({
      pid: 7,
      ppid: 1,
      name: '/usr/bin/waylandd',
      user: 'root',
      state: 'RUNNING',
      startTime: new Date(),
      vszKB: 58000,
      rssKB: 21000,
      cpuUsagePercent: 0.2,
      cwd: '/',
      isKernelDaemon: true,
    });

    // PID 9: /lib/systemd/systemd-networkd (Network Subsystem Daemon)
    this.createProcess({
      pid: 9,
      ppid: 1,
      name: '[netd]',
      user: 'root',
      state: 'RUNNING',
      startTime: new Date(),
      vszKB: 24000,
      rssKB: 10000,
      cpuUsagePercent: 0.1,
      cwd: '/',
      isKernelDaemon: true,
    });

    this.createProcess({
      pid: 10,
      ppid: 1,
      name: '[harnessd]',
      user: 'root',
      state: 'RUNNING',
      startTime: new Date(),
      vszKB: 24000,
      rssKB: 10000,
      cpuUsagePercent: 0.1,
      cwd: '/',
      isKernelDaemon: true,
    });

    // Legacy terminal syscall identity retained until all callers carry process IDs.
    this.createProcess({
      pid: 24,
      ppid: 1,
      name: '/bin/bash (terminal compatibility principal)',
      user: 'hello',
      state: 'RUNNING',
      startTime: new Date(),
      vszKB: 24000,
      rssKB: 6000,
      cpuUsagePercent: 0.1,
      cwd: '/home/hello',
    });
  }

  public createProcess(pcb: ProcessControlBlock): ProcessControlBlock {
    if (!Number.isSafeInteger(pcb.pid) || pcb.pid <= 0 || !Number.isSafeInteger(pcb.ppid) || pcb.ppid < 0) {
      throw new Error('TaskScheduler: PID and PPID must be valid non-negative safe integers');
    }
    if (this.pcbTable.has(pcb.pid)) {
      throw new Error(`TaskScheduler: PID ${pcb.pid} is already allocated`);
    }
    if (!pcb.fds || pcb.fds.size === 0) {
      pcb.fds = new Map([
        [0, { fd: 0, path: '/dev/stdin', offset: 0, flags: 'r' }],
        [1, { fd: 1, path: '/dev/stdout', offset: 0, flags: 'w' }],
        [2, { fd: 2, path: '/dev/stderr', offset: 0, flags: 'w' }],
      ]);
    }
    this.pcbTable.set(pcb.pid, pcb);
    this.processSwitches.set(pcb.pid, 1);
    globalIPCBus.registerProcess(pcb.pid);
    return pcb;
  }

  public getProcess(pid: number): ProcessControlBlock | null {
    return this.pcbTable.get(pid) || null;
  }

  /** Returns true only when target is the caller or belongs to its process tree. */
  public isProcessInCallerTree(callerPid: number, targetPid: number): boolean {
    if (!Number.isSafeInteger(callerPid) || !Number.isSafeInteger(targetPid)) return false;
    let current = this.getProcess(targetPid);
    const visited = new Set<number>();
    while (current && !visited.has(current.pid)) {
      if (current.pid === callerPid) return true;
      visited.add(current.pid);
      current = this.getProcess(current.ppid);
    }
    return false;
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

  /** POSIX-style wait for one direct child; reaping is atomic with notification. */
  public waitForChild(parentPid: number, childPid: number): Promise<{ status?: number; error?: string }> {
    const child = this.pcbTable.get(childPid);
    if (!child || child.ppid !== parentPid) {
      return Promise.resolve({ error: 'ECHILD: No such child process' });
    }
    if (child.state === 'ZOMBIE') {
      const status = child.exitCode ?? 0;
      this.reapProcess(childPid);
      return Promise.resolve({ status });
    }
    if (this.childWaiters.has(childPid)) {
      return Promise.resolve({ error: 'ECHILD: Child already has a waiter' });
    }
    return new Promise((resolve) => this.childWaiters.set(childPid, { parentPid, resolve }));
  }

  private notifyChildWaiter(pcb: ProcessControlBlock): void {
    const waiter = this.childWaiters.get(pcb.pid);
    if (!waiter || waiter.parentPid !== pcb.ppid) return;
    this.childWaiters.delete(pcb.pid);
    const status = pcb.exitCode ?? 0;
    this.reapProcess(pcb.pid);
    waiter.resolve({ status });
  }

  public terminateProcess(pid: number): boolean {
    if (!this.exitProcess(pid, 1)) return false;
    this.reapProcess(pid);
    return true;
  }

  /** Mark an exited process waitable while revoking its live authority. */
  public exitProcess(pid: number, exitCode = 0): boolean {
    const pcb = this.pcbTable.get(pid);
    if (!pcb || pcb.isKernelDaemon || pcb.state === 'ZOMBIE') return false;
    pcb.state = 'ZOMBIE';
    pcb.exitCode = Number.isInteger(exitCode) ? exitCode : 1;
    globalIPCBus.unregisterProcess(pid);
    globalCapabilityManager.clearCapabilities(pid);
    globalVMPageTable.releaseProcess(pid);
    this.notifyChildWaiter(pcb);
    // Init owns adopted children and reaps them when they exit, even though the
    // simulated PID 1 does not execute a userspace wait loop.
    if (pcb.ppid === 1) this.reapProcess(pid);
    for (const [childPid, child] of this.pcbTable) {
      if (child.ppid !== pid) continue;
      child.ppid = 1;
      // PID 1 is the simulated init process and reaps already-exited orphans.
      if (child.state === 'ZOMBIE') this.reapProcess(childPid);
    }
    for (const [childPid, waiter] of this.childWaiters) {
      if (waiter.parentPid !== pid) continue;
      this.childWaiters.delete(childPid);
      waiter.resolve({ error: 'ECHILD: Parent process exited' });
    }
    return true;
  }

  /** Remove a zombie after its parent has consumed the exit status. */
  public reapProcess(pid: number): boolean {
    const pcb = this.pcbTable.get(pid);
    if (!pcb || pcb.state !== 'ZOMBIE' || pcb.isKernelDaemon) return false;
    this.pcbTable.delete(pid);
    this.processSwitches.delete(pid);
    return true;
  }
}

export const globalTaskScheduler = new TaskScheduler();
