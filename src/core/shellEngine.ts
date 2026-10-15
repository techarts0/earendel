import { globalVFS, VirtualFileSystem } from './vfs';
import { globalProcessManager, ProcessManager } from './processManager';
import { globalCommandRegistry } from './commandRegistry';
import { ExecutionContext, ExecutionResult, ProcessSyscall } from './types';
import { Language } from '../i18n/translations';
import { syscall, syscallAs } from '../kernel/syscall';
import { SyscallNo } from '../kernel/types';
import './commands'; // Ensure all command plugins are auto-registered
import { ASTNode, FlowSignal, parseShellScript, splitStatements } from './shellParser';
import { createCapabilityVfsView } from './scopedVfs';
import { globalCapabilityManager } from '../kernel/capability';
import { globalTaskScheduler } from '../kernel/taskScheduler';

export class ShellEngine {
  public vfs: VirtualFileSystem;
  public processManager: ProcessManager;
  public callerPid = 24;
  public abortSignal?: AbortSignal;

  private syscallFor(pid = this.callerPid): ProcessSyscall {
    return (sysNo, ...args) => syscallAs(pid, sysNo, ...args);
  }

  private executionVfs(): VirtualFileSystem {
    return createCapabilityVfsView(
      this.vfs,
      this.callerPid,
      this.envValues['USER'] || 'hello',
      { allowChangeDirectory: true, liveCwd: true },
    );
  }

  private readonly envValues: Record<string, string> = {
    USER: 'hello',
    HOME: '/home/hello',
    PWD: '/home/hello',
    SHELL: '/bin/bash',
    TERM: 'xterm-256color',
    PATH: '/bin:/usr/bin',
  };
  private env: Record<string, string> = new Proxy(this.envValues, {
    set: (target, key, value) => {
      if (key === 'USER') return true;
      target[String(key)] = String(value);
      return true;
    },
    deleteProperty: (target, key) => key === 'USER' || Reflect.deleteProperty(target, key),
    defineProperty: (target, key, descriptor) => key === 'USER' || Reflect.defineProperty(target, key, descriptor),
  });

  private history: string[] = [];
  private aliases: Map<string, string> = new Map();
  public lang: Language = 'en';

  private lastExitCode: number = 0;
  private functions: Map<string, ASTNode[]> = new Map();
  private arrays: Map<string, string[]> = new Map();
  private functionLocalScopes: Map<string, string | undefined>[] = [];
  private readonlyVariables = new Set<string>();
  public promptHandler?: (prompt: string) => Promise<string>;
  public onStdout?: (text: string) => void;
  public onStderr?: (text: string) => void;

  constructor(vfs: VirtualFileSystem = globalVFS, processManager: ProcessManager = globalProcessManager) {
    this.vfs = vfs;
    this.processManager = processManager;
    this.env['?'] = '0';
    this.initDefaultAliases();
  }

  private initDefaultAliases() {
    this.aliases.set('ll', 'ls -la');
    this.aliases.set('la', 'ls -A');
    this.aliases.set('cls', 'clear');
  }

  public setAlias(name: string, cmd: string): void {
    this.aliases.set(name, cmd);
  }

  public removeAlias(name: string): boolean {
    return this.aliases.delete(name);
  }

  public getAliases(): Map<string, string> {
    return this.aliases;
  }

  private expandAlias(cmdStr: string): string {
    const firstWord = cmdStr.split(/\s+/)[0];
    if (this.aliases.has(firstWord)) {
      const target = this.aliases.get(firstWord)!;
      return cmdStr.replace(firstWord, target);
    }
    return cmdStr;
  }

  private splitOperator(text: string, operator: string): string[] {
    const parts: string[] = [];
    let quote: 'single' | 'double' | null = null;
    let escaped = false;
    let depth = 0;
    let start = 0;
    for (let i = 0; i <= text.length - operator.length; i++) {
      const ch = text[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\' && quote !== 'single') { escaped = true; continue; }
      if (quote === 'single') { if (ch === "'") quote = null; continue; }
      if (quote === 'double') { if (ch === '"') quote = null; continue; }
      if (ch === "'") { quote = 'single'; continue; }
      if (ch === '"') { quote = 'double'; continue; }
      if (ch === '(') { depth++; continue; }
      if (ch === ')') { depth = Math.max(0, depth - 1); continue; }
      if (depth === 0 && text.startsWith(operator, i)) {
        parts.push(text.slice(start, i));
        i += operator.length - 1;
        start = i + 1;
      }
    }
    if (start === 0) return [text];
    parts.push(text.slice(start));
    return parts;
  }

  private splitLogicalOperators(text: string): string[] {
    const tokens: string[] = [];
    let quote: 'single' | 'double' | null = null;
    let escaped = false;
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (escaped) { escaped = false; continue; }
      if (ch === '\\' && quote !== 'single') { escaped = true; continue; }
      if (quote === 'single') { if (ch === "'") quote = null; continue; }
      if (quote === 'double') { if (ch === '"') quote = null; continue; }
      if (ch === "'") { quote = 'single'; continue; }
      if (ch === '"') { quote = 'double'; continue; }
      if (ch === '(') { depth++; continue; }
      if (ch === ')') { depth = Math.max(0, depth - 1); continue; }
      if (depth === 0 && (text.startsWith('&&', i) || text.startsWith('||', i))) {
        tokens.push(text.slice(start, i));
        tokens.push(text.slice(i, i + 2));
        i++;
        start = i + 1;
      }
    }
    if (!tokens.length) return [text];
    tokens.push(text.slice(start));
    return tokens;
  }

  getEnv(key: string): string {
    return this.env[key] || '';
  }

  setEnv(key: string, val: string): void {
    this.env[key] = val;
  }

  /** Change the session identity only after an authentication boundary. */
  setAuthenticatedUser(user: string): void {
    this.envValues['USER'] = user;
    const process = globalTaskScheduler.getProcess(this.callerPid);
    if (process) process.user = user;
    if (user === 'root') globalCapabilityManager.grantDefaultCaps(this.callerPid);
    else globalCapabilityManager.grantUserDefaults(this.callerPid, user);
  }

  public setArray(name: string, values: string[]): void {
    for (const key of Object.keys(this.env)) {
      if (key.startsWith(`${name}[`) && key.endsWith(']')) {
        delete this.env[key];
      }
    }
    this.arrays.set(name, values);
    values.forEach((v, idx) => {
      this.env[`${name}[${idx}]`] = v;
    });
  }

  public getArray(name: string): string[] | undefined {
    return this.arrays.get(name);
  }

  public setPromptHandler(handler: (prompt: string) => Promise<string>): void {
    this.promptHandler = handler;
  }

  getHistory(): string[] {
    return this.history;
  }

  clearHistory(): void {
    this.history = [];
  }

  deleteHistoryIndex(index: number): boolean {
    if (index >= 0 && index < this.history.length) {
      this.history.splice(index, 1);
      return true;
    }
    return false;
  }

  private expandVariables(text: string, scriptArgs: string[] = []): string {
    const literals: string[] = [];
    let result = text.replace(/'(?:[^']*)'/g, (quoted) => {
      const marker = `\u0000SINGLE_${literals.length}\u0000`;
      literals.push(quoted);
      return marker;
    });

    // 1. Array expansions: ${arr[idx]}, ${arr[@]}, ${arr[*]}
    result = result.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\[(\d+|@|\*)\]\}/g, (match, arrName, idx) => {
      const arr = this.arrays.get(arrName);
      if (idx === '@' || idx === '*') {
        return arr ? arr.join(' ') : '';
      }
      const numIdx = parseInt(idx, 10);
      if (arr && arr[numIdx] !== undefined) {
        return arr[numIdx];
      }
      if (this.env[`${arrName}[${idx}]`] !== undefined) {
        return this.env[`${arrName}[${idx}]`];
      }
      return '';
    });
    result = result.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\[([A-Za-z_][A-Za-z0-9_]*)\]\}/g, (_m, arrName, indexName) => {
      const index = Number(this.env[indexName] || 0);
      return this.arrays.get(arrName)?.[index] ?? this.env[`${arrName}[${index}]`] ?? '';
    });

    // 2. Array length: ${#arr[@]} or ${#arr[*]}
    result = result.replace(/\$\{#([A-Za-z_][A-Za-z0-9_]*)\[(@|\*)\]\}/g, (match, arrName) => {
      const arr = this.arrays.get(arrName);
      return arr ? arr.length.toString() : '0';
    });
    result = result.replace(/\$\{#([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name) => String((this.env[name] ?? '').length));

    // Indexed array names: ${!array[@]}
    result = result.replace(/\$\{!([A-Za-z_][A-Za-z0-9_]*)\[(?:@|\*)\]\}/g, (_m, name) => {
      const values = this.arrays.get(name) || [];
      return values.map((_value, index) => String(index)).join(' ');
    });

    // Bash substring and pattern-removal/replacement parameter operators.
    result = result.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::(-?\d+)(?::(\d+))?)\}/g, (m, name, offsetText, lengthText) => {
      const value = this.env[name] ?? '';
      const offset = Number(offsetText);
      const start = offset < 0 ? Math.max(0, value.length + offset) : offset;
      return lengthText === undefined ? value.slice(start) : value.slice(start, start + Number(lengthText));
    });
    result = result.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\[(?:@|\*)\]:(-?\d+)(?::(\d+))?\}/g, (_m, name, offsetText, lengthText) => {
      const values = this.arrays.get(name) || [];
      const offset = Number(offsetText);
      const start = offset < 0 ? Math.max(0, values.length + offset) : offset;
      return values.slice(start, lengthText === undefined ? undefined : start + Number(lengthText)).join(' ');
    });
    result = result.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(##|#|%%|%)(.*?)\}/g, (_m, name, op, pattern) => {
      const value = this.env[name] ?? '';
      const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
      const matches = Array.from({ length: value.length + 1 }, (_unused, i) => i).filter((i) => {
        const candidate = op.includes('#') ? value.slice(0, i) : value.slice(i);
        return new RegExp(`^${escaped}$`).test(candidate);
      });
      if (!matches.length) return value;
      if (op.includes('#')) return value.slice(op === '##' ? Math.max(...matches) : Math.min(...matches));
      return value.slice(0, op === '%%' ? Math.min(...matches) : Math.max(...matches));
    });
    result = result.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(\/\/|\/#|\/%|\/)(.*?)(?:\/(.*?))?\}/g, (_m, name, op, pattern, replacement = '') => {
      const value = this.env[name] ?? '';
      const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
      if (op === '/#') return value.replace(new RegExp(`^${escaped}`), replacement);
      if (op === '/%') return value.replace(new RegExp(`${escaped}$`), replacement);
      return value.replace(new RegExp(escaped, op === '//' ? 'g' : ''), replacement);
    });

    // 3. Positional and environment variables
    result = result.replace(/\$(?:\{([^}]+)\}|(\w+|\d+|\?|#|@|\*))/g, (match, p1, p2) => {
      const varName = p1 || p2;
      if (varName === '?') return this.env['?'] || '0';
      if (varName === '#') return scriptArgs.length > 0 ? (scriptArgs.length - 1).toString() : '0';
      if (varName === '@' || varName === '*') return scriptArgs.length > 1 ? scriptArgs.slice(1).join(' ') : '';
      if (/^\d+$/.test(varName)) {
        const index = parseInt(varName, 10);
        return scriptArgs[index] || '';
      }
      if (this.arrays.has(varName)) {
        return this.arrays.get(varName)![0] || '';
      }
      return this.env[varName] !== undefined ? this.env[varName] : match;
    });

    return result.replace(/\u0000SINGLE_(\d+)\u0000/g, (_m, index) => literals[Number(index)] || '');
  }

  public expandArithmetic(text: string, scriptArgs: string[] = []): string {
    return text.replace(/\$\(\(([\s\S]*?)\)\)/g, (match, expr) => {
      try {
        return this.evaluateArithmeticExpression(expr, scriptArgs).toString();
      } catch {
        return '0';
      }
    });
  }

  private evaluateArithmeticExpression(rawExpr: string, scriptArgs: string[] = []): number {
    let expr = rawExpr.trim();

    const update = expr.match(/^(?:\+\+|--)?([A-Za-z_][A-Za-z0-9_]*)(\+\+|--|\s*(?:\+=|-=|=)\s*(-?\d+))?$/);
    if (update) {
      const name = update[1];
      const oldValue = Number(this.env[name] || 0) || 0;
      const operator = update[2] || '';
      if (operator === '++' || operator === '--' || expr.startsWith('++') || expr.startsWith('--')) {
        const next = oldValue + (operator.includes('--') || expr.startsWith('--') ? -1 : 1);
        this.setEnv(name, String(next));
        return expr.startsWith('++') || expr.startsWith('--') ? next : oldValue;
      }
      if (operator) {
        const assignment = operator.match(/(\+=|-=|=)\s*(-?\d+)/);
        if (assignment) {
          const next = assignment[1] === '+=' ? oldValue + Number(assignment[2]) : assignment[1] === '-=' ? oldValue - Number(assignment[2]) : Number(assignment[2]);
          this.setEnv(name, String(next));
          return next;
        }
      }
    }

    // Expand ${...} or $var
    expr = this.expandVariables(expr, scriptArgs);

    // Expand bare array access e.g. args[0], args[2]
    expr = expr.replace(/([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]/g, (match, arrName, idxStr) => {
      const idx = parseInt(idxStr, 10);
      const arr = this.arrays.get(arrName);
      if (arr && arr[idx] !== undefined) return arr[idx];
      if (this.env[`${arrName}[${idxStr}]`] !== undefined) return this.env[`${arrName}[${idxStr}]`];
      return '0';
    });

    // Expand bare variable identifiers e.g. result
    expr = expr.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g, (match, varName) => {
      if (this.env[varName] !== undefined) return this.env[varName];
      return match;
    });

    const sanitized = expr.replace(/\s+/g, '');
    if (!/^[0-9+\-*/%().*^]+$/.test(sanitized)) {
      return 0;
    }

    const jsExpr = sanitized.replace(/\^/g, '**');
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const val = Function(`"use strict"; return (${jsExpr});`)();
      const num = Number(val);
      return isNaN(num) ? 0 : Math.trunc(num);
    } catch {
      return 0;
    }
  }

  private async expandCommandSubstitutions(text: string, scriptArgs: string[] = []): Promise<string> {
    const literals: string[] = [];
    let result = text.replace(/'(?:[^']*)'/g, (quoted) => {
      const marker = `\u0000SINGLE_${literals.length}\u0000`;
      literals.push(quoted);
      return marker;
    });

    // 1. Process $(command) - do not match $((arithmetic))
    let dollarMatch = result.match(/\$\((?!\()([^)]+)\)/);
    while (dollarMatch) {
      const subCmd = dollarMatch[1];
      const res = await this.execute(subCmd, scriptArgs);
      const replacement = (res.stdout || '').replace(/\r?\n$/, '');
      result = result.replace(dollarMatch[0], replacement);
      dollarMatch = result.match(/\$\((?!\()([^)]+)\)/);
    }

    // 2. Process `command`
    let backtickMatch = result.match(/`([^`]+)`/);
    while (backtickMatch) {
      const subCmd = backtickMatch[1];
      const res = await this.execute(subCmd, scriptArgs);
      const replacement = (res.stdout || '').replace(/\r?\n$/, '');
      result = result.replace(backtickMatch[0], replacement);
      backtickMatch = result.match(/`([^`]+)`/);
    }

    return result.replace(/\u0000SINGLE_(\d+)\u0000/g, (_m, index) => literals[Number(index)] || '');
  }

  async execute(
    commandLine: string,
    scriptArgs: string[] = [],
    pipeInput?: string,
    options: { skipAliasExpansion?: boolean } = {},
  ): Promise<ExecutionResult> {
    if (this.abortSignal?.aborted) {
      this.lastExitCode = 130;
      this.env['?'] = '130';
      return { stdout: '', stderr: '', exitCode: 130 };
    }
    const trimmed = commandLine.trim();
    if (!trimmed || (trimmed.startsWith('#') && !trimmed.includes('\n'))) {
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    const aliased = options.skipAliasExpansion ? trimmed : this.expandAlias(trimmed);
    const arithmeticCommand = aliased.match(/^\(\((.*)\)\)$/s);
    if (arithmeticCommand) {
      const value = this.evaluateArithmeticExpression(arithmeticCommand[1], scriptArgs);
      const exitCode = value === 0 ? 1 : 0;
      this.lastExitCode = exitCode;
      this.env['?'] = String(exitCode);
      return { stdout: '', stderr: '', exitCode };
    }
    if (this.isShellControlFlow(aliased)) {
      if (scriptArgs.length === 0) {
        this.history.push(aliased);
      }
      const res = await this.executeControlFlow(aliased, scriptArgs);
      this.lastExitCode = res.exitCode;
      this.env['?'] = res.exitCode.toString();
      return res;
    }

    const invalidIndirectExpansion = aliased.match(/\$\{\$[^}]*\}/);
    if (invalidIndirectExpansion) {
      const stderr = `bash: ${invalidIndirectExpansion[0]}: bad substitution\n`;
      this.lastExitCode = 1;
      this.env['?'] = '1';
      return { stdout: '', stderr, exitCode: 1 };
    }

    if (scriptArgs.length === 0) {
      this.history.push(aliased);
    }
    const substituted = await this.expandCommandSubstitutions(aliased, scriptArgs);
    const assignmentMatch = substituted.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s);
    if (assignmentMatch && (this.parseArgs(substituted).length === 1 || /^[A-Za-z_][A-Za-z0-9_]*=\$\((?!\()[\s\S]*\)$/.test(aliased) || /^[A-Za-z_][A-Za-z0-9_]*=`[\s\S]*`$/.test(aliased))) {
      const name = assignmentMatch[1];
      if (this.readonlyVariables.has(name)) return { stdout: '', stderr: `bash: ${name}: readonly variable\n`, exitCode: 1 };
      let value = this.expandArithmetic(this.expandVariables(assignmentMatch[2], scriptArgs), scriptArgs);
      if (/^(['"])[\s\S]*\1$/.test(value)) value = value.slice(1, -1);
      else if (!value.includes('\n')) {
        const parsed = this.parseArgs(`${name}=${value}`)[0];
        if (parsed) value = parsed.slice(parsed.indexOf('=') + 1);
      }
      this.setEnv(name, value);
      this.env['?'] = '0';
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    const indexedAssignment = substituted.match(/^([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]=(.*)$/s);
    if (indexedAssignment) {
      const name = indexedAssignment[1];
      const index = Number(indexedAssignment[2]);
      const value = this.expandVariables(indexedAssignment[3], scriptArgs).replace(/^(['"])([\s\S]*)\1$/, '$2');
      const array = this.arrays.get(name) || [];
      array[index] = value;
      this.arrays.set(name, array);
      this.env[`${name}[${index}]`] = value;
      this.env['?'] = '0';
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    const expanded = this.expandVariables(substituted, scriptArgs);
    const withArith = this.expandArithmetic(expanded, scriptArgs);

    // Here-Document (<< EOF / << 'EOF') handling
    const heredocMatch = withArith.match(/^(.*?)\s*<<\s*['"]?([A-Za-z0-9_]+)['"]?\s*(>|>>)?\s*(\S+)?\s*(?:\|(.*))?$/);
    if (heredocMatch && !withArith.includes('\n')) {
      const leftCmd = heredocMatch[1].trim();
      const delimiter = heredocMatch[2];
      const redirOp = heredocMatch[3];
      const redirTarget = heredocMatch[4];
      const pipeNext = heredocMatch[5]?.trim();

      const targetFiles: string[] = [];
      let appendMode = false;
      if (redirOp && redirTarget) {
        targetFiles.push(redirTarget);
        appendMode = redirOp === '>>';
      }

      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        interactiveInput: {
          command: leftCmd || 'cat',
          targetFiles,
          appendMode,
          collectedLines: [],
          delimiter,
          pipelineNext: pipeNext || undefined,
          redirectTarget: redirTarget || undefined,
        },
      };
    }

    // Logical Operators && and || handling
    const logicalTokens = this.splitLogicalOperators(withArith);
    if (logicalTokens.length > 1) {
      const cleanTokens = logicalTokens.map((t) => t.trim()).filter(Boolean);
      let stdoutAcc = '';
      let stderrAcc = '';
      let currentOp: 'INIT' | 'AND' | 'OR' = 'INIT';
      let lastRes: ExecutionResult = { stdout: '', stderr: '', exitCode: 0 };

      for (const token of cleanTokens) {
        if (token === '&&') {
          currentOp = 'AND';
          continue;
        }
        if (token === '||') {
          currentOp = 'OR';
          continue;
        }

        if (currentOp === 'INIT') {
          lastRes = await this.executeControlFlow(token, scriptArgs);
          stdoutAcc += lastRes.stdout;
          if (lastRes.stderr) stderrAcc += lastRes.stderr;
        } else if (currentOp === 'AND') {
          if (lastRes.exitCode === 0) {
            lastRes = await this.executeControlFlow(token, scriptArgs);
            stdoutAcc += lastRes.stdout;
            if (lastRes.stderr) stderrAcc += lastRes.stderr;
          }
        } else if (currentOp === 'OR') {
          if (lastRes.exitCode !== 0) {
            lastRes = await this.executeControlFlow(token, scriptArgs);
            stdoutAcc += lastRes.stdout;
            if (lastRes.stderr) stderrAcc += lastRes.stderr;
          }
        }
      }

      this.env['?'] = lastRes.exitCode.toString();
      return { stdout: stdoutAcc, stderr: stderrAcc, exitCode: lastRes.exitCode };
    }

    // Pipe | handling (single pipe | not part of ||)
    const pipelineCmds = this.splitOperator(withArith, '|').map((c) => c.trim());
    if (pipelineCmds.length > 1) {
      let currentStream: AsyncIterable<string> | null = null;
      let inputData = pipeInput || '';
      let lastResult: ExecutionResult = { stdout: '', stderr: '', exitCode: 0 };
      let aggregatedStderr = '';

      for (let i = 0; i < pipelineCmds.length; i++) {
        const cmdStr = pipelineCmds[i];
        const parts = cmdStr.split(/\s+/).filter(Boolean);
        const cmdName = parts[0];
        const cmdObj = globalCommandRegistry.getCommand(cmdName);

        if (cmdObj && cmdObj.executeStream) {
          const cmdArgs = parts.slice(1);
          const ctx: ExecutionContext = {
            vfs: this.executionVfs(),
            env: this.env,
            lang: this.lang,
            args: cmdArgs,
            pipeInput: inputData,
            processManager: this.processManager,
            callerPid: this.callerPid,
            syscall: this.syscallFor(),
            abortSignal: this.abortSignal,
            shellEngine: this,
            history: this.history,
          };

          const inputStream: AsyncIterable<string> = currentStream || (async function* () {
            if (inputData) {
              const lines = inputData.split('\n');
              for (let idx = 0; idx < lines.length; idx++) {
                yield lines[idx] + (idx < lines.length - 1 ? '\n' : '');
              }
            }
          })();

          currentStream = cmdObj.executeStream(ctx, inputStream);
        } else {
          if (currentStream) {
            let collected = '';
            for await (const chunk of currentStream) {
              collected += chunk;
            }
            inputData = collected;
            currentStream = null;
          }

          lastResult = await this.executeSingleCommand(cmdStr, inputData);
          if (lastResult.stderr) {
            aggregatedStderr += lastResult.stderr;
          }
          if (lastResult.exitCode !== 0) break;
          inputData = lastResult.stdout;
        }
      }

      if (currentStream) {
        let finalOutput = '';
        for await (const chunk of currentStream) {
          finalOutput += chunk;
        }
        lastResult = { stdout: finalOutput, stderr: aggregatedStderr, exitCode: 0 };
      } else {
        lastResult.stderr = aggregatedStderr;
      }

      this.env['?'] = lastResult.exitCode.toString();
      return lastResult;
    }

    const res = await this.executeSingleCommand(withArith, pipeInput);
    this.env['?'] = res.exitCode.toString();
    return res;
  }

  private isShellControlFlow(cmdStr: string): boolean {
    return (
      /^\s*(?:for|while|if|case|function)\b/.test(cmdStr) ||
      /^\s*\w+\s*\(\)\s*\{?/.test(cmdStr) ||
      cmdStr.includes('\n') ||
      splitStatements(cmdStr).length > 1
    );
  }

  private async executeControlFlow(scriptText: string, scriptArgs: string[] = []): Promise<ExecutionResult> {
    const astNodes = parseShellScript(scriptText);
    const flowRes = await this.executeNodes(astNodes, scriptArgs);
    this.lastExitCode = flowRes.exitCode;
    this.env['?'] = flowRes.exitCode.toString();
    return {
      stdout: flowRes.stdout,
      stderr: flowRes.stderr,
      exitCode: flowRes.exitCode,
      streamed: !!this.onStdout,
    };
  }

  private async executeNodes(
    nodes: ASTNode[],
    scriptArgs: string[],
    pipeInput?: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number; signal: FlowSignal }> {
    let stdoutAcc = '';
    let stderrAcc = '';
    let lastExitCode = 0;

    for (const node of nodes) {
      if (this.abortSignal?.aborted) {
        this.lastExitCode = 130;
        this.env['?'] = '130';
        return { stdout: stdoutAcc, stderr: stderrAcc, exitCode: 130, signal: { type: 'NONE' } };
      }
      switch (node.type) {
        case 'COMMAND': {
          const res = await this.execute(node.line, scriptArgs, pipeInput);
          if (this.onStdout && res.stdout) {
            this.onStdout(res.stdout);
          }
          if (this.onStderr && res.stderr) {
            this.onStderr(res.stderr);
          }
          stdoutAcc += res.stdout;
          if (res.stderr) stderrAcc += res.stderr;
          lastExitCode = res.exitCode;
          this.lastExitCode = lastExitCode;
          this.env['?'] = lastExitCode.toString();
          break;
        }
        case 'FUNCTION_DEF': {
          this.functions.set(node.name, node.body);
          break;
        }
        case 'IF': {
          const isTrue = await this.evaluateConditionAsync(node.condition, scriptArgs);
          const targetBranch = isTrue ? node.thenBranch : node.elseBranch;
          const res = await this.executeNodes(targetBranch, scriptArgs, pipeInput);
          stdoutAcc += res.stdout;
          if (res.stderr) stderrAcc += res.stderr;
          lastExitCode = res.exitCode;
          if (res.signal.type !== 'NONE') {
            return { stdout: stdoutAcc, stderr: stderrAcc, exitCode: lastExitCode, signal: res.signal };
          }
          break;
        }
        case 'WHILE': {
          let safetyCounter = 0;
          while (!this.abortSignal?.aborted && safetyCounter < 5000) {
            const isTrue = await this.evaluateConditionAsync(node.condition, scriptArgs);
            if (!isTrue || this.abortSignal?.aborted) break;
            safetyCounter++;

            const res = await this.executeNodes(node.body, scriptArgs, pipeInput);
            stdoutAcc += res.stdout;
            if (res.stderr) stderrAcc += res.stderr;
            lastExitCode = res.exitCode;
            if (this.abortSignal?.aborted) {
              return { stdout: stdoutAcc, stderr: stderrAcc, exitCode: 130, signal: { type: 'NONE' } };
            }

            if (res.signal.type === 'BREAK') {
              if (res.signal.count <= 1) {
                break;
              } else {
                return { stdout: stdoutAcc, stderr: stderrAcc, exitCode: lastExitCode, signal: { type: 'BREAK', count: res.signal.count - 1 } };
              }
            }
            if (res.signal.type === 'CONTINUE') {
              if (res.signal.count <= 1) {
                continue;
              } else {
                return { stdout: stdoutAcc, stderr: stderrAcc, exitCode: lastExitCode, signal: { type: 'CONTINUE', count: res.signal.count - 1 } };
              }
            }
            if (res.signal.type === 'RETURN') {
              return { stdout: stdoutAcc, stderr: stderrAcc, exitCode: lastExitCode, signal: res.signal };
            }
          }
          break;
        }
        case 'FOR': {
          const expandedItems: string[] = [];
          for (const item of node.items) {
            let exp = await this.expandCommandSubstitutions(item, scriptArgs);
            exp = this.expandVariables(exp, scriptArgs);
            const range = exp.match(/^\{(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?\}$/);
            if (range) {
              const from = Number(range[1]);
              const to = Number(range[2]);
              const step = Number(range[3] || (from <= to ? 1 : -1));
              if (step !== 0) for (let n = from; step > 0 ? n <= to : n >= to; n += step) expandedItems.push(String(n));
            } else {
              expandedItems.push(...exp.split(/\s+/).filter(Boolean));
            }
          }

          for (const item of expandedItems) {
            if (this.abortSignal?.aborted) {
              return { stdout: stdoutAcc, stderr: stderrAcc, exitCode: 130, signal: { type: 'NONE' } };
            }
            this.setEnv(node.variable, item);
            const res = await this.executeNodes(node.body, scriptArgs, pipeInput);
            stdoutAcc += res.stdout;
            if (res.stderr) stderrAcc += res.stderr;
            lastExitCode = res.exitCode;
            if (this.abortSignal?.aborted) {
              return { stdout: stdoutAcc, stderr: stderrAcc, exitCode: 130, signal: { type: 'NONE' } };
            }

            if (res.signal.type === 'BREAK') {
              if (res.signal.count <= 1) break;
              return { stdout: stdoutAcc, stderr: stderrAcc, exitCode: lastExitCode, signal: { type: 'BREAK', count: res.signal.count - 1 } };
            }
            if (res.signal.type === 'CONTINUE') {
              if (res.signal.count <= 1) continue;
              return { stdout: stdoutAcc, stderr: stderrAcc, exitCode: lastExitCode, signal: { type: 'CONTINUE', count: res.signal.count - 1 } };
            }
            if (res.signal.type === 'RETURN') {
              return { stdout: stdoutAcc, stderr: stderrAcc, exitCode: lastExitCode, signal: res.signal };
            }
          }
          break;
        }
        case 'ARITHMETIC_FOR': {
          if (node.init) await this.execute(node.init, scriptArgs);
          let safetyCounter = 0;
          while (!this.abortSignal?.aborted && safetyCounter++ < 5000 && (!node.condition || this.evaluateArithmeticExpression(node.condition, scriptArgs) !== 0)) {
            const res = await this.executeNodes(node.body, scriptArgs, pipeInput);
            stdoutAcc += res.stdout;
            stderrAcc += res.stderr;
            lastExitCode = res.exitCode;
            if (this.abortSignal?.aborted) {
              return { stdout: stdoutAcc, stderr: stderrAcc, exitCode: 130, signal: { type: 'NONE' } };
            }
            if (res.signal.type === 'BREAK') {
              if (res.signal.count <= 1) break;
              return { stdout: stdoutAcc, stderr: stderrAcc, exitCode: lastExitCode, signal: { type: 'BREAK', count: res.signal.count - 1 } };
            }
            if (res.signal.type === 'CONTINUE' && res.signal.count > 1) return { stdout: stdoutAcc, stderr: stderrAcc, exitCode: lastExitCode, signal: { type: 'CONTINUE', count: res.signal.count - 1 } };
            if (res.signal.type === 'RETURN') return { stdout: stdoutAcc, stderr: stderrAcc, exitCode: lastExitCode, signal: res.signal };
            if (node.update) this.evaluateArithmeticExpression(node.update, scriptArgs);
          }
          break;
        }
        case 'CASE': {
          const targetVal = this.expandVariables(node.expression, scriptArgs).trim().replace(/^['"]|['"]$/g, '');
          for (const branch of node.branches) {
            let matched = false;
            if (branch.isDefault) {
              matched = true;
            } else {
              for (const pattern of branch.patterns) {
                if (this.matchCasePattern(targetVal, pattern)) {
                  matched = true;
                  break;
                }
              }
            }
            if (matched) {
              const res = await this.executeNodes(branch.body, scriptArgs, pipeInput);
              stdoutAcc += res.stdout;
              if (res.stderr) stderrAcc += res.stderr;
              lastExitCode = res.exitCode;
              if (res.signal.type !== 'NONE') {
                return { stdout: stdoutAcc, stderr: stderrAcc, exitCode: lastExitCode, signal: res.signal };
              }
              break;
            }
          }
          break;
        }
        case 'BREAK': {
          return { stdout: stdoutAcc, stderr: stderrAcc, exitCode: lastExitCode, signal: { type: 'BREAK', count: node.count } };
        }
        case 'CONTINUE': {
          return { stdout: stdoutAcc, stderr: stderrAcc, exitCode: lastExitCode, signal: { type: 'CONTINUE', count: node.count } };
        }
        case 'RETURN': {
          const expandedCode = this.expandVariables(node.code, scriptArgs);
          const code = /^-?\d+$/.test(expandedCode) ? Number(expandedCode) : this.evaluateArithmeticExpression(expandedCode, scriptArgs);
          this.env['?'] = String(code);
          this.lastExitCode = code;
          return { stdout: stdoutAcc, stderr: stderrAcc, exitCode: code, signal: { type: 'RETURN', exitCode: code } };
        }
      }
      if (this.abortSignal?.aborted) {
        this.lastExitCode = 130;
        this.env['?'] = '130';
        return { stdout: stdoutAcc, stderr: stderrAcc, exitCode: 130, signal: { type: 'NONE' } };
      }
    }

    return { stdout: stdoutAcc, stderr: stderrAcc, exitCode: lastExitCode, signal: { type: 'NONE' } };
  }

  private async evaluateConditionAsync(condition: string, scriptArgs: string[] = []): Promise<boolean> {
    const expanded = this.expandVariables(condition, scriptArgs).trim();
    if (!expanded) return false;

    const arithmeticCondition = expanded.match(/^\(\((.*)\)\)$/s);
    if (arithmeticCondition) return this.evaluateArithmeticExpression(arithmeticCondition[1], scriptArgs) !== 0;

    let clean = expanded;
    if (clean.startsWith('[[') && clean.endsWith(']]')) {
      clean = clean.slice(2, -2).trim();
    } else if (clean.startsWith('[') && clean.endsWith(']')) {
      clean = clean.slice(1, -1).trim();
    } else {
      if (clean === 'true') return true;
      if (clean === 'false') return false;

      const cmdRes = await this.execute(clean, scriptArgs);
      return cmdRes.exitCode === 0;
    }

    // Handle logical OR (||)
    const orParts = clean.split(/\s+\|\|\s+/);
    if (orParts.length > 1) {
      for (const part of orParts) {
        if (await this.evaluateConditionAsync(`[[ ${part} ]]`, scriptArgs)) {
          return true;
        }
      }
      return false;
    }

    // Handle logical AND (&&)
    const andParts = clean.split(/\s+&&\s+/);
    if (andParts.length > 1) {
      for (const part of andParts) {
        if (!(await this.evaluateConditionAsync(`[[ ${part} ]]`, scriptArgs))) {
          return false;
        }
      }
      return true;
    }

    return this.evaluateAtomCondition(clean);
  }

  private evaluateAtomCondition(rawAtom: string): boolean {
    const atom = rawAtom.trim();
    if (!atom) return false;
    if (atom === 'true') return true;
    if (atom === 'false') return false;

    if (atom.startsWith('! ')) {
      return !this.evaluateAtomCondition(atom.substring(2));
    }

    if (atom.startsWith('-z ')) {
      const val = atom.substring(3).trim().replace(/^["']|["']$/g, '');
      return val === '';
    }
    if (atom.startsWith('-n ')) {
      const val = atom.substring(3).trim().replace(/^["']|["']$/g, '');
      return val !== '';
    }

    if (atom.startsWith('-f ')) {
      const file = atom.substring(3).trim().replace(/^["']|["']$/g, '');
      const node = this.vfs.getNodeByPath(file);
      return node !== null && node.type === 'file';
    }
    if (atom.startsWith('-d ')) {
      const dir = atom.substring(3).trim().replace(/^["']|["']$/g, '');
      const node = this.vfs.getNodeByPath(dir);
      return node !== null && node.type === 'directory';
    }
    if (atom.startsWith('-e ')) {
      const p = atom.substring(3).trim().replace(/^["']|["']$/g, '');
      return this.vfs.getNodeByPath(p) !== null;
    }

    const match = atom.match(/^(.*?)\s+(==|=|!=|-eq|-ne|-lt|-gt|-le|-ge)\s+(.*)$/);
    if (match) {
      const left = match[1].trim().replace(/^["']|["']$/g, '');
      const op = match[2];
      const right = match[3].trim().replace(/^["']|["']$/g, '');

      const nLeft = parseFloat(left);
      const nRight = parseFloat(right);

      switch (op) {
        case '=':
        case '==':
          return left === right;
        case '!=':
          return left !== right;
        case '-eq':
          return !isNaN(nLeft) && !isNaN(nRight) && nLeft === nRight;
        case '-ne':
          return !isNaN(nLeft) && !isNaN(nRight) && nLeft !== nRight;
        case '-lt':
          return !isNaN(nLeft) && !isNaN(nRight) && nLeft < nRight;
        case '-gt':
          return !isNaN(nLeft) && !isNaN(nRight) && nLeft > nRight;
        case '-le':
          return !isNaN(nLeft) && !isNaN(nRight) && nLeft <= nRight;
        case '-ge':
          return !isNaN(nLeft) && !isNaN(nRight) && nLeft >= nRight;
      }
    }

    return Boolean(atom);
  }

  private matchCasePattern(target: string, pattern: string): boolean {
    if (pattern === target) return true;
    if (pattern === '*') return true;
    try {
      let regexStr = '^';
      for (let i = 0; i < pattern.length; i++) {
        const char = pattern[i];
        if (char === '\\' && i + 1 < pattern.length) {
          regexStr += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        } else if (char === '*') regexStr += '.*';
        else if (char === '?') regexStr += '.';
        else regexStr += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
      regexStr += '$';
      return new RegExp(regexStr).test(target);
    } catch {
      return pattern === target;
    }
  }

  private async executeSingleCommand(cmdStr: string, pipeInput: string | undefined = undefined): Promise<ExecutionResult> {
    let rawCmd = cmdStr.trim();
    let redirectTarget: string | null = null;
    let appendMode = false;

    let isBackground = false;
    if (rawCmd.endsWith('&')) {
      isBackground = true;
      rawCmd = rawCmd.slice(0, -1).trim();
    }

    if (rawCmd.includes('>>')) {
      const parts = rawCmd.split('>>');
      rawCmd = parts[0].trim();
      redirectTarget = parts[1].trim();
      appendMode = true;
    } else if (rawCmd.includes('>')) {
      const parts = rawCmd.split('>');
      rawCmd = parts[0].trim();
      redirectTarget = parts[1].trim();
      appendMode = false;
    }

    if (isBackground) {
      const job = this.processManager.addJob(rawCmd);
      return {
        stdout: `[${job.jobId}] ${job.pid}\n`,
        stderr: '',
        exitCode: 0,
      };
    }

    rawCmd = this.expandArithmetic(rawCmd);
    const arrayDeclaration = rawCmd.match(/^([A-Za-z_][A-Za-z0-9_]*)=\((.*)\)$/s);
    if (arrayDeclaration) {
      const values = this.parseArgs(arrayDeclaration[2]);
      this.setArray(arrayDeclaration[1], values);
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    const letAssignment = rawCmd.match(/^let\s+([A-Za-z_][A-Za-z0-9_]*)=\(?([\s\S]*?)\)?$/);
    if (letAssignment) {
      const value = this.evaluateArithmeticExpression(letAssignment[2]);
      this.setEnv(letAssignment[1], String(value));
      return { stdout: '', stderr: '', exitCode: value === 0 ? 1 : 0 };
    }
    const args = this.parseArgs(rawCmd);
    if (args.length === 0) return { stdout: '', stderr: '', exitCode: 0 };

    // Support inline VAR=value and ARR[idx]=value assignment syntax & childEnv isolation
    const childEnv = { ...this.env };
    let cmdIdx = 0;
    while (cmdIdx < args.length) {
      const arrayAssignMatch = args[cmdIdx].match(/^([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]=(.*)$/);
      if (arrayAssignMatch) {
        const arrName = arrayAssignMatch[1];
        const idx = parseInt(arrayAssignMatch[2], 10);
        const val = arrayAssignMatch[3].replace(/^["']|["']$/g, '');
        let arr = this.arrays.get(arrName);
        if (!arr) {
          arr = [];
          this.arrays.set(arrName, arr);
        }
        arr[idx] = val;
        this.env[`${arrName}[${idx}]`] = val;
        if (args.length === 1) {
          return { stdout: '', stderr: '', exitCode: 0 };
        }
        cmdIdx++;
        continue;
      }

      if (/^[A-Za-z_][A-Za-z0-9_]*=.*$/.test(args[cmdIdx])) {
        const eqIdx = args[cmdIdx].indexOf('=');
        const key = args[cmdIdx].substring(0, eqIdx);
        const val = args[cmdIdx].substring(eqIdx + 1).replace(/^["']|["']$/g, '');
        if (args.length === 1) {
          this.setEnv(key, val);
          return { stdout: '', stderr: '', exitCode: 0 };
        }
        childEnv[key] = val;
        cmdIdx++;
        continue;
      }

      break;
    }

    // Inline command assignments are untrusted environment data; preserve the
    // authenticated session identity for every command and its VFS checks.
    childEnv['USER'] = this.envValues['USER'];

    if (cmdIdx >= args.length) return { stdout: '', stderr: '', exitCode: 0 };

    const cmdName = args[cmdIdx];
    const rawCmdArgs = args.slice(cmdIdx + 1);
    const cmdArgs = this.expandGlobs(rawCmdArgs);

    if (cmdName === 'unset') {
      for (const name of cmdArgs) {
        delete this.env[name];
        this.arrays.delete(name);
        for (const key of Object.keys(this.env)) if (key.startsWith(`${name}[`)) delete this.env[key];
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    if (cmdName === 'readonly') {
      for (const item of cmdArgs) {
        const eq = item.indexOf('=');
        const name = eq < 0 ? item : item.slice(0, eq);
        if (eq >= 0) this.setEnv(name, item.slice(eq + 1));
        this.readonlyVariables.add(name);
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    }

    if (cmdName === 'local') {
      const scope = this.functionLocalScopes[this.functionLocalScopes.length - 1];
      for (const assignment of cmdArgs) {
        const eq = assignment.indexOf('=');
        const name = eq < 0 ? assignment : assignment.slice(0, eq);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
        if (scope && !scope.has(name)) scope.set(name, this.env[name]);
        if (eq >= 0) this.setEnv(name, assignment.slice(eq + 1));
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    }

    if (cmdName === 'let') {
      let value = 0;
      for (const expr of cmdArgs) value = this.evaluateArithmeticExpression(expr);
      return { stdout: '', stderr: '', exitCode: value === 0 ? 1 : 0 };
    }

    for (const assignment of cmdArgs) {
      const eq = assignment.indexOf('=');
      if (eq > 0 && this.readonlyVariables.has(assignment.slice(0, eq))) {
        return { stdout: '', stderr: `bash: ${assignment.slice(0, eq)}: readonly variable\n`, exitCode: 1 };
      }
    }

    let res: ExecutionResult = { stdout: '', stderr: '', exitCode: 0 };

    if (cmdName === 'break' || cmdName === 'continue') {
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    if (cmdName === 'return') {
      const code = parseInt(cmdArgs[0] || '0', 10);
      return { stdout: '', stderr: '', exitCode: isNaN(code) ? 0 : code };
    }

    if (this.functions.has(cmdName)) {
      const funcBody = this.functions.get(cmdName)!;
      const funcArgs = [cmdName, ...cmdArgs];
      const localScope = new Map<string, string | undefined>();
      this.functionLocalScopes.push(localScope);
      const funcRes = await this.executeNodes(funcBody, funcArgs, pipeInput);
      this.functionLocalScopes.pop();
      for (const [name, value] of localScope) {
        if (value === undefined) delete this.env[name];
        else this.env[name] = value;
      }
      this.lastExitCode = funcRes.exitCode;
      this.env['?'] = funcRes.exitCode.toString();
      return {
        stdout: funcRes.stdout,
        stderr: funcRes.stderr,
        exitCode: funcRes.exitCode,
      };
    }

    // Intercept /dev device pipeline commands
    if (cmdName === '/dev/ai' || cmdName === 'ai') {
      const prompt = pipeInput || cmdArgs.join(' ') || 'Status check';
      const { globalIPCBus } = await import('../kernel/ipcBus');
      const aiRes = await globalIPCBus.sendIPC(globalIPCBus.getProcessEndpoint(this.callerPid), 'driverd', 'DEV_WRITE_AI', {
        prompt,
        signal: this.abortSignal,
      });
      return { stdout: (aiRes.response || aiRes.data || '') + '\n', stderr: '', exitCode: 0 };
    }

    if (cmdName === '/dev/skill') {
      const content = pipeInput || cmdArgs.join(' ');
      const { globalHarnessEngine } = await import('./harnessEngine');
      const ctx: ExecutionContext = {
        vfs: this.executionVfs(),
        env: childEnv,
        lang: this.lang,
        args: cmdArgs,
        pipeInput,
        processManager: this.processManager,
        callerPid: this.callerPid,
        syscall: this.syscallFor(),
        abortSignal: this.abortSignal,
      };
      return await globalHarnessEngine.executeSkill(content, ctx);
    }

    if (cmdName === '/dev/net/fetch') {
      const url = pipeInput || cmdArgs.join(' ');
      const { eslibNet } = await import('./eslibNet');
      const res = await eslibNet.fetch(url, { signal: this.abortSignal }, this.syscallFor());
      return { stdout: (res?.body || res?.error || '') + '\n', stderr: '', exitCode: res?.ok ? 0 : 1 };
    }

    if (cmdName === '/dev/net/dns') {
      const hostname = pipeInput || cmdArgs.join(' ');
      const { eslibNet } = await import('./eslibNet');
      const ip = await eslibNet.gethostbyname(hostname, this.syscallFor());
      return { stdout: `${hostname} -> ${ip}\n`, stderr: '', exitCode: 0 };
    }

    if (cmdName === '/dev/null') {
      return { stdout: '', stderr: '', exitCode: 0 };
    }

    if (cmdName === '/dev/zero') {
      return { stdout: '\0'.repeat(1024), stderr: '', exitCode: 0 };
    }

    if (cmdName === '/dev/tty') {
      return { stdout: pipeInput || '', stderr: '', exitCode: 0 };
    }

    if (cmdName === '/dev/urandom' || cmdName === '/dev/random') {
      const bytes = new Uint8Array(64);
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
      const randStr = Array.from(bytes).map((b) => String.fromCharCode(b)).join('');
      return { stdout: randStr, stderr: '', exitCode: 0 };
    }

    // Native script / EAF binary executable path execution via POSIX fork() -> execve() -> waitpid()
    if (cmdName.startsWith('./') || cmdName.startsWith('/') || cmdName.endsWith('.sh') || cmdName.endsWith('.eaf') || cmdName.endsWith('.md')) {
      const activeUser = this.env['USER'] || 'hello';
      // Resolve relative executable paths before the syscall authorization
      // boundary. Capabilities are scoped to canonical absolute VFS paths.
      const scriptPath = this.vfs.resolvePath(cmdName, activeUser);
      const node = this.vfs.getNodeByPath(scriptPath);

      if (!node) {
        res = { stdout: '', stderr: `-bash: ${cmdName}: No such file or directory\n`, exitCode: 127 };
      } else if (!this.vfs.isExecutable(scriptPath)) {
        res = { stdout: '', stderr: `-bash: ${cmdName}: Permission denied\n`, exitCode: 126 };
      } else {
        // POSIX Process Lifecycle: SYS_FORK -> SYS_EXECVE -> SYS_WAITPID
        const invoke = this.syscallFor();
        const forkRes = await invoke(SyscallNo.SYS_FORK, scriptPath, this.vfs.getPwd());
        if (forkRes.code !== 0 || typeof forkRes.data !== 'number') {
          return { stdout: '', stderr: `-bash: ${cmdName}: fork failed: ${forkRes.error || 'unknown error'}\n`, exitCode: 1 };
        }
        const childPid = forkRes.data;
        const execRes = await invoke(SyscallNo.SYS_EXECVE, scriptPath, cmdArgs);
        if (execRes.code !== 0) {
          await this.syscallFor(childPid)(SyscallNo.SYS_EXIT, 126);
          await invoke(SyscallNo.SYS_WAITPID, childPid);
          return { stdout: '', stderr: `-bash: ${cmdName}: ${execRes.error || 'exec failed'}\n`, exitCode: 126 };
        }

        const content = this.vfs.readFile(scriptPath, activeUser) ?? '';

        // Check for EAF Magic Header (EAF01 or EAF\x01)
        const isEaf = scriptPath.endsWith('.eaf') || (content.includes('"magic"') && content.includes('EAF'));
        const isSkill = content.startsWith('#!/dev/skill') || content.includes('<!-- earendel-skill -->');

        if (isSkill) {
          const { globalHarnessEngine } = await import('./harnessEngine');
          const ctx: ExecutionContext = {
            vfs: this.executionVfs(),
            env: childEnv,
            lang: this.lang,
            args: cmdArgs,
            pipeInput,
            processManager: this.processManager,
            callerPid: this.callerPid,
            syscall: this.syscallFor(),
            abortSignal: this.abortSignal,
          };
          res = await globalHarnessEngine.executeSkill(content, ctx);
        } else if (isEaf) {
          try {
            const eafObj = JSON.parse(content);
            const arch = eafObj.header?.arch || 'js-vm';
            const textSection = eafObj.sections?.['.text'] || '';

            if (arch === 'wasm32') {
              const { globalWasmEngine } = await import('./wasmRuntime');
              const wasmBytes = new TextEncoder().encode(textSection);
              const ctx: ExecutionContext = {
                vfs: this.executionVfs(),
                env: childEnv,
                lang: this.lang,
                args: cmdArgs,
                pipeInput,
                processManager: this.processManager,
                callerPid: childPid,
                syscall: this.syscallFor(childPid),
                abortSignal: this.abortSignal,
              };
              res = await globalWasmEngine.executeWasm(wasmBytes, ctx);
            } else {
              const { globalJsEngine } = await import('./jsRuntime');
              const ctx: ExecutionContext = {
                vfs: this.executionVfs(),
                env: childEnv,
                lang: this.lang,
                args: [scriptPath, ...cmdArgs],
                pipeInput,
                processManager: this.processManager,
                callerPid: childPid,
                syscall: this.syscallFor(childPid),
                abortSignal: this.abortSignal,
              };
              res = await globalJsEngine.executeJsBundle(textSection, ctx);
            }
          } catch (e: any) {
            res = { stdout: '', stderr: `execve: Exec format error: ${e.message}\n`, exitCode: 126 };
          }
        } else {
          res = await this.executeControlFlow(content, [scriptPath, ...cmdArgs]);
        }

        await this.syscallFor(childPid)(SyscallNo.SYS_EXIT, res.exitCode);
        await invoke(SyscallNo.SYS_WAITPID, childPid);
      }
    } else {
      const isBuiltin = ['cd', 'export', 'unset', 'alias', 'unalias', 'exit', 'su', 'source', '.', 'read'].includes(cmdName);
      const ctx: ExecutionContext = {
        vfs: this.executionVfs(),
        env: isBuiltin ? this.env : childEnv,
        lang: this.lang,
        args: cmdArgs,
        pipeInput,
        processManager: this.processManager,
        callerPid: this.callerPid,
        syscall: this.syscallFor(),
        abortSignal: this.abortSignal,
        shellEngine: this,
        history: this.history,
      };
      res = await globalCommandRegistry.execute(cmdName, ctx);
    }

    if (redirectTarget && res.exitCode === 0) {
      const activeUser = childEnv['USER'] || this.env['USER'] || 'hello';
      const resolvedTarget = this.vfs.resolvePath(redirectTarget, activeUser);
      const openRes = await this.syscallFor()(SyscallNo.SYS_OPEN, resolvedTarget, appendMode ? 'a' : 'w');
      let writeError: string | undefined = openRes.code === 0
        ? undefined
        : openRes.error || 'Permission denied';
      if (openRes.code === 0 && typeof openRes.data === 'number') {
        try {
          const writeRes = await this.syscallFor()(SyscallNo.SYS_WRITE, openRes.data, res.stdout);
          if (writeRes.code !== 0) writeError = writeRes.error || 'Write failed';
        } finally {
          await this.syscallFor()(SyscallNo.SYS_CLOSE, openRes.data);
        }
      }
      if (writeError) {
        res = {
          stdout: '',
          stderr: `-bash: ${redirectTarget}: ${writeError}\n`,
          exitCode: 1,
        };
      } else {
        res.stdout = '';
      }
    }

    // Intercept with MAN Agent / AI Auto-Tutor if enabled and execution failed
    const { globalTutorEngine } = await import('./tutorEngine');
    if (globalTutorEngine.isEnabled() && (res.exitCode !== 0 || res.stderr.trim().length > 0)) {
      const diag = globalTutorEngine.diagnoseCommand(cmdName, cmdArgs, res.exitCode, res.stderr);
      if (diag) {
        res.stderr = (res.stderr || '') + diag;
      }
    }

    return res;
  }

  private parseArgs(cmdStr: string): string[] {
    const args: string[] = [];
    let currentArg = '';
    let inDoubleQuotes = false;
    let inSingleQuotes = false;
    let escaped = false;

    for (let i = 0; i < cmdStr.length; i++) {
      const char = cmdStr[i];

      if (escaped) {
        currentArg += char;
        escaped = false;
        continue;
      }

      if (char === '\\' && !inSingleQuotes) {
        escaped = true;
        continue;
      }

      if (char === '"' && !inSingleQuotes) {
        inDoubleQuotes = !inDoubleQuotes;
        continue;
      }

      if (char === "'" && !inDoubleQuotes) {
        inSingleQuotes = !inSingleQuotes;
        continue;
      }

      if (/\s/.test(char) && !inDoubleQuotes && !inSingleQuotes) {
        if (currentArg.length > 0) {
          args.push(currentArg);
          currentArg = '';
        }
        continue;
      }

      currentArg += char;
    }

    if (currentArg.length > 0) {
      args.push(currentArg);
    }

    return args;
  }

  private expandGlobs(args: string[]): string[] {
    const result: string[] = [];
    const globRegex = /[*?[\]]/;

    for (const arg of args) {
      if (!globRegex.test(arg)) {
        result.push(arg);
        continue;
      }

      // Handle path with directory components e.g. /etc/*.conf, ./*.txt, *.log
      let dirPath = '.';
      let pattern = arg;
      const lastSlash = arg.lastIndexOf('/');
      if (lastSlash !== -1) {
        dirPath = arg.substring(0, lastSlash) || '/';
        pattern = arg.substring(lastSlash + 1);
      }

      const dirNode = this.vfs.getNodeByPath(dirPath, this.env['USER'] || 'hello');
      if (!dirNode || !dirNode.children) {
        result.push(arg);
        continue;
      }

      // Convert glob pattern to regular expression
      // * -> [^/]*, ? -> [^/], [...] -> [...]
      let regexStr = '^';
      for (let i = 0; i < pattern.length; i++) {
        const c = pattern[i];
        if (c === '*') {
          regexStr += '.*';
        } else if (c === '?') {
          regexStr += '.';
        } else if (c === '[') {
          let j = i + 1;
          while (j < pattern.length && pattern[j] !== ']') j++;
          if (j < pattern.length) {
            regexStr += pattern.substring(i, j + 1);
            i = j;
          } else {
            regexStr += '\\[';
          }
        } else if (/[.+^${}()|[\]\\]/.test(c)) {
          regexStr += '\\' + c;
        } else {
          regexStr += c;
        }
      }
      regexStr += '$';

      const regex = new RegExp(regexStr);
      const matchedNames: string[] = [];

      for (const name of dirNode.children.keys()) {
        // Files starting with . are only matched if pattern starts with .
        if (name.startsWith('.') && !pattern.startsWith('.')) continue;
        if (regex.test(name)) {
          matchedNames.push(name);
        }
      }

      matchedNames.sort();

      if (matchedNames.length > 0) {
        for (const name of matchedNames) {
          if (lastSlash !== -1) {
            const prefix = dirPath === '/' ? '/' : `${dirPath}/`;
            result.push(`${prefix}${name}`);
          } else {
            result.push(name);
          }
        }
      } else {
        // POSIX default: if no match, preserve literal string
        result.push(arg);
      }
    }

    return result;
  }
}

export const globalShellEngine = new ShellEngine();
