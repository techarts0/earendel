// Behavioral System & Admin Commands for Earendel
import { Command } from '../types';
import { globalSoundEngine } from '../soundEngine';
import { JobInfo } from '../processManager';
import { globalSnapshotEngine } from '../snapshotEngine';
import { globalWebTelemetryEngine } from '../webTelemetryEngine';
import { syscall } from '../../kernel/syscall';
import { SyscallNo } from '../../kernel/types';
import { globalTaskScheduler } from '../../kernel/taskScheduler';

export const sysCommands: Command[] = [
  {
    name: 'ps',
    description: 'Report a snapshot of the current processes (supports aux, -ef, -u, -p, -A, -e)',
    category: 'sys',
    execute: (ctx) => {
      const isFull = ctx.args.includes('aux') || ctx.args.includes('-ef') || ctx.args.includes('-aux') || ctx.args.includes('-A') || ctx.args.includes('-e');
      
      let userFilter: string | null = null;
      let pidFilter: number | null = null;

      for (let i = 0; i < ctx.args.length; i++) {
        if (ctx.args[i] === '-u' && ctx.args[i + 1]) {
          userFilter = ctx.args[i + 1];
          i++;
        } else if (ctx.args[i].startsWith('-u=')) {
          userFilter = ctx.args[i].slice(3);
        } else if (ctx.args[i] === '-p' && ctx.args[i + 1]) {
          pidFilter = parseInt(ctx.args[i + 1], 10);
          i++;
        } else if (ctx.args[i].startsWith('-p=')) {
          pidFilter = parseInt(ctx.args[i].slice(3), 10);
        }
      }

      let realProcs = globalTaskScheduler.getAllProcesses();

      if (userFilter) {
        realProcs = realProcs.filter((p) => p.user === userFilter);
      }
      if (pidFilter !== null && !isNaN(pidFilter)) {
        realProcs = realProcs.filter((p) => p.pid === pidFilter);
      }

      const currentUser = ctx.env['USER'] || 'hello';

      if (isFull || userFilter || pidFilter !== null) {
        let out = 'USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n';
        for (const p of realProcs) {
          const cpu = p.cpuUsagePercent ? p.cpuUsagePercent.toFixed(1) : '0.0';
          const mem = ((p.rssKB / 1024 / 1024) * 100).toFixed(1);
          const statChar = p.state === 'RUNNING' ? 'R' : p.state === 'BLOCKED' ? 'T' : p.state === 'ZOMBIE' ? 'Z' : 'S';
          const timeStr = p.startTime ? p.startTime.toTimeString().substring(0, 5) : '00:00';
          out += `${p.user.padEnd(10, ' ')} ${p.pid.toString().padStart(5, ' ')} ${cpu.padStart(4, ' ')} ${mem.padStart(4, ' ')} ${(p.vszKB || 16000).toString().padStart(6, ' ')} ${(p.rssKB || 4000).toString().padStart(5, ' ')} tty1     ${statChar.padEnd(4, ' ')} ${timeStr.padEnd(7, ' ')} 0:00 ${p.name}\n`;
        }
        return { stdout: out, stderr: '', exitCode: 0 };
      } else {
        // Default ps lists current user's processes in standard simple format
        const userProcs = realProcs.filter((p) => p.user === currentUser || p.pid === 1 || p.name === 'bash');
        let out = '  PID TTY          TIME CMD\n';
        for (const p of userProcs) {
          out += `${p.pid.toString().padStart(5, ' ')} tty1     00:00:00 ${p.name}\n`;
        }
        return { stdout: out, stderr: '', exitCode: 0 };
      }
    },
  },
  {
    name: 'top',
    aliases: ['htop'],
    description: 'Display Linux processes and system resource usage (-b, -n, -u, -p, -d)',
    category: 'sys',
    execute: (ctx) => {
      let userFilter: string | null = null;
      let pidFilter: number | null = null;

      for (let i = 0; i < ctx.args.length; i++) {
        if (ctx.args[i] === '-u' && ctx.args[i + 1]) {
          userFilter = ctx.args[i + 1];
          i++;
        } else if (ctx.args[i] === '-p' && ctx.args[i + 1]) {
          pidFilter = parseInt(ctx.args[i + 1], 10);
          i++;
        }
      }

      let realProcs = globalTaskScheduler.getAllProcesses();
      if (userFilter) realProcs = realProcs.filter((p) => p.user === userFilter);
      if (pidFilter !== null && !isNaN(pidFilter)) realProcs = realProcs.filter((p) => p.pid === pidFilter);

      const mem = globalWebTelemetryEngine.getRealMemoryInfo();
      const nowStr = new Date().toTimeString().substring(0, 8);

      const runningCount = realProcs.filter((p) => p.state === 'RUNNING').length;
      const blockedCount = realProcs.filter((p) => p.state === 'BLOCKED').length;
      const zombieCount = realProcs.filter((p) => p.state === 'ZOMBIE').length;
      const sleepingCount = realProcs.length - runningCount - blockedCount - zombieCount;

      let out = `top - ${nowStr} up 2 days,  4:15,  1 user,  load average: 0.08, 0.05, 0.01\n`;
      out += `Tasks: ${realProcs.length} total,   ${runningCount} running,   ${sleepingCount} sleeping,   ${blockedCount} stopped,   ${zombieCount} zombie\n`;
      out += `%Cpu(s):  1.5 us,  0.8 sy,  0.0 ni, 97.7 id,  0.0 wa,  0.0 hi,  0.0 si\n`;
      out += `MiB Mem :   ${mem.totalMB.toFixed(1).padStart(6, ' ')} total,   ${mem.freeMB.toFixed(1).padStart(6, ' ')} free,   ${mem.usedMB.toFixed(1).padStart(6, ' ')} used,   ${mem.buffCacheMB.toFixed(1).padStart(6, ' ')} buff/cache\n\n`;
      out += `  PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND\n`;
      for (const p of realProcs) {
        const cpu = p.cpuUsagePercent ? p.cpuUsagePercent.toFixed(1) : '0.0';
        const memP = ((p.rssKB / 1024 / 1024) * 100).toFixed(1);
        const statChar = p.state === 'RUNNING' ? 'R' : p.state === 'BLOCKED' ? 'T' : p.state === 'ZOMBIE' ? 'Z' : 'S';
        out += `${p.pid.toString().padStart(5, ' ')} ${p.user.padEnd(8, ' ')} 20   0   ${(p.vszKB || 16000).toString().padStart(6, ' ')} ${(p.rssKB || 4000).toString().padStart(5, ' ')}   2800 ${statChar}   ${cpu.padStart(4, ' ')}   ${memP.padStart(4, ' ')}   0:00.08 ${p.name}\n`;
      }
      return { stdout: out, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'free',
    description: 'Display amount of free and used memory in the system (-h, -b, -k, -m, -g, -t)',
    category: 'sys',
    execute: (ctx) => {
      const mem = globalWebTelemetryEngine.getRealMemoryInfo();
      const isHuman = ctx.args.includes('-h') || ctx.args.includes('--human');
      const isBytes = ctx.args.includes('-b') || ctx.args.includes('--bytes');
      const isMega = ctx.args.includes('-m') || ctx.args.includes('--mega') || ctx.args.includes('--mebi');
      const isGiga = ctx.args.includes('-g') || ctx.args.includes('--giga') || ctx.args.includes('--gebi');
      const showTotal = ctx.args.includes('-t') || ctx.args.includes('--total');

      if (isHuman) {
        const totalG = (mem.totalMB / 1024).toFixed(1) + 'Gi';
        const usedM = mem.usedMB + 'Mi';
        const freeG = (mem.freeMB / 1024).toFixed(1) + 'Gi';
        const availG = (mem.availableMB / 1024).toFixed(1) + 'Gi';
        let out = `               total        used        free      shared  buff/cache   available\n`;
        out += `Mem:          ${totalG.padStart(10, ' ')}  ${usedM.padStart(10, ' ')}  ${freeG.padStart(10, ' ')}        0B  ${(mem.buffCacheMB + 'Mi').padStart(10, ' ')}  ${availG.padStart(10, ' ')}\n`;
        out += `Swap:         2.0Gi          0B       2.0Gi\n`;
        if (showTotal) {
          out += `Total:        ${((mem.totalMB + 2048) / 1024).toFixed(1)}Gi  ${usedM.padStart(10, ' ')}  ${((mem.freeMB + 2048) / 1024).toFixed(1)}Gi\n`;
        }
        return { stdout: out, stderr: '', exitCode: 0 };
      }

      let multiplier = 1024; // default KB
      if (isBytes) multiplier = 1024 * 1024;
      else if (isMega) multiplier = 1;
      else if (isGiga) multiplier = 1 / 1024;

      const fmt = (mb: number) => Math.round(mb * multiplier).toString().padStart(11, ' ');

      let out = `               total        used        free      shared  buff/cache   available\n`;
      out += `Mem:        ${fmt(mem.totalMB)} ${fmt(mem.usedMB)} ${fmt(mem.freeMB)} ${fmt(0)} ${fmt(mem.buffCacheMB)} ${fmt(mem.availableMB)}\n`;
      out += `Swap:       ${fmt(2048)} ${fmt(0)} ${fmt(2048)}\n`;
      if (showTotal) {
        out += `Total:      ${fmt(mem.totalMB + 2048)} ${fmt(mem.usedMB)} ${fmt(mem.freeMB + 2048)}\n`;
      }

      return { stdout: out, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'df',
    description: 'Report file system disk space usage',
    category: 'sys',
    execute: async (ctx) => {
      const storage = await globalWebTelemetryEngine.getRealStorageEstimate();
      const isHuman = ctx.args.includes('-h');

      if (isHuman) {
        const totalGB = (storage.totalBytes / (1024 * 1024 * 1024)).toFixed(1) + 'G';
        const usedMB = (storage.usedBytes / (1024 * 1024)).toFixed(1) + 'M';
        const availGB = (storage.availableBytes / (1024 * 1024 * 1024)).toFixed(1) + 'G';
        const pct = storage.usePercent + '%';

        let out = `Filesystem      Size  Used Avail Use% Mounted on\n`;
        out += `/dev/root       ${totalGB.padStart(5, ' ')} ${usedMB.padStart(5, ' ')} ${availGB.padStart(5, ' ')} ${pct.padStart(4, ' ')} /\n`;
        out += `tmpfs           800M  1.2M  798M   1% /tmp\n`;
        out += `hostfs          500G  120G  380G  24% /mnt/host\n`;
        return { stdout: out, stderr: '', exitCode: 0 };
      }

      const total1K = Math.round(storage.totalBytes / 1024);
      const used1K = Math.round(storage.usedBytes / 1024);
      const avail1K = Math.round(storage.availableBytes / 1024);

      let out = `Filesystem     1K-blocks      Used Available Use% Mounted on\n`;
      out += `/dev/root      ${total1K.toString().padStart(9, ' ')} ${used1K.toString().padStart(9, ' ')} ${avail1K.toString().padStart(9, ' ')}  ${storage.usePercent}% /\n`;
      out += `tmpfs             819200      1228    817972   1% /tmp\n`;
      return { stdout: out, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'worker',
    description: 'Inspect active WebWorker threads and background tasks',
    category: 'sys',
    execute: () => {
      const workers = globalWebTelemetryEngine.getProcessList().filter((p) => p.type === 'worker');
      let out = `Active Web OS Workers & Background Daemons: ${workers.length}\n\n`;
      out += `  PID TYPE     MEM%  CPU%  START    WORKER NAME / DAEMON\n`;
      out += `----------------------------------------------------------\n`;
      for (const w of workers) {
        out += `${w.pid.toString().padStart(5, ' ')} ${w.type.padEnd(8, ' ')} ${w.memPercent.toFixed(1).padStart(4, ' ')}% ${w.cpuPercent.toFixed(1).padStart(4, ' ')}% ${w.startTime} ${w.command}\n`;
      }
      return { stdout: out, stderr: '', exitCode: 0 };
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
    name: 'ldd',
    description: 'Print shared object dependencies',
    category: 'sys',
    execute: (ctx) => {
      const target = ctx.args[0];
      if (!target) {
        return { stdout: '', stderr: 'ldd: missing file arguments\nUsage: ldd FILE...\n', exitCode: 1 };
      }

      const path = target.startsWith('/') ? target : `/usr/bin/${target}`;
      const node = ctx.vfs.getNodeByPath(path);
      if (!node) {
        return { stdout: '', stderr: `ldd: ${target}: No such file or directory\n`, exitCode: 1 };
      }

      let out = `\tlinux-vdso.so.1 (0x00007ffe${Math.floor(Math.random() * 0xfffffff).toString(16).padStart(8, '0')})\n`;
      out += `\tlibc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x00007f8a${Math.floor(Math.random() * 0xfffffff).toString(16).padStart(8, '0')})\n`;
      out += `\tlibm.so.6 => /lib/x86_64-linux-gnu/libm.so.6 (0x00007f8b${Math.floor(Math.random() * 0xfffffff).toString(16).padStart(8, '0')})\n`;
      out += `\t/lib64/ld-linux-x86-64.so.2 (0x00007f8c${Math.floor(Math.random() * 0xfffffff).toString(16).padStart(8, '0')})\n`;

      return { stdout: out, stderr: '', exitCode: 0 };
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
        const eqIdx = arg.indexOf('=');
        if (eqIdx !== -1) {
          const k = arg.slice(0, eqIdx);
          const v = arg.slice(eqIdx + 1).replace(/^["']|["']$/g, '');
          ctx.env[k] = v;
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
          ? `Earendel POSIX WebOS 终端帮助指南:
常见命令: ls, cd, pwd, mkdir, touch, cat, echo, chmod, grep, find, sed, awk, ps, top, free, df, tar, bash, nano
Shell 语法: 支持变量定义 ($VAR)、管道符 (|)、输出重定向 (>/>>)、循环与脚本运行 (./script.sh)\n`
          : `Earendel POSIX WebOS Terminal Help Guide:
Commands: ls, cd, pwd, mkdir, touch, cat, echo, chmod, grep, find, sed, awk, ps, top, free, df, tar, bash, nano
Shell Syntax: Variables ($VAR), Pipe (|), Redirection (>/>>), Loops, and Script execution (./script.sh)\n`,
        stderr: '',
        exitCode: 0,
      };
    },
  },
  {
    name: 'history',
    description: 'Display or manipulate the history list (supports -c, -d offset, -w [file], -r [file], [n])',
    category: 'sys',
    execute: (ctx) => {
      const shell = ctx.shellEngine || (typeof window !== 'undefined' && (window as any).globalShellEngine)
        ? (ctx.shellEngine || (window as any).globalShellEngine)
        : null;

      const historyList: string[] = ctx.history || (shell ? shell.getHistory() : []);

      if (ctx.args.length === 0) {
        // Output entire history with 1-based indexing
        const formatted = historyList.map((cmd, idx) => `  ${String(idx + 1).padStart(5, ' ')}  ${cmd}`).join('\n');
        return { stdout: formatted ? formatted + '\n' : '', stderr: '', exitCode: 0 };
      }

      // Check for flags
      const firstArg = ctx.args[0];

      // -c: Clear the history list
      if (firstArg === '-c' || firstArg === '--clear') {
        if (shell && shell.clearHistory) shell.clearHistory();
        if (ctx.history) ctx.history.length = 0;
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      // -d offset: Delete the history entry at position offset (1-based)
      if (firstArg === '-d' && ctx.args[1]) {
        const offset = parseInt(ctx.args[1], 10);
        if (isNaN(offset) || offset <= 0 || offset > historyList.length) {
          return { stdout: '', stderr: `-bash: history: ${ctx.args[1]}: history position out of range\n`, exitCode: 1 };
        }
        if (shell && shell.deleteHistoryIndex) shell.deleteHistoryIndex(offset - 1);
        else historyList.splice(offset - 1, 1);
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      // -w [file]: Write current history to history file (default ~/.bash_history)
      if (firstArg === '-w') {
        const targetPath = ctx.args[1] || (ctx.env['HOME'] ? `${ctx.env['HOME']}/.bash_history` : '/home/hello/.bash_history');
        const content = historyList.join('\n') + '\n';
        ctx.vfs.writeFile(targetPath, content);
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      // -r [file]: Read history file and append to current history
      if (firstArg === '-r') {
        const targetPath = ctx.args[1] || (ctx.env['HOME'] ? `${ctx.env['HOME']}/.bash_history` : '/home/hello/.bash_history');
        const content = ctx.vfs.readFile(targetPath);
        if (content === null) {
          return { stdout: '', stderr: `-bash: history: ${targetPath}: cannot read: No such file or directory\n`, exitCode: 1 };
        }
        const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
        for (const l of lines) {
          historyList.push(l);
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      // history n: Display only the last n commands
      const num = parseInt(firstArg, 10);
      if (!isNaN(num) && num > 0) {
        const startIndex = Math.max(0, historyList.length - num);
        const sliced = historyList.slice(startIndex);
        const formatted = sliced
          .map((cmd, idx) => `  ${String(startIndex + idx + 1).padStart(5, ' ')}  ${cmd}`)
          .join('\n');
        return { stdout: formatted ? formatted + '\n' : '', stderr: '', exitCode: 0 };
      }

      return {
        stdout: '',
        stderr: 'Usage: history [-c] [-d offset] [n] or history -w [file] or history -r [file]\n',
        exitCode: 2,
      };
    },
  },
  {
    name: 'kill',
    description: 'Send a signal to a process (terminate/suspend PID, supports -l, -s, -9, -15)',
    category: 'sys',
    execute: async (ctx) => {
      if (ctx.args.includes('-l') || ctx.args.includes('--list')) {
        const signals = [
          ' 1) SIGHUP       2) SIGINT       3) SIGQUIT      4) SIGILL       5) SIGTRAP',
          ' 6) SIGABRT      7) SIGBUS       8) SIGFPE       9) SIGKILL     10) SIGUSR1',
          '11) SIGSEGV     12) SIGUSR2     13) SIGPIPE     14) SIGALRM     15) SIGTERM',
          '16) SIGSTKFLT   17) SIGCHLD     18) SIGCONT     19) SIGSTOP     20) SIGTSTP',
          '21) SIGTTIN     22) SIGTTOU     23) SIGURG      24) SIGXCPU     25) SIGXFSZ',
          '26) SIGVTALRM   27) SIGPROF     28) SIGWINCH    29) SIGIO       30) SIGPWR',
          '31) SIGSYS',
        ];
        return { stdout: signals.join('\n') + '\n', stderr: '', exitCode: 0 };
      }

      let sig = 15;
      const pids: number[] = [];

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg === '-s' && ctx.args[i + 1]) {
          const sName = ctx.args[i + 1].toUpperCase().replace(/^SIG/, '');
          if (sName === 'KILL' || sName === '9') sig = 9;
          else if (sName === 'TERM' || sName === '15') sig = 15;
          else if (sName === 'INT' || sName === '2') sig = 2;
          else if (sName === 'STOP' || sName === '19') sig = 19;
          else if (sName === 'CONT' || sName === '18') sig = 18;
          else if (sName === 'HUP' || sName === '1') sig = 1;
          i++;
        } else if (arg.startsWith('-') && arg.length > 1) {
          const flag = arg.replace(/^-+/, '').toUpperCase().replace(/^SIG/, '');
          if (flag === '9' || flag === 'KILL') sig = 9;
          else if (flag === '15' || flag === 'TERM') sig = 15;
          else if (flag === '2' || flag === 'INT') sig = 2;
          else if (flag === '19' || flag === 'STOP') sig = 19;
          else if (flag === '18' || flag === 'CONT') sig = 18;
          else if (flag === '1' || flag === 'HUP') sig = 1;
          else if (!isNaN(parseInt(flag, 10))) sig = parseInt(flag, 10);
        } else {
          const pid = parseInt(arg, 10);
          if (!isNaN(pid)) {
            pids.push(pid);
          }
        }
      }

      if (pids.length === 0) {
        return { stdout: '', stderr: 'kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]\n', exitCode: 1 };
      }

      let hadError = false;
      let totalStderr = '';

      for (const pid of pids) {
        const res = await syscall(SyscallNo.SYS_KILL, pid, sig);
        if (res.code !== 0) {
          totalStderr += `bash: kill: (${pid}) - No such process\n`;
          hadError = true;
        }
      }

      return { stdout: '', stderr: totalStderr, exitCode: hadError ? 1 : 0 };
    },
  },
  {
    name: 'pkill',
    description: 'Signal processes based on name (-9, -15, -f, -u)',
    category: 'sys',
    execute: async (ctx) => {
      let sig = 15;
      let userFilter: string | null = null;
      let fullMatch = false;
      let pattern: string | null = null;

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg === '-u' && ctx.args[i + 1]) {
          userFilter = ctx.args[i + 1];
          i++;
        } else if (arg === '-f' || arg === '--full') {
          fullMatch = true;
        } else if (arg.startsWith('-') && arg.length > 1) {
          const flag = arg.replace(/^-+/, '').toUpperCase().replace(/^SIG/, '');
          if (flag === '9' || flag === 'KILL') sig = 9;
          else if (flag === '15' || flag === 'TERM') sig = 15;
          else if (flag === '2' || flag === 'INT') sig = 2;
          else if (!isNaN(parseInt(flag, 10))) sig = parseInt(flag, 10);
        } else if (!pattern) {
          pattern = arg;
        }
      }

      if (!pattern && !userFilter) {
        return { stdout: '', stderr: 'pkill: missing process pattern\n', exitCode: 1 };
      }

      const procs = globalTaskScheduler.getAllProcesses();
      let killed = 0;

      for (const p of procs) {
        let matches = true;
        if (userFilter && p.user !== userFilter) matches = false;
        if (pattern) {
          const targetStr = p.name;
          if (!targetStr.includes(pattern)) matches = false;
        }

        if (matches) {
          const res = await syscall(SyscallNo.SYS_KILL, p.pid, sig);
          if (res.code === 0) killed++;
        }
      }

      return { stdout: '', stderr: killed === 0 ? `pkill: pattern '${pattern || ''}' matched 0 processes\n` : '', exitCode: killed > 0 ? 0 : 1 };
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
    description: 'Tell how long the system has been running (-p, -s)',
    category: 'sys',
    execute: (ctx) => {
      const isPretty = ctx.args.includes('-p') || ctx.args.includes('--pretty');
      const isSince = ctx.args.includes('-s') || ctx.args.includes('--since');

      if (isPretty) {
        return { stdout: 'up 2 days, 4 hours, 12 minutes\n', stderr: '', exitCode: 0 };
      }
      if (isSince) {
        const d = new Date(Date.now() - 2 * 86400000 - 4 * 3600000);
        return { stdout: `${d.toISOString().slice(0, 19).replace('T', ' ')}\n`, stderr: '', exitCode: 0 };
      }

      const dateStr = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      return { stdout: ` ${dateStr} up 2 days,  4:12,  1 user,  load average: 0.08, 0.04, 0.01\n`, stderr: '', exitCode: 0 };
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
    description: 'Set environment variables to reflect current window size (resize max for fullscreen)',
    category: 'sys',
    execute: (ctx) => {
      const isMax = ctx.args.includes('max');
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
  {
    name: 'time',
    description: 'Time a simple command or give resource usage',
    category: 'sys',
    execute: async (ctx) => {
      if (ctx.args.length === 0) {
        return {
          stdout: '\nreal\t0m0.000s\nuser\t0m0.000s\nsys\t0m0.000s\n',
          stderr: '',
          exitCode: 0,
        };
      }

      const subCommandStr = ctx.args.join(' ');
      const startMs = performance.now();

      // Dynamically import globalShellEngine to avoid circular dependency
      const { globalShellEngine } = await import('../shellEngine');
      const result = await globalShellEngine.execute(subCommandStr);

      const endMs = performance.now();
      const durationSec = (endMs - startMs) / 1000;

      const mins = Math.floor(durationSec / 60);
      const secs = (durationSec % 60).toFixed(3).padStart(6, '0');

      const realStr = `${mins}m${secs}s`;
      const userStr = `${mins}m${(durationSec * 0.45).toFixed(3).padStart(6, '0')}s`;
      const sysStr = `${mins}m${(durationSec * 0.15).toFixed(3).padStart(6, '0')}s`;

      const timeReport = `\nreal\t${realStr}\nuser\t${userStr}\nsys\t${sysStr}\n`;

      return {
        stdout: result.stdout + timeReport,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    },
  },
];
