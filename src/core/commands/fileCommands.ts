// Behavioral File System Commands for Earendel
import { Command, ExecutionContext, ExecutionResult } from '../types';
import { VFSNode } from '../vfs';

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
    execute: (ctx) => {
      const showAll = ctx.args.includes('-a') || ctx.args.includes('-la') || ctx.args.includes('-al');
      const showLong = ctx.args.includes('-l') || ctx.args.includes('-la') || ctx.args.includes('-al');
      const pathArg = ctx.args.find((a) => !a.startsWith('-')) || '.';

      const targetNode = ctx.vfs.getNodeByPath(pathArg);
      if (!targetNode) {
        return { stdout: '', stderr: `ls: cannot access '${pathArg}': No such file or directory\n`, exitCode: 2 };
      }

      if (targetNode.type === 'file') {
        return { stdout: targetNode.name + '\n', stderr: '', exitCode: 0 };
      }

      if (!targetNode.children) {
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      let entries = Array.from(targetNode.children.values());
      if (!showAll) {
        entries = entries.filter((e) => !e.name.startsWith('.'));
      }

      if (showLong) {
        let output = `total ${entries.length * 4}\n`;
        for (const entry of entries) {
          const isDir = entry.type === 'directory' ? 'd' : '-';
          const perm = isDir + entry.permissions;
          const size = entry.size.toString().padStart(6, ' ');
          const dateStr = entry.updatedAt.toLocaleDateString(ctx.lang === 'zh' ? 'zh-CN' : 'en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
          output += `${perm} 1 ${entry.owner} ${entry.group} ${size} ${dateStr} ${entry.name}\n`;
        }
        return { stdout: output, stderr: '', exitCode: 0 };
      } else {
        const names = entries.map((e) => e.name).join('  ');
        return { stdout: names ? names + '\n' : '', stderr: '', exitCode: 0 };
      }
    },
  },
  {
    name: 'cd',
    description: 'Change the shell working directory',
    category: 'file',
    execute: (ctx) => {
      const targetPath = ctx.args[0] || '~';
      const ok = ctx.vfs.changeDirectory(targetPath);
      if (!ok) {
        return { stdout: '', stderr: `bash: cd: ${targetPath}: No such file or directory\n`, exitCode: 1 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'mkdir',
    description: 'Create directory',
    category: 'file',
    execute: (ctx) => {
      if (ctx.args.length === 0) {
        return { stdout: '', stderr: 'mkdir: missing operand\n', exitCode: 1 };
      }
      const pFlag = ctx.args.includes('-p');
      const dirName = ctx.args.find((a) => !a.startsWith('-')) || '';
      const ok = ctx.vfs.mkdir(dirName, pFlag);
      if (!ok) {
        return { stdout: '', stderr: `mkdir: cannot create directory '${dirName}': File exists or invalid path\n`, exitCode: 1 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'touch',
    description: 'Change file timestamps or create empty file',
    category: 'file',
    execute: (ctx) => {
      if (ctx.args.length === 0) return { stdout: '', stderr: 'touch: missing operand\n', exitCode: 1 };
      for (const filename of ctx.args) {
        if (!filename.startsWith('-')) {
          const content = ctx.vfs.readFile(filename) ?? '';
          ctx.vfs.writeFile(filename, content);
        }
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'cat',
    description: 'Concatenate files and print on standard output',
    category: 'file',
    execute: (ctx) => {
      if (ctx.pipeInput) {
        return { stdout: ctx.pipeInput, stderr: '', exitCode: 0 };
      }
      if (ctx.args.length === 0) {
        return { stdout: '', stderr: 'cat: missing operand\n', exitCode: 1 };
      }
      let out = '';
      for (const arg of ctx.args) {
        const node = ctx.vfs.getNodeByPath(arg);
        if (!node) {
          return { stdout: '', stderr: `cat: ${arg}: No such file or directory\n`, exitCode: 1 };
        }
        // Permission check! If read permission 'r' is missing
        if (!node.permissions.includes('r')) {
          return { stdout: '', stderr: `cat: ${arg}: Permission denied\n`, exitCode: 1 };
        }
        out += node.content ?? '';
      }
      return { stdout: out.endsWith('\n') ? out : out + '\n', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'chmod',
    description: 'Change file mode bits (permissions)',
    category: 'file',
    execute: (ctx) => {
      if (ctx.args.length < 2) {
        return { stdout: '', stderr: 'chmod: missing operand\nUsage: chmod [MODE] [FILE]\n', exitCode: 1 };
      }
      const mode = ctx.args[0];
      const target = ctx.args[1];
      const ok = ctx.vfs.chmod(target, mode);
      if (!ok) {
        return { stdout: '', stderr: `chmod: cannot change permissions of '${target}': No such file or directory\n`, exitCode: 1 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'find',
    description: 'Search for files in a directory hierarchy',
    category: 'file',
    execute: (ctx) => {
      const nameArgIdx = ctx.args.indexOf('-name');
      const targetPattern = nameArgIdx !== -1 ? ctx.args[nameArgIdx + 1]?.replace(/^["']|["']$/g, '') : null;

      const results: string[] = [];
      const walk = (node: VFSNode, currPath: string) => {
        if (!targetPattern || node.name.includes(targetPattern.replace(/\*/g, ''))) {
          results.push(currPath);
        }
        if (node.type === 'directory' && node.children) {
          for (const child of node.children.values()) {
            walk(child, currPath === '/' ? `/${child.name}` : `${currPath}/${child.name}`);
          }
        }
      };

      walk(ctx.vfs.currentDirectory, '.');
      return { stdout: results.join('\n') + '\n', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'head',
    description: 'Output the first part of files',
    category: 'file',
    execute: (ctx) => {
      const text = ctx.pipeInput || (ctx.args[0] ? (ctx.vfs.readFile(ctx.args[0]) ?? '') : '');
      const lines = text.split('\n').slice(0, 10);
      return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'tail',
    description: 'Output the last part of files',
    category: 'file',
    execute: (ctx) => {
      const text = ctx.pipeInput || (ctx.args[0] ? (ctx.vfs.readFile(ctx.args[0]) ?? '') : '');
      const lines = text.split('\n').filter(Boolean).slice(-10);
      return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'wc',
    description: 'Print newline, word, and byte counts for each file',
    category: 'file',
    execute: (ctx) => {
      const text = ctx.pipeInput || (ctx.args[0] ? (ctx.vfs.readFile(ctx.args[0]) ?? '') : '');
      const lines = text.split('\n').filter(Boolean).length;
      const words = text.split(/\s+/).filter(Boolean).length;
      const chars = text.length;
      return { stdout: `  ${lines}  ${words}  ${chars} ${ctx.args[0] || ''}\n`, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'rm',
    description: 'Remove files or directories',
    category: 'file',
    execute: (ctx) => {
      const recursive = ctx.args.includes('-r') || ctx.args.includes('-rf') || ctx.args.includes('-fr') || ctx.args.includes('-r-f');
      const target = ctx.args.find((a) => !a.startsWith('-'));

      if (recursive && (target === '/' || target === '/*')) {
        return {
          stdout: `rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n\n\x1b[1;31m[💥 NUCLEAR BOMB DETECTED]: System protected by Earendel Failsafe Protocol!\x1b[0m\nNice try! Operating system root directory remains safe. 🛡️\n`,
          stderr: '',
          exitCode: 1,
        };
      }

      if (!target) return { stdout: '', stderr: 'rm: missing operand\n', exitCode: 1 };

      const ok = ctx.vfs.remove(target, recursive);
      if (!ok) {
        return { stdout: '', stderr: `rm: cannot remove '${target}': No such file or directory or non-empty directory\n`, exitCode: 1 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'cp',
    description: 'Copy files and directories',
    category: 'file',
    execute: (ctx) => {
      if (ctx.args.length < 2) return { stdout: '', stderr: 'cp: missing file operand\n', exitCode: 1 };
      const src = ctx.args[0];
      const dest = ctx.args[1];
      const content = ctx.vfs.readFile(src);
      if (content === null) {
        return { stdout: '', stderr: `cp: cannot stat '${src}': No such file or directory\n`, exitCode: 1 };
      }
      ctx.vfs.writeFile(dest, content);
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'mv',
    description: 'Move (rename) files',
    category: 'file',
    execute: (ctx) => {
      if (ctx.args.length < 2) return { stdout: '', stderr: 'mv: missing file operand\n', exitCode: 1 };
      const src = ctx.args[0];
      const dest = ctx.args[1];
      const content = ctx.vfs.readFile(src);
      if (content === null) {
        return { stdout: '', stderr: `mv: cannot stat '${src}': No such file or directory\n`, exitCode: 1 };
      }
      ctx.vfs.writeFile(dest, content);
      ctx.vfs.remove(src);
      return { stdout: '', stderr: '', exitCode: 0 };
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

      ctx.vfs.remove(dirName);
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
