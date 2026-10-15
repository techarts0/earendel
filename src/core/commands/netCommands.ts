import { Command } from '../types';
import { globalVFS } from '../vfs';
import { globalServiceManager } from '../serviceManager';
import { isValidIPv4, simulatedNetwork, simulatedResolve } from '../networkSimulation';

export function resolveHostToIp(host: string): string {
  const hostsContent = globalVFS.readFile('/etc/hosts') ?? '';
  return simulatedResolve(host, hostsContent) || host;
}

export async function getRealClientNetworkInfo(): Promise<{ publicIp: string; localIp: string }> {
  // Keep the legacy API name, but never disclose or probe the user's real IP.
  return { publicIp: simulatedNetwork.publicIp, localIp: simulatedNetwork.localIp };
}

export async function queryDoHDns(domain: string): Promise<string[]> {
  const ip = resolveHostToIp(domain);
  return ip !== domain || isValidIPv4(ip) ? [ip] : [];
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
        `        inet ${ipInfo.localIp}  netmask 255.255.255.0  broadcast 192.168.1.255`,
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
    description: 'Show / manipulate routing, network devices, interfaces and tunnels (ip a, ip link, ip route)',
    category: 'net',
    execute: async (ctx) => {
      const sub = ctx.args[0] || 'a';
      const ipInfo = await getRealClientNetworkInfo();

      if (sub === 'a' || sub === 'addr' || sub === 'address') {
        const output = [
          '1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000',
          '    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00',
          '    inet 127.0.0.1/8 scope host lo',
          '       valid_lft forever preferred_lft forever',
          '    inet6 ::1/128 scope host',
          '       valid_lft forever preferred_lft forever',
          '2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000',
          '    link/ether 52:54:00:12:34:56 brd ff:ff:ff:ff:ff:ff',
          `    inet ${ipInfo.localIp}/24 brd 192.168.1.255 scope global eth0`,
          '       valid_lft forever preferred_lft forever',
          '    inet6 fe80::5054:ff:fe12:3456/64 scope link',
          '       valid_lft forever preferred_lft forever',
        ].join('\n');
        return { stdout: output + '\n', stderr: '', exitCode: 0 };
      }

      if (sub === 'l' || sub === 'link') {
        const output = [
          '1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000',
          '    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00',
          '2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT group default qlen 1000',
          '    link/ether 52:54:00:12:34:56 brd ff:ff:ff:ff:ff:ff',
        ].join('\n');
        return { stdout: output + '\n', stderr: '', exitCode: 0 };
      }

      if (sub === 'r' || sub === 'route') {
        const output = [
          'default via 192.168.1.1 dev eth0 proto dhcp metric 100',
          '192.168.1.0/24 dev eth0 proto kernel scope link src 192.168.1.100 metric 100',
        ].join('\n');
        return { stdout: output + '\n', stderr: '', exitCode: 0 };
      }

      return { stdout: 'Usage: ip [ OPTIONS ] OBJECT { COMMAND | help }\nwhere  OBJECT := { address | link | route | neigh | tunnel }\n', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'netstat',
    description: 'Print network connections, routing tables, interface statistics (-t, -u, -l, -a, -n, -p, -r)',
    category: 'net',
    execute: (ctx) => {
      const flags = new Set<string>();
      for (const arg of ctx.args) {
        if (arg.startsWith('--')) flags.add(arg.slice(2));
        else if (arg.startsWith('-') && arg.length > 1) {
          for (let j = 1; j < arg.length; j++) flags.add(arg[j]);
        }
      }

      if (flags.has('r') || flags.has('route')) {
        let out = 'Kernel IP routing table\n';
        out += 'Destination     Gateway         Genmask         Flags   MSS Window  irtt Iface\n';
        out += '0.0.0.0         192.168.1.1     0.0.0.0         UG        0 0          0 eth0\n';
        out += '192.168.1.0     0.0.0.0         255.255.255.0   U         0 0          0 eth0\n';
        return { stdout: out, stderr: '', exitCode: 0 };
      }

      const showUdp = flags.has('u') || flags.has('udp');
      const showTcp = flags.has('t') || flags.has('tcp') || !showUdp;
      const showListening = flags.has('l') || flags.has('listening');
      const showAll = flags.has('a') || flags.has('all');
      const showProcess = flags.has('p') || flags.has('program');

      const ports = globalServiceManager.getListeningPorts();
      
      const lines = [
        'Active Internet connections (servers and established)',
        `Proto Recv-Q Send-Q Local Address           Foreign Address         State       ${showProcess ? 'PID/Program name' : ''}`.trimEnd(),
      ];

      if (showTcp) {
        ports.forEach((p: { port: number; name: string }) => {
          const addr = p.port === 80 || p.port === 3306 ? `127.0.0.1:${p.port}` : `0.0.0.0:${p.port}`;
          const procStr = showProcess ? `4/${p.name}` : '';
          lines.push(`tcp        0      0 ${addr.padEnd(23)} 0.0.0.0:*               LISTEN      ${procStr}`.trimEnd());
        });

        if (showAll || !showListening) {
          const procStr = showProcess ? '12/curl' : '';
          lines.push(`tcp        0      0 192.168.1.100:54218     93.184.216.34:443       ESTABLISHED ${procStr}`.trimEnd());
        }
      }

      if (showUdp || showAll) {
        lines.push(`udp        0      0 0.0.0.0:68              0.0.0.0:*                           ${showProcess ? '2/dhclient' : ''}`.trimEnd());
        lines.push(`udp        0      0 127.0.0.1:53            0.0.0.0:*                           ${showProcess ? '3/systemd-resolve' : ''}`.trimEnd());
      }

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
      if (ips.length === 0) return { stdout: '', stderr: `** server can't find ${domain}: NXDOMAIN\n`, exitCode: 1 };

      let output = `Server:\t\t${simulatedNetwork.dns}\nAddress:\t${simulatedNetwork.dns}#53\n\nNon-authoritative answer:\nName:\t${domain}\n`;
      ips.forEach((ip) => {
        output += `Address: ${ip}\n`;
      });

      return { stdout: output, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'ss',
    description: 'Investigate sockets (-t, -u, -l, -a, -n, -p)',
    category: 'net',
    execute: (ctx) => {
      const flags = new Set<string>();
      for (const arg of ctx.args) {
        if (arg.startsWith('--')) flags.add(arg.slice(2));
        else if (arg.startsWith('-') && arg.length > 1) {
          for (let j = 1; j < arg.length; j++) flags.add(arg[j]);
        }
      }

      const showUdp = flags.has('u') || flags.has('udp');
      const showTcp = flags.has('t') || flags.has('tcp') || !showUdp;
      const showListening = flags.has('l') || flags.has('listening');
      const showAll = flags.has('a') || flags.has('all');
      const showProcess = flags.has('p') || flags.has('processes');

      const ports = globalServiceManager.getListeningPorts();
      const lines = [
        `Netid State   Recv-Q Send-Q Local Address:Port   Peer Address:Port ${showProcess ? 'Process' : ''}`.trimEnd(),
      ];

      if (showTcp) {
        ports.forEach((p: { port: number; name: string }) => {
          const addr = p.port === 80 || p.port === 3306 ? `127.0.0.1:${p.port}` : `0.0.0.0:${p.port}`;
          const procStr = showProcess ? `users:(("${p.name}",pid=4,fd=3))` : '';
          lines.push(`tcp   LISTEN  0      128    ${addr.padEnd(21)} 0.0.0.0:*       ${procStr}`.trimEnd());
        });

        if (showAll || !showListening) {
          const procStr = showProcess ? `users:(("curl",pid=12,fd=4))` : '';
          lines.push(`tcp   ESTAB   0      0      192.168.1.100:54218   93.184.216.34:443   ${procStr}`.trimEnd());
        }
      }

      if (showUdp || showAll) {
        const procStr = showProcess ? `users:(("dhclient",pid=2,fd=5))` : '';
        lines.push(`udp   UNCONN  0      0      0.0.0.0:68            0.0.0.0:*           ${procStr}`.trimEnd());
      }

      return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'curl',
    description: 'transfer a URL via Earendel Unified Network Subsystem (Syscall #30)',
    category: 'net',
    execute: async (ctx) => {
      let url = ctx.args[0];
      if (!url) {
        return { stdout: '', stderr: "curl: try 'curl --help' or 'curl <url>' for more information\n", exitCode: 2 };
      }

      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `https://${url}`;
      }

      const { eslibNet } = await import('../eslibNet');
      const res = await eslibNet.fetch(url, { signal: ctx.abortSignal }, ctx.syscall);

      if (res?.ok) {
        return { stdout: res.body + '\n', stderr: '', exitCode: 0 };
      }

      return { stdout: '', stderr: `curl: (7) Failed to connect to ${url}: ${res?.error || 'Unknown error'}\n`, exitCode: 7 };
    },
  },
  {
    name: 'fetch',
    description: 'alias for curl / eslib.net.fetch',
    category: 'net',
    execute: async (ctx) => {
      const url = ctx.args[0];
      if (!url) {
        return { stdout: '', stderr: 'Usage: fetch <url>\n', exitCode: 1 };
      }

      const { eslibNet } = await import('../eslibNet');
      const res = await eslibNet.fetch(url, { signal: ctx.abortSignal }, ctx.syscall);
      return { stdout: (res?.body || res?.error || '') + '\n', stderr: '', exitCode: res?.ok ? 0 : 1 };
    },
  },
];
