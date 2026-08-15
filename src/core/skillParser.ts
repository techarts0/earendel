import { VirtualFileSystem, VFS } from './vfs';

export interface SkillInputDef {
  type?: 'string' | 'number' | 'boolean' | 'array';
  description?: string;
  required?: boolean;
  default?: any;
}

export interface SkillToolDef {
  system?: string[];
  mcp?: string[];
  skills?: string[];
}

export interface SkillPermissionsDef {
  vfs_read?: string[];
  vfs_write?: string[];
  network?: boolean;
}

export interface SkillManifest {
  name: string;
  version?: string;
  description?: string;
  author?: string;
  inputs?: Record<string, SkillInputDef>;
  tools?: SkillToolDef;
  permissions?: SkillPermissionsDef;
  timeout?: string | number; // e.g. "60s", 60000
  max_turns?: number;
  constraints?: string[];
  references?: string[];
  context_mode?: 'ephemeral' | 'inherit';
  [key: string]: any;
}

export interface ParsedSkill {
  manifest: SkillManifest;
  body: string;
  raw: string;
  resolvedPath?: string;
}

/**
 * Parses scalar YAML values (strips quotes, converts numbers, booleans, null, and inline json).
 */
export function parseScalar(val: string): any {
  val = val.trim();
  if (!val) return '';
  // Strip double or single quotes
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (val === 'null' || val === '~') return null;
  if (!isNaN(Number(val)) && val !== '') return Number(val);

  // Inline JSON array or object
  if ((val.startsWith('[') && val.endsWith(']')) || (val.startsWith('{') && val.endsWith('}'))) {
    try {
      return JSON.parse(val);
    } catch {
      if (val.startsWith('[') && val.endsWith(']')) {
        return val
          .slice(1, -1)
          .split(',')
          .map((s) => parseScalar(s.trim()));
      }
    }
  }
  return val;
}

/**
 * Robust, zero-dependency, stack-based YAML Frontmatter parser.
 * Accurately handles multi-level nested dictionaries (e.g. inputs -> scope -> type),
 * arrays (inline & block - item), comments, and indented lists.
 */
export function parseYamlFrontmatter(yamlStr: string): Record<string, any> {
  const root: Record<string, any> = {};
  const lines = yamlStr.split(/\r?\n/);

  // Stack frame maintains: { indent: number, container: Object | Array, key?: string }
  interface StackFrame {
    indent: number;
    container: any;
    key?: string;
  }

  const stack: StackFrame[] = [{ indent: -1, container: root }];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const indent = rawLine.search(/\S/);

    // Pop stack frames that have an indentation greater than or equal to current line
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const top = stack[stack.length - 1];

    // Case 1: List item (e.g. "- item" or "- key: val")
    if (trimmed.startsWith('- ')) {
      const itemContent = trimmed.substring(2).trim();

      // Ensure the parent container has an array ready
      if (top.key && typeof top.container[top.key] !== 'object') {
        top.container[top.key] = [];
      } else if (top.key && !Array.isArray(top.container[top.key])) {
        // Convert empty object placeholder to array if needed
        if (Object.keys(top.container[top.key]).length === 0) {
          top.container[top.key] = [];
        }
      }

      const targetArray = top.key ? top.container[top.key] : top.container;

      if (itemContent.includes(':') && !itemContent.startsWith('{')) {
        // List item with object (e.g. "- name: foo")
        const colonIdx = itemContent.indexOf(':');
        const k = itemContent.substring(0, colonIdx).trim();
        const vStr = itemContent.substring(colonIdx + 1).trim();
        const obj: Record<string, any> = {};
        obj[k] = parseScalar(vStr);
        if (Array.isArray(targetArray)) {
          targetArray.push(obj);
        }
        stack.push({ indent, container: obj });
      } else {
        // Simple scalar item
        if (Array.isArray(targetArray)) {
          targetArray.push(parseScalar(itemContent));
        }
      }
      continue;
    }

    // Case 2: Key-value pair (e.g. "key: value" or "key:")
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx !== -1) {
      const key = trimmed.substring(0, colonIdx).trim();
      const valStr = trimmed.substring(colonIdx + 1).trim();

      if (valStr === '') {
        // New dictionary or array container starts here
        const newContainer: Record<string, any> = {};
        if (Array.isArray(top.container)) {
          top.container.push({ [key]: newContainer });
        } else {
          top.container[key] = newContainer;
        }
        stack.push({ indent, container: top.container, key });
      } else {
        // Value present
        const parsedVal = parseScalar(valStr);
        if (Array.isArray(top.container)) {
          top.container.push({ [key]: parsedVal });
        } else {
          top.container[key] = parsedVal;
        }
      }
    }
  }

  return root;
}

/**
 * Split skill Markdown content into Frontmatter and Body.
 */
export function parseSkillContent(rawContent: string): ParsedSkill {
  const trimmed = rawContent.trim();

  if (!trimmed.startsWith('---')) {
    throw new Error(
      'Invalid Skill format: Skill file must start with "---" YAML Frontmatter.'
    );
  }

  const secondDelimiter = trimmed.indexOf('\n---', 3);
  if (secondDelimiter === -1) {
    throw new Error(
      'Invalid Skill format: Missing closing "---" delimiter for YAML Frontmatter.'
    );
  }

  const yamlSection = trimmed.substring(3, secondDelimiter).trim();
  const bodySection = trimmed.substring(secondDelimiter + 4).trim();

  const manifestData = parseYamlFrontmatter(yamlSection);

  if (!manifestData.name) {
    throw new Error('Invalid Skill format: Manifest must contain a "name" field.');
  }

  const manifest: SkillManifest = {
    name: String(manifestData.name),
    version: manifestData.version ? String(manifestData.version) : '1.0.0',
    description: manifestData.description ? String(manifestData.description) : '',
    author: manifestData.author ? String(manifestData.author) : '',
    inputs: manifestData.inputs || {},
    tools: manifestData.tools || {},
    permissions: manifestData.permissions || {},
    timeout: manifestData.timeout ?? '60s',
    max_turns: manifestData.max_turns ? Number(manifestData.max_turns) : 5,
    constraints: Array.isArray(manifestData.constraints) ? manifestData.constraints : [],
    references: Array.isArray(manifestData.references) ? manifestData.references : [],
    context_mode: manifestData.context_mode || 'ephemeral',
  };

  return {
    manifest,
    body: bodySection,
    raw: rawContent,
  };
}

/**
 * Resolve target path to a skill content string.
 * Supports:
 * - /path/to/skill.md (single file)
 * - /path/to/skill_dir (locates skill_dir/skill.md or skill_dir/SKILL.md)
 */
export function resolveSkillTarget(
  vfs: VFS,
  targetPath: string,
  user: string = 'hello'
): { path: string; content: string } {
  let node = vfs.getNodeByPath(targetPath);

  if (!node) {
    throw new Error(`Skill target '${targetPath}' not found in VFS.`);
  }

  if (node.type === 'directory') {
    // Check for skill.md or SKILL.md
    const candidates = ['skill.md', 'SKILL.md'];
    for (const cand of candidates) {
      const candPath = `${targetPath.replace(/\/+$/, '')}/${cand}`;
      const candNode = vfs.getNodeByPath(candPath);
      if (candNode && candNode.type === 'file') {
        const content = vfs.readFile(candPath, user) || '';
        return { path: candPath, content };
      }
    }
    throw new Error(
      `Directory '${targetPath}' does not contain an entrypoint 'skill.md' (or 'SKILL.md').`
    );
  }

  if (node.type === 'file') {
    const content = vfs.readFile(targetPath, user) || '';
    return { path: targetPath, content };
  }

  throw new Error(`'${targetPath}' is neither a regular file nor a directory.`);
}

/**
 * Validates provided CLI or invocation arguments against the Skill Manifest input schema.
 * Returns a normalized key-value dictionary with defaults applied.
 */
export function validateSkillInputs(
  manifest: SkillManifest,
  providedArgs: Record<string, any>
): { valid: boolean; errors: string[]; parsedInputs: Record<string, any> } {
  const errors: string[] = [];
  const parsedInputs: Record<string, any> = {};
  const schema = manifest.inputs || {};

  for (const [key, def] of Object.entries(schema)) {
    const isProvided = key in providedArgs && providedArgs[key] !== undefined && providedArgs[key] !== '';

    if (!isProvided) {
      if (def.required) {
        errors.push(`Missing required input parameter: '--${key}' (${def.description || 'no description'})`);
      } else if (def.default !== undefined) {
        parsedInputs[key] = def.default;
      }
    } else {
      let val = providedArgs[key];
      // Type coercion
      if (def.type === 'boolean' && typeof val !== 'boolean') {
        val = val === 'true' || val === true || val === '1';
      } else if (def.type === 'number' && typeof val !== 'number') {
        const n = Number(val);
        if (isNaN(n)) {
          errors.push(`Input parameter '--${key}' must be a number (received: '${val}')`);
        } else {
          val = n;
        }
      }
      parsedInputs[key] = val;
    }
  }

  // Include any extra passed arguments not in schema
  for (const [k, v] of Object.entries(providedArgs)) {
    if (!(k in parsedInputs)) {
      parsedInputs[k] = v;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    parsedInputs,
  };
}

/**
 * Parses timeout expression (e.g. "30s", "2m", 60000) into milliseconds.
 */
export function parseTimeoutMs(timeoutVal: string | number | undefined, defaultMs = 60000): number {
  if (typeof timeoutVal === 'number') return timeoutVal;
  if (!timeoutVal) return defaultMs;

  const str = String(timeoutVal).trim().toLowerCase();
  if (str.endsWith('ms')) {
    return parseInt(str, 10) || defaultMs;
  }
  if (str.endsWith('s')) {
    return (parseFloat(str) || 60) * 1000;
  }
  if (str.endsWith('m')) {
    return (parseFloat(str) || 1) * 60 * 1000;
  }
  const num = Number(str);
  return isNaN(num) ? defaultMs : num;
}
