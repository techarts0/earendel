import { Command } from '../types';
import { globalVFSImageEngine } from '../vfsImageEngine';

export const vfsCommands: Command[] = [
  {
    name: 'vfs',
    description: 'Unified VFS Image Push/Pull & Remote Cloud Sync Toolchain',
    category: 'sys',
    execute: (ctx) => {
      const sub = ctx.args[0];
      const arg1 = ctx.args[1];
      const arg2 = ctx.args[2];

      if (sub === 'push') {
        const callerPid = ctx.callerPid ?? -1;
        return globalVFSImageEngine.push(callerPid).then((res) => ({
          stdout: `${res.log}\n`,
          stderr: res.success ? '' : `${res.log}\n`,
          exitCode: res.success ? 0 : 1,
        }));
      }

      if (sub === 'pull') {
        const callerPid = ctx.callerPid ?? -1;
        return globalVFSImageEngine.pull(callerPid).then((res) => ({
          stdout: `${res.log}\n`,
          stderr: res.success ? '' : `${res.log}\n`,
          exitCode: res.success ? 0 : 1,
        }));
      }

      if (sub === 'remote') {
        if (arg1 === 'set-url' && arg2) {
          const result = globalVFSImageEngine.setRemoteUrl(arg2, ctx.callerPid ?? -1);
          return { stdout: result.success ? `${result.message}\n` : '', stderr: result.success ? '' : `${result.message}\n`, exitCode: result.success ? 0 : 1 };
        }
        if (arg1 === 'set-credential') {
          const pass = arg2 || 'default_password';
          return globalVFSImageEngine.setCredential(pass, ctx.callerPid ?? -1).then((res) => ({
            stdout: res.success ? `${res.message}\n` : '',
            stderr: res.success ? '' : `${res.message}\n`,
            exitCode: res.success ? 0 : 1,
          }));
        }
        const remoteUrl = globalVFSImageEngine.getRemoteUrl(ctx.callerPid ?? -1);
        if (remoteUrl === null) return { stdout: '', stderr: 'EACCES: CAP_SYS_ADMIN is required to inspect VFS remote configuration.\n', exitCode: 1 };
        return {
          stdout: `Current Remote VFS Hub Endpoint: ${remoteUrl}\nUsage:\n  vfs remote set-url <URL | local>\n  vfs remote set-credential [password]\n`,
          stderr: '',
          exitCode: 0,
        };
      }

      return {
        stdout: `Usage: vfs <subcommand> [args]\n  vfs push                             Push VFS snapshot (Local disk or Cloud Hub)\n  vfs pull                             Pull VFS snapshot (Local disk or Cloud Hub)\n  vfs remote set-url <url|local>       Configure Cloud Hub URL (or 'local' for offline mode)\n  vfs remote set-credential [pass]     Set self-verifying SHA-256 password & Machine UUID in /etc/vfs_config\n`,
        stderr: '',
        exitCode: 0,
      };
    },
  },
];
