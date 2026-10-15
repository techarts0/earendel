// Earendel Microkernel IPC (Inter-Process Communication) Message Bus
import { IPCMessage } from './types';

export type IPCServiceHandler = (msg: IPCMessage) => Promise<any>;

declare const senderEndpointBrand: unique symbol;
export interface IPCSenderEndpoint {
  readonly [senderEndpointBrand]: true;
}

export class IPCBus {
  private serviceRegistry: Map<string, { pid: number; handler: IPCServiceHandler }> = new Map();
  private senderEndpoints = new Map<number, IPCSenderEndpoint>();
  private endpointPids = new WeakMap<object, number>();
  private messageLogBuffer: IPCMessage[] = [];
  private maxLogCapacity = 200;

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
    this.senderEndpoints.delete(pid);
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

    // Push into kernel dmesg/IPC tracing buffer
    this.recordIPCLog(msg);

    // Synchronously dispatch to user-space daemon handler
    return await targetService.handler(msg);
  }

  private recordIPCLog(msg: IPCMessage) {
    this.messageLogBuffer.push(msg);
    if (this.messageLogBuffer.length > this.maxLogCapacity) {
      this.messageLogBuffer.shift();
    }
  }

  public getIPCLogs(): IPCMessage[] {
    return [...this.messageLogBuffer];
  }
}

export const globalIPCBus = new IPCBus();
