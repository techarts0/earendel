// Earendel POSIX System Call Entry Point & Dispatcher
import { SyscallNo, SyscallResult } from './types';
import { globalIPCBus } from './ipcBus';

export async function syscall(sysNo: SyscallNo, ...args: any[]): Promise<SyscallResult> {
  const currentCallerPid = 24; // Default terminal/shell caller PID

  try {
    switch (sysNo) {
      case SyscallNo.SYS_READ: {
        const [target, count] = args;
        const payload = typeof target === 'number' ? { fd: target, count } : { path: target };
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'vfsd', 'SYS_READ', payload);
        return { code: 0, data: res.content };
      }

      case SyscallNo.SYS_WRITE: {
        const [target, content] = args;
        const payload = typeof target === 'number' ? { fd: target, content } : { path: target, content };
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'vfsd', 'SYS_WRITE', payload);
        return { code: res.success ? 0 : -1 };
      }

      case SyscallNo.SYS_OPEN: {
        const [path, flags] = args;
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'vfsd', 'SYS_OPEN', { path, flags });
        return { code: 0, data: res.fd };
      }

      case SyscallNo.SYS_CLOSE: {
        const [fd] = args;
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'vfsd', 'SYS_CLOSE', { fd });
        return { code: res.success ? 0 : -1 };
      }

      case SyscallNo.SYS_LSEEK: {
        const [fd, offset, whence] = args;
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'vfsd', 'SYS_LSEEK', { fd, offset, whence });
        return { code: 0, data: res.offset };
      }

      case SyscallNo.SYS_STAT: {
        const [path] = args;
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'vfsd', 'SYS_STAT', { path });
        return { code: 0, data: res };
      }

      case SyscallNo.SYS_FORK: {
        const [name, cwd] = args;
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'pmd', 'SYS_FORK', { name, cwd });
        return { code: 0, data: res.childPid };
      }

      case SyscallNo.SYS_GETPID: {
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'pmd', 'SYS_GETPID', {});
        return { code: 0, data: res.pid };
      }

      case SyscallNo.SYS_EXECVE: {
        const [progPath, progArgs] = args;
        const readRes = await globalIPCBus.sendIPC(currentCallerPid, 'vfsd', 'SYS_READ', { path: progPath });
        return { code: 0, data: { path: progPath, content: readRes.content, args: progArgs } };
      }

      case SyscallNo.SYS_WAITPID: {
        const [targetChildPid] = args;
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'pmd', 'SYS_WAITPID', { pid: targetChildPid });
        return { code: 0, data: { status: 0, pid: targetChildPid } };
      }

      case SyscallNo.SYS_KILL: {
        const [targetPid, sig] = args;
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'pmd', 'SYS_KILL', { pid: targetPid, sig: sig || 15 });
        return { code: res.success ? 0 : -1, data: res };
      }

      case SyscallNo.SYS_EXIT: {
        const [exitPid] = args;
        const res = await globalIPCBus.sendIPC(exitPid || currentCallerPid, 'pmd', 'SYS_EXIT', {});
        return { code: 0, data: res.terminated };
      }

      default:
        return { code: -38, error: `ENOSYS: System call ${sysNo} not implemented` };
    }
  } catch (e: any) {
    return { code: -1, error: e.message };
  }
}
