// Shell AST Definitions and Parser for Earendel Shell Engine

export type ASTNode =
  | CommandNode
  | IfNode
  | WhileNode
  | ForNode
  | ArithmeticForNode
  | CaseNode
  | FunctionDefNode
  | BreakNode
  | ContinueNode
  | ReturnNode;

export interface CommandNode {
  type: 'COMMAND';
  line: string;
}

export interface IfNode {
  type: 'IF';
  condition: string;
  thenBranch: ASTNode[];
  elseBranch: ASTNode[];
}

export interface WhileNode {
  type: 'WHILE';
  condition: string;
  body: ASTNode[];
}

export interface ForNode {
  type: 'FOR';
  variable: string;
  items: string[];
  body: ASTNode[];
}

export interface ArithmeticForNode {
  type: 'ARITHMETIC_FOR';
  init: string;
  condition: string;
  update: string;
  body: ASTNode[];
}

export interface CaseBranch {
  patterns: string[];
  isDefault?: boolean;
  body: ASTNode[];
}

export interface CaseNode {
  type: 'CASE';
  expression: string;
  branches: CaseBranch[];
}

export interface FunctionDefNode {
  type: 'FUNCTION_DEF';
  name: string;
  body: ASTNode[];
}

export interface BreakNode {
  type: 'BREAK';
  count: number;
}

export interface ContinueNode {
  type: 'CONTINUE';
  count: number;
}

export interface ReturnNode {
  type: 'RETURN';
  code: string;
}

export type FlowSignal =
  | { type: 'NONE' }
  | { type: 'BREAK'; count: number }
  | { type: 'CONTINUE'; count: number }
  | { type: 'RETURN'; exitCode: number };

/**
 * Split shell script source into logical statements/tokens.
 * Respects quotes, subshells, case terminators (;;), and curly braces.
 */
export function splitStatements(script: string): string[] {
  const statements: string[] = [];
  let current = '';

  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inComment = false;
  let parenDepth = 0;
  let braceDepth = 0;

  let i = 0;
  while (i < script.length) {
    const char = script[i];
    const nextChar = script[i + 1] || '';

    // Handle comments
    if (inComment) {
      if (char === '\n') {
        inComment = false;
      }
      i++;
      continue;
    }

    // In shell, # starts a comment only at the beginning of a word. Keep
    // parameter operators such as ${#name} and ${value#pattern} intact.
    if (!inSingleQuote && !inDoubleQuote && char === '#' &&
        (i === 0 || /[\s;|&()]/.test(script[i - 1]))) {
      inComment = true;
      i++;
      continue;
    }

    // Handle quotes
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
      i++;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      if (script[i - 1] !== '\\') {
        inDoubleQuote = !inDoubleQuote;
      }
      current += char;
      i++;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      current += char;
      i++;
      continue;
    }

    // Parentheses & Braces tracking
    if (char === '(') parenDepth++;
    if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
    if (char === '{') braceDepth++;
    if (char === '}') braceDepth = Math.max(0, braceDepth - 1);

    // Case branch delimiter: ;;
    if (char === ';' && nextChar === ';') {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      statements.push(';;');
      current = '';
      i += 2;
      continue;
    }

    // Statement terminators: newline or semicolon (when outside subshells and parens)
    if (parenDepth === 0 && (char === '\n' || char === ';')) {
      const trimmed = current.trim();
      if (trimmed) {
        statements.push(trimmed);
      }
      current = '';
      i++;
      continue;
    }

    current += char;
    i++;
  }

  const trimmed = current.trim();
  if (trimmed) {
    statements.push(trimmed);
  }

  // Second pass: separate structural keywords attached on same statement like:
  // "check_zero(){" -> ["check_zero()", "{"]
  // "case $x in" is kept as is
  // "while true do" -> ["while true", "do"]
  const normalized: string[] = [];
  for (const stmt of statements) {
    // Function definition like "func(){" or "func() {"
    const funcWithBrace = stmt.match(/^(?:function\s+)?(\w+)\s*\(\)\s*\{$/);
    if (funcWithBrace) {
      normalized.push(`${funcWithBrace[1]}()`);
      normalized.push('{');
      continue;
    }

    // Function definition ending with brace and content "func() { cmd"
    const funcWithInline = stmt.match(/^(?:function\s+)?(\w+)\s*\(\)\s*\{\s*(.+)$/);
    if (funcWithInline) {
      normalized.push(`${funcWithInline[1]}()`);
      normalized.push('{');
      normalized.push(funcWithInline[2].trim());
      continue;
    }

    // "while ... do"
    if (stmt.startsWith('while ') && stmt.endsWith(' do')) {
      normalized.push(stmt.slice(0, -3).trim());
      normalized.push('do');
      continue;
    }

    // "for ... do"
    if (stmt.startsWith('for ') && stmt.endsWith(' do')) {
      normalized.push(stmt.slice(0, -3).trim());
      normalized.push('do');
      continue;
    }

    // "if ... then"
    if (stmt.startsWith('if ') && stmt.endsWith(' then')) {
      normalized.push(stmt.slice(0, -5).trim());
      normalized.push('then');
      continue;
    }

    // "elif ... then"
    if (stmt.startsWith('elif ') && stmt.endsWith(' then')) {
      normalized.push(stmt.slice(0, -5).trim());
      normalized.push('then');
      continue;
    }

    // Closing brace "}" attached to command e.g. "return 0 }"
    if (stmt.endsWith(' }') && stmt.length > 2) {
      normalized.push(stmt.slice(0, -2).trim());
      normalized.push('}');
      continue;
    }

    normalized.push(stmt);
  }

  return normalized;
}

function splitShellWords(text: string): string[] {
  const words: string[] = [];
  let start = -1;
  let quote: 'single' | 'double' | null = null;
  let escaped = false;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (start < 0 && !/\s/.test(ch)) start = i;
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && quote !== 'single') { escaped = true; continue; }
    if (quote === 'single') { if (ch === "'") quote = null; continue; }
    if (quote === 'double') { if (ch === '"') quote = null; continue; }
    if (ch === "'") { quote = 'single'; continue; }
    if (ch === '"') { quote = 'double'; continue; }
    if (ch === '(') { depth++; continue; }
    if (ch === ')') { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0 && /\s/.test(ch) && start >= 0) {
      words.push(text.slice(start, i));
      start = -1;
    }
  }
  if (start >= 0) words.push(text.slice(start));
  return words;
}

class StatementStream {
  private statements: string[];
  private index: number = 0;

  constructor(statements: string[]) {
    this.statements = statements;
  }

  public hasNext(): boolean {
    return this.index < this.statements.length;
  }

  public peek(): string | null {
    return this.hasNext() ? this.statements[this.index] : null;
  }

  public next(): string {
    if (!this.hasNext()) throw new Error('Unexpected end of statement stream');
    return this.statements[this.index++];
  }
}

/**
 * Recursive descent parser for shell script statements.
 */
export function parseStatements(stream: StatementStream, stopWords: string[] = []): ASTNode[] {
  const nodes: ASTNode[] = [];

  while (stream.hasNext()) {
    const current = stream.peek();
    if (!current) break;

    // Check if current statement matches any stopWords (e.g. fi, done, else, elif, esac, ;;)
    if (stopWords.some((sw) => current === sw || current.startsWith(`${sw} `))) {
      break;
    }

    // 1. Function definition: "name()" or "function name" or "name ()"
    const funcMatch = current.match(/^(\w+)\s*\(\)$/) || current.match(/^function\s+(\w+)(?:\s*\(\))?$/);
    if (funcMatch) {
      const funcName = funcMatch[1];
      stream.next(); // consume function signature

      if (stream.peek() === '{') {
        stream.next(); // consume '{'
      }

      const body = parseStatements(stream, ['}']);
      if (stream.peek() === '}') {
        stream.next(); // consume '}'
      }

      nodes.push({
        type: 'FUNCTION_DEF',
        name: funcName,
        body,
      });
      continue;
    }

    // 2. If statement: "if <cond>"
    if (current.startsWith('if ')) {
      const ifStmt = stream.next();
      const condition = ifStmt.substring(3).trim();

      if (stream.peek() === 'then') {
        stream.next();
      }

      const thenBranch = parseStatements(stream, ['elif', 'else', 'fi']);
      let elseBranch: ASTNode[] = [];

      while (stream.peek()?.startsWith('elif ') || stream.peek() === 'elif') {
        const elifStmt = stream.next();
        let elifCond = '';
        if (elifStmt.startsWith('elif ')) {
          elifCond = elifStmt.substring(5).trim();
        } else if (stream.hasNext()) {
          elifCond = stream.next().trim();
        }

        if (stream.peek() === 'then') {
          stream.next();
        }

        const elifThen = parseStatements(stream, ['elif', 'else', 'fi']);
        elseBranch = [
          {
            type: 'IF',
            condition: elifCond,
            thenBranch: elifThen,
            elseBranch,
          },
        ];
      }

      if (stream.peek() === 'else') {
        stream.next();
        elseBranch = parseStatements(stream, ['fi']);
      }

      if (stream.peek() === 'fi') {
        stream.next();
      }

      nodes.push({
        type: 'IF',
        condition,
        thenBranch,
        elseBranch,
      });
      continue;
    }

    // 3. While statement: "while <cond>"
    if (current.startsWith('while ') || current === 'while') {
      const whileStmt = stream.next();
      let condition = '';
      if (whileStmt.startsWith('while ')) {
        condition = whileStmt.substring(6).trim();
      } else if (stream.hasNext()) {
        condition = stream.next().trim();
      }

      if (stream.peek() === 'do') {
        stream.next();
      }

      const body = parseStatements(stream, ['done']);
      if (stream.peek() === 'done') {
        stream.next();
      }

      nodes.push({
        type: 'WHILE',
        condition,
        body,
      });
      continue;
    }

    // 4. For statement: "for <var> in <items...>"
    if (/^for\s*\(\(/.test(current)) {
      const forStmt = stream.next();
      const forMatch = forStmt.match(/^for\s*\(\((.*)\)\)$/);
      const parts = (forMatch?.[1] || '').split(';');
      const body = stream.peek() === 'do' ? (stream.next(), parseStatements(stream, ['done'])) : parseStatements(stream, ['done']);
      if (stream.peek() === 'done') stream.next();
      nodes.push({ type: 'ARITHMETIC_FOR', init: parts[0]?.trim() || '', condition: parts[1]?.trim() || '', update: parts.slice(2).join(';').trim(), body });
      continue;
    }

    if (current.startsWith('for ')) {
      const forStmt = stream.next();
      const forMatch = forStmt.match(/^for\s+(\w+)(?:\s+in\s+(.+))?$/);
      const varName = forMatch ? forMatch[1] : 'i';
      const itemsRaw = forMatch && forMatch[2] ? forMatch[2].trim() : '';
      const items = itemsRaw ? splitShellWords(itemsRaw) : [];

      if (stream.peek() === 'do') {
        stream.next();
      }

      const body = parseStatements(stream, ['done']);
      if (stream.peek() === 'done') {
        stream.next();
      }

      nodes.push({
        type: 'FOR',
        variable: varName,
        items,
        body,
      });
      continue;
    }

    // 5. Case statement: "case <expr> in"
    if (current.startsWith('case ') && current.endsWith(' in')) {
      const caseStmt = stream.next();
      const exprMatch = caseStmt.match(/^case\s+(.+)\s+in$/);
      const expression = exprMatch ? exprMatch[1].trim() : '';

      const branches: CaseBranch[] = [];

      while (stream.hasNext() && stream.peek() !== 'esac') {
        const item = stream.peek();
        if (!item) break;

        // Pattern matches: "'+')" or "'*')" or "foo | bar)"
        const patternMatch = item.match(/^\(?(.*?)\)$/);
        if (patternMatch) {
          stream.next(); // consume pattern line
          const patternRaw = patternMatch[1].trim();
          const isDefault = patternRaw === '*';
          const patterns = patternRaw
            .split('|')
            .map((p) => {
              const token = p.trim();
              const quoted = (token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"'));
              const value = token.replace(/^['"]|['"]$/g, '');
              return quoted ? value.replace(/[\\*?]/g, '\\$&') : value;
            })
            .filter(Boolean);

          const branchBody = parseStatements(stream, [';;', 'esac']);
          if (stream.peek() === ';;') {
            stream.next(); // consume ';;'
          }

          branches.push({
            patterns,
            isDefault,
            body: branchBody,
          });
          continue;
        }

        // Skip any unexpected tokens within case
        stream.next();
      }

      if (stream.peek() === 'esac') {
        stream.next();
      }

      nodes.push({
        type: 'CASE',
        expression,
        branches,
      });
      continue;
    }

    // 6. Break statement: "break" or "break 2"
    if (current === 'break' || current.startsWith('break ')) {
      const stmt = stream.next();
      const count = parseInt(stmt.split(/\s+/)[1] || '1', 10);
      nodes.push({
        type: 'BREAK',
        count: isNaN(count) ? 1 : count,
      });
      continue;
    }

    // 7. Continue statement: "continue" or "continue 2"
    if (current === 'continue' || current.startsWith('continue ')) {
      const stmt = stream.next();
      const count = parseInt(stmt.split(/\s+/)[1] || '1', 10);
      nodes.push({
        type: 'CONTINUE',
        count: isNaN(count) ? 1 : count,
      });
      continue;
    }

    // 8. Return statement: "return" or "return 0"
    if (current === 'return' || current.startsWith('return ')) {
      const stmt = stream.next();
      nodes.push({
        type: 'RETURN',
        code: stmt.slice('return'.length).trim() || '0',
      });
      continue;
    }

    // 9. Simple command
    const cmdLine = stream.next();
    nodes.push({
      type: 'COMMAND',
      line: cmdLine,
    });
  }

  return nodes;
}

/**
 * Top-level entry to parse full shell script into AST.
 */
export function parseShellScript(scriptText: string): ASTNode[] {
  scriptText = scriptText.replace(/^#![^\r\n]*(?:\r?\n|$)/, '');
  // Bash commonly uses `: <<MARKER ... MARKER` as a block comment.
  scriptText = scriptText.replace(/^[ \t]*:[ \t]*<<-?[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[^\r\n]*\r?\n[\s\S]*?^[ \t]*\2[ \t]*;?[ \t]*$/gm, '');
  const statements = splitStatements(scriptText);
  const stream = new StatementStream(statements);
  return parseStatements(stream);
}
