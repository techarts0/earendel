import { ExecutionContext, ExecutionResult } from './types';
import { globalIPCBus } from '../kernel/ipcBus';
import { IPCMessage } from '../kernel/types';
import { globalShellEngine } from './shellEngine';
import { globalMcpClientManager } from './mcpClient';

export enum HarnessState {
  IDLE = 'IDLE',
  PARSE = 'PARSE',
  INFER = 'INFER',
  ACT = 'ACT',
  REFLEXION = 'REFLEXION',
  ERROR = 'ERROR',
  SUCCESS = 'SUCCESS',
}

interface FsmContext {
  retries: number;
  maxRetries: number;
  conversationHistory: string[];
  stdoutAcc: string;
  originalSkillContent: string;
  lastErrorOutput: string;
  onProgress?: (state: HarnessState, message: string) => void;
}

export class HarnessEngine {
  constructor() {
    globalIPCBus.registerService('harnessd', 7, async (msg: IPCMessage) => {
      if (msg.action === 'DEV_WRITE_SKILL') {
        // Triggered by VFS pipe
        return { response: `[HarnessEngine] Woke up from /dev/skill stream.\n` };
      }
      return { error: 'Unknown action' };
    });
  }

  private appendLog(ctx: FsmContext, state: HarnessState, message: string, colorCode: string = '36') {
    const logText = `\x1b[${colorCode}m[HarnessEngine: ${state}]\x1b[0m ${message}\n`;
    ctx.stdoutAcc += logText;
    if (ctx.onProgress) {
      try {
        ctx.onProgress(state, message);
      } catch (e) {}
    }
  }

  async executeSkill(
    content: string,
    execCtx: ExecutionContext,
    onProgress?: (state: HarnessState, message: string) => void
  ): Promise<ExecutionResult> {
    const ctx: FsmContext = {
      retries: 0,
      maxRetries: 3,
      conversationHistory: [],
      stdoutAcc: '',
      originalSkillContent: content,
      lastErrorOutput: '',
      onProgress,
    };

    let currentState: HarnessState = HarnessState.PARSE;

    while (currentState !== HarnessState.SUCCESS && currentState !== HarnessState.ERROR) {
      switch (currentState) {
        case HarnessState.PARSE: {
          this.appendLog(ctx, currentState, 'Parsing skill shebang & frontmatter...');
          const trimmed = content.trim();
          const hasShebang = trimmed.startsWith('#!/dev/skill') || trimmed.startsWith('#!/usr/bin/env skill') || trimmed.includes('<!-- earendel-skill -->');
          
          if (!hasShebang) {
            this.appendLog(ctx, HarnessState.ERROR, 'Not a valid skill file. Missing #!/dev/skill shebang.', '31');
            ctx.lastErrorOutput = 'Missing Shebang (#!/dev/skill)';
            currentState = HarnessState.ERROR;
          } else {
            // Strip Shebang line
            let strippedContent = trimmed;
            if (strippedContent.startsWith('#!')) {
              strippedContent = strippedContent.substring(strippedContent.indexOf('\n') + 1).trim();
            }
            
            // Strip HTML comments if present
            strippedContent = strippedContent.replace(/<!--[\s\S]*?-->/g, '').trim();

            ctx.originalSkillContent = strippedContent;
            
            // Collect available commands in VFS /bin and /usr/bin for dynamic context
            let availableTools = 'ls, cat, grep, find, echo, mkdir, rm, cp, mv, python, node, ecc, sys_infer';
            try {
              const binNode = execCtx.vfs.getNodeByPath('/bin');
              if (binNode && binNode.children) {
                availableTools = Array.from(binNode.children.keys()).join(', ');
              }
            } catch (e) {}

            // Discover configured MCP tools
            let mcpToolsDesc = '';
            try {
              const mcpTools = await globalMcpClientManager.listTools();
              mcpToolsDesc = mcpTools.map((t) => `${t.serverName} (${t.description})`).join(', ');
            } catch (e) {}

            // Initial AI prompt framing
            const sysPrompt = `You are the Earendel OS Harness-Skill engine. Execute the user's task by outputting executable bash commands inside \`\`\`bash ... \`\`\` blocks, or MCP tool invocations inside \`\`\`json ... \`\`\` blocks.
Available System Tools: [${availableTools}].
Available External MCP Tools: [${mcpToolsDesc || 'none'}].
To call an MCP tool, use:
\`\`\`json
{ "mcp": "serverName/toolName", "args": { ... } }
\`\`\`
Important: Output valid bash lines or JSON MCP tool calls. Keep instructions minimal.`;

            ctx.conversationHistory.push(`${sysPrompt}\n\nUser Skill Task:\n${ctx.originalSkillContent}`);
            currentState = HarnessState.INFER;
          }
          break;
        }

        case HarnessState.INFER: {
          this.appendLog(ctx, currentState, `Invoking AI model (Attempt ${ctx.retries + 1}/${ctx.maxRetries + 1})...`, '33');
          
          try {
            const promptContext = ctx.conversationHistory.join('\n\n');
            const res = await globalIPCBus.sendIPC(4, 'driverd', 'DEV_WRITE_AI', { prompt: promptContext });
            const aiResponse = res.response || res.data || '';
            
            ctx.conversationHistory.push(`AI Response:\n${aiResponse}`);
            currentState = HarnessState.ACT;
          } catch (e: any) {
            this.appendLog(ctx, HarnessState.ERROR, `Failed to communicate with /dev/ai: ${e.message}`, '31');
            ctx.lastErrorOutput = e.message;
            currentState = HarnessState.ERROR;
          }
          break;
        }

        case HarnessState.ACT: {
          this.appendLog(ctx, currentState, 'Extracting and executing commands / MCP tools...', '32');
          
          const lastResponse = ctx.conversationHistory[ctx.conversationHistory.length - 1];
          
          // Match bash or json blocks
          const regex = /```(?:bash|sh|shell|json)?\r?\n([\s\S]*?)```/gi;
          let match;
          const blocks: { type: 'bash' | 'json'; code: string }[] = [];
          while ((match = regex.exec(lastResponse)) !== null) {
            const raw = match[0];
            const code = match[1].trim();
            const type = raw.toLowerCase().startsWith('```json') ? 'json' : 'bash';
            if (code) blocks.push({ type, code });
          }

          if (blocks.length === 0) {
            this.appendLog(ctx, currentState, 'No executable code blocks found in AI response. Execution completed.', '32');
            currentState = HarnessState.SUCCESS;
            break;
          }

          let allSucceeded = true;
          for (const block of blocks) {
            if (block.type === 'json' && block.code.includes('"mcp"')) {
              try {
                const mcpObj = JSON.parse(block.code);
                const [serverName, toolName] = (mcpObj.mcp || '').split('/');
                this.appendLog(ctx, currentState, `Invoking MCP Tool: ${mcpObj.mcp}`, '35');
                
                const mcpResult = await globalMcpClientManager.callTool(serverName, toolName || 'default', mcpObj.args || {});
                this.appendLog(ctx, currentState, `[MCP Result]\n${JSON.stringify(mcpResult, null, 2)}`, '90');
              } catch (e: any) {
                allSucceeded = false;
                ctx.lastErrorOutput = `MCP Tool Execution Failed: ${e.message}`;
                this.appendLog(ctx, currentState, ctx.lastErrorOutput, '31');
                break;
              }
            } else {
              // Process bash block line by line
              const lines = block.code.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
              
              for (const line of lines) {
                this.appendLog(ctx, currentState, `Executing command: ${line}`, '90');
                const res = await globalShellEngine.execute(line, execCtx.args);
                
                if (res.stdout) this.appendLog(ctx, currentState, `[stdout]\n${res.stdout.trim()}`, '90');
                if (res.stderr) this.appendLog(ctx, currentState, `[stderr]\n${res.stderr.trim()}`, '31');
                
                if (res.exitCode !== 0) {
                  allSucceeded = false;
                  ctx.lastErrorOutput = res.stderr || `Command '${line}' failed with exitCode ${res.exitCode}`;
                  this.appendLog(ctx, currentState, `Command failed: ${line}`, '31');
                  break;
                }
              }
            }
            if (!allSucceeded) break;
          }

          if (allSucceeded) {
            currentState = HarnessState.SUCCESS;
          } else {
            currentState = HarnessState.REFLEXION;
          }
          break;
        }

        case HarnessState.REFLEXION: {
          ctx.retries++;
          this.appendLog(ctx, currentState, `Initiating Reflexion loop (Attempt ${ctx.retries}/${ctx.maxRetries})...`, '35');
          if (ctx.retries > ctx.maxRetries) {
            this.appendLog(ctx, HarnessState.ERROR, `Max retries (${ctx.maxRetries}) exceeded. Execution aborted.`, '31');
            currentState = HarnessState.ERROR;
          } else {
            const reflexionPrompt = `System: The previous execution failed with the following error:\n${ctx.lastErrorOutput}\nPlease analyze the error, fix the command, and return the corrected version in a \`\`\`bash\`\`\` block.`;
            ctx.conversationHistory.push(reflexionPrompt);
            currentState = HarnessState.INFER;
          }
          break;
        }
      }
    }

    if (currentState === HarnessState.SUCCESS) {
      this.appendLog(ctx, HarnessState.SUCCESS, 'Skill Execution Completed Successfully.', '32');
      return { stdout: ctx.stdoutAcc, stderr: '', exitCode: 0 };
    } else {
      return { stdout: ctx.stdoutAcc, stderr: ctx.lastErrorOutput, exitCode: 1 };
    }
  }
}

export const globalHarnessEngine = new HarnessEngine();
