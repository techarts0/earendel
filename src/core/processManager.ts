import { ProcessInfo } from './types';
import { globalTaskScheduler } from '../kernel/taskScheduler';

export interface JobInfo {
  jobId: number;
  pid: number;
  command: string;
  status: 'Running' | 'Stopped' | 'Done';
}

export class ProcessManager {
  private processes: Map<number, ProcessInfo> = new Map();
  private jobs: Map<number, JobInfo> = new Map();
  private nextPid = 1;
  private nextJobId = 1;

  constructor() {
    // Standard system processes
    this.createProcess({
      ppid: 0,
      user: 'root',
      cpu: 0.0,
      mem: 0.1,
      vsz: 16820,
      rss: 3412,
      tty: '?',
      stat: 'Ss',
      command: '/sbin/init',
    });

    this.createProcess({
      ppid: 1,
      user: 'hello',
      cpu: 0.0,
      mem: 0.2,
      vsz: 22480,
      rss: 5120,
      tty: 'tty1',
      stat: 'S+',
      command: '/bin/bash',
    });
  }

  public createProcess(info: Omit<ProcessInfo, 'pid' | 'startTime'>): ProcessInfo {
    const pid = this.nextPid++;
    const startTime = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const proc: ProcessInfo = {
      ...info,
      pid,
      startTime,
    };
    this.processes.set(pid, proc);
    return proc;
  }

  public removeProcess(pid: number): boolean {
    if (pid <= 2) return false; // Protect init and bash
    return this.processes.delete(pid);
  }

  public getProcesses(): ProcessInfo[] {
    return Array.from(this.processes.values());
  }

  public getProcess(pid: number): ProcessInfo | undefined {
    return this.processes.get(pid);
  }

  public addJob(command: string, ppid: number = 1): JobInfo {
    const proc = this.createProcess({
      ppid,
      user: 'hello',
      cpu: 0.0,
      mem: 0.1,
      vsz: 12000,
      rss: 2000,
      tty: 'tty1',
      stat: 'S',
      command,
    });

    // Also register PCB in Microkernel TaskScheduler
    globalTaskScheduler.createProcess({
      pid: proc.pid,
      ppid,
      name: `[bg] ${command}`,
      user: 'hello',
      state: 'RUNNING',
      startTime: new Date(),
      vszKB: 12000,
      rssKB: 2000,
      cpuUsagePercent: 0.1,
      cwd: '/home/hello',
      fds: new Map([
        [0, { fd: 0, path: '/dev/stdin', offset: 0, flags: 'r' }],
        [1, { fd: 1, path: '/dev/stdout', offset: 0, flags: 'w' }],
        [2, { fd: 2, path: '/dev/stderr', offset: 0, flags: 'w' }],
      ]),
    });

    const jobId = this.nextJobId++;
    const job: JobInfo = {
      jobId,
      pid: proc.pid,
      command,
      status: 'Running',
    };
    this.jobs.set(jobId, job);
    return job;
  }

  public getJobs(): JobInfo[] {
    return Array.from(this.jobs.values());
  }

  public getJob(jobId: number): JobInfo | undefined {
    return this.jobs.get(jobId);
  }

  public killJob(jobId: number): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    job.status = 'Done';
    this.removeProcess(job.pid);
    return true;
  }
}

export const globalProcessManager = new ProcessManager();
