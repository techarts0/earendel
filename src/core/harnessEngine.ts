import { ExecutionContext, ExecutionResult } from './types';
import { globalIPCBus } from '../kernel/ipcBus';
import { IPCMessage } from '../kernel/types';
import { ShellEngine } from './shellEngine';
import { globalMcpClientManager } from './mcpClient';
import {
  parseSkillContent,
  validateSkillInputs,
  parseTimeoutMs,
  ParsedSkill,
  SkillPermissionGrant,
} from './skillParser';
import { globalAgentMemoryManager } from './memoryEngine';
import { globalCapabilityManager } from '../kernel/capability';
import { globalTaskScheduler } from '../kernel/taskScheduler';
import { createCapabilityVfsView } from './scopedVfs';

const SAFE_HARNESS_BUILTINS = ['pwd', 'echo', 'true', 'false'];
const STATEFUL_OR_RECURSIVE_COMMANDS = new Set(['cd', 'source', '.', 'sh', 'bash', 'eval', 'exec', 'exit', 'export', 'unset', 'alias', 'unalias', 'read']);
const MAX_SKILL_RESPONSE_CHARS = 32_768;
const MAX_SKILL_ACTIONS = 128;
const MAX_SKILL_COMMAND_CHARS = 4_096;
const MAX_SKILL_OUTPUT_CHARS = 64_000;

function boundSkillOutput(output: string): { text: string; truncated: boolean } {
  return output.length > MAX_SKILL_OUTPUT_CHARS
    ? { text: `${output.slice(0, MAX_SKILL_OUTPUT_CHARS)}\n[Skill output truncated at ${MAX_SKILL_OUTPUT_CHARS} characters]`, truncated: true }
    : { text: output, truncated: false };
}

/** Accept one plain command only; the harness grants authority per command, so shell
 * operators and substitution must not smuggle additional commands past that check. */
function isSingleCommand(line: string): boolean {
  // Keep the accepted grammar small so this check cannot disagree with the shell parser.
  if (/[\\;|&<>\n\r]/.test(line)) return false;
  let single = false;
  let double = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === "'" && !double) { single = !single; continue; }
    if (char === '"' && !single) { double = !double; continue; }
    if (single) continue;
    // Variable expansion is also denied here: its value can introduce syntax after
    // this preflight parser has approved the source line.
    if (char === '`' || char === '$') return false;
  }
  return !single && !double;
}

function commandTokens(line: string): string[] | null {
  const tokens: string[] = [];
  let token = '';
  let single = false;
  let double = false;
  let escaped = false;
  for (const char of line.trim()) {
    if (escaped) { token += char; escaped = false; continue; }
    if (char === '\\' && !single) { escaped = true; continue; }
    if (char === "'" && !double) { single = !single; continue; }
    if (char === '"' && !single) { double = !double; continue; }
    if (/\s/.test(char) && !single && !double) {
      if (token) { tokens.push(token); token = ''; }
    } else token += char;
  }
  if (single || double || escaped) return null;
  if (token) tokens.push(token);
  return tokens;
}

function resolveHarnessPath(path: string, execCtx: ExecutionContext): string {
  return execCtx.vfs.resolvePath(path, execCtx.env.USER || 'hello');
}

function pathInPermissionScope(_vfs: ExecutionContext['vfs'], path: string, scope: string, execCtx: ExecutionContext): boolean {
  if (scope === '*') return true;
  const target = resolveHarnessPath(path, execCtx);
  const root = resolveHarnessPath(scope, execCtx);
  return target === root || root === '/' || target.startsWith(`${root}/`);
}

function intersectPermissionScopes(
  requested: unknown,
  approved: unknown,
  execCtx: ExecutionContext,
): string[] {
  if (!Array.isArray(requested) || !Array.isArray(approved)) return [];
  const effective = new Set<string>();
  for (const request of requested) {
    if (typeof request !== 'string' || !request.trim()) continue;
    const normalizedRequest = request === '*' ? '*' : resolveHarnessPath(request, execCtx);
    for (const approval of approved) {
      if (typeof approval !== 'string' || !approval.trim()) continue;
      const normalizedApproval = approval === '*' ? '*' : resolveHarnessPath(approval, execCtx);
      if (normalizedApproval === '*') {
        effective.add(normalizedRequest);
      } else if (normalizedRequest === '*') {
        effective.add(normalizedApproval);
      } else if (pathInPermissionScope(execCtx.vfs, normalizedApproval, normalizedRequest, execCtx)) {
        effective.add(normalizedApproval);
      } else if (pathInPermissionScope(execCtx.vfs, normalizedRequest, normalizedApproval, execCtx)) {
        effective.add(normalizedRequest);
      }
    }
  }
  return [...effective];
}

function intersectNames(requested: unknown, approved: unknown, caseInsensitive = false): string[] {
  if (!Array.isArray(requested) || !Array.isArray(approved)) return [];
  const approvalSet = new Set(approved.filter((entry): entry is string => typeof entry === 'string')
    .map(entry => caseInsensitive ? entry.toLowerCase() : entry));
  return [...new Set(requested.filter((entry): entry is string => typeof entry === 'string')
    .filter(entry => approvalSet.has(caseInsensitive ? entry.toLowerCase() : entry))
    .map(entry => caseInsensitive ? entry.toLowerCase() : entry))];
}

function commandPermissionError(
  tokens: string[],
  manifest: ParsedSkill['manifest'],
  execCtx: ExecutionContext,
  scratchpadDir: string,
): string | null {
  const command = (tokens[0].split('/').pop() || '').toLowerCase();
  if (STATEFUL_OR_RECURSIVE_COMMANDS.has(command)) {
    return `Command '${command}' can alter shared shell state or bypass the Skill command boundary and is denied.`;
  }
  if (command === 'find') {
    const executionPredicates = new Set(['-exec', '-execdir', '-ok', '-okdir']);
    const writePredicates = new Set(['-delete', '-fprint', '-fprintf', '-fls']);
    if (tokens.some(token => executionPredicates.has(token))) {
      return "Command 'find' execution predicates are denied because they invoke nested commands outside the manifest check.";
    }
    if (tokens.some(token => writePredicates.has(token))) {
      return "Command 'find' output and deletion predicates are denied because their side effects are not covered by the Skill manifest.";
    }
  }
  if (command === 'ecc' && tokens[1] === 'test') {
    return "Command 'ecc test' is denied because it executes JavaScript in the shared browser realm.";
  }
  const permissions = manifest.permissions || {};
  const reads = [...(Array.isArray(permissions.vfs_read) ? permissions.vfs_read.filter((p): p is string => typeof p === 'string') : []), scratchpadDir];
  const writes = [...(Array.isArray(permissions.vfs_write) ? permissions.vfs_write.filter((p): p is string => typeof p === 'string') : []), scratchpadDir];
  const networkCommands = new Set(['curl', 'wget', 'ping', 'ssh', 'scp', 'nc', 'netcat', 'http', 'fetch']);
  if (networkCommands.has(command) && permissions.network !== true) {
    return `Command '${command}' requires permissions.network: true.`;
  }
  if (networkCommands.has(command)) {
    const outputIndex = tokens.findIndex(token => token === '-o' || token === '--output');
    let outputPath = outputIndex >= 0 ? tokens[outputIndex + 1] : undefined;
    if (command === 'wget') {
      const shortOutput = tokens.find(token => token.startsWith('-O='));
      const outputOptionIndex = tokens.findIndex(token => token === '-O');
      outputPath = shortOutput?.slice(3) || (outputOptionIndex >= 0 ? tokens[outputOptionIndex + 1] : undefined);
      if (!outputPath) {
        const rawUrl = tokens.slice(1).find(token => !token.startsWith('-'));
        if (rawUrl) {
          try {
            const url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
            outputPath = url.pathname.split('/').filter(Boolean).pop() || 'index.html';
          } catch {
            // Let wget return its own invalid-URL diagnostic; it will write nothing.
          }
        }
      }
    }
    const outputOptionCount = tokens.filter(token => ['-o', '--output', '-O'].includes(token) || token.startsWith('-O=')).length;
    if (outputOptionCount > 1) return `Command '${command}' has multiple output targets; this is denied in Skills.`;
    if (outputPath && (writes.length === 0 || !writes.some(scope => pathInPermissionScope(execCtx.vfs, outputPath!, scope, execCtx)))) {
      return `Network output '${outputPath}' requires an allowed permissions.vfs_write path.`;
    }
    if (!outputPath && tokens.some(token => token === '-O' || token === '--remote-name')) {
      const rawUrl = tokens.slice(1).find(token => /^https?:\/\//i.test(token));
      let remotePath: string | undefined;
      if (rawUrl) {
        try {
          const url = new URL(rawUrl);
          remotePath = url.pathname.split('/').filter(Boolean).pop() || 'index.html';
        } catch { /* The command will report malformed URLs without writing. */ }
      }
      const target = remotePath || execCtx.vfs.getPwd();
      if (!writes.some(scope => pathInPermissionScope(execCtx.vfs, target, scope, execCtx))) {
        return `Network output requires write permission for '${target}'.`;
      }
    }
    return null;
  }

  const readOnly = new Set(['cat', 'head', 'tail', 'grep', 'find', 'ls', 'wc', 'stat', 'file', 'du', 'diff', 'sha256sum']);
  const writeOnly = new Set(['mkdir', 'rm', 'rmdir', 'touch', 'tee', 'truncate']);
  const mixed = new Set(['cp', 'mv', 'ecc']);
  if (command === 'python' || command === 'python3' || command === 'node' || command === 'js') {
    return `Command '${command}' is denied in Skills until its runtime is isolated from the browser and global VFS.`;
  }
  const needsRead = readOnly.has(command) || mixed.has(command);
  const needsWrite = writeOnly.has(command) || mixed.has(command);
  if (needsRead && reads.length === 0) return `Command '${command}' requires a non-empty permissions.vfs_read scope.`;
  if (needsWrite && writes.length === 0) return `Command '${command}' requires a non-empty permissions.vfs_write scope.`;

  if (!needsRead && !needsWrite && !SAFE_HARNESS_BUILTINS.includes(command)) {
    return `Command '${command}' has no reviewed permission profile and is denied in Skills.`;
  }
  if (!needsRead && !needsWrite) return null;

  const operands = tokens.slice(1).filter(token => !token.startsWith('-'));
  let readPaths = needsRead ? operands : [];
  let writePaths = needsWrite ? operands : [];
  if (command === 'grep') readPaths = operands.slice(1);
  if (command === 'cp' || command === 'mv') {
    readPaths = operands.slice(0, -1);
    writePaths = operands.slice(-1);
  }
  if (command === 'ecc') {
    // ECC input operands are reads; -o output paths are writes.
    readPaths = operands.filter((_path, index) => {
      const tokenIndex = tokens.indexOf(_path);
      return tokenIndex > 0 && tokens[tokenIndex - 1] !== '-o';
    });
    writePaths = tokens.flatMap((token, index) => token === '-o' && tokens[index + 1] ? [tokens[index + 1]] : []);
    if (tokens.includes('-o') && writes.length === 0) return "Command 'ecc -o' requires permissions.vfs_write.";
  }
  if ((needsRead && readPaths.length === 0) || (needsWrite && writePaths.length === 0)) {
    const cwd = execCtx.vfs.getPwd();
    if (needsRead && readPaths.length === 0) readPaths = [cwd];
    if (needsWrite && writePaths.length === 0) writePaths = [cwd];
  }

  for (const path of readPaths) {
    if (!reads.some(scope => pathInPermissionScope(execCtx.vfs, path, scope, execCtx))) {
      return `Read denied: '${path}' is outside permissions.vfs_read.`;
    }
  }
  for (const path of writePaths) {
    if (!writes.some(scope => pathInPermissionScope(execCtx.vfs, path, scope, execCtx))) {
      return `Write denied: '${path}' is outside permissions.vfs_write.`;
    }
  }
  return null;
}

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
  approvedReadScopes: string[];
  approvedWriteScopes: string[];
  approvedSystemTools: string[];
  approvedMcpTools: string[];
  networkApproved: boolean;
  memoryApproved: boolean;
  timeoutMs: number;
  startTime: number;
  abortController: AbortController;
  auditEvents: Array<{ at: string; action: string; detail: string }>;
  onProgress?: (state: HarnessState, message: string) => void;
}

export class HarnessEngine {
  private nextSkillPid = 1_000_000;

  private recordAudit(ctx: FsmContext, action: string, detail: string): void {
    if (ctx.auditEvents.length >= 500) ctx.auditEvents.shift();
    ctx.auditEvents.push({ at: new Date().toISOString(), action, detail: detail.slice(0, 240) });
  }

  private waitUntilDeadline<T>(operation: Promise<T>, ctx: FsmContext): Promise<T> {
    if (ctx.abortController.signal.aborted) {
      return Promise.reject(ctx.abortController.signal.reason ?? new Error('Skill execution cancelled'));
    }
    const remainingMs = ctx.timeoutMs - (Date.now() - ctx.startTime);
    if (remainingMs <= 0) {
      const error = new Error(`Skill execution exceeded timeout limit (${ctx.timeoutMs}ms)`);
      ctx.abortController.abort(error);
      return Promise.reject(error);
    }
    let timer: ReturnType<typeof setTimeout>;
    let onAbort: () => void;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`Skill execution exceeded timeout limit (${ctx.timeoutMs}ms)`);
        ctx.abortController.abort(error);
        reject(error);
      }, remainingMs);
    });
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(ctx.abortController.signal.reason ?? new Error('Skill execution cancelled'));
      ctx.abortController.signal.addEventListener('abort', onAbort, { once: true });
    });
    return Promise.race([operation, deadline, cancelled]).finally(() => {
      clearTimeout(timer);
      ctx.abortController.signal.removeEventListener('abort', onAbort);
    });
  }

  constructor() {
    globalIPCBus.registerService('harnessd', 10, async (msg: IPCMessage) => {
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
    userProvidedInputs?: Record<string, any>,
    permissionGrant: SkillPermissionGrant = {},
  ): Promise<ExecutionResult> {
    while (globalTaskScheduler.getProcess(this.nextSkillPid)) this.nextSkillPid++;
    if (!Number.isSafeInteger(this.nextSkillPid)) {
      return { stdout: '', stderr: 'Harness: no process identifiers remain', exitCode: 1 };
    }
    const pid = this.nextSkillPid++;
    const sessionId = `session_${Date.now()}`;
    globalTaskScheduler.createProcess({
      pid,
      ppid: execCtx.callerPid ?? 0,
      name: `[skill] ${sessionId}`,
      user: execCtx.env.USER || 'hello',
      state: 'RUNNING',
      startTime: new Date(),
      vszKB: 32000,
      rssKB: 8000,
      cpuUsagePercent: 0,
      cwd: execCtx.vfs.getPwd(),
    });
    const scratchpadDir = globalAgentMemoryManager.allocateScratchpad(execCtx.vfs, pid);
    const abortController = new AbortController();
    const abortFromCaller = () => abortController.abort(execCtx.abortSignal?.reason ?? new Error('Skill execution cancelled'));
    if (execCtx.abortSignal?.aborted) abortFromCaller();
    else execCtx.abortSignal?.addEventListener('abort', abortFromCaller, { once: true });
    const skillVfs = createCapabilityVfsView(execCtx.vfs, pid, execCtx.env.USER || 'hello');
    const skillShell = new ShellEngine(skillVfs, execCtx.processManager);
    skillShell.lang = execCtx.lang;
    skillShell.callerPid = pid;
    skillShell.abortSignal = abortController.signal;
    for (const [key, value] of Object.entries(execCtx.env)) skillShell.setEnv(key, value);
    skillShell.setEnv('PWD', execCtx.vfs.getPwd());

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
      approvedReadScopes: [],
      approvedWriteScopes: [],
      approvedSystemTools: [],
      approvedMcpTools: [],
      networkApproved: false,
      memoryApproved: false,
      timeoutMs: 60000,
      startTime: Date.now(),
      abortController,
      auditEvents: [],
      onProgress,
    };

    let currentState: HarnessState = HarnessState.PARSE;
    let cmdExecutionCounter = 0;

    try {
      while (currentState !== HarnessState.SUCCESS && currentState !== HarnessState.ERROR) {
        if (ctx.abortController.signal.aborted) {
          ctx.lastErrorOutput = ctx.abortController.signal.reason?.message || 'Skill execution cancelled';
          currentState = HarnessState.ERROR;
          break;
        }
        // Hard timeout check
        if (Date.now() - ctx.startTime > ctx.timeoutMs) {
          ctx.abortController.abort(new Error(`Skill execution exceeded timeout limit (${ctx.timeoutMs}ms)`));
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
            ctx.approvedReadScopes = intersectPermissionScopes(manifest.permissions?.vfs_read, permissionGrant.vfs_read, execCtx);
            ctx.approvedWriteScopes = intersectPermissionScopes(manifest.permissions?.vfs_write, permissionGrant.vfs_write, execCtx);
            ctx.approvedSystemTools = intersectNames(manifest.tools?.system, permissionGrant.system_tools, true);
            ctx.approvedMcpTools = intersectNames(manifest.tools?.mcp, permissionGrant.mcp_tools);
            ctx.networkApproved = manifest.permissions?.network === true && permissionGrant.network === true;
            ctx.memoryApproved = manifest.context_mode === 'inherit' && permissionGrant.memory === true;
            this.recordAudit(ctx, 'permission-request', JSON.stringify({
              read: manifest.permissions?.vfs_read || [],
              write: manifest.permissions?.vfs_write || [],
              network: manifest.permissions?.network === true,
              tools: manifest.tools?.system || [],
              mcp: manifest.tools?.mcp || [],
              memory: manifest.context_mode === 'inherit',
            }));
            this.recordAudit(ctx, 'permission-approved', JSON.stringify({
              read: ctx.approvedReadScopes,
              write: ctx.approvedWriteScopes,
              network: ctx.networkApproved,
              tools: ctx.approvedSystemTools,
              mcp: ctx.approvedMcpTools,
              memory: ctx.memoryApproved,
            }));
            this.appendLog(ctx, currentState, `Caller-approved permissions: ${JSON.stringify({
              read: ctx.approvedReadScopes,
              write: ctx.approvedWriteScopes,
              tools: ctx.approvedSystemTools,
              mcp: ctx.approvedMcpTools,
              network: ctx.networkApproved,
              memory: ctx.memoryApproved,
            }).slice(0, 800)}`);
            for (const scope of ctx.approvedReadScopes) {
              globalCapabilityManager.grantCapability(pid, 'CAP_VFS_READ', scope);
            }
            for (const scope of ctx.approvedWriteScopes) {
              globalCapabilityManager.grantCapability(pid, 'CAP_VFS_WRITE', scope);
            }
            if (ctx.networkApproved) {
              globalCapabilityManager.grantCapability(pid, 'CAP_NET_ADMIN', '*');
            }
            globalCapabilityManager.grantCapability(pid, 'CAP_VFS_READ', scratchpadDir);
            globalCapabilityManager.grantCapability(pid, 'CAP_VFS_WRITE', scratchpadDir);
            for (const token of globalCapabilityManager.getCapabilityTokens(pid)) {
              this.recordAudit(ctx, 'capability-granted', `${token.type} ${token.resourceTarget}`);
            }
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

            // 2. System tools are opt-in. A missing or empty allowlist grants no
            // external command authority; only the harmless builtins remain.
            const systemTools = [...new Set([...SAFE_HARNESS_BUILTINS, ...ctx.approvedSystemTools])].join(', ');

            // 3. Discover and filter MCP Tools
            let mcpToolsDesc = '';
            try {
              const allMcpTools = await this.waitUntilDeadline(globalMcpClientManager.listTools(), ctx);
              const filteredMcp = ctx.networkApproved
                ? allMcpTools.filter((t) => ctx.approvedMcpTools.includes(t.serverName) || ctx.approvedMcpTools.includes(`${t.serverName}/${t.name}`))
                : [];
              mcpToolsDesc = filteredMcp.map((t) => `${t.serverName}/${t.name} (${t.description})`).join(', ');
            } catch (e) {}

            // 4. Resolve References
            let referencesText = '';
            if (manifest.references && manifest.references.length > 0) {
              const refSnippets: string[] = [];
              let referenceDenied = false;
              for (const refPath of manifest.references) {
                const user = execCtx.env['USER'] || 'hello';
                if (typeof refPath !== 'string' || !ctx.approvedReadScopes.some(scope =>
                  pathInPermissionScope(execCtx.vfs, refPath, scope, execCtx),
                )) {
                  ctx.lastErrorOutput = `Reference denied: '${String(refPath)}' is outside the caller-approved read scopes.`;
                  this.appendLog(ctx, HarnessState.ERROR, ctx.lastErrorOutput, '31');
                  referenceDenied = true;
                  break;
                }
                const refContent = execCtx.vfs.readFile(refPath, execCtx.env['USER'] || 'hello');
                if (refContent) {
                  refSnippets.push(`--- Reference: ${refPath} ---\n${refContent.trim()}`);
                }
              }
              if (referenceDenied) {
                currentState = HarnessState.ERROR;
                break;
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
            const mayInheritMemory = ctx.memoryApproved;
            if (manifest.context_mode === 'inherit' && !ctx.memoryApproved) {
              this.recordAudit(ctx, 'permission-denied', 'private memory inheritance was requested but not approved');
            }
            const userProfileText = mayInheritMemory
              ? globalAgentMemoryManager.loadUserProfile(
                  execCtx.vfs,
                  execCtx.env['USER'] || 'hello',
                  execCtx.env['HOME'] || '/home/hello'
                )
              : '';
            const lessonsLearnedText = mayInheritMemory
              ? globalAgentMemoryManager.loadLessonsLearned(execCtx.vfs, execCtx.env['USER'] || 'hello')
              : '';

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
              const res = await this.waitUntilDeadline(
                globalIPCBus.sendIPC(globalIPCBus.getProcessEndpoint(ctx.pid), 'driverd', 'DEV_WRITE_AI', { prompt: promptContext, signal: ctx.abortController.signal }),
                ctx,
              );
              if (res?.success === false || res?.transport === 'remote-fallback') {
                throw new Error(res?.error || 'Remote AI inference failed; refusing to treat fallback output as a successful Skill response.');
              }
              const aiResponse = res.response ?? res.data ?? '';
              if (typeof aiResponse !== 'string') {
                throw new Error('AI response must be text; refusing to execute an invalid response.');
              }
              if (aiResponse.length > MAX_SKILL_RESPONSE_CHARS) {
                throw new Error(`AI response exceeded the Skill limit of ${MAX_SKILL_RESPONSE_CHARS} characters.`);
              }
              this.recordAudit(ctx, 'llm-inference', `transport=${res.transport || 'unspecified'}`);
              
              ctx.conversationHistory.push(`AI Response:\n${aiResponse}`);
              currentState = HarnessState.ACT;
            } catch (e: any) {
              this.recordAudit(ctx, 'llm-failure', 'inference request failed');
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
            const effectiveManifest: ParsedSkill['manifest'] = {
              ...manifest!,
              permissions: {
                ...manifest!.permissions,
                vfs_read: ctx.approvedReadScopes,
                vfs_write: ctx.approvedWriteScopes,
                network: ctx.networkApproved,
              },
              tools: {
                ...manifest!.tools,
                system: ctx.approvedSystemTools,
                mcp: ctx.approvedMcpTools,
              },
            };
            
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
              if (block.type === 'json' && block.code.includes('"mcp"')) {
                if (cmdExecutionCounter >= MAX_SKILL_ACTIONS) {
                  throw new Error(`Skill exceeded its limit of ${MAX_SKILL_ACTIONS} command/MCP actions.`);
                }
                cmdExecutionCounter++;
                try {
                  const mcpObj = JSON.parse(block.code);
                  const [serverName, toolName] = (mcpObj.mcp || '').split('/');
                  
                  // Both the named tool and the network permission are required.
                  const fullMcpName = `${serverName}/${toolName}`;
                  const allowedMcp = ctx.approvedMcpTools;
                  if (!ctx.networkApproved || (!allowedMcp.includes(serverName) && !allowedMcp.includes(fullMcpName))) {
                    this.recordAudit(ctx, 'mcp-denied', fullMcpName || 'invalid-tool');
                    throw new Error(`Security Interception: MCP tool '${fullMcpName}' requires permissions.network: true and an explicit tools.mcp entry.`);
                  }

                  this.appendLog(ctx, currentState, `Invoking MCP Tool: ${mcpObj.mcp}`, '35');
                  this.recordAudit(ctx, 'mcp-call', fullMcpName);
                  const mcpResult = await this.waitUntilDeadline(
                    globalMcpClientManager.callTool(serverName, toolName || 'default', mcpObj.args || {}, ctx.abortController.signal),
                    ctx,
                  );
                  const rawMcpStr = JSON.stringify(mcpResult, null, 2) ?? String(mcpResult);
                  const boundedMcpOutput = boundSkillOutput(rawMcpStr);
                  if (boundedMcpOutput.truncated) this.recordAudit(ctx, 'output-truncated', `MCP result limited to ${MAX_SKILL_OUTPUT_CHARS} characters`);

                  // L0 Scratchpad: Write large outputs to disk if > 1200 chars
                  let displayedOut = boundedMcpOutput.text;
                  if (boundedMcpOutput.text.length > 1200) {
                    const rawPath = globalAgentMemoryManager.writeScratchpad(
                      execCtx.vfs,
                      ctx.pid,
                      `mcp_${cmdExecutionCounter}.json`,
                      boundedMcpOutput.text
                    );
                    displayedOut = `[MCP result (${boundedMcpOutput.text.length} chars) saved to ${rawPath}]\n${this.pruneOutputForContext(boundedMcpOutput.text)}`;
                  } else {
                    displayedOut = this.pruneOutputForContext(boundedMcpOutput.text);
                  }

                  this.appendLog(ctx, currentState, `[MCP Result]\n${displayedOut}`, '90');
                  this.recordAudit(ctx, 'mcp-result', `${fullMcpName} completed`);
                } catch (e: any) {
                  allSucceeded = false;
                  ctx.lastErrorOutput = `MCP Tool Execution Failed: ${e.message}`;
                  this.appendLog(ctx, currentState, ctx.lastErrorOutput, '31');
                  this.recordAudit(ctx, 'mcp-failure', 'MCP call failed');
                  break;
                }
              } else {
                // Process bash block line by line
                const lines = block.code.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
                
                for (const line of lines) {
                  if (cmdExecutionCounter >= MAX_SKILL_ACTIONS) {
                    throw new Error(`Skill exceeded its limit of ${MAX_SKILL_ACTIONS} command/MCP actions.`);
                  }
                  if (line.length > MAX_SKILL_COMMAND_CHARS) {
                    throw new Error(`Skill command exceeded the ${MAX_SKILL_COMMAND_CHARS}-character limit.`);
                  }
                  // Reject shell composition before checking authority for its one command.
                  const tokens = isSingleCommand(line) ? commandTokens(line) : null;
                  const rawCommand = tokens?.[0] || '';
                  const cmdBinary = rawCommand.split('/').pop() || '';
                  const declaredTools = ctx.approvedSystemTools;
                  if (!tokens || !cmdBinary || (!SAFE_HARNESS_BUILTINS.includes(cmdBinary) && !declaredTools.includes(cmdBinary))) {
                    allSucceeded = false;
                    ctx.lastErrorOutput = !tokens
                      ? 'Security Interception: shell operators, redirection, and command substitution are not allowed in Skill command blocks.'
                      : `Security Interception: Command '${cmdBinary || line}' is not explicitly permitted by skill tools.system.`;
                    this.appendLog(ctx, currentState, ctx.lastErrorOutput, '31');
                    this.recordAudit(ctx, 'command-denied', cmdBinary || 'invalid-command');
                    break;
                  }
                  const permissionError = commandPermissionError(tokens, effectiveManifest, execCtx, ctx.scratchpadDir);
                  if (permissionError) {
                    allSucceeded = false;
                    ctx.lastErrorOutput = `Security Interception: ${permissionError}`;
                    this.appendLog(ctx, currentState, ctx.lastErrorOutput, '31');
                    this.recordAudit(ctx, 'command-denied', `${cmdBinary}: ${permissionError}`);
                    break;
                  }

                  cmdExecutionCounter++;
                  this.appendLog(ctx, currentState, `Executing command: ${line}`, '90');
                  this.recordAudit(ctx, 'command-start', cmdBinary);
                  // Skill inputs are prompt data, not shell positional parameters.
                  // Passing them here would allow a value to alter shell syntax after
                  // the command-line preflight above.
                  const res = await this.waitUntilDeadline(
                    skillShell.execute(line, [], undefined, { skipAliasExpansion: true }),
                    ctx,
                  );
                  this.recordAudit(ctx, res.exitCode === 0 ? 'command-success' : 'command-failure', `${cmdBinary} exit=${res.exitCode}`);
                  const stdout = boundSkillOutput(res.stdout);
                  const stderr = boundSkillOutput(res.stderr);
                  if (stdout.truncated || stderr.truncated) {
                    this.recordAudit(ctx, 'output-truncated', `${cmdBinary} output limited to ${MAX_SKILL_OUTPUT_CHARS} characters per stream`);
                  }
                  
                  if (stdout.text) {
                    let displayedOut = stdout.text.trim();
                    // L0 Scratchpad: Write large outputs to disk if > 1200 chars
                    if (stdout.text.length > 1200) {
                      const rawPath = globalAgentMemoryManager.writeScratchpad(
                        execCtx.vfs,
                        ctx.pid,
                        `stdout_${cmdExecutionCounter}.raw`,
                        stdout.text
                      );
                      displayedOut = `[Output (${stdout.text.length} chars) saved to ${rawPath}]\n${this.pruneOutputForContext(displayedOut)}`;
                    } else {
                      displayedOut = this.pruneOutputForContext(displayedOut);
                    }
                    this.appendLog(ctx, currentState, `[stdout]\n${displayedOut}`, '90');
                  }

                  if (stderr.text) {
                    const prunedErr = this.pruneOutputForContext(stderr.text.trim());
                    this.appendLog(ctx, currentState, `[stderr]\n${prunedErr}`, '31');
                  }
                  
                  if (res.exitCode !== 0) {
                    allSucceeded = false;
                    ctx.lastErrorOutput = stderr.text || `Command '${line}' failed with exitCode ${res.exitCode}`;
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
    } catch (error: any) {
      ctx.lastErrorOutput = error?.message || String(error);
      currentState = HarnessState.ERROR;
      this.appendLog(ctx, HarnessState.ERROR, ctx.lastErrorOutput, '31');
    } finally {
      execCtx.abortSignal?.removeEventListener('abort', abortFromCaller);
      abortController.abort(new Error('Skill process exited'));
      const effectiveCapabilities = globalCapabilityManager.getCapabilityTokens(ctx.pid)
        .map(({ type, resourceTarget }) => ({ type, scope: resourceTarget }));
      try {
        if (currentState === HarnessState.SUCCESS && ctx.hadReflexion && ctx.parsedSkill) {
          globalAgentMemoryManager.recordLesson(
            execCtx.vfs,
            ctx.parsedSkill.manifest.name,
            ctx.initialErrorSnippet,
            'Adjusted command arguments/syntax in subsequent reflexion turn.',
            execCtx.env['USER'] || 'hello'
          );
        }
      } catch (error) {
        console.error('[Harness] Failed to persist Skill lesson:', error);
      }
      try {
        globalAgentMemoryManager.cleanupScratchpad(execCtx.vfs, ctx.pid);
      } catch (error) {
        console.error(`[Harness] Failed to clean scratchpad for PID ${ctx.pid}:`, error);
      } finally {
        try {
          globalCapabilityManager.clearCapabilities(ctx.pid);
        } finally {
          try {
            globalTaskScheduler.terminateProcess(ctx.pid);
          } finally {
            this.recordAudit(ctx, 'capabilities-revoked', `PID ${ctx.pid}`);
            try {
              globalAgentMemoryManager.appendSessionAudit(execCtx.vfs, {
                timestamp: new Date().toISOString(),
                sessionId: ctx.sessionId,
                pid: ctx.pid,
                skillName: ctx.parsedSkill?.manifest.name || 'unparsed',
                status: currentState === HarnessState.SUCCESS ? 'SUCCESS' : 'ERROR',
                turns: ctx.retries + 1,
                error: currentState === HarnessState.ERROR ? ctx.lastErrorOutput : undefined,
                capabilities: effectiveCapabilities,
                events: [...ctx.auditEvents],
              });
            } catch (error) {
              console.error('[Harness] Failed to persist Skill audit record:', error);
            }
          }
        }
      }
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
