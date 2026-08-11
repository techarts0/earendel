import { Command, ExecutionContext, ExecutionResult } from './types';
import { syscall } from '../kernel/syscall';
import { SyscallNo } from '../kernel/types';
import { globalVMPageTable } from '../kernel/vmPageTable';
import { globalKernelAgentManager } from '../kernel/agentFramework';

export class JsRuntimeEngine {
  /**
   * Safely instantiates and executes a dynamic JavaScript package closure
   */
  public async executeJsBundle(
    codeStr: string,
    ctx: ExecutionContext
  ): Promise<ExecutionResult> {
    const forkRes = await syscall(SyscallNo.SYS_FORK, 'node', '/home/hello');
    const childPid = forkRes.data || 302;
    globalVMPageTable.allocatePage(Math.floor(childPid / 10));

    let stdoutBuffer = '';
    let stderrBuffer = '';

    // Strip Hashbang/Shebang (e.g. #!/usr/bin/env node)
    const cleanCodeStr = codeStr.replace(/^#!.*(\r?\n|$)/, '');

    // Create virtualized console to capture stdout/stderr from dynamic JS packages
    const customConsole = {
      log: (...args: any[]) => {
        stdoutBuffer += args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ') + '\n';
      },
      error: (...args: any[]) => {
        stderrBuffer += args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ') + '\n';
      },
      warn: (...args: any[]) => {
        stdoutBuffer += '\x1b[33m' + args.join(' ') + '\x1b[0m\n';
      },
    };

    try {
      const runnerCode = [
        cleanCodeStr,
        'if (typeof main === "function") return main(ctx, eslib);',
        'if (typeof execute === "function") return execute(ctx, eslib);',
      ].join('\n');

      // Evaluate JS closure bundle passing ExecutionContext, eslib, syscall and custom console
      const runner = new Function(
        'ctx',
        'console',
        'process',
        'syscall',
        'eslib',
        runnerCode
      );

      let embeddedAssets: Record<string, string> = {};
      const scriptPath = ctx.args[0] || '';
      if (scriptPath.endsWith('.eaf')) {
        const rawEaf = ctx.vfs.readFile(scriptPath) || '';
        try {
          const eafObj = JSON.parse(rawEaf);
          if (eafObj.sections?.['.data']?.embeds) {
            embeddedAssets = eafObj.sections['.data'].embeds;
          }
        } catch (_) {}
      }

      const eslibObj = {
        sys: {
          read: (path: string) => syscall(SyscallNo.SYS_READ, path),
          write: (path: string, content: string) => syscall(SyscallNo.SYS_WRITE, path, content),
          fork: (name: string, cwd: string) => syscall(SyscallNo.SYS_FORK, name, cwd),
          execve: (path: string, args: string[]) => syscall(SyscallNo.SYS_EXECVE, path, args),
          exit: (code: number) => syscall(SyscallNo.SYS_EXIT, code),
          kill: (pid: number, signal?: number) => syscall(SyscallNo.SYS_KILL, pid, signal || 9),
          getpid: () => syscall(SyscallNo.SYS_GETPID),
          infer: async (prompt: string, opts?: any) => {
            const res = await syscall(SyscallNo.SYS_INFER, prompt, opts);
            return res.data;
          },
          getenv: (key: string) => ctx.env[key] ?? null,
          setenv: (key: string, val: string) => { ctx.env[key] = val; },
          getcwd: () => ctx.env['PWD'] || '/home/hello',
          chdir: (path: string) => {
            const resolved = ctx.vfs.resolvePath(path);
            const node = ctx.vfs.getNodeByPath(resolved);
            if (node && node.type === 'directory') {
              ctx.env['PWD'] = resolved;
              return true;
            }
            return false;
          },
          uname: () => ({
            sysname: 'Earendel-POSIX',
            nodename: ctx.env['HOSTNAME'] || 'earendel-microkernel',
            release: '6.5.0-generic',
            version: 'Earendel Microkernel v1.0.0-pure-posix',
            machine: 'x86_64',
          }),
          getEmbed: (filename: string) => embeddedAssets[filename] ?? null,
          readEmbed: (filename: string) => embeddedAssets[filename] ?? null,
        },
        fs: {
          stat: (path: string) => {
            const resolved = ctx.vfs.resolvePath(path);
            const node = ctx.vfs.getNodeByPath(resolved);
            if (!node) return null;
            return {
              name: node.name,
              size: node.size || 0,
              isDirectory: node.type === 'directory',
              isFile: node.type === 'file',
              isSymlink: node.type === 'symlink',
              owner: node.owner,
              group: node.group,
              permissions: node.permissions,
              updatedAt: node.updatedAt,
            };
          },
          exists: (path: string) => {
            const resolved = ctx.vfs.resolvePath(path);
            return ctx.vfs.getNodeByPath(resolved) !== null;
          },
          readdir: (path: string) => {
            const resolved = ctx.vfs.resolvePath(path);
            const node = ctx.vfs.getNodeByPath(resolved);
            if (!node || node.type !== 'directory' || !node.children) return [];
            return Array.from(node.children.keys());
          },
          mkdir: (path: string) => ctx.vfs.mkdir(ctx.vfs.resolvePath(path), true),
          unlink: (path: string) => ctx.vfs.remove(ctx.vfs.resolvePath(path), true),
          chmod: (path: string, mode: string) => ctx.vfs.chmod(ctx.vfs.resolvePath(path), mode),
        },
        io: {
          printf: (fmt: any, ...args: any[]) => {
            let str = String(fmt);
            args.forEach((a) => {
              str = str.replace('%s', String(a)).replace('%d', String(a)).replace('%x', Number(a).toString(16));
            });
            stdoutBuffer += str + '\n';
            return str;
          },
          puts: (str: string) => {
            stdoutBuffer += String(str) + '\n';
            return str;
          },
          color: (colorName: string, text: string) => {
            const colors: Record<string, string> = {
              red: '\x1b[31m',
              green: '\x1b[32m',
              yellow: '\x1b[33m',
              blue: '\x1b[34m',
              magenta: '\x1b[35m',
              cyan: '\x1b[36m',
              bold: '\x1b[1m',
              dim: '\x1b[90m',
              reset: '\x1b[0m',
            };
            const c = colors[colorName.toLowerCase()] || '';
            return `${c}${text}\x1b[0m`;
          },
        },
        net: {
          fetch: async (url: string) => {
            try {
              const resp = await fetch(url);
              const text = await resp.text();
              return {
                status: resp.status,
                ok: resp.ok,
                body: text,
                json: () => JSON.parse(text),
              };
            } catch (e: any) {
              return { status: 500, ok: false, body: e.message, json: () => ({ error: e.message }) };
            }
          },
          gethostbyname: async (domain: string) => {
            try {
              const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${domain}&type=A`, {
                headers: { accept: 'application/dns-json' },
              });
              const data = await res.json();
              const answers = data.Answer || [];
              const ip = answers.find((a: any) => a.type === 1)?.data || '127.0.0.1';
              return ip;
            } catch (_) {
              return '127.0.0.1';
            }
          },
        },
        mem: {
          malloc: (sizeBytes: number) => ({ ptr: Math.floor(Math.random() * 0x100000), size: sizeBytes }),
        },
        agent: {
          register: (agentObj: any) => {
            const agent = {
              id: agentObj.id || `agent_${Math.random().toString(36).substring(2, 7)}`,
              name: agentObj.name || 'User Agent',
              description: agentObj.description || 'User-defined application agent',
              isDaemon: Boolean(agentObj.isDaemon),
              enabled: agentObj.enabled ?? true,
              observe: async (obs: any) => (agentObj.observe ? agentObj.observe(obs) : true),
              infer: async (obs: any) => (agentObj.infer ? agentObj.infer(obs) : { actionType: 'LOG', reason: 'User agent infer pass' }),
              act: async (act: any) => (agentObj.act ? agentObj.act(act) : true),
            };
            globalKernelAgentManager.registerAgent(agent);
            return agent.id;
          },
          list: () => {
            return globalKernelAgentManager.getAgents().map((a: any) => ({
              id: a.id,
              name: a.name,
              isDaemon: a.isDaemon,
              enabled: a.enabled,
              description: a.description,
            }));
          },
          dispatch: async (source: string, event: string, payload: any) => {
            return globalKernelAgentManager.dispatchObservation(source as any, event, payload);
          },
        },
      };

      const res = await runner(
        ctx,
        customConsole,
        { env: ctx.env, argv: [ctx.args[0] || 'node', ...ctx.args] },
        syscall,
        eslibObj
      );

      if (res && typeof res === 'object') {
        await syscall(SyscallNo.SYS_EXIT, childPid);
        const finalStdout = res.stdout || stdoutBuffer;
        const debugDump = finalStdout.trim() ? finalStdout : `\x1b[33m[jsRuntime Debug]: Bundle executed (exitCode: 0), but no stdout was generated.\x1b[0m\n\x1b[90mExecuted Code:\n${cleanCodeStr}\x1b[0m\n`;
        return {
          stdout: debugDump,
          stderr: res.stderr || stderrBuffer,
          exitCode: typeof res.exitCode === 'number' ? res.exitCode : 0,
        };
      }

      await syscall(SyscallNo.SYS_EXIT, childPid);
      const debugDump = stdoutBuffer.trim() ? stdoutBuffer : `\x1b[33m[jsRuntime Debug]: Bundle executed (exitCode: 0), but no stdout was generated.\x1b[0m\n\x1b[90mExecuted Code:\n${cleanCodeStr}\x1b[0m\n`;
      return { stdout: debugDump, stderr: stderrBuffer, exitCode: 0 };
    } catch (e: any) {
      await syscall(SyscallNo.SYS_EXIT, childPid);
      return {
        stdout: stdoutBuffer,
        stderr: `\x1b[31m[JS Runtime Exception]: ${e.message}\x1b[0m\n\x1b[90mSource Executed:\n${cleanCodeStr}\x1b[0m\n${stderrBuffer}`,
        exitCode: 1,
      };
    }
  }
}

export const globalJsEngine = new JsRuntimeEngine();
