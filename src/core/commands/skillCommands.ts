import { Command, ExecutionContext, ExecutionResult } from '../types';
import { globalHarnessEngine } from '../harnessEngine';
import { resolveSkillTarget } from '../skillParser';

export const skillCommand: Command = {
  name: 'skill',
  description: 'Execute an Agentic Skill (single .md or directory package with skill.md)',
  category: 'sys',
  execute: async (ctx: ExecutionContext): Promise<ExecutionResult> => {
    if (ctx.args.length === 0) {
      return {
        stdout: '',
        stderr: 'Usage: skill [tui|dag] <path/to/skill.md | path/to/skill_dir> [--arg=val ...]\n',
        exitCode: 1,
      };
    }

    let targetPath = ctx.args[0];
    let isTui = false;
    let isDag = false;
    let remainingArgs = ctx.args.slice(1);

    if (targetPath === 'tui') {
      isTui = true;
      targetPath = ctx.args[1];
      remainingArgs = ctx.args.slice(2);
      if (!targetPath) {
        return {
          stdout: '',
          stderr: 'Usage: skill tui <path/to/skill.md | path/to/skill_dir>\n',
          exitCode: 1,
        };
      }
    } else if (targetPath === 'dag') {
      isDag = true;
      targetPath = ctx.args[1] || '/skills/git-commit-helper';
      remainingArgs = ctx.args.slice(2);
    }

    let resolvedPath = targetPath;
    let content = '';
    const user = ctx.env['USER'] || 'hello';

    try {
      const resolved = resolveSkillTarget(ctx.vfs, targetPath, user);
      resolvedPath = resolved.path;
      content = resolved.content;
    } catch (err: any) {
      return {
        stdout: '',
        stderr: `skill: ${err.message}\n`,
        exitCode: 1,
      };
    }

    if (isTui) {
      return {
        stdout: `\x1b[36m[HarnessEngine]\x1b[0m Launching Harness TUI Cockpit Window for ${resolvedPath}...\n`,
        stderr: '',
        exitCode: 0,
        openHarnessTui: { path: resolvedPath, content },
      };
    }

    if (isDag) {
      return {
        stdout: `\x1b[36m[HarnessEngine]\x1b[0m Opening Visual DAG Flow Canvas for ${resolvedPath}...\n`,
        stderr: '',
        exitCode: 0,
        openHarnessDag: { path: resolvedPath },
      };
    }

    // Execute skill via Harness Engine (0-token static validation + OS sandbox + FSM loop)
    const customExecCtx = { ...ctx, args: remainingArgs };
    return await globalHarnessEngine.executeSkill(content, customExecCtx);
  },
};
