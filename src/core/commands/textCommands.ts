// Behavioral Text Processing Commands for Earendel
import { Command } from '../types';

export const textCommands: Command[] = [
  {
    name: 'echo',
    description: 'Display a line of text',
    category: 'text',
    execute: (ctx) => {
      const text = ctx.args.join(' ');
      return { stdout: text + '\n', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'grep',
    description: 'Print lines matching a pattern (supports -i, -v, -n)',
    category: 'text',
    execute: (ctx) => {
      const ignoreCase = ctx.args.includes('-i');
      const invert = ctx.args.includes('-v');
      const showLineNum = ctx.args.includes('-n');

      const nonFlags = ctx.args.filter((a) => !a.startsWith('-'));
      if (nonFlags.length === 0) {
        return { stdout: '', stderr: 'grep: missing pattern\n', exitCode: 1 };
      }

      const patternStr = nonFlags[0];
      const filePath = nonFlags[1];
      const text = ctx.pipeInput || (filePath ? (ctx.vfs.readFile(filePath) ?? '') : '');

      if (!text && filePath && ctx.vfs.getNodeByPath(filePath) === null) {
        return { stdout: '', stderr: `grep: ${filePath}: No such file or directory\n`, exitCode: 2 };
      }

      const regex = new RegExp(patternStr, ignoreCase ? 'i' : '');
      const lines = text.split('\n');
      const matchedLines: string[] = [];

      lines.forEach((line, idx) => {
        const matches = regex.test(line);
        if (invert ? !matches : matches) {
          const prefix = showLineNum ? `${idx + 1}:` : '';
          matchedLines.push(prefix + line);
        }
      });

      return {
        stdout: matchedLines.length > 0 ? matchedLines.join('\n') + '\n' : '',
        stderr: '',
        exitCode: matchedLines.length > 0 ? 0 : 1,
      };
    },
    executeStream: async function* (ctx, inputStream) {
      const ignoreCase = ctx.args.includes('-i');
      const invert = ctx.args.includes('-v');
      const showLineNum = ctx.args.includes('-n');
      const nonFlags = ctx.args.filter((a) => !a.startsWith('-'));
      if (nonFlags.length === 0) return;

      const patternStr = nonFlags[0];
      const filePath = nonFlags[1];
      const regex = new RegExp(patternStr, ignoreCase ? 'i' : '');

      let lineCount = 0;
      const processLine = (line: string): string | null => {
        lineCount++;
        const matches = regex.test(line);
        if (invert ? !matches : matches) {
          const prefix = showLineNum ? `${lineCount}:` : '';
          return prefix + line + (line.endsWith('\n') ? '' : '\n');
        }
        return null;
      };

      if (inputStream) {
        for await (const chunk of inputStream) {
          const lines = chunk.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const res = processLine(lines[i]);
            if (res !== null) yield res;
          }
        }
      } else if (filePath) {
        const text = ctx.vfs.readFile(filePath, ctx.env['USER'] || 'hello') ?? '';
        for (const line of text.split('\n')) {
          const res = processLine(line);
          if (res !== null) yield res;
        }
      }
    },
  },
  {
    name: 'sed',
    description: 'Stream editor for filtering and transforming text',
    category: 'text',
    execute: (ctx) => {
      const expr = ctx.args.find((a) => !a.startsWith('-')) || '';
      const filePath = ctx.args[1];
      const text = ctx.pipeInput || (filePath ? (ctx.vfs.readFile(filePath) ?? '') : '');

      // Handle s/find/replace/g
      const sMatch = expr.match(/^s\/([^\/]+)\/([^\/]*)\/([gi]*)$/);
      if (sMatch) {
        const findStr = sMatch[1];
        const replaceStr = sMatch[2];
        const flags = sMatch[3];
        const regex = new RegExp(findStr, flags.includes('g') ? 'g' : '');
        const result = text.replace(regex, replaceStr);
        return { stdout: result + (result.endsWith('\n') ? '' : '\n'), stderr: '', exitCode: 0 };
      }

      return { stdout: text + (text.endsWith('\n') ? '' : '\n'), stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'awk',
    description: 'Pattern scanning and processing language ({print $N}, -F)',
    category: 'text',
    execute: (ctx) => {
      let delimiter = '\\s+';
      const fIdx = ctx.args.indexOf('-F');
      if (fIdx !== -1 && ctx.args[fIdx + 1]) {
        delimiter = ctx.args[fIdx + 1];
      }

      const expr = ctx.args.find((a) => a.includes('{')) || '{print $0}';
      const filePath = ctx.args.find((a) => !a.startsWith('-') && !a.includes('{'));
      const text = ctx.pipeInput || (filePath ? (ctx.vfs.readFile(filePath) ?? '') : '');

      const printMatch = expr.match(/\{print\s+\$(\d+)\}/);
      if (printMatch) {
        const colIndex = parseInt(printMatch[1], 10);
        const lines = text.split('\n').filter(Boolean);
        const out = lines
          .map((line) => {
            const cols = line.trim().split(new RegExp(delimiter));
            if (colIndex === 0) return line;
            return cols[colIndex - 1] || '';
          })
          .join('\n');
        return { stdout: out + '\n', stderr: '', exitCode: 0 };
      }

      return { stdout: text + (text.endsWith('\n') ? '' : '\n'), stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'sort',
    description: 'Sort lines of text files (-n, -r)',
    category: 'text',
    execute: (ctx) => {
      const text = ctx.pipeInput || (ctx.args[0] ? (ctx.vfs.readFile(ctx.args[0]) ?? '') : '');
      const lines = text.split('\n').filter(Boolean);
      if (ctx.args.includes('-n')) {
        lines.sort((a, b) => parseFloat(a) - parseFloat(b));
      } else if (ctx.args.includes('-r')) {
        lines.sort().reverse();
      } else {
        lines.sort();
      }
      return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'uniq',
    description: 'Report or omit repeated lines',
    category: 'text',
    execute: (ctx) => {
      const text = ctx.pipeInput || (ctx.args[0] ? (ctx.vfs.readFile(ctx.args[0]) ?? '') : '');
      const lines = text.split('\n').filter(Boolean);
      const uniqLines: string[] = [];
      for (const line of lines) {
        if (uniqLines.length === 0 || uniqLines[uniqLines.length - 1] !== line) {
          uniqLines.push(line);
        }
      }
      return { stdout: uniqLines.join('\n') + '\n', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'tr',
    description: 'Translate or delete characters',
    category: 'text',
    execute: (ctx) => {
      let from = ctx.args[0] || '';
      let to = ctx.args[1] || '';
      let text = ctx.pipeInput || '';

      if (from === 'a-z' && to === 'A-Z') {
        return { stdout: text.toUpperCase(), stderr: '', exitCode: 0 };
      }
      if (from === 'A-Z' && to === 'a-z') {
        return { stdout: text.toLowerCase(), stderr: '', exitCode: 0 };
      }
      return { stdout: text.split(from).join(to), stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'tee',
    description: 'Read from standard input and write to standard output and files',
    category: 'text',
    execute: (ctx) => {
      const file = ctx.args[0];
      if (file) {
        ctx.vfs.writeFile(file, ctx.pipeInput ?? '');
      }
      return { stdout: ctx.pipeInput ?? '', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'cut',
    description: 'Remove sections from each line of files (-d, -f)',
    category: 'text',
    execute: (ctx) => {
      let delimiter = '\t';
      let fieldsStr = '';

      const dIdx = ctx.args.indexOf('-d');
      if (dIdx !== -1 && ctx.args[dIdx + 1]) {
        delimiter = ctx.args[dIdx + 1];
      }

      const fIdx = ctx.args.indexOf('-f');
      if (fIdx !== -1 && ctx.args[fIdx + 1]) {
        fieldsStr = ctx.args[fIdx + 1];
      }

      const filePath = ctx.args.find((a) => !a.startsWith('-') && a !== delimiter && a !== fieldsStr);
      const text = ctx.pipeInput || (filePath ? (ctx.vfs.readFile(filePath) ?? '') : '');

      if (!text) return { stdout: '', stderr: '', exitCode: 0 };

      const fields = fieldsStr.split(',').map((n) => parseInt(n, 10)).filter((n) => !isNaN(n));
      const lines = text.split('\n').filter(Boolean);

      const res = lines.map((line) => {
        const parts = line.split(delimiter);
        if (fields.length === 0) return line;
        return fields.map((f) => parts[f - 1] || '').join(delimiter);
      }).join('\n');

      return { stdout: res + '\n', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'diff',
    description: 'Compare files line by line (-u)',
    category: 'text',
    execute: (ctx) => {
      const nonFlags = ctx.args.filter((a) => !a.startsWith('-'));
      if (nonFlags.length < 2) return { stdout: '', stderr: 'diff: missing operand\n', exitCode: 1 };
      const file1 = ctx.vfs.readFile(nonFlags[0]) ?? '';
      const file2 = ctx.vfs.readFile(nonFlags[1]) ?? '';
      if (file1 === file2) return { stdout: '', stderr: '', exitCode: 0 };

      const l1 = file1.split('\n');
      const l2 = file2.split('\n');
      let diffOut = `--- ${nonFlags[0]}\n+++ ${nonFlags[1]}\n`;
      const max = Math.max(l1.length, l2.length);
      for (let idx = 0; idx < max; idx++) {
        if (l1[idx] !== l2[idx]) {
          if (l1[idx] !== undefined) diffOut += `- ${l1[idx]}\n`;
          if (l2[idx] !== undefined) diffOut += `+ ${l2[idx]}\n`;
        }
      }
      return { stdout: diffOut, stderr: '', exitCode: 1 };
    },
  },
  {
    name: 'paste',
    description: 'Merge lines of files (-d)',
    category: 'text',
    execute: (ctx) => {
      let delimiter = '\t';
      const dIdx = ctx.args.indexOf('-d');
      if (dIdx !== -1 && ctx.args[dIdx + 1]) {
        delimiter = ctx.args[dIdx + 1];
      }

      const files = ctx.args.filter((a) => !a.startsWith('-') && a !== delimiter);
      if (files.length === 0) return { stdout: '', stderr: 'paste: missing operand\n', exitCode: 1 };

      const contents = files.map((f) => (ctx.vfs.readFile(f) ?? '').split('\n'));
      const maxLines = Math.max(...contents.map((c) => c.length));

      let outLines: string[] = [];
      for (let i = 0; i < maxLines; i++) {
        const lineParts = contents.map((c) => c[i] || '');
        outLines.push(lineParts.join(delimiter));
      }
      return { stdout: outLines.join('\n') + '\n', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'nl',
    description: 'Number lines of files',
    category: 'text',
    execute: (ctx) => {
      const text = ctx.pipeInput || (ctx.args[0] ? (ctx.vfs.readFile(ctx.args[0]) ?? '') : '');
      const lines = text.split('\n');
      const numbered = lines.map((l, i) => `     ${i + 1}\t${l}`).join('\n');
      return { stdout: numbered + '\n', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'tac',
    description: 'Concatenate and print files in reverse line order',
    category: 'text',
    execute: (ctx) => {
      const text = ctx.pipeInput || (ctx.args[0] ? (ctx.vfs.readFile(ctx.args[0]) ?? '') : '');
      const lines = text.split('\n').filter(Boolean).reverse();
      return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'rev',
    description: 'Reverse lines characterwise',
    category: 'text',
    execute: (ctx) => {
      const text = ctx.pipeInput || (ctx.args[0] ? (ctx.vfs.readFile(ctx.args[0]) ?? '') : '');
      const reversed = text.split('\n').map((l) => l.split('').reverse().join('')).join('\n');
      return { stdout: reversed + '\n', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'vi',
    aliases: ['vim'],
    description: 'VIM - Vi IMproved modal text editor',
    category: 'editor',
    execute: (ctx) => {
      const filePath = ctx.args[0] || 'untitled.txt';
      const content = ctx.vfs.readFile(filePath) ?? '';
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        openVi: { path: filePath, content },
      };
    },
  },
];
