import { syscall } from '../kernel/syscall';
import { SyscallNo } from '../kernel/types';

export const eslibNet = {
  async fetch(url: string, opts?: { method?: string; headers?: Record<string, string>; body?: any }) {
    const res = await syscall(SyscallNo.SYS_NET_FETCH, url, opts || {});
    return res.data;
  },

  async socket(url: string, type: 'ws' | 'webrtc' = 'ws') {
    const res = await syscall(SyscallNo.SYS_NET_SOCKET, url, type);
    return res.data;
  },

  async listen(port?: number) {
    const res = await syscall(SyscallNo.SYS_NET_LISTEN, port);
    return res.data;
  },

  async gethostbyname(hostname: string): Promise<string> {
    const res = await syscall(SyscallNo.SYS_NET_RESOLVE, hostname);
    return res.data?.ip || '';
  },

  async resolve(hostname: string): Promise<{ hostname: string; ip: string; addresses: string[]; error?: string }> {
    const res = await syscall(SyscallNo.SYS_NET_RESOLVE, hostname);
    return res.data || { hostname, ip: '', addresses: [], error: res.error || 'Name resolution failed' };
  },
};
