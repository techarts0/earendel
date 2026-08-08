import { Command } from '../types';
import { globalPythonEngine } from '../pythonEngine';

export const pythonCommands: Command[] = [
  {
    name: 'python3',
    aliases: ['python'],
    description: 'Python 3 language interpreter',
    category: 'sys',
    execute: (ctx) => {
      const targetFile = ctx.args.find((a) => !a.startsWith('-'));

      if (!targetFile) {
        return {
          stdout: `Python 3.10.12 (main, Jun 11 2023, 05:25:24) [GCC 11.4.0] on linux\nType "help", "copyright", "credits" or "license" for more information.\n>>> \x1b[32m[Use "python3 script.py" to run Python script files]\x1b[0m\n`,
          stderr: '',
          exitCode: 0,
        };
      }

      const node = ctx.vfs.getNodeByPath(targetFile);
      if (!node || node.type !== 'file') {
        return { stdout: '', stderr: `python3: can't open file '${targetFile}': [Errno 2] No such file or directory\n`, exitCode: 2 };
      }

      const scriptArgs = ctx.args.slice(ctx.args.indexOf(targetFile) + 1);
      const res = globalPythonEngine.executeScript(node.content || '', scriptArgs);
      return res;
    },
  },
];
