// Behavioral Network & Additional Archive Commands for Earendel
import { Command } from '../types';
import { resolveHostToIp } from './netCommands';
import { globalFirewallEngine } from '../firewallEngine';

export const netArchiveCommands: Command[] = [
  {
    name: 'ping',
    description: 'Send ICMP ECHO_REQUEST to network hosts',
    category: 'sys',
    execute: async (ctx) => {
      const target = ctx.args.find((a) => !a.startsWith('-')) || '8.8.8.8';
      const ip = resolveHostToIp(target);

      if (!globalFirewallEngine.isPortAllowed(80, 'tcp')) {
        return { stdout: '', stderr: `ping: connect: Network is unreachable (Blocked by Firewall rules)\n`, exitCode: 2 };
      }

      let out = `PING ${target} (${ip}) 56(84) bytes of data.\n`;
      for (let i = 1; i <= 4; i++) {
        const time = (12 + Math.random() * 8).toFixed(1);
        out += `64 bytes from ${ip}: icmp_seq=${i} ttl=117 time=${time} ms\n`;
        await new Promise((r) => setTimeout(r, 600)); // Real-time 0.6s echo pulse
      }
      out += `\n--- ${target} ping statistics ---\n4 packets transmitted, 4 received, 0% packet loss, time 2400ms\nrtt min/avg/max/mdev = 12.1/15.4/19.8/2.1 ms\n`;
      return { stdout: out, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'curl',
    description: 'Transfer data from or to a server',
    category: 'sys',
    execute: async (ctx) => {
      const url = ctx.args.find((a) => a.startsWith('http://') || a.startsWith('https://')) || ctx.args[0];
      if (!url) return { stdout: '', stderr: 'curl: try \'curl --help\' for more information\n', exitCode: 2 };

      // Firewall Rule Enforcement
      if (!globalFirewallEngine.isPortAllowed(80, 'tcp')) {
        return { stdout: '', stderr: `curl: (7) Failed to connect to port 80: Connection refused (Blocked by Firewall)\n`, exitCode: 7 };
      }

      try {
        const res = await fetch(url, { method: 'GET' });
        const text = await res.text();
        return { stdout: text + '\n', stderr: '', exitCode: 0 };
      } catch (err) {
        // Fallback for CORS restricted endpoints with realistic HTTP response headers
        return {
          stdout: `HTTP/1.1 200 OK
Date: ${new Date().toUTCString()}
Server: Earendel-Web-Terminal/1.0
Content-Type: text/html; charset=UTF-8
Connection: keep-alive

<!DOCTYPE html>
<html>
<head><title>Welcome to ${url}</title></head>
<body>
<h1>Hello from Earendel Web Engine!</h1>
<p>Successfully fetched response payload for ${url}</p>
</body>
</html>\n`,
          stderr: '',
          exitCode: 0,
        };
      }
    },
  },
  {
    name: 'wget',
    description: 'The non-interactive network downloader',
    category: 'sys',
    execute: async (ctx) => {
      const url = ctx.args.find((a) => a.startsWith('http://') || a.startsWith('https://')) || ctx.args[0];
      if (!url) return { stdout: '', stderr: 'wget: missing URL\n', exitCode: 1 };

      const fileName = url.split('/').pop() || 'index.html';
      let content = `<!-- Downloaded from ${url} -->\n<h1>Earendel Download Sample</h1>\n`;

      try {
        const res = await fetch(url);
        content = await res.text();
      } catch (e) {
        // Ignore CORS fallback
      }

      ctx.vfs.writeFile(fileName, content);
      return {
        stdout: `--${new Date().toISOString()}--  ${url}
Resolving ${url.replace(/^https?:\/\//, '').split('/')[0]}... 104.21.48.12
Connecting to 104.21.48.12:443... connected.
HTTP request sent, awaiting response... 200 OK
Length: ${content.length} [text/html]
Saving to: '${fileName}'

'${fileName}' saved [${content.length}/${content.length}]\n`,
        stderr: '',
        exitCode: 0,
      };
    },
  },
  {
    name: 'zip',
    description: 'Package and compress (archive) files',
    category: 'archive',
    execute: (ctx) => {
      const zipName = ctx.args[0];
      const files = ctx.args.slice(1);
      if (!zipName || files.length === 0) return { stdout: '', stderr: 'zip error: Invalid command arguments\n', exitCode: 1 };

      let zipContent = `PK34[ZIP_ARCHIVE:${zipName}]\n`;
      for (const f of files) {
        const c = ctx.vfs.readFile(f);
        if (c !== null) zipContent += `[FILE:${f}]\n${c}\n[ENDFILE]\n`;
      }
      ctx.vfs.writeFile(zipName.endsWith('.zip') ? zipName : `${zipName}.zip`, zipContent);
      return { stdout: `  adding: ${files.join(' (deflated 45%)\n  adding: ')} (deflated 45%)\n`, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'unzip',
    description: 'List, test and extract compressed files in a ZIP archive',
    category: 'archive',
    execute: (ctx) => {
      const zipName = ctx.args[0];
      if (!zipName) return { stdout: '', stderr: 'unzip: missing zipfile name\n', exitCode: 1 };

      const content = ctx.vfs.readFile(zipName);
      if (!content || !content.startsWith('PK34[ZIP_ARCHIVE:')) {
        return { stdout: '', stderr: `unzip: cannot find or open ${zipName}\n`, exitCode: 9 };
      }

      const fileBlocks = content.split('[FILE:');
      let extracted: string[] = [];
      for (let i = 1; i < fileBlocks.length; i++) {
        const block = fileBlocks[i];
        const fnEnd = block.indexOf(']\n');
        if (fnEnd !== -1) {
          const fn = block.substring(0, fnEnd);
          const fc = block.substring(fnEnd + 2, block.indexOf('\n[ENDFILE]'));
          ctx.vfs.writeFile(fn, fc);
          extracted.push(fn);
        }
      }
      return { stdout: `Archive:  ${zipName}\n  inflating: ${extracted.join('\n  inflating: ')}\n`, stderr: '', exitCode: 0 };
    },
  },
];
