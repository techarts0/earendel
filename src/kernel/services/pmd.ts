// Earendel User-space Process Manager Daemon Server (pmd)
import { globalIPCBus } from '../ipcBus';
import { globalTaskScheduler } from '../taskScheduler';
import { IPCMessage, Signal } from '../types';
import { globalCapabilityManager } from '../capability';
import { globalVMPageTable } from '../vmPageTable';

export class PMDaemon {
  private static readonly MAX_PROCESS_NAME_CHARS = 128;
  private static readonly MAX_WORKING_DIRECTORY_CHARS = 4096;
  private pmdPid = 3;
  private nextPid = 200;

  constructor() {
    this.registerPMDaemon();
  }

  private registerPMDaemon() {
    globalIPCBus.registerService('pmd', this.pmdPid, this.handleIPCMessage.bind(this));
  }

  private async handleIPCMessage(msg: IPCMessage): Promise<any> {
    const { action, payload } = msg;

    switch (action) {
      case 'SYS_GETPID': {
        return { pid: msg.senderPid };
      }

      case 'SYS_FORK': {
        const parent = globalTaskScheduler.getProcess(msg.senderPid);
        if (!parent) return { error: 'ESRCH: Caller process does not exist' };
        const processName = payload?.name ?? 'subshell';
        const cwd = payload?.cwd ?? parent.cwd;
        if (typeof processName !== 'string' || !processName.trim() || processName.length > PMDaemon.MAX_PROCESS_NAME_CHARS || processName.includes('\0')) {
          return { error: `EINVAL: process name must be 1-${PMDaemon.MAX_PROCESS_NAME_CHARS} characters without NUL` };
        }
        if (typeof cwd !== 'string' || !cwd.startsWith('/') || cwd.length > PMDaemon.MAX_WORKING_DIRECTORY_CHARS || cwd.includes('\0')) {
          return { error: `EINVAL: working directory must be an absolute path of at most ${PMDaemon.MAX_WORKING_DIRECTORY_CHARS} characters` };
        }
        if (!globalTaskScheduler.canCreateProcess()) return { error: 'EAGAIN: process table is full' };
        while (globalTaskScheduler.getProcess(this.nextPid)) {
          this.nextPid++;
        }
        const newPid = this.nextPid++;
        const pcb = globalTaskScheduler.createProcess({
          pid: newPid,
          ppid: msg.senderPid,
          processGroupId: parent.processGroupId,
          name: processName,
          user: parent.user,
          state: 'RUNNING',
          startTime: new Date(),
          vszKB: 32000,
          rssKB: 8000,
          cpuUsagePercent: 0.2,
          cwd,
          // Fork duplicates the descriptor table while retaining references to
          // the same open-file descriptions (including their shared offsets).
          fds: new Map(parent.fds || [
            [0, { fd: 0, path: '/dev/stdin', offset: 0, flags: 'r' as const }],
            [1, { fd: 1, path: '/dev/stdout', offset: 0, flags: 'w' as const }],
            [2, { fd: 2, path: '/dev/stderr', offset: 0, flags: 'w' as const }],
          ]),
        });
        try {
          globalVMPageTable.allocateProcessPage(pcb.pid);
        } catch (error) {
          globalTaskScheduler.terminateProcess(pcb.pid);
          return { error: `ENOMEM: Unable to allocate process memory (${error instanceof Error ? error.message : 'out of memory'})` };
        }
        globalCapabilityManager.copyCapabilities(msg.senderPid, pcb.pid);
        return { childPid: pcb.pid };
      }

      case 'SYS_WAITPID': {
        const targetPid = Number(payload?.pid);
        if (!Number.isSafeInteger(targetPid) || targetPid <= 0) return { error: 'EINVAL: Invalid PID' };
        const waitResult = await globalTaskScheduler.waitForChild(msg.senderPid, targetPid);
        return waitResult.error
          ? waitResult
          : { status: waitResult.status ?? 0, pid: targetPid, exited: true };
      }

      case 'SYS_KILL': {
        const targetPid = payload.pid;
        const sig = payload.sig === undefined ? 15 : payload.sig;
        if (!Number.isSafeInteger(targetPid)) return { success: false, error: 'EINVAL: Invalid PID' };
        const supportedSignals = new Set<number>([
          0, // POSIX existence/permission probe; never delivered to the target.
          Signal.SIGHUP, Signal.SIGINT, Signal.SIGQUIT, Signal.SIGKILL,
          Signal.SIGUSR1, Signal.SIGUSR2, Signal.SIGTERM, Signal.SIGCONT, Signal.SIGSTOP,
        ]);
        if (!Number.isSafeInteger(sig) || !supportedSignals.has(sig)) {
          return { success: false, error: 'EINVAL: Unsupported signal number' };
        }
        const pcb = globalTaskScheduler.getProcess(targetPid);
        if (!pcb) return { success: false, error: 'ESRCH: No such process' };
        if (pcb.state === 'ZOMBIE') return { success: false, error: 'ESRCH: No such process' };
        const hasTargetCapability = globalCapabilityManager.hasCapability(msg.senderPid, 'CAP_KILL', String(targetPid));
        if (!hasTargetCapability && !globalTaskScheduler.isProcessInCallerTree(msg.senderPid, targetPid)) {
          return { success: false, error: `EPERM: PID ${msg.senderPid} cannot signal PID ${targetPid}` };
        }

        if (sig === 0) return { success: true, pid: targetPid, sig };

        if (sig === 9 || sig === 15) {
          if (!globalTaskScheduler.exitProcess(targetPid, 128 + sig)) {
            return { success: false, error: 'EPERM: Operation not permitted' };
          }
        } else if (sig === 1 || sig === 2 || sig === 3 || sig === 10 || sig === 12) {
          if (!pcb.pendingSignals) pcb.pendingSignals = [];
          if (!pcb.pendingSignals.includes(sig)) pcb.pendingSignals.push(sig);
        } else if (sig === 19) {
          globalTaskScheduler.updateState(targetPid, 'BLOCKED');
        } else if (sig === 18) {
          globalTaskScheduler.updateState(targetPid, 'RUNNING');
        }

        return { success: true, pid: targetPid, sig };
      }

      case 'SYS_EXIT': {
        const ok = globalTaskScheduler.exitProcess(msg.senderPid, payload?.code ?? 0);
        return { terminated: ok, pid: msg.senderPid, code: payload?.code ?? 0 };
      }

      default:
        throw new Error(`PMD: Unknown action ${action}`);
    }
  }
}

export const globalPMDaemon = new PMDaemon();
