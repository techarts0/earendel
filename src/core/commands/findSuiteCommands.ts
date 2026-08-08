import { Command } from '../types';
import { globalCommandRegistry } from '../commandRegistry';

export const findSuiteCommands: Command[] = [
  {
    name: 'which',
    description: 'locate a command in PATH',
    category: 'sys',
    execute: (ctx) => {
      const targetCmd = ctx.args[0];
      if (!targetCmd) return { stdout: '', stderr: 'which: missing command argument\n', exitCode: 1 };

      const cmd = globalCommandRegistry.getCommand(targetCmd);
      if (!cmd) {
        return { stdout: '', stderr: `${targetCmd} not found\n`, exitCode: 1 };
      }

      // Standard binary path lookup simulation
      const path = ['python3', 'node', 'docker', 'systemctl', 'apt', 'ufw'].includes(targetCmd)
        ? `/usr/bin/${targetCmd}`
        : `/bin/${targetCmd}`;

      return { stdout: `${path}\n`, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'whereis',
    description: 'locate the binary, source, and manual page files for a command',
    category: 'sys',
    execute: (ctx) => {
      const targetCmd = ctx.args[0];
      if (!targetCmd) return { stdout: '', stderr: 'whereis: missing command argument\n', exitCode: 1 };

      const cmd = globalCommandRegistry.getCommand(targetCmd);
      if (!cmd) {
        return { stdout: `${targetCmd}:\n`, stderr: '', exitCode: 0 };
      }

      const binPath = ['python3', 'node', 'docker', 'systemctl', 'apt', 'ufw'].includes(targetCmd)
        ? `/usr/bin/${targetCmd}`
        : `/bin/${targetCmd}`;

      const manPath = `/usr/share/man/man1/${targetCmd}.1.gz`;

      return { stdout: `${targetCmd}: ${binPath} ${manPath}\n`, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'find',
    description: 'search for files in a directory hierarchy',
    category: 'file',
    execute: (ctx) => {
      let startPath = '.';
      let pattern = '*';

      const nameIdx = ctx.args.indexOf('-name');
      if (nameIdx !== -1 && ctx.args[nameIdx + 1]) {
        pattern = ctx.args[nameIdx + 1].replace(/^["']|["']$/g, '');
        if (nameIdx > 0 && !ctx.args[0].startsWith('-')) {
          startPath = ctx.args[0];
        }
      } else if (ctx.args[0] && !ctx.args[0].startsWith('-')) {
        startPath = ctx.args[0];
      }

      const results: string[] = [];

      const walk = (pathStr: string) => {
        const node = ctx.vfs.getNodeByPath(pathStr);
        if (!node) return;

        // Pattern matching simple wildcard
        const regexStr = '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$';
        const regex = new RegExp(regexStr);

        if (regex.test(node.name || '')) {
          results.push(pathStr);
        }

        if (node.type === 'directory' && node.children) {
          for (const childName of node.children.keys()) {
            const childPath = pathStr === '/' ? `/${childName}` : `${pathStr}/${childName}`;
            walk(childPath);
          }
        }
      };

      walk(startPath);

      return { stdout: results.join('\n') + (results.length ? '\n' : ''), stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'locate',
    description: 'find files by name from system index',
    category: 'file',
    execute: (ctx) => {
      const pattern = ctx.args[0];
      if (!pattern) return { stdout: '', stderr: 'locate: no pattern to search for specified\n', exitCode: 1 };

      const results: string[] = [];

      const walkAll = (pathStr: string) => {
        const node = ctx.vfs.getNodeByPath(pathStr);
        if (!node) return;

        if ((node.name || '').includes(pattern) || pathStr.includes(pattern)) {
          results.push(pathStr);
        }

        if (node.type === 'directory' && node.children) {
          for (const childName of node.children.keys()) {
            const childPath = pathStr === '/' ? `/${childName}` : `${pathStr}/${childName}`;
            walkAll(childPath);
          }
        }
      };

      walkAll('/');

      return { stdout: results.join('\n') + (results.length ? '\n' : ''), stderr: '', exitCode: 0 };
    },
  },
];
