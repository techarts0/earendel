// Earendel Microkernel Network Subsystem Service Daemon (netd - PID 9)
import { globalIPCBus } from '../ipcBus';
import { IPCMessage } from '../types';
import { globalFirewallEngine } from '../../core/firewallEngine';
import { simulatedResolve } from '../../core/networkSimulation';
import { globalCapabilityManager } from '../capability';
import { globalTaskScheduler } from '../taskScheduler';

export class NetworkDaemon {
  public static readonly MAX_SOCKETS_PER_PROCESS = 32;
  public static readonly MAX_FETCHES_PER_PROCESS = 8;
  public static readonly MAX_FETCH_URL_CHARS = 2048;
  public static readonly MAX_FETCH_REQUEST_BYTES = 1_048_576;
  public static readonly MAX_FETCH_RESPONSE_BYTES = 1_048_576;
  public static readonly MAX_FETCH_HEADERS = 64;
  private activeSockets: Map<string, { ownerPid: number; resource: string; socket: WebSocket }> = new Map();
  private activeFetches = new Map<number, Set<{ controller: AbortController; resource: string }>>();

  constructor() {
    globalCapabilityManager.onRevocation((pid, capability) => {
      if (capability === 'CAP_NET_ADMIN') this.cancelUnauthorizedNetworkResources(pid);
    });
    globalIPCBus.onProcessExit((pid) => {
      this.closeProcessSockets(pid);
      this.abortProcessFetches(pid);
    });
    this.initService();
  }

  private abortProcessFetches(pid: number): void {
    const requests = this.activeFetches.get(pid);
    if (!requests) return;
    this.activeFetches.delete(pid);
    for (const request of requests) request.controller.abort(new Error(`ESRCH: process ${pid} exited`));
  }

  private cancelUnauthorizedNetworkResources(pid: number): void {
    for (const request of this.activeFetches.get(pid) || []) {
      if (!globalCapabilityManager.hasCapability(pid, 'CAP_NET_ADMIN', request.resource)) {
        request.controller.abort(new Error(`EACCES: CAP_NET_ADMIN revoked for '${request.resource}'`));
      }
    }
    for (const [socketId, entry] of this.activeSockets) {
      if (entry.ownerPid !== pid || globalCapabilityManager.hasCapability(pid, 'CAP_NET_ADMIN', entry.resource)) continue;
      this.activeSockets.delete(socketId);
      try { entry.socket.close(1008, 'CAP_NET_ADMIN revoked'); } catch { /* Revocation cleanup is best-effort. */ }
    }
  }

  private closeProcessSockets(pid: number): void {
    for (const [socketId, entry] of this.activeSockets) {
      if (entry.ownerPid !== pid) continue;
      this.activeSockets.delete(socketId);
      try { entry.socket.close(); } catch { /* Process cleanup continues even if the browser socket is already closed. */ }
    }
  }

  private handleClose(payload: { socketId?: string }, ownerPid: number) {
    const socketId = payload?.socketId;
    if (typeof socketId !== 'string' || !socketId) return { error: 'EINVAL: socket ID is required' };
    const entry = this.activeSockets.get(socketId);
    if (!entry) return { error: 'EBADF: unknown or already closed socket' };
    if (entry.ownerPid !== ownerPid) return { error: 'EPERM: socket belongs to another process' };
    this.activeSockets.delete(socketId);
    try { entry.socket.close(); } catch { /* Treat an already-closed browser socket as closed. */ }
    return { success: true, socketId };
  }

  private initService() {
    globalIPCBus.registerService('netd', 9, async (msg: IPCMessage) => {
      const process = globalTaskScheduler.getProcess(msg.senderPid);
      if (!process || process.state !== 'RUNNING') return { error: `ESRCH: process ${msg.senderPid} is not running` };
      const resource = typeof msg.payload?.url === 'string'
        ? msg.payload.url
        : typeof msg.payload?.hostname === 'string'
          ? msg.payload.hostname
          : msg.payload?.port !== undefined
            ? `port:${msg.payload.port}`
            : undefined;
      if (msg.action !== 'SYS_NET_CLOSE' && !globalCapabilityManager.hasCapability(msg.senderPid, 'CAP_NET_ADMIN', resource)) {
        return { error: `EACCES: PID ${msg.senderPid} lacks CAP_NET_ADMIN${resource ? ` for '${resource}'` : ''}` };
      }
      switch (msg.action) {
        case 'SYS_NET_FETCH':
          return await this.handleFetch(msg.payload, msg.senderPid);
        case 'SYS_NET_RESOLVE':
          return await this.handleResolve(msg.payload);
        case 'SYS_NET_SOCKET':
          return await this.handleSocket(msg.payload, msg.senderPid);
        case 'SYS_NET_CLOSE':
          return this.handleClose(msg.payload, msg.senderPid);
        case 'SYS_NET_LISTEN':
          return await this.handleListen(msg.payload);
        default:
          return { error: `[netd] Unknown action: ${msg.action}` };
      }
    });
  }

  private async handleFetch(payload: { url: string; method?: string; headers?: Record<string, string>; body?: any; signal?: AbortSignal }, ownerPid: number) {
    let { url, method = 'GET', headers = {}, body } = payload;
    if (!url) {
      return { status: 0, statusText: 'Bad URL', ok: false, body: '', error: 'URL is required' };
    }
    if (typeof url !== 'string' || url.length > NetworkDaemon.MAX_FETCH_URL_CHARS) {
      return { status: 0, statusText: 'Bad URL', ok: false, body: '', error: `URL exceeds ${NetworkDaemon.MAX_FETCH_URL_CHARS} characters` };
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
    if (!headers || typeof headers !== 'object' || Array.isArray(headers) || Object.keys(headers).length > NetworkDaemon.MAX_FETCH_HEADERS) {
      return { status: 0, statusText: 'Invalid Headers', ok: false, body: '', error: `At most ${NetworkDaemon.MAX_FETCH_HEADERS} request headers are allowed` };
    }
    for (const [name, value] of Object.entries(headers)) {
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || typeof value !== 'string' || value.length > 8192 || /[\r\n]/.test(value)) {
        return { status: 0, statusText: 'Invalid Headers', ok: false, body: '', error: 'Request headers must have valid names and bounded string values' };
      }
    }
    let requestBody: string | undefined;
    if (body !== undefined && body !== null && body !== '') {
      try { requestBody = typeof body === 'string' ? body : JSON.stringify(body); } catch {
        return { status: 0, statusText: 'Invalid Body', ok: false, body: '', error: 'Request body is not serializable' };
      }
      if (new TextEncoder().encode(requestBody ?? '').byteLength > NetworkDaemon.MAX_FETCH_REQUEST_BYTES) {
        return { status: 0, statusText: 'Payload Too Large', ok: false, body: '', error: `Request body exceeds ${NetworkDaemon.MAX_FETCH_REQUEST_BYTES} bytes` };
      }
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

    const controller = new AbortController();
    const process = globalTaskScheduler.getProcess(ownerPid);
    if (!process || process.state !== 'RUNNING') {
      return { status: 0, statusText: 'Fetch Error', ok: false, body: '', error: `ESRCH: process ${ownerPid} is not running` };
    }
    const requests = this.activeFetches.get(ownerPid) || new Set<{ controller: AbortController; resource: string }>();
    if (requests.size >= NetworkDaemon.MAX_FETCHES_PER_PROCESS) {
      return { status: 0, statusText: 'Too Many Requests', ok: false, body: '', error: `Per-process fetch limit (${NetworkDaemon.MAX_FETCHES_PER_PROCESS}) reached` };
    }
    const request = { controller, resource: payload.url };
    requests.add(request);
    this.activeFetches.set(ownerPid, requests);
    const timeout = setTimeout(() => controller.abort(new Error('Network request timed out')), 10000);
    const callerSignal = payload.signal instanceof AbortSignal ? payload.signal : undefined;
    const abortFromCaller = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) abortFromCaller();
    else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
    try {
      const response = await fetch(url, {
        method: methodUpper,
        headers,
        body: requestBody,
        signal: controller.signal,
        // A followed redirect could reach a different port after the firewall check.
        redirect: 'error',
      });

      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > NetworkDaemon.MAX_FETCH_RESPONSE_BYTES) {
        await response.body?.cancel();
        return { status: response.status, statusText: response.statusText, ok: false, body: '', error: `Response exceeds ${NetworkDaemon.MAX_FETCH_RESPONSE_BYTES} bytes` };
      }
      let text = '';
      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let receivedBytes = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            receivedBytes += value.byteLength;
            if (receivedBytes > NetworkDaemon.MAX_FETCH_RESPONSE_BYTES) {
              await reader.cancel();
              return { status: response.status, statusText: response.statusText, ok: false, body: '', error: `Response exceeds ${NetworkDaemon.MAX_FETCH_RESPONSE_BYTES} bytes` };
            }
            text += decoder.decode(value, { stream: true });
          }
          text += decoder.decode();
        } finally {
          reader.releaseLock();
        }
      }
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
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', abortFromCaller);
      const active = this.activeFetches.get(ownerPid);
      active?.delete(request);
      if (active?.size === 0) this.activeFetches.delete(ownerPid);
    }
  }

  private async handleResolve(payload: { hostname: string }) {
    const hostname = payload?.hostname || '';
    if (typeof hostname !== 'string' || hostname.length > 253) {
      return { hostname: '', ip: '', addresses: [], error: 'EINVAL: hostname exceeds 253 characters' };
    }
    const ip = simulatedResolve(hostname);
    if (!ip) return { hostname, ip: '', addresses: [], error: 'NXDOMAIN: invalid hostname' };
    return { hostname, ip, addresses: [ip], simulated: true };
  }

  private async handleSocket(payload: { url: string; type?: 'ws' | 'webrtc' }, ownerPid: number) {
    const { url, type = 'ws' } = payload;
    if (typeof url !== 'string' || url.length > NetworkDaemon.MAX_FETCH_URL_CHARS) {
      return { error: `Socket URL exceeds ${NetworkDaemon.MAX_FETCH_URL_CHARS} characters` };
    }
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
        const activeCount = [...this.activeSockets.values()].filter((entry) => entry.ownerPid === ownerPid).length;
        if (activeCount >= NetworkDaemon.MAX_SOCKETS_PER_PROCESS) {
          return { error: `EMFILE: per-process WebSocket limit (${NetworkDaemon.MAX_SOCKETS_PER_PROCESS}) reached` };
        }
        const ws = new WebSocket(url);
        this.activeSockets.set(socketId, { ownerPid, resource: url, socket: ws });
        const forgetSocket = () => {
          if (this.activeSockets.get(socketId)?.socket === ws) this.activeSockets.delete(socketId);
        };
        ws.addEventListener('close', forgetSocket, { once: true });
        ws.addEventListener('error', forgetSocket, { once: true });
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
