import { Command, ExecutionContext, ExecutionResult } from '../types';
import { globalHarnessEngine } from '../harnessEngine';

export const skillCommand: Command = {
  name: 'skill',
  description: 'Execute a Harness-Skill (.md) file via /dev/skill FSM',
  category: 'sys',
  execute: async (ctx: ExecutionContext): Promise<ExecutionResult> => {
    if (ctx.args.length === 0) {
      return { stdout: '', stderr: 'Usage: skill <file.md>\n', exitCode: 1 };
    }

    let filePath = ctx.args[0];
    let isTui = false;
    let isDag = false;

    if (filePath === 'tui') {
      isTui = true;
      filePath = ctx.args[1];
      if (!filePath) {
        return { stdout: '', stderr: 'Usage: skill tui <file.md>\n', exitCode: 1 };
      }
    } else if (filePath === 'dag') {
      isDag = true;
      filePath = ctx.args[1] || '/skills/demo.md';
    }

    const node = ctx.vfs.getNodeByPath(filePath);

    if (!node || node.type !== 'file') {
      return { stdout: '', stderr: `skill: ${filePath}: No such file\n`, exitCode: 1 };
    }

    const content = ctx.vfs.readFile(filePath, ctx.env['USER'] || 'hello') ?? '';

    if (isTui) {
      return {
        stdout: `\x1b[36m[HarnessEngine]\x1b[0m Launching Harness TUI Cockpit Window for ${filePath}...\n`,
        stderr: '',
        exitCode: 0,
        openHarnessTui: { path: filePath, content },
      };
    }

    if (isDag) {
      return {
        stdout: `\x1b[36m[HarnessEngine]\x1b[0m Opening Visual DAG Flow Canvas for ${filePath}...\n`,
        stderr: '',
        exitCode: 0,
        openHarnessDag: { path: filePath },
      };
    }
    
    // Pass everything to the harness engine, which will do the 0-token verification.
    return await globalHarnessEngine.executeSkill(content, ctx);
  },
};
