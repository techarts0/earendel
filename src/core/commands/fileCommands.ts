// Behavioral File System Commands for Earendel
import { Command, ExecutionContext, ExecutionResult } from '../types';
import { VFSNode } from '../vfs';
import { syscall } from '../../kernel/syscall';
import { SyscallNo } from '../../kernel/types';

// Helper for POSIX option parsing
function parseFlags(args: string[]) {
  const flags = new Set<string>();
  const positional: string[] = [];
  let endOfOptions = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (endOfOptions) {
      positional.push(arg);
    } else if (arg === '--') {
      endOfOptions = true;
    } else if (arg.startsWith('--')) {
      flags.add(arg.slice(2));
    } else if (arg.startsWith('-') && arg.length > 1) {
      for (let j = 1; j < arg.length; j++) {
        flags.add(arg[j]);
      }
    } else {
      positional.push(arg);
    }
  }

  return { flags, positional };
}

export const fileCommands: Command[] = [
  {
    name: 'pwd',
    description: 'Print name of current/working directory',
    category: 'file',
    execute: (ctx) => {
      return { stdout: ctx.vfs.getPwd() + '\n', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'ls',
    description: 'List directory contents with permissions and details',
    category: 'file',
    execute: async (ctx) => {
      const { flags, positional } = parseFlags(ctx.args);
      const showAll = flags.has('a') || flags.has('all');
      const almostAll = flags.has('A') || flags.has('almost-all');
      const showLong = flags.has('l');
      const humanReadable = flags.has('h') || flags.has('human-readable');
      const onePerLine = flags.has('1');
      const sortByTime = flags.has('t');
      const sortBySize = flags.has('S');
      const reverseSort = flags.has('r') || flags.has('reverse');
      const directorySelf = flags.has('d') || flags.has('directory');
      const classify = flags.has('F') || flags.has('classify');

      const targetPaths = positional.length > 0 ? positional : ['.'];
      const multiTargets = targetPaths.length > 1;

      let totalStdout = '';
      let totalStderr = '';
      let exitCode = 0;

      const formatSize = (bytes: number) => {
        if (!humanReadable) return bytes.toString().padStart(6, ' ');
        if (bytes < 1024) return `${bytes}`.padStart(5, ' ');
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`.padStart(5, ' ');
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`.padStart(5, ' ');
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`.padStart(5, ' ');
      };

      const formatEntryName = (entry: VFSNode) => {
        let name = entry.name;
        if (classify) {
          if (entry.type === 'directory') name += '/';
          else if (entry.type === 'symlink') name += '@';
          else if (entry.permissions.includes('x')) name += '*';
        }
        return name;
      };

      for (let pIdx = 0; pIdx < targetPaths.length; pIdx++) {
        const pathArg = targetPaths[pIdx];
        const openRes = await syscall(SyscallNo.SYS_OPEN, pathArg, 0);
        await syscall(SyscallNo.SYS_STAT, pathArg);

        const targetNode = ctx.vfs.getNodeByPath(pathArg);
        if (!targetNode) {
          if (openRes.data !== undefined) await syscall(SyscallNo.SYS_CLOSE, openRes.data);
          totalStderr += `ls: cannot access '${pathArg}': No such file or directory\n`;
          exitCode = 2;
          continue;
        }

        if (openRes.data !== undefined) {
          await syscall(SyscallNo.SYS_CLOSE, openRes.data);
        }

        if (targetNode.type === 'file' || directorySelf) {
          if (showLong) {
            const isDir = targetNode.type === 'directory' ? 'd' : targetNode.type === 'symlink' ? 'l' : '-';
            const perm = isDir + targetNode.permissions;
            const size = formatSize(targetNode.size);
            const dateStr = targetNode.updatedAt.toLocaleDateString(ctx.lang === 'zh' ? 'zh-CN' : 'en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });
            const displayName = formatEntryName(targetNode);
            const linkTarget = targetNode.symlinkTarget ? ` -> ${targetNode.symlinkTarget}` : '';
            totalStdout += `${perm} 1 ${targetNode.owner} ${targetNode.group} ${size} ${dateStr} ${displayName}${linkTarget}\n`;
          } else {
            totalStdout += formatEntryName(targetNode) + '\n';
          }
          continue;
        }

        if (multiTargets) {
          if (totalStdout.length > 0 && !totalStdout.endsWith('\n\n')) {
            totalStdout += '\n';
          }
          totalStdout += `${pathArg}:\n`;
        }

        if (!targetNode.children) {
          continue;
        }

        let entries = Array.from(targetNode.children.values());

        // Filter hidden files
        if (showAll) {
          const dotNode: VFSNode = {
            id: 'dot',
            name: '.',
            type: 'directory',
            permissions: targetNode.permissions,
            owner: targetNode.owner,
            group: targetNode.group,
            size: targetNode.size,
            updatedAt: targetNode.updatedAt,
            parent: targetNode.parent,
          };
          const dotDotNode: VFSNode = {
            id: 'dotdot',
            name: '..',
            type: 'directory',
            permissions: targetNode.parent ? targetNode.parent.permissions : targetNode.permissions,
            owner: targetNode.parent ? targetNode.parent.owner : targetNode.owner,
            group: targetNode.parent ? targetNode.parent.group : targetNode.group,
            size: targetNode.parent ? targetNode.parent.size : targetNode.size,
            updatedAt: targetNode.parent ? targetNode.parent.updatedAt : targetNode.updatedAt,
            parent: targetNode.parent,
          };
          entries = [dotNode, dotDotNode, ...entries];
        } else if (!almostAll) {
          entries = entries.filter((e) => !e.name.startsWith('.'));
        }

        // Sorting
        if (sortByTime) {
          entries.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        } else if (sortBySize) {
          entries.sort((a, b) => b.size - a.size);
        } else {
          entries.sort((a, b) => a.name.localeCompare(b.name));
        }

        if (reverseSort) {
          entries.reverse();
        }

        if (showLong) {
          let totalBlocks = 0;
          for (const entry of entries) {
            totalBlocks += Math.max(4, Math.ceil(entry.size / 1024) * 4);
          }
          totalStdout += `total ${totalBlocks}\n`;
          for (const entry of entries) {
            const isDir = entry.type === 'directory' ? 'd' : entry.type === 'symlink' ? 'l' : '-';
            const perm = isDir + entry.permissions;
            const size = formatSize(entry.size);
            const dateStr = entry.updatedAt.toLocaleDateString(ctx.lang === 'zh' ? 'zh-CN' : 'en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            });
            const displayName = formatEntryName(entry);
            const linkTarget = entry.symlinkTarget ? ` -> ${entry.symlinkTarget}` : '';
            totalStdout += `${perm} 1 ${entry.owner} ${entry.group} ${size} ${dateStr} ${displayName}${linkTarget}\n`;
          }
        } else if (onePerLine) {
          for (const entry of entries) {
            totalStdout += formatEntryName(entry) + '\n';
          }
        } else {
          const names = entries.map(formatEntryName).join('  ');
          if (names) totalStdout += names + '\n';
        }
      }

      return { stdout: totalStdout, stderr: totalStderr, exitCode };
    },
  },
  {
    name: 'cd',
    description: 'Change the shell working directory',
    category: 'file',
    execute: (ctx) => {
      const user = ctx.env['USER'] || 'hello';
      const homeDir = ctx.env['HOME'] || (user === 'root' ? '/root' : `/home/${user}`);
      let targetPath = ctx.args[0] || homeDir;
      if (targetPath === '~') {
        targetPath = homeDir;
      } else if (targetPath.startsWith('~/')) {
        targetPath = homeDir + targetPath.slice(1);
      } else if (targetPath === '-') {
        targetPath = ctx.env['OLDPWD'] || homeDir;
      }
      const targetNode = ctx.vfs.getNodeByPath(targetPath, user);
      if (targetNode && !ctx.vfs.checkPermission(targetNode, 'x', user)) {
        return { stdout: '', stderr: `bash: cd: ${targetPath}: Permission denied\n`, exitCode: 1 };
      }
      const prevPwd = ctx.vfs.getPwd();
      const ok = ctx.vfs.changeDirectory(targetPath, user);
      if (!ok) {
        return { stdout: '', stderr: `bash: cd: ${targetPath}: No such file or directory\n`, exitCode: 1 };
      }
      ctx.env['OLDPWD'] = prevPwd;
      ctx.env['PWD'] = ctx.vfs.getPwd();
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'mkdir',
    description: 'Create directory',
    category: 'file',
    execute: async (ctx) => {
      const { flags, positional } = parseFlags(ctx.args);
      const pFlag = flags.has('p') || flags.has('parents');
      const vFlag = flags.has('v') || flags.has('verbose');

      // Mode option parsing: -m 755 or --mode=755
      let customMode: string | null = null;
      for (let i = 0; i < ctx.args.length; i++) {
        if (ctx.args[i] === '-m' || ctx.args[i] === '--mode') {
          customMode = ctx.args[i + 1] || null;
        } else if (ctx.args[i].startsWith('-m=')) {
          customMode = ctx.args[i].slice(3);
        } else if (ctx.args[i].startsWith('--mode=')) {
          customMode = ctx.args[i].slice(7);
        }
      }

      if (positional.length === 0) {
        return { stdout: '', stderr: 'mkdir: missing operand\nTry \'mkdir --help\' for more information.\n', exitCode: 1 };
      }

      let stdout = '';
      let stderr = '';
      let exitCode = 0;

      for (const dirName of positional) {
        if (dirName === customMode) continue;
        await syscall(SyscallNo.SYS_STAT, dirName);
        const existingNode = ctx.vfs.getNodeByPath(dirName);
        if (existingNode && !pFlag) {
          stderr += `mkdir: cannot create directory '${dirName}': File exists\n`;
          exitCode = 1;
          continue;
        }

        const ok = ctx.vfs.mkdir(dirName, pFlag);
        if (!ok) {
          stderr += `mkdir: cannot create directory '${dirName}': No such file or directory or invalid path\n`;
          exitCode = 1;
        } else {
          if (customMode) {
            ctx.vfs.chmod(dirName, customMode, false);
          }
          if (vFlag) {
            stdout += `mkdir: created directory '${dirName}'\n`;
          }
        }
      }

      return { stdout, stderr, exitCode };
    },
  },
  {
    name: 'touch',
    description: 'Change file timestamps or create empty file',
    category: 'file',
    execute: async (ctx) => {
      const { flags, positional } = parseFlags(ctx.args);
      const noCreate = flags.has('c') || flags.has('h') || flags.has('no-create');

      // Reference file parsing: -r <ref_file>
      let refFile: string | null = null;
      for (let i = 0; i < ctx.args.length; i++) {
        if (ctx.args[i] === '-r' || ctx.args[i] === '--reference') {
          refFile = ctx.args[i + 1] || null;
        } else if (ctx.args[i].startsWith('--reference=')) {
          refFile = ctx.args[i].slice(12);
        }
      }

      let timestamp = new Date();
      if (refFile) {
        const refNode = ctx.vfs.getNodeByPath(refFile);
        if (refNode) {
          timestamp = refNode.updatedAt;
        } else {
          return { stdout: '', stderr: `touch: failed to get attributes of '${refFile}': No such file or directory\n`, exitCode: 1 };
        }
      }

      const fileTargets = positional.filter((p) => p !== refFile);
      if (fileTargets.length === 0) {
        return { stdout: '', stderr: 'touch: missing operand\nTry \'touch --help\' for more information.\n', exitCode: 1 };
      }

      const user = ctx.env['USER'] || 'hello';
      for (const filename of fileTargets) {
        const existing = ctx.vfs.readFile(filename, user);
        if (existing === null) {
          if (!noCreate) {
            await syscall(SyscallNo.SYS_WRITE, filename, '');
            const node = ctx.vfs.getNodeByPath(filename);
            if (node) node.updatedAt = timestamp;
          }
        } else {
          const node = ctx.vfs.getNodeByPath(filename);
          if (node) node.updatedAt = timestamp;
        }
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'cat',
    description: 'Concatenate files and print on standard output',
    category: 'file',
    execute: async (ctx) => {
      const { flags, positional } = parseFlags(ctx.args);
      const numberAll = flags.has('n') || flags.has('number');
      const numberNonBlank = flags.has('b') || flags.has('number-nonblank');
      const squeezeBlank = flags.has('s') || flags.has('squeeze-blank');
      const showEnds = flags.has('E') || flags.has('show-ends') || flags.has('A') || flags.has('show-all');
      const showTabs = flags.has('T') || flags.has('show-tabs') || flags.has('A') || flags.has('show-all');

      const rawInputs: string[] = [];
      const user = ctx.env['USER'] || 'hello';

      if (positional.length === 0 || (positional.length === 1 && positional[0] === '-')) {
        if (ctx.pipeInput !== undefined) {
          rawInputs.push(ctx.pipeInput);
        } else {
          return { stdout: '', stderr: '', exitCode: 0 };
        }
      } else {
        let stderr = '';
        let exitCode = 0;
        for (const arg of positional) {
          if (arg === '-') {
            rawInputs.push(ctx.pipeInput || '');
            continue;
          }
          const node = ctx.vfs.getNodeByPath(arg);
          if (node && !ctx.vfs.checkPermission(node, 'r', user)) {
            stderr += `cat: ${arg}: Permission denied\n`;
            exitCode = 1;
            continue;
          }
          const readRes = await syscall(SyscallNo.SYS_READ, arg);
          if (readRes.code !== 0 || readRes.data === null || readRes.data === undefined) {
            stderr += `cat: ${arg}: No such file or directory\n`;
            exitCode = 1;
            continue;
          }
          rawInputs.push(readRes.data ?? '');
        }

        if (exitCode !== 0 && rawInputs.length === 0) {
          return { stdout: '', stderr, exitCode };
        }
      }

      let lineCount = 1;
      const outputLines: string[] = [];
      let prevBlank = false;

      for (const content of rawInputs) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          let line = lines[i];
          const isBlank = line.trim() === '';

          if (squeezeBlank && isBlank && prevBlank) {
            continue;
          }
          prevBlank = isBlank;

          if (showTabs) {
            line = line.replace(/\t/g, '^I');
          }
          if (showEnds) {
            line = line + '$';
          }

          if (numberNonBlank) {
            if (!isBlank) {
              outputLines.push(`${lineCount.toString().padStart(6, ' ')}\t${line}`);
              lineCount++;
            } else {
              outputLines.push(line);
            }
          } else if (numberAll) {
            outputLines.push(`${lineCount.toString().padStart(6, ' ')}\t${line}`);
            lineCount++;
          } else {
            outputLines.push(line);
          }
        }
      }

      const res = outputLines.join('\n');
      return { stdout: res.endsWith('\n') ? res : res + '\n', stderr: '', exitCode: 0 };
    },
    executeStream: async function* (ctx, inputStream) {
      if (inputStream) {
        for await (const chunk of inputStream) {
          yield chunk;
        }
      }
      const { positional } = parseFlags(ctx.args);
      for (const arg of positional) {
        const content = ctx.vfs.readFile(arg, ctx.env['USER'] || 'hello');
        if (content !== null) {
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            yield lines[i] + (i < lines.length - 1 ? '\n' : '');
          }
        }
      }
    },
  },
  {
    name: 'chmod',
    description: 'Change file mode bits (supports octal 755, symbolic u+x, -R, -v, -c, -f)',
    category: 'file',
    execute: (ctx) => {
      const flags = new Set<string>();
      let mode: string | null = null;
      const targets: string[] = [];

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg.startsWith('--')) {
          flags.add(arg.slice(2));
        } else if (arg.startsWith('-') && arg.length > 1 && !/^[0-7]+$/.test(arg.slice(1))) {
          for (let j = 1; j < arg.length; j++) flags.add(arg[j]);
        } else if (!mode) {
          mode = arg;
        } else {
          targets.push(arg);
        }
      }

      if (!mode || targets.length === 0) {
        return { stdout: '', stderr: 'chmod: missing operand\nTry \'chmod --help\' for more information.\n', exitCode: 1 };
      }

      const recursive = flags.has('R') || flags.has('r') || flags.has('recursive');
      const verbose = flags.has('v') || flags.has('verbose');
      const changesOnly = flags.has('c') || flags.has('changes');
      const silent = flags.has('f') || flags.has('silent') || flags.has('quiet');

      let totalStdout = '';
      let totalStderr = '';
      let exitCode = 0;

      for (const target of targets) {
        const node = ctx.vfs.getNodeByPath(target);
        if (!node) {
          if (!silent) {
            totalStderr += `chmod: cannot access '${target}': No such file or directory\n`;
          }
          exitCode = 1;
          continue;
        }

        const oldPerms = node.permissions;
        const ok = ctx.vfs.chmod(target, mode, recursive);
        if (!ok) {
          if (!silent) {
            totalStderr += `chmod: changing permissions of '${target}': Operation not permitted\n`;
          }
          exitCode = 1;
        } else {
          const newPerms = node.permissions;
          if (verbose) {
            totalStdout += `mode of '${target}' changed from ${oldPerms} to ${newPerms}\n`;
          } else if (changesOnly && oldPerms !== newPerms) {
            totalStdout += `mode of '${target}' changed to ${newPerms}\n`;
          }
        }
      }

      return { stdout: totalStdout, stderr: totalStderr, exitCode };
    },
  },
  {
    name: 'head',
    description: 'Output the first part of files',
    category: 'file',
    execute: (ctx) => {
      const { flags, positional } = parseFlags(ctx.args);
      let numLines = 10;
      let numBytes: number | null = null;
      const quiet = flags.has('q') || flags.has('quiet') || flags.has('silent');
      const verbose = flags.has('v') || flags.has('verbose');

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg.startsWith('-n')) {
          const val = arg === '-n' ? ctx.args[i + 1] : arg.slice(2);
          if (val) numLines = parseInt(val, 10) || 10;
        } else if (/^-\d+$/.test(arg)) {
          numLines = parseInt(arg.slice(1), 10) || 10;
        } else if (arg.startsWith('-c')) {
          const val = arg === '-c' ? ctx.args[i + 1] : arg.slice(2);
          if (val) numBytes = parseInt(val, 10);
        }
      }

      const files = positional;
      if (files.length === 0 || (files.length === 1 && files[0] === '-')) {
        const text = ctx.pipeInput ?? '';
        if (numBytes !== null) {
          return { stdout: text.slice(0, numBytes), stderr: '', exitCode: 0 };
        }
        const lines = text.split('\n').slice(0, numLines);
        return { stdout: lines.join('\n') + (text ? '\n' : ''), stderr: '', exitCode: 0 };
      }

      let stdout = '';
      let stderr = '';
      let exitCode = 0;
      const showHeader = (files.length > 1 || verbose) && !quiet;

      for (let i = 0; i < files.length; i++) {
        const filename = files[i];
        const text = ctx.vfs.readFile(filename, ctx.env['USER'] || 'hello');
        if (text === null) {
          stderr += `head: cannot open '${filename}' for reading: No such file or directory\n`;
          exitCode = 1;
          continue;
        }

        if (showHeader) {
          if (stdout.length > 0) stdout += '\n';
          stdout += `==> ${filename} <==\n`;
        }

        if (numBytes !== null) {
          stdout += text.slice(0, numBytes);
        } else {
          const lines = text.split('\n').slice(0, numLines);
          stdout += lines.join('\n') + (text ? '\n' : '');
        }
      }

      return { stdout, stderr, exitCode };
    },
    executeStream: async function* (ctx, inputStream) {
      let n = 10;
      const nIdx = ctx.args.indexOf('-n');
      if (nIdx !== -1 && ctx.args[nIdx + 1]) {
        n = parseInt(ctx.args[nIdx + 1], 10) || 10;
      }
      let count = 0;
      if (inputStream) {
        for await (const chunk of inputStream) {
          for (const line of chunk.split('\n')) {
            if (count < n) {
              yield line + '\n';
              count++;
              if (count >= n) return;
            }
          }
        }
      } else if (ctx.args[0]) {
        const text = ctx.vfs.readFile(ctx.args[0], ctx.env['USER'] || 'hello') ?? '';
        for (const line of text.split('\n').slice(0, n)) {
          yield line + '\n';
        }
      }
    },
  },
  {
    name: 'tail',
    description: 'Output the last part of files',
    category: 'file',
    execute: (ctx) => {
      const { flags, positional } = parseFlags(ctx.args);
      let numLines = 10;
      let fromStart = false;
      let numBytes: number | null = null;
      const quiet = flags.has('q') || flags.has('quiet') || flags.has('silent');
      const verbose = flags.has('v') || flags.has('verbose');

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg.startsWith('-n')) {
          const val = arg === '-n' ? ctx.args[i + 1] : arg.slice(2);
          if (val) {
            if (val.startsWith('+')) {
              fromStart = true;
              numLines = parseInt(val.slice(1), 10) || 1;
            } else {
              numLines = parseInt(val, 10) || 10;
            }
          }
        } else if (/^-\d+$/.test(arg)) {
          numLines = parseInt(arg.slice(1), 10) || 10;
        } else if (arg.startsWith('-c')) {
          const val = arg === '-c' ? ctx.args[i + 1] : arg.slice(2);
          if (val) numBytes = parseInt(val, 10);
        }
      }

      const files = positional;
      if (files.length === 0 || (files.length === 1 && files[0] === '-')) {
        const text = ctx.pipeInput ?? '';
        if (numBytes !== null) {
          return { stdout: text.slice(-numBytes), stderr: '', exitCode: 0 };
        }
        const allLines = text.split('\n');
        const lines = fromStart ? allLines.slice(numLines - 1) : allLines.slice(-numLines);
        return { stdout: lines.join('\n') + (text ? '\n' : ''), stderr: '', exitCode: 0 };
      }

      let stdout = '';
      let stderr = '';
      let exitCode = 0;
      const showHeader = (files.length > 1 || verbose) && !quiet;

      for (let i = 0; i < files.length; i++) {
        const filename = files[i];
        const text = ctx.vfs.readFile(filename, ctx.env['USER'] || 'hello');
        if (text === null) {
          stderr += `tail: cannot open '${filename}' for reading: No such file or directory\n`;
          exitCode = 1;
          continue;
        }

        if (showHeader) {
          if (stdout.length > 0) stdout += '\n';
          stdout += `==> ${filename} <==\n`;
        }

        if (numBytes !== null) {
          stdout += text.slice(-numBytes);
        } else {
          const allLines = text.split('\n');
          const lines = fromStart ? allLines.slice(numLines - 1) : allLines.slice(-numLines);
          stdout += lines.join('\n') + (text ? '\n' : '');
        }
      }

      return { stdout, stderr, exitCode };
    },
  },
  {
    name: 'wc',
    description: 'Print newline, word, and byte counts for each file',
    category: 'file',
    execute: (ctx) => {
      const { flags, positional } = parseFlags(ctx.args);
      let optLines = flags.has('l') || flags.has('lines');
      let optWords = flags.has('w') || flags.has('words');
      let optBytes = flags.has('c') || flags.has('bytes');
      const optChars = flags.has('m') || flags.has('chars');
      const optMaxLen = flags.has('L') || flags.has('max-line-length');

      // Default if no flag is provided
      if (!optLines && !optWords && !optBytes && !optChars && !optMaxLen) {
        optLines = true;
        optWords = true;
        optBytes = true;
      }

      const countMetrics = (text: string) => {
        const lineCount = (text.match(/\n/g) || []).length;
        const wordCount = text.trim().length > 0 ? (text.trim().match(/\s+/g) || []).length + 1 : 0;
        const byteCount = new TextEncoder().encode(text).length;
        const charCount = text.length;
        const maxLen = text.split('\n').reduce((max, l) => Math.max(max, l.length), 0);
        return { lineCount, wordCount, byteCount, charCount, maxLen };
      };

      const formatLine = (counts: { lineCount: number; wordCount: number; byteCount: number; charCount: number; maxLen: number }, name?: string) => {
        const parts: string[] = [];
        if (optLines) parts.push(counts.lineCount.toString().padStart(8, ' '));
        if (optWords) parts.push(counts.wordCount.toString().padStart(8, ' '));
        if (optChars) parts.push(counts.charCount.toString().padStart(8, ' '));
        if (optBytes) parts.push(counts.byteCount.toString().padStart(8, ' '));
        if (optMaxLen) parts.push(counts.maxLen.toString().padStart(8, ' '));
        if (name) parts.push(` ${name}`);
        return parts.join('');
      };

      const files = positional;
      if (files.length === 0 || (files.length === 1 && files[0] === '-')) {
        const text = ctx.pipeInput ?? '';
        const counts = countMetrics(text);
        return { stdout: formatLine(counts) + '\n', stderr: '', exitCode: 0 };
      }

      let stdout = '';
      let stderr = '';
      let exitCode = 0;
      const total = { lineCount: 0, wordCount: 0, byteCount: 0, charCount: 0, maxLen: 0 };

      for (const filename of files) {
        const text = ctx.vfs.readFile(filename, ctx.env['USER'] || 'hello');
        if (text === null) {
          stderr += `wc: ${filename}: No such file or directory\n`;
          exitCode = 1;
          continue;
        }

        const counts = countMetrics(text);
        total.lineCount += counts.lineCount;
        total.wordCount += counts.wordCount;
        total.byteCount += counts.byteCount;
        total.charCount += counts.charCount;
        total.maxLen = Math.max(total.maxLen, counts.maxLen);

        stdout += formatLine(counts, filename) + '\n';
      }

      if (files.length > 1) {
        stdout += formatLine(total, 'total') + '\n';
      }

      return { stdout, stderr, exitCode };
    },
  },
  {
    name: 'rm',
    description: 'Remove files or directories',
    category: 'file',
    execute: (ctx) => {
      const { flags, positional } = parseFlags(ctx.args);
      const recursive = flags.has('r') || flags.has('R') || flags.has('recursive');
      const force = flags.has('f') || flags.has('force');
      const removeDir = flags.has('d') || flags.has('dir');
      const verbose = flags.has('v') || flags.has('verbose');

      if (positional.length === 0) {
        if (force) return { stdout: '', stderr: '', exitCode: 0 };
        return { stdout: '', stderr: 'rm: missing operand\nTry \'rm --help\' for more information.\n', exitCode: 1 };
      }

      let stdout = '';
      let stderr = '';
      let exitCode = 0;

      for (const target of positional) {
        if (recursive && (target === '/' || target === '/*')) {
          stdout += `rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n\n\x1b[1;31m[💥 NUCLEAR BOMB DETECTED]: System protected by Earendel Failsafe Protocol!\x1b[0m\nNice try! Operating system root directory remains safe. 🛡️\n`;
          return { stdout, stderr: '', exitCode: 1 };
        }

        const node = ctx.vfs.getNodeByPath(target);
        if (!node) {
          if (!force) {
            stderr += `rm: cannot remove '${target}': No such file or directory\n`;
            exitCode = 1;
          }
          continue;
        }

        if (node.type === 'directory' && !recursive) {
          if (removeDir) {
            if (node.children && node.children.size > 0) {
              stderr += `rm: cannot remove '${target}': Directory not empty\n`;
              exitCode = 1;
              continue;
            }
          } else {
            stderr += `rm: cannot remove '${target}': Is a directory\n`;
            exitCode = 1;
            continue;
          }
        }

        const isDir = node.type === 'directory';
        const currentUser = ctx.env.USER || 'hello';
        const ok = ctx.vfs.remove(target, recursive || removeDir, currentUser);
        if (!ok) {
          if (!force) {
            stderr += `rm: cannot remove '${target}': No such file or directory, permission denied, or protected system directory\n`;
            exitCode = 1;
          }
        } else if (verbose) {
          stdout += isDir ? `removed directory '${target}'\n` : `removed '${target}'\n`;
        }
      }

      return { stdout, stderr, exitCode };
    },
  },
  {
    name: 'cp',
    description: 'Copy files and directories',
    category: 'file',
    execute: (ctx) => {
      const { flags, positional } = parseFlags(ctx.args);
      const recursive = flags.has('r') || flags.has('R') || flags.has('recursive') || flags.has('a') || flags.has('archive');
      const verbose = flags.has('v') || flags.has('verbose');
      const preserve = flags.has('p') || flags.has('a') || flags.has('archive');

      if (positional.length < 2) {
        return { stdout: '', stderr: 'cp: missing file operand\nTry \'cp --help\' for more information.\n', exitCode: 1 };
      }

      const sources = positional.slice(0, positional.length - 1);
      const dest = positional[positional.length - 1];
      const destNode = ctx.vfs.getNodeByPath(dest);

      if (sources.length > 1 && (!destNode || destNode.type !== 'directory')) {
        return { stdout: '', stderr: `cp: target '${dest}' is not a directory\n`, exitCode: 1 };
      }

      const copySingle = (srcPath: string, targetPath: string): boolean => {
        const srcNode = ctx.vfs.getNodeByPath(srcPath);
        if (!srcNode) return false;

        if (srcNode.type === 'directory') {
          if (!recursive) return false;
          ctx.vfs.mkdir(targetPath, true);
          const createdDir = ctx.vfs.getNodeByPath(targetPath);
          if (createdDir && preserve) {
            createdDir.permissions = srcNode.permissions;
            createdDir.owner = srcNode.owner;
            createdDir.group = srcNode.group;
            createdDir.updatedAt = srcNode.updatedAt;
          }
          if (srcNode.children) {
            for (const child of srcNode.children.values()) {
              copySingle(`${srcPath}/${child.name}`, `${targetPath}/${child.name}`);
            }
          }
          return true;
        } else if (srcNode.type === 'symlink') {
          ctx.vfs.symlink(srcNode.symlinkTarget || '', targetPath);
          return true;
        } else {
          ctx.vfs.writeFile(targetPath, srcNode.content ?? '');
          const copiedNode = ctx.vfs.getNodeByPath(targetPath);
          if (copiedNode && preserve) {
            copiedNode.permissions = srcNode.permissions;
            copiedNode.owner = srcNode.owner;
            copiedNode.group = srcNode.group;
            copiedNode.updatedAt = srcNode.updatedAt;
          }
          return true;
        }
      };

      let stdout = '';
      let stderr = '';
      let exitCode = 0;

      for (const src of sources) {
        const srcNode = ctx.vfs.getNodeByPath(src);
        if (!srcNode) {
          stderr += `cp: cannot stat '${src}': No such file or directory\n`;
          exitCode = 1;
          continue;
        }

        if (srcNode.type === 'directory' && !recursive) {
          stderr += `cp: -r not specified; omitting directory '${src}'\n`;
          exitCode = 1;
          continue;
        }

        let targetDest = dest;
        if (destNode && destNode.type === 'directory') {
          const baseName = src.split('/').filter(Boolean).pop() || src;
          targetDest = dest.endsWith('/') ? `${dest}${baseName}` : `${dest}/${baseName}`;
        }

        const ok = copySingle(src, targetDest);
        if (!ok) {
          stderr += `cp: failed to copy '${src}' to '${targetDest}'\n`;
          exitCode = 1;
        } else if (verbose) {
          stdout += `'${src}' -> '${targetDest}'\n`;
        }
      }

      return { stdout, stderr, exitCode };
    },
  },
  {
    name: 'mv',
    description: 'Move (rename) files and directories',
    category: 'file',
    execute: (ctx) => {
      const { flags, positional } = parseFlags(ctx.args);
      const verbose = flags.has('v') || flags.has('verbose');
      const noClobber = flags.has('n') || flags.has('no-clobber');

      if (positional.length < 2) {
        return { stdout: '', stderr: 'mv: missing file operand\nTry \'mv --help\' for more information.\n', exitCode: 1 };
      }

      const sources = positional.slice(0, positional.length - 1);
      const dest = positional[positional.length - 1];
      const destNode = ctx.vfs.getNodeByPath(dest);

      if (sources.length > 1 && (!destNode || destNode.type !== 'directory')) {
        return { stdout: '', stderr: `mv: target '${dest}' is not a directory\n`, exitCode: 1 };
      }

      const copySingle = (srcPath: string, targetPath: string): boolean => {
        const node = ctx.vfs.getNodeByPath(srcPath);
        if (!node) return false;

        if (node.type === 'directory') {
          ctx.vfs.mkdir(targetPath, true);
          const dirNode = ctx.vfs.getNodeByPath(targetPath);
          if (dirNode) {
            dirNode.permissions = node.permissions;
            dirNode.owner = node.owner;
            dirNode.group = node.group;
            dirNode.updatedAt = node.updatedAt;
          }
          if (node.children) {
            for (const child of node.children.values()) {
              copySingle(`${srcPath}/${child.name}`, `${targetPath}/${child.name}`);
            }
          }
          return true;
        } else if (node.type === 'symlink') {
          ctx.vfs.symlink(node.symlinkTarget || '', targetPath);
          return true;
        } else {
          ctx.vfs.writeFile(targetPath, node.content ?? '');
          const fileNode = ctx.vfs.getNodeByPath(targetPath);
          if (fileNode) {
            fileNode.permissions = node.permissions;
            fileNode.owner = node.owner;
            fileNode.group = node.group;
            fileNode.updatedAt = node.updatedAt;
          }
          return true;
        }
      };

      let stdout = '';
      let stderr = '';
      let exitCode = 0;

      for (const src of sources) {
        const srcNode = ctx.vfs.getNodeByPath(src);
        if (!srcNode) {
          stderr += `mv: cannot stat '${src}': No such file or directory\n`;
          exitCode = 1;
          continue;
        }

        let targetDest = dest;
        if (destNode && destNode.type === 'directory') {
          const baseName = src.split('/').filter(Boolean).pop() || src;
          targetDest = dest.endsWith('/') ? `${dest}${baseName}` : `${dest}/${baseName}`;
        }

        const existingTarget = ctx.vfs.getNodeByPath(targetDest);
        if (existingTarget && noClobber) {
          continue;
        }

        copySingle(src, targetDest);
        ctx.vfs.remove(src, true);

        if (verbose) {
          stdout += `renamed '${src}' -> '${targetDest}'\n`;
        }
      }

      return { stdout, stderr, exitCode };
    },
  },
  {
    name: 'tree',
    description: 'List contents of directories in a tree-like format',
    category: 'file',
    execute: (ctx) => {
      const render = (node: VFSNode, indent: string = ''): string => {
        let res = '';
        if (node.children) {
          const children = Array.from(node.children.values());
          children.forEach((child, index) => {
            const isLast = index === children.length - 1;
            const prefix = isLast ? '└── ' : '├── ';
            res += `${indent}${prefix}${child.name}\n`;
            if (child.type === 'directory') {
              res += render(child, indent + (isLast ? '    ' : '│   '));
            }
          });
        }
        return res;
      };

      const root = ctx.vfs.currentDirectory;
      return { stdout: `.\n${render(root)}`, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'ln',
    description: 'Make links between files (-s for symbolic link)',
    category: 'file',
    execute: (ctx) => {
      const isSymlink = ctx.args.includes('-s') || ctx.args.includes('-sf');
      const nonFlags = ctx.args.filter((a) => !a.startsWith('-'));

      if (nonFlags.length < 2) {
        return { stdout: '', stderr: 'ln: missing file operand\nUsage: ln [-s] TARGET LINK_NAME\n', exitCode: 1 };
      }

      const target = nonFlags[0];
      const linkName = nonFlags[1];

      if (isSymlink) {
        const ok = ctx.vfs.symlink(target, linkName);
        if (!ok) return { stdout: '', stderr: `ln: failed to create symbolic link '${linkName}'\n`, exitCode: 1 };
      } else {
        const content = ctx.vfs.readFile(target);
        if (content === null) return { stdout: '', stderr: `ln: failed to access '${target}': No such file or directory\n`, exitCode: 1 };
        ctx.vfs.writeFile(linkName, content);
      }

      return { stdout: '', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'du',
    description: 'Estimate file space usage (-h, -s)',
    category: 'file',
    execute: (ctx) => {
      const isHuman = ctx.args.includes('-h');
      const isSummary = ctx.args.includes('-s') || ctx.args.includes('-sh');
      const pathArg = ctx.args.find((a) => !a.startsWith('-')) || '.';

      const node = ctx.vfs.getNodeByPath(pathArg);
      if (!node) return { stdout: '', stderr: `du: cannot access '${pathArg}': No such file or directory\n`, exitCode: 1 };

      const formatSize = (bytes: number) => {
        if (!isHuman) return Math.ceil(bytes / 1024).toString();
        if (bytes < 1024) return `${bytes}B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
        return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
      };

      if (node.type === 'file') {
        return { stdout: `${formatSize(node.size)}\t${pathArg}\n`, stderr: '', exitCode: 0 };
      }

      let total = 0;
      let out = '';
      const walk = (n: VFSNode, p: string) => {
        let nSize = n.size;
        if (n.children) {
          for (const child of n.children.values()) {
            nSize += walk(child, p === '.' ? child.name : `${p}/${child.name}`);
          }
        }
        if (!isSummary || p === pathArg || p === '.') {
          out += `${formatSize(nSize)}\t${p}\n`;
        }
        total += nSize;
        return nSize;
      };

      walk(node, pathArg);
      return { stdout: out, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'stat',
    description: 'Display file or file system status',
    category: 'file',
    execute: (ctx) => {
      const pathArg = ctx.args[0] || '.';
      const node = ctx.vfs.getNodeByPath(pathArg);
      if (!node) return { stdout: '', stderr: `stat: cannot statx '${pathArg}': No such file or directory\n`, exitCode: 1 };

      const inode = Math.floor(Math.random() * 800000 + 100000);
      const dateStr = node.updatedAt.toISOString().replace('T', ' ').substring(0, 19);

      const output = `  File: ${node.name || '/'}
  Size: ${node.size.toString().padEnd(10, ' ')} Blocks: 8          IO Block: 4096   ${node.type === 'directory' ? 'directory' : node.type === 'symlink' ? 'symbolic link' : 'regular file'}
Device: 801h/2049d      Inode: ${inode}     Links: 1
Access: (${node.permissions}/-rwxr-xr-x)  Uid: ( 1000/ ${node.owner})   Gid: ( 1000/ ${node.group})
Access: ${dateStr} +0800
Modify: ${dateStr} +0800
Change: ${dateStr} +0800
 Birth: -
`;
      return { stdout: output, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'file',
    description: 'Determine file type',
    category: 'file',
    execute: (ctx) => {
      if (ctx.args.length === 0) return { stdout: '', stderr: 'file: missing operand\n', exitCode: 1 };
      const pathArg = ctx.args[0];
      const node = ctx.vfs.getNodeByPath(pathArg);
      if (!node) return { stdout: '', stderr: `file: cannot open '${pathArg}': No such file or directory\n`, exitCode: 1 };

      if (node.type === 'directory') {
        return { stdout: `${pathArg}: directory\n`, stderr: '', exitCode: 0 };
      }
      if (node.type === 'symlink') {
        return { stdout: `${pathArg}: symbolic link to ${node.symlinkTarget}\n`, stderr: '', exitCode: 0 };
      }
      const content = node.content ?? '';
      if (content.startsWith('#!')) {
        return { stdout: `${pathArg}: a ${content.substring(2, content.indexOf('\n') || 20).trim()} script, ASCII text executable\n`, stderr: '', exitCode: 0 };
      }
      return { stdout: `${pathArg}: ASCII text\n`, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'rmdir',
    description: 'Remove empty directories',
    category: 'file',
    execute: (ctx) => {
      if (ctx.args.length === 0) return { stdout: '', stderr: 'rmdir: missing operand\n', exitCode: 1 };
      const dirName = ctx.args[0];
      const node = ctx.vfs.getNodeByPath(dirName);

      if (!node) return { stdout: '', stderr: `rmdir: failed to remove '${dirName}': No such file or directory\n`, exitCode: 1 };
      if (node.type !== 'directory') return { stdout: '', stderr: `rmdir: failed to remove '${dirName}': Not a directory\n`, exitCode: 1 };
      if (node.children && node.children.size > 0) return { stdout: '', stderr: `rmdir: failed to remove '${dirName}': Directory not empty\n`, exitCode: 1 };

      const currentUser = ctx.env.USER || 'hello';
      const ok = ctx.vfs.remove(dirName, false, currentUser);
      if (!ok) {
        return { stdout: '', stderr: `rmdir: failed to remove '${dirName}': Permission denied or protected system directory\n`, exitCode: 1 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'basename',
    description: 'Strip directory and suffix from filenames',
    category: 'file',
    execute: (ctx) => {
      if (ctx.args.length === 0) return { stdout: '', stderr: 'basename: missing operand\n', exitCode: 1 };
      const pathStr = ctx.args[0];
      const suffix = ctx.args[1];

      let base = pathStr.split('/').filter(Boolean).pop() || '';
      if (suffix && base.endsWith(suffix)) {
        base = base.substring(0, base.length - suffix.length);
      }
      return { stdout: base + '\n', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'dirname',
    description: 'Strip last component from file name',
    category: 'file',
    execute: (ctx) => {
      if (ctx.args.length === 0) return { stdout: '', stderr: 'dirname: missing operand\n', exitCode: 1 };
      const pathStr = ctx.args[0];
      const parts = pathStr.split('/').filter(Boolean);
      if (parts.length <= 1) {
        return { stdout: pathStr.startsWith('/') ? '/\n' : '.\n', stderr: '', exitCode: 0 };
      }
      parts.pop();
      return { stdout: (pathStr.startsWith('/') ? '/' : '') + parts.join('/') + '\n', stderr: '', exitCode: 0 };
    },
  },
];
