import { Command } from '../types';
import { globalCapabilityManager, CapabilityType } from '../../kernel/capability';
import { globalTaskScheduler } from '../../kernel/taskScheduler';

const CAPABILITIES: CapabilityType[] = ['CAP_VFS_READ', 'CAP_VFS_WRITE', 'CAP_DEVICE_IO', 'CAP_SYS_ADMIN', 'CAP_KILL', 'CAP_NET_ADMIN'];
const isPid = (value: string | undefined): number | null => {
  if (!value || !/^\d+$/.test(value)) return null;
  const pid = Number(value);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
};

export const capCommands: Command[] = [
  {
    name: 'cap-list', description: 'list held capability security tokens for a process', category: 'sys',
    execute: (ctx) => {
      const callerPid = ctx.callerPid;
      const pid = isPid(ctx.args[0] || (callerPid ? String(callerPid) : undefined));
      if (callerPid === undefined || pid === null) return { stdout: '', stderr: 'cap-list: invalid caller or target PID\n', exitCode: 1 };
      if (pid !== callerPid && !globalCapabilityManager.hasCapability(callerPid, 'CAP_SYS_ADMIN')) {
        return { stdout: '', stderr: 'cap-list: permission denied; CAP_SYS_ADMIN is required to inspect another process\n', exitCode: 1 };
      }
      const tokens = globalCapabilityManager.getCapabilityTokens(pid);
      let out = `Capabilities for Process PID ${pid}:\nCAPABILITY TOKEN      STATUS      SCOPE\n------------------------------------------\n`;
      if (!tokens.length) out += '(no capabilities; access denied by default)\n';
      for (const token of tokens) out += `${token.type.padEnd(20)} \x1b[32m[GRANTED]\x1b[0m   ${token.resourceTarget}\n`;
      return { stdout: out, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'cap-grant', description: 'grant a scoped capability token to a process', category: 'sys',
    execute: (ctx) => {
      const pid = isPid(ctx.args[0]);
      const cap = ctx.args[1] as CapabilityType;
      const scope = ctx.args[2] || '*';
      if (pid === null || !CAPABILITIES.includes(cap)) {
        return { stdout: '', stderr: 'cap-grant: invalid PID or capability\nUsage: cap-grant <PID> <CAP_NAME> [RESOURCE_SCOPE]\n', exitCode: 1 };
      }
      if (ctx.callerPid === undefined || !globalCapabilityManager.hasCapability(ctx.callerPid, 'CAP_SYS_ADMIN')) {
        return { stdout: '', stderr: 'cap-grant: permission denied; CAP_SYS_ADMIN is required\n', exitCode: 1 };
      }
      const target = globalTaskScheduler.getProcess(pid);
      if (!target || target.state !== 'RUNNING') {
        return { stdout: '', stderr: `cap-grant: target PID ${pid} is not running\n`, exitCode: 1 };
      }
      if (!globalCapabilityManager.grantCapability(pid, cap, scope)) return { stdout: '', stderr: 'cap-grant: grant rejected\n', exitCode: 1 };
      return { stdout: `Granted '${cap}' to PID ${pid} for '${scope}'.\n`, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'cap-revoke', description: 'revoke a capability token from a process', category: 'sys',
    execute: (ctx) => {
      const pid = isPid(ctx.args[0]);
      const cap = ctx.args[1] as CapabilityType;
      const scope = ctx.args[2];
      if (pid === null || !CAPABILITIES.includes(cap)) {
        return { stdout: '', stderr: 'cap-revoke: invalid PID or capability\nUsage: cap-revoke <PID> <CAP_NAME> [RESOURCE_SCOPE]\n', exitCode: 1 };
      }
      if (ctx.callerPid === undefined || !globalCapabilityManager.hasCapability(ctx.callerPid, 'CAP_SYS_ADMIN')) {
        return { stdout: '', stderr: 'cap-revoke: permission denied; CAP_SYS_ADMIN is required\n', exitCode: 1 };
      }
      const target = globalTaskScheduler.getProcess(pid);
      if (!target || target.state !== 'RUNNING') {
        return { stdout: '', stderr: `cap-revoke: target PID ${pid} is not running\n`, exitCode: 1 };
      }
      if (!globalCapabilityManager.revokeCapability(pid, cap, scope)) {
        return { stdout: '', stderr: 'cap-revoke: no matching grant\n', exitCode: 1 };
      }
      return { stdout: `Revoked '${cap}' from PID ${pid}${scope ? ` for '${scope}'` : ''}.\n`, stderr: '', exitCode: 0 };
    },
  },
];
