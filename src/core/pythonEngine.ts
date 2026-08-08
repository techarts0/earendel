// Earendel Micro Python 3 Evaluator Engine
export class PythonEngine {
  public executeScript(codeText: string, args: string[] = []): { stdout: string; stderr: string; exitCode: number } {
    let stdoutAcc = '';
    let stderrAcc = '';
    const lines = codeText.split('\n');

    const variables: Record<string, any> = {
      'sys.argv': ['script.py', ...args],
    };

    let i = 0;
    try {
      while (i < lines.length) {
        const line = lines[i].trim();

        if (!line || line.startsWith('#')) {
          i++;
          continue;
        }

        // 1. print(...) statement
        if (line.startsWith('print(') && line.endsWith(')')) {
          const content = line.substring(6, line.length - 1).trim();
          const val = this.evaluateExpr(content, variables);
          stdoutAcc += String(val) + '\n';
          i++;
          continue;
        }

        // 2. Variable Assignment (x = 10)
        if (line.includes('=') && !line.includes('==') && !line.includes('!=')) {
          const parts = line.split('=');
          const varName = parts[0].trim();
          const expr = parts.slice(1).join('=').trim();
          variables[varName] = this.evaluateExpr(expr, variables);
          i++;
          continue;
        }

        // 3. For loop (for i in range(N):)
        if (line.startsWith('for ') && line.includes('in range(') && line.endsWith(':')) {
          const match = line.match(/for\s+(\w+)\s+in\s+range\((\d+)\):/);
          if (match) {
            const varName = match[1];
            const count = parseInt(match[2], 10);

            // Collect loop body
            const bodyLines: string[] = [];
            i++;
            while (i < lines.length && (lines[i].startsWith('    ') || lines[i].startsWith('\t'))) {
              bodyLines.push(lines[i].trim());
              i++;
            }

            for (let c = 0; c < count; c++) {
              variables[varName] = c;
              for (const bodyCmd of bodyLines) {
                if (bodyCmd.startsWith('print(') && bodyCmd.endsWith(')')) {
                  const content = bodyCmd.substring(6, bodyCmd.length - 1).trim();
                  const val = this.evaluateExpr(content, variables);
                  stdoutAcc += String(val) + '\n';
                } else if (bodyCmd.includes('=')) {
                  const parts = bodyCmd.split('=');
                  variables[parts[0].trim()] = this.evaluateExpr(parts.slice(1).join('=').trim(), variables);
                }
              }
            }
            continue;
          }
        }

        i++;
      }
    } catch (err: any) {
      stderrAcc += `Traceback (most recent call last):\n  File "script.py", line ${i + 1}\nSyntaxError: ${err.message || 'invalid syntax'}\n`;
      return { stdout: stdoutAcc, stderr: stderrAcc, exitCode: 1 };
    }

    return { stdout: stdoutAcc, stderr: stderrAcc, exitCode: 0 };
  }

  public evaluateExpr(expr: string, vars: Record<string, any>): any {
    const trimmed = expr.trim();

    // String literal "..." or '...'
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1);
    }

    // Number literal
    if (!isNaN(Number(trimmed))) {
      return Number(trimmed);
    }

    // Known variable lookup
    if (vars[trimmed] !== undefined) {
      return vars[trimmed];
    }

    // Expression with variables safely evaluated
    try {
      const sanitized = trimmed.replace(/[a-zA-Z_][a-zA-Z0-9_]*/g, (m) => {
        if (vars[m] !== undefined) {
          return JSON.stringify(vars[m]);
        }
        return m;
      });
      return Function(`"use strict"; return (${sanitized})`)();
    } catch (e) {
      return trimmed;
    }
  }
}

export const globalPythonEngine = new PythonEngine();
