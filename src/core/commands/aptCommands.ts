import { Command } from '../types';
import { globalPkgManager } from '../pkgManager';

export const aptCommands: Command[] = [
  {
    name: 'apt',
    aliases: ['apt-get'],
    description: 'command-line interface for the package management system',
    category: 'sys',
    execute: (ctx) => {
      const sub = ctx.args[0];
      const targetPkg = ctx.args[1];

      if (!sub) {
        return {
          stdout: `apt 2.4.10 (amd64)\nUsage: apt command [options]\n       apt help [command]\n\nMost used commands:\n  list - list packages based on package names\n  search - search in package descriptions\n  show - show package details\n  install - install packages\n  reinstall - reinstall packages\n  remove - remove packages\n  update - update list of available packages\n`,
          stderr: '',
          exitCode: 0,
        };
      }

      if (sub === 'update') {
        return globalPkgManager.updateFromRemoteRepo().then((res) => ({
          stdout: `${res.log}\n`,
          stderr: '',
          exitCode: 0,
        }));
      }

      if (sub === 'list') {
        const pkgs = globalPkgManager.getAllPackages();
        const listStr = pkgs
          .map((p) => `${p.name}/${p.installed ? 'jammy,now ' + p.version + ' [installed]' : 'jammy ' + p.version} amd64`)
          .join('\n');
        return { stdout: listStr + '\n', stderr: '', exitCode: 0 };
      }

      if (sub === 'install') {
        if (!targetPkg) {
          return { stdout: '', stderr: 'apt install: missing package name\n', exitCode: 1 };
        }

        const currentUser = ctx.env['USER'] || 'hello';
        if (currentUser !== 'root') {
          return {
            stdout: '',
            stderr: `E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\nE: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?\n`,
            exitCode: 100,
          };
        }

        return globalPkgManager.installPackage(targetPkg).then((res) => {
          if (!res.success) {
            return { stdout: '', stderr: `${res.message}\n`, exitCode: 100 };
          }
          const installLog = [
            'Reading package lists... Done',
            'Building dependency tree... Done',
            'Reading state information... Done',
            `The following NEW packages will be installed:`,
            `  ${targetPkg}`,
            `0 upgraded, 1 newly installed, 0 to remove and 0 not upgraded.`,
            res.message,
          ];
          return { stdout: installLog.join('\n') + '\n', stderr: '', exitCode: 0 };
        });
      }

      if (sub === 'upgrade') {
        const currentUser = ctx.env['USER'] || 'hello';
        if (currentUser !== 'root') {
          return {
            stdout: '',
            stderr: `E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\nE: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?\n`,
            exitCode: 100,
          };
        }

        return globalPkgManager.upgradePackages().then((res) => {
          return { stdout: res.log + '\n', stderr: '', exitCode: res.success ? 0 : 1 };
        });
      }

      if (sub === 'remove' || sub === 'purge') {
        if (!targetPkg) {
          return { stdout: '', stderr: 'apt remove: missing package name\n', exitCode: 1 };
        }

        const currentUser = ctx.env['USER'] || 'hello';
        if (currentUser !== 'root') {
          return {
            stdout: '',
            stderr: `E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\n`,
            exitCode: 100,
          };
        }

        const res = globalPkgManager.removePackage(targetPkg);
        return { stdout: res.message + '\n', stderr: '', exitCode: 0 };
      }

      return { stdout: '', stderr: `E: Invalid operation ${sub}\n`, exitCode: 1 };
    },
  },
  {
    name: 'dpkg',
    description: 'package manager for Debian/Earendel',
    category: 'sys',
    execute: (ctx) => {
      if (ctx.args[0] === '-l' || ctx.args[0] === '--list') {
        const statusContent = ctx.vfs.readFile('/var/lib/dpkg/status') || '';
        const header = `Desired=Unknown/Install/Remove/Purge/Hold\n| Status=Not/Inst/Conf-files/Unpacked/halF-conf/Half-inst/trig-aWait/Trig-pend\n|/ Err?=(none)/Reinst-required (Status,Err: uppercase=bad)\n||/ Name           Version      Architecture Description\n+++-==============-============-============-=================================\n`;

        if (!statusContent.trim()) {
          return { stdout: header + 'No packages installed.\n', stderr: '', exitCode: 0 };
        }

        // Parse authentic debian control blocks from /var/lib/dpkg/status
        const blocks = statusContent.split('\n\n').filter(Boolean);
        const lines: string[] = [];

        blocks.forEach((block) => {
          const map: Record<string, string> = {};
          block.split('\n').forEach((line) => {
            const idx = line.indexOf(':');
            if (idx > 0) {
              const k = line.substring(0, idx).trim();
              const v = line.substring(idx + 1).trim();
              map[k] = v;
            }
          });

          if (map['Package'] && map['Status']?.includes('installed')) {
            const name = map['Package'].padEnd(14);
            const ver = (map['Version'] || '1.0.0').padEnd(12);
            const arch = (map['Architecture'] || 'all').padEnd(12);
            const desc = map['Description'] || '';
            lines.push(`ii  ${name} ${ver} ${arch} ${desc}`);
          }
        });

        return { stdout: header + lines.join('\n') + '\n', stderr: '', exitCode: 0 };
      }
      return { stdout: 'dpkg 1.21.1ubuntu2.2 (all)\nUse dpkg --help for help.\n', stderr: '', exitCode: 0 };
    },
  },
];
