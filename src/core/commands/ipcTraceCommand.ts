import { Command } from '../types';
import { globalIPCBus } from '../../kernel/ipcBus';

let isIPCTraceEnabled = true;

export const ipcTraceCommand: Command = {
  name: 'ipc-trace',
  description: 'Inspect and trace microkernel IPC daemon message traffic',
  category: 'sys',
  execute: (ctx) => {
    const sub = ctx.args[0] || 'dump';

    if (sub === 'on') {
      isIPCTraceEnabled = true;
      return { stdout: 'Microkernel IPC Message Tracing ENABLED.\n', stderr: '', exitCode: 0 };
    }

    if (sub === 'off') {
      isIPCTraceEnabled = false;
      return { stdout: 'Microkernel IPC Message Tracing DISABLED.\n', stderr: '', exitCode: 0 };
    }

    const logs = globalIPCBus.getIPCLogs();
    let out = `Earendel Microkernel IPC Message Traces (${logs.length} entries):\n\n`;
    out += `TIMESTAMP   SENDER -> TARGET    SERVICE    ACTION       PAYLOAD\n`;
    out += `----------------------------------------------------------------------\n`;

    for (const log of logs.slice(-20)) {
      const timeStr = `${new Date(log.timestamp).toLocaleTimeString()}.${new Date(log.timestamp).getMilliseconds()}`;
      out += `\x1b[36m${timeStr.padEnd(11, ' ')}\x1b[0m PID:${log.senderPid.toString().padEnd(2, ' ')} -> PID:${log.targetPid.toString().padEnd(2, ' ')}   \x1b[33m${log.serviceName.padEnd(10, ' ')}\x1b[0m \x1b[32m${log.action.padEnd(12, ' ')}\x1b[0m ${JSON.stringify(log.payload)}\n`;
    }

    return { stdout: out, stderr: '', exitCode: 0 };
  },
};
