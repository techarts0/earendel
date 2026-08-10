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

    // iptables first-match evaluation order
    for (const rule of this.rules) {
      const matchPort = rule.port === undefined || rule.port === port;
      const matchProto = rule.protocol === 'all' || rule.protocol === protocol;
      if (matchPort && matchProto) {
        return rule.action === 'ALLOW' || (rule.action as string) === 'ACCEPT';
      }
    }

    return true; // Default allow policy
  }
}

export const globalFirewallEngine = new FirewallEngine();
