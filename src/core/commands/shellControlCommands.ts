// Behavioral Shell Scripting & Control Flow Commands for Earendel
import { Command } from '../types';

export const shellControlCommands: Command[] = [
  {
    name: 'test',
    aliases: ['['],
    description: 'Check file types and compare values',
    category: 'sys',
    execute: (ctx) => {
      const args = ctx.args.filter((a) => a !== ']');
      if (args.length === 0) return { stdout: '', stderr: '', exitCode: 1 };

      let isTrue = false;

      // File tests
      if (args[0] === '-f' && args[1]) {
        const node = ctx.vfs.getNodeByPath(args[1]);
        isTrue = node !== null && node.type === 'file';
      } else if (args[0] === '-d' && args[1]) {
        const node = ctx.vfs.getNodeByPath(args[1]);
        isTrue = node !== null && node.type === 'directory';
      } else if (args[0] === '-e' && args[1]) {
        const node = ctx.vfs.getNodeByPath(args[1]);
        isTrue = node !== null;
      } else if (args[0] === '-z' && args[1]) {
        isTrue = (args[1] ?? '') === '';
      } else if (args[0] === '-n' && args[1]) {
        isTrue = (args[1] ?? '') !== '';
      } else if (args.length >= 3) {
        const left = args[0];
        const op = args[1];
        const right = args[2];

        const numLeft = parseFloat(left);
        const numRight = parseFloat(right);

        if (!isNaN(numLeft) && !isNaN(numRight)) {
          if (op === '-eq') isTrue = numLeft === numRight;
          else if (op === '-ne') isTrue = numLeft !== numRight;
          else if (op === '-gt') isTrue = numLeft > numRight;
          else if (op === '-ge') isTrue = numLeft >= numRight;
          else if (op === '-lt') isTrue = numLeft < numRight;
          else if (op === '-le') isTrue = numLeft <= numRight;
          else if (op === '=') isTrue = left === right;
          else if (op === '!=') isTrue = left !== right;
        } else {
          if (op === '=') isTrue = left === right;
          else if (op === '!=') isTrue = left !== right;
        }
      }

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
