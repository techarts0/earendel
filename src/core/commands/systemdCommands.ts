import { Command } from '../types';
import { globalServiceManager } from '../serviceManager';

export const systemdCommands: Command[] = [
  {
    name: 'systemctl',
    aliases: ['service'],
    description: 'Control the systemd system and service manager',
    category: 'sys',
    execute: (ctx) => {
      let sub = ctx.args[0];
      let serviceName = ctx.args[1];

      // Handle legacy 'service nginx status' format
      if (ctx.args.length >= 2 && (sub === 'status' || sub === 'start' || sub === 'stop' || sub === 'restart')) {
        // systemctl status nginx
      } else if (ctx.args.length >= 2 && !['status', 'start', 'stop', 'restart', 'enable', 'disable', 'is-active'].includes(sub)) {
        // service nginx status
        serviceName = ctx.args[0];
        sub = ctx.args[1];
      }

      if (!sub) {
        return {
          stdout: `systemctl [OPTIONS...] COMMAND ...\n\nQuery or send control commands to the systemd manager.\n\nUnit Commands:\n  status [NAME...]        Show runtime status of units\n  start NAME...           Start (activate) one or more units\n  stop NAME...            Stop (deactivate) one or more units\n  restart NAME...         Start or restart one or more units\n  enable NAME...          Enable one or more unit files\n  disable NAME...         Disable one or more unit files\n`,
          stderr: '',
          exitCode: 0,
        };
      }

      if (sub === 'status') {
        if (!serviceName) {
          return { stdout: '', stderr: 'systemctl status: missing unit name\n', exitCode: 1 };
        }

        const s = globalServiceManager.getService(serviceName);
        if (!s) {
          return { stdout: '', stderr: `Unit ${serviceName}.service could not be found.\n`, exitCode: 4 };
        }

        const dot = s.active ? '\x1b[1;32m●\x1b[0m' : '\x1b[90m○\x1b[0m';
        const activeState = s.active
          ? `\x1b[1;32mactive (running)\x1b[0m since ${s.startTime}`
          : `\x1b[90minactive (dead)\x1b[0m since ${s.startTime}`;

        const output = [
          `${dot} ${s.name} - ${s.description}`,
          `     Loaded: loaded (/lib/systemd/system/${s.name}; ${s.enabled ? 'enabled' : 'disabled'}; vendor preset: enabled)`,
          `     Active: ${activeState}`,
          `       Docs: man:${serviceName}(8)`,
          `   Main PID: ${s.active ? s.pid : 0} (${serviceName})`,
          `      Tasks: ${s.active ? 2 : 0} (limit: 4571)`,
          `     Memory: ${s.active ? '4.8M' : '0B'}`,
          `        CPU: 12ms`,
          `     CGroup: /system.slice/${s.name}`,
          s.active ? `             ├─${s.pid} ${serviceName}: master process /usr/sbin/${serviceName}` : '',
        ].filter(Boolean).join('\n');

        return { stdout: output + '\n', stderr: '', exitCode: 0 };
      }

      if (sub === 'start') {
        if (!serviceName) return { stdout: '', stderr: 'systemctl start: missing unit name\n', exitCode: 1 };
        const ok = globalServiceManager.startService(serviceName);
        if (!ok) return { stdout: '', stderr: `Unit ${serviceName}.service not found.\n`, exitCode: 4 };
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      if (sub === 'stop') {
        if (!serviceName) return { stdout: '', stderr: 'systemctl stop: missing unit name\n', exitCode: 1 };
        const ok = globalServiceManager.stopService(serviceName);
        if (!ok) return { stdout: '', stderr: `Unit ${serviceName}.service not found.\n`, exitCode: 4 };
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      if (sub === 'restart') {
        if (!serviceName) return { stdout: '', stderr: 'systemctl restart: missing unit name\n', exitCode: 1 };
        const ok = globalServiceManager.restartService(serviceName);
        if (!ok) return { stdout: '', stderr: `Unit ${serviceName}.service not found.\n`, exitCode: 4 };
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      return { stdout: '', stderr: `Unknown operation ${sub}\n`, exitCode: 1 };
    },
  },
];
