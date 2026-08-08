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
];
