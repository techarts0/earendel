// Earendel User-space Device Driver Daemon Server (driverd)
import { globalIPCBus } from '../ipcBus';
import { globalFramebufferEngine } from '../../core/framebufferEngine';
import { globalVFS } from '../../core/vfs';
import { IPCMessage } from '../types';
import { globalCapabilityManager } from '../capability';
import { checkNetworkRequest } from '../../core/networkAccessPolicy';
import { globalTaskScheduler } from '../taskScheduler';

export class DriverDaemonService {
  public static readonly PID = 4;
  public static readonly SERVICE_NAME = 'driverd';
  private static readonly MAX_INFERENCE_PROMPT_CHARS = 32_768;
  private static readonly MAX_INFERENCE_RESPONSE_BYTES = 262_144;
  private static readonly MAX_INFERENCE_RESPONSE_CHARS = 32_768;
  private static readonly MAX_INFERENCES_PER_PROCESS = 2;
  private static readonly MAX_CONCURRENT_INFERENCES = 8;
  private activeInferences = new Map<number, number>();
  private activeInferenceControllers = new Map<number, Set<{ controller: AbortController; resource: string }>>();
  private activeInferenceCount = 0;

  private async readBoundedJsonResponse(response: Response): Promise<any> {
    const maxBytes = DriverDaemonService.MAX_INFERENCE_RESPONSE_BYTES;
    const contentLength = Number(response.headers?.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error(`E2BIG: LLM response exceeds ${maxBytes} bytes.`);
    }

    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            await reader.cancel('LLM response size limit exceeded');
            throw new Error(`E2BIG: LLM response exceeds ${maxBytes} bytes.`);
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return JSON.parse(new TextDecoder().decode(bytes));
    }

    // Response streams are standard in browsers. The fallback supports small
    // test/SSR response doubles and checks their serialized size before use.
    if (typeof response.text === 'function') {
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > maxBytes) {
        throw new Error(`E2BIG: LLM response exceeds ${maxBytes} bytes.`);
      }
      return JSON.parse(text);
    }
    if (typeof response.json === 'function') {
      const value = await response.json();
      const serialized = JSON.stringify(value);
      if (typeof serialized !== 'string' || new TextEncoder().encode(serialized).byteLength > maxBytes) {
        throw new Error(`E2BIG: LLM response exceeds ${maxBytes} bytes.`);
      }
      return value;
    }
    throw new Error('EPROTO: LLM response has no readable body.');
  }

  constructor() {
    globalCapabilityManager.onRevocation((pid, capability) => {
      if (capability === 'CAP_NET_ADMIN') this.abortUnauthorizedInferences(pid);
    });
    globalIPCBus.onProcessExit((pid) => this.abortProcessInferences(pid));
    this.startServer();
  }

  private abortProcessInferences(pid: number): void {
    const requests = this.activeInferenceControllers.get(pid);
    if (!requests) return;
    this.activeInferenceControllers.delete(pid);
    for (const request of requests) request.controller.abort(new Error(`ESRCH: process ${pid} exited`));
  }

  private abortUnauthorizedInferences(pid: number): void {
    for (const request of this.activeInferenceControllers.get(pid) || []) {
      if (!globalCapabilityManager.hasCapability(pid, 'CAP_NET_ADMIN', request.resource)) {
        request.controller.abort(new Error(`EACCES: CAP_NET_ADMIN revoked for '${request.resource}'`));
      }
    }
  }

  public startServer() {
    globalIPCBus.registerService(
      DriverDaemonService.SERVICE_NAME,
      DriverDaemonService.PID,
      async (msg: IPCMessage) => this.handleIPCMessage(msg)
    );
  }

  private aiBuffer: string = '';

  private readonly deviceScopes: Record<string, string> = {
    'DEV_READ_AI': '/dev/ai',
    'DEV_WRITE_AI': '/dev/ai',
    'SYS_INFER': '/dev/ai',
    'DEV_WRITE_FB0': '/dev/fb0',
    'DEV_READ_GPU0': '/dev/gpu0',
    'DEV_READ_DSP': '/dev/dsp',
    'DEV_WRITE_DSP': '/dev/dsp',
    'DEV_READ_TTYUSB': '/dev/ttyUSB0',
    'DEV_WRITE_TTYUSB': '/dev/ttyUSB0',
    'DEV_READ_VIDEO0': '/dev/video0',
    'DEV_READ_GPS0': '/dev/gps0',
    'DEV_READ_NVME0N1': '/dev/nvme0n1',
    'DEV_READ_USB': '/dev/bus/usb/001/001',
    'DEV_READ_BT0': '/dev/bt0',
    'DEV_GATEWAY_TUNNEL': '/dev/can0',
  };

  private parseLLMConfig(): Record<string, string> {
    const rawConf = globalVFS.readFile('/etc/llm.conf', 'root') || '';
    const config: Record<string, string> = {
      PROVIDER: 'openai',
      BASE_URL: 'https://api.openai.com/v1',
      MODEL_NAME: 'gpt-4o-mini',
      API_KEY: '',
    };

    rawConf.split('\n').forEach((line: string) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.substring(0, eqIdx).trim();
        const val = trimmed.substring(eqIdx + 1).trim();
        config[key] = val;
      }
    });

    return config;
  }

  private async handleIPCMessage(msg: IPCMessage): Promise<any> {
    const { action, payload } = msg;
    const process = globalTaskScheduler.getProcess(msg.senderPid);
    if (!process || process.state !== 'RUNNING') return { error: `ESRCH: process ${msg.senderPid} is not running` };
    const devicePath = this.deviceScopes[action];
    if (devicePath && !globalCapabilityManager.hasCapability(msg.senderPid, 'CAP_DEVICE_IO', devicePath)) {
      return { error: `EACCES: PID ${msg.senderPid} lacks CAP_DEVICE_IO for '${devicePath}'` };
    }

    switch (action) {
      case 'DEV_READ_NULL':
        return { data: '' };

      case 'DEV_READ_ZERO':
        return { data: '\0\0\0\0\0\0\0\0' };

      case 'DEV_READ_AI': {
        const out = this.aiBuffer || `[Earendel AI Character Device Driver (/dev/ai)]\nStatus: ONLINE (Device Major 10, Minor 250)\nUsage: echo "prompt" > /dev/ai OR cat syslog | /dev/ai\n`;
        return { data: out };
      }

      case 'DEV_WRITE_AI':
      case 'SYS_INFER': {
        const prompt = payload?.prompt ?? payload?.content ?? '';
        if (typeof prompt !== 'string') {
          return { success: false, error: 'EINVAL: inference prompt must be a string.' };
        }
        if (prompt.length > DriverDaemonService.MAX_INFERENCE_PROMPT_CHARS) {
          return { success: false, error: `E2BIG: inference prompt exceeds ${DriverDaemonService.MAX_INFERENCE_PROMPT_CHARS} characters.` };
        }
        const processInferenceCount = this.activeInferences.get(msg.senderPid) || 0;
        if (processInferenceCount >= DriverDaemonService.MAX_INFERENCES_PER_PROCESS ||
            this.activeInferenceCount >= DriverDaemonService.MAX_CONCURRENT_INFERENCES) {
          return { success: false, error: 'EAGAIN: inference capacity is full; retry after an active request completes.' };
        }
        this.activeInferences.set(msg.senderPid, processInferenceCount + 1);
        this.activeInferenceCount++;
        try {
        const cleanPrompt = prompt.trim();

        const llmConfig = this.parseLLMConfig();
        const apiKey = llmConfig['API_KEY'] || '';
        const baseUrl = (llmConfig['BASE_URL'] || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const modelName = llmConfig['MODEL_NAME'] || 'gpt-4o-mini';
        const enableMock = (llmConfig['ENABLE_LOCAL_MOCK'] || 'auto').toLowerCase();
        const endpoint = `${baseUrl}/chat/completions`;
        const networkAuthorized = checkNetworkRequest(msg.senderPid, endpoint) === null;

        // Remote model access is an external network capability. A missing grant
        // always selects the local engine, regardless of global LLM configuration.
        const shouldAttemptFetch = networkAuthorized && enableMock !== 'true' && Boolean(baseUrl);

        if (shouldAttemptFetch) {
          const controller = new AbortController();
          const request = { controller, resource: endpoint };
          const requests = this.activeInferenceControllers.get(msg.senderPid) || new Set<typeof request>();
          requests.add(request);
          this.activeInferenceControllers.set(msg.senderPid, requests);
          const timeout = setTimeout(() => controller.abort(new Error('LLM request timed out')), 30000);
          const callerSignal = payload.signal instanceof AbortSignal
            ? payload.signal
            : payload.opts?.signal instanceof AbortSignal ? payload.opts.signal : undefined;
          const abortFromCaller = () => controller.abort(callerSignal?.reason);
          if (callerSignal?.aborted) abortFromCaller();
          else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
          try {
            const headers: Record<string, string> = {
              'Content-Type': 'application/json',
            };
            if (apiKey && !apiKey.startsWith('sk-your-api-key') && apiKey !== 'sk-xxxxxx') {
              headers['Authorization'] = `Bearer ${apiKey}`;
            }

            const httpRes = await fetch(endpoint, {
              method: 'POST',
              headers,
              signal: controller.signal,
              redirect: 'error',
              body: JSON.stringify({
                model: modelName,
                messages: [
                  { role: 'system', content: 'You are Earendel AI-Native OS Core Assistant.' },
                  { role: 'user', content: cleanPrompt },
                ],
                temperature: 0.3,
              }),
            });

            const json = await this.readBoundedJsonResponse(httpRes);
            let aiText = '';
            if (!httpRes.ok) {
              const errMsg = String(json?.error?.message || json?.error || json?.message || httpRes.statusText).slice(0, 2_000);
              return {
                success: false,
                transport: 'remote',
                error: `LLM API HTTP ${httpRes.status}: ${errMsg}`,
              };
            } else {
              const content = json?.choices?.[0]?.message?.content;
              if (typeof content !== 'string') throw new Error('EPROTO: LLM response content must be a string.');
              if (content.length > DriverDaemonService.MAX_INFERENCE_RESPONSE_CHARS) {
                throw new Error(`E2BIG: LLM response text exceeds ${DriverDaemonService.MAX_INFERENCE_RESPONSE_CHARS} characters.`);
              }
              aiText = content;
            }

            let response = `\x1b[1;36m[Earendel AI-Native OS Core (Model: ${modelName})]\x1b[0m\n${aiText}\n`;
            this.aiBuffer = response;
            return { response, data: response, success: true, transport: 'remote' };
          } catch (err: any) {
            const abortReason = controller.signal.reason;
            if (callerSignal?.aborted || (abortReason instanceof Error && /^(?:EACCES|ESRCH):/.test(abortReason.message))) throw err;
            let response = `\x1b[1;36m[Earendel AI-Native OS Core (Model: ${modelName})]\x1b[0m\n`;
            response += `\x1b[31m[LLM Network Connection Failure]\x1b[0m Failed to connect to ${baseUrl}: ${err.message}\n`;
            this.aiBuffer = response;
            return { response, data: response, success: false, transport: 'remote-fallback', error: err.message };
          } finally {
            clearTimeout(timeout);
            callerSignal?.removeEventListener('abort', abortFromCaller);
            const active = this.activeInferenceControllers.get(msg.senderPid);
            active?.delete(request);
            if (active?.size === 0) this.activeInferenceControllers.delete(msg.senderPid);
          }
        }

        // Native System Fallback Engine (Default Offline Mode)
        let response = `\x1b[1;36m[Earendel AI-Native OS Core Inference Engine (Syscall #25)]\x1b[0m\n`;
        response += networkAuthorized
          ? `\x1b[33m[Notice: Using Native Offline Engine]\x1b[0m\n`
          : `\x1b[33m[Notice: CAP_NET_ADMIN not granted; remote LLM access disabled. Using Native Offline Engine]\x1b[0m\n`;
        response += `\x1b[90mTarget Input Payload (${cleanPrompt.length} bytes):\x1b[0m "${cleanPrompt.length > 60 ? cleanPrompt.slice(0, 60) + '...' : cleanPrompt}"\n\n`;

        if (cleanPrompt.includes('/etc/passwd') || cleanPrompt.includes('root:x:0:0')) {
          response += `\x1b[32m[AI Security Audit Report]\x1b[0m\n`;
          response += `1. User Privileges: Found 1 superuser account (root:x:0:0).\n`;
          response += `2. Shadow Hashes: Password entries mapped to /etc/shadow. Compliance: 100%.\n`;
          response += `3. System Recommendation: All standard POSIX system accounts configured securely.\n`;
        } else if (cleanPrompt.includes('error') || cleanPrompt.includes('panic') || cleanPrompt.includes('log')) {
          response += `\x1b[33m[AI System Log Diagnostics]\x1b[0m\n`;
          response += `1. Diagnostics Summary: Scanned input log stream for anomalies.\n`;
          response += `2. Log Severity: NO CRITICAL KERNEL PANIC DETECTED.\n`;
          response += `3. Action: All microkernel IPC daemons running in healthy state.\n`;
        } else {
          response += `\x1b[32m[AI Executive Summary]\x1b[0m\n`;
          response += `Input processed successfully by Earendel Microkernel AI Subsystem.\n`;
          response += `Analysis: "${cleanPrompt}" -> System status OPTIMAL.\n`;
        }

        this.aiBuffer = response;
        return { response, data: response, success: true, transport: 'local' };
        } finally {
          const remaining = (this.activeInferences.get(msg.senderPid) || 1) - 1;
          if (remaining > 0) this.activeInferences.set(msg.senderPid, remaining);
          else this.activeInferences.delete(msg.senderPid);
          this.activeInferenceCount = Math.max(0, this.activeInferenceCount - 1);
        }
      }

      case 'DEV_WRITE_FB0':
        globalFramebufferEngine.clearScreen(payload.color || '#000000');
        return { success: true, device: '/dev/fb0' };

      case 'DEV_GET_DISPLAY_INFO':
        return {
          device: '/dev/fb0',
          width: 640,
          height: 480,
          bpp: 32,
          colorFormat: 'RGBA',
          isOpen: globalFramebufferEngine.getIsOpen(),
        };

      case 'DEV_READ_GPU0': {
        let isRealWebGPU = false;
        if (typeof navigator !== 'undefined' && (navigator as any).gpu) {
          isRealWebGPU = true;
        }
        return {
          device: '/dev/gpu0',
          adapter: isRealWebGPU ? 'WebGPU Native Hardware Acceleration' : 'WebGPU / WebGL 2.0 Hardware Accelerator',
          vendor: isRealWebGPU ? 'Host GPU Adapter' : 'Apple M3 Pro / NVIDIA RTX 4090 (Virtual HAL)',
          features: ['compute-shaders', 'float32-filterable', 'timestamp-query'],
          limits: { maxComputeInvocationsPerWorkgroup: 1024, maxStorageBufferBindingSize: 1073741824 },
          nativeWebGpuSupported: isRealWebGPU,
        };
      }

      case 'DEV_READ_DSP':
        return { device: '/dev/dsp', sampleRate: 44100, channels: 2, format: 'S16_LE', status: 'READY' };

      case 'DEV_WRITE_DSP':
        return { success: true, device: '/dev/dsp', bytesWritten: payload?.data?.length || 0 };

      case 'DEV_READ_TTYUSB':
        return { device: '/dev/ttyUSB0', baudRate: payload?.baud || 115200, status: 'CONNECTED', data: 'OK\r\n' };

      case 'DEV_WRITE_TTYUSB':
        return { success: true, device: '/dev/ttyUSB0', sentBytes: payload?.data?.length || 0 };

      case 'DEV_READ_VIDEO0':
        return { device: '/dev/video0', resolution: '1920x1080', fps: 30, format: 'YUYV', status: 'ACTIVE' };

      case 'DEV_READ_GPS0': {
        if (typeof navigator !== 'undefined' && navigator.geolocation) {
          try {
            const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
              navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 3000 });
            });
            return {
              device: '/dev/gps0',
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              altitude: pos.coords.altitude || 0,
              speed: pos.coords.speed || 0,
              heading: pos.coords.heading || 0,
              status: 'FIX_3D_REAL_GPS',
            };
          } catch (_) {}
        }
        return {
          device: '/dev/gps0',
          latitude: 37.774929,
          longitude: -122.419416,
          altitude: 15.2,
          speed: 0.0,
          heading: 0.0,
          status: 'FIX_3D_VIRTUAL_MOCK',
        };
      }

      case 'DEV_READ_NVME0N1':
        return { device: '/dev/nvme0n1', capacityBytes: 64424509440, fsType: 'OPFS/IndexedDB Block Store' };

      case 'DEV_READ_USB':
        return {
          device: '/dev/bus/usb/001/001',
          devices: [
            { idVendor: 0x1d6b, idProduct: 0x0003, name: 'Linux Foundation 3.0 root hub' },
            { idVendor: 0x046d, idProduct: 0xc52b, name: 'Logitech USB Receiver' },
          ],
        };

      case 'DEV_READ_BT0':
        return { device: '/dev/bt0', status: 'POWERED_ON', address: 'AA:BB:CC:DD:EE:FF', name: 'Earendel BLE Controller' };

      case 'DEV_GATEWAY_TUNNEL':
        return {
          device: '/dev/can0',
          gatewayUrl: payload?.url || 'ws://localhost:9001',
          tunnelStatus: 'ESTABLISHED',
          ring0DirectIo: true,
        };

      default:
        throw new Error(`[driverd Error] Unknown device driver action '${action}' received.`);
    }
  }
}

export const globalDriverDaemon = new DriverDaemonService();
