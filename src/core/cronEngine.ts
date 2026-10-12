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
  private lastTickMinute: number = -1;

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
    const minuteKey = Math.floor(now.getTime() / 60_000);

    // Use the full minute timestamp so the same minute value in the next
    // hour/day is not mistaken for a duplicate tick.
    if (minuteKey === this.lastTickMinute) return;
    this.lastTickMinute = minuteKey;
    // Editors write the crontab after the `crontab -e` command has returned.
    // Refresh at the minute boundary so those saved changes become active.
    this.reloadJobs();
    if (this.jobs.length === 0) return;

    const currentMin = now.getMinutes();

    const currentHour = now.getHours();
    const currentDom = now.getDate();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentDow = now.getDay(); // 0-6 (0=Sun)

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
    let childPid: number | undefined;
    try {
      const { syscall } = await import('../kernel/syscall');
      const { SyscallNo } = await import('../kernel/types');
      const forkRes = await syscall(SyscallNo.SYS_FORK, `cron: ${job.command}`, '/home/hello');
      if (forkRes.code === 0 && typeof forkRes.data === 'number') {
        childPid = forkRes.data;
      } else {
        console.error(`[cron] could not register process for job (${job.rawLine}):`, forkRes.error || forkRes.code);
      }

      const { globalShellEngine } = await import('./shellEngine');
      const result = await globalShellEngine.execute(job.command);
      job.lastRunTimestamp = Date.now();
      if (result.exitCode !== 0 || result.stderr) {
        console.error(`[cron] job failed (${job.rawLine}): ${result.stderr || `exit ${result.exitCode}`}`);
      }
    } catch (e) {
      console.error(`[cron] could not execute job (${job.rawLine}):`, e);
    } finally {
      if (childPid !== undefined) {
        try {
          const { syscall } = await import('../kernel/syscall');
          const { SyscallNo } = await import('../kernel/types');
          await syscall(SyscallNo.SYS_EXIT, childPid);
        } catch (e) {
          console.error(`[cron] could not reap process ${childPid}:`, e);
        }
      }
    }
  }

  /**
   * Evaluates standard cron field expressions
   */
  private matchField(fieldExpr: string, val: number, minBound: number, maxBound: number): boolean {
    const isDayOfWeek = minBound === 0 && maxBound === 6;

    return fieldExpr.split(',').some((part) => {
      const pieces = part.trim().split('/');
      if (pieces.length > 2) return false;

      const step = pieces.length === 2 ? Number(pieces[1]) : 1;
      if (!Number.isInteger(step) || step < 1) return false;

      const rangeExpr = pieces[0];
      let start: number;
      let end: number;
      if (rangeExpr === '*') {
        start = minBound;
        end = maxBound;
      } else {
        const range = rangeExpr.match(/^(\d+)(?:-(\d+))?$/);
        if (!range) return false;
        start = Number(range[1]);
        end = range[2] === undefined ? start : Number(range[2]);
        if (start < minBound || start > maxBound + (isDayOfWeek ? 1 : 0) || end < minBound || end > maxBound + (isDayOfWeek ? 1 : 0) || start > end) {
          return false;
        }
      }

      for (let candidate = start; candidate <= end; candidate += step) {
        if ((isDayOfWeek && candidate === 7 ? 0 : candidate) === val) return true;
      }
      return false;
    });
  }

  public getJobs(): CronJobEntry[] {
    return [...this.jobs];
  }
}

export const globalCronEngine = new CronEngine();
