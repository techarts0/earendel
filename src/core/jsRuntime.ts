import { Command, ExecutionContext, ExecutionResult } from './types';
import { syscall } from '../kernel/syscall';
import { SyscallNo } from '../kernel/types';
import { globalVMPageTable } from '../kernel/vmPageTable';

export class JsRuntimeEngine {
  /**
   * Safely instantiates and executes a dynamic JavaScript package closure
   */
  public async executeJsBundle(
    codeStr: string,
    ctx: ExecutionContext
  ): Promise<ExecutionResult> {
    const forkRes = await syscall(SyscallNo.SYS_FORK, 'node', '/home/hello');
    const childPid = forkRes.data || 302;
    globalVMPageTable.allocatePage(Math.floor(childPid / 10));

    let stdoutBuffer = '';
    let stderrBuffer = '';

    // Strip Hashbang/Shebang (e.g. #!/usr/bin/env node)
    const cleanCodeStr = codeStr.replace(/^#!.*(\r?\n|$)/, '');

    // Create virtualized console to capture stdout/stderr from dynamic JS packages
    const customConsole = {
      log: (...args: any[]) => {
        stdoutBuffer += args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ') + '\n';
      },
      error: (...args: any[]) => {
        stderrBuffer += args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ') + '\n';
      },
      warn: (...args: any[]) => {
        stdoutBuffer += '\x1b[33m' + args.join(' ') + '\x1b[0m\n';
      },
    };

    try {
      const runnerCode = [
        cleanCodeStr,
        'if (typeof main === "function") return main(ctx, eslib);',
        'if (typeof execute === "function") return execute(ctx, eslib);',
      ].join('\n');

      // Evaluate JS closure bundle passing ExecutionContext, eslib, syscall and custom console
      const runner = new Function(
        'ctx',
        'console',
        'process',
        'syscall',
        'eslib',
        runnerCode
      );

      const eslibObj = {
        sys: {
          read: (path: string) => syscall(SyscallNo.SYS_READ, path),
          write: (path: string, content: string) => syscall(SyscallNo.SYS_WRITE, path, content),
          fork: (name: string, cwd: string) => syscall(SyscallNo.SYS_FORK, name, cwd),
          execve: (path: string, args: string[]) => syscall(SyscallNo.SYS_EXECVE, path, args),
          exit: (code: number) => syscall(SyscallNo.SYS_EXIT, code),
          getpid: () => syscall(SyscallNo.SYS_GETPID),
        },
        io: {
          printf: (fmt: any, ...args: any[]) => {
            let str = String(fmt);
            args.forEach((a) => {
              str = str.replace('%s', String(a)).replace('%d', String(a));
            });
            stdoutBuffer += str + '\n';
            return str;
          },
        },
        mem: {
          malloc: (sizeBytes: number) => ({ ptr: Math.floor(Math.random() * 0x100000), size: sizeBytes }),
        },
      };

      const res = await runner(
        ctx,
        customConsole,
        { env: ctx.env, argv: [ctx.args[0] || 'node', ...ctx.args] },
        syscall,
        eslibObj
      );

      if (res && typeof res === 'object') {
        await syscall(SyscallNo.SYS_EXIT, childPid);
        return {
          stdout: (res.stdout || stdoutBuffer) + (res.stdout ? '' : ''),
          stderr: res.stderr || stderrBuffer,
          exitCode: typeof res.exitCode === 'number' ? res.exitCode : 0,
        };
      }

      await syscall(SyscallNo.SYS_EXIT, childPid);
      return { stdout: stdoutBuffer, stderr: stderrBuffer, exitCode: 0 };
    } catch (e: any) {
      await syscall(SyscallNo.SYS_EXIT, childPid);
      return {
        stdout: stdoutBuffer,
        stderr: `\x1b[31m[JS Runtime Exception]: ${e.message}\x1b[0m\n${stderrBuffer}`,
        exitCode: 1,
      };
    }
  }
}

export const globalJsEngine = new JsRuntimeEngine();
