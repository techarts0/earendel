import { Command } from '../types';
import { resolveHostToIp } from './netCommands';

export const netTracerCommands: Command[] = [
  {
    name: 'tcpdump',
    description: 'dump traffic on a network interface',
    category: 'net',
    execute: async (ctx) => {
      const currentUser = ctx.env['USER'] || 'hello';
      if (currentUser !== 'root') {
        return { stdout: '', stderr: 'tcpdump: eth0: You don\'t have permission to capture on that device\n(socket: Operation not permitted)\n', exitCode: 1 };
      }

      const iface = ctx.args.includes('-i') ? ctx.args[ctx.args.indexOf('-i') + 1] || 'eth0' : 'eth0';

      let out = `tcpdump: verbose output suppressed, use -v[v]... for full protocol decode\nlistening on ${iface}, link-type EN10MB (Ethernet), snapshot length 262144 bytes\n\n`;

      const now = new Date();
      const timeStr = now.toTimeString().split(' ')[0] + '.' + Math.floor(Math.random() * 899999 + 100000);

      out += `${timeStr} IP 192.168.1.100.49152 > 127.0.0.1.80: Flags [S], seq 3829104, win 65535, length 0\n`;
      out += `${timeStr} IP 127.0.0.1.80 > 192.168.1.100.49152: Flags [S.], seq 1092841, ack 3829105, win 65535, length 0\n`;
      out += `${timeStr} IP 192.168.1.100.49152 > 127.0.0.1.80: Flags [.], ack 1092842, win 65535, length 0\n`;
      out += `${timeStr} IP 192.168.1.100.49152 > 127.0.0.1.80: Flags [P.], seq 3829105:3829180, ack 1092842, length 75: HTTP: GET / HTTP/1.1\n`;

      out += `\n4 packets captured\n4 packets received by filter\n0 packets dropped by kernel\n`;

      return { stdout: out, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'traceroute',
    description: 'print the route packets trace to network host',
    category: 'net',
    execute: async (ctx) => {
      const target = ctx.args.find((a) => !a.startsWith('-')) || '8.8.8.8';
      const ip = resolveHostToIp(target);

      let out = `traceroute to ${target} (${ip}), 30 hops max, 60 byte packets\n`;

      const hops = [
        { hop: 1, host: '192.168.1.1 (192.168.1.1)', times: '1.124 ms  0.982 ms  1.011 ms' },
        { hop: 2, host: '10.0.0.1 (10.0.0.1)', times: '4.231 ms  3.892 ms  4.102 ms' },
        { hop: 3, host: '114.114.114.114 (114.114.114.114)', times: '12.451 ms  11.892 ms  12.102 ms' },
        { hop: 4, host: `${target} (${ip})`, times: '18.231 ms  17.892 ms  18.102 ms' },
      ];

      for (const h of hops) {
        out += ` ${h.hop}  ${h.host}  ${h.times}\n`;
        await new Promise((r) => setTimeout(r, 400));
      }

      return { stdout: out, stderr: '', exitCode: 0 };
    },
  },
];
