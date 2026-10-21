import { Command } from '../types';
import { resolveHostToIp, queryDoHDns } from './netCommands';
import { globalFirewallEngine } from '../firewallEngine';
import { SyscallNo } from '../../kernel/types';
import { simulatedNetwork } from '../networkSimulation';

export const netArchiveCommands: Command[] = [
  {
    name: 'ping',
    description: 'Send ICMP ECHO_REQUEST to network hosts (-c, -i, -s, -q, -W)',
    category: 'sys',
    execute: async (ctx) => {
      let count = 4;
      let intervalSec = 0.2;
      let packetSize = 56;
      let quiet = false;
      let targetHost = '';

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg === '-c' && ctx.args[i + 1]) {
          count = parseInt(ctx.args[i + 1], 10) || 4;
          i++;
        } else if (arg.startsWith('-c')) {
          count = parseInt(arg.slice(2), 10) || 4;
        } else if (arg === '-i' && ctx.args[i + 1]) {
          intervalSec = parseFloat(ctx.args[i + 1]) || 0.2;
          i++;
        } else if (arg === '-s' && ctx.args[i + 1]) {
          packetSize = parseInt(ctx.args[i + 1], 10) || 56;
          i++;
        } else if (arg === '-q' || arg === '--quiet') {
          quiet = true;
        } else if (!arg.startsWith('-')) {
          targetHost = arg;
        }
      }

      const target = targetHost || '8.8.8.8';
      const resolvedIps = await queryDoHDns(target);
      const ip = resolvedIps[0];
      if (!ip) return { stdout: '', stderr: `ping: ${target}: Name or service not known\n`, exitCode: 2 };

      const pingDecision = globalFirewallEngine.evaluate({ protocol: 'icmp', source: simulatedNetwork.localIp, destination: ip, target: 'OUTPUT' });
      if (pingDecision !== 'ALLOW') {
        return { stdout: '', stderr: `ping: connect: Network is unreachable (Blocked by Firewall rules)\n`, exitCode: 2 };
      }

      count = Math.max(1, Math.min(count, 100));
      packetSize = Math.max(0, Math.min(packetSize, 65500));
      intervalSec = Math.max(0, Math.min(intervalSec, 1));

      let out = `PING ${target} (${ip}) ${packetSize}(${packetSize + 28}) bytes of data.\n`;
      const times: number[] = [];

      for (let i = 1; i <= count; i++) {
        // ICMP is simulated; never probe the user's real network from the browser.
        const elapsed = 14.2 + ((i * 17) % 31) / 10;
        times.push(elapsed);
        if (!quiet) {
          out += `${packetSize + 8} bytes from ${ip}: icmp_seq=${i} ttl=117 time=${times[times.length - 1]} ms\n`;
        }
        if (i < count) {
          await new Promise((r) => setTimeout(r, Math.min(intervalSec * 1000, 1000)));
        }
      }

      const min = Math.min(...times).toFixed(1);
      const max = Math.max(...times).toFixed(1);
      const avg = (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1);

      out += `\n--- ${target} ping statistics ---\n${count} packets transmitted, ${count} received, 0% packet loss, time ${Math.round(count * intervalSec * 1000)}ms\nrtt min/avg/max/mdev = ${min}/${avg}/${max}/2.1 ms\n`;
      return { stdout: out, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'curl',
    description: 'Transfer data from or to a server (supports -X, -H, -d, -o, -O, -i, -I, -s, -u, -L)',
    category: 'sys',
    execute: async (ctx) => {
      let rawUrl = '';
      const customHeaders: Record<string, string> = {};
      let method = 'GET';
      let bodyData: string | undefined = undefined;
      let outFile: string | null = null;
      let remoteName = false;
      let showHeadersOnly = false;
      let includeHeaders = false;
      let silent = false;
      let userAuth: string | null = null;

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg === '-X' && ctx.args[i + 1]) {
          method = ctx.args[i + 1].toUpperCase();
          i++;
        } else if (arg.startsWith('-X')) {
          method = arg.slice(2).toUpperCase();
        } else if (arg === '-d' || arg === '--data' || arg === '--data-raw') {
          bodyData = ctx.args[i + 1];
          if (method === 'GET') method = 'POST';
          i++;
        } else if (arg === '-H' || arg === '--header') {
          if (ctx.args[i + 1]) {
            const hStr = ctx.args[i + 1];
            const colonIdx = hStr.indexOf(':');
            if (colonIdx !== -1) {
              const k = hStr.slice(0, colonIdx).trim();
              const v = hStr.slice(colonIdx + 1).trim();
              customHeaders[k] = v;
            }
            i++;
          }
        } else if (arg === '-o' || arg === '--output') {
          outFile = ctx.args[i + 1] || null;
          i++;
        } else if (arg === '-O' || arg === '--remote-name') {
          remoteName = true;
        } else if (arg === '-I' || arg === '--head') {
          showHeadersOnly = true;
        } else if (arg === '-i' || arg === '--include') {
          includeHeaders = true;
        } else if (arg === '-s' || arg === '--silent') {
          silent = true;
        } else if (arg === '-u' || arg === '--user') {
          userAuth = ctx.args[i + 1] || null;
          i++;
        } else if (!arg.startsWith('-')) {
          rawUrl = arg;
        }
      }

      if (!rawUrl) return { stdout: '', stderr: "curl: try 'curl --help' for more information\n", exitCode: 2 };

      if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
        rawUrl = 'https://' + rawUrl;
      }

      if (remoteName && !outFile) {
        try {
          const parsed = new URL(rawUrl);
          const parts = parsed.pathname.split('/').filter(Boolean);
          outFile = parts[parts.length - 1] || 'index.html';
        } catch (e) {
          outFile = 'downloaded_file';
        }
      }

      let requestUrl: URL;
      try { requestUrl = new URL(rawUrl); } catch { return { stdout: '', stderr: `curl: (3) URL rejected: ${rawUrl}\n`, exitCode: 3 }; }
      const requestPort = requestUrl.port ? Number(requestUrl.port) : requestUrl.protocol === 'https:' ? 443 : 80;
      const firewallDecision = globalFirewallEngine.evaluate({ port: requestPort, protocol: 'tcp', source: simulatedNetwork.localIp, destination: resolveHostToIp(requestUrl.hostname), target: 'OUTPUT' });
      if (firewallDecision !== 'ALLOW') return { stdout: '', stderr: `curl: (7) Connection ${firewallDecision.toLowerCase()} by simulated firewall on port ${requestPort}\n`, exitCode: 7 };

      if (userAuth) {
        customHeaders['Authorization'] = `Basic ${btoa(userAuth)}`;
      }
      if (bodyData && !customHeaders['Content-Type']) {
        customHeaders['Content-Type'] = 'application/json';
      }

      let fetchedResponse: Response | null = null;
      let bodyText = '';
      const { eslibNet } = await import('../eslibNet');
      const response = await eslibNet.fetch(rawUrl, { method, headers: customHeaders, body: bodyData, signal: ctx.abortSignal }, ctx.syscall);
      if (!response?.ok) return { stdout: '', stderr: `curl: (7) ${response?.error || response?.statusText || 'Network request failed'}\n`, exitCode: 7 };
      bodyText = response.body || '';
      fetchedResponse = { status: response.status, statusText: response.statusText, headers: new Headers(response.headers || []) } as Response;

      const status = fetchedResponse ? fetchedResponse.status : 200;
      const statusText = fetchedResponse ? fetchedResponse.statusText || 'OK' : 'OK';
      const contentType = fetchedResponse?.headers.get('content-type') || 'text/html';

      let headerBlock = `HTTP/1.1 \x1b[1;32m${status} ${statusText}\x1b[0m\n`;
      headerBlock += `Date: ${new Date().toUTCString()}\n`;
      headerBlock += `Server: Earendel-POSIX-WebOS/1.0\n`;
      headerBlock += `Content-Type: ${contentType}\n`;
      headerBlock += `\n`;

      // Auto Pretty Print JSON if terminal output
      let formattedBody = bodyText;
      if (!outFile && (contentType.includes('application/json') || (bodyText.startsWith('{') && bodyText.endsWith('}')))) {
        try {
          const parsed = JSON.parse(bodyText);
          formattedBody = JSON.stringify(parsed, null, 2);
        } catch (e) {}
      }

      if (outFile) {
        const writeResult = await ctx.syscall(SyscallNo.SYS_WRITE, outFile, bodyText);
        if (writeResult.code !== 0) {
          return { stdout: '', stderr: `curl: cannot write '${outFile}': ${writeResult.error || 'write failed'}\n`, exitCode: 23 };
        }
        const feedback = silent ? '' : `\x1b[32m[curl]\x1b[0m Transferred ${bodyText.length} bytes -> Saved to \x1b[1;36m${outFile}\x1b[0m\n`;
        return { stdout: feedback, stderr: '', exitCode: 0 };
      }

      if (showHeadersOnly) {
        return { stdout: headerBlock, stderr: '', exitCode: 0 };
      }

      if (includeHeaders) {
        return { stdout: headerBlock + formattedBody + '\n', stderr: '', exitCode: 0 };
      }

      return { stdout: formattedBody.endsWith('\n') ? formattedBody : formattedBody + '\n', stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'wget',
    description: 'The non-interactive network downloader (-O, -q, -c)',
    category: 'sys',
    execute: async (ctx) => {
      let rawUrl = '';
      let outFile: string | null = null;
      let quiet = false;

      for (let i = 0; i < ctx.args.length; i++) {
        const arg = ctx.args[i];
        if (arg === '-O' && ctx.args[i + 1]) {
          outFile = ctx.args[i + 1];
          i++;
        } else if (arg.startsWith('-O=')) {
          outFile = arg.slice(3);
        } else if (arg === '-q' || arg === '--quiet') {
          quiet = true;
        } else if (!arg.startsWith('-')) {
          rawUrl = arg;
        }
      }

      if (!rawUrl) return { stdout: '', stderr: 'wget: missing URL\nUsage: wget [OPTION]... [URL]...\n', exitCode: 1 };

      if (!/^https?:\/\//i.test(rawUrl)) {
        rawUrl = 'https://' + rawUrl;
      }

      let parsedUrl: URL;
      try { parsedUrl = new URL(rawUrl); } catch { return { stdout: '', stderr: `wget: invalid URL '${rawUrl}'\n`, exitCode: 1 }; }
      const host = parsedUrl.hostname;
      const fileName = outFile || parsedUrl.pathname.split('/').filter(Boolean).pop() || 'index.html';
      const ip = resolveHostToIp(host);

      let bodyText = '';
      let contentType = 'text/html';

      const requestPort = parsedUrl.port ? Number(parsedUrl.port) : parsedUrl.protocol === 'https:' ? 443 : 80;
      const firewallDecision = globalFirewallEngine.evaluate({ port: requestPort, protocol: 'tcp', source: simulatedNetwork.localIp, destination: resolveHostToIp(host), target: 'OUTPUT' });
      if (firewallDecision !== 'ALLOW') return { stdout: '', stderr: `wget: connection blocked by simulated firewall on port ${requestPort}\n`, exitCode: 4 };
      const { eslibNet } = await import('../eslibNet');
      const response = await eslibNet.fetch(rawUrl, { signal: ctx.abortSignal }, ctx.syscall);
      if (!response?.ok) return { stdout: '', stderr: `wget: ${response?.error || response?.statusText || 'Network request failed'}\n`, exitCode: 4 };
      contentType = (response.headers || []).find(([key]: [string, string]) => key.toLowerCase() === 'content-type')?.[1] || contentType;
      bodyText = response.body || '';

      // POSIX System Call SYS_WRITE -> vfsd IPC
      const writeResult = await ctx.syscall(SyscallNo.SYS_WRITE, fileName, bodyText);
      if (writeResult.code !== 0) {
        return { stdout: '', stderr: `wget: cannot write '${fileName}': ${writeResult.error || 'write failed'}\n`, exitCode: 3 };
      }

      const sizeBytes = bodyText.length;
      const sizeKB = (sizeBytes / 1024).toFixed(1);
      const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);

      const out = [
        `--${nowStr}--  ${rawUrl}`,
        `Resolving ${host} (${host})... ${ip}`,
        `Connecting to ${host} (${ip})|:443... connected.`,
        `HTTP request sent, awaiting response... \x1b[1;32m200 OK\x1b[0m`,
        `Length: ${sizeBytes} (${sizeKB}K) [${contentType}]`,
        `Saving to: '${fileName}'`,
        ``,
        `${fileName.padEnd(20)} 100%[=====================================>] ${sizeKB}K  --.-KB/s    in 0.1s`,
        ``,
        `${nowStr} (1.2 MB/s) - '${fileName}' saved [${sizeBytes}/${sizeBytes}] (via POSIX vfsd SYS_WRITE)\n`,
      ].join('\n');

      return { stdout: out, stderr: '', exitCode: 0 };
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
