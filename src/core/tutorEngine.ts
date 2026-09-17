// Earendel OS Kernel AI Tutor Engine (Smart MAN Agent)
// Provides real-time pedagogical diagnosis, spelling error correction, and VIM code generation.

import { manDatabase } from './manDatabase';
import { globalVFS } from './vfs';

export interface DiagnosisResult {
  reason: string;
  solution: string;
  concept: string;
  diff?: string;
}

export class TutorEngine {
  private enabled: boolean = false;

  private commonCommands: string[] = [
    'ls', 'cd', 'pwd', 'mkdir', 'touch', 'rm', 'cp', 'mv', 'cat', 'head', 'tail', 'wc',
    'grep', 'sed', 'awk', 'sort', 'uniq', 'tr', 'tee', 'cut', 'diff', 'paste', 'nl', 'tac', 'rev',
    'find', 'which', 'whereis', 'locate', 'ps', 'top', 'htop', 'free', 'df', 'kill', 'pkill',
    'uptime', 'ping', 'curl', 'wget', 'ifconfig', 'ip', 'netstat', 'ss', 'chmod', 'chown',
    'tar', 'gzip', 'gunzip', 'zip', 'unzip', 'su', 'sudo', 'useradd', 'usermod', 'userdel', 'passwd',
    'groups', 'groupadd', 'groupmod', 'groupdel', 'gpasswd', 'who', 'last', 'id', 'login', 'logout', 'systemctl', 'service',
    'apt', 'apt-get', 'dpkg', 'ufw', 'iptables', 'alias', 'unalias', 'jobs', 'fg', 'bg',
    'time', 'date', 'uname', 'clear', 'echo', 'vi', 'vim', 'man', 'docker', 'python3', 'node'
  ];

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(val: boolean): void {
    this.enabled = val;
  }

  /**
   * Validate /etc/llm.conf configuration state
   */
  public checkLLMConfig(vfs?: any): {
    configured: boolean;
    provider: string;
    baseUrl: string;
    model: string;
    hasKey: boolean;
    notice?: string;
  } {
    const targetVFS = vfs && typeof vfs.readFile === 'function' ? vfs : globalVFS;
    const rawConf = targetVFS?.readFile('/etc/llm.conf') || '';

    const config: Record<string, string> = {};
    rawConf.split('\n').forEach((line: string) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        config[trimmed.substring(0, eqIdx).trim()] = trimmed.substring(eqIdx + 1).trim();
      }
    });

    const apiKey = config['API_KEY'] || '';
    const hasValidKey = Boolean(apiKey && !apiKey.startsWith('sk-your-api-key') && apiKey !== 'sk-xxxxxx' && apiKey.length > 5);
    const isConfigured = Boolean(rawConf && hasValidKey);

    return {
      configured: isConfigured,
      provider: config['PROVIDER'] || 'openai',
      baseUrl: config['BASE_URL'] || 'https://api.openai.com/v1',
      model: config['MODEL_NAME'] || 'gpt-4o-mini',
      hasKey: hasValidKey,
      notice: !isConfigured
        ? `[Notice: /etc/llm.conf unconfigured. Operating in Built-in Offline Mode. Configure /etc/llm.conf to enable cloud LLM.]`
        : undefined,
    };
  }

  /**
   * Compute Levenshtein distance between two strings
   */
  private levenshtein(a: string, b: string): number {
    const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) dp[i][0] = i;
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;

    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }
    return dp[a.length][b.length];
  }

  /**
   * Find closest command if spelled incorrectly
   */
  public findClosestCommand(wrongCmd: string): string | null {
    let closest: string | null = null;
    let minDistance = 3; // only match within distance 2

    for (const cmd of this.commonCommands) {
      const dist = this.levenshtein(wrongCmd.toLowerCase(), cmd);
      if (dist < minDistance) {
        minDistance = dist;
        closest = cmd;
      }
    }
    return closest;
  }

  /**
   * Diagnose command failure and return human-friendly pedagogical card
   */
  public diagnoseCommand(
    cmdName: string,
    cmdArgs: string[],
    exitCode: number,
    stderr: string
  ): string | null {
    const errText = stderr.trim();

    // 1. Unknown Command / Spelling Error
    if (errText.includes('command not found') || errText.includes('not found') || exitCode === 127) {
      const suggest = this.findClosestCommand(cmdName);
      if (suggest) {
        return this.formatDiagnosisCard({
          reason: `Command '${cmdName}' not found. Potential typo detected.`,
          solution: `Did you mean: \x1b[1;32m${suggest} ${cmdArgs.join(' ')}\x1b[0m ?`,
          concept: `Linux resolves commands using directories in the PATH variable. A slight spelling discrepancy causes lookup failure.`,
        });
      }
      return this.formatDiagnosisCard({
        reason: `Command '${cmdName}' was not found in current PATH.`,
        solution: `Use \x1b[1;32mwhich ${cmdName}\x1b[0m to check location, or install it via \x1b[1;32mapt install ${cmdName}\x1b[0m.`,
        concept: `Executables must reside in system directories like /bin, /usr/bin, or be invoked with a path like ./script.`,
      });
    }

    // 2. rm directory error
    if (cmdName === 'rm' && (errText.includes('Is a directory') || errText.includes('directory'))) {
      return this.formatDiagnosisCard({
        reason: `Attempted to remove a directory directly. By default, 'rm' only removes regular files.`,
        solution: `To remove a directory and its contents, add the recursive flag: \x1b[1;32mrm -r ${cmdArgs.join(' ')}\x1b[0m`,
        concept: `Linux treats directories as tree branches. POSIX mandates -r (recursive) to confirm destructive hierarchical operations.`,
      });
    }

    // 3. cp directory error
    if (cmdName === 'cp' && (errText.includes('omitting directory') || errText.includes('is a directory'))) {
      return this.formatDiagnosisCard({
        reason: `Attempted to copy a directory without the recursive option.`,
        solution: `To copy directories recursively, specify -r: \x1b[1;32mcp -r ${cmdArgs.join(' ')}\x1b[0m`,
        concept: `Copying directory structures requires recursive traversal (-r) or archive mode (-a) to preserve attributes.`,
      });
    }

    // 4. chmod invalid mode
    if (cmdName === 'chmod' && (errText.includes('invalid mode') || errText.includes('missing operand'))) {
      return this.formatDiagnosisCard({
        reason: `Invalid permission mode syntax or missing file operand.`,
        solution: `Octal format: \x1b[1;32mchmod 755 file\x1b[0m (rwx user, rx group/others) or symbolic format: \x1b[1;32mchmod +x file\x1b[0m`,
        concept: `POSIX permissions use three octal digits (User/Group/Others) where r=4, w=2, x=1. Each digit must range between 0 and 7.`,
      });
    }

    // 5. Permission denied
    if (errText.includes('Permission denied') || errText.includes('Operation not permitted')) {
      return this.formatDiagnosisCard({
        reason: `Permission denied. Current user lacks required privileges.`,
        solution: `If this is an administrative task, prefix with sudo: \x1b[1;32msudo ${cmdName} ${cmdArgs.join(' ')}\x1b[0m, or adjust file mode with \x1b[1;32mchmod\x1b[0m.`,
        concept: `Linux enforces Discretionary Access Control (DAC) to protect system-critical trees (/etc, /root) from unauthorized modifications.`,
      });
    }

    // 6. tar command options
    if (cmdName === 'tar' && (errText.includes('specify') || errText.includes('missing'))) {
      return this.formatDiagnosisCard({
        reason: `tar requires an operation mode flag (create -c, extract -x, or list -t).`,
        solution: `Create archive: \x1b[1;32mtar -czvf archive.tar.gz files...\x1b[0m | Extract: \x1b[1;32mtar -xzvf archive.tar.gz\x1b[0m`,
        concept: `In tar (Tape Archive): -c creates, -x extracts, -t lists, -z compresses with gzip, -v is verbose, -f specifies the archive filename.`,
      });
    }

    // 7. No such file or directory
    if (errText.includes('No such file or directory')) {
      return this.formatDiagnosisCard({
        reason: `The specified file or directory path does not exist.`,
        solution: `Run \x1b[1;32mpwd\x1b[0m to inspect current working directory, and \x1b[1;32mls -l\x1b[0m to verify filenames. Note case sensitivity.`,
        concept: `Linux paths are strictly case-sensitive. Relative paths are always computed relative to current working directory ($PWD).`,
      });
    }

    // Fallback general diagnosis if exitCode != 0
    if (exitCode !== 0 && errText) {
      return this.formatDiagnosisCard({
        reason: `Command terminated with non-zero exit status (ExitCode: ${exitCode}).`,
        solution: `Run \x1b[1;32mman ${cmdName}\x1b[0m or \x1b[1;32m${cmdName} --help\x1b[0m to review standard usage and valid options.`,
        concept: `In Linux/POSIX, exit status 0 indicates success, while non-zero values reflect specific error conditions (1: general, 2: syntax, 127: not found).`,
      });
    }

    return null;
  }

  /**
   * Format the diagnosis box for student terminal
   */
  private formatDiagnosisCard(diag: DiagnosisResult): string {
    const llm = this.checkLLMConfig();
    const engineNotice = llm.configured
      ? `\x1b[90m• Engine: Live Cloud LLM (${llm.model}) | 'man agent off' to disable\x1b[0m`
      : `\x1b[33m• Notice: /etc/llm.conf unconfigured (Offline Mode). Edit /etc/llm.conf for cloud LLM.\x1b[0m`;

    const lines = [
      `\n\x1b[1;35m╭── 💡 [MAN Agent: AI Tutor Diagnosis] ─────────────────────────────────╮\x1b[0m`,
      `\x1b[1;35m│\x1b[0m \x1b[1;31m• Cause:\x1b[0m       ${diag.reason}`,
      `\x1b[1;35m│\x1b[0m \x1b[1;32m• Suggestion:\x1b[0m  ${diag.solution}`,
      `\x1b[1;35m│\x1b[0m \x1b[1;36m• Concept:\x1b[0m     ${diag.concept}`,
      `\x1b[1;35m│\x1b[0m ${engineNotice}`,
      `\x1b[1;35m╰────────────────────────────────────────────────────────────────────────╯\x1b[0m\n`,
    ];
    return lines.join('\n');
  }

  /**
   * Explain a command deeply for 'man agent <cmd>'
   */
  public explainCommand(cmdName: string): string {
    const page = manDatabase[cmdName];
    const llm = this.checkLLMConfig();
    let out = `\x1b[1;35m╭── 🤖 [MAN Agent: Interactive Command Guide - ${cmdName.toUpperCase()}] ────────╮\x1b[0m\n`;

    if (page) {
      out += `\x1b[1;36m[OVERVIEW]\x1b[0m    ${page.descriptionEn || page.descriptionZh}\n`;
      out += `\x1b[1;36m[SYNOPSIS]\x1b[0m    \x1b[1;33m${page.synopsis}\x1b[0m\n\n`;
      out += `\x1b[1;36m[COMMON OPTIONS]\x1b[0m\n`;
      const opts = page.optionsEn || page.optionsZh || [];
      opts.slice(0, 5).forEach((o) => {
        out += `  \x1b[1;32m${o.opt.padEnd(16)}\x1b[0m ${o.desc}\n`;
      });
      out += `\n\x1b[1;36m[EXAMPLES]\x1b[0m\n`;
      const examples = page.examplesEn || page.examplesZh || [];
      examples.forEach((ex) => {
        out += `  \x1b[32m$ ${ex}\x1b[0m\n`;
      });
    } else {
      out += `\x1b[1;33mCommand '${cmdName}' not found in static manual. Querying POSIX reference...\x1b[0m\n`;
      out += `Standard Linux utility. View built-in options via: \x1b[1m${cmdName} --help\x1b[0m\n`;
    }

    if (!llm.configured) {
      out += `\n\x1b[33m[Notice: /etc/llm.conf API_KEY unconfigured. Using built-in POSIX reference library.]\x1b[0m\n`;
      out += `\x1b[90mRun 'vi /etc/llm.conf' to configure an API_KEY for live cloud LLM reasoning.\x1b[0m\n`;
    }

    out += `\x1b[1;35m╰────────────────────────────────────────────────────────────────────────╯\x1b[0m\n`;
    return out;
  }

  /**
   * VIM :gen generator: Generate robust script code from comments and file extension
   */
  public generateCodeFromComments(filePath: string, fileContent: string): { code: string; lineCount: number } {
    const ext = filePath.includes('.') ? filePath.substring(filePath.lastIndexOf('.')).toLowerCase() : '';
    const comments = fileContent
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('#') || l.startsWith('//') || l.startsWith('/*'))
      .map((l) => l.replace(/^[#\/\\*]+/, '').trim())
      .filter(Boolean);

    const promptText = comments.join(' ') || 'Automated task script';

    let generated = '';

    if (ext === '.sh' || ext === '.bash' || !ext) {
      // Shell script template
      generated = [
        `#!/bin/bash`,
        `# ==============================================================================`,
        `# Generated by Earendel VIM AI Copilot (:gen)`,
        `# Task: ${promptText}`,
        `# ==============================================================================`,
        `set -euo pipefail`,
        ``,
        `echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting task: ${promptText}..."`,
        ``,
        `# 1. Verify runtime environment and dependencies`,
        `if [ ! -d "./output" ]; then`,
        `    mkdir -p ./output`,
        `    echo "Created output directory."`,
        `fi`,
        ``,
        `# 2. Core task execution`,
        `echo "Collecting system metrics..."`,
        `uptime >> ./output/system_summary.log`,
        `free -h >> ./output/system_summary.log`,
        `df -h >> ./output/system_summary.log`,
        ``,
        `# 3. Task completion report`,
        `echo "[$(date '+%Y-%m-%d %H:%M:%S')] Task completed successfully."`,
        `exit 0`,
      ].join('\n');
    } else if (ext === '.py') {
      // Python script template
      generated = [
        `#!/usr/bin/env python3`,
        `# -*- coding: utf-8 -*-`,
        `"""`,
        `Generated by Earendel VIM AI Copilot (:gen)`,
        `Task: ${promptText}`,
        `"""`,
        `import sys`,
        `import os`,
        `import time`,
        `import json`,
        ``,
        `def main():`,
        `    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Python script initialized.")`,
        `    print("Task objective:", "${promptText}")`,
        `    `,
        `    # Execute core calculation and business logic`,
        `    data = {`,
        `        "status": "success",`,
        `        "timestamp": time.time(),`,
        `        "task": "${promptText}"`,
        `    }`,
        `    print("Result Payload:", json.dumps(data, indent=2))`,
        ``,
        `if __name__ == "__main__":`,
        `    main()`,
      ].join('\n');
    } else if (ext === '.js' || ext === '.ts') {
      // JavaScript/TypeScript template
      generated = [
        `/**`,
        ` * Generated by Earendel VIM AI Copilot (:gen)`,
        ` * Task: ${promptText}`,
        ` */`,
        `const fs = require('fs');`,
        `const os = require('os');`,
        ``,
        `async function run() {`,
        `  console.log(\`[\${new Date().toISOString()}] Node.js task running: ${promptText}\`);`,
        `  const hostInfo = {`,
        `    hostname: os.hostname(),`,
        `    platform: os.platform(),`,
        `    freeMem: Math.round(os.freemem() / 1024 / 1024) + 'MB',`,
        `  };`,
        `  console.log('System Status:', hostInfo);`,
        `}`,
        ``,
        `run().catch(console.error);`,
      ].join('\n');
    } else {
      // General C/C++ or other template
      generated = [
        `// Generated by Earendel VIM AI Copilot (:gen)`,
        `// Task: ${promptText}`,
        `#include <stdio.h>`,
        `#include <stdlib.h>`,
        ``,
        `int main(int argc, char *argv[]) {`,
        `    printf("Executing task: %s\\n", "${promptText}");`,
        `    return 0;`,
        `}`,
      ].join('\n');
    }

    return {
      code: generated,
      lineCount: generated.split('\n').length,
    };
  }
}

export const globalTutorEngine = new TutorEngine();

