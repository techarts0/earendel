import { globalVFS, VirtualFileSystem } from './vfs';
import { globalProcessManager, ProcessManager } from './processManager';
import { globalCommandRegistry } from './commandRegistry';
import { ExecutionContext, ExecutionResult } from './types';
import { Language } from '../i18n/translations';
import { syscall } from '../kernel/syscall';
import { SyscallNo } from '../kernel/types';
import './commands'; // Ensure all command plugins are auto-registered

export class ShellEngine {
  public vfs: VirtualFileSystem;
  public processManager: ProcessManager;

  private env: Record<string, string> = {
    USER: 'hello',
    HOME: '/home/hello',
    PWD: '/home/hello',
    SHELL: '/bin/bash',
    TERM: 'xterm-256color',
    PATH: '/bin:/usr/bin',
  };

  private history: string[] = [];
  private aliases: Map<string, string> = new Map();
  public lang: Language = 'en';

  private lastExitCode: number = 0;

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

  getEnv(key: string): string {
    return this.env[key] || '';
  }

  setEnv(key: string, val: string): void {
    this.env[key] = val;
  }

  getHistory(): string[] {
    return this.history;
  }

  private expandVariables(text: string, scriptArgs: string[] = []): string {
    return text.replace(/\$(\w+|\d+|\?)/g, (match, varName) => {
      if (varName === '?') return this.env['?'] || '0';
      if (/^\d+$/.test(varName)) {
        const index = parseInt(varName, 10);
        return scriptArgs[index] || '';
      }
      return this.env[varName] !== undefined ? this.env[varName] : match;
    });
  }

  private async expandCommandSubstitutions(text: string, scriptArgs: string[] = []): Promise<string> {
    let result = text;

    // 1. Process $(command)
    let dollarMatch = result.match(/\$\(([^)]+)\)/);
    while (dollarMatch) {
      const subCmd = dollarMatch[1];
      const res = await this.execute(subCmd, scriptArgs);
      const replacement = (res.stdout || '').replace(/\r?\n$/, '');
      result = result.replace(dollarMatch[0], replacement);
      dollarMatch = result.match(/\$\(([^)]+)\)/);
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

    return result;
  }

  async execute(commandLine: string, scriptArgs: string[] = []): Promise<ExecutionResult> {
    const trimmed = commandLine.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return { stdout: '', stderr: '', exitCode: 0 };
    }

    const aliased = this.expandAlias(trimmed);
    this.history.push(aliased);
    const substituted = await this.expandCommandSubstitutions(aliased, scriptArgs);
    const expanded = this.expandVariables(substituted, scriptArgs);

    if (this.isShellControlFlow(expanded)) {
      const res = await this.executeControlFlow(expanded, scriptArgs);
      this.lastExitCode = res.exitCode;
      this.env['?'] = res.exitCode.toString();
      return res;
    }

    // Logical Operators && and || handling
    if (expanded.includes('&&') || expanded.includes('||')) {
      const tokens = expanded.split(/(&&|\|\|)/).map((t) => t.trim()).filter(Boolean);
      let stdoutAcc = '';
      let stderrAcc = '';
      let currentOp: 'INIT' | 'AND' | 'OR' = 'INIT';
      let lastRes: ExecutionResult = { stdout: '', stderr: '', exitCode: 0 };

      for (const token of tokens) {
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
    if (/(?<!\|)\|(?!\|)/.test(expanded)) {
      const pipelineCmds = expanded.split(/(?<!\|)\|(?!\|)/).map((c) => c.trim());
      let currentStream: AsyncIterable<string> | null = null;
      let inputData = '';
      let lastResult: ExecutionResult = { stdout: '', stderr: '', exitCode: 0 };

      for (let i = 0; i < pipelineCmds.length; i++) {
        const cmdStr = pipelineCmds[i];
        const parts = cmdStr.split(/\s+/).filter(Boolean);
        const cmdName = parts[0];
        const cmdObj = globalCommandRegistry.getCommand(cmdName);

        if (cmdObj && cmdObj.executeStream) {
          const cmdArgs = parts.slice(1);
          const ctx: ExecutionContext = {
            vfs: this.vfs,
            env: this.env,
            lang: this.lang,
            args: cmdArgs,
            pipeInput: inputData,
            processManager: this.processManager,
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
          if (lastResult.exitCode !== 0) break;
          inputData = lastResult.stdout;
        }
      }

      if (currentStream) {
        let finalOutput = '';
        for await (const chunk of currentStream) {
          finalOutput += chunk;
        }
        lastResult = { stdout: finalOutput, stderr: '', exitCode: 0 };
      }

      this.env['?'] = lastResult.exitCode.toString();
      return lastResult;
    }

    const res = await this.executeSingleCommand(expanded, '');
    this.env['?'] = res.exitCode.toString();
    return res;
  }

  private isShellControlFlow(cmdStr: string): boolean {
    return (
      cmdStr.startsWith('for ') ||
      cmdStr.startsWith('while ') ||
      cmdStr.startsWith('if ') ||
      cmdStr.includes('\n')
    );
  }

  private async executeControlFlow(scriptText: string, scriptArgs: string[] = []): Promise<ExecutionResult> {
    let stdoutAcc = '';
    let stderrAcc = '';

    const lines = scriptText.split(/\n|;/).map((l) => l.trim()).filter(Boolean);

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      if (line.startsWith('for ')) {
        const match = line.match(/^for\s+(\w+)\s+in\s+(.+)$/);
        if (match) {
          const varName = match[1];
          const rawItems = match[2].replace('; do', '').trim().split(/\s+/);

          const bodyLines: string[] = [];
          i++;
          while (i < lines.length && lines[i] !== 'done') {
            if (lines[i] !== 'do') {
              bodyLines.push(lines[i]);
            }
            i++;
          }

          for (const item of rawItems) {
            this.setEnv(varName, item);
            for (const bodyCmd of bodyLines) {
              const res = await this.execute(bodyCmd, scriptArgs);
              stdoutAcc += res.stdout;
              if (res.stderr) stderrAcc += res.stderr;
            }
          }
        }
      } else if (line.startsWith('if ')) {
        const condition = line.replace('if ', '').replace('; then', '').trim();
        const isTrue = this.evaluateCondition(condition);

        const thenLines: string[] = [];
        const elseLines: string[] = [];
        let inElse = false;
        i++;

        while (i < lines.length && lines[i] !== 'fi') {
          if (lines[i] === 'then') {
            i++;
            continue;
          }
          if (lines[i] === 'else') {
            inElse = true;
            i++;
            continue;
          }
          if (inElse) {
            elseLines.push(lines[i]);
          } else {
            thenLines.push(lines[i]);
          }
          i++;
        }

        const targetLines = isTrue ? thenLines : elseLines;
        for (const targetCmd of targetLines) {
          const res = await this.execute(targetCmd, scriptArgs);
          stdoutAcc += res.stdout;
          if (res.stderr) stderrAcc += res.stderr;
        }
      } else {
        const res = await this.executeSingleCommand(line, '');
        stdoutAcc += res.stdout;
        if (res.stderr) stderrAcc += res.stderr;
      }
      i++;
    }

    return { stdout: stdoutAcc, stderr: stderrAcc, exitCode: 0 };
  }

  private evaluateCondition(condition: string): boolean {
    const clean = condition.replace(/^\[\s*/, '').replace(/\s*\]$/, '').trim();
    if (!clean) return false;

    if (clean.startsWith('-f ')) {
      const file = clean.replace('-f ', '').trim();
      const node = globalVFS.getNodeByPath(file);
      return node !== null && node.type === 'file';
    }
    if (clean.startsWith('-d ')) {
      const dir = clean.replace('-d ', '').trim();
      const node = globalVFS.getNodeByPath(dir);
      return node !== null && node.type === 'directory';
    }

    if (clean.includes('=')) {
      const parts = clean.split('=').map((s) => s.trim().replace(/^["']|["']$/g, ''));
      return parts[0] === parts[1];
    }

    return true;
  }

  private async executeSingleCommand(cmdStr: string, pipeInput: string = ''): Promise<ExecutionResult> {
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
      const job = globalProcessManager.addJob(rawCmd);
      return {
        stdout: `[${job.jobId}] ${job.pid}\n`,
        stderr: '',
        exitCode: 0,
      };
    }

    const args = this.parseArgs(rawCmd);
    if (args.length === 0) return { stdout: '', stderr: '', exitCode: 0 };

    // Support inline VAR=value assignment syntax & childEnv isolation
    const childEnv = { ...this.env };
    let cmdIdx = 0;
    while (cmdIdx < args.length && /^[A-Za-z_][A-Za-z0-9_]*=.*$/.test(args[cmdIdx])) {
      const eqIdx = args[cmdIdx].indexOf('=');
      const key = args[cmdIdx].substring(0, eqIdx);
      const val = args[cmdIdx].substring(eqIdx + 1).replace(/^["']|["']$/g, '');
      if (args.length === 1) {
        this.setEnv(key, val);
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      childEnv[key] = val;
      cmdIdx++;
    }

    if (cmdIdx >= args.length) return { stdout: '', stderr: '', exitCode: 0 };

    const cmdName = args[cmdIdx];
    const cmdArgs = args.slice(cmdIdx + 1);

    let res: ExecutionResult = { stdout: '', stderr: '', exitCode: 0 };

    // Intercept /dev device pipeline commands
    if (cmdName === '/dev/ai' || cmdName === 'ai') {
      const prompt = pipeInput || cmdArgs.join(' ') || 'Status check';
      const { globalIPCBus } = await import('../kernel/ipcBus');
      const aiRes = await globalIPCBus.sendIPC(24, 'driverd', 'DEV_WRITE_AI', { prompt });
      return { stdout: (aiRes.response || aiRes.data || '') + '\n', stderr: '', exitCode: 0 };
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
      const scriptPath = cmdName;
      const node = globalVFS.getNodeByPath(scriptPath);

      if (!node) {
        res = { stdout: '', stderr: `-bash: ${cmdName}: No such file or directory\n`, exitCode: 127 };
      } else if (!globalVFS.isExecutable(scriptPath)) {
        res = { stdout: '', stderr: `-bash: ${cmdName}: Permission denied\n`, exitCode: 126 };
      } else {
        // POSIX Process Lifecycle: SYS_FORK -> SYS_EXECVE -> SYS_WAITPID
        const forkRes = await syscall(SyscallNo.SYS_FORK, scriptPath, globalVFS.getPwd());
        const childPid = forkRes.data || 401;
        await syscall(SyscallNo.SYS_EXECVE, scriptPath, cmdArgs);

        const content = globalVFS.readFile(scriptPath, this.env['USER'] || 'hello') ?? '';

        // Check for EAF Magic Header (EAF01 or EAF\x01)
        const isEaf = scriptPath.endsWith('.eaf') || (content.includes('"magic"') && content.includes('EAF'));
        const isSkill = content.startsWith('#!/dev/skill') || content.includes('<!-- earendel-skill -->');

        if (isSkill) {
          const { globalHarnessEngine } = await import('./harnessEngine');
          const ctx: ExecutionContext = {
            vfs: globalVFS,
            env: childEnv,
            lang: this.lang,
            args: cmdArgs,
            pipeInput,
            processManager: globalProcessManager,
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
                vfs: globalVFS,
                env: childEnv,
                lang: this.lang,
                args: cmdArgs,
                pipeInput,
                processManager: globalProcessManager,
              };
              res = await globalWasmEngine.executeWasm(wasmBytes, ctx);
            } else {
              const { globalJsEngine } = await import('./jsRuntime');
              const ctx: ExecutionContext = {
                vfs: globalVFS,
                env: childEnv,
                lang: this.lang,
                args: [scriptPath, ...cmdArgs],
                pipeInput,
                processManager: globalProcessManager,
              };
              res = await globalJsEngine.executeJsBundle(textSection, ctx);
            }
          } catch (e: any) {
            res = { stdout: '', stderr: `execve: Exec format error: ${e.message}\n`, exitCode: 126 };
          }
        } else {
          res = await this.executeControlFlow(content, [scriptPath, ...cmdArgs]);
        }

        await syscall(SyscallNo.SYS_WAITPID, childPid);
      }
    } else {
      const isBuiltin = ['cd', 'export', 'unset', 'alias', 'unalias', 'exit', 'su', 'source', '.'].includes(cmdName);
      const ctx: ExecutionContext = {
        vfs: globalVFS,
        env: isBuiltin ? this.env : childEnv,
        lang: this.lang,
        args: cmdArgs,
        pipeInput,
        processManager: globalProcessManager,
      };
      res = await globalCommandRegistry.execute(cmdName, ctx);
    }

    if (redirectTarget && res.exitCode === 0) {
      let existing = appendMode ? (globalVFS.readFile(redirectTarget) ?? '') : '';
      const newContent = existing + res.stdout;
      globalVFS.writeFile(redirectTarget, newContent);
      res.stdout = '';
    }

    return res;
  }

  private parseArgs(cmdStr: string): string[] {
    const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|([^\s"']+)/g;
    const args: string[] = [];
    let match;
    while ((match = regex.exec(cmdStr)) !== null) {
      args.push(match[1] || match[2] || match[3]);
    }
    return args;
  }
}

export const globalShellEngine = new ShellEngine();
