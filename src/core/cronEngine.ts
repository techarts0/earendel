// Earendel POSIX Crontab Task Engine (Standard 5-Field Cron Parser & Daemon)
import { globalVFS } from './vfs';

export interface CronJobEntry {
  id: string;
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
  command: string;
  rawLine: string;
  lastRunTimestamp?: number;
}

export class CronEngine {
  private timer: any = null;
  private jobs: CronJobEntry[] = [];
  private crontabPath = '/var/spool/cron/crontabs/hello';

  constructor() {
    this.initCrontabFile();
    this.startDaemon();
  }

  private initCrontabFile() {
    try {
      globalVFS.mkdir('/var/spool/cron/crontabs', true);
      const existing = globalVFS.readFile(this.crontabPath);
      if (existing === null) {
        const defaultHeader = `# Earendel Crontab for user hello
# m h  dom mon dow   command
# */1 * * * * date >> /tmp/cron.log
`;
        globalVFS.writeFile(this.crontabPath, defaultHeader);
      }
    } catch (e) { }
  }

  /**
   * Starts the background cron daemon loop
   */
  public startDaemon() {
    if (this.timer) return;
    this.reloadJobs();

    // Check cron jobs every second
    this.timer = setInterval(() => {
      this.tick();
    }, 1000);
  }

  /**
   * Stops the background cron daemon
   */
  public stopDaemon() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Reloads jobs from VFS crontab files
   */
  public reloadJobs() {
    this.jobs = [];
    const content = globalVFS.readFile(this.crontabPath) || '';
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const parts = trimmed.split(/\s+/);
      if (parts.length >= 6) {
        const minute = parts[0];
        const hour = parts[1];
        const dayOfMonth = parts[2];
        const month = parts[3];
        const dayOfWeek = parts[4];
        const command = parts.slice(5).join(' ');

        this.jobs.push({
          id: Math.random().toString(36).substring(2, 9),
          minute,
          hour,
          dayOfMonth,
          month,
          dayOfWeek,
          command,
          rawLine: trimmed,
        });
      }
    }
  }

  /**
   * Main cron tick loop evaluated every second
   */
  private async tick() {
    const now = new Date();
    const currentMin = now.getMinutes();
    const currentHour = now.getHours();
    const currentDom = now.getDate();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentDow = now.getDay(); // 0-6 (0=Sun)
    const currentSecond = now.getSeconds();

    // Only trigger at the start of a minute (second == 0)
    if (currentSecond !== 0) return;

    for (const job of this.jobs) {
      if (
        this.matchField(job.minute, currentMin, 0, 59) &&
        this.matchField(job.hour, currentHour, 0, 23) &&
        this.matchField(job.dayOfMonth, currentDom, 1, 31) &&
        this.matchField(job.month, currentMonth, 1, 12) &&
        this.matchField(job.dayOfWeek, currentDow, 0, 6)
      ) {
        this.executeCronJob(job);
      }
    }
  }

  private async executeCronJob(job: CronJobEntry) {
    try {
      const { syscall } = await import('../kernel/syscall');
      const { SyscallNo } = await import('../kernel/types');
      const forkRes = await syscall(SyscallNo.SYS_FORK, `cron: ${job.command}`, '/home/hello');
      const childPid = forkRes.data || 501;

      const { globalShellEngine } = await import('./shellEngine');
      job.lastRunTimestamp = Date.now();
      await globalShellEngine.execute(job.command);

      await syscall(SyscallNo.SYS_EXIT, childPid);
    } catch (e) { }
  }

  /**
   * Evaluates standard cron field expressions
   */
  private matchField(fieldExpr: string, val: number, minBound: number, maxBound: number): boolean {
    if (fieldExpr === '*') return true;

    // Step values: */5
    if (fieldExpr.startsWith('*/')) {
      const step = parseInt(fieldExpr.slice(2), 10);
      return !isNaN(step) && step > 0 && val % step === 0;
    }

    // Comma lists: 1,5,10
    if (fieldExpr.includes(',')) {
      const items = fieldExpr.split(',').map((s) => parseInt(s.trim(), 10));
      return items.includes(val);
    }

    // Range: 1-5
    if (fieldExpr.includes('-')) {
      const [start, end] = fieldExpr.split('-').map((s) => parseInt(s.trim(), 10));
      return !isNaN(start) && !isNaN(end) && val >= start && val <= end;
    }

    // Exact value: 15
    const exact = parseInt(fieldExpr, 10);
    return exact === val;
  }

  public getJobs(): CronJobEntry[] {
    return [...this.jobs];
  }
}

export const globalCronEngine = new CronEngine();
