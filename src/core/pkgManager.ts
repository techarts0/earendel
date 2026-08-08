// Earendel Linux Virtual Package Repository System (APT)
import { globalCommandRegistry } from './commandRegistry';
import { globalVFS } from './vfs';
import { Command } from './types';

export interface PackageMeta {
  name: string;
  version: string;
  sizeKb: number;
  description: string;
  installed: boolean;
  executables: Command[];
}

class PkgManager {
  private repo: Map<string, PackageMeta> = new Map();

  constructor() {
    this.initDefaultRepo();
  }

  private initDefaultRepo() {
    // 1. neofetch
    this.repo.set('neofetch', {
      name: 'neofetch',
      version: '7.1.0-4',
      sizeKb: 340,
      description: 'A fast, highly customizable system info script',
      installed: false,
      executables: [
        {
          name: 'neofetch',
          description: 'A fast system information tool',
          category: 'sys',
          execute: (ctx) => {
            const user = ctx.env['USER'] || 'hello';
            const info = [
              `\x1b[1;36m            .-/+\`      \x1b[1;37m${user}@earendel\x1b[0m`,
              `\x1b[1;36m           \`:${ctx.env['USER'] === 'root' ? '\\x1b[1;31m' : ''}+-        \x1b[0m--------------`,
              `\x1b[1;36m          :\`  ::-      \x1b[1;33mOS\x1b[0m: Earendel Linux Terminal Alpha`,
              `\x1b[1;36m      +\` :\`    \`:+\`    \x1b[1;33mHost\x1b[0m: WebAssembly Core v1.0`,
              `\x1b[1;36m    \`+.\`        \`+.\`   \x1b[1;33mKernel\x1b[0m: 5.15.0-web-earendel`,
              `\x1b[1;36m   :\`              \`:  \x1b[1;33mUptime\x1b[0m: 2 hours, 14 mins`,
              `\x1b[1;36m  +\`                \`+ \x1b[1;33mPackages\x1b[0m: 78 (dpkg)`,
              `\x1b[1;36m  :\`                \`: \x1b[1;33mShell\x1b[0m: bash 5.1.16`,
              `\x1b[1;36m  +\`                \`+ \x1b[1;33mTerminal\x1b[0m: xterm.js`,
              `\x1b[1;36m   :\`              \`:  \x1b[1;33mCPU\x1b[0m: Virtual TS Engine Dual-Core`,
              `\x1b[1;36m    \`+.\`        \`+.\`   \x1b[1;33mMemory\x1b[0m: 512MiB / 4096MiB`,
              `\x1b[1;36m      +\` :\`    \`:+\`    `,
              `\x1b[1;36m          :\`  ::-      \x1b[40m   \x1b[41m   \x1b[42m   \x1b[43m   \x1b[44m   \x1b[45m   \x1b[46m   \x1b[47m   \x1b[0m`,
              `\x1b[1;36m           \`:${ctx.env['USER'] === 'root' ? '\\x1b[1;31m' : ''}+-        \x1b[100m   \x1b[101m   \x1b[102m   \x1b[103m   \x1b[104m   \x1b[105m   \x1b[106m   \x1b[107m   \x1b[0m`,
              `\x1b[1;36m            .-/+\`      `,
            ];
            return { stdout: info.join('\n') + '\n', stderr: '', exitCode: 0 };
          },
        },
      ],
    });

    // 2. cmatrix
    this.repo.set('cmatrix', {
      name: 'cmatrix',
      version: '2.0-2',
      sizeKb: 1420,
      description: 'Simulates the display from The Matrix',
      installed: false,
      executables: [
        {
          name: 'cmatrix',
          description: 'Matrix digital rain simulation',
          category: 'text',
          execute: () => {
            const matrixLines = [
              '\x1b[32m0 1 0 1 1 0 1 0 1 0 1 0 1 1 0 1 0 1 0 1 0 1\x1b[0m',
              '\x1b[1;32m1   0   1   0   1   0   1   0   1   0   1\x1b[0m',
              '\x1b[32m  1   1   0   1   0   1   1   0   1   0  \x1b[0m',
              '\x1b[1;37mH E L L O   E A R E N D E L   M A T R I X\x1b[0m',
              '\x1b[32m1 0 1 0 1 0 1 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1\x1b[0m',
              '\x1b[1;32m0   1   0   1   0   1   0   1   0   1   0\x1b[0m',
            ];
            return { stdout: matrixLines.join('\n') + '\n', stderr: '', exitCode: 0 };
          },
        },
      ],
    });

    // 3. python3
    this.repo.set('python3', {
      name: 'python3',
      version: '3.10.12-1',
      sizeKb: 8500,
      description: 'Interactive high-level object-oriented language',
      installed: false,
      executables: [
        {
          name: 'python3',
          aliases: ['python'],
          description: 'Python 3 Interpreter',
          category: 'sys',
          execute: (ctx) => {
            if (ctx.args[0] === '-c' && ctx.args[1]) {
              const code = ctx.args[1];
              try {
                if (code.includes('print(')) {
                  const match = code.match(/print\((.*)\)/);
                  const val = match ? match[1].replace(/['"]/g, '') : '';
                  return { stdout: val + '\n', stderr: '', exitCode: 0 };
                }
              } catch (e) {
                // fallthrough
              }
              return { stdout: 'Python 3.10.12 (main, Jun 11 2023)\n[GCC 11.4.0] on linux\n', stderr: '', exitCode: 0 };
            }
            return {
              stdout: 'Python 3.10.12 (main, Jun 11 2023, 11:50:40) [GCC 11.4.0] on linux\nType "help", "copyright", "credits" or "license" for more information.\n>>> print("Hello from Earendel Python3!")\nHello from Earendel Python3!\n',
              stderr: '',
              exitCode: 0,
            };
          },
        },
      ],
    });
  }

  public getPackage(name: string): PackageMeta | undefined {
    return this.repo.get(name);
  }

  public getAllPackages(): PackageMeta[] {
    return Array.from(this.repo.values());
  }

  public installPackage(name: string): { success: boolean; message: string } {
    const pkg = this.repo.get(name);
    if (!pkg) {
      return { success: false, message: `E: Unable to locate package ${name}` };
    }
    if (pkg.installed) {
      return { success: true, message: `${name} is already the newest version (${pkg.version}).` };
    }

    pkg.installed = true;
    pkg.executables.forEach((cmd) => {
      globalCommandRegistry.register(cmd);
      globalVFS.writeFile(`/bin/${cmd.name}`, `#!/bin/bash\n# Binary for ${cmd.name}\n`);
    });

    return { success: true, message: `Setting up ${pkg.name} (${pkg.version}) ...\nProcessing triggers for man-db ...` };
  }

  public removePackage(name: string): { success: boolean; message: string } {
    const pkg = this.repo.get(name);
    if (!pkg || !pkg.installed) {
      return { success: false, message: `Package '${name}' is not installed, so not removed` };
    }

    pkg.installed = false;
    pkg.executables.forEach((cmd) => {
      globalCommandRegistry.unregister(cmd.name);
      globalVFS.remove(`/bin/${cmd.name}`);
    });

    return { success: true, message: `Removing ${pkg.name} (${pkg.version}) ...` };
  }
}

export const globalPkgManager = new PkgManager();
