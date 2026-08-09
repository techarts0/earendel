import { globalCommandRegistry } from './commandRegistry';
import { globalVFS } from './vfs';
import { Command, ExecutionContext } from './types';
import { globalWasmEngine } from './wasmRuntime';
import { globalJsEngine } from './jsRuntime';

export interface PackageMeta {
  name: string;
  version: string;
  type: 'js' | 'wasm'; // Unified Package Ecosystem Type Classifier
  sizeKb: number;
  description: string;
  installed: boolean;
  wasmBytes?: Uint8Array;
  executables: Command[];
}

class PkgManager {
  private repo: Map<string, PackageMeta> = new Map();
  private repoBaseUrl: string = 'https://repo.earendel.techarts.cn';

  constructor() {
    this.initDefaultRepo();
    this.syncDpkgStatus();
  }

  public getRepoBaseUrl(): string {
    return this.repoBaseUrl;
  }

  public async updateFromRemoteRepo(): Promise<{ success: boolean; log: string }> {
    const packagesUrl = `${this.repoBaseUrl}/packages`;
    try {
      const res = await fetch(packagesUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

      const remotePkgs: any = await res.json();
      if (!Array.isArray(remotePkgs)) {
        throw new Error('Invalid index format: Expected JSON array of package objects');
      }

      let updatedCount = 0;

      remotePkgs.forEach((p: PackageMeta) => {
        if (p && p.name && p.version && p.executables) {
          const existing = this.repo.get(p.name);
          this.repo.set(p.name, {
            name: p.name,
            version: p.version,
            type: p.type || 'js',
            sizeKb: p.sizeKb || 100,
            description: p.description || 'Remote Ecosystem Package',
            installed: existing ? existing.installed : false,
            executables: p.executables,
          });
          updatedCount++;
        }
      });

      this.syncDpkgStatus();

      const log = [
        `Get:1 ${this.repoBaseUrl} jammy InRelease [119 kB]`,
        `Get:2 ${packagesUrl} [${updatedCount} packages index fetched]`,
        `Fetched ${(updatedCount * 1.5).toFixed(1)} kB in 0s (450 kB/s)`,
        `Reading package lists... Done`,
        `Building dependency tree... Done`,
        `Reading state information... Done`,
        `\x1b[32mAll ${updatedCount} packages are up to date from official repo.\x1b[0m`,
      ].join('\n');

      return { success: true, log };
    } catch (e: any) {
      const errLog = [
        `Get:1 ${this.repoBaseUrl}/packages [Connecting...]`,
        `Err:1 ${this.repoBaseUrl}/packages`,
        `  Could not connect to repo.earendel.techarts.cn:80 (${e.message || 'Failed to fetch'}).`,
        `Reading package lists... Done`,
        `W: Failed to fetch ${this.repoBaseUrl}/packages  Could not connect to repo.earendel.techarts.cn:80 (${e.message || 'Failed to fetch'})`,
        `W: Some index files failed to download. They have been ignored, or old ones used instead.`,
        `\x1b[31mE: Unable to fetch package index from official repository.\x1b[0m`,
      ].join('\n');

      return { success: false, log: errLog };
    }
  }

  private syncDpkgStatus() {
    let dpkgContent = 'Package: coreutils\nStatus: install ok installed\nArchitecture: all\nVersion: 1.0.0\nDescription: GNU core utilities\n\n';
    dpkgContent += 'Package: sysutils\nStatus: install ok installed\nArchitecture: all\nVersion: 1.0.0\nDescription: System administration tools\n\n';
    dpkgContent += 'Package: netutils\nStatus: install ok installed\nArchitecture: all\nVersion: 1.0.0\nDescription: Networking and security suite\n\n';

    this.repo.forEach((pkg) => {
      if (pkg.installed) {
        dpkgContent += `Package: ${pkg.name}\nStatus: install ok installed\nArchitecture: all\nVersion: ${pkg.version}\nDescription: ${pkg.description}\n\n`;
      }
    });

    globalVFS.writeFile('/var/lib/dpkg/status', dpkgContent);
  }

  private initDefaultRepo() {
    // 1. cowsay (JS Package Example)
    this.repo.set('cowsay', {
      name: 'cowsay',
      version: '3.04-1',
      type: 'js',
      sizeKb: 120,
      description: 'Configurable speaking cow in ASCII art (JavaScript)',
      installed: false,
      executables: [
        {
          name: 'cowsay',
          description: 'Configurable speaking cow in ASCII art',
          category: 'text',
          execute: (ctx) => {
            const msg = ctx.args.join(' ') || 'Moo! I love you!';
            const len = msg.length + 2;
            const border = '-'.repeat(len);
            const cow = [
              ` ${border}`,
              `< ${msg} >`,
              ` ${border}`,
              `        \\   ^__^`,
              `         \\  (oo)\\_______`,
              `            (__)\\       )/\\`,
              `                ||----w |`,
              `                ||     ||`,
            ].join('\n');
            return { stdout: cow + '\n', stderr: '', exitCode: 0 };
          },
        },
      ],
    });

    // 2. wasm-calc (WASM Binary Package Example)
    this.repo.set('wasm-calc', {
      name: 'wasm-calc',
      version: '1.2.0-wasm',
      type: 'wasm',
      sizeKb: 860,
      description: 'C-compiled Native WebAssembly High-Performance Calculator',
      installed: false,
      wasmBytes: globalWasmEngine.getDemoWasmBytecode(),
      executables: [
        {
          name: 'wasm-calc',
          description: 'WebAssembly Native Math & Logic Compute Engine',
          category: 'sys',
          execute: (ctx) => {
            return globalWasmEngine.executeWasm(globalWasmEngine.getDemoWasmBytecode(), ctx);
          },
        },
      ],
    });

    // 3. wasm-sha256 (WASM Binary Package Example)
    this.repo.set('wasm-sha256', {
      name: 'wasm-sha256',
      version: '0.4.1-rust-wasm',
      type: 'wasm',
      sizeKb: 1450,
      description: 'Rust-compiled Native WebAssembly SHA-256 Crypto Engine',
      installed: false,
      wasmBytes: globalWasmEngine.getDemoWasmBytecode(),
      executables: [
        {
          name: 'wasm-sha256',
          description: 'Rust WebAssembly Native Crypto Engine',
          category: 'sys',
          execute: (ctx) => {
            return globalWasmEngine.executeWasm(globalWasmEngine.getDemoWasmBytecode(), ctx);
          },
        },
      ],
    });

    // 4. fortune (JS Package Example)
    this.repo.set('fortune', {
      name: 'fortune',
      version: '1.99.1-7',
      type: 'js',
      sizeKb: 280,
      description: 'Prints a random adage (JavaScript)',
      installed: false,
      executables: [
        {
          name: 'fortune',
          description: 'Prints a random adage',
          category: 'text',
          execute: () => {
            const quotes = [
              'There are only two hard things in Computer Science: cache invalidation and naming things.',
              'Simplicity is prerequisite for reliability. — Edsger W. Dijkstra',
              'Talk is cheap. Show me the code. — Linus Torvalds',
            ];
            const q = quotes[Math.floor(Math.random() * quotes.length)];
            return { stdout: `\x1b[1;33m"${q}"\x1b[0m\n`, stderr: '', exitCode: 0 };
          },
        },
      ],
    });

    // 5. tree (JS Package Example)
    this.repo.set('tree', {
      name: 'tree',
      version: '2.0.2-1',
      type: 'js',
      sizeKb: 180,
      description: 'List contents of directories in a tree-like format',
      installed: false,
      executables: [
        {
          name: 'tree',
          description: 'List contents of directories in a tree-like format',
          category: 'file',
          execute: (ctx) => {
            const start = ctx.args[0] || '.';
            const lines: string[] = [start];
            let dirCount = 0;
            let fileCount = 0;

            const walkTree = (pathStr: string, indent: string) => {
              const node = ctx.vfs.getNodeByPath(pathStr);
              if (!node || !node.children) return;

              const keys = Array.from(node.children.keys());
              keys.forEach((k, idx) => {
                const child = node.children!.get(k)!;
                const isLast = idx === keys.length - 1;
                const prefix = isLast ? '└── ' : '├── ';
                const childIndent = indent + (isLast ? '    ' : '│   ');

                if (child.type === 'directory') {
                  dirCount++;
                  lines.push(`${indent}${prefix}\x1b[1;34m${k}\x1b[0m`);
                  const childPath = pathStr === '/' ? `/${k}` : `${pathStr}/${k}`;
                  walkTree(childPath, childIndent);
                } else {
                  fileCount++;
                  lines.push(`${indent}${prefix}${k}`);
                }
              });
            };

            walkTree(start, '');
            lines.push(`\n${dirCount} directories, ${fileCount} files`);
            return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
          },
        },
      ],
    });

    // 4. neofetch
    this.repo.set('neofetch', {
      name: 'neofetch',
      version: '7.1.0-4',
      type: 'js',
      sizeKb: 340,
      description: 'A fast, highly customizable system info script',
      installed: false,
      executables: [
        {
          name: 'neofetch',
          description: 'A fast system information tool',
          category: 'sys',
          execute: (ctx: ExecutionContext) => {
            const user = ctx.env['USER'] || 'hello';
            const info = [
              `\x1b[1;36m            .-/+\`      \x1b[1;37m${user}@earendel\x1b[0m`,
              `\x1b[1;36m           \`:${ctx.env['USER'] === 'root' ? '\\x1b[1;31m' : ''}+-        \x1b[0m--------------`,
              `\x1b[1;36m          :\`  ::-      \x1b[1;33mOS\x1b[0m: Earendel POSIX WebOS`,
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

    // 5. cmatrix
    this.repo.set('cmatrix', {
      name: 'cmatrix',
      version: '2.0-2',
      type: 'js',
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
  }

  public getPackage(name: string): PackageMeta | undefined {
    return this.repo.get(name);
  }

  public getAllPackages(): PackageMeta[] {
    return Array.from(this.repo.values());
  }

  public async installPackage(nameOrUrl: string): Promise<{ success: boolean; message: string }> {
    let pkg = this.repo.get(nameOrUrl);
    let fetchUrl = '';

    // Direct URL Installation Support
    if (nameOrUrl.startsWith('http://') || nameOrUrl.startsWith('https://')) {
      fetchUrl = nameOrUrl;
    } else if (pkg) {
      fetchUrl = `${this.repoBaseUrl}/bundles/${pkg.name}.ear.json`;
    } else {
      fetchUrl = `${this.repoBaseUrl}/bundles/${nameOrUrl}.ear.json`;
    }

    if (pkg && pkg.installed) {
      return { success: true, message: `${pkg.name} is already the newest version (${pkg.version}).` };
    }

    // Perform authentic network fetch for package bundle payload
    try {
      const res = await fetch(fetchUrl);
      if (!res.ok) {
        return {
          success: false,
          message: `Get:1 ${fetchUrl} [Connecting...]\nErr:1 ${fetchUrl}\n  HTTP ${res.status}: ${res.statusText || 'Package Bundle Not Found'}\n\x1b[31mE: Failed to fetch ${fetchUrl}\x1b[0m\nE: Unable to locate package ${nameOrUrl}`,
        };
      }

      const bundleMeta = await res.json();
      const pkgName = bundleMeta.name || nameOrUrl;
      const pkgVersion = bundleMeta.version || '1.0.0';
      const pkgType: 'js' | 'wasm' = bundleMeta.type || 'js';
      const sizeKb = bundleMeta.sizeKb || 120;
      const desc = bundleMeta.description || 'Remote Ecosystem Application';

      // Build executable command from remote JS/WASM code closure
      const executables: Command[] = (bundleMeta.executables || [{ name: pkgName }]).map((exec: any) => ({
        name: exec.name || pkgName,
        description: exec.description || desc,
        category: exec.category || 'sys',
        execute: (ctx: ExecutionContext) => {
          if (pkgType === 'wasm') {
            const bytes = bundleMeta.wasmBytes ? new Uint8Array(bundleMeta.wasmBytes) : globalWasmEngine.getDemoWasmBytecode();
            return globalWasmEngine.executeWasm(bytes, ctx);
          } else {
            const codeStr = bundleMeta.code || `return { stdout: "Running ${exec.name} (${pkgVersion})\\n", stderr: "", exitCode: 0 };`;
            return globalJsEngine.executeJsBundle(codeStr, ctx);
          }
        },
      }));

      const installedPkg: PackageMeta = {
        name: pkgName,
        version: pkgVersion,
        type: pkgType,
        sizeKb,
        description: desc,
        installed: true,
        executables,
      };

      this.repo.set(pkgName, installedPkg);

      // 1. Save original archive under /var/cache/apt/archives/
      const archivePath = `/var/cache/apt/archives/${pkgName}_${pkgVersion}_all.ear`;
      globalVFS.writeFile(archivePath, JSON.stringify(bundleMeta, null, 2));

      // 2. Unpack & physically extract runtime payload to /usr/lib/${pkgName}/bundle.json
      const libDirPath = `/usr/lib/${pkgName}`;
      const payloadFilePath = `${libDirPath}/bundle.json`;
      globalVFS.mkdir(libDirPath, true);
      globalVFS.writeFile(payloadFilePath, JSON.stringify(bundleMeta, null, 2));

      // 3. Build executable command linked directly to physical file /usr/lib/${pkgName}/bundle.json
      executables.forEach((cmd) => {
        const executableCmd: Command = {
          name: cmd.name,
          description: cmd.description,
          category: cmd.category,
          execute: (ctx) => {
            // Read physically extracted bundle payload from /usr/lib/pkgName/bundle.json
            const rawPayloadStr = ctx.vfs.readFile(payloadFilePath);
            if (!rawPayloadStr) {
              return { stdout: '', stderr: `bash: /usr/bin/${cmd.name}: Executable payload not found at '${payloadFilePath}'\n`, exitCode: 127 };
            }
            try {
              const meta = JSON.parse(rawPayloadStr);
              if (meta.type === 'wasm') {
                const bytes = meta.wasmBytes ? new Uint8Array(meta.wasmBytes) : globalWasmEngine.getDemoWasmBytecode();
                return globalWasmEngine.executeWasm(bytes, ctx);
              } else {
                const codeStr = meta.code || `return { stdout: "Running ${cmd.name} (${pkgVersion})\\n", stderr: "", exitCode: 0 };`;
                return globalJsEngine.executeJsBundle(codeStr, ctx);
              }
            } catch (err: any) {
              return { stdout: '', stderr: `[Runtime Error]: Failed to parse payload from '${payloadFilePath}': ${err.message}\n`, exitCode: 1 };
            }
          },
        };

        globalCommandRegistry.register(executableCmd);
        globalVFS.writeFile(`/usr/bin/${cmd.name}`, `#!/usr/bin/env node\n# Dynamic Package Executable Symbol linked to ${payloadFilePath}\n`);
        globalVFS.chmod(`/usr/bin/${cmd.name}`, 'rwxr-xr-x');
      });

      // 4. Save DPKG single package metadata and file list in /var/lib/dpkg/info/
      const installedFiles = [payloadFilePath];
      executables.forEach((c) => installedFiles.push(`/usr/bin/${c.name}`));

      globalVFS.writeFile(`/var/lib/dpkg/info/${pkgName}.info`, JSON.stringify(bundleMeta, null, 2));
      globalVFS.writeFile(`/var/lib/dpkg/info/${pkgName}.list`, installedFiles.join('\n') + '\n');

      this.syncDpkgStatus();

      return {
        success: true,
        message: `Get:1 ${fetchUrl} jammy/main all ${pkgName} all ${pkgVersion} [${sizeKb} kB]\nFetched ${sizeKb} kB in 0s (1.5 MB/s)\nSaved archive: ${archivePath}\nSelecting previously unselected package ${pkgName}.\nUnpacking ${pkgName} (${pkgVersion}) ...\nSetting up ${pkgName} (${pkgVersion}) ...\nProcessing triggers for man-db ...`,
      };
    } catch (e: any) {
      // Fallback for pre-installed built-in demo packages when offline
      if (pkg) {
        pkg.installed = true;
        const archivePath = `/var/cache/apt/archives/${pkg.name}_${pkg.version}_all.ear`;
        globalVFS.writeFile(archivePath, JSON.stringify(pkg, null, 2));

        const libDirPath = `/usr/lib/${pkg.name}`;
        const payloadFilePath = `${libDirPath}/bundle.json`;
        globalVFS.mkdir(libDirPath, true);
        globalVFS.writeFile(payloadFilePath, JSON.stringify(pkg, null, 2));

        const installedFiles = [payloadFilePath];

        pkg.executables.forEach((cmd) => {
          globalCommandRegistry.register(cmd);
          globalVFS.writeFile(`/usr/bin/${cmd.name}`, `#!/usr/bin/env node\n# Dynamic Package Executable Symbol for ${cmd.name}\n`);
          globalVFS.chmod(`/usr/bin/${cmd.name}`, 'rwxr-xr-x');
          installedFiles.push(`/usr/bin/${cmd.name}`);
        });

        globalVFS.writeFile(`/var/lib/dpkg/info/${pkg.name}.info`, JSON.stringify(pkg, null, 2));
        globalVFS.writeFile(`/var/lib/dpkg/info/${pkg.name}.list`, installedFiles.join('\n') + '\n');

        this.syncDpkgStatus();

        return {
          success: true,
          message: `Get:1 ${fetchUrl} [Offline Demo Mode]\nSaved archive: ${archivePath}\nSelecting previously unselected package ${pkg.name}.\nUnpacking ${pkg.name} (${pkg.version}) ...\nSetting up ${pkg.name} (${pkg.version}) ...\nProcessing triggers for man-db ...`,
        };
      }

      return {
        success: false,
        message: `Get:1 ${fetchUrl} [Connecting...]\nErr:1 ${fetchUrl}\n  ${e.message || 'Failed to fetch'}\n\x1b[31mE: Failed to fetch ${fetchUrl}\x1b[0m\nE: Unable to locate package ${nameOrUrl}`,
      };
    }
  }

  public removePackage(name: string): { success: boolean; message: string } {
    const pkg = this.repo.get(name);
    if (!pkg || !pkg.installed) {
      return { success: false, message: `Package '${name}' is not installed, so not removed` };
    }

    pkg.installed = false;

    // Unregister executables from memory CommandRegistry
    pkg.executables.forEach((cmd) => {
      globalCommandRegistry.unregister(cmd.name);
    });

    // Read authentic file list from /var/lib/dpkg/info/${name}.list to perform clean physical removal
    const listContent = globalVFS.readFile(`/var/lib/dpkg/info/${name}.list`);
    if (listContent) {
      const files = listContent.split('\n').filter(Boolean);
      files.forEach((f) => globalVFS.remove(f.trim()));
    } else {
      pkg.executables.forEach((cmd) => {
        globalVFS.remove(`/usr/bin/${cmd.name}`);
      });
      globalVFS.remove(`/usr/lib/${name}/bundle.json`);
      globalVFS.remove(`/usr/lib/${name}`);
    }

    // Clean up DPKG info metadata files
    globalVFS.remove(`/var/lib/dpkg/info/${name}.info`);
    globalVFS.remove(`/var/lib/dpkg/info/${name}.list`);

    this.syncDpkgStatus();

    return {
      success: true,
      message: `Removing ${pkg.name} (${pkg.version}) ...\nProcessing triggers for man-db ...`,
    };
  }

  public async upgradePackages(): Promise<{ success: boolean; log: string }> {
    const installed = Array.from(this.repo.values()).filter((p) => p.installed);
    const upgradable: { pkg: PackageMeta; newVer: string }[] = [];

    // Check for version diffs in repository
    installed.forEach((p) => {
      // Simple SemVer comparison helper
      const localVer = p.version;
      const infoStr = globalVFS.readFile(`/var/lib/dpkg/info/${p.name}.info`);
      let storedVer = localVer;
      if (infoStr) {
        try {
          const meta = JSON.parse(infoStr);
          storedVer = meta.version || localVer;
        } catch (e) { }
      }

      // Check if remote version is higher
      const remote = this.repo.get(p.name);
      if (remote && remote.version && remote.version !== storedVer) {
        upgradable.push({ pkg: p, newVer: remote.version });
      }
    });

    if (upgradable.length === 0) {
      const log = [
        'Reading package lists... Done',
        'Building dependency tree... Done',
        'Reading state information... Done',
        'Calculating upgrade... Done',
        '\x1b[32m0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\x1b[0m',
      ].join('\n');
      return { success: true, log };
    }

    // Perform upgrades
    const pkgNames = upgradable.map((u) => u.pkg.name).join(' ');
    let upgradeLog = [
      'Reading package lists... Done',
      'Building dependency tree... Done',
      'Reading state information... Done',
      'Calculating upgrade... Done',
      `The following packages will be upgraded:\n  \x1b[1;33m${pkgNames}\x1b[0m`,
      `${upgradable.length} upgraded, 0 newly installed, 0 to remove and 0 not upgraded.`,
    ];

    for (const item of upgradable) {
      const res = await this.installPackage(item.pkg.name);
      upgradeLog.push(`Preparing to unpack .../${item.pkg.name}_${item.newVer}_all.ear ...`);
      upgradeLog.push(`Unpacking ${item.pkg.name} (${item.newVer}) over (${item.pkg.version}) ...`);
      upgradeLog.push(`Setting up ${item.pkg.name} (${item.newVer}) ...`);
    }

    upgradeLog.push('\x1b[32mProcessing triggers for man-db ... System upgrade complete.\x1b[0m');

    return { success: true, log: upgradeLog.join('\n') };
  }
}

export const globalPkgManager = new PkgManager();
