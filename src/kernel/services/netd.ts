// Earendel Microkernel Network Subsystem Service Daemon (netd - PID 9)
import { globalIPCBus } from '../ipcBus';
import { IPCMessage } from '../types';

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
    const { url, method = 'GET', headers = {}, body } = payload;
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
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
    const { hostname } = payload;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return { hostname, ip: '127.0.0.1', addresses: ['127.0.0.1'] };
    }

    try {
      // Cloudflare DoH (DNS-over-HTTPS) JSON Query
      const dohUrl = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`;
      const res = await fetch(dohUrl, {
        headers: { Accept: 'application/dns-json' },
      });
      const data = await res.json();
      
      if (data && data.Answer && data.Answer.length > 0) {
        const ips = data.Answer.filter((ans: any) => ans.type === 1).map((ans: any) => ans.data);
        return {
          hostname,
          ip: ips[0] || '104.21.55.1',
          addresses: ips,
        };
      }
    } catch (_) {}

    // Fallback DoH Mock
    return {
      hostname,
      ip: '104.21.55.1',
      addresses: ['104.21.55.1'],
    };
  }

  private async handleSocket(payload: { url: string; type?: 'ws' | 'webrtc' }) {
    const { url, type = 'ws' } = payload;
    const socketId = `sock_${Math.random().toString(36).substring(2, 9)}`;

    if (type === 'ws') {
      try {
        const ws = new WebSocket(url);
        this.activeSockets.set(socketId, ws);
        return { socketId, status: 'CONNECTING', type: 'ws' };
      } catch (err: any) {
        return { error: err.message };
      }
    }

    return { socketId, status: 'MOCK_CONNECTED', type };
  }

  private async handleListen(payload: { port?: number }) {
    return { status: 'LISTENING', peerId: `peer_${Math.random().toString(36).substring(2, 9)}` };
  }
}

export const globalNetworkDaemon = new NetworkDaemon();
