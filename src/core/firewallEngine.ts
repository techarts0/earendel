// In-memory Netfilter model used by the browser based teaching environment.
export type FirewallAction = 'ALLOW' | 'DROP' | 'REJECT';
export type FirewallProtocol = 'tcp' | 'udp' | 'icmp' | 'all';
export type FirewallChain = 'INPUT' | 'OUTPUT' | 'FORWARD';

export interface FirewallRule {
  id: number;
  action: FirewallAction;
  port?: number;
  protocol: FirewallProtocol;
  source: string;
  target: FirewallChain;
}

export interface FirewallPacket {
  port?: number;
  protocol?: FirewallProtocol;
  source?: string;
  destination?: string;
  target?: FirewallChain;
}

const DEFAULT_POLICIES: Record<FirewallChain, FirewallAction> = {
  INPUT: 'ALLOW',
  OUTPUT: 'ALLOW',
  FORWARD: 'DROP',
};

function isIPv4(value: string): boolean {
  const octets = value.split('.');
  return octets.length === 4 && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isValidSource(source: string): boolean {
  if (source === '0.0.0.0/0' || source === 'any' || source === '*') return true;
  const [address, prefixText, ...extra] = source.split('/');
  if (extra.length || !isIPv4(address)) return false;
  return prefixText === undefined || (/^\d{1,2}$/.test(prefixText) && Number(prefixText) <= 32);
}

function ipv4ToNumber(address: string): number {
  return address.split('.').reduce((result, octet) => ((result << 8) | Number(octet)) >>> 0, 0);
}

function matchesSource(ruleSource: string, packetSource = '0.0.0.0'): boolean {
  if (ruleSource === 'any' || ruleSource === '*' || ruleSource === '0.0.0.0/0') return true;
  const [network, prefixText = '32'] = ruleSource.split('/');
  if (!isIPv4(network) || !isIPv4(packetSource)) return ruleSource === packetSource;
  const prefix = Number(prefixText);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToNumber(network) & mask) === (ipv4ToNumber(packetSource) & mask);
}

export class FirewallEngine {
  private enabled = true;
  private rules: FirewallRule[] = [];
  private policies: Record<FirewallChain, FirewallAction> = { ...DEFAULT_POLICIES };
  private nextId = 1;

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(status: boolean): void {
    this.enabled = status;
  }

  public addRule(
    action: FirewallAction,
    port?: number,
    protocol: FirewallProtocol = 'tcp',
    source = '0.0.0.0/0',
    target: FirewallChain = 'INPUT',
    insertAtStart = false,
  ): FirewallRule {
    if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      throw new RangeError(`Invalid destination port: ${port}`);
    }
    if (!isValidSource(source)) throw new TypeError(`Invalid source address or CIDR: ${source}`);
    if (!['tcp', 'udp', 'icmp', 'all'].includes(protocol)) throw new TypeError(`Invalid protocol: ${protocol}`);
    if (!['INPUT', 'OUTPUT', 'FORWARD'].includes(target)) throw new TypeError(`Invalid firewall chain: ${target}`);

    const rule: FirewallRule = { id: this.nextId++, action, port, protocol, source, target };
    if (insertAtStart) this.rules.unshift(rule);
    else this.rules.push(rule);
    return { ...rule };
  }

  public deleteRule(id: number): boolean {
    const index = this.rules.findIndex((rule) => rule.id === id);
    if (index < 0) return false;
    this.rules.splice(index, 1);
    return true;
  }

  public flushRules(chain?: FirewallChain): void {
    this.rules = chain ? this.rules.filter((rule) => rule.target !== chain) : [];
  }

  public getRules(): FirewallRule[] {
    return this.rules.map((rule) => ({ ...rule }));
  }

  public setPolicy(chain: FirewallChain, action: FirewallAction): void {
    this.policies[chain] = action;
  }

  public getPolicy(chain: FirewallChain): FirewallAction {
    return this.policies[chain];
  }

  public evaluate(packet: FirewallPacket): FirewallAction {
    if (!this.enabled) return 'ALLOW';
    const chain = packet.target || 'INPUT';
    for (const rule of this.rules) {
      if (rule.target !== chain) continue;
      if (rule.port !== undefined && rule.port !== packet.port) continue;
      if (rule.protocol !== 'all' && rule.protocol !== (packet.protocol || 'tcp')) continue;
      if (!matchesSource(rule.source, packet.source)) continue;
      return rule.action;
    }
    return this.policies[chain];
  }

  public isPortAllowed(port: number, protocol: 'tcp' | 'udp' = 'tcp', target: FirewallChain = 'INPUT', source?: string): boolean {
    return this.evaluate({ port, protocol, target, source }) === 'ALLOW';
  }
}

export const globalFirewallEngine = new FirewallEngine();
