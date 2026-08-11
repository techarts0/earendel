import { Command } from '../types';
import { globalNamespaceManager } from '../../kernel/namespace';

export const namespaceCommands: Command[] = [
  {
    name: 'unshare',
    description: 'run program with namespaces unshared from parent',
    category: 'sys',
    execute: async (ctx) => {
      const isUts = ctx.args.includes('-u') || ctx.args.includes('--uts');
      const isMount = ctx.args.includes('-m') || ctx.args.includes('--mount');

      const nonFlags = ctx.args.filter((a) => !a.startsWith('-'));
      const newHostname = isUts ? (nonFlags[0] || 'isolated-node') : undefined;
      const subCmd = isUts ? nonFlags.slice(1) : nonFlags;

      const currentNs = globalNamespaceManager.getNamespaceForProcess(24);
      const newNs = globalNamespaceManager.cloneNamespace(currentNs.nsId, {
        utsHostname: newHostname || currentNs.utsHostname,
      });

      let out = `\x1b[32m[Namespace Unshared]\x1b[0m Created new Container Namespace '${newNs.nsId}' (UTS Hostname: ${newNs.utsHostname})\n`;

      if (subCmd.length > 0) {
        const { globalCommandRegistry } = await import('../commandRegistry');
        const res = await globalCommandRegistry.execute(subCmd[0], {
          ...ctx,
          args: subCmd.slice(1),
          env: { ...ctx.env, HOSTNAME: newNs.utsHostname },
        });
        out += res.stdout;
        return { stdout: out, stderr: res.stderr, exitCode: res.exitCode };
      }

      return { stdout: out, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'nsenter',
    description: 'run program with namespaces of other processes',
    category: 'sys',
    execute: (ctx) => {
      const allNs = globalNamespaceManager.getAllNamespaces();
      let out = `Active Earendel Process Namespaces (${allNs.length}):\n`;
      out += `NS_ID       UTS_HOSTNAME          CHROOT_ROOT  ENV_VARS\n`;
      out += `---------------------------------------------------------\n`;
      for (const ns of allNs) {
        out += `${ns.nsId.padEnd(11, ' ')} ${ns.utsHostname.padEnd(21, ' ')} ${ns.chrootPath.padEnd(12, ' ')} USER=${ns.env.USER}\n`;
      }
      return { stdout: out, stderr: '', exitCode: 0 };
    },
  },
];
