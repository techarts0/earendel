// Earendel User-space Process Manager Daemon Server (pmd)
import { globalIPCBus } from '../ipcBus';
import { globalTaskScheduler } from '../taskScheduler';
import { IPCMessage } from '../types';

export class PMDaemon {
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
        const newPid = this.nextPid++;
        const pcb = globalTaskScheduler.createProcess({
          pid: newPid,
          ppid: msg.senderPid,
          name: payload.name || 'subshell',
          user: payload.user || 'hello',
          state: 'RUNNING',
          startTime: new Date(),
          vszKB: 32000,
          rssKB: 8000,
          cpuUsagePercent: 0.2,
          cwd: payload.cwd || '/home/hello',
          fds: new Map([
            [0, { fd: 0, path: '/dev/stdin', offset: 0, flags: 'r' }],
            [1, { fd: 1, path: '/dev/stdout', offset: 0, flags: 'w' }],
            [2, { fd: 2, path: '/dev/stderr', offset: 0, flags: 'w' }],
          ]),
        });
        return { childPid: pcb.pid };
      }

      case 'SYS_WAITPID': {
        const targetPid = payload.pid;
        if (targetPid) {
          globalTaskScheduler.terminateProcess(targetPid);
        }
        return { status: 0, pid: targetPid };
      }

      case 'SYS_KILL': {
        const targetPid = payload.pid;
        const sig = payload.sig || 15;
        const pcb = globalTaskScheduler.getProcess(targetPid);
        if (!pcb) return { success: false, error: 'ESRCH: No such process' };

        if (sig === 9 || sig === 15) {
          globalTaskScheduler.terminateProcess(targetPid);
        } else if (sig === 19) {
          globalTaskScheduler.updateState(targetPid, 'BLOCKED');
        } else if (sig === 18) {
          globalTaskScheduler.updateState(targetPid, 'RUNNING');
        }

        if (!pcb.pendingSignals) pcb.pendingSignals = [];
        pcb.pendingSignals.push(sig);
        return { success: true, pid: targetPid, sig };
      }

      case 'SYS_EXIT': {
        const pidToTerminate = payload.pid || msg.senderPid;
        const ok = globalTaskScheduler.terminateProcess(pidToTerminate);
        return { terminated: ok, pid: pidToTerminate };
      }

      default:
        throw new Error(`PMD: Unknown action ${action}`);
    }
  }
}

export const globalPMDaemon = new PMDaemon();
