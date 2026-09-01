import { Command } from '../types';
import { globalCommandRegistry } from '../commandRegistry';

export const findSuiteCommands: Command[] = [
  {
    name: 'which',
    description: 'locate a command in PATH (-a for all matching)',
    category: 'sys',
    execute: (ctx) => {
      const showAll = ctx.args.includes('-a') || ctx.args.includes('--all');
      const targets = ctx.args.filter((a) => !a.startsWith('-'));

      if (targets.length === 0) return { stdout: '', stderr: 'which: missing command argument\nUsage: which [-a] filename ...\n', exitCode: 1 };

      let out = '';
      let hadError = false;

      for (const targetCmd of targets) {
        const cmd = globalCommandRegistry.getCommand(targetCmd);
        if (!cmd) {
          out += `${targetCmd} not found\n`;
          hadError = true;
          continue;
        }

        const isUsrBin = ['python3', 'node', 'docker', 'systemctl', 'apt', 'ufw', 'iptables', 'git', 'vim'].includes(targetCmd);
        const primaryPath = isUsrBin ? `/usr/bin/${targetCmd}` : `/bin/${targetCmd}`;
        const altPath = `/usr/local/bin/${targetCmd}`;

        if (showAll) {
          out += `${primaryPath}\n${altPath}\n`;
        } else {
          out += `${primaryPath}\n`;
        }
      }

      return { stdout: out, stderr: '', exitCode: hadError ? 1 : 0 };
    },
  },
  {
    name: 'whereis',
    description: 'locate the binary, source, and manual page files for a command (-b, -m, -s)',
    category: 'sys',
    execute: (ctx) => {
      const binOnly = ctx.args.includes('-b');
      const manOnly = ctx.args.includes('-m');
      const targets = ctx.args.filter((a) => !a.startsWith('-'));

      if (targets.length === 0) return { stdout: '', stderr: 'whereis: missing command argument\nUsage: whereis [-bms] filename ...\n', exitCode: 1 };

      let out = '';

      for (const targetCmd of targets) {
        const cmd = globalCommandRegistry.getCommand(targetCmd);
        if (!cmd) {
          out += `${targetCmd}:\n`;
          continue;
        }

        const binPath = ['python3', 'node', 'docker', 'systemctl', 'apt', 'ufw'].includes(targetCmd)
          ? `/usr/bin/${targetCmd}`
          : `/bin/${targetCmd}`;
        const manPath = `/usr/share/man/man1/${targetCmd}.1.gz`;

        if (binOnly) {
          out += `${targetCmd}: ${binPath}\n`;
        } else if (manOnly) {
          out += `${targetCmd}: ${manPath}\n`;
        } else {
          out += `${targetCmd}: ${binPath} ${manPath}\n`;
        }
      }

      return { stdout: out, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'find',
    description: 'search for files in a directory hierarchy (supports -name, -iname, -type, -maxdepth, -mindepth, -empty, -size, -exec)',
    category: 'file',
    execute: async (ctx) => {
      // Helper: convert glob wildcard to RegExp
      const globToRegex = (glob: string, ignoreCase = false): RegExp => {
        let regexStr = '^';
        for (let i = 0; i < glob.length; i++) {
          const char = glob[i];
          if (char === '*') regexStr += '.*';
          else if (char === '?') regexStr += '.';
          else if (char === '[' || char === ']') regexStr += char;
          else if ('\\.()+^$|{}'.includes(char)) regexStr += '\\' + char;
          else regexStr += char;
        }
        regexStr += '$';
        return new RegExp(regexStr, ignoreCase ? 'i' : '');
      };

      const paths: string[] = [];
      let i = 0;
      while (i < ctx.args.length && !ctx.args[i].startsWith('-') && ctx.args[i] !== '!' && ctx.args[i] !== '(') {
        paths.push(ctx.args[i]);
        i++;
      }

      if (paths.length === 0) {
        paths.push('.');
      }

      // Parse predicates
      let nameRegex: RegExp | null = null;
      let typeFilter: string | null = null; // 'f', 'd', 'l'
      let maxDepth: number | null = null;
      let minDepth: number | null = null;
      let emptyFilter = false;
      let sizeFilter: { op: '+' | '-' | '='; bytes: number } | null = null;
      let execArgs: string[] | null = null;

      for (; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg === '-name' && ctx.args[i + 1]) {
          nameRegex = globToRegex(ctx.args[i + 1].replace(/^["']|["']$/g, ''), false);
          i++;
        } else if (arg === '-iname' && ctx.args[i + 1]) {
          nameRegex = globToRegex(ctx.args[i + 1].replace(/^["']|["']$/g, ''), true);
          i++;
        } else if (arg === '-type' && ctx.args[i + 1]) {
          typeFilter = ctx.args[i + 1];
          i++;
        } else if (arg === '-maxdepth' && ctx.args[i + 1]) {
          maxDepth = parseInt(ctx.args[i + 1], 10);
          i++;
        } else if (arg === '-mindepth' && ctx.args[i + 1]) {
          minDepth = parseInt(ctx.args[i + 1], 10);
          i++;
        } else if (arg === '-empty') {
          emptyFilter = true;
        } else if (arg === '-size' && ctx.args[i + 1]) {
          const val = ctx.args[i + 1];
          let op: '+' | '-' | '=' = '=';
          let numStr = val;
          if (val.startsWith('+') || val.startsWith('-')) {
            op = val[0] as '+' | '-';
            numStr = val.slice(1);
          }
          let multiplier = 512; // POSIX 512-byte blocks by default
          if (numStr.endsWith('c')) {
            multiplier = 1;
            numStr = numStr.slice(0, -1);
          } else if (numStr.endsWith('k') || numStr.endsWith('k')) {
            multiplier = 1024;
            numStr = numStr.slice(0, -1);
          } else if (numStr.endsWith('M')) {
            multiplier = 1024 * 1024;
            numStr = numStr.slice(0, -1);
          } else if (numStr.endsWith('G')) {
            multiplier = 1024 * 1024 * 1024;
            numStr = numStr.slice(0, -1);
          }
          const num = parseInt(numStr, 10) || 0;
          sizeFilter = { op, bytes: num * multiplier };
          i++;
        } else if (arg === '-exec') {
          const subArgs: string[] = [];
          i++;
          while (i < ctx.args.length && ctx.args[i] !== ';') {
            subArgs.push(ctx.args[i]);
            i++;
          }
          execArgs = subArgs;
        }
      }

      const results: string[] = [];
      let stderr = '';
      let exitCode = 0;

      const matchesFilters = (node: any, pathStr: string, depth: number): boolean => {
        if (maxDepth !== null && depth > maxDepth) return false;
        if (minDepth !== null && depth < minDepth) return false;

        if (nameRegex) {
          const baseName = node.name || (pathStr === '/' ? '/' : pathStr.split('/').pop() || '');
          if (!nameRegex.test(baseName)) return false;
        }

        if (typeFilter) {
          if (typeFilter === 'f' && node.type !== 'file') return false;
          if (typeFilter === 'd' && node.type !== 'directory') return false;
          if (typeFilter === 'l' && node.type !== 'symlink') return false;
        }

        if (emptyFilter) {
          if (node.type === 'directory') {
            if (node.children && node.children.size > 0) return false;
          } else if (node.type === 'file') {
            if (node.size > 0) return false;
          }
        }

        if (sizeFilter && node.type === 'file') {
          if (sizeFilter.op === '+' && !(node.size > sizeFilter.bytes)) return false;
          if (sizeFilter.op === '-' && !(node.size < sizeFilter.bytes)) return false;
          if (sizeFilter.op === '=' && !(node.size === sizeFilter.bytes)) return false;
        }

        return true;
      };

      for (const startPath of paths) {
        const rootNode = ctx.vfs.getNodeByPath(startPath);
        if (!rootNode) {
          stderr += `find: '${startPath}': No such file or directory\n`;
          exitCode = 1;
          continue;
        }

        const walk = (node: any, currPath: string, depth: number) => {
          if (maxDepth !== null && depth > maxDepth) return;

          if (matchesFilters(node, currPath, depth)) {
            results.push(currPath);
          }

          if (node.type === 'directory' && node.children) {
            // Sort children alphabetically for consistent traversal
            const childrenMap = node.children as Map<string, any>;
            const childrenEntries: [string, any][] = Array.from(childrenMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
            for (const [childName, childNode] of childrenEntries) {
              const nextPath = currPath === '/' ? `/${childName}` : currPath === '.' ? childName : `${currPath}/${childName}`;
              walk(childNode, nextPath, depth + 1);
            }
          }
        };

        walk(rootNode, startPath, 0);
      }

      if (execArgs && execArgs.length > 0) {
        let execStdout = '';
        for (const resPath of results) {
          const cmdName = execArgs[0];
          const cmdInstance = globalCommandRegistry.getCommand(cmdName);
          if (cmdInstance) {
            const concreteArgs = execArgs.slice(1).map((a) => (a === '{}' ? resPath : a));
            const subRes = await Promise.resolve(cmdInstance.execute({ ...ctx, args: concreteArgs }));
            if (subRes.stdout) execStdout += subRes.stdout;
            if (subRes.stderr) stderr += subRes.stderr;
          }
        }
        return { stdout: execStdout, stderr, exitCode };
      }

      return {
        stdout: results.length > 0 ? results.join('\n') + '\n' : '',
        stderr,
        exitCode,
      };
    },
  },
  {
    name: 'locate',
    description: 'find files by name from system index (-i, -c, -l, -n)',
    category: 'file',
    execute: (ctx) => {
      const flags = new Set<string>();
      let limit: number | null = null;
      let pattern: string | null = null;

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if ((arg === '-l' || arg === '-n' || arg === '--limit') && ctx.args[i + 1]) {
          limit = parseInt(ctx.args[i + 1], 10);
          i++;
        } else if (arg.startsWith('-l=') || arg.startsWith('-n=')) {
          limit = parseInt(arg.slice(3), 10);
        } else if (arg.startsWith('--')) {
          flags.add(arg.slice(2));
        } else if (arg.startsWith('-') && arg.length > 1) {
          for (let j = 1; j < arg.length; j++) flags.add(arg[j]);
        } else if (!pattern) {
          pattern = arg;
        }
      }

      if (!pattern) return { stdout: '', stderr: 'locate: no pattern to search for specified\nUsage: locate [-i] [-c] [-l limit] PATTERN\n', exitCode: 1 };

      const ignoreCase = flags.has('i') || flags.has('ignore-case');
      const countOnly = flags.has('c') || flags.has('count');

      const results: string[] = [];
      const queryPattern = ignoreCase ? pattern.toLowerCase() : pattern;

      const walkAll = (pathStr: string) => {
        const node = ctx.vfs.getNodeByPath(pathStr);
        if (!node) return;

        const targetCompare = ignoreCase ? pathStr.toLowerCase() : pathStr;
        const nameCompare = ignoreCase ? (node.name || '').toLowerCase() : (node.name || '');

        if (nameCompare.includes(queryPattern) || targetCompare.includes(queryPattern)) {
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

      if (countOnly) {
        return { stdout: `${results.length}\n`, stderr: '', exitCode: 0 };
      }

      const outputList = limit !== null && !isNaN(limit) ? results.slice(0, limit) : results;
      return { stdout: outputList.join('\n') + (outputList.length ? '\n' : ''), stderr: '', exitCode: 0 };
    },
  },
];
