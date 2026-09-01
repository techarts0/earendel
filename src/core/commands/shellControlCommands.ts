// Behavioral Shell Scripting & Control Flow Commands for Earendel
import { Command } from '../types';

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
    description: 'Read a line from standard input (-p prompt)',
    category: 'sys',
    execute: (ctx) => {
      let prompt = '';
      let varName = 'REPLY';

      const pIdx = ctx.args.indexOf('-p');
      if (pIdx !== -1 && ctx.args[pIdx + 1]) {
        prompt = ctx.args[pIdx + 1];
        varName = ctx.args[pIdx + 2] || 'REPLY';
      } else {
        varName = ctx.args[0] || 'REPLY';
      }

      const inputVal = ctx.pipeInput || 'Earendel Explorer';
      ctx.env[varName] = inputVal;

      return {
        stdout: prompt ? `${prompt}${inputVal}\n` : '',
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

      const content = ctx.vfs.readFile(scriptPath);
      if (content === null) return { stdout: '', stderr: `source: ${scriptPath}: file not found\n`, exitCode: 1 };

      const { globalShellEngine } = await import('../shellEngine');
      return await globalShellEngine.execute(content, [scriptPath, ...ctx.args.slice(1)]);
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

      const curDirName = ctx.vfs.currentDirectory?.name || '/home/hello';
      const absPath = testFile.startsWith('/') ? testFile : `${curDirName}/${testFile}`.replace(/\/+/g, '/');
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
