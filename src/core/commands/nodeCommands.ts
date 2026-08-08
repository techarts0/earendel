import { Command } from '../types';

export const nodeCommands: Command[] = [
  {
    name: 'node',
    aliases: ['js'],
    description: 'Node.js JavaScript runtime environment',
    category: 'sys',
    execute: (ctx) => {
      const targetFile = ctx.args.find((a) => !a.startsWith('-'));

      if (!targetFile) {
        return {
          stdout: `Welcome to Node.js v18.17.1.\nType ".help" for more information.\n> \x1b[32m[Use "node script.js" to run ES6+ JavaScript files]\x1b[0m\n`,
          stderr: '',
          exitCode: 0,
        };
      }

      const node = ctx.vfs.getNodeByPath(targetFile);
      if (!node || node.type !== 'file') {
        return { stdout: '', stderr: `node: internal/modules/cjs/loader: No such file: ${targetFile}\n`, exitCode: 1 };
      }

      let stdoutAcc = '';
      let stderrAcc = '';
      let exitCode = 0;

      const scriptArgs = ctx.args.slice(ctx.args.indexOf(targetFile) + 1);

      // Custom Sandbox Console & Process
      const customConsole = {
        log: (...args: any[]) => {
          stdoutAcc += args.map((a) => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a))).join(' ') + '\n';
        },
        error: (...args: any[]) => {
          stderrAcc += args.map((a) => String(a)).join(' ') + '\n';
        },
        warn: (...args: any[]) => {
          stdoutAcc += '[WARN] ' + args.map((a) => String(a)).join(' ') + '\n';
        },
      };

      const customProcess = {
        argv: ['node', targetFile, ...scriptArgs],
        env: ctx.env,
      };

      try {
        const fn = new Function('console', 'process', 'require', node.content || '');
        fn(customConsole, customProcess, () => {
          throw new Error('Module require is not implemented in sandbox.');
        });
      } catch (err: any) {
        stderrAcc += `${err.name || 'Uncaught Error'}: ${err.message || String(err)}\n`;
        exitCode = 1;
      }

      return { stdout: stdoutAcc, stderr: stderrAcc, exitCode };
    },
  },
];
