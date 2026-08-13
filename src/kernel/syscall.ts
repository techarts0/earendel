import { SyscallNo, SyscallResult } from './types';
import { globalIPCBus } from './ipcBus';
import { globalKernelAgentManager } from './agentFramework';
import './services/netd';
import './services/waylandd';

export interface SyscallTraceEntry {
  sysNo: SyscallNo;
  name: string;
  argsStr: string;
  retvalStr: string;
}

let activeTracerCallback: ((entry: SyscallTraceEntry) => void) | null = null;

export function setSyscallTracer(callback: ((entry: SyscallTraceEntry) => void) | null) {
  activeTracerCallback = callback;
}

export async function syscall(sysNo: SyscallNo, ...args: any[]): Promise<SyscallResult> {
  const currentCallerPid = 24; // Default terminal/shell caller PID
  let sysName = SyscallNo[sysNo] ? SyscallNo[sysNo].replace(/^SYS_/, '').toLowerCase() : 'syscall';
  let formattedArgs = args.map((a) => (typeof a === 'string' ? `"${a}"` : JSON.stringify(a))).join(', ');
  let formattedRet = '0';

  // Kernel Agent Framework Interception Trap (Observe -> Infer -> Act)
  if (sysNo !== SyscallNo.SYS_INFER) {
    try {
      const actions = await globalKernelAgentManager.dispatchObservation('syscall', sysName, { sysNo, args, callerPid: currentCallerPid });
      const blockedAction = actions.find((a) => a.actionType === 'BLOCK');
      if (blockedAction) {
        return { code: -1, data: null, error: `[capAgentd AI Firewall Intercept] ${blockedAction.reason}` };
      }
    } catch (_) {}
  }

  try {
    let result: SyscallResult = { code: 0 };
    switch (sysNo) {
      case SyscallNo.SYS_READ: {
        const [target, count] = args;
        const payload = typeof target === 'number' ? { fd: target, count } : { path: target };
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'vfsd', 'SYS_READ', payload);
        result = { code: 0, data: res.content };
        formattedRet = res.content ? res.content.length.toString() : '0';
        break;
      }

      case SyscallNo.SYS_WRITE: {
        const [target, content] = args;
        const payload = typeof target === 'number' ? { fd: target, content } : { path: target, content };
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'vfsd', 'SYS_WRITE', payload);
        result = { code: res.success ? 0 : -1 };
        formattedRet = res.success ? (content ? content.length.toString() : '0') : '-1 (EACCES)';
        break;
      }

      case SyscallNo.SYS_OPEN: {
        const [path, flags] = args;
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'vfsd', 'SYS_OPEN', { path, flags });
        result = { code: 0, data: res.fd };
        formattedRet = res.fd !== undefined ? res.fd.toString() : '-1 (ENOENT)';
        break;
      }

      case SyscallNo.SYS_CLOSE: {
        const [fd] = args;
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'vfsd', 'SYS_CLOSE', { fd });
        result = { code: res.success ? 0 : -1 };
        formattedRet = res.success ? '0' : '-1 (EBADF)';
        break;
      }

      case SyscallNo.SYS_LSEEK: {
        const [fd, offset, whence] = args;
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'vfsd', 'SYS_LSEEK', { fd, offset, whence });
        result = { code: 0, data: res.offset };
        formattedRet = (res.offset || 0).toString();
        break;
      }

      case SyscallNo.SYS_STAT: {
        const [path] = args;
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'vfsd', 'SYS_STAT', { path });
        result = { code: 0, data: res };
        formattedRet = res ? '0' : '-1 (ENOENT)';
        break;
      }

      case SyscallNo.SYS_FORK: {
        const [name, cwd] = args;
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'pmd', 'SYS_FORK', { name, cwd });
        result = { code: 0, data: res.childPid };
        formattedRet = (res.childPid || 0).toString();
        break;
      }

      case SyscallNo.SYS_GETPID: {
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'pmd', 'SYS_GETPID', {});
        result = { code: 0, data: res.pid };
        formattedRet = (res.pid || 24).toString();
        break;
      }

      case SyscallNo.SYS_EXECVE: {
        const [progPath, progArgs] = args;
        const readRes = await globalIPCBus.sendIPC(currentCallerPid, 'vfsd', 'SYS_READ', { path: progPath });
        result = { code: 0, data: { path: progPath, content: readRes.content, args: progArgs } };
        formattedRet = '0';
        break;
      }

      case SyscallNo.SYS_WAITPID: {
        const [targetChildPid] = args;
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'pmd', 'SYS_WAITPID', { pid: targetChildPid });
        result = { code: 0, data: { status: 0, pid: targetChildPid } };
        formattedRet = targetChildPid ? targetChildPid.toString() : '0';
        break;
      }

      case SyscallNo.SYS_KILL: {
        const [targetPid, sig] = args;
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'pmd', 'SYS_KILL', { pid: targetPid, sig: sig || 15 });
        result = { code: res.success ? 0 : -1, data: res };
        formattedRet = res.success ? '0' : '-1 (ESRCH)';
        break;
      }

      case SyscallNo.SYS_INFER: {
        const [prompt, opts] = args;
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'driverd', 'SYS_INFER', { prompt, opts });
        result = { code: 0, data: res.response };
        formattedRet = res.response ? `"${res.response.slice(0, 30)}..."` : '0';
        break;
      }

      case SyscallNo.SYS_EXIT: {
        const [exitPid] = args;
        const res = await globalIPCBus.sendIPC(exitPid || currentCallerPid, 'pmd', 'SYS_EXIT', {});
        result = { code: 0, data: res.terminated };
        formattedRet = '?';
        break;
      }

      case SyscallNo.SYS_NET_FETCH: {
        const [url, opts] = args;
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'netd', 'SYS_NET_FETCH', { url, ...(opts || {}) });
        result = { code: res.ok ? 0 : -1, data: res };
        formattedRet = res.status ? res.status.toString() : '-1';
        break;
      }

      case SyscallNo.SYS_NET_SOCKET: {
        const [url, socketType] = args;
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'netd', 'SYS_NET_SOCKET', { url, type: socketType });
        result = { code: 0, data: res };
        formattedRet = res.socketId || '0';
        break;
      }

      case SyscallNo.SYS_NET_LISTEN: {
        const [port] = args;
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'netd', 'SYS_NET_LISTEN', { port });
        result = { code: 0, data: res };
        formattedRet = res.peerId || '0';
        break;
      }

      case SyscallNo.SYS_NET_RESOLVE: {
        const [hostname] = args;
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'netd', 'SYS_NET_RESOLVE', { hostname });
        result = { code: 0, data: res };
        formattedRet = res.ip || '0';
        break;
      }

      case SyscallNo.SYS_WAYLAND: {
        const [action, payload] = args;
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'waylandd', action || 'SYS_WAYLAND_CREATE_SURFACE', payload || {});
        result = { code: res.error ? -1 : 0, data: res };
        formattedRet = res.error ? '-1' : '0';
        break;
      }

      default:
        result = { code: -38, error: `ENOSYS: System call ${sysNo} not implemented` };
        formattedRet = '-1 (ENOSYS)';
    }

    if (activeTracerCallback) {
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
