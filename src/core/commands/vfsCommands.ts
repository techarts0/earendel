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
        return globalVFSImageEngine.push().then((res) => ({
          stdout: `${res.log}\n`,
          stderr: '',
          exitCode: 0,
        }));
      }

      if (sub === 'pull') {
        return globalVFSImageEngine.pull().then((res) => ({
          stdout: `${res.log}\n`,
          stderr: '',
          exitCode: 0,
        }));
      }

      if (sub === 'remote') {
        if (arg1 === 'set-url' && arg2) {
          globalVFSImageEngine.setRemoteUrl(arg2);
          return { stdout: `Remote VFS Hub Endpoint set to '${arg2}'\n`, stderr: '', exitCode: 0 };
        }
        if (arg1 === 'set-credential') {
          const pass = arg2 || 'default_password';
          return globalVFSImageEngine.setCredential(pass).then((res) => ({
            stdout: `${res.message}\n`,
            stderr: '',
            exitCode: 0,
          }));
        }
        return {
          stdout: `Current Remote VFS Hub Endpoint: ${globalVFSImageEngine.getRemoteUrl()}\nUsage:\n  vfs remote set-url <URL | local>\n  vfs remote set-credential [password]\n`,
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
