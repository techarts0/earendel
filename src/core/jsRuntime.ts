import { Command, ExecutionContext, ExecutionResult } from './types';
import { syscallAs } from '../kernel/syscall';
import { SyscallNo } from '../kernel/types';
import { globalKernelAgentManager } from '../kernel/agentFramework';
import { globalIPCBus } from '../kernel/ipcBus';
import { eslibNet } from './eslibNet';
import { createCapabilityVfsView } from './scopedVfs';
import { runEafInWorker } from './eafWorker';

export class JsRuntimeEngine {
  /**
   * Safely instantiates and executes a dynamic JavaScript package closure
   */
  public async executeJsBundle(
    codeStr: string,
    ctx: ExecutionContext
  ): Promise<ExecutionResult> {
    const forkRes = await ctx.syscall(SyscallNo.SYS_FORK, 'node', ctx.env.PWD || '/home/hello');
    if (forkRes.code !== 0 || !Number.isSafeInteger(forkRes.data)) {
      return { stdout: '', stderr: `node: unable to create process: ${forkRes.error || 'fork failed'}\n`, exitCode: 1 };
    }
    const childPid = forkRes.data as number;
    const executionAbortController = new AbortController();
    const abortFromParent = () => executionAbortController.abort(ctx.abortSignal?.reason);
    if (ctx.abortSignal?.aborted) abortFromParent();
    else ctx.abortSignal?.addEventListener('abort', abortFromParent, { once: true });
    const childSyscall = (sysNo: SyscallNo, ...args: any[]) => {
      if (sysNo === SyscallNo.SYS_NET_FETCH) {
        const [url, options = {}] = args;
        return syscallAs(childPid, sysNo, url, {
          ...(options && typeof options === 'object' ? options : {}),
          signal: executionAbortController.signal,
        });
      }
      if (sysNo === SyscallNo.SYS_INFER) {
        const [prompt, options = {}] = args;
        return syscallAs(childPid, sysNo, prompt, {
          ...(options && typeof options === 'object' ? options : {}),
          signal: executionAbortController.signal,
        });
      }
      return syscallAs(childPid, sysNo, ...args);
    };
    const childVfs = createCapabilityVfsView(ctx.vfs, childPid, ctx.env.USER || 'hello', {
      abortSignal: executionAbortController.signal,
    });

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
      const runnerCode = `
        return (async () => {
          const __res = eval(${JSON.stringify(cleanCodeStr)});
          if (__res && typeof __res.then === 'function') {
            await __res;
          }
          if (typeof main === "function") await main(ctx, eslib);
          if (typeof execute === "function") return await execute(ctx, eslib);
        })();
      `;

      let embeddedAssets: Record<string, string> = {};
      const scriptPath = ctx.args[0] || '';
      if (scriptPath.endsWith('.eaf')) {
        const rawEaf = childVfs.readFile(scriptPath) || '';
        try {
          const eafObj = JSON.parse(rawEaf);
          if (eafObj.sections?.['.data']?.embeds) {
            embeddedAssets = eafObj.sections['.data'].embeds;
          }
        } catch (_) {}
      }

      const eslibObj = {
        sys: {
          read: (path: string) => childSyscall(SyscallNo.SYS_READ, path),
          write: (path: string, content: string) => childSyscall(SyscallNo.SYS_WRITE, path, content),
          fork: (name: string, cwd: string) => childSyscall(SyscallNo.SYS_FORK, name, cwd),
          execve: (path: string, args: string[]) => childSyscall(SyscallNo.SYS_EXECVE, path, args),
          exit: (code: number) => childSyscall(SyscallNo.SYS_EXIT, code),
          kill: (pid: number, signal?: number) => childSyscall(SyscallNo.SYS_KILL, pid, signal || 9),
          getpid: () => childSyscall(SyscallNo.SYS_GETPID),
          infer: async (prompt: string, opts?: any) => {
            const res = await childSyscall(SyscallNo.SYS_INFER, prompt, opts);
            if (res.code !== 0) throw new Error(res.error || 'Inference syscall failed');
            return res.data;
          },
          getenv: (key: string) => ctx.env[key] ?? null,
          setenv: (key: string, val: string) => { ctx.env[key] = val; },
          getcwd: () => ctx.env['PWD'] || '/home/hello',
          chdir: (path: string) => {
            const resolved = childVfs.resolvePath(path);
            const node = childVfs.getNodeByPath(resolved);
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
            const resolved = childVfs.resolvePath(path);
            const node = childVfs.getNodeByPath(resolved);
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
            const resolved = childVfs.resolvePath(path);
            return childVfs.getNodeByPath(resolved) !== null;
          },
          readdir: (path: string) => {
            const resolved = childVfs.resolvePath(path);
            const node = childVfs.getNodeByPath(resolved);
            if (!node || node.type !== 'directory' || !node.children) return [];
            return Array.from(node.children.keys());
          },
          mkdir: (path: string) => childVfs.mkdir(childVfs.resolvePath(path), true),
          unlink: (path: string) => childVfs.remove(childVfs.resolvePath(path), true),
          chmod: (path: string, mode: string) => childVfs.chmod(childVfs.resolvePath(path), mode),
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
              const response = await eslibNet.fetch(url, { signal: executionAbortController.signal }, childSyscall);
              if (!response?.ok) return { status: response?.status || 0, ok: false, body: response?.error || response?.statusText || 'Network request failed', json: () => ({ error: response?.error || response?.statusText }) };
              const text = response.body || '';
              return {
                status: response.status,
                ok: response.ok,
                body: text,
                json: () => JSON.parse(text),
              };
            } catch (e: any) {
              return { status: 500, ok: false, body: e.message, json: () => ({ error: e.message }) };
            }
          },
          gethostbyname: async (domain: string) => {
            try {
              return await eslibNet.gethostbyname(domain, childSyscall);
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
              observe: async (obs: any, signal?: AbortSignal) => (agentObj.observe ? agentObj.observe(obs, signal) : true),
              infer: async (obs: any, signal?: AbortSignal) => (agentObj.infer ? agentObj.infer(obs, signal) : { actionType: 'LOG', reason: 'User agent infer pass' }),
              act: async (act: any, signal?: AbortSignal) => (agentObj.act ? agentObj.act(act, signal) : true),
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
        wayland: {
          createSurface: async (opts?: any) => {
            return await globalIPCBus.sendIPC(globalIPCBus.getProcessEndpoint(childPid), 'waylandd', 'SYS_WAYLAND_CREATE_SURFACE', opts || {});
          },
          destroySurface: async (id: string) => {
            return await globalIPCBus.sendIPC(globalIPCBus.getProcessEndpoint(childPid), 'waylandd', 'SYS_WAYLAND_DESTROY_SURFACE', { id });
          },
          focusSurface: async (id: string) => {
            return await globalIPCBus.sendIPC(globalIPCBus.getProcessEndpoint(childPid), 'waylandd', 'SYS_WAYLAND_FOCUS_SURFACE', { id });
          },
          listSurfaces: async () => {
            return await globalIPCBus.sendIPC(globalIPCBus.getProcessEndpoint(childPid), 'waylandd', 'SYS_WAYLAND_LIST_SURFACES', {});
          },
          flushFramebuffer: async (id: string, bytesWritten?: number) => {
            return await globalIPCBus.sendIPC(globalIPCBus.getProcessEndpoint(childPid), 'waylandd', 'SYS_WAYLAND_FLUSH_FRAMEBUFFER', { id, bytesWritten });
          },
        },
      };

      let res: any;
      if (typeof window !== 'undefined') {
        let forksRequested = 0;
        let inferencesRequested = 0;
        let networkRequests = 0;
        let surfacesRequested = 0;
        const plainContext = {
          env: { ...ctx.env },
          lang: ctx.lang,
          args: [...ctx.args],
          pipeInput: ctx.pipeInput,
          callerPid: childPid,
          embeddedAssets,
        };
        const isolated = await runEafInWorker(
          cleanCodeStr,
          plainContext,
          { env: { ...ctx.env }, argv: ['node', ...ctx.args], pid: childPid },
          async (method, args) => {
            if (executionAbortController.signal.aborted) {
              throw new Error('ECANCELED: EAF process is no longer authorized to issue IPC requests');
            }
            if (method === 'syscall') {
              const [sysNo, ...sysArgs] = args;
              if (typeof sysNo !== 'number' || !Number.isInteger(sysNo)) throw new Error('EINVAL: invalid syscall number');
              if (sysNo === SyscallNo.SYS_FORK && ++forksRequested > 32) throw new Error('EAGAIN: EAF process creation limit exceeded');
              if (sysNo === SyscallNo.SYS_INFER && ++inferencesRequested > 30) throw new Error('EAGAIN: EAF inference limit exceeded');
              if ([SyscallNo.SYS_NET_FETCH, SyscallNo.SYS_NET_SOCKET, SyscallNo.SYS_NET_LISTEN, SyscallNo.SYS_NET_RESOLVE].includes(sysNo) && ++networkRequests > 100) {
                throw new Error('EAGAIN: EAF network request limit exceeded');
              }
              return childSyscall(sysNo as SyscallNo, ...sysArgs);
            }
            if (method.startsWith('vfs.')) {
              const name = method.slice(4);
              const operation = (childVfs as any)[name];
              if (typeof operation !== 'function') throw new Error(`ENOSYS: VFS operation '${name}' is unavailable`);
              return operation.apply(childVfs, args);
            }
            if (method.startsWith('eslib.agent.')) {
              throw new Error('EACCES: direct Agent registry operations are unavailable to EAF programs');
            }
            if (method === 'eslib.sys.fork' && ++forksRequested > 32) throw new Error('EAGAIN: EAF process creation limit exceeded');
            if (method === 'eslib.sys.infer' && ++inferencesRequested > 30) throw new Error('EAGAIN: EAF inference limit exceeded');
            if (method === 'eslib.net.fetch' && ++networkRequests > 100) throw new Error('EAGAIN: EAF network request limit exceeded');
            if (method === 'eslib.wayland.createSurface' && ++surfacesRequested > 32) throw new Error('EAGAIN: EAF surface limit exceeded');
            if (method.startsWith('eslib.')) {
              const parts = method.slice(6).split('.');
              let target: any = eslibObj;
              for (const part of parts) {
                if (!target || !Object.prototype.hasOwnProperty.call(target, part)) {
                  throw new Error(`ENOSYS: EAF operation '${method}' is unavailable`);
                }
                target = target[part];
              }
              if (typeof target !== 'function') throw new Error(`ENOSYS: EAF operation '${method}' is unavailable`);
              const value = await target(...args);
              if (method === 'eslib.net.fetch' && value && typeof value === 'object' && typeof value.json === 'function') {
                const { json: _json, ...cloneable } = value;
                return { ...cloneable, __workerJsonBody: String(value.body || '') };
              }
              return value;
            }
            throw new Error(`ENOSYS: EAF operation '${method}' is unavailable`);
          },
          executionAbortController.signal,
          60_000,
          (reason) => executionAbortController.abort(reason),
        );
        for (const entry of isolated.logs) {
          const line = entry.args.map((value) => {
            if (typeof value === 'string') return value;
            try { return JSON.stringify(value); } catch { return String(value); }
          }).join(' ');
          const bounded = line.slice(0, 16_384);
          if (entry.level === 'error') stderrBuffer += bounded + '\n';
          else stdoutBuffer += (entry.level === 'warn' ? '\x1b[33m' + bounded + '\x1b[0m' : bounded) + '\n';
        }
        if (isolated.error) throw new Error(isolated.error);
        if (isolated.env) {
          const authenticatedUser = ctx.env.USER;
          const homeDirectory = ctx.env.HOME;
          for (const key of Object.keys(ctx.env)) delete ctx.env[key];
          Object.assign(ctx.env, isolated.env);
          if (authenticatedUser !== undefined) ctx.env.USER = authenticatedUser;
          if (homeDirectory !== undefined) ctx.env.HOME = homeDirectory;
        }
        res = isolated.value;
      } else {
        // Non-browser execution (SSR and the deterministic verifier) has no
        // browser realm to expose; all browser builds fail closed into Worker.
        const runner = new Function(
          'ctx',
          'console',
          'process',
          'syscall',
          'eslib',
          runnerCode
        );
        const scriptContext = { ...ctx } as Partial<ExecutionContext>;
        scriptContext.callerPid = childPid;
        scriptContext.syscall = childSyscall;
        scriptContext.vfs = childVfs;
        delete scriptContext.processManager;
        res = await runner(
          scriptContext,
          customConsole,
          { env: ctx.env, argv: ['node', ...ctx.args], pid: childPid },
          childSyscall,
          eslibObj
        );
      }

      const finalStdout = (res && typeof res === 'object' && res.stdout) ? res.stdout : stdoutBuffer;
      const finalStderr = (res && typeof res === 'object' && res.stderr) ? res.stderr : stderrBuffer;
      const finalExitCode = (res && typeof res === 'object' && typeof res.exitCode === 'number') ? res.exitCode : 0;
      await childSyscall(SyscallNo.SYS_EXIT, finalExitCode);
      await ctx.syscall(SyscallNo.SYS_WAITPID, childPid);

      return {
        stdout: finalStdout,
        stderr: finalStderr,
        exitCode: finalExitCode,
      };
    } catch (e: any) {
      await childSyscall(SyscallNo.SYS_EXIT, 1);
      await ctx.syscall(SyscallNo.SYS_WAITPID, childPid);
      return {
        stdout: stdoutBuffer,
        stderr: `\x1b[31m[JS Runtime Exception]: ${e.message}\x1b[0m\n\x1b[90mSource Executed:\n${cleanCodeStr}\x1b[0m\n${stderrBuffer}`,
        exitCode: 1,
      };
    } finally {
      executionAbortController.abort(new Error('EAF process exited'));
      ctx.abortSignal?.removeEventListener('abort', abortFromParent);
    }
  }
}

export const globalJsEngine = new JsRuntimeEngine();
