// Scoped capability tokens. Processes without an explicit grant are unprivileged.

export type CapabilityType = 'CAP_VFS_READ' | 'CAP_VFS_WRITE' | 'CAP_DEVICE_IO' | 'CAP_SYS_ADMIN' | 'CAP_KILL' | 'CAP_NET_ADMIN';

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

  constructor() {
    // Root is privileged by policy. The interactive shell receives a narrow
    // user profile; network and administrative access require an explicit grant.
    this.grantDefaultCaps(1);
    this.grantUserDefaults(24, 'hello');
  }

  public grantUserDefaults(pid: number, username: string): void {
    if (!validPid(pid) || !/^[a-z_][a-z0-9_-]*[$]?$/i.test(username)) return;
    this.pcbCapabilities.delete(pid);
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
  }

  public grantDefaultCaps(pid: number): void {
    if (!validPid(pid)) return;
    this.pcbCapabilities.delete(pid);
    for (const cap of ALL_CAPABILITIES) this.grantCapability(pid, cap, '*');
  }

  public hasCapability(pid: number, cap: CapabilityType, resource?: string): boolean {
    if (!validPid(pid)) return false;
    return (this.pcbCapabilities.get(pid) || []).some(token =>
      token.type === cap && scopeMatches(token.resourceTarget, resource),
    );
  }

  public hasAnyCapability(pid: number, cap: CapabilityType): boolean {
    if (!validPid(pid)) return false;
    return (this.pcbCapabilities.get(pid) || []).some(token => token.type === cap);
  }

  public grantCapability(pid: number, cap: CapabilityType, resourceTarget = '*'): boolean {
    if (!validPid(pid) || !ALL_CAPABILITIES.includes(cap) || !resourceTarget.trim()) return false;
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
    const remaining = tokens.filter(token => token.type !== cap ||
      (resourceTarget !== undefined && token.resourceTarget !== resourceTarget));
    if (remaining.length === tokens.length) return false;
    if (remaining.length) this.pcbCapabilities.set(pid, remaining);
    else this.pcbCapabilities.delete(pid);
    return true;
  }

  public getCapabilities(pid: number): CapabilityType[] {
    return [...new Set((this.pcbCapabilities.get(pid) || []).map(token => token.type))];
  }

  public getCapabilityTokens(pid: number): CapabilityToken[] {
    return (this.pcbCapabilities.get(pid) || []).map(token => ({ ...token, createdAt: new Date(token.createdAt) }));
  }

  public clearCapabilities(pid: number): void {
    this.pcbCapabilities.delete(pid);
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
