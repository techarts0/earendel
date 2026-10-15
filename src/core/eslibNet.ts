import { SyscallNo } from '../kernel/types';
import type { ProcessSyscall } from './types';

export const eslibNet = {
  async fetch(url: string, opts: { method?: string; headers?: Record<string, string>; body?: any; signal?: AbortSignal } | undefined, syscall: ProcessSyscall) {
    const res = await syscall(SyscallNo.SYS_NET_FETCH, url, opts || {});
    return res.data;
  },

  async socket(url: string, type: 'ws' | 'webrtc' = 'ws', syscall?: ProcessSyscall) {
    if (!syscall) return undefined;
    const res = await syscall(SyscallNo.SYS_NET_SOCKET, url, type);
    return res.data;
  },

  async listen(port: number | undefined, syscall?: ProcessSyscall) {
    if (!syscall) return undefined;
    const res = await syscall(SyscallNo.SYS_NET_LISTEN, port);
    return res.data;
  },

  async gethostbyname(hostname: string, syscall?: ProcessSyscall): Promise<string> {
    if (!syscall) return '';
    const res = await syscall(SyscallNo.SYS_NET_RESOLVE, hostname);
    return res.data?.ip || '';
  },

  async resolve(hostname: string, syscall?: ProcessSyscall): Promise<{ hostname: string; ip: string; addresses: string[]; error?: string }> {
    if (!syscall) return { hostname, ip: '', addresses: [], error: 'EACCES: caller identity is required' };
    const res = await syscall(SyscallNo.SYS_NET_RESOLVE, hostname);
    return res.data || { hostname, ip: '', addresses: [], error: res.error || 'Name resolution failed' };
  },
};
