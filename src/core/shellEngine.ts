// Earendel Behavioral Shell Engine powered by CommandRegistry & VFS
import { globalVFS } from './vfs';
import { globalProcessManager } from './processManager';
import { globalCommandRegistry } from './commandRegistry';
import { ExecutionContext, ExecutionResult } from './types';
import { Language } from '../i18n/translations';
import './commands'; // Ensure all command plugins are auto-registered

export class ShellEngine {
  private env: Record<string, string> = {
    USER: 'hello',
    HOME: '/home/hello',
    SHELL: '/bin/bash',
    TERM: 'xterm-256color',
    PATH: '/bin:/usr/bin',
  };

  private history: string[] = [];
  private aliases: Map<string, string> = new Map();
  public lang: Language = 'en';

  private lastExitCode: number = 0;

  constructor() {
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

  async execute(commandLine: string, scriptArgs: string[] = []): Promise<ExecutionResult> {
    const trimmed = commandLine.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return { stdout: '', stderr: '', exitCode: 0 };
    }

    const aliased = this.expandAlias(trimmed);
    this.history.push(aliased);
    const expanded = this.expandVariables(aliased, scriptArgs);

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
          lastRes = await this.executeSingleCommand(token, '');
          stdoutAcc += lastRes.stdout;
          if (lastRes.stderr) stderrAcc += lastRes.stderr;
        } else if (currentOp === 'AND') {
          if (lastRes.exitCode === 0) {
            lastRes = await this.executeSingleCommand(token, '');
            stdoutAcc += lastRes.stdout;
            if (lastRes.stderr) stderrAcc += lastRes.stderr;
          }
        } else if (currentOp === 'OR') {
          if (lastRes.exitCode !== 0) {
            lastRes = await this.executeSingleCommand(token, '');
            stdoutAcc += lastRes.stdout;
            if (lastRes.stderr) stderrAcc += lastRes.stderr;
          }
        }
      }

      this.env['?'] = lastRes.exitCode.toString();
      return { stdout: stdoutAcc, stderr: stderrAcc, exitCode: lastRes.exitCode };
    }

    // Pipe | handling
    if (expanded.includes('|')) {
      const pipelineCmds = expanded.split('|').map((c) => c.trim());
      let inputData = '';
      let lastResult: ExecutionResult = { stdout: '', stderr: '', exitCode: 0 };

      for (const cmdStr of pipelineCmds) {
        lastResult = await this.executeSingleCommand(cmdStr, inputData);
        if (lastResult.exitCode !== 0) break;
        inputData = lastResult.stdout;
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

    // Check if in active P2P Mesh Subshell session
    const { globalP2PMeshEngine } = await import('./p2pMeshEngine');
    const joinedPeerId = globalP2PMeshEngine.getActiveJoinedPeerId();

    if (joinedPeerId) {
      const isDisconnectCmd =
        rawCmd === 'exit' ||
        rawCmd === 'mesh stop' ||
        rawCmd === 'mesh disconnect' ||
        rawCmd === 'mesh unshare' ||
        rawCmd.startsWith('mesh status');

      if (!isDisconnectCmd) {
        return await globalP2PMeshEngine.executeOnHost(joinedPeerId, rawCmd);
      }
    }
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

    // Support VAR=value assignment syntax
    if (args.length === 1 && /^[A-Za-z_][A-Za-z0-9_]*=.*$/.test(args[0])) {
      const eqIdx = args[0].indexOf('=');
      const key = args[0].substring(0, eqIdx);
      const val = args[0].substring(eqIdx + 1).replace(/^["']|["']$/g, '');
      this.setEnv(key, val);
      return { stdout: '', stderr: '', exitCode: 0 };
    }

    const cmdName = args[0];
    const cmdArgs = args.slice(1);

    let res: ExecutionResult = { stdout: '', stderr: '', exitCode: 0 };

    // Native script / binary executable path execution
    if (cmdName.startsWith('./') || cmdName.startsWith('/') || cmdName.endsWith('.sh')) {
      const scriptPath = cmdName;
      const node = globalVFS.getNodeByPath(scriptPath);

      if (!node) {
        res = { stdout: '', stderr: `-bash: ${cmdName}: No such file or directory\n`, exitCode: 127 };
      } else if (!globalVFS.isExecutable(scriptPath)) {
        res = { stdout: '', stderr: `-bash: ${cmdName}: Permission denied\n`, exitCode: 126 };
      } else {
        const scriptContent = globalVFS.readFile(scriptPath) ?? '';
        res = await this.executeControlFlow(scriptContent, [scriptPath, ...cmdArgs]);
      }
    } else {
      const ctx: ExecutionContext = {
        vfs: globalVFS,
        env: this.env,
        lang: this.lang,
        args: cmdArgs,
        pipeInput,
        processManager: globalProcessManager,
      };
      globalCommandRegistry.syncAllSymbolsToVFS(globalVFS);
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
