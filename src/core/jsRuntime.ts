// Earendel JavaScript Dynamic Closure Runtime Engine
import { Command, ExecutionContext, ExecutionResult } from './types';

export class JsRuntimeEngine {
  /**
   * Safely instantiates and executes a dynamic JavaScript package closure
   */
  public async executeJsBundle(
    codeStr: string,
    ctx: ExecutionContext
  ): Promise<ExecutionResult> {
    let stdoutBuffer = '';
    let stderrBuffer = '';

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
      // Evaluate JS closure bundle passing ExecutionContext and custom console
      const runner = new Function(
        'ctx',
        'console',
        'process',
        `"use strict";\n${codeStr}\nif (typeof main === 'function') return main(ctx);\nif (typeof execute === 'function') return execute(ctx);`
      );

      const res = await runner(ctx, customConsole, { env: ctx.env, argv: [ctx.args[0] || 'node', ...ctx.args] });

      if (res && typeof res === 'object') {
        return {
          stdout: (res.stdout || stdoutBuffer) + (res.stdout ? '' : ''),
          stderr: res.stderr || stderrBuffer,
          exitCode: typeof res.exitCode === 'number' ? res.exitCode : 0,
        };
      }

      return { stdout: stdoutBuffer, stderr: stderrBuffer, exitCode: 0 };
    } catch (e: any) {
      return {
        stdout: stdoutBuffer,
        stderr: `\x1b[31m[JS Runtime Exception]: ${e.message}\x1b[0m\n${stderrBuffer}`,
        exitCode: 1,
      };
    }
  }
}

export const globalJsEngine = new JsRuntimeEngine();
