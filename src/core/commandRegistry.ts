// Earendel Plugin-based Command Registry Engine
import { Command, ExecutionContext, ExecutionResult } from './types';

export class CommandRegistry {
  private commands: Map<string, Command> = new Map();

  constructor() {}

  // Authentic GNU Bash / POSIX Shell Built-in Primitive Commands
  private builtinNames = new Set([
    'cd',
    'pwd',
    'export',
    'unset',
    'alias',
    'unalias',
    'help',
    'history',
    'exit',
    'clear',
    'theme',
    'whoami',
    'who',
  ]);

  public isShellBuiltin(name: string): boolean {
    return this.builtinNames.has(name);
  }

  // Register a new Linux command plugin or executable binary
  public syncAllSymbolsToVFS(targetVFS?: any): void {
    const vfs = targetVFS || (typeof window !== 'undefined' && (window as any).globalVFS ? (window as any).globalVFS : null);
    if (!vfs) return;

    // Ensure /usr/bin directory exists
    if (!vfs.getNodeByPath('/usr/bin')) {
      vfs.mkdir('/usr/bin', true);
    }

    this.commands.forEach((cmd) => {
      // Linux Rule: Shell Built-ins do NOT have binary files under /usr/bin/
      if (this.isShellBuiltin(cmd.name)) return;

      const symPath = `/usr/bin/${cmd.name}`;
      vfs.writeFile(symPath, `#!/usr/bin/env node\n# Executable Binary Symbol for ${cmd.name}\n`);
      vfs.chmod(symPath, 'rwxr-xr-x');
    });

    if (typeof vfs.notify === 'function') {
      vfs.notify();
    }
  }

  public register(cmd: Command): void {
    this.commands.set(cmd.name, cmd);
    if (cmd.aliases) {
      cmd.aliases.forEach((alias) => this.commands.set(alias, cmd));
    }
    this.syncAllSymbolsToVFS();
  }

  public unregister(name: string): boolean {
    const cmd = this.commands.get(name);
    if (!cmd) return false;
    this.commands.delete(name);
    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        this.commands.delete(alias);
      }
    }
    return true;
  }

  public getCommand(name: string): Command | undefined {
    return this.commands.get(name);
  }

  public getAllCommands(): Command[] {
    const uniqueCmds = new Set<Command>(this.commands.values());
    return Array.from(uniqueCmds);
  }

  public async execute(name: string, ctx: ExecutionContext): Promise<ExecutionResult> {
    const cmd = this.commands.get(name);
    if (!cmd) {
      const isZh = ctx.lang === 'zh';
      return {
        stdout: '',
        stderr: `bash: ${name}: ${isZh ? '未找到命令。输入 \'help\' 查看帮助。' : 'command not found. Type \'help\' for available commands.'}\n`,
        exitCode: 127,
      };
    }

    // Authentic Linux Executable Binary Mode: Verify physical binary existence & permissions under /usr/bin/
    if (!this.isShellBuiltin(cmd.name) && ctx.vfs) {
      const symPath = `/usr/bin/${cmd.name}`;
      const node = ctx.vfs.getNodeByPath(symPath);
      if (!node) {
        return {
          stdout: '',
          stderr: `bash: ${name}: No such file or directory\n`,
          exitCode: 127,
        };
      }
      if (!node.permissions.includes('x')) {
        return {
          stdout: '',
          stderr: `bash: ${symPath}: Permission denied\n`,
          exitCode: 126,
        };
      }
    }

    return await cmd.execute(ctx);
  }
}

export const globalCommandRegistry = new CommandRegistry();
