// Earendel Microkernel IPC (Inter-Process Communication) Message Bus
import { IPCMessage } from './types';

export type IPCServiceHandler = (msg: IPCMessage) => Promise<any>;

export class IPCBus {
  private serviceRegistry: Map<string, { pid: number; handler: IPCServiceHandler }> = new Map();
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

  /**
   * Sends an IPC message from a process to a target service daemon
   */
  public async sendIPC(senderPid: number, serviceName: string, action: string, payload: any): Promise<any> {
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
