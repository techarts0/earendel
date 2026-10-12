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
        const rules = globalFirewallEngine.getRules().filter((rule) => rule.target === 'INPUT');

        const policyLabel = (chain: 'INPUT' | 'OUTPUT' | 'FORWARD') => {
          const policy = globalFirewallEngine.getPolicy(chain);
          return policy === 'ALLOW' ? 'allow' : policy === 'DROP' ? 'deny' : 'reject';
        };
        let out = `Status: active\nDefault: ${policyLabel('INPUT')} (incoming), ${policyLabel('OUTPUT')} (outgoing), ${policyLabel('FORWARD')} (routed)\n\n`;
        out += isNumbered ? '     To                         Action      From\n     --                         ------      ----\n' : 'To                         Action      From\n--                         ------      ----\n';

        rules.forEach((r, idx) => {
          const portStr = r.port ? `${r.port}/${r.protocol}` : 'Anywhere';
          const numStr = isNumbered ? `[${idx + 1}] ` : '';
          const actionLabel = r.action === 'ALLOW' ? 'ALLOW' : r.action === 'DROP' ? 'DENY' : 'REJECT';
          out += `${numStr}${portStr.padEnd(26)} ${actionLabel.padEnd(11)} ${r.source}\n`;
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

      if (sub === 'default') {
        const policy = (target || '').toLowerCase();
        const direction = ctx.args[2];
        const chain = direction === 'incoming' ? 'INPUT' : direction === 'outgoing' ? 'OUTPUT' : direction === 'routed' ? 'FORWARD' : null;
        if (!chain || !['allow', 'deny', 'reject'].includes(policy)) {
          return { stdout: '', stderr: 'ufw: usage: ufw default allow|deny|reject incoming|outgoing|routed\n', exitCode: 2 };
        }
        globalFirewallEngine.setPolicy(chain, policy === 'allow' ? 'ALLOW' : policy === 'deny' ? 'DROP' : 'REJECT');
        return { stdout: `Default ${direction} policy changed to '${policy}'\n`, stderr: '', exitCode: 0 };
      }

      if (sub === 'reset') {
        globalFirewallEngine.flushRules();
        globalFirewallEngine.setPolicy('INPUT', 'ALLOW');
        globalFirewallEngine.setPolicy('OUTPUT', 'ALLOW');
        globalFirewallEngine.setPolicy('FORWARD', 'DROP');
        globalFirewallEngine.setEnabled(true);
        return { stdout: 'Firewall rules reset to defaults\n', stderr: '', exitCode: 0 };
      }

      if (sub === 'allow' || sub === 'deny' || sub === 'reject') {
        if (!target) return { stdout: '', stderr: `ufw ${sub}: missing port\n`, exitCode: 1 };

        let port: number | undefined;
        let proto: 'tcp' | 'udp' = 'tcp';
        let source = '0.0.0.0/0';
        if (target === 'from') {
          source = ctx.args[2] || '';
          if (!source) return { stdout: '', stderr: `ufw ${sub}: missing source address\n`, exitCode: 2 };
          const portIndex = ctx.args.indexOf('port');
          if (portIndex >= 0) {
            const spec = (ctx.args[portIndex + 1] || '').split('/');
            port = Number(spec[0]);
            if (spec.length > 2) return { stdout: '', stderr: 'ufw: invalid port specification\n', exitCode: 2 };
            if (spec[1]) proto = spec[1] as 'tcp' | 'udp';
          }
          const protoIndex = ctx.args.indexOf('proto');
          if (protoIndex >= 0) proto = (ctx.args[protoIndex + 1] || '') as 'tcp' | 'udp';
        } else {
          const parts = target.split('/');
          if (parts.length > 2 || !/^\d+$/.test(parts[0])) return { stdout: '', stderr: `ufw ${sub}: invalid port '${target}'\n`, exitCode: 2 };
          port = Number(parts[0]);
          if (parts[1]) proto = parts[1] as 'tcp' | 'udp';
        }
        if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) return { stdout: '', stderr: `ufw ${sub}: invalid port '${target}'\n`, exitCode: 2 };
        if (proto !== 'tcp' && proto !== 'udp') return { stdout: '', stderr: `ufw ${sub}: protocol must be tcp or udp\n`, exitCode: 2 };
        const action = sub === 'allow' ? 'ALLOW' : sub === 'deny' ? 'DROP' : 'REJECT';
        try {
          globalFirewallEngine.addRule(action, port, proto, source, 'INPUT');
        } catch (error: any) {
          return { stdout: '', stderr: `ufw ${sub}: ${error.message}\n`, exitCode: 2 };
        }
        return { stdout: `Rules updated\nRules updated (v6)\n`, stderr: '', exitCode: 0 };
      }

      if (sub === 'delete') {
        if (!target) return { stdout: '', stderr: 'ufw delete: missing rule number\n', exitCode: 1 };
        if (!/^\d+$/.test(target)) return { stdout: '', stderr: `ufw delete: invalid rule number '${target}'\n`, exitCode: 1 };
        const num = Number(target);
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
        const flushIndex = ctx.args.findIndex((arg) => arg === '-F' || arg === '--flush');
        const chainName = ctx.args[flushIndex + 1];
        if (chainName && !['INPUT', 'OUTPUT', 'FORWARD'].includes(chainName)) {
          return { stdout: '', stderr: `iptables: chain '${chainName}' does not exist\n`, exitCode: 1 };
        }
        globalFirewallEngine.flushRules(chainName as 'INPUT' | 'OUTPUT' | 'FORWARD' | undefined);
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      if (ctx.args[0] === '-P' || ctx.args[0] === '--policy') {
        const chain = ctx.args[1] as 'INPUT' | 'OUTPUT' | 'FORWARD';
        const target = ctx.args[2];
        const policy = target === 'ACCEPT' ? 'ALLOW' : target;
        if (!['INPUT', 'OUTPUT', 'FORWARD'].includes(chain) || !['ALLOW', 'DROP', 'REJECT'].includes(policy)) {
          return { stdout: '', stderr: 'iptables: invalid chain or policy\n', exitCode: 2 };
        }
        globalFirewallEngine.setPolicy(chain, policy as 'ALLOW' | 'DROP' | 'REJECT');
        return { stdout: '', stderr: '', exitCode: 0 };
      }

      if (ctx.args.includes('-L') || ctx.args.includes('--list')) {
        const rules = globalFirewallEngine.getRules();
        const chainArg = ctx.args.find((arg) => ['INPUT', 'OUTPUT', 'FORWARD'].includes(arg));
        const chains = chainArg ? [chainArg as 'INPUT' | 'OUTPUT' | 'FORWARD'] : ['INPUT', 'FORWARD', 'OUTPUT'] as const;
        const lines: string[] = [];
        for (const chain of chains) {
          const policy = globalFirewallEngine.getPolicy(chain);
          lines.push(`Chain ${chain} (policy ${policy === 'ALLOW' ? 'ACCEPT' : policy})`, 'target     prot opt source               destination');
          for (const rule of rules.filter((entry) => entry.target === chain)) {
            const action = rule.action === 'ALLOW' ? 'ACCEPT' : rule.action;
            const port = rule.port === undefined ? '' : ` dpt:${rule.port}`;
            lines.push(`${action.padEnd(10)} ${rule.protocol.padEnd(8)} --  ${rule.source.padEnd(18)} anywhere${port}`);
          }
          lines.push('');
        }
        return { stdout: lines.join('\n'), stderr: '', exitCode: 0 };
      }

      const appendIndex = ctx.args.findIndex((arg) => arg === '-A' || arg === '--append');
      const insertIndex = ctx.args.findIndex((arg) => arg === '-I' || arg === '--insert');
      if (appendIndex >= 0 || insertIndex >= 0) {
        const ruleIndex = appendIndex >= 0 ? appendIndex : insertIndex;
        const dportIdx = ctx.args.indexOf('--dport');
        const rawPort = dportIdx !== -1 ? ctx.args[dportIdx + 1] : undefined;
        const port = rawPort !== undefined ? Number(rawPort) : undefined;
        if (rawPort !== undefined && (!/^\d+$/.test(rawPort) || port! < 1 || port! > 65535)) {
          return { stdout: '', stderr: `iptables: invalid destination port '${rawPort}'\n`, exitCode: 2 };
        }
        const jIdx = ctx.args.indexOf('-j');
        const actionStr = jIdx !== -1 ? ctx.args[jIdx + 1] : 'ACCEPT';
        const action = actionStr === 'ACCEPT' ? 'ALLOW' : actionStr;
        if (!['ALLOW', 'DROP', 'REJECT'].includes(action)) return { stdout: '', stderr: `iptables: unsupported target '${actionStr}'\n`, exitCode: 2 };
        const chain = ctx.args[ruleIndex + 1] as 'INPUT' | 'OUTPUT' | 'FORWARD';
        if (!['INPUT', 'OUTPUT', 'FORWARD'].includes(chain)) return { stdout: '', stderr: 'iptables: invalid chain\n', exitCode: 2 };
        const protoIndex = ctx.args.findIndex((arg) => arg === '-p' || arg === '--protocol');
        const proto = (protoIndex >= 0 ? ctx.args[protoIndex + 1] : 'all') as 'tcp' | 'udp' | 'icmp' | 'all';
        const sourceIndex = ctx.args.findIndex((arg) => arg === '-s' || arg === '--source');
        const source = sourceIndex >= 0 ? ctx.args[sourceIndex + 1] : '0.0.0.0/0';
        try {
          globalFirewallEngine.addRule(action as 'ALLOW' | 'DROP' | 'REJECT', port, proto, source, chain, insertIndex >= 0);
        } catch (error: any) {
          return { stdout: '', stderr: `iptables: ${error.message}\n`, exitCode: 2 };
        }
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
