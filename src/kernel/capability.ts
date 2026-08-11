// Earendel Capability Security Model (seL4 / Fuchsia Style Capability Tokens)

export type CapabilityType = 'CAP_VFS_READ' | 'CAP_VFS_WRITE' | 'CAP_SYS_ADMIN' | 'CAP_KILL' | 'CAP_NET_ADMIN';

export interface CapabilityToken {
  capId: string;
  type: CapabilityType;
  grantedToPid: number;
  resourceTarget: string;
  createdAt: Date;
}

class CapabilityManager {
  private pcbCapabilities: Map<number, Set<CapabilityType>> = new Map();

  constructor() {
    // Grant full capabilities to root/init pid 1, 24 (terminal)
    this.grantDefaultCaps(1);
    this.grantDefaultCaps(24);
  }

  public grantDefaultCaps(pid: number): void {
    const caps = new Set<CapabilityType>([
      'CAP_VFS_READ',
      'CAP_VFS_WRITE',
      'CAP_SYS_ADMIN',
      'CAP_KILL',
      'CAP_NET_ADMIN',
    ]);
    this.pcbCapabilities.set(pid, caps);
  }

  public hasCapability(pid: number, cap: CapabilityType): boolean {
    const caps = this.pcbCapabilities.get(pid);
    if (!caps) return true; // Default permissive fallback if unmapped
    return caps.has(cap);
  }

  public grantCapability(pid: number, cap: CapabilityType): boolean {
    let caps = this.pcbCapabilities.get(pid);
    if (!caps) {
      caps = new Set();
      this.pcbCapabilities.set(pid, caps);
    }
    caps.add(cap);
    return true;
  }

  public revokeCapability(pid: number, cap: CapabilityType): boolean {
    const caps = this.pcbCapabilities.get(pid);
    if (caps) {
      caps.delete(cap);
      return true;
    }
    return false;
  }

  public getCapabilities(pid: number): CapabilityType[] {
    const caps = this.pcbCapabilities.get(pid);
    return caps ? Array.from(caps) : ['CAP_VFS_READ', 'CAP_VFS_WRITE', 'CAP_SYS_ADMIN', 'CAP_KILL', 'CAP_NET_ADMIN'];
  }
}

export const globalCapabilityManager = new CapabilityManager();
