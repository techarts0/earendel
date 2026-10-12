// Earendel Microkernel Network Subsystem Service Daemon (netd - PID 9)
import { globalIPCBus } from '../ipcBus';
import { IPCMessage } from '../types';
import { globalFirewallEngine } from '../../core/firewallEngine';
import { simulatedResolve } from '../../core/networkSimulation';

export class NetworkDaemon {
  private activeSockets: Map<string, WebSocket | RTCPeerConnection> = new Map();

  constructor() {
    this.initService();
  }

  private initService() {
    globalIPCBus.registerService('netd', 9, async (msg: IPCMessage) => {
      switch (msg.action) {
        case 'SYS_NET_FETCH':
          return await this.handleFetch(msg.payload);
        case 'SYS_NET_RESOLVE':
          return await this.handleResolve(msg.payload);
        case 'SYS_NET_SOCKET':
          return await this.handleSocket(msg.payload);
        case 'SYS_NET_LISTEN':
          return await this.handleListen(msg.payload);
        default:
          return { error: `[netd] Unknown action: ${msg.action}` };
      }
    });
  }

  private async handleFetch(payload: { url: string; method?: string; headers?: Record<string, string>; body?: any }) {
    let { url, method = 'GET', headers = {}, body } = payload;
    if (!url) {
      return { status: 0, statusText: 'Bad URL', ok: false, body: '', error: 'URL is required' };
    }

    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    let parsed: URL;
    try { parsed = new URL(url); } catch {
      return { status: 0, statusText: 'Bad URL', ok: false, body: '', error: 'Invalid URL' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { status: 0, statusText: 'Unsupported Protocol', ok: false, body: '', error: 'Only HTTP and HTTPS are supported' };
    }
    if (parsed.username || parsed.password) {
      return { status: 0, statusText: 'Bad URL', ok: false, body: '', error: 'Credentials in URLs are not supported' };
    }
    const methodUpper = (method || 'GET').toUpperCase();
    if (!/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(methodUpper)) {
      return { status: 0, statusText: 'Invalid Method', ok: false, body: '', error: `Unsupported method: ${methodUpper}` };
    }
    const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
    const decision = globalFirewallEngine.evaluate({ port, protocol: 'tcp', target: 'OUTPUT' });
    if (decision !== 'ALLOW') {
      return { status: 0, statusText: decision === 'REJECT' ? 'Connection refused' : 'Network unreachable', ok: false, body: '', error: `Blocked by simulated firewall (${decision})` };
    }

    try {
      const response = await fetch(url, {
        method: methodUpper,
        headers,
        body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
        signal: AbortSignal.timeout(10000),
        // A followed redirect could reach a different port after the firewall check.
        redirect: 'error',
      });

      const text = await response.text();
      return {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        body: text,
        headers: Array.from(response.headers.entries()),
      };
    } catch (err: any) {
      return {
        status: 0,
        statusText: 'Fetch Error',
        ok: false,
        body: '',
        error: err.message,
      };
    }
  }

  private async handleResolve(payload: { hostname: string }) {
    const hostname = payload?.hostname || '';
    const ip = simulatedResolve(hostname);
    if (!ip) return { hostname, ip: '', addresses: [], error: 'NXDOMAIN: invalid hostname' };
    return { hostname, ip, addresses: [ip], simulated: true };
  }

  private async handleSocket(payload: { url: string; type?: 'ws' | 'webrtc' }) {
    const { url, type = 'ws' } = payload;
    if (type !== 'ws' && type !== 'webrtc') return { error: `Unsupported socket type: ${type}` };
    let parsed: URL;
    try { parsed = new URL(url); } catch { return { error: 'Invalid socket URL' }; }
    if (type === 'ws' && parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') return { error: 'WebSocket URL must use ws:// or wss://' };
    if (type === 'ws') {
      const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'wss:' ? 443 : 80;
      const decision = globalFirewallEngine.evaluate({ port, protocol: 'tcp', target: 'OUTPUT' });
      if (decision !== 'ALLOW') return { error: `Blocked by simulated firewall (${decision})` };
    }
    const socketId = `sock_${Math.random().toString(36).substring(2, 9)}`;

    if (type === 'ws') {
      try {
        if (typeof WebSocket === 'undefined') return { error: 'WebSocket is unavailable in this runtime' };
        const ws = new WebSocket(url);
        this.activeSockets.set(socketId, ws);
        ws.addEventListener('close', () => this.activeSockets.delete(socketId), { once: true });
        ws.addEventListener('error', () => this.activeSockets.delete(socketId), { once: true });
        return { socketId, status: 'CONNECTING', type: 'ws' };
      } catch (err: any) {
        return { error: err.message };
      }
    }

    return { socketId, status: 'MOCK_CONNECTED', type };
  }

  private async handleListen(payload: { port?: number }) {
    if (payload?.port !== undefined && (!Number.isInteger(payload.port) || payload.port < 1 || payload.port > 65535)) {
      return { error: 'Port must be an integer from 1 to 65535' };
    }
    return { status: 'LISTENING', peerId: `peer_${Math.random().toString(36).substring(2, 9)}` };
  }
}

export const globalNetworkDaemon = new NetworkDaemon();
