import { Command } from '../types';
import { globalCapabilityManager, CapabilityType } from '../../kernel/capability';

export const capCommands: Command[] = [
  {
    name: 'cap-list',
    description: 'list held capability security tokens for a process',
    category: 'sys',
    execute: (ctx) => {
      const pidStr = ctx.args[0] || '24';
      const pid = parseInt(pidStr, 10);
      const caps = globalCapabilityManager.getCapabilities(pid);

      let out = `Capabilities for Process PID ${pid}:\n`;
      out += `CAPABILITY TOKEN      STATUS      SCOPE\n`;
      out += `------------------------------------------\n`;
      for (const c of caps) {
        out += `${c.padEnd(20, ' ')} \x1b[32m[GRANTED]\x1b[0m   Full Resource Access\n`;
      }
      return { stdout: out, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'cap-grant',
    description: 'grant a capability token to a process',
    category: 'sys',
    execute: (ctx) => {
      const pidStr = ctx.args[0];
      const capName = ctx.args[1] as CapabilityType;
      if (!pidStr || !capName) {
        return { stdout: '', stderr: 'cap-grant: missing PID or CAPABILITY_NAME\nUsage: cap-grant <PID> <CAP_NAME>\n', exitCode: 1 };
      }
      const pid = parseInt(pidStr, 10);
      globalCapabilityManager.grantCapability(pid, capName);
      return { stdout: `Granted capability '${capName}' to Process PID ${pid}.\n`, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'cap-revoke',
    description: 'revoke a capability token from a process',
    category: 'sys',
    execute: (ctx) => {
      const pidStr = ctx.args[0];
      const capName = ctx.args[1] as CapabilityType;
      if (!pidStr || !capName) {
        return { stdout: '', stderr: 'cap-revoke: missing PID or CAPABILITY_NAME\nUsage: cap-revoke <PID> <CAP_NAME>\n', exitCode: 1 };
      }
      const pid = parseInt(pidStr, 10);
      globalCapabilityManager.revokeCapability(pid, capName);
      return { stdout: `Revoked capability '${capName}' from Process PID ${pid}.\n`, stderr: '', exitCode: 0 };
    },
  },
];
