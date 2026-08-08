import { Command } from '../types';
import { globalFirewallEngine } from '../firewallEngine';

export const netSecurityCommands: Command[] = [
  {
    name: 'ufw',
    description: 'program for managing a netfilter firewall',
    category: 'net',
    execute: (ctx) => {
      const currentUser = ctx.env['USER'] || 'hello';
      if (currentUser !== 'root') {
        return { stdout: '', stderr: 'ERROR: You must be root to run this program\n', exitCode: 1 };
      }

      const sub = ctx.args[0];
      const target = ctx.args[1];

      if (!sub) {
        return {
          stdout: `ufw [options] command\n\nCommands:\n  status                show firewall status\n  status numbered       show status with rule numbers\n  enable                enable the firewall\n  disable               disable the firewall\n  allow PORT[/PROTOCOL] allow access to PORT\n  deny PORT[/PROTOCOL]  deny access to PORT\n  delete NUMBER         delete rule NUMBER\n`,
          stderr: '',
          exitCode: 0,
        };
      }

      if (sub === 'status') {
        const enabled = globalFirewallEngine.isEnabled();
        if (!enabled) {
          return { stdout: 'Status: inactive\n', stderr: '', exitCode: 0 };
        }

        const isNumbered = target === 'numbered';
        const rules = globalFirewallEngine.getRules();

        let out = 'Status: active\n\n';
        out += isNumbered ? '     To                         Action      From\n     --                         ------      ----\n' : 'To                         Action      From\n--                         ------      ----\n';

        rules.forEach((r, idx) => {
          const portStr = r.port ? `${r.port}/${r.protocol}` : 'Anywhere';
          const numStr = isNumbered ? `[${idx + 1}] ` : '';
          out += `${numStr}${portStr.padEnd(26)} ${r.action.padEnd(11)} ${r.source}\n`;
        });

        return { stdout: out, stderr: '', exitCode: 0 };
      }

      if (sub === 'enable') {
        globalFirewallEngine.setEnabled(true);
        return { stdout: 'Firewall is active and enabled on system startup\n', stderr: '', exitCode: 0 };
      }

      if (sub === 'disable') {
        globalFirewallEngine.setEnabled(false);
        return { stdout: 'Firewall stopped and disabled on system startup\n', stderr: '', exitCode: 0 };
      }

      if (sub === 'allow' || sub === 'deny') {
        if (!target) return { stdout: '', stderr: `ufw ${sub}: missing port\n`, exitCode: 1 };

        let port = parseInt(target, 10);
        let proto: 'tcp' | 'udp' = 'tcp';

        if (target.includes('/')) {
          const parts = target.split('/');
          port = parseInt(parts[0], 10);
          proto = parts[1] as 'tcp' | 'udp';
        }

        const action = sub === 'allow' ? 'ALLOW' : 'DROP';
        globalFirewallEngine.addRule(action, isNaN(port) ? undefined : port, proto);
        return { stdout: `Rules updated\nRules updated (v6)\n`, stderr: '', exitCode: 0 };
      }

      if (sub === 'delete') {
        if (!target) return { stdout: '', stderr: 'ufw delete: missing rule number\n', exitCode: 1 };
        const num = parseInt(target, 10);
        const rules = globalFirewallEngine.getRules();
        if (num > 0 && num <= rules.length) {
          const targetRule = rules[num - 1];
          globalFirewallEngine.deleteRule(targetRule.id);
          return { stdout: 'Deleting rule...\nRules updated\n', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: `ufw delete: rule ${target} does not exist\n`, exitCode: 1 };
      }

      return { stdout: '', stderr: `ERROR: Invalid syntax '${sub}'\n`, exitCode: 1 };
    },
  },
  {
    name: 'iptables',
    description: 'administration tool for IPv4 packet filtering and NAT',
    category: 'net',
    execute: (ctx) => {
      const currentUser = ctx.env['USER'] || 'hello';
      if (currentUser !== 'root') {
        return { stdout: '', stderr: 'iptables v1.8.7 (nf_tables): Permission denied (you must be root)\n', exitCode: 4 };
      }

      if (ctx.args.includes('-F') || ctx.args.includes('--flush')) {
        globalFirewallEngine.flushRules();
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      if (ctx.args.includes('-L') || ctx.args.includes('--list')) {
        const rules = globalFirewallEngine.getRules();
        const header = [
          'Chain INPUT (policy ACCEPT)',
          'target     prot opt source               destination         ',
        ];

        rules.forEach((r) => {
          const targetStr = r.action === 'DROP' ? 'DROP' : 'ACCEPT';
          const protoStr = r.protocol.padEnd(8);
          const portInfo = r.port ? ` dpt:${r.port}` : '';
          header.push(`${targetStr.padEnd(10)} ${protoStr} --  ${r.source.padEnd(18)} 0.0.0.0/0           ${portInfo}`);
        });

        header.push('\nChain FORWARD (policy ACCEPT)\ntarget     prot opt source               destination         \n');
        header.push('Chain OUTPUT (policy ACCEPT)\ntarget     prot opt source               destination         ');

        return { stdout: header.join('\n') + '\n', stderr: '', exitCode: 0 };
      }

      if (ctx.args.includes('-A')) {
        const dportIdx = ctx.args.indexOf('--dport');
        const port = dportIdx !== -1 ? parseInt(ctx.args[dportIdx + 1], 10) : undefined;
        const jIdx = ctx.args.indexOf('-j');
        const actionStr = jIdx !== -1 ? ctx.args[jIdx + 1] : 'ACCEPT';

        const action = actionStr === 'DROP' ? 'DROP' : 'ALLOW';
        globalFirewallEngine.addRule(action, isNaN(port!) ? undefined : port, 'tcp');
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      return {
        stdout: `iptables v1.8.7 (nf_tables)\nUsage: iptables -[ACD] chain rule-specification [options]\n       iptables -[L|F] [chain] [options]\n`,
        stderr: '',
        exitCode: 0,
      };
    },
  },
];
