// Earendel & ECMA Compiler Collection Toolchain (ecc) - Native Test Runner
import { ExecutionContext } from './types';

export interface TestResultDetail {
  suite: string;
  name: string;
  passed: boolean;
  error?: string;
  durationMs: number;
  scoreWeight: number;
}

export interface TestSuiteOutcome {
  total: number;
  passed: number;
  failed: number;
  score: number; // 0 ~ 100
  details: TestResultDetail[];
  logs: string;
  exitCode: number;
}

export class EccTestEngine {
  /**
   * Executes a JavaScript test file within an isolated and sandboxed test environment
   */
  public static async runTestCode(
    testCode: string,
    ctx: ExecutionContext,
    options: { cwd?: string; requireReadOnly?: boolean } = {}
  ): Promise<TestSuiteOutcome> {
    const details: TestResultDetail[] = [];
    const testLogs: string[] = [];

    // Micro-Assertion Framework & Test Suite Context
    const testFrameworkCode = `
      const __suites = [];
      let __currentSuite = 'Default Suite';
      const __tests = [];

      function describe(title, fn) {
        const prevSuite = __currentSuite;
        __currentSuite = title;
        try {
          fn();
        } finally {
          __currentSuite = prevSuite;
        }
      }

      function test(name, fn, scoreWeight = 1) {
        __tests.push({
          suite: __currentSuite,
          name,
          fn,
          scoreWeight: typeof scoreWeight === 'number' ? scoreWeight : 1
        });
      }
      const it = test;

      function expect(actual) {
        return {
          toBe(expected) {
            if (actual !== expected) {
              throw new Error(\`Expected \${JSON.stringify(expected)} but received \${JSON.stringify(actual)}\`);
            }
          },
          toEqual(expected) {
            const actualStr = JSON.stringify(actual);
            const expectedStr = JSON.stringify(expected);
            if (actualStr !== expectedStr) {
              throw new Error(\`Expected deep equal \${expectedStr} but received \${actualStr}\`);
            }
          },
          toBeTruthy() {
            if (!actual) {
              throw new Error(\`Expected truthy value but received \${JSON.stringify(actual)}\`);
            }
          },
          toBeFalsy() {
            if (actual) {
              throw new Error(\`Expected falsy value but received \${JSON.stringify(actual)}\`);
            }
          },
          toBeNull() {
            if (actual !== null) {
              throw new Error(\`Expected null but received \${JSON.stringify(actual)}\`);
            }
          },
          toBeUndefined() {
            if (actual !== undefined) {
              throw new Error(\`Expected undefined but received \${JSON.stringify(actual)}\`);
            }
          },
          toBeGreaterThan(expected) {
            if (typeof actual !== 'number' || actual <= expected) {
              throw new Error(\`Expected > \${expected} but received \${actual}\`);
            }
          },
          toBeLessThan(expected) {
            if (typeof actual !== 'number' || actual >= expected) {
              throw new Error(\`Expected < \${expected} but received \${actual}\`);
            }
          },
          toContain(item) {
            if (Array.isArray(actual)) {
              if (!actual.includes(item)) {
                throw new Error(\`Expected array to contain \${JSON.stringify(item)}\`);
              }
            } else if (typeof actual === 'string') {
              if (!actual.includes(String(item))) {
                throw new Error(\`Expected string to contain \${JSON.stringify(item)}\`);
              }
            } else {
              throw new Error(\`toContain only supports Array or String\`);
            }
          },
          toThrow(expectedError) {
            if (typeof actual !== 'function') {
              throw new Error(\`toThrow requires a function target\`);
            }
            let threw = false;
            let thrownError = null;
            try {
              actual();
            } catch (e) {
              threw = true;
              thrownError = e;
            }
            if (!threw) {
              throw new Error(\`Expected function to throw error, but it did not throw\`);
            }
            if (expectedError && thrownError) {
              const msg = thrownError.message || String(thrownError);
              if (typeof expectedError === 'string' && !msg.includes(expectedError)) {
                throw new Error(\`Expected error to contain "\${expectedError}", got "\${msg}"\`);
              }
            }
          }
        };
      }

      // Require resolver supporting relative requires in VFS
      function __createRequire(currentCwd, vfs) {
        return function require(modulePath) {
          if (modulePath === 'assert') {
            return { strictEqual: (a, b) => expect(a).toBe(b), deepStrictEqual: (a, b) => expect(a).toEqual(b) };
          }
          let absPath = modulePath;
          if (modulePath === 'code' || modulePath === 'solution') {
            modulePath = './code.js';
          }
          if (modulePath.startsWith('.')) {
            const dir = currentCwd || '/home/hello';
            absPath = \`\${dir}/\${modulePath}\`.replace(/\\/\\.\\//g, '/').replace(/\\/+/g, '/');
            if (!absPath.endsWith('.js') && !absPath.endsWith('.json')) {
              absPath += '.js';
            }
          }
          let node = vfs.getNodeByPath(absPath);
          if (!node && modulePath.includes('code.js')) {
            // fallback to solution.js or main.js if code.js is not present
            node = vfs.getNodeByPath(\`\${currentCwd}/solution.js\`) || vfs.getNodeByPath(\`\${currentCwd}/main.js\`);
          }
          if (!node || node.type !== 'file') {
            throw new Error(\`Cannot find module '\${modulePath}' (resolved: \${absPath})\`);
          }
          const moduleExports = {};
          const modObj = { exports: moduleExports };
          const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', node.content || '');
          fn(moduleExports, require, modObj, absPath, currentCwd);
          return modObj.exports;
        };
      }
    `;

    const cwd = options.cwd || '/home/hello';

    try {
      // 执行注册阶段
      const runnerCode = `
        ${testFrameworkCode}
        const require = __createRequire(${JSON.stringify(cwd)}, ctx.vfs);
        
        // Execute user test definition
        ${testCode}

        return __tests;
      `;

      const evalFn = new Function('ctx', runnerCode);
      const testList: Array<{ suite: string; name: string; fn: Function; scoreWeight: number }> = evalFn(ctx) || [];

      if (testList.length === 0) {
        return {
          total: 0,
          passed: 0,
          failed: 0,
          score: 0,
          details: [],
          logs: '\x1b[33m[ecc-test] 警告: 未在测试文件中发现任何 test() 或 describe() 用例。\x1b[0m\n',
          exitCode: 1,
        };
      }

      let totalWeight = 0;
      let passedWeight = 0;
      let passedCount = 0;
      let failedCount = 0;

      let lastSuite = '';
      testLogs.push(`\x1b[1;36m▶ ECC Test Engine v1.0 (Native ECMA Test Suite)\x1b[0m`);
      testLogs.push(`  Target CWD: ${cwd}`);
      testLogs.push('');

      for (const t of testList) {
        if (t.suite !== lastSuite) {
          testLogs.push(`\x1b[1m● ${t.suite}\x1b[0m`);
          lastSuite = t.suite;
        }

        const weight = t.scoreWeight || 1;
        totalWeight += weight;

        const startTime = performance.now();
        let passed = true;
        let errMsg: string | undefined;

        try {
          const res = t.fn();
          if (res && typeof res.then === 'function') {
            await res;
          }
        } catch (e: any) {
          passed = false;
          errMsg = e?.message || String(e);
        }

        const duration = Math.round(performance.now() - startTime);

        if (passed) {
          passedCount++;
          passedWeight += weight;
          testLogs.push(`    \x1b[32m✔\x1b[0m ${t.name} \x1b[90m(${duration}ms)\x1b[0m`);
        } else {
          failedCount++;
          testLogs.push(`    \x1b[31m✘\x1b[0m ${t.name} \x1b[90m(${duration}ms)\x1b[0m`);
          if (errMsg) {
            testLogs.push(`      \x1b[31mError: ${errMsg}\x1b[0m`);
          }
        }

        details.push({
          suite: t.suite,
          name: t.name,
          passed,
          error: errMsg,
          durationMs: duration,
          scoreWeight: weight,
        });
      }

      const calculatedScore = totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 100) : 0;

      testLogs.push('');
      testLogs.push('----------------------------------------------------');
      testLogs.push(
        `\x1b[1mTest Summary:\x1b[0m ${passedCount === testList.length ? '\x1b[1;32mPASSED\x1b[0m' : '\x1b[1;31mFAILED\x1b[0m'} ` +
        `| Passed: \x1b[32m${passedCount}\x1b[0m, Failed: \x1b[31${failedCount > 0 ? '1' : '2'}m${failedCount}\x1b[0m, Total: ${testList.length} ` +
        `| \x1b[1;33mScore: ${calculatedScore}/100\x1b[0m`
      );

      return {
        total: testList.length,
        passed: passedCount,
        failed: failedCount,
        score: calculatedScore,
        details,
        logs: testLogs.join('\n'),
        exitCode: failedCount === 0 ? 0 : 1,
      };
    } catch (parseErr: any) {
      return {
        total: 0,
        passed: 0,
        failed: 1,
        score: 0,
        details: [],
        logs: `\x1b[31m[ecc-test] 测试套件语法/执行错误: ${parseErr?.message || parseErr}\x1b[0m\n`,
        exitCode: 1,
      };
    }
  }
}
