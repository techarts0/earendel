import { globalVFS } from './vfs';

export interface McpServerConfig {
  url?: string;
  command?: string;
  args?: string[];
  description?: string;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export interface McpTool {
  serverName: string;
  name: string;
  description: string;
  inputSchema?: any;
}

export class McpClientManager {
  private config: McpConfig = { mcpServers: {} };

  public loadConfig(): McpConfig {
    try {
      const content = globalVFS.readFile('/etc/mcp.conf');
      if (content) {
        this.config = JSON.parse(content);
      }
    } catch (e) {
      console.warn('Failed to parse /etc/mcp.conf:', e);
    }
    return this.config;
  }

  public getConfig(): McpConfig {
    this.loadConfig();
    return this.config;
  }

  public async listTools(): Promise<McpTool[]> {
    this.loadConfig();
    const tools: McpTool[] = [];

    for (const [serverName, serverCfg] of Object.entries(this.config.mcpServers || {})) {
      tools.push({
        serverName,
        name: `${serverName}/tool`,
        description: serverCfg.description || `MCP Tool provided by ${serverName}`,
      });
    }
    return tools;
  }

  public async callTool(serverName: string, toolName: string, args: Record<string, any>, abortSignal?: AbortSignal): Promise<any> {
    this.loadConfig();
    const server = this.config.mcpServers?.[serverName];
    if (!server) {
      throw new Error(`MCP Server '${serverName}' is not configured in /etc/mcp.conf`);
    }

    // Perform HTTP JSON-RPC 2.0 request to the MCP Server
    if (server.url) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const abortFromCaller = () => controller.abort(abortSignal?.reason);
        if (abortSignal?.aborted) abortFromCaller();
        else abortSignal?.addEventListener('abort', abortFromCaller, { once: true });

        try {
          const response = await fetch(server.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: Math.floor(Math.random() * 100000),
              method: 'tools/call',
              params: { name: toolName, arguments: args },
            }),
          });
          if (!response.ok) {
            throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
          }
          const resJson = await response.json();
          return resJson.result || resJson;
        } finally {
          clearTimeout(timeoutId);
          abortSignal?.removeEventListener('abort', abortFromCaller);
        }
      } catch (e: any) {
        if (abortSignal?.aborted) throw e;
        throw new Error(`MCP request to '${serverName}' failed: ${e?.message || String(e)}`);
      }
    }

    return { error: `Unsupported transport for MCP Server '${serverName}'` };
  }
}

export const globalMcpClientManager = new McpClientManager();
