import { Command } from '../types';
import { globalJsEngine } from '../jsRuntime';

export const nodeCommands: Command[] = [
  {
    name: 'node',
    aliases: ['js'],
    description: 'Node.js JavaScript runtime environment',
    category: 'sys',
    execute: async (ctx) => {
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

      return await globalJsEngine.executeJsBundle(node.content || '', ctx);
    },
  },
];
