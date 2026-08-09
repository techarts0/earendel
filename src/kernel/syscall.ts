// Earendel POSIX System Call Entry Point & Dispatcher
import { SyscallNo, SyscallResult } from './types';
import { globalIPCBus } from './ipcBus';

export async function syscall(sysNo: SyscallNo, ...args: any[]): Promise<SyscallResult> {
  const currentCallerPid = 24; // Default terminal/shell caller PID

  try {
    switch (sysNo) {
      case SyscallNo.SYS_READ: {
        const [path] = args;
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'vfsd', 'SYS_READ', { path });
        return { code: 0, data: res.content };
      }

      case SyscallNo.SYS_WRITE: {
        const [path, content] = args;
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'vfsd', 'SYS_WRITE', { path, content });
        return { code: res.success ? 0 : -1 };
      }

      case SyscallNo.SYS_OPEN:
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
        const res = await globalIPCBus.sendIPC(currentCallerPid, 'pmd', 'SYS_EXIT', { pid: targetChildPid });
        return { code: 0, data: { status: 0, pid: targetChildPid } };
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
