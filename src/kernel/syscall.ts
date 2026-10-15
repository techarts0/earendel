import { SyscallNo, SyscallResult } from './types';
import { globalIPCBus } from './ipcBus';
import { globalKernelAgentManager } from './agentFramework';
import { globalCapabilityManager, CapabilityType } from './capability';
import { globalTaskScheduler } from './taskScheduler';
import './services/netd';
import './services/waylandd';

export interface SyscallTraceEntry {
  sysNo: SyscallNo;
  name: string;
  argsStr: string;
  retvalStr: string;
}

let activeTracerCallback: ((entry: SyscallTraceEntry) => void) | null = null;
const RESOURCE_ARG_SYSCALLS = new Set([
  SyscallNo.SYS_READ, SyscallNo.SYS_WRITE, SyscallNo.SYS_OPEN,
  SyscallNo.SYS_STAT, SyscallNo.SYS_EXECVE, SyscallNo.SYS_NET_FETCH,
  SyscallNo.SYS_NET_SOCKET, SyscallNo.SYS_NET_RESOLVE,
]);

function formatTraceArgs(args: any[]): string {
  return args.slice(0, 8).map((value) => {
    if (typeof value === 'string') {
      const visible = value.slice(0, 160);
      return JSON.stringify(visible) + (value.length > visible.length ? `…[${value.length} chars]` : '');
    }
    if (value === null || ['number', 'boolean', 'undefined'].includes(typeof value)) return String(value);
    if (Array.isArray(value)) return `[Array(${value.length})]`;
    return '[Object]';
  }).join(', ') + (args.length > 8 ? `, …[${args.length - 8} more]` : '');
}

function summarizeSyscallArgs(sysNo: SyscallNo, args: any[]): { argumentCount: number; args: Array<{ type: string; length?: number; value?: number | boolean | null; resource?: string }> } {
  const summarized = args.slice(0, 8).map((value, index) => {
    if (typeof value === 'string') {
      let resource: string | undefined;
      if (index === 0 && RESOURCE_ARG_SYSCALLS.has(sysNo)) {
        if (sysNo === SyscallNo.SYS_NET_FETCH || sysNo === SyscallNo.SYS_NET_SOCKET) {
          try { resource = new URL(value).origin; } catch {
            try { resource = new URL(`https://${value}`).origin; } catch { resource = '[invalid network target]'; }
          }
        } else resource = value.slice(0, 256);
      }
      return { type: 'string', length: value.length, ...(resource === undefined ? {} : { resource }) };
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) return { type: typeof value, value };
    if (Array.isArray(value)) return { type: 'array', length: value.length };
    return { type: typeof value };
  });
  return { argumentCount: args.length, args: summarized };
}

export function setSyscallTracer(callback: ((entry: SyscallTraceEntry) => void) | null) {
  activeTracerCallback = callback;
}

export async function syscall(sysNo: SyscallNo, ...args: any[]): Promise<SyscallResult> {
  // A syscall without a kernel-issued caller identity must never inherit the
  // interactive terminal's privileges. Keep this entry point only to return a
  // clear failure to legacy callers while they are migrated to syscallAs().
  void sysNo;
  void args;
  return { code: -1, error: 'EPERM: syscall caller identity is required' };
}

export async function syscallAs(currentCallerPid: number, sysNo: SyscallNo, ...args: any[]): Promise<SyscallResult> {
  if (!Number.isSafeInteger(currentCallerPid) || currentCallerPid <= 0) {
    return { code: -1, error: 'EINVAL: invalid caller PID' };
  }
  const callerProcess = globalTaskScheduler.getProcess(currentCallerPid);
  if (!callerProcess || callerProcess.state !== 'RUNNING') {
    return { code: -1, error: `ESRCH: caller PID ${currentCallerPid} is not an active process` };
  }
  let sysName = SyscallNo[sysNo] ? SyscallNo[sysNo].replace(/^SYS_/, '').toLowerCase() : 'syscall';
  let formattedArgs = '';
  let formattedRet = '0';
  const ipc = (serviceName: string, action: string, payload: any) =>
    globalIPCBus.sendIPC(globalIPCBus.getProcessEndpoint(currentCallerPid), serviceName, action, payload);

  const denyUnless = (cap: CapabilityType, resource?: string): SyscallResult | null =>
    globalCapabilityManager.hasCapability(currentCallerPid, cap, resource)
      ? null
      : { code: -1, error: `EACCES: PID ${currentCallerPid} lacks ${cap}${resource ? ` for '${resource}'` : ''}` };

  // Deterministic kernel authorization runs synchronously before touching a service.
  // Model agents below are telemetry/advice only and cannot override this decision.
  let denied: SyscallResult | null = null;
  switch (sysNo) {
    case SyscallNo.SYS_READ:
    case SyscallNo.SYS_STAT:
    case SyscallNo.SYS_EXECVE: {
      const resource = args[0];
      denied = typeof resource === 'number' && sysNo === SyscallNo.SYS_READ
        ? (globalCapabilityManager.hasAnyCapability(currentCallerPid, 'CAP_VFS_READ') ? null : denyUnless('CAP_VFS_READ'))
        : denyUnless('CAP_VFS_READ', typeof resource === 'string' ? resource : undefined);
      break;
    }
    case SyscallNo.SYS_OPEN: {
      const [path, flags] = args;
      const flagText = typeof flags === 'string' ? flags.toLowerCase() : JSON.stringify(flags || 'r').toLowerCase();
      const needsWrite = /w|a|\+|create|trunc/.test(flagText);
      denied = needsWrite && path === '/dev/null'
        ? null
        : denyUnless(needsWrite ? 'CAP_VFS_WRITE' : 'CAP_VFS_READ', path);
      if (!denied && needsWrite && /\+/.test(flagText)) denied = denyUnless('CAP_VFS_READ', path);
      break;
    }
    case SyscallNo.SYS_WRITE: {
      const [target] = args;
      denied = typeof target === 'number'
        ? (globalCapabilityManager.hasAnyCapability(currentCallerPid, 'CAP_VFS_WRITE') ? null : denyUnless('CAP_VFS_WRITE'))
        : target === '/dev/null' ? null
          : denyUnless('CAP_VFS_WRITE', typeof target === 'string' ? target : undefined);
      break;
    }
    case SyscallNo.SYS_KILL: {
      const targetPid = args[0];
      const target = Number.isSafeInteger(targetPid) ? globalTaskScheduler.getProcess(targetPid) : null;
      const hasTargetCapability = Number.isSafeInteger(targetPid) &&
        globalCapabilityManager.hasCapability(currentCallerPid, 'CAP_KILL', String(targetPid));
      denied = !target || (!hasTargetCapability && !globalTaskScheduler.isProcessInCallerTree(currentCallerPid, targetPid))
        ? { code: -1, error: `EPERM: PID ${currentCallerPid} cannot signal PID ${String(targetPid)}` }
        : null;
      break;
    }
    case SyscallNo.SYS_NET_FETCH:
    case SyscallNo.SYS_NET_SOCKET:
    case SyscallNo.SYS_NET_LISTEN:
    case SyscallNo.SYS_NET_RESOLVE:
      denied = denyUnless('CAP_NET_ADMIN', typeof args[0] === 'string' ? args[0] : undefined);
      break;
  }
  if (denied) return denied;

  // Agents are advisory observers only: model latency or failure must never gate a syscall.
  if (sysNo !== SyscallNo.SYS_INFER) {
    globalKernelAgentManager.enqueueObservation('syscall', sysName, {
      sysNo,
      callerPid: currentCallerPid,
      ...summarizeSyscallArgs(sysNo, args),
    });
  }

  try {
    let result: SyscallResult = { code: 0 };
    switch (sysNo) {
      case SyscallNo.SYS_READ: {
        const [target, count] = args;
        const payload = typeof target === 'number' ? { fd: target, count } : { path: target };
        const res = await ipc('vfsd', 'SYS_READ', payload);
        result = res.error ? { code: -1, data: null, error: res.error } : { code: 0, data: res.content };
        formattedRet = res.content ? res.content.length.toString() : '0';
        break;
      }

      case SyscallNo.SYS_WRITE: {
        const [target, content] = args;
        const payload = typeof target === 'number' ? { fd: target, content } : { path: target, content };
        const res = await ipc('vfsd', 'SYS_WRITE', payload);
        result = { code: res.success ? 0 : -1, error: res.success ? undefined : res.error };
        formattedRet = res.success ? (content ? content.length.toString() : '0') : '-1 (EACCES)';
        break;
      }

      case SyscallNo.SYS_OPEN: {
        const [path, flags] = args;
        const res = await ipc('vfsd', 'SYS_OPEN', { path, flags });
        result = res.fd === undefined ? { code: -1, error: res.error || 'open failed' } : { code: 0, data: res.fd };
        formattedRet = res.fd !== undefined ? res.fd.toString() : '-1 (ENOENT)';
        break;
      }

      case SyscallNo.SYS_CLOSE: {
        const [fd] = args;
        const res = await ipc('vfsd', 'SYS_CLOSE', { fd });
        result = { code: res.success ? 0 : -1 };
        formattedRet = res.success ? '0' : '-1 (EBADF)';
        break;
      }

      case SyscallNo.SYS_LSEEK: {
        const [fd, offset, whence] = args;
        const res = await ipc('vfsd', 'SYS_LSEEK', { fd, offset, whence });
        result = res.offset < 0 ? { code: -1, error: res.error || 'seek failed' } : { code: 0, data: res.offset };
        formattedRet = (res.offset || 0).toString();
        break;
      }

      case SyscallNo.SYS_STAT: {
        const [path] = args;
        const res = await ipc('vfsd', 'SYS_STAT', { path });
        result = res?.exists ? { code: 0, data: res } : { code: -1, data: res, error: 'ENOENT: No such file' };
        formattedRet = res?.exists ? '0' : '-1 (ENOENT)';
        break;
      }

      case SyscallNo.SYS_FORK: {
        const [name, cwd] = args;
        const res = await ipc('pmd', 'SYS_FORK', { name, cwd });
        result = res.childPid ? { code: 0, data: res.childPid } : { code: -1, error: res.error || 'fork failed' };
        formattedRet = (res.childPid || 0).toString();
        break;
      }

      case SyscallNo.SYS_GETPID: {
        const res = await ipc('pmd', 'SYS_GETPID', {});
        result = { code: 0, data: res.pid };
        formattedRet = (res.pid || 24).toString();
        break;
      }

      case SyscallNo.SYS_EXECVE: {
        const [progPath, progArgs] = args;
        const readRes = await ipc('vfsd', 'SYS_READ', { path: progPath });
        result = readRes.error
          ? { code: -1, error: readRes.error }
          : { code: 0, data: { path: progPath, content: readRes.content, args: progArgs } };
        formattedRet = readRes.error ? '-1 (EACCES)' : '0';
        break;
      }

      case SyscallNo.SYS_WAITPID: {
        const [targetChildPid] = args;
        const res = await ipc('pmd', 'SYS_WAITPID', { pid: targetChildPid });
        result = res.error
          ? { code: -1, error: res.error }
          : { code: 0, data: res };
        formattedRet = res.error ? '-1 (ECHILD)' : String(targetChildPid || 0);
        break;
      }

      case SyscallNo.SYS_KILL: {
        const [targetPid, sig] = args;
        const res = await ipc('pmd', 'SYS_KILL', { pid: targetPid, sig });
        result = res.success ? { code: 0, data: res } : { code: -1, data: res, error: res.error };
        formattedRet = res.success ? '0' : '-1 (ESRCH)';
        break;
      }

      case SyscallNo.SYS_INFER: {
        const [prompt, opts] = args;
        const res = await ipc('driverd', 'SYS_INFER', { prompt, opts });
        result = { code: 0, data: res.response };
        formattedRet = res.response ? `"${res.response.slice(0, 30)}..."` : '0';
        break;
      }

      case SyscallNo.SYS_EXIT: {
        const [exitCode] = args;
        const res = await ipc('pmd', 'SYS_EXIT', { code: exitCode });
        result = res.terminated ? { code: 0, data: true } : { code: -1, data: false, error: 'EPERM: Process cannot exit' };
        formattedRet = '?';
        break;
      }

      case SyscallNo.SYS_NET_FETCH: {
        const [url, opts] = args;
        const res = await ipc('netd', 'SYS_NET_FETCH', { url, ...(opts || {}) });
        result = { code: res.ok ? 0 : -1, data: res };
        formattedRet = res.status ? res.status.toString() : '-1';
        break;
      }

      case SyscallNo.SYS_NET_SOCKET: {
        const [url, socketType] = args;
        const res = await ipc('netd', 'SYS_NET_SOCKET', { url, type: socketType });
        result = res.error ? { code: -1, data: res, error: res.error } : { code: 0, data: res };
        formattedRet = res.socketId || '0';
        break;
      }

      case SyscallNo.SYS_NET_LISTEN: {
        const [port] = args;
        const res = await ipc('netd', 'SYS_NET_LISTEN', { port });
        result = res.error ? { code: -1, data: res, error: res.error } : { code: 0, data: res };
        formattedRet = res.peerId || '0';
        break;
      }

      case SyscallNo.SYS_NET_RESOLVE: {
        const [hostname] = args;
        const res = await ipc('netd', 'SYS_NET_RESOLVE', { hostname });
        result = res.ip ? { code: 0, data: res } : { code: -1, data: res, error: res.error || 'EHOSTUNREACH' };
        formattedRet = res.ip || '0';
        break;
      }

      case SyscallNo.SYS_WAYLAND: {
        const [action, payload] = args;
        const res = await ipc('waylandd', action || 'SYS_WAYLAND_CREATE_SURFACE', payload || {});
        result = { code: res.error ? -1 : 0, data: res };
        formattedRet = res.error ? '-1' : '0';
        break;
      }

      default:
        result = { code: -38, error: `ENOSYS: System call ${sysNo} not implemented` };
        formattedRet = '-1 (ENOSYS)';
    }

    if (activeTracerCallback) {
      formattedArgs = formatTraceArgs(args);
      activeTracerCallback({
        sysNo,
        name: sysName,
        argsStr: formattedArgs,
        retvalStr: formattedRet,
      });
    }

    return result;
  } catch (e: any) {
    if (activeTracerCallback) {
      formattedArgs = formatTraceArgs(args);
      activeTracerCallback({
        sysNo,
        name: sysName,
        argsStr: formattedArgs,
        retvalStr: `-1 (EFAULT: ${e.message})`,
      });
    }
    return { code: -1, error: e.message };
  }
}
