// Scoped capability tokens. Processes without an explicit grant are unprivileged.

export type CapabilityType = 'CAP_VFS_READ' | 'CAP_VFS_WRITE' | 'CAP_DEVICE_IO' | 'CAP_SYS_ADMIN' | 'CAP_KILL' | 'CAP_NET_ADMIN';
const MAX_CAPABILITY_RESOURCE_CHARS = 4_096;

export interface CapabilityToken {
  capId: string;
  type: CapabilityType;
  grantedToPid: number;
  resourceTarget: string;
  createdAt: Date;
}

const ALL_CAPABILITIES: CapabilityType[] = [
  'CAP_VFS_READ', 'CAP_VFS_WRITE', 'CAP_DEVICE_IO', 'CAP_SYS_ADMIN', 'CAP_KILL', 'CAP_NET_ADMIN',
];

function validPid(pid: number): boolean {
  return Number.isSafeInteger(pid) && pid > 0;
}

function normalizeAbsolutePath(path: string): string | null {
  if (!path.startsWith('/')) return null;
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return `/${parts.join('/')}`;
}

function scopeMatches(granted: string, requested?: string): boolean {
  if (granted === '*') return true;
  if (requested === undefined) return false;
  if (/^https?:\/\//i.test(granted)) {
    try {
      const grantUrl = new URL(granted);
      if (grantUrl.protocol !== 'http:' && grantUrl.protocol !== 'https:') return false;
      let requestUrl: URL;
      try {
        requestUrl = new URL(requested);
      } catch {
        // A URL-scoped network grant also authorizes DNS lookup for that exact
        // host. DNS has no path scope, so never extend it to sibling subdomains.
        if (!/^[a-z0-9.-]+\.?$/i.test(requested)) return false;
        return requested.replace(/\.$/, '').toLowerCase() === grantUrl.hostname.toLowerCase();
      }
      if (grantUrl.origin !== requestUrl.origin) return false;
      const root = grantUrl.pathname.replace(/\/+$/, '') || '/';
      const target = requestUrl.pathname.replace(/\/+$/, '') || '/';
      return root === '/' || target === root || target.startsWith(`${root}/`);
    } catch {
      return false;
    }
  }
  // Path grants cover descendants at component boundaries, never sibling prefixes.
  if (granted.startsWith('/')) {
    const root = normalizeAbsolutePath(granted);
    const target = normalizeAbsolutePath(requested);
    if (root === null || target === null) return false;
    return root === '/' ? target.startsWith('/') : target === root || target.startsWith(`${root}/`);
  }
  return granted === requested;
}

class CapabilityManager {
  private pcbCapabilities = new Map<number, CapabilityToken[]>();
  private revocationListeners = new Set<(pid: number, capability: CapabilityType) => void>();

  constructor() {}

  public grantUserDefaults(pid: number, username: string): void {
    if (!validPid(pid) || !/^[a-z_][a-z0-9_-]*[$]?$/i.test(username)) return;
    this.clearCapabilities(pid);
    for (const path of [
      '/home/' + username, '/tmp', '/etc', '/usr', '/bin', '/sbin',
      '/lib', '/lib64', '/var', '/proc', '/sys', '/dev', '/skills',
    ]) {
      this.grantCapability(pid, 'CAP_VFS_READ', path);
    }
    this.grantCapability(pid, 'CAP_VFS_WRITE', '/home/' + username);
    this.grantCapability(pid, 'CAP_VFS_WRITE', '/tmp');
    this.grantCapability(pid, 'CAP_VFS_WRITE', '/var/tmp');
    this.grantCapability(pid, 'CAP_VFS_WRITE', '/dev/ai');
    // Interactive sessions need only the compositor and framebuffer devices
    // for desktop windows; Skills receive no device profile by default.
    this.grantCapability(pid, 'CAP_DEVICE_IO', '/dev/ai');
    this.grantCapability(pid, 'CAP_DEVICE_IO', '/dev/wayland');
    this.grantCapability(pid, 'CAP_DEVICE_IO', '/dev/fb0');
  }

  public grantDefaultCaps(pid: number): void {
    if (!validPid(pid)) return;
    this.clearCapabilities(pid);
    for (const cap of ALL_CAPABILITIES) this.grantCapability(pid, cap, '*');
  }

  public hasCapability(pid: number, cap: CapabilityType, resource?: string): boolean {
    if (!validPid(pid)) return false;
    if (resource !== undefined && (typeof resource !== 'string' || resource.length > MAX_CAPABILITY_RESOURCE_CHARS)) return false;
    return (this.pcbCapabilities.get(pid) || []).some(token =>
      token.type === cap && scopeMatches(token.resourceTarget, resource),
    );
  }

  public hasAnyCapability(pid: number, cap: CapabilityType): boolean {
    if (!validPid(pid)) return false;
    return (this.pcbCapabilities.get(pid) || []).some(token => token.type === cap);
  }

  public grantCapability(pid: number, cap: CapabilityType, resourceTarget = '*'): boolean {
    if (!validPid(pid) || !ALL_CAPABILITIES.includes(cap) || !resourceTarget.trim() || resourceTarget.length > MAX_CAPABILITY_RESOURCE_CHARS || resourceTarget.includes('\0')) return false;
    // CAP_SYS_ADMIN is checked as a process-wide authority throughout the
    // kernel. Accepting a path-scoped token here would falsely look restricted
    // while still satisfying every unscoped admin check.
    if (cap === 'CAP_SYS_ADMIN' && resourceTarget !== '*') return false;
    const tokens = this.pcbCapabilities.get(pid) || [];
    if (tokens.some(token => token.type === cap && token.resourceTarget === resourceTarget)) return true;
    tokens.push({
      capId: `cap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
      type: cap,
      grantedToPid: pid,
      resourceTarget,
      createdAt: new Date(),
    });
    this.pcbCapabilities.set(pid, tokens);
    return true;
  }

  public revokeCapability(pid: number, cap: CapabilityType, resourceTarget?: string): boolean {
    const tokens = this.pcbCapabilities.get(pid);
    if (!tokens) return false;
    const removed = tokens.filter(token => token.type === cap &&
      (resourceTarget === undefined || token.resourceTarget === resourceTarget));
    if (removed.length === 0) return false;
    const remaining = tokens.filter(token => token.type !== cap ||
      (resourceTarget !== undefined && token.resourceTarget !== resourceTarget));
    if (remaining.length) this.pcbCapabilities.set(pid, remaining);
    else this.pcbCapabilities.delete(pid);
    this.notifyRevocation(pid, new Set(removed.map(token => token.type)));
    return true;
  }

  /** Subscribe kernel services that must cancel resources when authority is revoked. */
  public onRevocation(listener: (pid: number, capability: CapabilityType) => void): () => void {
    this.revocationListeners.add(listener);
    return () => this.revocationListeners.delete(listener);
  }

  private notifyRevocation(pid: number, capabilities: Set<CapabilityType>): void {
    for (const capability of capabilities) {
      for (const listener of this.revocationListeners) {
        try { listener(pid, capability); } catch { /* Revocation must not be blocked by cleanup hooks. */ }
      }
    }
  }

  public getCapabilities(pid: number): CapabilityType[] {
    return [...new Set((this.pcbCapabilities.get(pid) || []).map(token => token.type))];
  }

  public getCapabilityTokens(pid: number): CapabilityToken[] {
    return (this.pcbCapabilities.get(pid) || []).map(token => ({ ...token, createdAt: new Date(token.createdAt) }));
  }

  public clearCapabilities(pid: number): void {
    const tokens = this.pcbCapabilities.get(pid);
    if (!tokens) return;
    this.pcbCapabilities.delete(pid);
    this.notifyRevocation(pid, new Set(tokens.map(token => token.type)));
  }

  public copyCapabilities(sourcePid: number, targetPid: number): void {
    if (!validPid(sourcePid) || !validPid(targetPid)) return;
    this.clearCapabilities(targetPid);
    for (const token of this.pcbCapabilities.get(sourcePid) || []) {
      this.grantCapability(targetPid, token.type, token.resourceTarget);
    }
  }
}

export const globalCapabilityManager = new CapabilityManager();
