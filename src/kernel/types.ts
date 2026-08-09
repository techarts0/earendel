// Earendel Microkernel System Types & POSIX System Call Definitions

export enum SyscallNo {
  SYS_READ = 0,
  SYS_WRITE = 1,
  SYS_OPEN = 2,
  SYS_CLOSE = 3,
  SYS_STAT = 4,
  SYS_FORK = 57,
  SYS_EXECVE = 59,
  SYS_EXIT = 60,
  SYS_WAITPID = 61,
  SYS_GETPID = 39,
  SYS_IPC_SEND = 1001,
  SYS_IPC_RECV = 1002,
  SYS_DMESG = 1003,
}

export type TaskState = 'READY' | 'RUNNING' | 'BLOCKED' | 'ZOMBIE';

export interface ProcessControlBlock {
  pid: number;
  ppid: number;
  name: string;
  user: string;
  state: TaskState;
  startTime: Date;
  vszKB: number;
  rssKB: number;
  cpuUsagePercent: number;
  cwd: string;
  fds: Map<number, string>; // File Descriptor table
  ipcPort?: string;
  isKernelDaemon?: boolean;
}

export interface IPCMessage {
  msgId: string;
  senderPid: number;
  targetPid: number;
  serviceName: string;
  action: string;
  payload: any;
  timestamp: number;
}

export interface SyscallResult {
  code: number; // 0 for success, negative for errno
  data?: any;
  error?: string;
}
