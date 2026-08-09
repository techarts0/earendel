// Earendel User-space Process Manager Daemon Server (pmd)
import { globalIPCBus } from '../ipcBus';
import { globalTaskScheduler } from '../taskScheduler';
import { IPCMessage } from '../types';

export class PMDaemonService {
  public static readonly PID = 3;
  public static readonly SERVICE_NAME = 'pmd';

  constructor() {
    this.startServer();
  }

  public startServer() {
    globalIPCBus.registerService(
      PMDaemonService.SERVICE_NAME,
      PMDaemonService.PID,
      async (msg: IPCMessage) => this.handleIPCMessage(msg)
    );
  }

  private async handleIPCMessage(msg: IPCMessage): Promise<any> {
    const { action, payload } = msg;

    switch (action) {
      case 'SYS_GETPID': {
        return { pid: msg.senderPid };
      }

      case 'SYS_FORK': {
        const newPid = Math.floor(Math.random() * 800) + 200;
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
          fds: new Map([[0, '/dev/stdin'], [1, '/dev/stdout'], [2, '/dev/stderr']]),
        });
        return { childPid: pcb.pid };
      }

      case 'SYS_EXIT': {
        const ok = globalTaskScheduler.terminateProcess(msg.senderPid);
        return { terminated: ok };
      }

      default:
        throw new Error(`[pmd Error] Unknown action '${action}' received.`);
    }
  }
}

export const globalPMDaemon = new PMDaemonService();
