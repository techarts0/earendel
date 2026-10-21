// Earendel Behavioral Engine Core Interfaces & Types
import { VirtualFileSystem, VFSNode } from './vfs';
import { Language } from '../i18n/translations';
import type { ProcessManager } from './processManager';
import type { SyscallNo, SyscallResult } from '../kernel/types';
import type { SkillPermissionGrant } from './skillParser';

export type ProcessSyscall = (sysNo: SyscallNo, ...args: any[]) => Promise<SyscallResult>;

export interface ExecutionContext {
  vfs: VirtualFileSystem;
  env: Record<string, string>;
  lang: Language;
  args: string[];
  pipeInput?: string;
  processManager: ProcessManager;
  /** Kernel identity used for permission-checked syscalls made by this command. */
  callerPid?: number;
  /** Syscall entry bound by the parent ShellEngine to this process identity. */
  syscall: ProcessSyscall;
  /** Optional cancellation inherited by asynchronous operations in this process. */
  abortSignal?: AbortSignal;
  shellEngine?: any;
  history?: string[];
}

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  streamed?: boolean;
  openNano?: { path: string; content: string; user?: string };
  openVi?: { path: string; content: string; user?: string };
  openHarnessTui?: { path: string; content: string; permissionGrant?: SkillPermissionGrant };
  openHarnessDag?: { path: string; permissionGrant?: SkillPermissionGrant };
  loginPrompt?: { username: string };
  sudoPrompt?: { username: string; commandLine: string; targetUser?: string };
  passwdPrompt?: { username: string; step: 'current' | 'new' | 'confirm'; newPass?: string };
  interactiveInput?: {
    command: string;
    targetFiles: string[];
    appendMode: boolean;
    collectedLines: string[];
    delimiter?: string;
    pipelineNext?: string;
    redirectTarget?: string;
  };
  toggleFullscreen?: 'max' | 'restore';
  logout?: boolean;
  /** Internal shell-flow marker: an exit builtin stopped the current script/shell. */
  shellExit?: boolean;
  poweroff?: boolean;
  reboot?: boolean;
  openCheat?: boolean;
  splitTmux?: 'v' | 'h' | 'exit';
}

export interface ProcessInfo {
  pid: number;
  ppid: number;
  user: string;
  cpu: number;
  mem: number;
  vsz: number;
  rss: number;
  tty: string;
  stat: string;
  startTime: string;
  command: string;
}

export interface Command {
  name: string;
  aliases?: string[];
  description: string;
  category: 'file' | 'text' | 'sys' | 'archive' | 'editor' | 'net';
  execute(ctx: ExecutionContext): Promise<ExecutionResult> | ExecutionResult;
  executeStream?: (ctx: ExecutionContext, inputStream?: AsyncIterable<string>) => AsyncGenerator<string, void, unknown>;
}
