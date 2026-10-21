// In-memory Netfilter-inspired model for the browser teaching environment.
// It evaluates simulated traffic only; it never configures the host firewall.
export type FirewallAction = 'ALLOW' | 'DROP' | 'REJECT';
export type FirewallProtocol = 'tcp' | 'udp' | 'icmp' | 'all';
export type FirewallChain = 'INPUT' | 'OUTPUT' | 'FORWARD';
export type FirewallTable = 'filter' | 'nat' | 'mangle' | 'raw';
export type FirewallConntrackState = 'NEW' | 'ESTABLISHED' | 'RELATED' | 'INVALID';
export type FirewallNatTarget = 'DNAT' | 'SNAT' | 'MASQUERADE';

export interface FirewallNatTranslation {
  target: FirewallNatTarget;
  address?: string;
  port?: number;
}

export interface FirewallRule {
  id: number;
  table: FirewallTable;
  chain: string;
  /** Legacy alias retained for existing command and network call sites. */
  target: FirewallChain;
  action: FirewallAction;
  port?: number;
  sourcePort?: number;
  protocol: FirewallProtocol;
  source: string;
  destination?: string;
  jump?: string;
  comment?: string;
  conntrackStates?: FirewallConntrackState[];
  natTranslation?: FirewallNatTranslation;
}

export interface FirewallChainConfig {
  table: FirewallTable;
  name: string;
  hook?: FirewallChain;
  priority?: number;
  policy?: FirewallAction;
}

export interface FirewallPacket {
  port?: number;
  sourcePort?: number;
  protocol?: FirewallProtocol;
  source?: string;
  destination?: string;
  target?: FirewallChain;
  conntrackState?: FirewallConntrackState;
}

export interface FirewallPacketResult {
  verdict: FirewallAction;
  packet: FirewallPacket;
  transformations: string[];
}

const BUILTIN_CHAINS: Record<FirewallTable, FirewallChainConfig[]> = {
  filter: [
    { table: 'filter', name: 'INPUT', hook: 'INPUT', priority: 0, policy: 'ALLOW' },
    { table: 'filter', name: 'OUTPUT', hook: 'OUTPUT', priority: 0, policy: 'ALLOW' },
    { table: 'filter', name: 'FORWARD', hook: 'FORWARD', priority: 0, policy: 'DROP' },
  ],
  nat: [
    { table: 'nat', name: 'PREROUTING', hook: 'INPUT', priority: -100, policy: 'ALLOW' },
    { table: 'nat', name: 'INPUT', hook: 'INPUT', priority: 100, policy: 'ALLOW' },
    { table: 'nat', name: 'OUTPUT', hook: 'OUTPUT', priority: -100, policy: 'ALLOW' },
    { table: 'nat', name: 'POSTROUTING', hook: 'OUTPUT', priority: 100, policy: 'ALLOW' },
  ],
  mangle: [
    { table: 'mangle', name: 'PREROUTING', hook: 'INPUT', priority: -150, policy: 'ALLOW' },
    { table: 'mangle', name: 'INPUT', hook: 'INPUT', priority: -150, policy: 'ALLOW' },
    { table: 'mangle', name: 'FORWARD', hook: 'FORWARD', priority: -150, policy: 'ALLOW' },
    { table: 'mangle', name: 'OUTPUT', hook: 'OUTPUT', priority: -150, policy: 'ALLOW' },
    { table: 'mangle', name: 'POSTROUTING', hook: 'OUTPUT', priority: -150, policy: 'ALLOW' },
  ],
  raw: [
    { table: 'raw', name: 'PREROUTING', hook: 'INPUT', priority: -300, policy: 'ALLOW' },
    { table: 'raw', name: 'OUTPUT', hook: 'OUTPUT', priority: -300, policy: 'ALLOW' },
  ],
};

const VALID_TABLES: FirewallTable[] = ['filter', 'nat', 'mangle', 'raw'];

function isIPv4(value: string): boolean {
  const octets = value.split('.');
  return octets.length === 4 && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isValidAddress(value: string): boolean {
  if (value === '0.0.0.0/0' || value === 'any' || value === '*') return true;
  const [address, prefixText, ...extra] = value.split('/');
  return extra.length === 0 && isIPv4(address) && (prefixText === undefined || (/^\d{1,2}$/.test(prefixText) && Number(prefixText) <= 32));
}

function ipv4ToNumber(address: string): number {
  return address.split('.').reduce((result, octet) => ((result << 8) | Number(octet)) >>> 0, 0);
}

function matchesAddress(ruleAddress: string, packetAddress?: string): boolean {
  if (ruleAddress === 'any' || ruleAddress === '*' || ruleAddress === '0.0.0.0/0') return true;
  if (!packetAddress) return false;
  const [network, prefixText = '32'] = ruleAddress.split('/');
  if (!isIPv4(network) || !isIPv4(packetAddress)) return ruleAddress === packetAddress;
  const prefix = Number(prefixText);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToNumber(network) & mask) === (ipv4ToNumber(packetAddress) & mask);
}

export class FirewallEngine {
  private enabled = true;
  private rules: FirewallRule[] = [];
  private chains: FirewallChainConfig[] = VALID_TABLES.flatMap((table) => BUILTIN_CHAINS[table].map((chain) => ({ ...chain })));
  private nextId = 1;
  private connections = new Map<string, { id: string; expiresAt: number }>();

  public isEnabled(): boolean { return this.enabled; }
  public setEnabled(status: boolean): void { this.enabled = status; }
  public getTables(): FirewallTable[] { return VALID_TABLES.filter((table) => this.chains.some((chain) => chain.table === table)); }
  public hasTable(table: string): boolean { return VALID_TABLES.includes(table as FirewallTable) && this.chains.some((chain) => chain.table === table); }
  public addTable(table: FirewallTable): void {
    if (!VALID_TABLES.includes(table)) throw new TypeError(`Unsupported firewall table: ${table}`);
    if (this.hasTable(table)) throw new Error(`Table '${table}' already exists`);
    this.chains.push(...BUILTIN_CHAINS[table].map((chain) => ({ ...chain })));
  }
  public deleteTable(table: FirewallTable): void {
    if (table === 'filter') throw new Error("Cannot delete the built-in 'filter' table");
    if (!this.hasTable(table)) throw new Error(`Table '${table}' does not exist`);
    this.chains = this.chains.filter((chain) => chain.table !== table);
    this.rules = this.rules.filter((rule) => rule.table !== table);
  }
  public getChains(table?: FirewallTable): FirewallChainConfig[] {
    return this.chains.filter((chain) => !table || chain.table === table).map((chain) => ({ ...chain }));
  }
  public getChain(table: FirewallTable, name: string): FirewallChainConfig | undefined {
    const chain = this.chains.find((item) => item.table === table && item.name === name);
    return chain && { ...chain };
  }
  public addChain(config: FirewallChainConfig): void {
    if (!this.hasTable(config.table)) throw new Error(`Table '${config.table}' does not exist`);
    if (!/^[A-Za-z_][A-Za-z0-9_-]{0,27}$/.test(config.name)) throw new TypeError(`Invalid chain name '${config.name}'`);
    if (this.getChain(config.table, config.name)) throw new Error(`Chain '${config.name}' already exists`);
    this.chains.push({ ...config, policy: config.hook ? (config.policy || 'ALLOW') : undefined });
  }
  public deleteChain(table: FirewallTable, name: string): void {
    const chain = this.getChain(table, name);
    if (!chain) throw new Error(`Chain '${name}' does not exist`);
    if (BUILTIN_CHAINS[table].some((builtin) => builtin.name === name)) throw new Error(`Cannot delete built-in chain '${name}'`);
    if (this.rules.some((rule) => rule.table === table && rule.jump === name)) throw new Error(`Chain '${name}' is still referenced`);
    if (this.rules.some((rule) => rule.table === table && rule.chain === name)) throw new Error(`Chain '${name}' is not empty; flush it before deletion`);
    this.chains = this.chains.filter((item) => !(item.table === table && item.name === name));
  }

  public addRule(
    action: FirewallAction,
    port?: number,
    protocol: FirewallProtocol = 'tcp',
    source = '0.0.0.0/0',
    target: FirewallChain = 'INPUT',
    insertAtStart = false,
    options: { table?: FirewallTable; chain?: string; sourcePort?: number; destination?: string; jump?: string; comment?: string; position?: number; conntrackStates?: FirewallConntrackState[]; natTranslation?: FirewallNatTranslation } = {},
  ): FirewallRule {
    const table = options.table || 'filter';
    const chain = options.chain || target;
    if (!this.hasTable(table)) throw new Error(`Table '${table}' does not exist`);
    if (!this.getChain(table, chain)) throw new Error(`Chain '${chain}' does not exist in table '${table}'`);
    for (const [label, value] of [['destination port', port], ['source port', options.sourcePort]] as const) {
      if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 65535)) throw new RangeError(`Invalid ${label}: ${value}`);
    }
    if (!isValidAddress(source)) throw new TypeError(`Invalid source address or CIDR: ${source}`);
    if (options.destination && !isValidAddress(options.destination)) throw new TypeError(`Invalid destination address or CIDR: ${options.destination}`);
    if (!['tcp', 'udp', 'icmp', 'all'].includes(protocol)) throw new TypeError(`Invalid protocol: ${protocol}`);
    if (options.jump && !this.getChain(table, options.jump)) throw new Error(`Jump target '${options.jump}' does not exist`);
    if (options.natTranslation) {
      const translation = options.natTranslation;
      if (table !== 'nat') throw new Error('NAT translation targets are only valid in the nat table');
      if (!['DNAT', 'SNAT', 'MASQUERADE'].includes(translation.target)) throw new TypeError(`Invalid NAT target: ${translation.target}`);
      if (translation.target === 'MASQUERADE') {
        if (translation.address !== undefined || translation.port !== undefined) throw new Error('MASQUERADE does not accept a translation address or port');
      } else if (!translation.address || !isIPv4(translation.address)) {
        throw new TypeError(`${translation.target} requires a valid IPv4 translation address`);
      }
      if (translation.port !== undefined && (!Number.isInteger(translation.port) || translation.port < 1 || translation.port > 65535)) {
        throw new RangeError(`Invalid NAT translation port: ${translation.port}`);
      }
      if (translation.port !== undefined && protocol !== 'tcp' && protocol !== 'udp') throw new Error('NAT port translation requires tcp or udp');
      const validChains: Record<FirewallNatTarget, string[]> = {
        DNAT: ['PREROUTING', 'OUTPUT'],
        SNAT: ['INPUT', 'POSTROUTING'],
        MASQUERADE: ['POSTROUTING'],
      };
      if (!validChains[translation.target].includes(chain)) throw new Error(`${translation.target} is not supported in nat chain '${chain}'`);
    }
    const hook = this.getChain(table, chain)?.hook || target;
    const rule: FirewallRule = {
      id: this.nextId++, table, chain, target: hook, action, port, sourcePort: options.sourcePort,
      protocol, source, destination: options.destination, jump: options.jump, comment: options.comment,
      conntrackStates: options.conntrackStates ? [...options.conntrackStates] : undefined,
      natTranslation: options.natTranslation ? { ...options.natTranslation } : undefined,
    };
    const chainRules = this.rules.filter((entry) => entry.table === table && entry.chain === chain);
    const index = insertAtStart ? this.rules.findIndex((entry) => entry.table === table && entry.chain === chain) : -1;
    if (options.position !== undefined) {
      if (!Number.isInteger(options.position) || options.position < 1 || options.position > chainRules.length + 1) throw new RangeError(`Invalid rule position: ${options.position}`);
      const before = chainRules[options.position - 1];
      this.rules.splice(before ? this.rules.indexOf(before) : this.rules.length, 0, rule);
    }
    else if (index >= 0) this.rules.splice(index, 0, rule);
    else if (chainRules.length) this.rules.splice(this.rules.indexOf(chainRules[chainRules.length - 1]) + 1, 0, rule);
    else this.rules.push(rule);
    return { ...rule, conntrackStates: rule.conntrackStates ? [...rule.conntrackStates] : undefined,
      natTranslation: rule.natTranslation ? { ...rule.natTranslation } : undefined };
  }
  public deleteRule(id: number): boolean {
    const index = this.rules.findIndex((rule) => rule.id === id);
    if (index < 0) return false;
    this.rules.splice(index, 1);
    return true;
  }
  public deleteRuleAt(table: FirewallTable, chain: string, index: number): boolean {
    const selected = this.rules.filter((rule) => rule.table === table && rule.chain === chain)[index];
    return selected ? this.deleteRule(selected.id) : false;
  }
  public hasRule(table: FirewallTable, chain: string, match: Partial<FirewallRule>): boolean {
    return this.rules.some((rule) => rule.table === table && rule.chain === chain &&
      Object.entries(match).every(([key, value]) => (rule as any)[key] === value));
  }
  public flushRules(chain?: string, table?: FirewallTable): void {
    this.rules = this.rules.filter((rule) => (table !== undefined && rule.table !== table) ||
      (chain !== undefined && rule.chain !== chain));
  }
  public getRules(table?: FirewallTable, chain?: string): FirewallRule[] {
    return this.rules.filter((rule) => (!table || rule.table === table) && (!chain || rule.chain === chain))
      .map((rule) => ({ ...rule, conntrackStates: rule.conntrackStates ? [...rule.conntrackStates] : undefined,
        natTranslation: rule.natTranslation ? { ...rule.natTranslation } : undefined }));
  }
  public setPolicy(chain: FirewallChain, action: FirewallAction, table: FirewallTable = 'filter'): void {
    const config = this.chains.find((item) => item.table === table && item.name === chain);
    if (!config || !config.hook) throw new Error(`'${chain}' is not a built-in chain in table '${table}'`);
    config.policy = action;
  }
  public getPolicy(chain: FirewallChain, table: FirewallTable = 'filter'): FirewallAction {
    return this.chains.find((item) => item.table === table && item.name === chain)?.policy || 'DROP';
  }

  private evaluateChain(table: FirewallTable, chainName: string, packet: FirewallPacket, depth: number): FirewallAction | 'RETURN' {
    if (depth > 16) return 'DROP';
    const config = this.getChain(table, chainName);
    if (!config) return 'DROP';
    for (const rule of this.rules) {
      if (rule.table !== table || rule.chain !== chainName) continue;
      if (rule.port !== undefined && rule.port !== packet.port) continue;
      if (rule.sourcePort !== undefined && rule.sourcePort !== packet.sourcePort) continue;
      if (rule.protocol !== 'all' && rule.protocol !== (packet.protocol || 'tcp')) continue;
      if (!matchesAddress(rule.source, packet.source) || (rule.destination && !matchesAddress(rule.destination, packet.destination))) continue;
      if (rule.conntrackStates && !rule.conntrackStates.includes(this.getConntrackState(packet))) continue;
      if (rule.jump) {
        const result = this.evaluateChain(table, rule.jump, packet, depth + 1);
        if (result === 'RETURN') continue;
        return result;
      }
      return rule.action;
    }
    return config.hook ? (config.policy || 'DROP') : 'RETURN';
  }
  private connectionKey(packet: FirewallPacket, reverse = false): string | null {
    if (!packet.source || !packet.destination || packet.port === undefined || packet.sourcePort === undefined) return null;
    const protocol = packet.protocol || 'tcp';
    const source = reverse ? packet.destination : packet.source;
    const destination = reverse ? packet.source : packet.destination;
    const sourcePort = reverse ? packet.port : packet.sourcePort;
    const port = reverse ? packet.sourcePort : packet.port;
    return `${protocol}|${source}|${sourcePort}|${destination}|${port}`;
  }
  public getConntrackState(packet: FirewallPacket): FirewallConntrackState {
    if (packet.conntrackState) return packet.conntrackState;
    const now = Date.now();
    for (const [key, entry] of this.connections) if (entry.expiresAt <= now) this.connections.delete(key);
    const key = this.connectionKey(packet);
    const reverseKey = this.connectionKey(packet, true);
    return (key && this.connections.has(key)) || (reverseKey && this.connections.has(reverseKey)) ? 'ESTABLISHED' : 'NEW';
  }
  /** Record a simulated accepted flow so its reverse response can match ESTABLISHED rules. */
  public trackConnection(packet: FirewallPacket, ttlMs = 60_000): string | null {
    const key = this.connectionKey(packet);
    if (!key) return null;
    const id = `ct_${this.nextId++}`;
    this.connections.set(key, { id, expiresAt: Date.now() + ttlMs });
    return id;
  }
  public closeConnection(id: string | null): void {
    if (!id) return;
    for (const [key, entry] of this.connections) if (entry.id === id) this.connections.delete(key);
  }
  public evaluate(packet: FirewallPacket): FirewallAction {
    if (!this.enabled) return 'ALLOW';
    const hook = packet.target || 'INPUT';
    const baseChains = this.chains.filter((chain) => chain.table === 'filter' && chain.hook === hook).sort((a, b) => (a.priority || 0) - (b.priority || 0));
    for (const base of baseChains) {
      const verdict = this.evaluateChain(base.table, base.name, packet, 0);
      if (verdict !== 'RETURN' && verdict !== 'ALLOW') return verdict;
    }
    return 'ALLOW';
  }
  private applyNatChain(chain: string, packet: FirewallPacket, transformations: string[]): FirewallAction | null {
    for (const rule of this.rules) {
      if (rule.table !== 'nat' || rule.chain !== chain) continue;
      if (rule.port !== undefined && rule.port !== packet.port) continue;
      if (rule.sourcePort !== undefined && rule.sourcePort !== packet.sourcePort) continue;
      if (rule.protocol !== 'all' && rule.protocol !== (packet.protocol || 'tcp')) continue;
      if (!matchesAddress(rule.source, packet.source) || (rule.destination && !matchesAddress(rule.destination, packet.destination))) continue;
      if (rule.conntrackStates && !rule.conntrackStates.includes(this.getConntrackState(packet))) continue;
      if (rule.natTranslation) {
        const translation = rule.natTranslation;
        const oldAddress = translation.target === 'DNAT' ? packet.destination : packet.source;
        const oldPort = translation.target === 'DNAT' ? packet.port : packet.sourcePort;
        const address = translation.target === 'MASQUERADE' ? '192.168.1.100' : translation.address;
        if (!address) return 'REJECT';
        if (translation.target === 'DNAT') {
          packet.destination = address;
          if (translation.port !== undefined) packet.port = translation.port;
        } else {
          packet.source = address;
          if (translation.port !== undefined) packet.sourcePort = translation.port;
        }
        const newAddress = translation.target === 'DNAT' ? packet.destination : packet.source;
        const newPort = translation.target === 'DNAT' ? packet.port : packet.sourcePort;
        transformations.push(`${translation.target} ${oldAddress || '?'}${oldPort === undefined ? '' : `:${oldPort}`} -> ${newAddress}${newPort === undefined ? '' : `:${newPort}`}`);
        return null;
      }
      if (rule.jump) {
        const jumped = this.evaluateChain('nat', rule.jump, packet, 1);
        if (jumped === 'DROP' || jumped === 'REJECT') return jumped;
        return null;
      }
      if (rule.action === 'DROP' || rule.action === 'REJECT') return rule.action;
      return null;
    }
    return null;
  }
  /** Run the teaching packet path including IPv4 NAT transforms, then filter it. */
  public evaluatePacket(input: FirewallPacket): FirewallPacketResult {
    const packet = { ...input };
    const transformations: string[] = [];
    if (!this.enabled) return { verdict: 'ALLOW', packet, transformations };
    const hook = packet.target || 'INPUT';
    const prerouting = hook === 'INPUT' || hook === 'FORWARD';
    let verdict = this.applyNatChain(prerouting ? 'PREROUTING' : 'OUTPUT', packet, transformations);
    if (verdict) return { verdict, packet, transformations };
    if (hook === 'INPUT') {
      verdict = this.applyNatChain('INPUT', packet, transformations);
      if (verdict) return { verdict, packet, transformations };
    }
    verdict = this.evaluate(packet);
    if (verdict !== 'ALLOW') return { verdict, packet, transformations };
    if (hook === 'OUTPUT' || hook === 'FORWARD') {
      verdict = this.applyNatChain('POSTROUTING', packet, transformations) || 'ALLOW';
    }
    return { verdict, packet, transformations };
  }
  public isPortAllowed(port: number, protocol: 'tcp' | 'udp' = 'tcp', target: FirewallChain = 'INPUT', source?: string): boolean {
    return this.evaluate({ port, protocol, target, source }) === 'ALLOW';
  }
}

export const globalFirewallEngine = new FirewallEngine();
