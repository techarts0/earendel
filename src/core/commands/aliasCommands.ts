import { Command } from '../types';
import { globalShellEngine } from '../shellEngine';

export const aliasCommands: Command[] = [
  {
    name: 'alias',
    description: 'Define or display aliases',
    category: 'sys',
    execute: (ctx) => {
      const arg = ctx.args.join(' ');

      // 1. List all active aliases
      if (!arg) {
        const aliases = globalShellEngine.getAliases();
        let out = '';
        aliases.forEach((target, name) => {
          out += `alias ${name}='${target}'\n`;
        });
        return { stdout: out, stderr: '', exitCode: 0 };
      }

      // 2. Define new alias (alias ll='ls -la')
      if (arg.includes('=')) {
        const eqIdx = arg.indexOf('=');
        const name = arg.substring(0, eqIdx).trim();
        const target = arg.substring(eqIdx + 1).trim().replace(/^["']|["']$/g, '');

        if (!name || !target) {
          return { stdout: '', stderr: 'alias: invalid syntax\n', exitCode: 1 };
        }

        globalShellEngine.setAlias(name, target);
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      // 3. Query specific alias
      const aliases = globalShellEngine.getAliases();
      if (aliases.has(arg)) {
        return { stdout: `alias ${arg}='${aliases.get(arg)}'\n`, stderr: '', exitCode: 0 };
      }

      return { stdout: '', stderr: `bash: alias: ${arg}: not found\n`, exitCode: 1 };
    },
  },
  {
    name: 'unalias',
    description: 'Remove alias definitions',
    category: 'sys',
    execute: (ctx) => {
      const target = ctx.args[0];
      if (!target) {
        return { stdout: '', stderr: 'unalias: usage: unalias [-a] name [name ...]\n', exitCode: 1 };
      }

      const ok = globalShellEngine.removeAlias(target);
      if (!ok) {
        return { stdout: '', stderr: `bash: unalias: ${target}: not found\n`, exitCode: 1 };
      }

      return { stdout: '', stderr: '', exitCode: 0 };
    },
  },
];
