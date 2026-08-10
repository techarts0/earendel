// Earendel Microkernel PCB Task & Process Scheduler
import { ProcessControlBlock, TaskState } from './types';

export class TaskScheduler {
  private pcbTable: Map<number, ProcessControlBlock> = new Map();

  constructor() {
    this.initKernelProcess();
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
