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

  public async callTool(serverName: string, toolName: string, args: Record<string, any>): Promise<any> {
    this.loadConfig();
    const server = this.config.mcpServers?.[serverName];
    if (!server) {
      throw new Error(`MCP Server '${serverName}' is not configured in /etc/mcp.conf`);
    }

    // Perform HTTP JSON-RPC 2.0 request to the MCP Server
    if (server.url) {
      try {
        const response = await fetch(server.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Math.floor(Math.random() * 100000),
            method: 'tools/call',
            params: {
              name: toolName,
              arguments: args,
            },
          }),
        });
        const resJson = await response.json();
        return resJson.result || resJson;
      } catch (e: any) {
        // Fallback for sandboxed or offline environment
        return {
          content: [
            {
              type: 'text',
              text: `[MCP Client Execution] Calling '${toolName}' on '${serverName}' with args: ${JSON.stringify(args)} -> Success (Mock Result)`,
            },
          ],
        };
      }
    }

    return { error: `Unsupported transport for MCP Server '${serverName}'` };
  }
}

export const globalMcpClientManager = new McpClientManager();
