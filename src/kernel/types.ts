// Earendel Microkernel System Types & POSIX System Call Definitions

export enum SyscallNo {
  SYS_READ = 0,
  SYS_WRITE = 1,
  SYS_OPEN = 2,
  SYS_CLOSE = 3,
  SYS_STAT = 4,
  SYS_LSEEK = 8,
  SYS_FORK = 57,
  SYS_EXECVE = 59,
  SYS_EXIT = 60,
  SYS_WAITPID = 61,
  SYS_KILL = 62,
  SYS_GETPID = 39,
  SYS_INFER = 25,
  SYS_IPC_SEND = 1001,
  SYS_IPC_RECV = 1002,
  SYS_DMESG = 1003,
}

export enum Signal {
  SIGHUP = 1,
  SIGINT = 2,
  SIGQUIT = 3,
  SIGKILL = 9,
  SIGUSR1 = 10,
  SIGUSR2 = 12,
  SIGTERM = 15,
  SIGCONT = 18,
  SIGSTOP = 19,
}

export type TaskState = 'READY' | 'RUNNING' | 'BLOCKED' | 'ZOMBIE';

export interface FileDescriptor {
  fd: number;
  path: string;
  offset: number;
  flags: 'r' | 'w' | 'rw' | 'a';
}

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
  fds?: Map<number, FileDescriptor>; // File Descriptor table
  pendingSignals?: Signal[];
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
