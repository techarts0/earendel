import { globalFirewallEngine } from './firewallEngine';
import { globalCapabilityManager } from '../kernel/capability';
import { globalTaskScheduler } from '../kernel/taskScheduler';

/** Shared policy for browser-side HTTP clients that do not call through netd. */
export function checkNetworkRequest(pid: number, rawUrl: string): string | null {
  const process = globalTaskScheduler.getProcess(pid);
  if (!process || process.state !== 'RUNNING') return `ESRCH: PID ${pid} is not running.`;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'EINVAL: invalid network URL.';
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    return 'EINVAL: network URL must use HTTP(S) and cannot contain credentials.';
  }
  if (!globalCapabilityManager.hasCapability(pid, 'CAP_NET_ADMIN', rawUrl)) {
    return `EACCES: PID ${pid} lacks CAP_NET_ADMIN for '${rawUrl}'.`;
  }

  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  const decision = globalFirewallEngine.evaluate({ port, protocol: 'tcp', target: 'OUTPUT' });
  if (decision !== 'ALLOW') return `Network request blocked by simulated firewall (${decision}) on OUTPUT port ${port}.`;
  return null;
}
