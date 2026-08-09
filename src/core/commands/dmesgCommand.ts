// Behavioral dmesg Command for Earendel Microkernel
import { Command } from '../types';
import { globalMicrokernel } from '../../kernel/microkernel';
import { globalIPCBus } from '../../kernel/ipcBus';

export const dmesgCommand: Command = {
  name: 'dmesg',
  description: 'print or control the kernel ring buffer and IPC traces',
  category: 'sys',
  execute: (ctx) => {
    const isIPC = ctx.args.includes('--ipc') || ctx.args.includes('-i');
    let out = '';

    if (isIPC) {
      const ipcLogs = globalIPCBus.getIPCLogs();
      out += `Earendel Microkernel IPC Traces (${ipcLogs.length} messages):\n`;
      out += `MSG_ID      SENDER -> TARGET  SERVICE   ACTION      PAYLOAD\n`;
      out += `-------------------------------------------------------------\n`;
      for (const log of ipcLogs) {
        out += `${log.msgId.padEnd(11, ' ')} PID:${log.senderPid} -> PID:${log.targetPid}   ${log.serviceName.padEnd(9, ' ')} ${log.action.padEnd(11, ' ')} ${JSON.stringify(log.payload)}\n`;
      }
      return { stdout: out, stderr: '', exitCode: 0 };
    }

    const logs = globalMicrokernel.getDmesgLogs();
    for (const log of logs) {
      const color = log.level === 'panic' ? '\x1b[1;31m' : log.level === 'warn' ? '\x1b[33m' : '\x1b[32m';
      out += `${log.timestamp} ${color}${log.subsystem}\x1b[0m: ${log.message}\n`;
    }

    if (ctx.args.length === 0) {
      out += `\n\x1b[90mHint: Run 'dmesg --ipc' to inspect live Microkernel IPC message bus traffic!\x1b[0m\n`;
    }

    return { stdout: out, stderr: '', exitCode: 0 };
  },
};
