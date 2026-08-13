import { ExecutionContext, ExecutionResult } from './types';
import { globalIPCBus } from '../kernel/ipcBus';
import { IPCMessage } from '../kernel/types';
import { globalShellEngine } from './shellEngine';

export enum HarnessState {
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
    ctx.stdoutAcc += `\x1b[${colorCode}m[HarnessEngine: ${state}]\x1b[0m ${message}\n`;
  }

  async executeSkill(content: string, execCtx: ExecutionContext): Promise<ExecutionResult> {
    const ctx: FsmContext = {
      retries: 0,
      maxRetries: 3,
      conversationHistory: [],
      stdoutAcc: '',
      originalSkillContent: content,
      lastErrorOutput: '',
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

            // Initial AI prompt framing
            const sysPrompt = `You are the Earendel OS Harness-Skill engine. Execute the user's task by outputting executable bash commands wrapped inside \`\`\`bash ... \`\`\` blocks.
Available System Tools: [${availableTools}].
Important: Output valid bash lines. Keep instructions minimal.`;

            ctx.conversationHistory.push(`${sysPrompt}\n\nUser Skill Task:\n${ctx.originalSkillContent}`);
            currentState = HarnessState.INFER;
          }
          break;
        }

        case HarnessState.INFER: {
          this.appendLog(ctx, currentState, `Invoking AI model (Attempt ${ctx.retries + 1}/${ctx.maxRetries + 1})...`, '33');
          
          try {
            const promptContext = ctx.conversationHistory.join('\n\n');
            const res = await globalIPCBus.sendIPC(24, 'driverd', 'DEV_WRITE_AI', { prompt: promptContext });
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
          this.appendLog(ctx, currentState, 'Extracting and executing bash commands...', '32');
          
          const lastResponse = ctx.conversationHistory[ctx.conversationHistory.length - 1];
          // Robust regex for ```bash, ```sh, ```shell or generic ``` blocks
          const regex = /```(?:bash|sh|shell)?\r?\n([\s\S]*?)```/gi;
          let match;
          const blocks: string[] = [];
          while ((match = regex.exec(lastResponse)) !== null) {
            const code = match[1].trim();
            if (code) blocks.push(code);
          }

          if (blocks.length === 0) {
            this.appendLog(ctx, currentState, 'No executable code blocks found in AI response. Execution completed.', '32');
            currentState = HarnessState.SUCCESS;
            break;
          }

          let allSucceeded = true;
          for (const block of blocks) {
            // Process block line by line to handle multiline input properly
            const lines = block.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
            
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
