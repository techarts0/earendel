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
        const updateLog = [
          'Hit:1 http://archive.ubuntu.com/ubuntu jammy InRelease',
          'Get:2 http://archive.ubuntu.com/ubuntu jammy-updates InRelease [119 kB]',
          'Get:3 http://archive.ubuntu.com/ubuntu jammy-backports InRelease [109 kB]',
          'Fetched 228 kB in 1s (228 kB/s)',
          'Reading package lists... Done',
          'Building dependency tree... Done',
          'Reading state information... Done',
          'All packages are up to date.',
        ];
        return { stdout: updateLog.join('\n') + '\n', stderr: '', exitCode: 0 };
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

        const pkgMeta = globalPkgManager.getPackage(targetPkg);
        if (!pkgMeta) {
          return { stdout: '', stderr: `E: Unable to locate package ${targetPkg}\n`, exitCode: 100 };
        }

        const installLog = [
          'Reading package lists... Done',
          'Building dependency tree... Done',
          'Reading state information... Done',
          `The following NEW packages will be installed:`,
          `  ${pkgMeta.name}`,
          `0 upgraded, 1 newly installed, 0 to remove and 0 not upgraded.`,
          `Need to get ${pkgMeta.sizeKb} kB of archives.`,
          `Unpacking ${pkgMeta.name} (${pkgMeta.version}) ...`,
          globalPkgManager.installPackage(targetPkg).message,
        ];
        return { stdout: installLog.join('\n') + '\n', stderr: '', exitCode: 0 };
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
    description: 'package manager for Debian',
    category: 'sys',
    execute: (ctx) => {
      if (ctx.args[0] === '-l' || ctx.args[0] === '--list') {
        const pkgs = globalPkgManager.getAllPackages().filter((p) => p.installed);
        const header = `Desired=Unknown/Install/Remove/Purge/Hold\n| Status=Not/Inst/Conf-files/Unpacked/halF-conf/Half-inst/trig-aWait/Trig-pend\n|/ Err?=(none)/Reinst-required (Status,Err: uppercase=bad)\n||/ Name           Version      Architecture Description\n+++-==============-============-============-=================================\n`;
        const lines = pkgs.map((p) => `ii  ${p.name.padEnd(14)} ${p.version.padEnd(12)} amd64        ${p.description}`).join('\n');
        return { stdout: header + (lines ? lines + '\n' : 'No packages installed.\n'), stderr: '', exitCode: 0 };
      }
      return { stdout: 'dpkg 1.21.1ubuntu2.2 (amd64)\nUse dpkg --help for help.\n', stderr: '', exitCode: 0 };
    },
  },
];
