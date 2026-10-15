import { Command } from '../types';
import { globalTaskScheduler, SchedPolicy } from '../../kernel/taskScheduler';

let kernelConfigs: Record<string, string | number | boolean> = {
  CONFIG_IPC_TRACE: true,
  CONFIG_CAPABILITY: true,
  CONFIG_NAMESPACES: true,
  CONFIG_ZEROCOPY_IPC: false,
  CONFIG_SW_KERNEL: false,
  CONFIG_MAX_PROCESSES: 1024,
  CONFIG_IPC_LOG_CAPACITY: 500,
};

export const kconfigCommands: Command[] = [
  {
    name: 'sched-policy',
    description: 'display or switch microkernel process scheduling policy',
    category: 'sys',
    execute: (ctx) => {
      const sub = ctx.args[0];

      if (!sub || sub === 'list') {
        const curr = globalTaskScheduler.getPolicy();
        let out = `Available logical scheduling policy labels (browser tasks are not preemptively scheduled):\n`;
        out += `  FIFO      - First In, First Out ${curr === 'FIFO' ? '\x1b[32m[ACTIVE]\x1b[0m' : ''}\n`;
        out += `  RR        - Round Robin (Time Quantum 50ms) ${curr === 'RR' ? '\x1b[32m[ACTIVE]\x1b[0m' : ''}\n`;
        out += `  CFS       - Completely Fair Scheduler (Linux Default) ${curr === 'CFS' ? '\x1b[32m[ACTIVE]\x1b[0m' : ''}\n`;
        out += `  PRIORITY  - Static Priority Scheduling ${curr === 'PRIORITY' ? '\x1b[32m[ACTIVE]\x1b[0m' : ''}\n\n`;
        out += `Usage: sched-policy set <FIFO|RR|CFS|PRIORITY>\n`;
        return { stdout: out, stderr: '', exitCode: 0 };
      }

      if (sub === 'set') {
        const targetPolicy = (ctx.args[1] || '').toUpperCase() as SchedPolicy;
        if (!['FIFO', 'RR', 'CFS', 'PRIORITY'].includes(targetPolicy)) {
          return { stdout: '', stderr: `sched-policy: invalid policy '${ctx.args[1]}'\nChoose from: FIFO, RR, CFS, PRIORITY\n`, exitCode: 1 };
        }
        globalTaskScheduler.setPolicy(targetPolicy);
        return { stdout: `Logical scheduler policy set to \x1b[1;32m${targetPolicy}\x1b[0m. This does not change browser task execution.\n`, stderr: '', exitCode: 0 };
      }

      return { stdout: 'Usage: sched-policy [list|set <policy>]\n', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'sched-stat',
    description: 'display scheduler statistics and context switches per process',
    category: 'sys',
    execute: () => {
      const stats = globalTaskScheduler.getSchedStats();
      let out = `Earendel Simulated Task Scheduler State (Policy label: ${globalTaskScheduler.getPolicy()}):\n`;
      out += `CPU time, wait time, and kernel priority are unavailable in this cooperative browser simulation.\n\n`;
      out += `  PID POLICY   PRIO   CPU-TIME   WAIT-TIME   STATE-CHANGES   PROCESS NAME\n`;
      out += `--------------------------------------------------------------------------\n`;
      for (const s of stats) {
        const prio = s.prio === null ? 'N/A' : String(s.prio);
        const cpuTime = s.cpuTimeSec === null ? 'N/A' : `${s.cpuTimeSec.toFixed(2)}s`;
        const waitTime = s.waitTimeSec === null ? 'N/A' : `${s.waitTimeSec.toFixed(2)}s`;
        out += `${s.pid.toString().padStart(5, ' ')} ${s.policy.padEnd(8, ' ')} ${prio.padStart(4, ' ')}  ${cpuTime.padStart(6, ' ')}  ${waitTime.padStart(8, ' ')} ${s.stateTransitions.toString().padStart(13, ' ')}   ${s.name}\n`;
      }
      return { stdout: out, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'kconfig',
    description: 'show or configure microkernel build parameters (make menuconfig equivalent)',
    category: 'sys',
    execute: (ctx) => {
      const sub = ctx.args[0] || 'show';

      if (sub === 'show') {
        let out = `\x1b[1;36mEarendel POSIX Microkernel Build Configuration (kconfig)\x1b[0m:\n\n`;
        for (const [k, v] of Object.entries(kernelConfigs)) {
          const valStr = typeof v === 'boolean' ? (v ? '\x1b[32m[y]\x1b[0m' : '\x1b[90m[n]\x1b[0m') : `[${v}]`;
          out += `  ${valStr} ${k}\n`;
        }
        out += `\nUsage: kconfig set <CONFIG_KEY> <y|n|val>\n`;
        return { stdout: out, stderr: '', exitCode: 0 };
      }

      if (sub === 'set') {
        const key = ctx.args[1];
        const val = ctx.args[2];
        if (!key || val === undefined) {
          return { stdout: '', stderr: 'kconfig set: missing KEY or VALUE\nUsage: kconfig set CONFIG_KEY <y|n|val>\n', exitCode: 1 };
        }
        if (!(key in kernelConfigs)) {
          return { stdout: '', stderr: `kconfig: unknown configuration key '${key}'\n`, exitCode: 1 };
        }
        kernelConfigs[key] = val === 'y' ? true : val === 'n' ? false : val;
        return { stdout: `Updated \x1b[32m${key}\x1b[0m = ${kernelConfigs[key]}\nRebuilding microkernel subsystem...\n`, stderr: '', exitCode: 0 };
      }

      return { stdout: 'Usage: kconfig [show|set KEY VAL]\n', stderr: '', exitCode: 0 };
    },
  },
];
