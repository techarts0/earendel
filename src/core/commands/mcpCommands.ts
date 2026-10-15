import { Command, ExecutionContext, ExecutionResult } from '../types';
import { globalMcpClientManager } from '../mcpClient';
import { globalCapabilityManager } from '../../kernel/capability';
import { globalTaskScheduler } from '../../kernel/taskScheduler';

export const mcpCommand: Command = {
  name: 'mcp',
  description: 'Model Context Protocol (MCP) Client CLI for discovering and invoking external MCP tools',
  category: 'sys',
  execute: async (ctx: ExecutionContext): Promise<ExecutionResult> => {
    const callerPid = ctx.callerPid;
    const caller = callerPid === undefined ? null : globalTaskScheduler.getProcess(callerPid);
    if (!caller || caller.state !== 'RUNNING') {
      return { stdout: '', stderr: 'mcp: active process identity is required\n', exitCode: 1 };
    }
    const subCmd = ctx.args[0] || 'list';

    if (subCmd === 'list') {
      const tools = await globalMcpClientManager.listTools();
      const config = globalMcpClientManager.getConfig();
      const servers = Object.entries(config.mcpServers || {}).filter(([, cfg]) =>
        !!cfg.url && globalCapabilityManager.hasCapability(callerPid!, 'CAP_NET_ADMIN', cfg.url),
      );
      
      let out = `\x1b[36m[Earendel MCP Client Manager]\x1b[0m Authorized MCP Servers:\n\n`;
      if (servers.length === 0) {
        out += `No MCP servers are authorized for this process (CAP_NET_ADMIN required).\n`;
      } else {
        const authorizedNames = new Set(servers.map(([name]) => name));
        for (const [name, cfg] of servers) {
          out += ` \x1b[33m• ${name}\x1b[0m (${cfg.description || 'No description'})\n`;
        }
        out += `\nDiscovered Tools:\n`;
        for (const tool of tools.filter((entry) => authorizedNames.has(entry.serverName))) {
          out += `   - \x1b[32m${tool.serverName}\x1b[0m: ${tool.name} (${tool.description})\n`;
        }
      }
      return { stdout: out, stderr: '', exitCode: 0 };
    }

    if (subCmd === 'call') {
      const serverName = ctx.args[1];
      const toolName = ctx.args[2];
      const jsonArgsStr = ctx.args.slice(3).join(' ') || '{}';

      if (!serverName || !toolName) {
        return { stdout: '', stderr: 'Usage: mcp call <serverName> <toolName> [json_args]\n', exitCode: 1 };
      }

      try {
        const parsedArgs = JSON.parse(jsonArgsStr);
        const res = await globalMcpClientManager.callTool(serverName, toolName, parsedArgs, ctx.abortSignal, callerPid!);
        return { stdout: JSON.stringify(res, null, 2) + '\n', stderr: '', exitCode: 0 };
      } catch (e: any) {
        return { stdout: '', stderr: `mcp: Call failed: ${e.message}\n`, exitCode: 1 };
      }
    }

    return { stdout: '', stderr: `mcp: Unknown subcommand '${subCmd}'. Usage: mcp [list|call]\n`, exitCode: 1 };
  },
};
