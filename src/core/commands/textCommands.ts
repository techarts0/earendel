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
    description: 'Print lines matching a pattern (supports -i, -v, -n, -c, -l, -w, -E, -r, -q, -o)',
    category: 'text',
    execute: (ctx) => {
      // Parse grep flags and arguments
      const flags = new Set<string>();
      const patterns: string[] = [];
      const positional: string[] = [];

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg === '-e' || arg === '--regexp') {
          if (ctx.args[i + 1]) {
            patterns.push(ctx.args[i + 1]);
            i++;
          }
        } else if (arg.startsWith('-e=')) {
          patterns.push(arg.slice(3));
        } else if (arg.startsWith('--regexp=')) {
          patterns.push(arg.slice(9));
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

      if (patterns.length === 0) {
        if (positional.length === 0) {
          return { stdout: '', stderr: 'grep: missing pattern\nTry \'grep --help\' for more information.\n', exitCode: 2 };
        }
        patterns.push(positional.shift()!);
      }

      const ignoreCase = flags.has('i') || flags.has('ignore-case');
      const invert = flags.has('v') || flags.has('invert-match');
      const showLineNum = flags.has('n') || flags.has('line-number');
      const countOnly = flags.has('c') || flags.has('count');
      const filesWithMatches = flags.has('l') || flags.has('files-with-matches');
      const wordMatch = flags.has('w') || flags.has('word-regexp');
      const quiet = flags.has('q') || flags.has('quiet') || flags.has('silent');
      const onlyMatching = flags.has('o') || flags.has('only-matching');
      const recursive = flags.has('r') || flags.has('R') || flags.has('recursive');

      let combinedPattern = patterns[0];
      if (wordMatch) {
        combinedPattern = `\\b(?:${combinedPattern})\\b`;
      }

      let regex: RegExp;
      try {
        regex = new RegExp(combinedPattern, (ignoreCase ? 'i' : '') + (onlyMatching ? 'g' : ''));
      } catch (err) {
        return { stdout: '', stderr: `grep: invalid regular expression: '${combinedPattern}'\n`, exitCode: 2 };
      }

      // Collect target files
      const targets = positional.length > 0 ? positional : (recursive ? ['.'] : []);

      // If no file arguments and not recursive, read from stdin
      if (targets.length === 0 || (targets.length === 1 && targets[0] === '-')) {
        const text = ctx.pipeInput ?? '';
        const lines = text.split('\n');
        let matchedCount = 0;
        const matchedLines: string[] = [];

        lines.forEach((line, idx) => {
          regex.lastIndex = 0;
          const matches = regex.test(line);
          if (invert ? !matches : matches) {
            matchedCount++;
            if (onlyMatching) {
              const matchedSubstrings = line.match(regex) || [];
              matchedSubstrings.forEach((sub) => {
                const prefix = showLineNum ? `${idx + 1}:` : '';
                matchedLines.push(prefix + sub);
              });
            } else {
              const prefix = showLineNum ? `${idx + 1}:` : '';
              matchedLines.push(prefix + line);
            }
          }
        });

        if (quiet) {
          return { stdout: '', stderr: '', exitCode: matchedCount > 0 ? 0 : 1 };
        }
        if (countOnly) {
          return { stdout: `${matchedCount}\n`, stderr: '', exitCode: matchedCount > 0 ? 0 : 1 };
        }
        if (filesWithMatches) {
          return { stdout: matchedCount > 0 ? '(standard input)\n' : '', stderr: '', exitCode: matchedCount > 0 ? 0 : 1 };
        }

        return {
          stdout: matchedLines.length > 0 ? matchedLines.join('\n') + '\n' : '',
          stderr: '',
          exitCode: matchedCount > 0 ? 0 : 1,
        };
      }

      // Expand all files (including recursive walk if enabled)
      const fileList: string[] = [];
      let hadError = false;
      let totalStderr = '';

      const collectFiles = (p: string) => {
        const node = ctx.vfs.getNodeByPath(p);
        if (!node) {
          totalStderr += `grep: ${p}: No such file or directory\n`;
          hadError = true;
          return;
        }
        if (node.type === 'file') {
          fileList.push(p);
        } else if (node.type === 'directory') {
          if (!recursive) {
            totalStderr += `grep: ${p}: Is a directory\n`;
          } else if (node.children) {
            for (const child of node.children.values()) {
              const childPath = p === '.' ? child.name : p.endsWith('/') ? `${p}${child.name}` : `${p}/${child.name}`;
              collectFiles(childPath);
            }
          }
        }
      };

      for (const t of targets) {
        collectFiles(t);
      }

      const multiFiles = fileList.length > 1 || recursive;
      let totalMatches = 0;
      const outputLines: string[] = [];

      for (const filePath of fileList) {
        const content = ctx.vfs.readFile(filePath, ctx.env['USER'] || 'hello');
        if (content === null) continue;

        const lines = content.split('\n');
        let fileMatchedCount = 0;

        lines.forEach((line, idx) => {
          regex.lastIndex = 0;
          const matches = regex.test(line);
          if (invert ? !matches : matches) {
            fileMatchedCount++;
            totalMatches++;
            if (!countOnly && !filesWithMatches && !quiet) {
              const filePrefix = multiFiles ? `${filePath}:` : '';
              const linePrefix = showLineNum ? `${idx + 1}:` : '';
              if (onlyMatching) {
                const matchedSubstrings = line.match(regex) || [];
                matchedSubstrings.forEach((sub) => {
                  outputLines.push(`${filePrefix}${linePrefix}${sub}`);
                });
              } else {
                outputLines.push(`${filePrefix}${linePrefix}${line}`);
              }
            }
          }
        });

        if (filesWithMatches && fileMatchedCount > 0) {
          outputLines.push(filePath);
        } else if (countOnly && !quiet) {
          if (multiFiles) {
            outputLines.push(`${filePath}:${fileMatchedCount}`);
          } else {
            outputLines.push(`${fileMatchedCount}`);
          }
        }
      }

      if (quiet) {
        return { stdout: '', stderr: totalStderr, exitCode: totalMatches > 0 ? 0 : hadError ? 2 : 1 };
      }

      return {
        stdout: outputLines.length > 0 ? outputLines.join('\n') + '\n' : '',
        stderr: totalStderr,
        exitCode: totalMatches > 0 ? 0 : hadError ? 2 : 1,
      };
    },
    executeStream: async function* (ctx, inputStream) {
      const ignoreCase = ctx.args.includes('-i') || ctx.args.includes('--ignore-case');
      const invert = ctx.args.includes('-v') || ctx.args.includes('--invert-match');
      const showLineNum = ctx.args.includes('-n') || ctx.args.includes('--line-number');
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
    description: 'Stream editor for filtering and transforming text (supports s/find/replace/g, d, p, -i, -n, -e)',
    category: 'text',
    execute: (ctx) => {
      const flags = new Set<string>();
      const scripts: string[] = [];
      const positional: string[] = [];
      let inPlace = false;

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg === '-e' || arg === '--expression') {
          if (ctx.args[i + 1]) {
            scripts.push(ctx.args[i + 1]);
            i++;
          }
        } else if (arg.startsWith('-e=')) {
          scripts.push(arg.slice(3));
        } else if (arg.startsWith('--expression=')) {
          scripts.push(arg.slice(13));
        } else if (arg === '-i' || arg.startsWith('-i')) {
          inPlace = true;
          flags.add('i');
        } else if (arg.startsWith('--')) {
          flags.add(arg.slice(2));
        } else if (arg.startsWith('-') && arg.length > 1) {
          for (let j = 1; j < arg.length; j++) {
            if (arg[j] === 'i') inPlace = true;
            flags.add(arg[j]);
          }
        } else {
          positional.push(arg);
        }
      }

      if (scripts.length === 0 && positional.length > 0) {
        scripts.push(positional.shift()!);
      }

      const suppressPrinting = flags.has('n') || flags.has('quiet') || flags.has('silent');
      const script = scripts.join(';');

      if (!script) {
        return { stdout: '', stderr: 'sed: no input script specified\n', exitCode: 1 };
      }

      // Collect input texts
      const fileTargets = positional.length > 0 ? positional : (ctx.pipeInput !== undefined ? ['-'] : []);
      if (fileTargets.length === 0) {
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      let totalStdout = '';
      let totalStderr = '';
      let exitCode = 0;

      const processTextWithSed = (text: string): string => {
        const lines = text.split('\n');
        const outputLines: string[] = [];

        // Parse sed commands separated by semicolons
        const commands = script.split(';').map((s) => s.trim()).filter(Boolean);

        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
          let line = lines[lineIdx];
          const lineNum = lineIdx + 1;
          let isDeleted = false;
          let explicitlyPrinted = false;

          for (const cmd of commands) {
            // Substitute: s/pattern/replacement/flags
            const sMatch = cmd.match(/^s([^\w\s])(.+?)\1(.*?)\1([giIpP]*)$/);
            if (sMatch) {
              const delim = sMatch[1];
              const findStr = sMatch[2];
              const replaceStr = sMatch[3];
              const cmdFlags = sMatch[4];
              const isGlobal = cmdFlags.includes('g');
              const isCaseInsensitive = cmdFlags.includes('i') || cmdFlags.includes('I');
              const printOnMatch = cmdFlags.includes('p') || cmdFlags.includes('P');

              try {
                const regex = new RegExp(findStr, (isGlobal ? 'g' : '') + (isCaseInsensitive ? 'i' : ''));
                if (regex.test(line)) {
                  line = line.replace(regex, replaceStr);
                  if (printOnMatch) explicitlyPrinted = true;
                }
              } catch (err) {
                // Invalid regex, ignore or keep line
              }
              continue;
            }

            // Line delete: <number>d or <start>,<end>d or /pattern/d
            if (cmd === 'd') {
              isDeleted = true;
              break;
            }
            const singleNumDelete = cmd.match(/^(\d+)d$/);
            if (singleNumDelete && parseInt(singleNumDelete[1], 10) === lineNum) {
              isDeleted = true;
              break;
            }
            const rangeNumDelete = cmd.match(/^(\d+),(\d+)d$/);
            if (rangeNumDelete) {
              const start = parseInt(rangeNumDelete[1], 10);
              const end = parseInt(rangeNumDelete[2], 10);
              if (lineNum >= start && lineNum <= end) {
                isDeleted = true;
                break;
              }
            }
            const regexDelete = cmd.match(/^\/(.+?)\/d$/);
            if (regexDelete) {
              try {
                if (new RegExp(regexDelete[1]).test(line)) {
                  isDeleted = true;
                  break;
                }
              } catch (e) {}
            }

            // Line print: <number>p or /pattern/p
            if (cmd === 'p') {
              explicitlyPrinted = true;
            }
            const singleNumPrint = cmd.match(/^(\d+)p$/);
            if (singleNumPrint && parseInt(singleNumPrint[1], 10) === lineNum) {
              explicitlyPrinted = true;
            }
            const regexPrint = cmd.match(/^\/(.+?)\/p$/);
            if (regexPrint) {
              try {
                if (new RegExp(regexPrint[1]).test(line)) {
                  explicitlyPrinted = true;
                }
              } catch (e) {}
            }
          }

          if (isDeleted) continue;

          if (suppressPrinting) {
            if (explicitlyPrinted) {
              outputLines.push(line);
            }
          } else {
            outputLines.push(line);
            if (explicitlyPrinted) {
              outputLines.push(line);
            }
          }
        }

        return outputLines.join('\n');
      };

      for (const target of fileTargets) {
        if (target === '-') {
          const processed = processTextWithSed(ctx.pipeInput ?? '');
          totalStdout += processed + (processed.endsWith('\n') ? '' : '\n');
          continue;
        }

        const content = ctx.vfs.readFile(target, ctx.env['USER'] || 'hello');
        if (content === null) {
          totalStderr += `sed: can't read ${target}: No such file or directory\n`;
          exitCode = 2;
          continue;
        }

        const processed = processTextWithSed(content);
        if (inPlace) {
          ctx.vfs.writeFile(target, processed);
        } else {
          totalStdout += processed + (processed.endsWith('\n') ? '' : '\n');
        }
      }

      return { stdout: totalStdout, stderr: totalStderr, exitCode };
    },
  },
  {
    name: 'awk',
    description: 'Pattern scanning and processing language ({print $N}, -F, -v, NR, NF, BEGIN, END)',
    category: 'text',
    execute: (ctx) => {
      let delimiter = '[ \\t]+';
      const variables: Record<string, string> = {};
      let script = '';
      const positional: string[] = [];

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg === '-F' && ctx.args[i + 1]) {
          delimiter = ctx.args[i + 1];
          i++;
        } else if (arg.startsWith('-F')) {
          delimiter = arg.slice(2);
        } else if (arg === '-v' && ctx.args[i + 1]) {
          const [k, v] = ctx.args[i + 1].split('=');
          if (k) variables[k] = v || '';
          i++;
        } else if (!script) {
          script = arg;
        } else {
          positional.push(arg);
        }
      }

      if (!script) {
        return { stdout: '', stderr: 'awk: missing program\n', exitCode: 1 };
      }

      const fileTargets = positional.length > 0 ? positional : ['-'];
      const rawLines: string[] = [];

      for (const target of fileTargets) {
        if (target === '-') {
          if (ctx.pipeInput) rawLines.push(...ctx.pipeInput.split('\n'));
        } else {
          const content = ctx.vfs.readFile(target, ctx.env['USER'] || 'hello');
          if (content !== null) {
            rawLines.push(...content.split('\n'));
          } else {
            return { stdout: '', stderr: `awk: cannot open file ${target}\n`, exitCode: 2 };
          }
        }
      }

      // Parse BEGIN, Main, and END blocks
      let beginAction = '';
      let endAction = '';
      let mainAction = script;

      const beginMatch = script.match(/BEGIN\s*\{([\s\S]*?)\}/);
      if (beginMatch) {
        beginAction = beginMatch[1];
        mainAction = mainAction.replace(beginMatch[0], '');
      }

      const endMatch = script.match(/END\s*\{([\s\S]*?)\}/);
      if (endMatch) {
        endAction = endMatch[1];
        mainAction = mainAction.replace(endMatch[0], '');
      }

      mainAction = mainAction.trim();

      const outputLines: string[] = [];

      // Execute an action block
      const executeAction = (actionStr: string, line: string, nr: number) => {
        const fields = line ? line.trim().split(new RegExp(delimiter)) : [];
        const nf = fields.length;

        // Support simple print statement e.g. print $1, $2, "hello", NR, NF
        const printStatements = actionStr.match(/print\s+(.+?)(?:;|$)/g) || [actionStr];
        for (const stmt of printStatements) {
          const cleanStmt = stmt.replace(/^print\s+/, '').replace(/;$/, '').trim();
          if (!cleanStmt || cleanStmt === '$0') {
            outputLines.push(line);
            continue;
          }

          // Split arguments by comma
          const parts = cleanStmt.split(',').map((p) => p.trim());
          const renderedParts = parts.map((part) => {
            if ((part.startsWith('"') && part.endsWith('"')) || (part.startsWith("'") && part.endsWith("'"))) {
              return part.slice(1, -1);
            }
            if (part === '$0') return line;
            if (part === 'NR') return nr.toString();
            if (part === 'NF') return nf.toString();
            if (variables[part] !== undefined) return variables[part];

            const colMatch = part.match(/^\$(\d+)$/);
            if (colMatch) {
              const colIdx = parseInt(colMatch[1], 10);
              if (colIdx === 0) return line;
              return fields[colIdx - 1] ?? '';
            }
            if (part === '$NF') {
              return fields[fields.length - 1] ?? '';
            }
            return part;
          });

          outputLines.push(renderedParts.join(' '));
        }
      };

      if (beginAction) {
        executeAction(beginAction, '', 0);
      }

      let lineNum = 0;
      for (const line of rawLines) {
        if (!line && lineNum === rawLines.length - 1) continue;
        lineNum++;

        if (mainAction) {
          // Extract pattern condition if any e.g. /pattern/ { action } or $1 == "x" { action }
          const blockMatch = mainAction.match(/^([\s\S]*?)\{([\s\S]*?)\}$/);
          if (blockMatch) {
            const condition = blockMatch[1].trim();
            const actionBody = blockMatch[2].trim();

            let shouldRun = true;
            if (condition) {
              if (condition.startsWith('/') && condition.endsWith('/')) {
                const pat = condition.slice(1, -1);
                shouldRun = new RegExp(pat).test(line);
              } else if (condition.includes('==')) {
                const [left, right] = condition.split('==').map((s) => s.trim().replace(/^["']|["']$/g, ''));
                if (left.startsWith('$')) {
                  const idx = parseInt(left.slice(1), 10);
                  const fields = line.trim().split(new RegExp(delimiter));
                  shouldRun = (fields[idx - 1] ?? '') === right;
                }
              }
            }

            if (shouldRun) {
              executeAction(actionBody || 'print $0', line, lineNum);
            }
          } else {
            executeAction(mainAction, line, lineNum);
          }
        }
      }

      if (endAction) {
        executeAction(endAction, '', lineNum);
      }

      const res = outputLines.join('\n');
      return { stdout: res ? res + '\n' : '', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'sort',
    description: 'Sort lines of text files (-n, -r, -k, -t, -u, -f, -h, -o)',
    category: 'text',
    execute: (ctx) => {
      const flags = new Set<string>();
      let keyPos: number | null = null;
      let fieldSep: string | null = null;
      let outputFile: string | null = null;
      const files: string[] = [];

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg === '-k' && ctx.args[i + 1]) {
          keyPos = parseInt(ctx.args[i + 1], 10);
          i++;
        } else if (arg.startsWith('-k')) {
          keyPos = parseInt(arg.slice(2), 10);
        } else if (arg === '-t' && ctx.args[i + 1]) {
          fieldSep = ctx.args[i + 1];
          i++;
        } else if (arg.startsWith('-t')) {
          fieldSep = arg.slice(2);
        } else if (arg === '-o' && ctx.args[i + 1]) {
          outputFile = ctx.args[i + 1];
          i++;
        } else if (arg.startsWith('--')) {
          flags.add(arg.slice(2));
        } else if (arg.startsWith('-') && arg.length > 1) {
          for (let j = 1; j < arg.length; j++) {
            flags.add(arg[j]);
          }
        } else {
          files.push(arg);
        }
      }

      const numeric = flags.has('n') || flags.has('numeric-sort');
      const reverse = flags.has('r') || flags.has('reverse');
      const unique = flags.has('u') || flags.has('unique');
      const ignoreCase = flags.has('f') || flags.has('ignore-case');
      const humanNumeric = flags.has('h') || flags.has('human-numeric-sort');

      let rawText = '';
      if (files.length === 0 || (files.length === 1 && files[0] === '-')) {
        rawText = ctx.pipeInput ?? '';
      } else {
        for (const file of files) {
          const content = ctx.vfs.readFile(file, ctx.env['USER'] || 'hello');
          if (content !== null) {
            rawText += (rawText ? '\n' : '') + content;
          } else {
            return { stdout: '', stderr: `sort: cannot read: ${file}: No such file or directory\n`, exitCode: 2 };
          }
        }
      }

      let lines = rawText.split('\n').filter(Boolean);

      const parseHumanNumber = (s: string): number => {
        const match = s.trim().match(/^([0-9.]+)\s*([KMGTPEZYkmgtpezy]?)/);
        if (!match) return 0;
        const val = parseFloat(match[1]) || 0;
        const unit = match[2].toUpperCase();
        const map: Record<string, number> = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };
        return val * (map[unit] || 1);
      };

      const getKey = (line: string): string => {
        if (keyPos === null) return line;
        const parts = fieldSep !== null ? line.split(fieldSep) : line.trim().split(/\s+/);
        return parts[keyPos - 1] ?? '';
      };

      lines.sort((a, b) => {
        const ka = getKey(a);
        const kb = getKey(b);

        let cmp = 0;
        if (humanNumeric) {
          cmp = parseHumanNumber(ka) - parseHumanNumber(kb);
        } else if (numeric) {
          const na = parseFloat(ka);
          const nb = parseFloat(kb);
          cmp = (isNaN(na) ? 0 : na) - (isNaN(nb) ? 0 : nb);
        } else if (ignoreCase) {
          cmp = ka.toLowerCase().localeCompare(kb.toLowerCase());
        } else {
          cmp = ka.localeCompare(kb);
        }

        return reverse ? -cmp : cmp;
      });

      if (unique) {
        lines = Array.from(new Set(lines));
      }

      const result = lines.join('\n') + (lines.length > 0 ? '\n' : '');
      if (outputFile) {
        ctx.vfs.writeFile(outputFile, result);
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      return { stdout: result, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'uniq',
    description: 'Report or omit repeated lines (-c, -d, -u, -i, -f, -s)',
    category: 'text',
    execute: (ctx) => {
      const flags = new Set<string>();
      let skipFields = 0;
      let skipChars = 0;
      const files: string[] = [];

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg === '-f' && ctx.args[i + 1]) {
          skipFields = parseInt(ctx.args[i + 1], 10) || 0;
          i++;
        } else if (arg === '-s' && ctx.args[i + 1]) {
          skipChars = parseInt(ctx.args[i + 1], 10) || 0;
          i++;
        } else if (arg.startsWith('--')) {
          flags.add(arg.slice(2));
        } else if (arg.startsWith('-') && arg.length > 1) {
          for (let j = 1; j < arg.length; j++) flags.add(arg[j]);
        } else {
          files.push(arg);
        }
      }

      const countOnly = flags.has('c') || flags.has('count');
      const repeatedOnly = flags.has('d') || flags.has('repeated');
      const uniqueOnly = flags.has('u') || flags.has('unique');
      const ignoreCase = flags.has('i') || flags.has('ignore-case');

      let rawText = '';
      if (files.length === 0 || files[0] === '-') {
        rawText = ctx.pipeInput ?? '';
      } else {
        const content = ctx.vfs.readFile(files[0], ctx.env['USER'] || 'hello');
        if (content === null) {
          return { stdout: '', stderr: `uniq: ${files[0]}: No such file or directory\n`, exitCode: 1 };
        }
        rawText = content;
      }

      const lines = rawText.split('\n').filter((l, i, arr) => i < arr.length - 1 || l !== '');

      const getCompareKey = (line: string) => {
        let text = line;
        if (skipFields > 0) {
          const parts = text.trim().split(/\s+/);
          text = parts.slice(skipFields).join(' ');
        }
        if (skipChars > 0) {
          text = text.slice(skipChars);
        }
        return ignoreCase ? text.toLowerCase() : text;
      };

      // Group adjacent lines
      const groups: { line: string; count: number }[] = [];
      for (const line of lines) {
        const key = getCompareKey(line);
        if (groups.length === 0 || getCompareKey(groups[groups.length - 1].line) !== key) {
          groups.push({ line, count: 1 });
        } else {
          groups[groups.length - 1].count++;
        }
      }

      const outLines: string[] = [];
      for (const g of groups) {
        if (repeatedOnly && g.count < 2) continue;
        if (uniqueOnly && g.count !== 1) continue;

        if (countOnly) {
          outLines.push(`${g.count.toString().padStart(7, ' ')} ${g.line}`);
        } else {
          outLines.push(g.line);
        }
      }

      const outputStr = outLines.join('\n') + (outLines.length > 0 ? '\n' : '');

      if (files.length > 1) {
        ctx.vfs.writeFile(files[1], outputStr);
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      return { stdout: outputStr, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'tr',
    description: 'Translate, squeeze, or delete characters (supports -d, -s, classes, ranges)',
    category: 'text',
    execute: (ctx) => {
      const flags = new Set<string>();
      const sets: string[] = [];

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg.startsWith('--')) {
          flags.add(arg.slice(2));
        } else if (arg.startsWith('-') && arg.length > 1 && !sets.length) {
          for (let j = 1; j < arg.length; j++) flags.add(arg[j]);
        } else {
          sets.push(arg);
        }
      }

      const deleteMode = flags.has('d') || flags.has('delete');
      const squeezeMode = flags.has('s') || flags.has('squeeze-repeats');

      const expandSet = (s: string): string[] => {
        let clean = s.replace(/^["']|["']$/g, '');
        // Replace named classes
        clean = clean.replace(/\[:lower:\]/g, 'abcdefghijklmnopqrstuvwxyz');
        clean = clean.replace(/\[:upper:\]/g, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
        clean = clean.replace(/\[:digit:\]/g, '0123456789');
        clean = clean.replace(/\[:alpha:\]/g, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ');
        clean = clean.replace(/\[:alnum:\]/g, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
        clean = clean.replace(/\[:space:\]/g, ' \t\n\r');
        clean = clean.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r');

        const chars: string[] = [];
        for (let i = 0; i < clean.length; i++) {
          if (i + 2 < clean.length && clean[i + 1] === '-') {
            const startCode = clean.charCodeAt(i);
            const endCode = clean.charCodeAt(i + 2);
            for (let c = startCode; c <= endCode; c++) {
              chars.push(String.fromCharCode(c));
            }
            i += 2;
          } else {
            chars.push(clean[i]);
          }
        }
        return chars;
      };

      const set1 = sets[0] ? expandSet(sets[0]) : [];
      const set2 = sets[1] ? expandSet(sets[1]) : [];
      const text = ctx.pipeInput ?? '';

      if (deleteMode) {
        const deleteSet = new Set(set1);
        let out = '';
        for (const ch of text) {
          if (!deleteSet.has(ch)) out += ch;
        }
        return { stdout: out, stderr: '', exitCode: 0 };
      }

      if (squeezeMode && sets.length === 1) {
        const sqSet = new Set(set1);
        let out = '';
        let lastCh = '';
        for (const ch of text) {
          if (sqSet.has(ch) && ch === lastCh) continue;
          out += ch;
          lastCh = ch;
        }
        return { stdout: out, stderr: '', exitCode: 0 };
      }

      // Translation mode
      const map = new Map<string, string>();
      for (let i = 0; i < set1.length; i++) {
        const targetCh = i < set2.length ? set2[i] : set2[set2.length - 1] || '';
        map.set(set1[i], targetCh);
      }

      let out = '';
      for (const ch of text) {
        out += map.has(ch) ? map.get(ch)! : ch;
      }

      return { stdout: out, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'tee',
    description: 'Read from standard input and write to standard output and files (-a for append)',
    category: 'text',
    execute: (ctx) => {
      const appendMode = ctx.args.includes('-a') || ctx.args.includes('--append');
      const files = ctx.args.filter((a) => !a.startsWith('-'));
      const text = ctx.pipeInput ?? '';

      for (const file of files) {
        if (appendMode) {
          const existing = ctx.vfs.readFile(file, ctx.env['USER'] || 'hello') ?? '';
          ctx.vfs.writeFile(file, existing + text);
        } else {
          ctx.vfs.writeFile(file, text);
        }
      }

      return { stdout: text, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'cut',
    description: 'Remove sections from each line of files (-d, -f, -c, -s)',
    category: 'text',
    execute: (ctx) => {
      let delimiter = '\t';
      let fieldsStr: string | null = null;
      let charsStr: string | null = null;
      let onlyDelimited = false;
      const files: string[] = [];

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg === '-d' && ctx.args[i + 1]) {
          delimiter = ctx.args[i + 1];
          i++;
        } else if (arg.startsWith('-d')) {
          delimiter = arg.slice(2);
        } else if (arg === '-f' && ctx.args[i + 1]) {
          fieldsStr = ctx.args[i + 1];
          i++;
        } else if (arg.startsWith('-f')) {
          fieldsStr = arg.slice(2);
        } else if (arg === '-c' && ctx.args[i + 1]) {
          charsStr = ctx.args[i + 1];
          i++;
        } else if (arg.startsWith('-c')) {
          charsStr = arg.slice(2);
        } else if (arg === '-s' || arg === '--only-delimited') {
          onlyDelimited = true;
        } else {
          files.push(arg);
        }
      }

      const parseRanges = (str: string): ((idx: number) => boolean) => {
        const parts = str.split(',').map((p) => p.trim());
        return (idx: number) => {
          for (const p of parts) {
            if (p.includes('-')) {
              const [startStr, endStr] = p.split('-');
              const start = startStr ? parseInt(startStr, 10) : 1;
              const end = endStr ? parseInt(endStr, 10) : Infinity;
              if (idx >= start && idx <= end) return true;
            } else {
              if (parseInt(p, 10) === idx) return true;
            }
          }
          return false;
        };
      };

      let rawText = '';
      if (files.length === 0 || files[0] === '-') {
        rawText = ctx.pipeInput ?? '';
      } else {
        for (const f of files) {
          const content = ctx.vfs.readFile(f, ctx.env['USER'] || 'hello');
          if (content !== null) rawText += (rawText ? '\n' : '') + content;
          else return { stdout: '', stderr: `cut: ${f}: No such file or directory\n`, exitCode: 1 };
        }
      }

      const lines = rawText.split('\n');
      const outLines: string[] = [];

      if (charsStr) {
        const inRange = parseRanges(charsStr);
        for (const line of lines) {
          let lineOut = '';
          for (let c = 0; c < line.length; c++) {
            if (inRange(c + 1)) lineOut += line[c];
          }
          outLines.push(lineOut);
        }
      } else if (fieldsStr) {
        const inRange = parseRanges(fieldsStr);
        for (const line of lines) {
          if (!line.includes(delimiter)) {
            if (!onlyDelimited) outLines.push(line);
            continue;
          }
          const parts = line.split(delimiter);
          const selected = parts.filter((_, idx) => inRange(idx + 1));
          outLines.push(selected.join(delimiter));
        }
      } else {
        return { stdout: '', stderr: 'cut: you must specify a list of bytes, characters, or fields\n', exitCode: 1 };
      }

      const res = outLines.join('\n');
      return { stdout: res.endsWith('\n') ? res : res + '\n', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'diff',
    description: 'Compare files line by line (-u, -w, -i, -q)',
    category: 'text',
    execute: (ctx) => {
      const flags = new Set<string>();
      const files: string[] = [];

      for (const arg of ctx.args) {
        if (arg.startsWith('--')) flags.add(arg.slice(2));
        else if (arg.startsWith('-') && arg.length > 1) {
          for (let j = 1; j < arg.length; j++) flags.add(arg[j]);
        } else {
          files.push(arg);
        }
      }

      if (files.length < 2) return { stdout: '', stderr: 'diff: missing operand\n', exitCode: 2 };

      const file1 = ctx.vfs.readFile(files[0], ctx.env['USER'] || 'hello');
      const file2 = ctx.vfs.readFile(files[1], ctx.env['USER'] || 'hello');

      if (file1 === null) return { stdout: '', stderr: `diff: ${files[0]}: No such file or directory\n`, exitCode: 2 };
      if (file2 === null) return { stdout: '', stderr: `diff: ${files[1]}: No such file or directory\n`, exitCode: 2 };

      const ignoreCase = flags.has('i') || flags.has('ignore-case');
      const ignoreSpace = flags.has('w') || flags.has('ignore-all-space');
      const brief = flags.has('q') || flags.has('brief');

      const normalize = (l: string) => {
        let res = l;
        if (ignoreSpace) res = res.replace(/\s+/g, '');
        if (ignoreCase) res = res.toLowerCase();
        return res;
      };

      if (normalize(file1) === normalize(file2)) {
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      if (brief) {
        return { stdout: `Files ${files[0]} and ${files[1]} differ\n`, stderr: '', exitCode: 1 };
      }

      const l1 = file1.split('\n');
      const l2 = file2.split('\n');
      let diffOut = `--- ${files[0]}\t2026-09-01 00:00:00.000000000 +0800\n+++ ${files[1]}\t2026-09-01 00:00:00.000000000 +0800\n@@ -1,${l1.length} +1,${l2.length} @@\n`;

      const max = Math.max(l1.length, l2.length);
      for (let idx = 0; idx < max; idx++) {
        const line1 = l1[idx];
        const line2 = l2[idx];

        if (line1 !== undefined && line2 !== undefined) {
          if (normalize(line1) === normalize(line2)) {
            diffOut += ` ${line1}\n`;
          } else {
            diffOut += `-${line1}\n+${line2}\n`;
          }
        } else if (line1 !== undefined) {
          diffOut += `-${line1}\n`;
        } else if (line2 !== undefined) {
          diffOut += `+${line2}\n`;
        }
      }

      return { stdout: diffOut, stderr: '', exitCode: 1 };
    },
  },
  {
    name: 'paste',
    description: 'Merge lines of files (-d, -s)',
    category: 'text',
    execute: (ctx) => {
      let delimiters = '\t';
      let serialMode = false;
      const files: string[] = [];

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg === '-d' && ctx.args[i + 1]) {
          delimiters = ctx.args[i + 1];
          i++;
        } else if (arg.startsWith('-d')) {
          delimiters = arg.slice(2);
        } else if (arg === '-s' || arg === '--serial') {
          serialMode = true;
        } else {
          files.push(arg);
        }
      }

      if (files.length === 0) return { stdout: '', stderr: 'paste: missing operand\n', exitCode: 1 };

      const contents: string[][] = [];
      for (const f of files) {
        if (f === '-') {
          contents.push((ctx.pipeInput ?? '').split('\n'));
        } else {
          const content = ctx.vfs.readFile(f, ctx.env['USER'] || 'hello');
          if (content === null) return { stdout: '', stderr: `paste: ${f}: No such file or directory\n`, exitCode: 1 };
          contents.push(content.split('\n'));
        }
      }

      if (serialMode) {
        const outLines = contents.map((c) => c.join(delimiters[0] || '\t'));
        return { stdout: outLines.join('\n') + '\n', stderr: '', exitCode: 0 };
      }

      const maxLines = Math.max(...contents.map((c) => c.length));
      const outLines: string[] = [];

      for (let i = 0; i < maxLines; i++) {
        const lineParts = contents.map((c) => c[i] || '');
        let lineOut = '';
        for (let j = 0; j < lineParts.length; j++) {
          lineOut += lineParts[j];
          if (j < lineParts.length - 1) {
            const delimChar = delimiters[j % delimiters.length];
            lineOut += delimChar;
          }
        }
        outLines.push(lineOut);
      }

      return { stdout: outLines.join('\n') + '\n', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'nl',
    description: 'Number lines of files (-b, -n, -w, -s, -v, -i)',
    category: 'text',
    execute: (ctx) => {
      let bodyType = 't'; // 'a' (all), 't' (non-empty), 'n' (none)
      let numFormat = 'rn'; // 'ln', 'rn', 'rz'
      let width = 6;
      let sep = '\t';
      let startNum = 1;
      let step = 1;
      const files: string[] = [];

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg === '-b' && ctx.args[i + 1]) {
          bodyType = ctx.args[i + 1];
          i++;
        } else if (arg === '-n' && ctx.args[i + 1]) {
          numFormat = ctx.args[i + 1];
          i++;
        } else if (arg === '-w' && ctx.args[i + 1]) {
          width = parseInt(ctx.args[i + 1], 10) || 6;
          i++;
        } else if (arg === '-s' && ctx.args[i + 1]) {
          sep = ctx.args[i + 1];
          i++;
        } else if (arg === '-v' && ctx.args[i + 1]) {
          startNum = parseInt(ctx.args[i + 1], 10) || 1;
          i++;
        } else if (arg === '-i' && ctx.args[i + 1]) {
          step = parseInt(ctx.args[i + 1], 10) || 1;
          i++;
        } else {
          files.push(arg);
        }
      }

      let rawText = '';
      if (files.length === 0 || files[0] === '-') {
        rawText = ctx.pipeInput ?? '';
      } else {
        for (const f of files) {
          const content = ctx.vfs.readFile(f, ctx.env['USER'] || 'hello');
          if (content !== null) rawText += (rawText ? '\n' : '') + content;
          else return { stdout: '', stderr: `nl: ${f}: No such file or directory\n`, exitCode: 1 };
        }
      }

      const lines = rawText.split('\n');
      let currNum = startNum;
      const outLines: string[] = [];

      for (const line of lines) {
        const isNonEmpty = line.trim().length > 0;
        let shouldNumber = false;

        if (bodyType === 'a') shouldNumber = true;
        else if (bodyType === 't' && isNonEmpty) shouldNumber = true;

        if (shouldNumber) {
          let numStr = currNum.toString();
          if (numFormat === 'ln') numStr = numStr.padEnd(width, ' ');
          else if (numFormat === 'rz') numStr = numStr.padStart(width, '0');
          else numStr = numStr.padStart(width, ' ');

          outLines.push(`${numStr}${sep}${line}`);
          currNum += step;
        } else {
          outLines.push(`${' '.repeat(width)}${sep}${line}`);
        }
      }

      const res = outLines.join('\n');
      return { stdout: res.endsWith('\n') ? res : res + '\n', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'tac',
    description: 'Concatenate and print files in reverse line order',
    category: 'text',
    execute: (ctx) => {
      const files = ctx.args.filter((a) => !a.startsWith('-'));
      let rawText = '';

      if (files.length === 0 || files[0] === '-') {
        rawText = ctx.pipeInput ?? '';
      } else {
        for (const f of files) {
          const content = ctx.vfs.readFile(f, ctx.env['USER'] || 'hello');
          if (content !== null) rawText += (rawText ? '\n' : '') + content;
          else return { stdout: '', stderr: `tac: ${f}: No such file or directory\n`, exitCode: 1 };
        }
      }

      const lines = rawText.split('\n').filter(Boolean).reverse();
      return { stdout: lines.join('\n') + (lines.length > 0 ? '\n' : ''), stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'rev',
    description: 'Reverse lines characterwise',
    category: 'text',
    execute: (ctx) => {
      const files = ctx.args.filter((a) => !a.startsWith('-'));
      let rawText = '';

      if (files.length === 0 || files[0] === '-') {
        rawText = ctx.pipeInput ?? '';
      } else {
        for (const f of files) {
          const content = ctx.vfs.readFile(f, ctx.env['USER'] || 'hello');
          if (content !== null) rawText += (rawText ? '\n' : '') + content;
          else return { stdout: '', stderr: `rev: ${f}: No such file or directory\n`, exitCode: 1 };
        }
      }

      const reversed = rawText.split('\n').map((l) => l.split('').reverse().join('')).join('\n');
      return { stdout: reversed + (reversed.endsWith('\n') ? '' : '\n'), stderr: '', exitCode: 0 };
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
