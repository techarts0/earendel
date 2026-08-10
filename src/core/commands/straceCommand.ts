import { Command } from '../types';
import { setSyscallTracer, SyscallTraceEntry } from '../../kernel/syscall';

export const straceCommand: Command = {
  name: 'strace',
  description: 'Trace system calls and signals',
  category: 'sys',
  execute: async (ctx) => {
    const subCmdStr = ctx.args.join(' ');
    if (!subCmdStr) {
      return { stdout: '', stderr: 'strace: must have PROG [ARGS]\nUsage: strace command [args]\n', exitCode: 1 };
    }

    const traceLogs: string[] = [];
    const tracerHook = (entry: SyscallTraceEntry) => {
      traceLogs.push(`${entry.name}(${entry.argsStr}) = ${entry.retvalStr}`);
    };

    setSyscallTracer(tracerHook);

    let res = { stdout: '', stderr: '', exitCode: 0 };
    try {
      const { globalCommandRegistry } = await import('../commandRegistry');
      res = await globalCommandRegistry.execute(ctx.args[0], {
        ...ctx,
        args: ctx.args.slice(1),
      });
    } finally {
      setSyscallTracer(null);
    }

    let output = '';
    if (traceLogs.length > 0) {
      output += traceLogs.map((l) => `\x1b[33m${l}\x1b[0m`).join('\n') + '\n';
    }
    output += res.stdout;

    return {
      stdout: output,
      stderr: res.stderr,
      exitCode: res.exitCode,
    };
  },
};
