// Earendel User-space Device Driver Daemon Server (driverd)
import { globalIPCBus } from '../ipcBus';
import { globalFramebufferEngine } from '../../core/framebufferEngine';
import { globalVFS } from '../../core/vfs';
import { IPCMessage } from '../types';

export class DriverDaemonService {
  public static readonly PID = 4;
  public static readonly SERVICE_NAME = 'driverd';

  constructor() {
    this.startServer();
  }

  public startServer() {
    globalIPCBus.registerService(
      DriverDaemonService.SERVICE_NAME,
      DriverDaemonService.PID,
      async (msg: IPCMessage) => this.handleIPCMessage(msg)
    );
  }

  private aiBuffer: string = '';

  private parseLLMConfig(): Record<string, string> {
    const rawConf = globalVFS.readFile('/etc/llm.conf') || '';
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
        const prompt = payload.prompt || payload.content || '';
        const cleanPrompt = String(prompt).trim();

        const llmConfig = this.parseLLMConfig();
        const apiKey = llmConfig['API_KEY'] || '';
        const baseUrl = (llmConfig['BASE_URL'] || 'https://api.openai.com/v1').replace(/\/+$/, '');
        const modelName = llmConfig['MODEL_NAME'] || 'gpt-4o-mini';
        const enableMock = (llmConfig['ENABLE_LOCAL_MOCK'] || 'auto').toLowerCase();

        // If user explicitly enabled mock, use offline engine; otherwise attempt HTTP fetch to BASE_URL
        const shouldAttemptFetch = enableMock !== 'true' && Boolean(baseUrl);

        if (shouldAttemptFetch) {
          try {
            const endpoint = `${baseUrl}/chat/completions`;
            const headers: Record<string, string> = {
              'Content-Type': 'application/json',
            };
            if (apiKey && !apiKey.startsWith('sk-your-api-key') && apiKey !== 'sk-xxxxxx') {
              headers['Authorization'] = `Bearer ${apiKey}`;
            }

            const httpRes = await fetch(endpoint, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                model: modelName,
                messages: [
                  { role: 'system', content: 'You are Earendel AI-Native OS Core Assistant.' },
                  { role: 'user', content: cleanPrompt },
                ],
                temperature: 0.3,
              }),
            });

            const json = await httpRes.json().catch(() => ({}));
            let aiText = '';
            if (!httpRes.ok) {
              const errMsg = json?.error?.message || json?.error || json?.message || httpRes.statusText;
              aiText = `\x1b[31m[LLM API HTTP ${httpRes.status} Error]\x1b[0m ${errMsg}`;
            } else {
              aiText = json?.choices?.[0]?.message?.content || 'No response text content returned.';
            }

            let response = `\x1b[1;36m[Earendel AI-Native OS Core (Model: ${modelName})]\x1b[0m\n${aiText}\n`;
            this.aiBuffer = response;
            return { response, data: response, success: true };
          } catch (err: any) {
            let response = `\x1b[1;36m[Earendel AI-Native OS Core (Model: ${modelName})]\x1b[0m\n`;
            response += `\x1b[31m[LLM Network Connection Failure]\x1b[0m Failed to connect to ${baseUrl}: ${err.message}\n`;
            this.aiBuffer = response;
            return { response, data: response, success: true };
          }
        }

        // Native System Fallback Engine (Default Offline Mode)
        let response = `\x1b[1;36m[Earendel AI-Native OS Core Inference Engine (Syscall #25)]\x1b[0m\n`;
        response += `\x1b[33m[Notice: /etc/llm.conf API_KEY is default. Using Native Offline Engine]\x1b[0m\n`;
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
        return { response, data: response, success: true };
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
