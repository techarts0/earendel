// Earendel & POSIX Shell Bats / TAP (Test Anything Protocol) Test Engine
import { ExecutionContext } from './types';
import { ShellEngine } from './shellEngine';

export interface BatsTestCaseOutcome {
  name: string;
  passed: boolean;
  scoreWeight: number;
  durationMs: number;
  error?: string;
  output?: string;
}

export interface BatsSuiteOutcome {
  total: number;
  passed: number;
  failed: number;
  score: number; // 0 ~ 100
  details: BatsTestCaseOutcome[];
  tapOutput: string;
  logs: string;
  exitCode: number;
}

export class BatsTestEngine {
  /**
   * Parses and executes a Bats/Shell test script adhering to Bats syntax and TAP protocol output
   *
   * Supported Bats syntax:
   * 1. @test "test name" [weight] {
   *      ... commands ...
   *      [ "$status" -eq 0 ]
   *    }
   * 2. test_case "test name" [weight]
   *      ... commands ...
   *      assert_equal "$a" "$b"
   * 3. setup() and teardown() lifecycle hooks
   */
  public static async runBatsScript(
    scriptContent: string,
    ctx: ExecutionContext,
    options: { cwd?: string } = {}
  ): Promise<BatsSuiteOutcome> {
    const cwd = options.cwd || '/home/hello';
    const lines = scriptContent.split('\n');

    // 1. Extract setup / teardown if defined
    let setupBlock = '';
    let teardownBlock = '';

    const setupMatch = scriptContent.match(/setup\s*\(\)\s*\{([\s\S]*?)\n\}/);
    if (setupMatch) {
      setupBlock = setupMatch[1];
    }
    const teardownMatch = scriptContent.match(/teardown\s*\(\)\s*\{([\s\S]*?)\n\}/);
    if (teardownMatch) {
      teardownBlock = teardownMatch[1];
    }

    // 2. Parse @test blocks or test_case blocks
    interface RawTestCase {
      name: string;
      body: string;
      weight: number;
    }

    const testCases: RawTestCase[] = [];

    // Match pattern 1: @test "..." or @test '...' with optional weight comment/parameter
    const atTestRegex = /@test\s+["']([^"']+)["'](?:\s+(\d+))?\s*\{([\s\S]*?)\n\}/g;
    let match;
    while ((match = atTestRegex.exec(scriptContent)) !== null) {
      testCases.push({
        name: match[1],
        weight: match[2] ? parseInt(match[2], 10) : 1,
        body: match[3],
      });
    }

    // Match pattern 2: test_case "..." [weight] ... until next test_case or EOF
    if (testCases.length === 0) {
      let currentName: string | null = null;
      let currentWeight = 1;
      let currentBody: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        const tcMatch = trimmed.match(/^test_case\s+["']([^"']+)["'](?:\s+(\d+))?/);
        if (tcMatch) {
          if (currentName) {
            testCases.push({
              name: currentName,
              weight: currentWeight,
              body: currentBody.join('\n'),
            });
            currentBody = [];
          }
          currentName = tcMatch[1];
          currentWeight = tcMatch[2] ? parseInt(tcMatch[2], 10) : 1;
        } else if (currentName) {
          currentBody.push(line);
        }
      }

      if (currentName) {
        testCases.push({
          name: currentName,
          weight: currentWeight,
          body: currentBody.join('\n'),
        });
      }
    }

    // Fallback: If no Bats @test or test_case, treat the whole script as a single test case
    if (testCases.length === 0) {
      testCases.push({
        name: 'Default Test Suite Verification',
        weight: 1,
        body: scriptContent,
      });
    }

    // Bats / TAP standard helper library injection
    const batsHelperLib = `
      # TAP / Bats Builtin Assertions
      assert_equal() {
        if [ "$1" != "$2" ]; then
          echo "assert_equal failed: expected '$2', received '$1'" >&2
          return 1
        fi
      }
      assert_not_equal() {
        if [ "$1" = "$2" ]; then
          echo "assert_not_equal failed: unexpected value '$1'" >&2
          return 1
        fi
      }
      assert_success() {
        if [ "\${status:-0}" -ne 0 ]; then
          echo "assert_success failed with status \${status:-0}" >&2
          return 1
        fi
      }
      assert_failure() {
        if [ "\${status:-0}" -eq 0 ]; then
          echo "assert_failure expected non-zero status but got 0" >&2
          return 1
        fi
      }
      assert_file_exists() {
        if [ ! -f "$1" ]; then
          echo "assert_file_exists failed: file not found '$1'" >&2
          return 1
        fi
      }
      assert_dir_exists() {
        if [ ! -d "$1" ]; then
          echo "assert_dir_exists failed: directory not found '$1'" >&2
          return 1
        fi
      }
      assert_contains() {
        if ! echo "$1" | grep -q "$2"; then
          echo "assert_contains failed: '$1' does not contain '$2'" >&2
          return 1
        fi
      }
    `;

    const details: BatsTestCaseOutcome[] = [];
    const tapLines: string[] = [];
    const prettyLogs: string[] = [];

    tapLines.push(`1..${testCases.length}`);
    prettyLogs.push(`\x1b[1;36m▶ Bats / TAP Shell Test Runner v1.0.0 (POSIX Standard)\x1b[0m`);
    prettyLogs.push(`  Target CWD: ${cwd}`);
    prettyLogs.push(`  Test Plan: 1..${testCases.length}`);
    prettyLogs.push('');

    let totalWeight = 0;
    let passedWeight = 0;
    let passedCount = 0;
    let failedCount = 0;

    for (let idx = 0; idx < testCases.length; idx++) {
      const tc = testCases[idx];
      const testNum = idx + 1;
      const weight = tc.weight || 1;
      totalWeight += weight;

      const engine = new ShellEngine(ctx.vfs, ctx.processManager);
      const startTime = performance.now();

      // Combine setup + helpers + test body + teardown
      const fullExecutionScript = [
        batsHelperLib,
        setupBlock,
        tc.body,
        teardownBlock,
      ].join('\n');

      let passed = true;
      let errMsg = '';
      let stdOutCombined = '';

      try {
        const res = await engine.execute(fullExecutionScript);
        stdOutCombined = res.stdout || '';
        if (res.exitCode !== 0 || res.stderr) {
          passed = false;
          errMsg = res.stderr || `Exit code ${res.exitCode}`;
        }
      } catch (e: any) {
        passed = false;
        errMsg = e?.message || String(e);
      }

      const duration = Math.round(performance.now() - startTime);

      if (passed) {
        passedCount++;
        passedWeight += weight;
        tapLines.push(`ok ${testNum} - ${tc.name}`);
        prettyLogs.push(`  \x1b[32m✔\x1b[0m \x1b[1mok ${testNum}\x1b[0m - ${tc.name} \x1b[90m(${duration}ms)\x1b[0m`);
      } else {
        failedCount++;
        tapLines.push(`not ok ${testNum} - ${tc.name}`);
        if (errMsg) {
          tapLines.push(`  # ${errMsg.replace(/\n/g, '\n  # ')}`);
        }
        prettyLogs.push(`  \x1b[31m✘\x1b[0m \x1b[1mnot ok ${testNum}\x1b[0m - ${tc.name} \x1b[90m(${duration}ms)\x1b[0m`);
        if (errMsg) {
          prettyLogs.push(`    \x1b[31mError: ${errMsg.trim()}\x1b[0m`);
        }
      }

      details.push({
        name: tc.name,
        passed,
        scoreWeight: weight,
        durationMs: duration,
        error: errMsg,
        output: stdOutCombined,
      });
    }

    const calculatedScore = totalWeight > 0 ? Math.round((passedWeight / totalWeight) * 100) : 0;

    prettyLogs.push('');
    prettyLogs.push('----------------------------------------------------');
    prettyLogs.push(
      `\x1b[1mTAP Summary:\x1b[0m ${passedCount === testCases.length ? '\x1b[1;32mPASSED\x1b[0m' : '\x1b[1;31mFAILED\x1b[0m'} ` +
      `| Passed: \x1b[32m${passedCount}\x1b[0m, Failed: \x1b[31${failedCount > 0 ? '1' : '2'}m${failedCount}\x1b[0m, Total: ${testCases.length} ` +
      `| \x1b[1;33mScore: ${calculatedScore}/100\x1b[0m`
    );

    return {
      total: testCases.length,
      passed: passedCount,
      failed: failedCount,
      score: calculatedScore,
      details,
      tapOutput: tapLines.join('\n'),
      logs: prettyLogs.join('\n'),
      exitCode: failedCount === 0 ? 0 : 1,
    };
  }
}
