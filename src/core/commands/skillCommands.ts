import { Command, ExecutionContext, ExecutionResult } from '../types';
import { globalHarnessEngine } from '../harnessEngine';
import { resolveSkillTarget, SkillPermissionGrant } from '../skillParser';

function parsePermissionGrants(args: string[]): { args: string[]; grant: SkillPermissionGrant; error?: string } {
  const remaining: string[] = [];
  const grant: SkillPermissionGrant = { vfs_read: [], vfs_write: [], system_tools: [], mcp_tools: [] };
  for (const arg of args) {
    const valueOption = [
      ['--grant-read=', grant.vfs_read!],
      ['--grant-write=', grant.vfs_write!],
      ['--grant-tool=', grant.system_tools!],
      ['--grant-mcp=', grant.mcp_tools!],
    ] as const;
    const matched = valueOption.find(([prefix]) => arg.startsWith(prefix));
    if (matched) {
      const value = arg.slice(matched[0].length).trim();
      if (!value) return { args: remaining, grant, error: `skill: ${matched[0].slice(0, -1)} requires a non-empty value.\n` };
      matched[1].push(value);
    } else if (arg === '--grant-network') {
      grant.network = true;
    } else if (arg === '--grant-memory') {
      grant.memory = true;
    } else if (arg.startsWith('--grant-')) {
      return { args: remaining, grant, error: `skill: unknown permission option '${arg}'.\n` };
    } else {
      remaining.push(arg);
    }
  }
  return { args: remaining, grant };
}

export const skillCommand: Command = {
  name: 'skill',
  description: 'Execute an Agentic Skill (single .md or directory package with skill.md)',
  category: 'sys',
  execute: async (ctx: ExecutionContext): Promise<ExecutionResult> => {
    if (ctx.args.length === 0) {
      return {
        stdout: '',
        stderr: 'Usage: skill [tui|dag] <path/to/skill.md | path/to/skill_dir> [--grant-read=PATH] [--grant-write=PATH] [--grant-tool=NAME] [--grant-mcp=SERVER/TOOL] [--grant-network] [--grant-memory] [--arg=val ...]\n',
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
          stderr: 'Usage: skill tui <path/to/skill.md | path/to/skill_dir> [permission grant flags]\n',
          exitCode: 1,
        };
      }
    } else if (targetPath === 'dag') {
      isDag = true;
      const requestedPath = ctx.args[1];
      targetPath = requestedPath && !requestedPath.startsWith('--grant-') ? requestedPath : '/skills/git-commit-helper';
      remainingArgs = requestedPath && !requestedPath.startsWith('--grant-') ? ctx.args.slice(2) : ctx.args.slice(1);
    }

    const parsedGrants = parsePermissionGrants(remainingArgs);
    if (parsedGrants.error) return { stdout: '', stderr: parsedGrants.error, exitCode: 2 };
    remainingArgs = parsedGrants.args;

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
        openHarnessTui: { path: resolvedPath, content, permissionGrant: parsedGrants.grant },
      };
    }

    if (isDag) {
      return {
        stdout: `\x1b[36m[HarnessEngine]\x1b[0m Opening Visual DAG Flow Canvas for ${resolvedPath}...\n`,
        stderr: '',
        exitCode: 0,
        openHarnessDag: { path: resolvedPath, permissionGrant: parsedGrants.grant },
      };
    }

    // Execute skill via Harness Engine (0-token static validation + OS sandbox + FSM loop)
    const customExecCtx = { ...ctx, args: remainingArgs };
    return await globalHarnessEngine.executeSkill(content, customExecCtx, undefined, undefined, parsedGrants.grant);
  },
};
