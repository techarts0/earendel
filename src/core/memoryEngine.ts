import { globalVFS, VFS } from './vfs';

const MAX_AGENT_MEMORY_CONTEXT_CHARS = 12_000;
const MAX_SESSION_AUDIT_FILE_BYTES = 512 * 1024;
const MAX_SESSION_AUDIT_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_SESSION_AUDIT_FILES = 2048;

function boundAgentMemoryContext(content: string): string {
  return content.length > MAX_AGENT_MEMORY_CONTEXT_CHARS
    ? `${content.slice(0, MAX_AGENT_MEMORY_CONTEXT_CHARS)}\n[Agent memory truncated for context limit]`
    : content;
}

export interface UserAgentProfile {
  language?: string;
  code_style?: string;
  guidelines?: string[];
  custom_preferences?: string;
}

export interface SessionAuditRecord {
  timestamp: string;
  sessionId: string;
  pid: number;
  skillName: string;
  status: 'SUCCESS' | 'ERROR';
  turns: number;
  error?: string;
  capabilities?: Array<{ type: string; scope: string }>;
  events?: Array<{ at: string; action: string; detail: string }>;
  droppedEvents?: number;
}

export class AgentMemoryManager {
  private static instance: AgentMemoryManager;

  public static getInstance(): AgentMemoryManager {
    if (!AgentMemoryManager.instance) {
      AgentMemoryManager.instance = new AgentMemoryManager();
    }
    return AgentMemoryManager.instance;
  }

  // =========================================================================
  // L0: Scratchpad (Sensory / Ephemeral Output Buffers)
  // =========================================================================

  /**
   * Allocates an isolated scratchpad directory in VFS for the given execution PID.
   */
  public allocateScratchpad(vfs: VFS, pid: number): string {
    const scratchDir = `/tmp/agent/${pid}`;
    try {
      vfs.mkdir(scratchDir, true);
    } catch {}
    return scratchDir;
  }

  /**
   * Writes raw or large output to the scratchpad file, returning the absolute VFS path.
   */
  public writeScratchpad(vfs: VFS, pid: number, filename: string, content: string): string | null {
    const filePath = `/tmp/agent/${pid}/${filename}`;
    try {
      if (!vfs.mkdir(`/tmp/agent/${pid}`, true) && !vfs.exists(`/tmp/agent/${pid}`)) return null;
      if (!vfs.writeFile(filePath, content)) return null;
      return vfs.readFile(filePath) === content ? filePath : null;
    } catch {
      return null;
    }
  }

  /**
   * Cleans up the scratchpad directory after skill execution terminates.
   */
  public cleanupScratchpad(vfs: VFS, pid: number): void {
    const scratchDir = `/tmp/agent/${pid}`;
    try {
      const node = vfs.getNodeByPath(scratchDir);
      if (node) {
        vfs.remove(scratchDir, true);
      }
    } catch {}
  }

  // =========================================================================
  // L1: Working Memory & Dynamic Action Rollup Compaction
  // =========================================================================

  /**
   * Condenses multi-turn conversation history to prevent Context Window overflow.
   * Compresses older turns into concise summary bullets while retaining the latest raw turns.
   */
  public condenseHistory(history: string[], keepRecent: number = 2): string {
    if (history.length <= keepRecent + 1) {
      return history.join('\n\n');
    }

    const sysPrompt = history[0];
    const olderTurns = history.slice(1, -keepRecent);
    const recentTurns = history.slice(-keepRecent);

    const summaryBullets: string[] = [];
    olderTurns.forEach((turn, idx) => {
      const actions: string[] = [];
      
      // Match bash code blocks in turn
      const bashRegex = /```(?:bash|sh|shell)?\r?\n([\s\S]*?)```/gi;
      let match;
      while ((match = bashRegex.exec(turn)) !== null) {
        const lines = match[1]
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#'));
        lines.forEach((l) => actions.push(`cmd: "${l}"`));
      }

      // Match JSON MCP blocks in turn
      const jsonRegex = /```json\r?\n([\s\S]*?)```/gi;
      while ((match = jsonRegex.exec(turn)) !== null) {
        try {
          const parsed = JSON.parse(match[1]);
          if (parsed.mcp) {
            actions.push(`mcp: "${parsed.mcp}"`);
          }
        } catch {}
      }

      if (actions.length > 0) {
        summaryBullets.push(`- Turn ${idx + 1}: Executed [${actions.join(', ')}]`);
      } else if (turn.includes('REFLEXION') || turn.includes('System: Execution encountered an error')) {
        summaryBullets.push(`- Turn ${idx + 1}: Reflexion triggered to adjust command approach`);
      } else {
        const snippet = turn.slice(0, 100).replace(/\s+/g, ' ');
        summaryBullets.push(`- Turn ${idx + 1}: ${snippet}...`);
      }
    });

    const condensedBlock = `### [Prior Turns Condensed History (Action Rollup)]:\n${summaryBullets.join('\n')}`;
    return [sysPrompt, condensedBlock, ...recentTurns].join('\n\n');
  }

  // =========================================================================
  // L2: Episodic Session Audit Stream
  // =========================================================================

  /**
   * Records an audit entry in /var/log/harness/<sessionId>.jsonl
   */
  public async appendSessionAudit(_vfs: VFS, record: SessionAuditRecord): Promise<boolean> {
    try {
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(record.sessionId)) return false;
      // Audit persistence is a trusted service operation. The caller's VFS view
      // is intentionally read-only under /var and must not silently drop records.
      globalVFS.mkdir('/var/log/harness', true);
      globalVFS.chown('/var/log/harness', 'root:root', false, 'root');
      globalVFS.chmod('/var/log/harness', '700', false, 'root');
      const auditFile = `/var/log/harness/${record.sessionId}.jsonl`;
      const directory = globalVFS.getNodeByPath('/var/log/harness', 'root');
      if (!directory || directory.type !== 'directory' || !directory.children) return false;
      const files = [...directory.children.values()].filter((node) => node.type === 'file');
      const existingNode = directory.children.get(`${record.sessionId}.jsonl`);
      const existingFileBytes = existingNode?.type === 'file'
        ? new TextEncoder().encode(existingNode.content || '').byteLength
        : 0;
      const existing = globalVFS.readFile(auditFile, 'root') || '';
      const serializedRecord = JSON.stringify(record);
      if (typeof serializedRecord !== 'string') return false;
      const line = serializedRecord + '\n';
      const lineBytes = new TextEncoder().encode(line).byteLength;
      const nextFileBytes = existingFileBytes + lineBytes;
      const currentTotalBytes = files.reduce((total, node) =>
        total + new TextEncoder().encode(node.content || '').byteLength, 0);
      if (nextFileBytes > MAX_SESSION_AUDIT_FILE_BYTES ||
          (existingNode?.type !== 'file' && files.length >= MAX_SESSION_AUDIT_FILES) ||
          currentTotalBytes + lineBytes > MAX_SESSION_AUDIT_TOTAL_BYTES) return false;
      if (!globalVFS.writeFile(auditFile, existing + line, 'root')) return false;
      globalVFS.chown(auditFile, 'root:root', false, 'root');
      globalVFS.chmod(auditFile, '600', false, 'root');
      const node = globalVFS.getNodeByPath(auditFile);
      const verifiedInMemory = !!node && node.owner === 'root' && node.permissions === 'rw-------' &&
        globalVFS.readFile(auditFile, 'root') === existing + line;
      if (!verifiedInMemory) return false;
      return await globalVFS.persistPaths(['/var/log/harness', auditFile]);
    } catch {
      return false;
    }
  }

  // =========================================================================
  // L3: Semantic & Procedural Long-Term Memory (Profile & Lessons Learned)
  // =========================================================================

  /**
   * Loads user profile preferences from ~/.agent_profile or falls back to /etc/agent/default_profile.json
   */
  public loadUserProfile(vfs: VFS, user: string, home: string = '/home/hello'): string {
    let profileContent = '';
    const userProfilePath = `${home.replace(/\/+$/, '')}/.agent_profile`;

    const userProfileNode = vfs.getNodeByPath(userProfilePath);
    if (userProfileNode && userProfileNode.type === 'file') {
      profileContent = boundAgentMemoryContext(vfs.readFile(userProfilePath, user) || '');
    } else {
      const defaultNode = vfs.getNodeByPath('/etc/agent/default_profile.json');
      if (defaultNode && defaultNode.type === 'file') {
        profileContent = boundAgentMemoryContext(vfs.readFile('/etc/agent/default_profile.json', user) || '');
      }
    }

    if (!profileContent.trim()) {
      return '';
    }

    // Try parsing as JSON or keep as raw text
    try {
      const parsed: UserAgentProfile = JSON.parse(profileContent);
      const parts: string[] = [];
      if (parsed.language) parts.push(`Preferred Language: ${parsed.language}`);
      if (parsed.code_style) parts.push(`Code Style: ${parsed.code_style}`);
      if (parsed.guidelines && parsed.guidelines.length > 0) {
        parts.push(`Guidelines: ${parsed.guidelines.join('; ')}`);
      }
      if (parsed.custom_preferences) parts.push(`Custom Preferences: ${parsed.custom_preferences}`);
      return `\n\n### User Agent Profile (${userProfilePath}):\n${parts.map((p) => `- ${p}`).join('\n')}`;
    } catch {
      return `\n\n### User Agent Profile (${userProfilePath}):\n${profileContent.trim()}`;
    }
  }

  /**
   * Loads cumulative lessons learned / best practices from /var/lib/harness/memory/lessons.md
   */
  public loadLessonsLearned(vfs: VFS, user: string = 'hello'): string {
    const lessonsPath = '/var/lib/harness/memory/lessons.md';
    const node = vfs.getNodeByPath(lessonsPath);
    if (!node || node.type !== 'file') {
      return '';
    }
    const content = boundAgentMemoryContext(vfs.readFile(lessonsPath, user) || '');
    if (!content.trim()) return '';
    return `\n\n### System Procedural Memory & Lessons Learned:\n${content.trim()}`;
  }

  /**
   * Distills and persists a learned rule into lessons.md after successful error recovery.
   */
  public recordLesson(
    vfs: VFS,
    skillName: string,
    errorSnippet: string,
    fixSummary: string,
    user: string = 'hello'
  ): void {
    const lessonsDir = '/var/lib/harness/memory';
    const lessonsPath = `${lessonsDir}/lessons.md`;
    try {
      vfs.mkdir(lessonsDir, true);
      const existing = vfs.readFile(lessonsPath, user) || '# Earendel Agentic OS Lessons Learned Knowledge Base\n\n';
      const cleanError = errorSnippet.split('\n')[0].substring(0, 120);
      const dateStr = new Date().toISOString().split('T')[0];
      const entry = `\n- **[${dateStr} | Skill: ${skillName}]**: When encountering \`${cleanError}\`, fix: ${fixSummary}`;
      vfs.writeFile(lessonsPath, existing + entry);
    } catch {}
  }
}

export const globalAgentMemoryManager = AgentMemoryManager.getInstance();
