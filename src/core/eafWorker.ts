export interface EafWorkerResult {
  value?: unknown;
  error?: string;
  env?: Record<string, string>;
  logs: Array<{ level: 'log' | 'warn' | 'error'; args: unknown[] }>;
}

type RpcHandler = (method: string, args: unknown[]) => Promise<unknown> | unknown;
const MAX_RPC_PAYLOAD_BYTES = 4 * 1024 * 1024;
const MAX_ACTIVE_EAF_WORKERS = 8;
const MAX_ACTIVE_RPC_CALLS_PER_WORKER = 64;
let activeEafWorkers = 0;

function estimatePayloadSize(value: unknown, seen = new WeakSet<object>(), depth = 0): number {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return 16;
  if (typeof value === 'string') return value.length * 2;
  if (typeof value !== 'object') return 0;
  if (depth > 64 || seen.has(value)) return depth > 64 ? MAX_RPC_PAYLOAD_BYTES + 1 : 0;
  seen.add(value);
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  let size = 0;
  if (value instanceof Map) {
    for (const [key, child] of value) size += estimatePayloadSize(key, seen, depth + 1) + estimatePayloadSize(child, seen, depth + 1);
  } else if (value instanceof Set) {
    for (const child of value) size += estimatePayloadSize(child, seen, depth + 1);
  } else {
    for (const [key, child] of Object.entries(value)) size += key.length * 2 + estimatePayloadSize(child, seen, depth + 1);
  }
  return size;
}

export const EAF_WORKER_SOURCE = `
(() => {
  'use strict';
  // EAF must not inherit browser storage, network, device, or nested-worker APIs.
  const forbiddenApis = ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource',
    'WebTransport', 'indexedDB', 'caches', 'importScripts', 'Worker', 'SharedWorker',
    'Notification', 'navigator', 'postMessage', 'onmessage', 'BroadcastChannel'];
  const sendToHost = globalThis.postMessage.bind(globalThis);
  const addWorkerListener = globalThis.addEventListener.bind(globalThis);
  for (const name of forbiddenApis) {
    try { Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false }); }
    catch (_) { try { delete globalThis[name]; } catch (_) {} }
  }
  const pending = new Map();
  let nextId = 1;
  let channelToken = '';
  let consoleBudget = 0;
  let consoleCalls = 0;
  const rpc = (method, args) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    try { sendToHost({ type: 'rpc', channelToken, id, method, args }); }
    catch (error) { pending.delete(id); reject(error); }
  });
  const namespace = (prefix) => new Proxy(Object.create(null), {
    get: (target, key) => {
      if (typeof key !== 'string') return undefined;
      if (Object.prototype.hasOwnProperty.call(target, key)) return target[key];
      return (...args) => rpc(prefix + '.' + key, args);
    },
  });
  const safeConsole = Object.freeze(Object.fromEntries(['log', 'warn', 'error'].map(level =>
    [level, (...args) => {
      if (consoleCalls++ >= 10_000) return;
      const bounded = args.slice(0, 32).map(value => {
        if (typeof value === 'string') return value.slice(0, 16_384);
        if (value === null || ['number', 'boolean'].includes(typeof value)) return value;
        // Never traverse attacker-controlled object graphs while formatting a
        // log line: JSON.stringify can execute getters and allocate without a
        // bound before the output is truncated.
        return typeof value === 'undefined' ? '[undefined]' : '[object omitted]';
      });
      const size = bounded.reduce((sum, value) => sum + String(value).length, 0);
      if (consoleBudget >= 1_000_000) return;
      consoleBudget += size;
      sendToHost({ type: 'console', channelToken, level, args: bounded });
    }]
  )));
  const syscall = (...args) => rpc('syscall', args);
  const serializable = (value) => {
    if (value === undefined) return null;
    try { return JSON.parse(JSON.stringify(value)); }
    catch (_) { return String(value); }
  };
  addWorkerListener('message', async (event) => {
    // EAF code shares this realm; ignore synthetic messages so it cannot forge
    // host RPC responses or make the Worker report a fabricated result.
    if (!event.isTrusted) return;
    const message = event.data;
    if (message?.type === 'rpc-result') {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error));
      else {
        const value = message.value;
        if (value && typeof value === 'object' && typeof value.__workerJsonBody === 'string') {
          value.json = () => JSON.parse(value.__workerJsonBody);
          delete value.__workerJsonBody;
        }
        request.resolve(value);
      }
      return;
    }
    if (message?.type !== 'run') return;
    if (typeof message.channelToken !== 'string' || !message.channelToken) return;
    channelToken = message.channelToken;
    try {
      const stillAvailable = forbiddenApis.filter(name => globalThis[name] !== undefined);
      if (stillAvailable.length) throw new Error('Worker platform could not disable APIs: ' + stillAvailable.join(', '));
      const ctx = {
        ...message.context,
        syscall,
        vfs: namespace('vfs'),
      };
      const sys = namespace('eslib.sys');
      Object.assign(sys, {
        getenv: (key) => ctx.env[key] ?? null,
        setenv: (key, value) => { ctx.env[String(key)] = String(value); },
        getcwd: () => ctx.env.PWD || '/home/hello',
        chdir: async (path) => {
          const resolved = await ctx.vfs.resolvePath(path);
          const node = await ctx.vfs.getNodeByPath(resolved);
          if (!node || node.type !== 'directory') return false;
          ctx.env.PWD = resolved;
          return true;
        },
        infer: async (prompt, opts) => {
          const result = await rpc('eslib.sys.infer', [prompt, opts]);
          if (result?.code !== 0) throw new Error(result?.error || 'Inference syscall failed');
          return result.data;
        },
        uname: () => ({
          sysname: 'Earendel-POSIX',
          nodename: ctx.env.HOSTNAME || 'earendel-microkernel',
          release: '6.5.0-generic',
          version: 'Earendel Microkernel v1.0.0-pure-posix',
          machine: 'x86_64',
        }),
        getEmbed: (name) => message.context.embeddedAssets?.[name] ?? null,
        readEmbed: (name) => message.context.embeddedAssets?.[name] ?? null,
      });
      const io = namespace('eslib.io');
      Object.assign(io, {
        printf: (format, ...args) => {
          let output = String(format);
          for (const value of args) output = output.replace(/%[sdx]/, token =>
            token === '%x' ? Number(value).toString(16) : String(value),
          );
          safeConsole.log(output);
          return output;
        },
        puts: (value) => { safeConsole.log(String(value)); return value; },
        color: (colorName, value) => {
          const colors = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', bold: '\x1b[1m', dim: '\x1b[90m', reset: '\x1b[0m' };
          return (colors[String(colorName).toLowerCase()] || '') + String(value) + '\x1b[0m';
        },
      });
      const mem = namespace('eslib.mem');
      Object.assign(mem, { malloc: (sizeBytes) => ({ ptr: Math.floor(Math.random() * 0x100000), size: sizeBytes }) });
      const localNamespaces = Object.assign(Object.create(null), { sys, io, mem });
      const eslib = new Proxy(Object.create(null), {
        get: (_target, key) => typeof key === 'string' ? localNamespaces[key] || namespace('eslib.' + key) : undefined,
      });
      const process = Object.freeze({ ...message.process });
      const runnerCode = 'return (async () => { const __res = eval(' + JSON.stringify(message.code) +
        '); if (__res && typeof __res.then === "function") await __res;' +
        ' if (typeof main === "function") await main(ctx, eslib);' +
        ' if (typeof execute === "function") return await execute(ctx, eslib); })();';
      const runner = new Function('ctx', 'console', 'process', 'syscall', 'eslib', runnerCode);
      const value = await runner(ctx, safeConsole, process, syscall, eslib);
      const safeValue = serializable(value);
      if (JSON.stringify(safeValue).length > 2_000_000) throw new Error('EAF result exceeded 2 MB.');
      sendToHost({ type: 'result', channelToken, value: safeValue, env: ctx.env });
    } catch (error) {
      sendToHost({ type: 'result', channelToken, error: error?.message || String(error) });
    }
  });
})();
`;

export function runEafInWorker(
  code: string,
  context: Record<string, unknown>,
  process: Record<string, unknown>,
  rpcHandler: RpcHandler,
  signal?: AbortSignal,
  timeoutMs = 60_000,
  onTerminate?: (reason: Error) => void,
): Promise<EafWorkerResult> {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return Promise.reject(new Error('Isolated EAF execution requires Web Worker and Blob URL support.'));
  }
  if (activeEafWorkers >= MAX_ACTIVE_EAF_WORKERS) {
    return Promise.reject(new Error(`EAGAIN: EAF Worker limit (${MAX_ACTIVE_EAF_WORKERS}) reached.`));
  }
  if (code.length > 2_000_000 || estimatePayloadSize({ context, process }) > 8 * 1024 * 1024) {
    return Promise.reject(new Error('E2BIG: EAF source or initial context exceeded the Worker payload limit.'));
  }

  let channelToken: string;
  try {
    const randomBytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
    channelToken = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return Promise.reject(new Error('EAF execution requires a cryptographically secure Worker channel.'));
  }

  const blobUrl = URL.createObjectURL(new Blob([EAF_WORKER_SOURCE], { type: 'text/javascript' }));
  let worker: Worker;
  try {
    worker = new Worker(blobUrl);
  } catch (error) {
    URL.revokeObjectURL(blobUrl);
    return Promise.reject(error);
  }
  activeEafWorkers++;

  return new Promise((resolve, reject) => {
    const logs: EafWorkerResult['logs'] = [];
    let rpcCalls = 0;
    let requestBytes = 0;
    let responseBytes = 0;
    let logCalls = 0;
    let logChars = 0;
    let activeRpcCalls = 0;
    let pendingWorkerResult: EafWorkerResult | null = null;
    let settled = false;
    const finish = (error?: Error, result?: EafWorkerResult) => {
      if (settled) return;
      settled = true;
      activeEafWorkers = Math.max(0, activeEafWorkers - 1);
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      URL.revokeObjectURL(blobUrl);
      if (error) {
        onTerminate?.(error);
        reject(error);
      }
      else resolve(result || { logs });
    };
    const onAbort = () => finish(signal?.reason instanceof Error ? signal.reason : new Error('EAF execution aborted'));
    const timeout = setTimeout(() => finish(new Error(`EAF execution exceeded ${timeoutMs}ms`)), timeoutMs);

    worker.onerror = (event) => finish(new Error(event.message || 'EAF Worker crashed'));
    worker.onmessageerror = () => finish(new Error('EAF Worker message could not be deserialized.'));
    worker.onmessage = async (event: MessageEvent) => {
      const message = event.data;
      if (message?.channelToken !== channelToken) {
        finish(new Error('EAF Worker sent an unauthenticated message.'));
        return;
      }
      if (message?.type === 'console') {
        const args = Array.isArray(message.args) ? message.args.slice(0, 32) : [];
        const size = (args as unknown[]).reduce((sum: number, item: unknown) => sum + String(item).length, 0);
        if (++logCalls <= 10_000 && logChars + size <= 1_000_000) {
          logChars += size;
          logs.push({ level: message.level, args });
        }
        return;
      }
      if (message?.type === 'rpc') {
        activeRpcCalls++;
        try {
          if (activeRpcCalls > MAX_ACTIVE_RPC_CALLS_PER_WORKER) {
            throw new Error(`EAGAIN: EAF Worker RPC concurrency limit (${MAX_ACTIVE_RPC_CALLS_PER_WORKER}) reached.`);
          }
          if (++rpcCalls > 10_000) {
            finish(new Error('EAF exceeded the 10,000 IPC request limit.'));
            return;
          }
          if (!Array.isArray(message.args) || message.args.length > 64) throw new Error('EINVAL: invalid EAF IPC arguments');
          const requestSize = estimatePayloadSize(message.args);
          if (requestSize > MAX_RPC_PAYLOAD_BYTES) throw new Error('E2BIG: EAF IPC request exceeded 4 MB');
          requestBytes += requestSize;
          if (requestBytes > 16 * 1024 * 1024) throw new Error('E2BIG: EAF cumulative IPC requests exceeded 16 MB');
          const value = await rpcHandler(String(message.method), message.args);
          const responseSize = estimatePayloadSize(value);
          if (responseSize > MAX_RPC_PAYLOAD_BYTES) throw new Error('E2BIG: EAF IPC response exceeded 4 MB');
          responseBytes += responseSize;
          if (responseBytes > 32 * 1024 * 1024) throw new Error('E2BIG: EAF cumulative IPC responses exceeded 32 MB');
          if (!settled) worker.postMessage({ type: 'rpc-result', id: message.id, value });
        } catch (error) {
          if (!settled) worker.postMessage({ type: 'rpc-result', id: message.id, error: error instanceof Error ? error.message : String(error) });
        } finally {
          activeRpcCalls--;
          if (!settled && pendingWorkerResult && activeRpcCalls === 0) finish(undefined, pendingWorkerResult);
        }
        return;
      }
      if (message?.type === 'result') {
        pendingWorkerResult = message.error
          ? { error: String(message.error), logs }
          : { value: message.value, env: message.env, logs };
        if (activeRpcCalls === 0) finish(undefined, pendingWorkerResult);
      }
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      worker.postMessage({
        type: 'run',
        channelToken,
        code,
        context,
        process,
      });
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
