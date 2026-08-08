// Behavioral System & Admin Commands for Earendel
import { Command } from '../types';
import { globalSoundEngine } from '../soundEngine';
import { JobInfo } from '../processManager';
import { globalSnapshotEngine } from '../snapshotEngine';

export const sysCommands: Command[] = [
  {
    name: 'ps',
    description: 'Report a snapshot of the current processes',
    category: 'sys',
    execute: (ctx) => {
      const aux = ctx.args.includes('aux') || ctx.args.includes('-ef');
      const procs = ctx.processManager.getProcesses();

      if (aux) {
        let out = 'USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n';
        for (const p of procs) {
          out += `${p.user.padEnd(10, ' ')} ${p.pid.toString().padStart(5, ' ')} ${p.cpu.toFixed(1).padStart(4, ' ')} ${p.mem.toFixed(1).padStart(4, ' ')} ${p.vsz.toString().padStart(6, ' ')} ${p.rss.toString().padStart(5, ' ')} ${p.tty.padEnd(8, ' ')} ${p.stat.padEnd(4, ' ')} ${p.startTime.padEnd(7, ' ')} 0:00 ${p.command}\n`;
        }
        return { stdout: out, stderr: '', exitCode: 0 };
      } else {
        let out = '  PID TTY          TIME CMD\n';
        for (const p of procs) {
          out += `${p.pid.toString().padStart(5, ' ')} ${p.tty.padEnd(8, ' ')} 00:00:00 ${p.command}\n`;
        }
        return { stdout: out, stderr: '', exitCode: 0 };
      }
    },
  },
  {
    name: 'top',
    description: 'Display Linux processes and system resource usage',
    category: 'sys',
    execute: (ctx) => {
      const procs = ctx.processManager.getProcesses();
      let out = `top - 08:30:00 up 1 day,  2:15,  1 user,  load average: 0.05, 0.03, 0.01\n`;
      out += `Tasks: ${procs.length} total,   1 running,   ${procs.length - 1} sleeping,   0 stopped,   0 zombie\n`;
      out += `%Cpu(s):  1.2 us,  0.5 sy,  0.0 ni, 98.3 id,  0.0 wa,  0.0 hi,  0.0 si\n`;
      out += `MiB Mem :   2048.0 total,   1280.0 free,    384.0 used,    384.0 buff/cache\n\n`;
      out += `  PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND\n`;
      for (const p of procs) {
        out += `${p.pid.toString().padStart(5, ' ')} ${p.user.padEnd(8, ' ')} 20   0   ${p.vsz}   ${p.rss}   2800 ${p.stat[0]}   0.0   0.2   0:00.08 ${p.command}\n`;
      }
      return { stdout: out, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'free',
    description: 'Display amount of free and used memory in the system',
    category: 'sys',
    execute: (ctx) => {
      const isHuman = ctx.args.includes('-h') || ctx.args.includes('-m');
      const unit = isHuman ? 'Mi' : 'Ki';
      return {
        stdout: `               total        used        free      shared  buff/cache   available
Mem:          2048${unit}     384${unit}    1280${unit}       16${unit}     384${unit}    1536${unit}
Swap:         1024${unit}       0${unit}    1024${unit}\n`,
        stderr: '',
        exitCode: 0,
      };
    },
  },
  {
    name: 'df',
    description: 'Report file system disk space usage',
    category: 'sys',
    execute: (ctx) => {
      return {
        stdout: `Filesystem     1K-blocks      Used Available Use% Mounted on
/dev/root        8388608   1048576   7340032  13% /
tmpfs             1048576       512   1048064   1% /tmp
/dev/sda1        41943040   5242880  36690160  13% /home/hello\n`,
        stderr: '',
        exitCode: 0,
      };
    },
  },
  {
    name: 'whoami',
    description: 'Print effective user name',
    category: 'sys',
    execute: (ctx) => {
      return { stdout: `${ctx.env['USER'] || 'hello'}\n`, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'date',
    description: 'Display or set system date and time',
    category: 'sys',
    execute: (ctx) => {
      return { stdout: `${new Date().toLocaleString(ctx.lang === 'zh' ? 'zh-CN' : 'en-US')}\n`, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'uname',
    description: 'Print system information (-a)',
    category: 'sys',
    execute: (ctx) => {
      if (ctx.args.includes('-a')) {
        return { stdout: 'Linux earendel-tty 5.15.0-web #1 SMP PREEMPT Earendel-Native x86_64 GNU/Linux\n', stderr: '', exitCode: 0 };
      }
      return { stdout: 'Linux\n', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'clear',
    description: 'Clear the terminal screen',
    category: 'sys',
    execute: () => {
      return { stdout: '\x1b[2J\x1b[H', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'env',
    description: 'Print environment variables',
    category: 'sys',
    execute: (ctx) => {
      let out = '';
      for (const [k, v] of Object.entries(ctx.env)) {
        out += `${k}=${v}\n`;
      }
      return { stdout: out, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'export',
    description: 'Set environment variables',
    category: 'sys',
    execute: (ctx) => {
      for (const arg of ctx.args) {
        if (arg.includes('=')) {
          const [k, v] = arg.split('=');
          ctx.env[k] = v.replace(/^["']|["']$/g, '');
        }
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'busybox',
    description: 'Earendel Behavioral System multi-call applet list',
    category: 'sys',
    execute: () => {
      return {
        stdout: `Earendel Behavioral Linux System v1.0.0 (Native Pure TypeScript Edition)

Available Behavioral Commands & Applets:
\tash, awk, bash, bc, cat, cd, chmod, chown, clear, cp, cut, date, 
\tdf, diff, echo, env, export, find, free, grep, head, help, history, 
\tls, mkdir, mv, nano, ps, pwd, rm, rmdir, sed, seq, sh, sort, stat, 
\ttail, tar, tee, top, touch, tr, tree, uname, uniq, wc, which, whoami\n`,
        stderr: '',
        exitCode: 0,
      };
    },
  },
  {
    name: 'help',
    description: 'Display helpful info about Earendel terminal commands',
    category: 'sys',
    execute: (ctx) => {
      const isZh = ctx.lang === 'zh';
      return {
        stdout: isZh
          ? `Earendel 原生行为级 Linux 终端帮助指南:
常见命令: ls, cd, pwd, mkdir, touch, cat, echo, chmod, grep, find, sed, awk, ps, top, free, df, tar, bash, nano
Shell 语法: 支持变量定义 ($VAR)、管道符 (|)、输出重定向 (>/>>)、循环与脚本运行 (./script.sh)\n`
          : `Earendel Native Behavioral Linux Terminal Guide:
Commands: ls, cd, pwd, mkdir, touch, cat, echo, chmod, grep, find, sed, awk, ps, top, free, df, tar, bash, nano
Shell Syntax: Variables ($VAR), Pipe (|), Redirection (>/>>), Loops, and Script execution (./script.sh)\n`,
        stderr: '',
        exitCode: 0,
      };
    },
  },
  {
    name: 'kill',
    description: 'Send a signal to a process (terminate PID)',
    category: 'sys',
    execute: (ctx) => {
      const targetPidStr = ctx.args.find((a) => !a.startsWith('-'));
      if (!targetPidStr) return { stdout: '', stderr: 'kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]\n', exitCode: 1 };

      const pid = parseInt(targetPidStr, 10);
      if (isNaN(pid)) return { stdout: '', stderr: `kill: ${targetPidStr}: arguments must be process or job IDs\n`, exitCode: 1 };

      const ok = ctx.processManager.removeProcess(pid);
      if (!ok) return { stdout: '', stderr: `bash: kill: (${pid}) - No such process or operation not permitted\n`, exitCode: 1 };

      return { stdout: '', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'pkill',
    description: 'Signal processes based on name',
    category: 'sys',
    execute: (ctx) => {
      const procName = ctx.args.find((a) => !a.startsWith('-'));
      if (!procName) return { stdout: '', stderr: 'pkill: missing process name\n', exitCode: 1 };

      const procs = ctx.processManager.getProcesses();
      let killed = 0;
      for (const p of procs) {
        if (p.command.includes(procName)) {
          if (ctx.processManager.removeProcess(p.pid)) {
            killed++;
          }
        }
      }
      return { stdout: '', stderr: killed === 0 ? `pkill: pattern '${procName}' matched 0 processes\n` : '', exitCode: killed > 0 ? 0 : 1 };
    },
  },
  {
    name: 'sleep',
    description: 'Delay for a specified amount of time',
    category: 'sys',
    execute: async (ctx) => {
      const secsStr = ctx.args[0] || '1';
      const secs = parseFloat(secsStr);
      if (isNaN(secs) || secs < 0) return { stdout: '', stderr: `sleep: invalid time interval '${secsStr}'\n`, exitCode: 1 };

      const delayMs = Math.min(secs * 1000, 10000); // cap max 10s for browser safety
      await new Promise((r) => setTimeout(r, delayMs));
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'uptime',
    description: 'Tell how long the system has been running',
    category: 'sys',
    execute: () => {
      const dateStr = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      return { stdout: ` ${dateStr} up 2 days,  4:12,  1 user,  load average: 0.08, 0.04, 0.01\n`, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'alias',
    description: 'Define or display aliases',
    category: 'sys',
    execute: (ctx) => {
      if (ctx.args.length === 0) {
        return {
          stdout: `alias egrep='grep -E'\nalias fgrep='grep -F'\nalias l.='ls -d .* --color=auto'\nalias ll='ls -la'\nalias ls='ls --color=auto'\n`,
          stderr: '',
          exitCode: 0,
        };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'unalias',
    description: 'Remove alias definitions',
    category: 'sys',
    execute: () => {
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'hostname',
    description: 'Show or set the system\'s host name',
    category: 'sys',
    execute: () => {
      return { stdout: 'earendel\n', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'resize',
    description: 'Set environment variables to reflect current window size (resize --max for fullscreen)',
    category: 'sys',
    execute: (ctx) => {
      const isMax = ctx.args.includes('--max');
      return {
        stdout: isMax ? 'COLUMNS=160; LINES=48; export COLUMNS LINES;\n' : 'COLUMNS=120; LINES=32; export COLUMNS LINES;\n',
        stderr: '',
        exitCode: 0,
        toggleFullscreen: isMax ? 'max' : 'restore',
      };
    },
  },
  {
    name: 'jobs',
    description: 'Display status of jobs in the current session',
    category: 'sys',
    execute: (ctx) => {
      const jobs = ctx.processManager.getJobs();
      if (jobs.length === 0) {
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      const lines = jobs.map((j: JobInfo, idx: number) => {
        const symbol = idx === jobs.length - 1 ? '+' : '-';
        return `[${j.jobId}]${symbol}  ${j.status.padEnd(24)} ${j.command} &`;
      });
      return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'fg',
    description: 'Move job to the foreground',
    category: 'sys',
    execute: (ctx) => {
      const targetStr = (ctx.args[0] || '1').replace('%', '');
      const jobId = parseInt(targetStr, 10);
      const job = ctx.processManager.getJob(jobId);
      if (!job) {
        return { stdout: '', stderr: `fg: job ${targetStr} not found\n`, exitCode: 1 };
      }
      ctx.processManager.killJob(jobId);
      return { stdout: `${job.command}\n`, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'bg',
    description: 'Move job to the background',
    category: 'sys',
    execute: (ctx) => {
      const targetStr = (ctx.args[0] || '1').replace('%', '');
      const jobId = parseInt(targetStr, 10);
      const job = ctx.processManager.getJob(jobId);
      if (!job) {
        return { stdout: '', stderr: `bg: job ${targetStr} not found\n`, exitCode: 1 };
      }
      job.status = 'Running';
      return { stdout: `[${job.jobId}]+ ${job.command} &\n`, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'shutdown',
    aliases: ['halt', 'poweroff'],
    description: 'Halt, power-off or reboot the machine',
    category: 'sys',
    execute: (ctx) => {
      const currentUser = ctx.env['USER'] || 'hello';
      if (currentUser !== 'root') {
        return { stdout: '', stderr: 'shutdown: Need to be root\n', exitCode: 1 };
      }

      if (ctx.args.includes('-r') || ctx.args.includes('reboot')) {
        return {
          stdout: `Broadcast message from root@earendel (tty1) (${new Date().toUTCString()}):\n\nThe system is going down for reboot NOW!\n`,
          stderr: '',
          exitCode: 0,
          reboot: true,
        };
      }

      return {
        stdout: `Broadcast message from root@earendel (tty1) (${new Date().toUTCString()}):\n\nThe system is going down for poweroff NOW!\n`,
        stderr: '',
        exitCode: 0,
        poweroff: true,
      };
    },
  },
  {
    name: 'reboot',
    description: 'Reboot the machine',
    category: 'sys',
    execute: (ctx) => {
      const currentUser = ctx.env['USER'] || 'hello';
      if (currentUser !== 'root') {
        return { stdout: '', stderr: 'reboot: Need to be root\n', exitCode: 1 };
      }

      return {
        stdout: `Broadcast message from root@earendel (tty1) (${new Date().toUTCString()}):\n\nThe system is going down for reboot NOW!\n`,
        stderr: '',
        exitCode: 0,
        reboot: true,
      };
    },
  },
  {
    name: 'cheat',
    aliases: ['cheatsheet', 'telemetry'],
    description: 'Display interactive Linux command cheat sheet and live system telemetry dashboard',
    category: 'sys',
    execute: () => {
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        openCheat: true,
      };
    },
  },
  {
    name: 'sound',
    description: 'Control Web Audio mechanical keyboard sound effects (sound on | sound off | sound toggle)',
    category: 'sys',
    execute: (ctx) => {
      const sub = ctx.args[0];

      if (sub === 'on') {
        globalSoundEngine.setEnabled(true);
        return { stdout: 'Mechanical sound effects enabled.\n', stderr: '', exitCode: 0 };
      }
      if (sub === 'off') {
        globalSoundEngine.setEnabled(false);
        return { stdout: 'Mechanical sound effects muted.\n', stderr: '', exitCode: 0 };
      }
      if (sub === 'toggle') {
        const state = globalSoundEngine.toggleSound();
        return { stdout: `Mechanical sound effects ${state ? 'enabled' : 'muted'}.\n`, stderr: '', exitCode: 0 };
      }

      const status = globalSoundEngine.isEnabled() ? 'enabled' : 'muted';
      return {
        stdout: `Sound effects are currently ${status}.\nUsage: sound on | sound off | sound toggle\n`,
        stderr: '',
        exitCode: 0,
      };
    },
  },
  {
    name: 'tmux',
    description: 'Terminal multiplexer for splitting windows and multi-tasking',
    category: 'sys',
    execute: (ctx) => {
      const sub = ctx.args[0];

      if (sub === 'exit' || sub === 'kill') {
        return { stdout: '', stderr: '', exitCode: 0, splitTmux: 'exit' };
      }

      if (sub === 'split-h' || sub === 'h') {
        return { stdout: '', stderr: '', exitCode: 0, splitTmux: 'h' };
      }

      // Default vertical split
      return { stdout: '', stderr: '', exitCode: 0, splitTmux: 'v' };
    },
  },
  {
    name: 'snapshot',
    aliases: ['backup', 'restore'],
    description: 'Full system VFS snapshot save and time-machine rollback restore',
    category: 'sys',
    execute: (ctx) => {
      const sub = ctx.args[0];
      const targetName = ctx.args[1];

      if (sub === 'save' || sub === 'create') {
        if (!targetName) return { stdout: '', stderr: 'snapshot save: missing snapshot name\nUsage: snapshot save <name>\n', exitCode: 1 };
        const res = globalSnapshotEngine.saveSnapshot(targetName);
        return { stdout: `${res.message}\n`, stderr: '', exitCode: 0 };
      }

      if (sub === 'restore' || sub === 'rollback') {
        if (!targetName) return { stdout: '', stderr: 'snapshot restore: missing snapshot name\nUsage: snapshot restore <name>\n', exitCode: 1 };
        const res = globalSnapshotEngine.restoreSnapshot(targetName);
        if (!res.success) return { stdout: '', stderr: `${res.message}\n`, exitCode: 1 };
        return { stdout: `${res.message}\n`, stderr: '', exitCode: 0 };
      }

      if (sub === 'list' || sub === 'ls') {
        const list = globalSnapshotEngine.getSnapshots();
        if (list.length === 0) return { stdout: 'No system snapshots found.\n', stderr: '', exitCode: 0 };
        let out = 'SNAPSHOT NAME'.padEnd(20) + 'NODES'.padEnd(10) + 'CREATED AT\n';
        list.forEach((s: any) => {
          out += `${s.name.padEnd(20)}${String(s.nodeCount).padEnd(10)}${s.created}\n`;
        });
        return { stdout: out, stderr: '', exitCode: 0 };
      }

      if (sub === 'rm' || sub === 'delete') {
        if (!targetName) return { stdout: '', stderr: 'snapshot rm: missing snapshot name\n', exitCode: 1 };
        const ok = globalSnapshotEngine.deleteSnapshot(targetName);
        if (!ok) return { stdout: '', stderr: `snapshot '${targetName}' not found\n`, exitCode: 1 };
        return { stdout: `Deleted snapshot '${targetName}'\n`, stderr: '', exitCode: 0 };
      }

      return {
        stdout: `Usage: snapshot [save|restore|list|rm] <name>\n  snapshot save <name>      Save current system state\n  snapshot restore <name>   Rollback system to saved snapshot\n  snapshot list             List all saved snapshots\n  snapshot rm <name>        Delete a snapshot\n`,
        stderr: '',
        exitCode: 0,
      };
    },
  },
];
