import { ExecutionContext, ExecutionResult } from './types';
import { globalIPCBus } from '../kernel/ipcBus';
import { IPCMessage } from '../kernel/types';
import { globalShellEngine } from './shellEngine';
import { globalMcpClientManager } from './mcpClient';
import {
  parseSkillContent,
  validateSkillInputs,
  parseTimeoutMs,
  ParsedSkill,
} from './skillParser';
import { globalAgentMemoryManager } from './memoryEngine';

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
  pid: number;
  sessionId: string;
  retries: number;
  maxRetries: number;
  conversationHistory: string[];
  stdoutAcc: string;
  originalSkillContent: string;
  lastErrorOutput: string;
  initialErrorSnippet: string;
  hadReflexion: boolean;
  parsedSkill?: ParsedSkill;
  resolvedInputs: Record<string, any>;
  scratchpadDir: string;
  timeoutMs: number;
  startTime: number;
  onProgress?: (state: HarnessState, message: string) => void;
}

export class HarnessEngine {
  constructor() {
    globalIPCBus.registerService('harnessd', 7, async (msg: IPCMessage) => {
      if (msg.action === 'DEV_WRITE_SKILL') {
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

  /**
   * Token-efficiency helper: Prunes massive stdout/stderr outputs to protect LLM context windows.
   * Keeps head lines, tail lines, and extracts error-containing lines.
   */
  private pruneOutputForContext(rawOutput: string, maxLen: number = 2000): string {
    if (!rawOutput || rawOutput.length <= maxLen) {
      return rawOutput;
    }

    const lines = rawOutput.split(/\r?\n/);
    if (lines.length <= 40) {
      return rawOutput.substring(0, maxLen) + '\n... [Output Truncated]';
    }

    const head = lines.slice(0, 15).join('\n');
    const tail = lines.slice(-20).join('\n');
    const middleErrors = lines
      .slice(15, -20)
      .filter((l) => /error|fail|exception|fatal|denied|invalid/i.test(l))
      .slice(0, 5)
      .join('\n');

    let pruned = `${head}\n\n... [${lines.length - 35} lines truncated by Harness Token Pruner] ...\n`;
    if (middleErrors) {
      pruned += `[Key Error Lines Found in Omitted Logs]:\n${middleErrors}\n\n`;
    }
    pruned += `${tail}`;
    return pruned;
  }

  /**
   * Parse key-value arguments from CLI array (e.g. ['--scope=core', '--dry_run=true', 'extraArg'])
   */
  public parseCliArgs(args: string[]): Record<string, any> {
    const parsed: Record<string, any> = {};
    for (const arg of args) {
      if (arg.startsWith('--')) {
        const eqIdx = arg.indexOf('=');
        if (eqIdx !== -1) {
          const k = arg.substring(2, eqIdx).trim();
          const v = arg.substring(eqIdx + 1).trim();
          parsed[k] = v;
        } else {
          parsed[arg.substring(2).trim()] = true;
        }
      }
    }
    return parsed;
  }

  async executeSkill(
    content: string,
    execCtx: ExecutionContext,
    onProgress?: (state: HarnessState, message: string) => void,
    userProvidedInputs?: Record<string, any>
  ): Promise<ExecutionResult> {
    const pid = Math.floor(1000 + Math.random() * 9000);
    const sessionId = `session_${Date.now()}`;
    const scratchpadDir = globalAgentMemoryManager.allocateScratchpad(execCtx.vfs, pid);

    const ctx: FsmContext = {
      pid,
      sessionId,
      retries: 0,
      maxRetries: 3,
      conversationHistory: [],
      stdoutAcc: '',
      originalSkillContent: content,
      lastErrorOutput: '',
      initialErrorSnippet: '',
      hadReflexion: false,
      resolvedInputs: {},
      scratchpadDir,
      timeoutMs: 60000,
      startTime: Date.now(),
      onProgress,
    };

    let currentState: HarnessState = HarnessState.PARSE;
    let cmdExecutionCounter = 0;

    try {
      while (currentState !== HarnessState.SUCCESS && currentState !== HarnessState.ERROR) {
        // Hard timeout check
        if (Date.now() - ctx.startTime > ctx.timeoutMs) {
          this.appendLog(ctx, HarnessState.ERROR, `Execution Timed Out (Limit: ${ctx.timeoutMs}ms). Aborting.`, '31');
          ctx.lastErrorOutput = `Skill execution exceeded timeout limit (${ctx.timeoutMs}ms)`;
          currentState = HarnessState.ERROR;
          break;
        }

        switch (currentState) {
          case HarnessState.PARSE: {
            this.appendLog(ctx, currentState, `[PID:${ctx.pid}] Initializing Memory L0 Scratchpad: ${ctx.scratchpadDir}`);
            this.appendLog(ctx, currentState, 'Parsing Skill Manifest (YAML Frontmatter) & Markdown Body...');
            
            let parsed: ParsedSkill;
            try {
              parsed = parseSkillContent(content);
              ctx.parsedSkill = parsed;
            } catch (err: any) {
              this.appendLog(ctx, HarnessState.ERROR, `Parse Failure: ${err.message}`, '31');
              ctx.lastErrorOutput = `Skill Manifest Parse Error: ${err.message}`;
              currentState = HarnessState.ERROR;
              break;
            }

            const manifest = parsed.manifest;
            ctx.maxRetries = manifest.max_turns ? Math.max(1, manifest.max_turns - 1) : 3;
            ctx.timeoutMs = parseTimeoutMs(manifest.timeout, 60000);

            this.appendLog(
              ctx,
              currentState,
              `Skill Loaded: "${manifest.name}" (v${manifest.version || '1.0.0'}) - ${manifest.description || 'No description'}`
            );

            // 1. Static 0-Token Input Schema Validation
            const cliInputs = userProvidedInputs || this.parseCliArgs(execCtx.args || []);
            const validation = validateSkillInputs(manifest, cliInputs);
            if (!validation.valid) {
              const errDetails = validation.errors.join('; ');
              this.appendLog(ctx, HarnessState.ERROR, `Input Validation Failed: ${errDetails}`, '31');
              ctx.lastErrorOutput = `Input Validation Error: ${errDetails}`;
              currentState = HarnessState.ERROR;
              break;
            }
            ctx.resolvedInputs = validation.parsedInputs;
            this.appendLog(
              ctx,
              currentState,
              `Resolved Inputs: ${JSON.stringify(ctx.resolvedInputs)}`
            );

            // 2. Discover and filter available System Tools
            let systemTools = 'ls, cat, grep, find, echo, mkdir, rm, cp, mv, python, node, ecc, sys_infer';
            try {
              const binNode = execCtx.vfs.getNodeByPath('/bin');
              if (binNode && binNode.children) {
                systemTools = Array.from(binNode.children.keys()).join(', ');
              }
            } catch (e) {}

            if (manifest.tools?.system && manifest.tools.system.length > 0) {
              systemTools = manifest.tools.system.join(', ');
            }

            // 3. Discover and filter MCP Tools
            let mcpToolsDesc = '';
            try {
              const allMcpTools = await globalMcpClientManager.listTools();
              const allowedMcp = manifest.tools?.mcp;
              const filteredMcp = allowedMcp && allowedMcp.length > 0
                ? allMcpTools.filter((t) => allowedMcp.includes(t.serverName) || allowedMcp.includes(`${t.serverName}/${t.name}`))
                : allMcpTools;
              mcpToolsDesc = filteredMcp.map((t) => `${t.serverName}/${t.name} (${t.description})`).join(', ');
            } catch (e) {}

            // 4. Resolve References
            let referencesText = '';
            if (manifest.references && manifest.references.length > 0) {
              const refSnippets: string[] = [];
              for (const refPath of manifest.references) {
                const refContent = execCtx.vfs.readFile(refPath, execCtx.env['USER'] || 'hello');
                if (refContent) {
                  refSnippets.push(`--- Reference: ${refPath} ---\n${refContent.trim()}`);
                }
              }
              if (refSnippets.length > 0) {
                referencesText = `\n\n### Attached References & Documentation:\n${refSnippets.join('\n\n')}`;
              }
            }

            // 5. Build Constraints text
            let constraintsText = '';
            if (manifest.constraints && manifest.constraints.length > 0) {
              constraintsText = `\n\n### Mandatory Constraints:\n${manifest.constraints.map((c) => `- ${c}`).join('\n')}`;
            }

            // 6. Memory L3: JIT Load User Agent Profile & Lessons Learned
            const userProfileText = globalAgentMemoryManager.loadUserProfile(
              execCtx.vfs,
              execCtx.env['USER'] || 'hello',
              execCtx.env['HOME'] || '/home/hello'
            );
            const lessonsLearnedText = globalAgentMemoryManager.loadLessonsLearned(
              execCtx.vfs,
              execCtx.env['USER'] || 'hello'
            );

            // 7. Assemble Framing System Prompt
            const sysPrompt = `You are the Earendel OS Agentic Harness Engine executing Skill "${manifest.name}".
Skill Description: ${manifest.description || 'N/A'}
Authorized System Tools: [${systemTools}].
Authorized MCP Tools: [${mcpToolsDesc || 'none'}].
Timeout: ${manifest.timeout || '60s'}.
Active Scratchpad Sandbox: ${ctx.scratchpadDir} (Use for intermediate files or inspection).

How to act:
1. Execute bash commands inside \`\`\`bash ... \`\`\` blocks.
2. Call MCP tools using:
\`\`\`json
{ "mcp": "serverName/toolName", "args": { ... } }
\`\`\`
Keep bash commands concise, deterministic, and verify outputs.

Inputs Provided:
\`\`\`json
${JSON.stringify(ctx.resolvedInputs, null, 2)}
\`\`\`
${constraintsText}
${referencesText}
${userProfileText}
${lessonsLearnedText}

### Skill Execution Instructions (Body):
${parsed.body}`;

            ctx.conversationHistory.push(sysPrompt);
            currentState = HarnessState.INFER;
            break;
          }

          case HarnessState.INFER: {
            this.appendLog(ctx, currentState, `Reasoning with /dev/ai (Turn ${ctx.retries + 1}/${ctx.maxRetries + 1})...`, '33');
            
            try {
              // L1 Working Memory: Condense history to roll up older turns
              const promptContext = globalAgentMemoryManager.condenseHistory(ctx.conversationHistory);
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
            this.appendLog(ctx, currentState, 'Executing synthesized commands & MCP tool calls...', '32');
            
            const lastResponse = ctx.conversationHistory[ctx.conversationHistory.length - 1];
            const manifest = ctx.parsedSkill?.manifest;
            
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
              this.appendLog(ctx, currentState, 'No further executable blocks requested. Skill execution goal reached.', '32');
              currentState = HarnessState.SUCCESS;
              break;
            }

            let allSucceeded = true;
            for (const block of blocks) {
              cmdExecutionCounter++;
              if (block.type === 'json' && block.code.includes('"mcp"')) {
                try {
                  const mcpObj = JSON.parse(block.code);
                  const [serverName, toolName] = (mcpObj.mcp || '').split('/');
                  
                  // MCP Tool Whitelist Enforcement
                  if (manifest?.tools?.mcp && manifest.tools.mcp.length > 0) {
                    const fullMcpName = `${serverName}/${toolName}`;
                    if (!manifest.tools.mcp.includes(serverName) && !manifest.tools.mcp.includes(fullMcpName)) {
                      throw new Error(`Security Interception: MCP tool '${fullMcpName}' is not declared in skill tools.mcp manifest.`);
                    }
                  }

                  this.appendLog(ctx, currentState, `Invoking MCP Tool: ${mcpObj.mcp}`, '35');
                  const mcpResult = await globalMcpClientManager.callTool(serverName, toolName || 'default', mcpObj.args || {});
                  const rawMcpStr = JSON.stringify(mcpResult, null, 2);

                  // L0 Scratchpad: Write large outputs to disk if > 1200 chars
                  let displayedOut = rawMcpStr;
                  if (rawMcpStr.length > 1200) {
                    const rawPath = globalAgentMemoryManager.writeScratchpad(
                      execCtx.vfs,
                      ctx.pid,
                      `mcp_${cmdExecutionCounter}.json`,
                      rawMcpStr
                    );
                    displayedOut = `[Large MCP result (${rawMcpStr.length} chars) saved to ${rawPath}]\n${this.pruneOutputForContext(rawMcpStr)}`;
                  } else {
                    displayedOut = this.pruneOutputForContext(rawMcpStr);
                  }

                  this.appendLog(ctx, currentState, `[MCP Result]\n${displayedOut}`, '90');
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
                  // Microkernel Tool Whitelist Sandbox Enforcement
                  const cmdBinary = line.split(/[\s|&;]+/)[0].replace(/^[\/.]*\//, '');
                  const builtins = ['cd', 'pwd', 'echo', 'true', 'false', 'test'];
                  if (manifest?.tools?.system && manifest.tools.system.length > 0) {
                    if (!manifest.tools.system.includes(cmdBinary) && !builtins.includes(cmdBinary)) {
                      allSucceeded = false;
                      ctx.lastErrorOutput = `Security Interception: Command '${cmdBinary}' is not permitted by skill tools.system manifest whitelist.`;
                      this.appendLog(ctx, currentState, ctx.lastErrorOutput, '31');
                      break;
                    }
                  }

                  this.appendLog(ctx, currentState, `Executing command: ${line}`, '90');
                  const res = await globalShellEngine.execute(line, execCtx.args);
                  
                  if (res.stdout) {
                    let displayedOut = res.stdout.trim();
                    // L0 Scratchpad: Write large outputs to disk if > 1200 chars
                    if (res.stdout.length > 1200) {
                      const rawPath = globalAgentMemoryManager.writeScratchpad(
                        execCtx.vfs,
                        ctx.pid,
                        `stdout_${cmdExecutionCounter}.raw`,
                        res.stdout
                      );
                      displayedOut = `[Large output (${res.stdout.length} chars) saved to ${rawPath}]\n${this.pruneOutputForContext(displayedOut)}`;
                    } else {
                      displayedOut = this.pruneOutputForContext(displayedOut);
                    }
                    this.appendLog(ctx, currentState, `[stdout]\n${displayedOut}`, '90');
                  }

                  if (res.stderr) {
                    const prunedErr = this.pruneOutputForContext(res.stderr.trim());
                    this.appendLog(ctx, currentState, `[stderr]\n${prunedErr}`, '31');
                  }
                  
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
            ctx.hadReflexion = true;
            if (!ctx.initialErrorSnippet) {
              ctx.initialErrorSnippet = ctx.lastErrorOutput;
            }

            this.appendLog(ctx, currentState, `Initiating Reflexion loop (Attempt ${ctx.retries}/${ctx.maxRetries})...`, '35');
            if (ctx.retries > ctx.maxRetries) {
              this.appendLog(ctx, HarnessState.ERROR, `Max reflexions (${ctx.maxRetries}) exceeded. Aborting execution.`, '31');
              currentState = HarnessState.ERROR;
            } else {
              const prunedError = this.pruneOutputForContext(ctx.lastErrorOutput);
              const reflexionPrompt = `System: Execution encountered an error:\n${prunedError}\nPlease analyze the failure, adjust the parameters or fix the command, and provide the corrected execution block in \`\`\`bash\`\`\` or \`\`\`json\`\`\`.`;
              ctx.conversationHistory.push(reflexionPrompt);
              currentState = HarnessState.INFER;
            }
            break;
          }
        }
      }
    } finally {
      // Memory L3: If successfully recovered after Reflexion, distill lesson learned
      if (currentState === HarnessState.SUCCESS && ctx.hadReflexion && ctx.parsedSkill) {
        globalAgentMemoryManager.recordLesson(
          execCtx.vfs,
          ctx.parsedSkill.manifest.name,
          ctx.initialErrorSnippet,
          'Adjusted command arguments/syntax in subsequent reflexion turn.',
          execCtx.env['USER'] || 'hello'
        );
      }

      // Memory L2: Append Session Audit Log to /var/log/harness/
      globalAgentMemoryManager.appendSessionAudit(execCtx.vfs, {
        timestamp: new Date().toISOString(),
        sessionId: ctx.sessionId,
        pid: ctx.pid,
        skillName: ctx.parsedSkill?.manifest.name || 'unparsed',
        status: currentState === HarnessState.SUCCESS ? 'SUCCESS' : 'ERROR',
        turns: ctx.retries + 1,
        error: currentState === HarnessState.ERROR ? ctx.lastErrorOutput : undefined,
      });

      // Memory L0: Clean up scratchpad sandbox
      globalAgentMemoryManager.cleanupScratchpad(execCtx.vfs, ctx.pid);
    }

    if (currentState === HarnessState.SUCCESS) {
      this.appendLog(ctx, HarnessState.SUCCESS, 'Skill execution finished successfully.', '32');
      return { stdout: ctx.stdoutAcc, stderr: '', exitCode: 0 };
    } else {
      return { stdout: ctx.stdoutAcc, stderr: ctx.lastErrorOutput, exitCode: 1 };
    }
  }
}

export const globalHarnessEngine = new HarnessEngine();
