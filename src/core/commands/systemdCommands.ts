import { Command } from '../types';
import { globalServiceManager } from '../serviceManager';

export const systemdCommands: Command[] = [
  {
    name: 'systemctl',
    aliases: ['service'],
    description: 'Control the systemd system and service manager (supports status, start, stop, restart, enable, disable, is-active, list-units)',
    category: 'sys',
    execute: (ctx) => {
      let sub = ctx.args[0];
      let serviceName = ctx.args[1];

      // Handle 'service --status-all'
      if (ctx.args.includes('--status-all')) {
        const services = globalServiceManager.getAllServices();
        let out = '';
        for (const s of services) {
          const sym = s.active ? '+' : '-';
          out += ` [ ${sym} ]  ${s.name}\n`;
        }
        return { stdout: out, stderr: '', exitCode: 0 };
      }

      // Handle legacy 'service nginx status' format
      if (ctx.args.length >= 2 && !['status', 'start', 'stop', 'restart', 'enable', 'disable', 'is-active', 'is-enabled', 'cat', 'list-units', 'daemon-reload'].includes(sub)) {
        serviceName = ctx.args[0];
        sub = ctx.args[1];
      }

      if (!sub || sub === 'list-units' || sub === 'list-unit-files') {
        const services = globalServiceManager.getAllServices();
        let out = 'UNIT                     LOAD   ACTIVE SUB     DESCRIPTION\n';
        for (const s of services) {
          const activeStr = s.active ? 'active' : 'inactive';
          const subStr = s.active ? 'running' : 'dead';
          out += `${(s.name + '.service').padEnd(24)} loaded ${activeStr.padEnd(6)} ${subStr.padEnd(7)} ${s.description}\n`;
        }
        out += `\nLOAD   = Reflects whether the unit definition was properly loaded.\nACTIVE = The high-level unit activation state, i.e. generalization of SUB.\nSUB    = The low-level unit activation state, values depend on unit type.\n\n${services.length} loaded units listed.\n`;
        return { stdout: out, stderr: '', exitCode: 0 };
      }

      if (sub === 'daemon-reload') {
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      if (sub === 'is-active') {
        if (!serviceName) return { stdout: 'unknown\n', stderr: '', exitCode: 3 };
        const s = globalServiceManager.getService(serviceName.replace(/\.service$/, ''));
        const active = s && s.active;
        return { stdout: active ? 'active\n' : 'inactive\n', stderr: '', exitCode: active ? 0 : 3 };
      }

      if (sub === 'is-enabled') {
        if (!serviceName) return { stdout: 'unknown\n', stderr: '', exitCode: 1 };
        const s = globalServiceManager.getService(serviceName.replace(/\.service$/, ''));
        const enabled = s && s.enabled;
        return { stdout: enabled ? 'enabled\n' : 'disabled\n', stderr: '', exitCode: enabled ? 0 : 1 };
      }

      if (sub === 'enable') {
        if (!serviceName) return { stdout: '', stderr: 'systemctl enable: missing unit name\n', exitCode: 1 };
        const s = globalServiceManager.getService(serviceName.replace(/\.service$/, ''));
        if (!s) return { stdout: '', stderr: `Failed to enable unit: Unit file ${serviceName}.service does not exist.\n`, exitCode: 1 };
        s.enabled = true;
        return { stdout: `Created symlink /etc/systemd/system/multi-user.target.wants/${s.name}.service → /lib/systemd/system/${s.name}.service.\n`, stderr: '', exitCode: 0 };
      }

      if (sub === 'disable') {
        if (!serviceName) return { stdout: '', stderr: 'systemctl disable: missing unit name\n', exitCode: 1 };
        const s = globalServiceManager.getService(serviceName.replace(/\.service$/, ''));
        if (!s) return { stdout: '', stderr: `Failed to disable unit: Unit file ${serviceName}.service does not exist.\n`, exitCode: 1 };
        s.enabled = false;
        return { stdout: `Removed /etc/systemd/system/multi-user.target.wants/${s.name}.service.\n`, stderr: '', exitCode: 0 };
      }

      if (sub === 'status') {
        if (!serviceName) {
          return { stdout: '', stderr: 'systemctl status: missing unit name\n', exitCode: 1 };
        }

        const cleanName = serviceName.replace(/\.service$/, '');
        const s = globalServiceManager.getService(cleanName);
        if (!s) {
          return { stdout: '', stderr: `Unit ${cleanName}.service could not be found.\n`, exitCode: 4 };
        }

        const dot = s.active ? '\x1b[1;32m●\x1b[0m' : '\x1b[90m○\x1b[0m';
        const activeState = s.active
          ? `\x1b[1;32mactive (running)\x1b[0m since ${s.startTime}`
          : `\x1b[90minactive (dead)\x1b[0m since ${s.startTime}`;

        const output = [
          `${dot} ${s.name}.service - ${s.description}`,
          `     Loaded: loaded (/lib/systemd/system/${s.name}.service; ${s.enabled ? 'enabled' : 'disabled'}; vendor preset: enabled)`,
          `     Active: ${activeState}`,
          `       Docs: man:${cleanName}(8)`,
          `   Main PID: ${s.active ? s.pid : 0} (${cleanName})`,
          `      Tasks: ${s.active ? 2 : 0} (limit: 4571)`,
          `     Memory: ${s.active ? '4.8M' : '0B'}`,
          `        CPU: 12ms`,
          `     CGroup: /system.slice/${s.name}.service`,
          s.active ? `             ├─${s.pid} ${cleanName}: master process /usr/sbin/${cleanName}` : '',
        ].filter(Boolean).join('\n');

        return { stdout: output + '\n', stderr: '', exitCode: s.active ? 0 : 3 };
      }

      if (sub === 'start') {
        if (!serviceName) return { stdout: '', stderr: 'systemctl start: missing unit name\n', exitCode: 1 };
        const cleanName = serviceName.replace(/\.service$/, '');
        const ok = globalServiceManager.startService(cleanName);
        if (!ok) return { stdout: '', stderr: `Failed to start ${cleanName}.service: Unit not found.\n`, exitCode: 4 };
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      if (sub === 'stop') {
        if (!serviceName) return { stdout: '', stderr: 'systemctl stop: missing unit name\n', exitCode: 1 };
        const cleanName = serviceName.replace(/\.service$/, '');
        const ok = globalServiceManager.stopService(cleanName);
        if (!ok) return { stdout: '', stderr: `Failed to stop ${cleanName}.service: Unit not found.\n`, exitCode: 4 };
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      if (sub === 'restart') {
        if (!serviceName) return { stdout: '', stderr: 'systemctl restart: missing unit name\n', exitCode: 1 };
        const cleanName = serviceName.replace(/\.service$/, '');
        const ok = globalServiceManager.restartService(cleanName);
        if (!ok) return { stdout: '', stderr: `Failed to restart ${cleanName}.service: Unit not found.\n`, exitCode: 4 };
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      return { stdout: '', stderr: `Unknown operation ${sub}\n`, exitCode: 1 };
    },
  },
];

