// Earendel Microkernel Core Controller
import { globalIPCBus } from './ipcBus';
import { globalTaskScheduler } from './taskScheduler';
import { globalVFSDaemon } from './services/vfsd';
import { globalPMDaemon } from './services/pmd';
import { globalDriverDaemon } from './services/driverd';
import { globalWorkerIPCBridge } from './workerIPCBridge';
import { globalModuleManager } from './moduleManager';
import { globalVMPageTable } from './vmPageTable';
import { globalIPCSharedMem } from './ipcSharedMem';
import { initESLibSystemFile } from './services/eslib';

export interface KernelDmesgLog {
  timestamp: string;
  subsystem: string;
  message: string;
  level: 'info' | 'warn' | 'error' | 'panic';
}

export class Microkernel {
  private bootTime = new Date();
  private dmesgRingBuffer: KernelDmesgLog[] = [];

  constructor() {
    this.bootKernel();
  }

  private bootKernel() {
    this.log('kernel', 'Earendel Web Microkernel v1.0.0 (Native Web Architecture) Booting...', 'info');
    this.log('kernel', 'Initializing Microkernel IPC Message Router...', 'info');
    this.log('kernel', 'Registering User-space VFS Daemon (vfsd, PID 2)...', 'info');
    this.log('kernel', 'Registering User-space Process Manager Daemon (pmd, PID 3)...', 'info');
    this.log('kernel', 'Registering User-space Device Driver Daemon (driverd, PID 4)...', 'info');

    // Ensure Daemons and Bridges are initialized
    const _vfs = globalVFSDaemon;
    const _pm = globalPMDaemon;
    const _driver = globalDriverDaemon;
    const _bridge = globalWorkerIPCBridge;
    const _mod = globalModuleManager;
    const _vm = globalVMPageTable;
    const _shm = globalIPCSharedMem;

    this.log('kernel', 'WebWorker Process Isolation Bridge (WorkerIPCBridge) Online.', 'info');
    this.log('driverd', 'Registering POSIX Character Devices (/dev/null, /dev/zero, /dev/urandom)...', 'info');
    this.log('driverd', 'Registering Pseudo Terminal Slave Devices (/dev/pts/0, /dev/pts/1)...', 'info');
    this.log('kernel', 'Kernel Driver Module Manager (moduleManager) Online.', 'info');
    this.log('kernel', 'POSIX C/JS System Library (/lib/eslib.js) Loaded.', 'info');
    this.log('kernel', 'Virtual Memory 4KB Page Table & Frame Allocator (vmPageTable) Online.', 'info');
    this.log('kernel', 'System V IPC Shared Memory & Semaphore Manager (ipcSharedMem) Online.', 'info');
    this.log('kernel', 'POSIX System Call Dispatcher (syscall) Online.', 'info');
    this.log('kernel', 'Kernel Debugger (kdb) Online.', 'info');
    this.log('kernel', 'Kernel Initialization Completed. Transitioning to User-space System Init (/sbin/init).', 'info');
  }

  public log(subsystem: string, message: string, level: 'info' | 'warn' | 'error' | 'panic' = 'info') {
    const elapsed = ((Date.now() - this.bootTime.getTime()) / 1000).toFixed(6);
    const timeStr = `[${elapsed.padStart(12, ' ')}]`;
    this.dmesgRingBuffer.push({
      timestamp: timeStr,
      subsystem,
      message,
      level,
    });
  }

  public getDmesgLogs(): KernelDmesgLog[] {
    return [...this.dmesgRingBuffer];
  }

  public triggerKernelPanic(reason: string) {
    this.log('panic', `Kernel Panic - not syncing: ${reason}`, 'panic');
    console.error(`[KERNEL PANIC] ${reason}`);
  }
}

export const globalMicrokernel = new Microkernel();
