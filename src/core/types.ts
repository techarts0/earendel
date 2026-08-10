// Earendel Behavioral Engine Core Interfaces & Types
import { VirtualFileSystem, VFSNode } from './vfs';
import { Language } from '../i18n/translations';
import type { ProcessManager } from './processManager';

export interface ExecutionContext {
  vfs: VirtualFileSystem;
  env: Record<string, string>;
  lang: Language;
  args: string[];
  pipeInput?: string;
  processManager: ProcessManager;
}

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  openNano?: { path: string; content: string };
  openVi?: { path: string; content: string };
  loginPrompt?: { username: string };
  sudoPrompt?: { username: string; commandLine: string };
  toggleFullscreen?: 'max' | 'restore';
  logout?: boolean;
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
