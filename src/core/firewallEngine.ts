// Earendel Virtual Firewall Engine (iptables & ufw Netfilter Simulator)
export interface FirewallRule {
  id: number;
  action: 'ALLOW' | 'DROP' | 'REJECT';
  port?: number;
  protocol: 'tcp' | 'udp' | 'all';
  source: string; // '0.0.0.0/0' or specific IP
  target: string;
}

class FirewallEngine {
  private enabled: boolean = true;
  private rules: FirewallRule[] = [];
  private nextId = 1;

  constructor() {
    this.initDefaultRules();
  }

  private initDefaultRules() {
    // Default open common ports for basic operations
    this.addRule('ALLOW', 22, 'tcp');
    this.addRule('ALLOW', 80, 'tcp');
    this.addRule('ALLOW', 3306, 'tcp');
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(status: boolean): void {
    this.enabled = status;
  }

  public addRule(action: 'ALLOW' | 'DROP' | 'REJECT', port?: number, protocol: 'tcp' | 'udp' | 'all' = 'tcp', source: string = '0.0.0.0/0'): FirewallRule {
    const rule: FirewallRule = {
      id: this.nextId++,
      action,
      port,
      protocol,
      source,
      target: 'INPUT',
    };
    this.rules.push(rule);
    return rule;
  }

  public deleteRule(id: number): boolean {
    const idx = this.rules.findIndex((r) => r.id === id);
    if (idx !== -1) {
      this.rules.splice(idx, 1);
      return true;
    }
    return false;
  }

  public flushRules(): void {
    this.rules = [];
  }

  public getRules(): FirewallRule[] {
    return this.rules;
  }

  public isPortAllowed(port: number, protocol: 'tcp' | 'udp' = 'tcp'): boolean {
    if (!this.enabled) return true;

    // Check matching rules (last matching or first drop rule)
    const matchingDrop = this.rules.find((r) => (r.action === 'DROP' || r.action === 'REJECT') && (r.port === undefined || r.port === port) && (r.protocol === 'all' || r.protocol === protocol));
    if (matchingDrop) {
      return false; // Blocked by firewall!
    }

    return true; // Default allow
  }
}

export const globalFirewallEngine = new FirewallEngine();
