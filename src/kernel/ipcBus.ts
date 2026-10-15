// Earendel Microkernel IPC (Inter-Process Communication) Message Bus
import { IPCMessage } from './types';

export type IPCServiceHandler = (msg: IPCMessage) => Promise<any>;

declare const senderEndpointBrand: unique symbol;
export interface IPCSenderEndpoint {
  readonly [senderEndpointBrand]: true;
}

function summarizePayloadForTrace(payload: unknown): unknown {
  if (payload === null) return '[null]';
  if (typeof payload === 'string') return `[redacted string: ${payload.length} chars]`;
  if (typeof payload === 'number') return '[number]';
  if (typeof payload === 'boolean') return '[boolean]';
  if (typeof payload === 'object') return '[redacted object payload]';
  return `[${typeof payload}]`;
}

export class IPCBus {
  private serviceRegistry: Map<string, { pid: number; handler: IPCServiceHandler }> = new Map();
  private senderEndpoints = new Map<number, IPCSenderEndpoint>();
  private endpointPids = new WeakMap<object, number>();
  private processExitListeners = new Set<(pid: number) => void>();
  private messageLogBuffer: IPCMessage[] = [];
  private maxLogCapacity = 200;
  private tracingEnabled = true;

  public setTracingEnabled(enabled: boolean): void {
    this.tracingEnabled = enabled;
  }

  /**
   * Registers a User-space Daemon service handler on the IPC Bus
   */
  public registerService(serviceName: string, pid: number, handler: IPCServiceHandler) {
    this.serviceRegistry.set(serviceName, { pid, handler });
  }

  /**
   * Unregisters an IPC service
   */
  public unregisterService(serviceName: string) {
    this.serviceRegistry.delete(serviceName);
  }

  /** Called by the process lifecycle manager; callers cannot choose a PID per message. */
  public registerProcess(pid: number): IPCSenderEndpoint {
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('IPC: invalid process PID');
    const existing = this.senderEndpoints.get(pid);
    if (existing) return existing;
    const endpoint = Object.freeze({}) as IPCSenderEndpoint;
    this.senderEndpoints.set(pid, endpoint);
    this.endpointPids.set(endpoint, pid);
    return endpoint;
  }

  public unregisterProcess(pid: number): void {
    if (!this.senderEndpoints.delete(pid)) return;
    for (const listener of this.processExitListeners) {
      try { listener(pid); } catch { /* A resource cleanup hook cannot block process exit. */ }
    }
  }

  /** Register cleanup for resources owned by a process; returns an unsubscribe function. */
  public onProcessExit(listener: (pid: number) => void): () => void {
    this.processExitListeners.add(listener);
    return () => this.processExitListeners.delete(listener);
  }

  public getProcessEndpoint(pid: number): IPCSenderEndpoint {
    const endpoint = this.senderEndpoints.get(pid);
    if (!endpoint) throw new Error(`IPC: process ${pid} has no active sender endpoint`);
    return endpoint;
  }

  /**
   * Sends an IPC message from a process to a target service daemon
   */
  public async sendIPC(sender: IPCSenderEndpoint, serviceName: string, action: string, payload: any): Promise<any> {
    const senderPid = sender && typeof sender === 'object' ? this.endpointPids.get(sender) : undefined;
    if (senderPid === undefined || this.senderEndpoints.get(senderPid) !== sender) {
      throw new Error('[IPC Error] Invalid or revoked sender endpoint.');
    }
    const targetService = this.serviceRegistry.get(serviceName);
    if (!targetService) {
      throw new Error(`[IPC Error] Service daemon '${serviceName}' is not registered on Microkernel IPC Bus.`);
    }

    const msg: IPCMessage = {
      msgId: `ipc_${Math.random().toString(36).substring(2, 9)}`,
      senderPid,
      targetPid: targetService.pid,
      serviceName,
      action,
      payload,
      timestamp: Date.now(),
    };

    // Keep sensitive IPC arguments out of the user-visible trace buffer while
    // passing the original payload to the trusted service handler.
    this.recordIPCLog({ ...msg, payload: summarizePayloadForTrace(payload) });

    // Synchronously dispatch to user-space daemon handler
    return await targetService.handler(msg);
  }

  private recordIPCLog(msg: IPCMessage) {
    if (!this.tracingEnabled) return;
    this.messageLogBuffer.push(msg);
    if (this.messageLogBuffer.length > this.maxLogCapacity) {
      this.messageLogBuffer.shift();
    }
  }

  public getIPCLogs(): IPCMessage[] {
    return this.messageLogBuffer.map((message) => ({ ...message }));
  }
}

export const globalIPCBus = new IPCBus();
