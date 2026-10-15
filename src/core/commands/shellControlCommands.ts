// Behavioral Shell Scripting & Control Flow Commands for Earendel
import { Command } from '../types';
import { SyscallNo } from '../../kernel/types';
import { syscallAs } from '../../kernel/syscall';
import { createCapabilityVfsView } from '../scopedVfs';

async function runNestedBash(ctx: any, content: string, args: string[]): Promise<any> {
  const fork = await ctx.syscall(SyscallNo.SYS_FORK, 'bash', ctx.vfs.getPwd());
  if (fork.code !== 0 || typeof fork.data !== 'number') {
    return { stdout: '', stderr: `bash: fork failed: ${fork.error || 'unknown error'}\n`, exitCode: 1 };
  }

  const childPid = fork.data as number;
  let result: any = { stdout: '', stderr: '', exitCode: 1 };
  try {
    const { ShellEngine } = await import('../shellEngine');
    const childVfs = createCapabilityVfsView(ctx.vfs, childPid, ctx.env.USER || 'hello');
    const childShell = new ShellEngine(childVfs, ctx.processManager);
    childShell.callerPid = childPid;
    childShell.lang = ctx.lang;
    childShell.abortSignal = ctx.abortSignal;
    for (const [key, value] of Object.entries(ctx.env)) childShell.setEnv(key, value as string);
    result = await childShell.execute(content, args);
  } catch (error: any) {
    result = { stdout: '', stderr: `bash: ${error?.message || String(error)}\n`, exitCode: 1 };
  } finally {
    await syscallAs(childPid, SyscallNo.SYS_EXIT, result.exitCode);
    await ctx.syscall(SyscallNo.SYS_WAITPID, childPid);
  }
  return result;
}

function quoteShellArgument(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// POSIX test / [ Expression Evaluator
function evaluateTestExpr(tokens: string[], ctx: any): boolean {
  if (tokens.length === 0) return false;
  if (tokens.length === 1) return tokens[0] !== '';

  // Handle -o (logical OR, lower precedence than -a)
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '-o') {
      const left = evaluateTestExpr(tokens.slice(0, i), ctx);
      const right = evaluateTestExpr(tokens.slice(i + 1), ctx);
      return left || right;
    }
  }

  // Handle -a (logical AND)
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '-a') {
      const left = evaluateTestExpr(tokens.slice(0, i), ctx);
      const right = evaluateTestExpr(tokens.slice(i + 1), ctx);
      return left && right;
    }
  }

  // Handle ! (NOT)
  if (tokens[0] === '!') {
    return !evaluateTestExpr(tokens.slice(1), ctx);
  }

  // Handle parenthesized expressions ( expr )
  if (tokens[0] === '(' && tokens[tokens.length - 1] === ')') {
    return evaluateTestExpr(tokens.slice(1, tokens.length - 1), ctx);
  }

  // Unary operators (2 arguments)
  if (tokens.length === 2) {
    const op = tokens[0];
    const target = tokens[1];
    const user = ctx.env?.['USER'] || 'hello';

    if (op === '-z') return target === '';
    if (op === '-n') return target !== '';

    const node = ctx.vfs.getNodeByPath(target, user);
    if (op === '-e') return node !== null;
    if (op === '-f') return node !== null && node.type === 'file';
    if (op === '-d') return node !== null && node.type === 'directory';
    if (op === '-L' || op === '-h') return node !== null && node.type === 'symlink';
    if (op === '-s') return node !== null && node.size > 0;
    if (op === '-r') return node !== null && ctx.vfs.checkPermission(node, 'r', user);
    if (op === '-w') return node !== null && ctx.vfs.checkPermission(node, 'w', user);
    if (op === '-x') return node !== null && (node.permissions?.includes('x') || ctx.vfs.checkPermission(node, 'x', user));
  }

  // Binary operators (3 arguments)
  if (tokens.length === 3) {
    const left = tokens[0];
    const op = tokens[1];
    const right = tokens[2];

    if (op === '=' || op === '==') return left === right;
    if (op === '!=') return left !== right;

    const numLeft = parseInt(left, 10);
    const numRight = parseInt(right, 10);
    if (!isNaN(numLeft) && !isNaN(numRight)) {
      if (op === '-eq') return numLeft === numRight;
      if (op === '-ne') return numLeft !== numRight;
      if (op === '-gt') return numLeft > numRight;
      if (op === '-ge') return numLeft >= numRight;
      if (op === '-lt') return numLeft < numRight;
      if (op === '-le') return numLeft <= numRight;
    }
  }

  return false;
}

export const shellControlCommands: Command[] = [
  {
    name: 'run',
    description: 'Bats helper: execute a command and capture its status and combined output',
    category: 'sys',
    execute: async (ctx) => {
      if (!ctx.args.length) return { stdout: '', stderr: 'run: command required\n', exitCode: 2 };
      if (!ctx.shellEngine || typeof ctx.shellEngine.setEnv !== 'function') {
        return { stdout: '', stderr: 'run: no active shell context\n', exitCode: 2 };
      }
      const commandLine = ctx.args.map(quoteShellArgument).join(' ');
      const result = await runNestedBash(ctx, commandLine, []);
      const output = `${result.stdout || ''}${result.stderr || ''}`.replace(/\n$/, '');
      ctx.shellEngine.setEnv('status', String(result.exitCode));
      ctx.shellEngine.setEnv('output', output);
      ctx.shellEngine.setArray?.('lines', output ? output.split(/\r?\n/) : []);
      return { stdout: '', stderr: '', exitCode: result.exitCode };
    },
  },
  {
    name: 'test',
    aliases: ['['],
    description: 'Check file types and compare values according to POSIX test specification',
    category: 'sys',
    execute: (ctx) => {
      let args = [...ctx.args];
      if (args.length > 0 && args[args.length - 1] === ']') {
        args = args.slice(0, args.length - 1);
      }
      const isTrue = evaluateTestExpr(args, ctx);
      return { stdout: '', stderr: '', exitCode: isTrue ? 0 : 1 };
    },
  },
  {
    name: 'exit',
    description: 'Cause the shell to exit with a status of N',
    category: 'sys',
    execute: (ctx) => {
      const code = parseInt(ctx.args[0] || '0', 10);
      return { stdout: 'logout\n', stderr: '', exitCode: isNaN(code) ? 0 : code };
    },
  },
  {
    name: 'read',
    description: 'Read a line from standard input (-p prompt, -a array)',
    category: 'sys',
    execute: async (ctx) => {
      let prompt = '';
      let isArray = false;
      let charLimit: number | undefined;
      let varName = 'REPLY';

      let i = 0;
      while (i < ctx.args.length) {
        if (ctx.args[i] === '-p' && ctx.args[i + 1] !== undefined) {
          prompt = ctx.args[i + 1];
          i += 2;
        } else if (ctx.args[i] === '-a' && ctx.args[i + 1] !== undefined) {
          isArray = true;
          varName = ctx.args[i + 1];
          i += 2;
        } else if (ctx.args[i] === '-n' && ctx.args[i + 1] !== undefined) {
          charLimit = Math.max(0, parseInt(ctx.args[i + 1], 10) || 0);
          i += 2;
        } else {
          varName = ctx.args[i];
          i++;
        }
      }

      let inputVal = '';
      if (ctx.pipeInput !== undefined && ctx.pipeInput !== '') {
        inputVal = ctx.pipeInput.replace(/\r?\n$/, '');
      } else if (ctx.shellEngine && ctx.shellEngine.promptHandler) {
        inputVal = await ctx.shellEngine.promptHandler(prompt);
      } else {
        inputVal = 'q'; // safe default when non-interactive
      }

      if (isArray) {
        const parts = inputVal.trim() ? inputVal.trim().split(/\s+/) : [];
        if (ctx.shellEngine && ctx.shellEngine.setArray) {
          ctx.shellEngine.setArray(varName, parts);
        } else {
          parts.forEach((p, idx) => {
            ctx.env[`${varName}[${idx}]`] = p;
          });
        }
      } else {
        if (charLimit !== undefined) inputVal = inputVal.slice(0, charLimit);
        ctx.env[varName] = inputVal;
      }

      return {
        stdout: prompt && !ctx.shellEngine?.promptHandler ? `${prompt}${inputVal}\n` : '',
        stderr: '',
        exitCode: 0,
      };
    },
  },
  {
    name: 'source',
    aliases: ['.'],
    description: 'Execute commands from a file in the current shell',
    category: 'sys',
    execute: async (ctx) => {
      const scriptPath = ctx.args[0];
      if (!scriptPath) return { stdout: '', stderr: 'source: filename argument required\n', exitCode: 1 };

      const activeUser = ctx.env['USER'] || 'hello';
      const resolvedPath = ctx.vfs.resolvePath(scriptPath, activeUser);
      const content = ctx.vfs.readFile(resolvedPath, activeUser);
      if (content === null) return { stdout: '', stderr: `source: ${scriptPath}: file not found\n`, exitCode: 1 };

      if (ctx.shellEngine && ctx.shellEngine.callerPid === ctx.callerPid) {
        return await ctx.shellEngine.execute(content, [resolvedPath, ...ctx.args.slice(1)]);
      }
      return await runNestedBash(ctx, content, [resolvedPath, ...ctx.args.slice(1)]);
    },
  },
  {
    name: 'bash',
    aliases: ['sh'],
    description: 'GNU Bourne-Again SHell interpreter',
    category: 'sys',
    execute: async (ctx) => {
      if (ctx.args.length === 0) {
        return {
          stdout: 'GNU bash, version 5.2.15(1)-release (x86_64-pc-linux-gnu)\nType "exit" to exit, or run scripts with: bash script.sh\n',
          stderr: '',
          exitCode: 0,
        };
      }

      if (ctx.args.includes('--version') || ctx.args.includes('-v')) {
        return {
          stdout: 'GNU bash, version 5.2.15(1)-release (x86_64-pc-linux-gnu)\nCopyright (C) 2022 Free Software Foundation, Inc.\nLicense GPLv3+: GNU GPL version 3 or later <http://gnu.org/licenses/gpl.html>\n',
          stderr: '',
          exitCode: 0,
        };
      }

      if (ctx.args[0] === '-c') {
        const cmdStr = ctx.args.slice(1).join(' ');
        return await runNestedBash(ctx, cmdStr, []);
      }

      // Execute script file
      const scriptPath = ctx.args[0];
      const activeUser = ctx.env['USER'] || 'hello';
      const resolvedPath = ctx.vfs.resolvePath(scriptPath, activeUser);
      const content = ctx.vfs.readFile(resolvedPath, activeUser);
      if (content === null) {
        return { stdout: '', stderr: `bash: ${scriptPath}: No such file or directory\n`, exitCode: 127 };
      }

      return await runNestedBash(ctx, content, [resolvedPath, ...ctx.args.slice(1)]);
    },
  },
  {
    name: 'bats',
    description: 'Bash Automated Testing System (TAP-compliant test runner)',
    category: 'sys',
    execute: async (ctx) => {
      const target = ctx.args[0];
      if (!target || target === '-h' || target === '--help') {
        return {
          stdout: [
            '\x1b[1;36mBats (Bash Automated Testing System) v1.0.0\x1b[0m',
            'Usage: bats <test_script.bats | test_script.sh> [options]',
            '',
            'Options:',
            '  -t, --tap     Output in TAP (Test Anything Protocol) format',
            '  -h, --help    Display help information',
          ].join('\n') + '\n',
          stderr: '',
          exitCode: 0,
        };
      }

      const isTapOnly = ctx.args.includes('-t') || ctx.args.includes('--tap');
      const testFile = ctx.args.find((a) => !a.startsWith('-'));

      if (!testFile) {
        return { stdout: '', stderr: 'bats: error: no test file specified\n', exitCode: 1 };
      }

      const absPath = ctx.vfs.resolvePath(testFile, ctx.env.USER || 'hello');
      const node = ctx.vfs.getNodeByPath(absPath);
      if (!node || node.type !== 'file') {
        return { stdout: '', stderr: `bats: error: file '${testFile}' not found\n`, exitCode: 1 };
      }

      const { BatsTestEngine } = await import('../batsTestEngine');
      const cwd = absPath.substring(0, absPath.lastIndexOf('/')) || '/home/hello';
      const outcome = await BatsTestEngine.runBatsScript(node.content || '', ctx, { cwd });

      if (isTapOnly) {
        return {
          stdout: outcome.tapOutput + '\n',
          stderr: '',
          exitCode: outcome.exitCode,
        };
      }

      return {
        stdout: outcome.logs + '\n',
        stderr: '',
        exitCode: outcome.exitCode,
      };
    },
  },
];
