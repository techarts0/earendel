import { SyscallNo, SyscallResult } from './types';
import { globalIPCBus } from './ipcBus';
import { globalKernelAgentManager } from './agentFramework';
import { globalCapabilityManager, CapabilityType } from './capability';
import { globalTaskScheduler } from './taskScheduler';
import { resolveProcessPath } from './processPath';
import { globalVFS } from '../core/vfs';
import './services/netd';
import './services/waylandd';

export interface SyscallTraceEntry {
  callerPid: number;
  sysNo: SyscallNo;
  name: string;
  argsStr: string;
  retvalStr: string;
}

const syscallTracerCallbacks = new Map<number, (entry: SyscallTraceEntry) => void>();
const RESOURCE_ARG_SYSCALLS = new Set([
  SyscallNo.SYS_READ, SyscallNo.SYS_WRITE, SyscallNo.SYS_OPEN,
  SyscallNo.SYS_STAT, SyscallNo.SYS_EXECVE, SyscallNo.SYS_NET_FETCH,
  SyscallNo.SYS_NET_SOCKET, SyscallNo.SYS_NET_RESOLVE, SyscallNo.SYS_NET_CLOSE,
]);

function isArrayWithoutThrowing(value: unknown): boolean {
  try { return Array.isArray(value); } catch { return false; }
}

function formatTraceArgs(args: any[]): string {
  return args.slice(0, 8).map((value) => {
    if (typeof value === 'string') {
      const visible = value.slice(0, 160);
      return JSON.stringify(visible) + (value.length > visible.length ? `…[${value.length} chars]` : '');
    }
    if (value === null || ['number', 'boolean', 'undefined'].includes(typeof value)) return String(value);
    if (isArrayWithoutThrowing(value)) return '[Array]';
    return '[Object]';
  }).join(', ') + (args.length > 8 ? `, …[${args.length - 8} more]` : '');
}

function summarizeSyscallArgs(sysNo: SyscallNo, args: any[]): { argumentCount: number; args: Array<{ type: string; length?: number; value?: number | boolean | null; resource?: string }> } {
  const summarized = args.slice(0, 8).map((value, index) => {
    if (typeof value === 'string') {
      let resource: string | undefined;
      if (index === 0 && RESOURCE_ARG_SYSCALLS.has(sysNo)) {
        if (sysNo === SyscallNo.SYS_NET_FETCH || sysNo === SyscallNo.SYS_NET_SOCKET) {
          if (value.length > 2_048) resource = '[network target omitted: too long]';
          else try { resource = new URL(value).origin; } catch {
            try { resource = new URL(`https://${value}`).origin; } catch { resource = '[invalid network target]'; }
          }
        } else resource = value.slice(0, 256);
      }
      return { type: 'string', length: value.length, ...(resource === undefined ? {} : { resource }) };
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) return { type: typeof value, value };
    if (isArrayWithoutThrowing(value)) return { type: 'array' };
    return { type: typeof value };
  });
  return { argumentCount: args.length, args: summarized };
}

export function setSyscallTracer(callerPid: number, callback: ((entry: SyscallTraceEntry) => void) | null) {
  if (!Number.isSafeInteger(callerPid) || callerPid <= 0) return;
  if (callback) syscallTracerCallbacks.set(callerPid, callback);
  else syscallTracerCallbacks.delete(callerPid);
}

globalIPCBus.onProcessExit((pid) => syscallTracerCallbacks.delete(pid));

function emitSyscallTrace(callerPid: number, entry: Omit<SyscallTraceEntry, 'callerPid'>): void {
  const callback = syscallTracerCallbacks.get(callerPid);
  if (!callback) return;
  try {
    callback({ callerPid, ...entry });
  } catch {
    // Tracing is observational: a broken tracer must never change syscall results.
  }
}

function canTraverseToPath(path: string, user: string): boolean {
  const parts = path.split('/').filter(Boolean);
  let directoryPath = '/';
  let directory = globalVFS.getNodeByPath(directoryPath);
  if (!directory || directory.type !== 'directory' || !globalVFS.checkPermission(directory, 'x', user)) return false;
  for (const part of parts.slice(0, -1)) {
    directoryPath = directoryPath === '/' ? `/${part}` : `${directoryPath}/${part}`;
    directory = globalVFS.getNodeByPath(directoryPath);
    if (!directory || directory.type !== 'directory' || !globalVFS.checkPermission(directory, 'x', user)) return false;
  }
  return true;
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
  if (typeof sysNo !== 'number' || !Number.isSafeInteger(sysNo)) {
    return { code: -1, error: 'EINVAL: invalid syscall number' };
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
  const resolveCallerPath = (path: unknown): string | null =>
    (() => {
      const processPath = resolveProcessPath(path, callerProcess.cwd, callerProcess.user === 'root' ? '/root' : `/home/${callerProcess.user || 'hello'}`);
      return processPath ? globalVFS.resolveSymlinkPath(processPath, true, callerProcess.user || 'hello') : null;
    })();

  // Deterministic kernel authorization runs synchronously before touching a service.
  // Model agents below are telemetry/advice only and cannot override this decision.
  let denied: SyscallResult | null = null;
  switch (sysNo) {
    case SyscallNo.SYS_READ:
    case SyscallNo.SYS_STAT:
    case SyscallNo.SYS_EXECVE: {
      const resource = args[0];
      if (typeof resource === 'number' && sysNo === SyscallNo.SYS_READ) {
        denied = globalCapabilityManager.hasAnyCapability(currentCallerPid, 'CAP_VFS_READ') ? null : denyUnless('CAP_VFS_READ');
      } else if (typeof resource === 'string') {
        const path = resolveCallerPath(resource);
        denied = path ? denyUnless('CAP_VFS_READ', path) : { code: -1, error: 'EINVAL: Invalid or overlong path' };
      } else {
        denied = denyUnless('CAP_VFS_READ');
      }
      break;
    }
    case SyscallNo.SYS_OPEN: {
      const [path, flags] = args;
      // Accept only primitive modes supported by vfsd. Coercing an
      // attacker-controlled object with JSON.stringify can run its getters or
      // toJSON hook inside the kernel authorization path.
      const flagText = flags === undefined || flags === null || flags === 0
        ? 'r'
        : flags === 1
          ? 'w'
          : flags === 2
            ? 'rw'
            : typeof flags === 'string'
              ? flags.toLowerCase()
              : '';
      if (!['r', 'w', 'a', 'r+', 'w+', 'a+', 'rw'].includes(flagText)) {
        denied = { code: -1, error: 'EINVAL: Invalid open mode' };
        break;
      }
      const needsWrite = /w|a|\+|create|trunc/.test(flagText);
      const resolvedPath = typeof path === 'string' ? resolveCallerPath(path) : undefined;
      denied = needsWrite && path === '/dev/null'
        ? null
        : typeof path === 'string' && !resolvedPath
          ? { code: -1, error: 'EINVAL: Invalid or overlong path' }
          : denyUnless(needsWrite ? 'CAP_VFS_WRITE' : 'CAP_VFS_READ', resolvedPath ?? undefined);
      if (!denied && needsWrite && /\+/.test(flagText)) denied = denyUnless('CAP_VFS_READ', resolvedPath ?? undefined);
      break;
    }
    case SyscallNo.SYS_WRITE: {
      const [target] = args;
      if (typeof target === 'number') {
        denied = globalCapabilityManager.hasAnyCapability(currentCallerPid, 'CAP_VFS_WRITE') ? null : denyUnless('CAP_VFS_WRITE');
      } else if (target === '/dev/null') {
        denied = null;
      } else if (typeof target === 'string') {
        const path = resolveCallerPath(target);
        denied = path ? denyUnless('CAP_VFS_WRITE', path) : { code: -1, error: 'EINVAL: Invalid or overlong path' };
      } else {
        denied = denyUnless('CAP_VFS_WRITE');
      }
      break;
    }
    case SyscallNo.SYS_KILL: {
      const targetPid = args[0];
      const target = Number.isSafeInteger(targetPid) ? globalTaskScheduler.getProcess(targetPid) : null;
      const hasTargetCapability = Number.isSafeInteger(targetPid) &&
        globalCapabilityManager.hasCapability(currentCallerPid, 'CAP_KILL', String(targetPid));
      denied = !target || (!hasTargetCapability && !globalTaskScheduler.isProcessInCallerTree(currentCallerPid, targetPid))
        ? { code: -1, error: `EPERM: PID ${currentCallerPid} cannot signal PID ${typeof targetPid === 'number' ? targetPid : '<invalid>'}` }
        : null;
      break;
    }
    case SyscallNo.SYS_NET_FETCH:
    case SyscallNo.SYS_NET_SOCKET:
    case SyscallNo.SYS_NET_LISTEN:
    case SyscallNo.SYS_NET_RESOLVE:
      denied = denyUnless('CAP_NET_ADMIN', typeof args[0] === 'string' ? args[0] : undefined);
      break;
    case SyscallNo.SYS_INFER:
      denied = denyUnless('CAP_DEVICE_IO', '/dev/ai');
      break;
  }
  if (denied) {
    if (syscallTracerCallbacks.has(currentCallerPid)) {
      formattedArgs = formatTraceArgs(args);
      emitSyscallTrace(currentCallerPid, {
        sysNo,
        name: sysName,
        argsStr: formattedArgs,
        retvalStr: `-1 (${denied.error || 'denied'})`,
      });
    }
    return denied;
  }

  // Agents are advisory observers only: model latency or failure must never gate a syscall.
  if (sysNo !== SyscallNo.SYS_INFER) {
    const observationPayload = JSON.stringify({
      sysNo,
      callerPid: currentCallerPid,
      ...summarizeSyscallArgs(sysNo, args),
    }).slice(0, 2_048);
    globalKernelAgentManager.enqueueObservation('syscall', sysName, observationPayload);
  }

  try {
    let result: SyscallResult = { code: 0 };
    switch (sysNo) {
      case SyscallNo.SYS_READ: {
        const [target, count] = args;
        const payload = typeof target === 'number' ? { fd: target, count } : { path: target };
        const res = await ipc('vfsd', 'SYS_READ', payload);
        result = res.error ? { code: -1, data: null, error: res.error } : { code: 0, data: res.content };
        formattedRet = String(res.bytesRead ?? (res.content ? new TextEncoder().encode(res.content).byteLength : 0));
        break;
      }

      case SyscallNo.SYS_WRITE: {
        const [target, content] = args;
        const payload = typeof target === 'number' ? { fd: target, content } : { path: target, content };
        const res = await ipc('vfsd', 'SYS_WRITE', payload);
        result = { code: res.success ? 0 : -1, data: res.success ? res.bytesWritten : undefined, error: res.success ? undefined : res.error };
        formattedRet = res.success ? String(res.bytesWritten ?? new TextEncoder().encode(content).byteLength) : '-1 (EACCES)';
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
        const caller = globalTaskScheduler.getProcess(currentCallerPid);
        const user = caller?.user || 'hello';
        const path = typeof progPath === 'string' ? resolveCallerPath(progPath) : null;
        if (!path) {
          result = { code: -1, error: 'EINVAL: Invalid executable path' };
          formattedRet = '-1 (EINVAL)';
          break;
        }
        if (!canTraverseToPath(path, user)) {
          result = { code: -1, error: 'EACCES: Directory traversal denied' };
          formattedRet = '-1 (EACCES)';
          break;
        }
        const executable = globalVFS.getResolvedNodeByPath(path, user);
        if (!executable || executable.type !== 'file' || !executable.permissions.includes('x') ||
            (user !== 'root' && !globalVFS.checkPermission(executable, 'x', user))) {
          result = { code: -1, error: 'EACCES: File is not executable by this user' };
          formattedRet = '-1 (EACCES)';
          break;
        }
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
        result = res?.success === false
          ? { code: -1, error: res.error || 'EIO: inference service rejected the request' }
          : { code: 0, data: res.response };
        formattedRet = result.code !== 0 ? '-1' : res.response ? `"${res.response.slice(0, 30)}..."` : '0';
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

      case SyscallNo.SYS_NET_CLOSE: {
        const [socketId] = args;
        const res = await ipc('netd', 'SYS_NET_CLOSE', { socketId });
        result = res.error ? { code: -1, data: res, error: res.error } : { code: 0, data: res };
        formattedRet = res.success ? '0' : '-1';
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

    if (syscallTracerCallbacks.has(currentCallerPid)) {
      formattedArgs = formatTraceArgs(args);
      emitSyscallTrace(currentCallerPid, {
        sysNo,
        name: sysName,
        argsStr: formattedArgs,
        retvalStr: formattedRet,
      });
    }

    return result;
  } catch (e: any) {
    if (syscallTracerCallbacks.has(currentCallerPid)) {
      formattedArgs = formatTraceArgs(args);
      emitSyscallTrace(currentCallerPid, {
        sysNo,
        name: sysName,
        argsStr: formattedArgs,
        retvalStr: `-1 (EFAULT: ${e.message})`,
      });
    }
    return { code: -1, error: e.message };
  }
}
