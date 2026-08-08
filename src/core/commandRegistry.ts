// Earendel Plugin-based Command Registry Engine
import { Command, ExecutionContext, ExecutionResult } from './types';

export class CommandRegistry {
  private commands: Map<string, Command> = new Map();

  constructor() {}

  // Register a new Linux command plugin
  public register(cmd: Command): void {
    this.commands.set(cmd.name, cmd);
    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        this.commands.set(alias, cmd);
      }
    }
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

    return await cmd.execute(ctx);
  }
}

export const globalCommandRegistry = new CommandRegistry();
