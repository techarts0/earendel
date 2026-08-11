import { Command } from '../types';
import { globalVFS } from '../vfs';
import { globalServiceManager } from '../serviceManager';

export function resolveHostToIp(host: string): string {
  if (host === 'localhost' || host === '127.0.0.1') return '127.0.0.1';
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return host;

  const hostsContent = globalVFS.readFile('/etc/hosts') ?? '';
  const lines = hostsContent.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      const ip = parts[0];
      const aliases = parts.slice(1);
      if (aliases.includes(host)) {
        return ip;
      }
    }
  }

  return host; // Return as-is if unmapped
}

let cachedClientIpInfo: { publicIp: string; localIp: string } | null = null;

export async function getRealClientNetworkInfo(): Promise<{ publicIp: string; localIp: string }> {
  if (cachedClientIpInfo) return cachedClientIpInfo;

  let publicIp = '127.0.0.1';
  let localIp = '192.168.1.100';

  try {
    const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      if (data.ip) publicIp = data.ip;
    }
  } catch (e) {
    try {
      const fallback = await fetch('https://api.myip.com', { signal: AbortSignal.timeout(2000) });
      if (fallback.ok) {
        const d = await fallback.json();
        if (d.ip) publicIp = d.ip;
      }
    } catch (err) {}
  }

  cachedClientIpInfo = { publicIp, localIp };
  return cachedClientIpInfo;
}

export async function queryDoHDns(domain: string): Promise<string[]> {
  if (domain === 'localhost' || domain === '127.0.0.1') return ['127.0.0.1'];
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(domain)) return [domain];

  try {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=A`, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const json = await res.json();
      if (json.Answer && Array.isArray(json.Answer)) {
        const ips = json.Answer.filter((a: any) => a.type === 1).map((a: any) => a.data);
        if (ips.length > 0) return ips;
      }
    }
  } catch (e) {}

  const mapped = resolveHostToIp(domain);
  return [mapped !== domain ? mapped : '93.184.216.34'];
}

export const netCommands: Command[] = [
  {
    name: 'ifconfig',
    description: 'configure a network interface',
    category: 'net',
    execute: async () => {
      const ipInfo = await getRealClientNetworkInfo();
      const output = [
        'eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500',
        `        inet ${ipInfo.publicIp}  netmask 255.255.255.0  broadcast 192.168.1.255`,
        '        inet6 fe80::5054:ff:fe12:3456  prefixlen 64  scopeid 0x20<link>',
        '        ether 52:54:00:12:34:56  txqueuelen 1000  (Ethernet)',
        '        RX packets 14205  bytes 18290451 (18.2 MB)',
        '        RX errors 0  dropped 0  overruns 0  frame 0',
        '        TX packets 9831  bytes 1294801 (1.2 MB)',
        '        TX errors 0  dropped 0 overruns 0  carrier 0  collisions 0',
        '',
        'lo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536',
        '        inet 127.0.0.1  netmask 255.0.0.0',
        '        inet6 ::1  prefixlen 128  scopeid 0x10<host>',
        '        loop  txqueuelen 1000  (Local Loopback)',
        '        RX packets 520  bytes 43810 (43.8 KB)',
        '        TX packets 520  bytes 43810 (43.8 KB)',
      ].join('\n');
      return { stdout: output + '\n', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'ip',
    description: 'show / manipulate routing, network devices, interfaces and tunnels',
    category: 'net',
    execute: async (ctx) => {
      const sub = ctx.args[0] || 'a';
      if (sub === 'a' || sub === 'addr' || sub === 'address') {
        const ipInfo = await getRealClientNetworkInfo();
        const output = [
          '1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000',
          '    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00',
          '    inet 127.0.0.1/8 scope host lo',
          '       valid_lft forever preferred_lft forever',
          '    inet6 ::1/128 scope host',
          '       valid_lft forever preferred_lft forever',
          '2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000',
          '    link/ether 52:54:00:12:34:56 brd ff:ff:ff:ff:ff:ff',
          `    inet ${ipInfo.publicIp}/24 brd 192.168.1.255 scope global eth0`,
          '       valid_lft forever preferred_lft forever',
          '    inet6 fe80::5054:ff:fe12:3456/64 scope link',
          '       valid_lft forever preferred_lft forever',
        ].join('\n');
        return { stdout: output + '\n', stderr: '', exitCode: 0 };
      }
      return { stdout: 'Usage: ip [ OPTIONS ] OBJECT { COMMAND | help }\n', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'netstat',
    description: 'Print network connections, routing tables, interface statistics, masquerade connections, and multicast memberships',
    category: 'net',
    execute: () => {
      const ports = globalServiceManager.getListeningPorts();
      
      const lines = [
        'Active Internet connections (only servers)',
        'Proto Recv-Q Send-Q Local Address           Foreign Address         State      ',
      ];

      ports.forEach((p: { port: number; name: string }) => {
        const addr = p.port === 80 || p.port === 3306 ? `127.0.0.1:${p.port}` : `0.0.0.0:${p.port}`;
        lines.push(`tcp        0      0 ${addr.padEnd(23)} 0.0.0.0:*               LISTEN     `);
      });

      return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'nslookup',
    description: 'query Internet name servers interactively',
    category: 'net',
    execute: async (ctx) => {
      const domain = ctx.args[0];
      if (!domain) {
        return { stdout: '', stderr: 'nslookup: missing domain name\n', exitCode: 1 };
      }

      const ips = await queryDoHDns(domain);

      let output = `Server:\t\t1.1.1.1\nAddress:\t1.1.1.1#53\n\nNon-authoritative answer:\nName:\t${domain}\n`;
      ips.forEach((ip) => {
        output += `Address: ${ip}\n`;
      });

      return { stdout: output, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'ss',
    description: 'another utility to investigate sockets',
    category: 'net',
    execute: () => {
      const ports = globalServiceManager.getListeningPorts();
      const lines = [
        'Netid State   Recv-Q Send-Q Local Address:Port   Peer Address:Port Process',
      ];
      ports.forEach((p: { port: number; name: string }) => {
        const addr = p.port === 80 || p.port === 3306 ? `127.0.0.1:${p.port}` : `0.0.0.0:${p.port}`;
        lines.push(`tcp   LISTEN  0      128    ${addr.padEnd(21)} 0.0.0.0:*       users:(("${p.name}",pid=4,fd=3))`);
      });
      return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
    },
  },
];
