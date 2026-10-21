import { Command } from '../types';
import { FirewallAction, FirewallChain, FirewallConntrackState, FirewallNatTranslation, FirewallProtocol, FirewallTable, globalFirewallEngine } from '../firewallEngine';
import { globalCapabilityManager } from '../../kernel/capability';

function hasFirewallAdmin(ctx: Parameters<Command['execute']>[0]): boolean {
  return ctx.callerPid !== undefined && globalCapabilityManager.hasCapability(ctx.callerPid, 'CAP_NET_ADMIN');
}

function asAction(value: string): FirewallAction | null {
  if (value === 'ACCEPT' || value === 'accept') return 'ALLOW';
  if (value === 'DROP' || value === 'drop') return 'DROP';
  if (value === 'REJECT' || value === 'reject') return 'REJECT';
  return null;
}

function parseIptables(inputArgs: string[]) {
  const args = inputArgs;
  let table: FirewallTable = 'filter';
  const tableFlag = args.findIndex((arg) => arg === '-t' || arg === '--table');
  if (tableFlag >= 0) {
    const requested = args[tableFlag + 1];
    if (!['filter', 'nat', 'mangle', 'raw'].includes(requested)) throw new Error(`unsupported table '${requested || ''}'`);
    table = requested as FirewallTable;
    args.splice(tableFlag, 2);
  }
  if (!globalFirewallEngine.hasTable(table)) globalFirewallEngine.addTable(table);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) return 'iptables (Earendel simulated firewall)\nUsage: iptables [-t filter|nat|mangle|raw] -A|-I|-D|-C chain [rule-specification]\n       iptables [-t table] -L|-S|-F [chain]\n       iptables [-t table] -N|-X chain\n       iptables [-t table] -P chain ACCEPT|DROP';
  const opIndex = args.findIndex((arg) => ['-A', '--append', '-I', '--insert', '-D', '--delete', '-C', '--check', '-R', '--replace', '-N', '--new-chain', '-X', '--delete-chain', '-F', '--flush', '-L', '--list', '-S', '--list-rules', '-P', '--policy'].includes(arg));
  if (opIndex < 0) throw new Error(`unsupported operation; supported: -A -I -D -C -R -N -X -F -L -S -P`);
  const op = args[opIndex];
  const chain = args[opIndex + 1];
  if (['-N', '--new-chain'].includes(op)) {
    if (!chain) throw new Error('missing chain name');
    globalFirewallEngine.addChain({ table, name: chain });
    return '';
  }
  if (['-X', '--delete-chain'].includes(op)) {
    if (chain) globalFirewallEngine.deleteChain(table, chain);
    else for (const item of globalFirewallEngine.getChains(table).filter((entry) => !entry.hook)) globalFirewallEngine.deleteChain(table, item.name);
    return '';
  }
  if (['-F', '--flush'].includes(op)) {
    if (chain && !globalFirewallEngine.getChain(table, chain)) throw new Error(`chain '${chain}' does not exist`);
    globalFirewallEngine.flushRules(chain, table);
    return '';
  }
  if (['-P', '--policy'].includes(op)) {
    const action = asAction(args[opIndex + 2] || '');
    if (!chain || !action || action === 'REJECT') throw new Error('usage: iptables -P chain ACCEPT|DROP');
    globalFirewallEngine.setPolicy(chain as FirewallChain, action, table);
    return '';
  }
  if (['-S', '--list-rules'].includes(op)) {
    const selected = chain ? [chain] : globalFirewallEngine.getChains(table).map((entry) => entry.name);
    const lines: string[] = [];
    for (const name of selected) {
      const config = globalFirewallEngine.getChain(table, name);
      if (!config) throw new Error(`chain '${name}' does not exist`);
      if (config.policy) lines.push(`-P ${name} ${config.policy === 'ALLOW' ? 'ACCEPT' : config.policy}`);
      else lines.push(`-N ${name}`);
      for (const rule of globalFirewallEngine.getRules(table, name)) {
        const args = [`-A ${name}`];
        if (rule.protocol !== 'all') args.push(`-p ${rule.protocol}`);
        if (rule.source !== '0.0.0.0/0') args.push(`-s ${rule.source}`);
        if (rule.destination) args.push(`-d ${rule.destination}`);
        if (rule.port !== undefined) args.push(`--dport ${rule.port}`);
        if (rule.sourcePort !== undefined) args.push(`--sport ${rule.sourcePort}`);
        if (rule.conntrackStates?.length) args.push(`-m conntrack --ctstate ${rule.conntrackStates.join(',')}`);
        const target = rule.natTranslation?.target || rule.jump || (rule.action === 'ALLOW' ? 'ACCEPT' : rule.action);
        args.push(`-j ${target}`);
        if (rule.natTranslation?.address) args.push(`${target === 'DNAT' ? '--to-destination' : '--to-source'} ${rule.natTranslation.address}${rule.natTranslation.port === undefined ? '' : `:${rule.natTranslation.port}`}`);
        lines.push(args.join(' '));
      }
    }
    return lines.join('\n');
  }
  if (['-L', '--list'].includes(op)) {
    const selected = chain ? [chain] : globalFirewallEngine.getChains(table).map((entry) => entry.name);
    const lines: string[] = [];
    for (const name of selected) {
      const config = globalFirewallEngine.getChain(table, name);
      if (!config) throw new Error(`chain '${name}' does not exist`);
      lines.push(`Chain ${name} (policy ${config.policy ? (config.policy === 'ALLOW' ? 'ACCEPT' : config.policy) : '-'})`, 'target     prot opt source               destination');
      for (const rule of globalFirewallEngine.getRules(table, name)) {
        const action = rule.natTranslation?.target || rule.jump || (rule.action === 'ALLOW' ? 'ACCEPT' : rule.action);
        const sourcePort = rule.sourcePort === undefined ? '' : ` spt:${rule.sourcePort}`;
        const destPort = rule.port === undefined ? '' : ` dpt:${rule.port}`;
        const translation = rule.natTranslation?.address ? ` to:${rule.natTranslation.address}${rule.natTranslation.port === undefined ? '' : `:${rule.natTranslation.port}`}` : '';
        const states = rule.conntrackStates?.length ? ` ctstate ${rule.conntrackStates.join(',')}` : '';
        lines.push(`${action.padEnd(10)} ${rule.protocol.padEnd(8)} --  ${rule.source.padEnd(18)} ${(rule.destination || 'anywhere').padEnd(18)}${sourcePort}${destPort}${translation}${states}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }
  if (!chain) throw new Error('missing chain name');
  const ruleArgs = args.slice(opIndex + 2);
  let ordinal: number | undefined;
  if (['-I', '--insert', '-D', '--delete', '-R', '--replace'].includes(op) && ruleArgs[0] && /^\d+$/.test(ruleArgs[0])) ordinal = Number(ruleArgs.shift());
  const parsed = { protocol: 'all' as FirewallProtocol, source: '0.0.0.0/0', destination: undefined as string | undefined,
    port: undefined as number | undefined, sourcePort: undefined as number | undefined, action: 'ALLOW' as FirewallAction, jump: undefined as string | undefined,
    conntrackStates: undefined as FirewallConntrackState[] | undefined, natTranslation: undefined as FirewallNatTranslation | undefined };
  let hasTarget = false;
  for (let i = 0; i < ruleArgs.length; i++) {
    const arg = ruleArgs[i];
    if (arg === '-p' || arg === '--protocol') parsed.protocol = (ruleArgs[++i] || '') as FirewallProtocol;
    else if (arg === '-m' || arg === '--match') {
      const module = ruleArgs[++i];
      if (module !== 'conntrack' && module !== 'state') throw new Error(`unsupported match module '${module || ''}'`);
    }
    else if (arg === '--ctstate' || arg === '--state') {
      const stateList = ruleArgs[++i] || '';
      const states = stateList.split(',').map((state) => state.toUpperCase());
      if (!stateList || states.some((state) => !['NEW', 'ESTABLISHED', 'RELATED', 'INVALID'].includes(state))) throw new Error(`invalid connection state list '${stateList}'`);
      parsed.conntrackStates = states as FirewallConntrackState[];
    }
    else if (arg === '-s' || arg === '--source') parsed.source = ruleArgs[++i] || '';
    else if (arg === '-d' || arg === '--destination') parsed.destination = ruleArgs[++i] || '';
    else if (arg === '--dport' || arg === '--destination-port') parsed.port = Number(ruleArgs[++i]);
    else if (arg === '--sport' || arg === '--source-port') parsed.sourcePort = Number(ruleArgs[++i]);
    else if (arg === '-j' || arg === '--jump') {
      hasTarget = true;
      const target = ruleArgs[++i] || '';
      const action = asAction(target);
      if (action) parsed.action = action;
      else if (['DNAT', 'SNAT', 'MASQUERADE'].includes(target)) {
        if (table !== 'nat') throw new Error(`${target} is only supported in the nat table`);
        parsed.natTranslation = { target: target as FirewallNatTranslation['target'] };
      }
      else if (globalFirewallEngine.getChain(table, target)) parsed.jump = target;
      else throw new Error(`unsupported target '${target}'`);
    } else if (['--to-destination', '--to-dest', '--to-source', '--to'].includes(arg)) {
      if (!parsed.natTranslation || parsed.natTranslation.target === 'MASQUERADE') throw new Error(`${arg} requires a DNAT or SNAT target`);
      const value = ruleArgs[++i] || '';
      const match = /^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d+))?$/.exec(value);
      if (!match) throw new Error(`invalid NAT translation address '${value}'`);
      if (parsed.natTranslation.target === 'DNAT' && arg === '--to-source' || parsed.natTranslation.target === 'SNAT' && ['--to-destination', '--to-dest'].includes(arg)) {
        throw new Error(`${arg} does not match ${parsed.natTranslation.target} target`);
      }
      parsed.natTranslation.address = match[1];
      if (match[2] !== undefined) parsed.natTranslation.port = Number(match[2]);
    } else throw new Error(`unsupported rule option '${arg}'`);
  }
  if (!hasTarget && !(ordinal !== undefined && ['-D', '--delete'].includes(op))) {
    throw new Error('an explicit -j target is required by this teaching subset');
  }
  if (parsed.protocol !== 'all' && !['tcp', 'udp', 'icmp'].includes(parsed.protocol)) throw new Error(`unsupported protocol '${parsed.protocol}'`);
  if ((parsed.port !== undefined || parsed.sourcePort !== undefined) && parsed.protocol !== 'tcp' && parsed.protocol !== 'udp') {
    throw new Error('port matches require -p tcp or -p udp');
  }
  if (['-D', '--delete', '-C', '--check'].includes(op)) {
    const current = globalFirewallEngine.getRules(table, chain);
    const rule = ordinal ? current[ordinal - 1] : current.find((entry) => entry.protocol === parsed.protocol && entry.source === parsed.source &&
      entry.destination === parsed.destination && entry.port === parsed.port && entry.sourcePort === parsed.sourcePort &&
      entry.action === parsed.action && entry.jump === parsed.jump && entry.natTranslation?.target === parsed.natTranslation?.target &&
      entry.natTranslation?.address === parsed.natTranslation?.address && entry.natTranslation?.port === parsed.natTranslation?.port &&
      (entry.conntrackStates || []).join(',') === (parsed.conntrackStates || []).join(','));
    if (['-C', '--check'].includes(op)) {
      if (!rule) throw new Error('rule does not exist');
      return '';
    }
    if (!rule) throw new Error('rule does not exist');
    globalFirewallEngine.deleteRule(rule.id);
    return '';
  }
  if (!globalFirewallEngine.getChain(table, chain)) throw new Error(`chain '${chain}' does not exist`);
  if (['-R', '--replace'].includes(op)) {
    if (!ordinal || !globalFirewallEngine.deleteRuleAt(table, chain, ordinal - 1)) throw new Error('rule number does not exist');
  }
  globalFirewallEngine.addRule(parsed.action, parsed.port, parsed.protocol, parsed.source, chain as FirewallChain,
    ['-I', '--insert'].includes(op) && ordinal === undefined,
    { table, chain, sourcePort: parsed.sourcePort, destination: parsed.destination, jump: parsed.jump,
      position: ['-I', '--insert', '-R', '--replace'].includes(op) ? ordinal : undefined, conntrackStates: parsed.conntrackStates,
      natTranslation: parsed.natTranslation });
  return '';
}

function executeNft(args: string[]): string {
  // Bounded teaching grammar: shared inet filter table, base/regular chains,
  // IPv4 source/destination, L4 protocol/ports, conntrack and verdict statements.
  const tokens = args.filter((token) => token !== '-a' && token !== '-A' && token !== '--handle')
    .flatMap((token) => token.replace(/[{};]/g, ' ').split(/\s+/)).filter(Boolean);
  const [verb, object, family, tableName, objectName, ...rest] = tokens;
  const renderTable = (chainName?: string): string => {
    const chains = globalFirewallEngine.getChains('filter').filter((chain) => !chainName || chain.name === chainName);
    if (chainName && chains.length === 0) throw new Error(`chain '${chainName}' does not exist`);
    const out = ['table inet filter {'];
    for (const chain of chains) {
      out.push(`\tchain ${chain.name} {`);
      if (chain.hook) out.push(`\t\ttype filter hook ${chain.hook.toLowerCase()} priority ${chain.priority || 0}; policy ${(chain.policy || 'DROP').toLowerCase()};`);
      for (const rule of globalFirewallEngine.getRules('filter', chain.name)) {
        const terms: string[] = [];
        if (rule.protocol !== 'all') terms.push(`meta l4proto ${rule.protocol}`);
        if (rule.source !== '0.0.0.0/0') terms.push(`ip saddr ${rule.source}`);
        if (rule.destination) terms.push(`ip daddr ${rule.destination}`);
        if (rule.port !== undefined) terms.push(`${rule.protocol} dport ${rule.port}`);
        if (rule.sourcePort !== undefined) terms.push(`${rule.protocol} sport ${rule.sourcePort}`);
        if (rule.conntrackStates?.length) terms.push(`ct state ${rule.conntrackStates.map((state) => state.toLowerCase()).join(',')}`);
        terms.push(rule.jump || (rule.action === 'ALLOW' ? 'accept' : rule.action.toLowerCase()));
        out.push(`\t\t${terms.join(' ')} # handle ${rule.id}`);
      }
      out.push('\t}');
    }
    out.push('}');
    return out.join('\n');
  };
  if (verb === 'list' && object === 'ruleset') {
    return globalFirewallEngine.hasTable('filter') ? renderTable() : '';
  }
  if (family !== 'inet') throw new Error("only the 'inet' family is supported by the shared filter teaching table");
  if (tableName !== 'filter') throw new Error("the teaching subset supports only the 'filter' table");
  if (verb === 'add' && object === 'table') {
    if (tableName === 'filter' && globalFirewallEngine.hasTable('filter')) throw new Error("table 'inet filter' already exists in the shared teaching ruleset");
    throw new Error("only the pre-created shared 'inet filter' teaching table is supported");
  }
  if ((verb === 'delete' || verb === 'destroy') && object === 'table') {
    if (tableName === 'filter') throw new Error("the shared 'filter' table cannot be removed; flush its rules instead");
    throw new Error("only the shared 'inet filter' teaching table is supported");
  }
  if (verb === 'list' && object === 'table') {
    if (!globalFirewallEngine.hasTable('filter')) throw new Error("table 'filter' does not exist");
    return renderTable();
  }
  if (verb === 'flush' && object === 'table') {
    if (!globalFirewallEngine.hasTable('filter')) throw new Error("table 'filter' does not exist");
    globalFirewallEngine.flushRules(undefined, 'filter'); return '';
  }
  if (verb === 'flush' && object === 'ruleset') { globalFirewallEngine.flushRules(undefined, 'filter'); return ''; }
  if (object === 'chain') {
    if (verb === 'add' || verb === 'create') {
      if (!objectName) throw new Error('missing chain name');
      let hook: FirewallChain | undefined;
      let priority: number | undefined;
      let policy: FirewallAction | undefined;
      let hasFilterType = false;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === 'type' && rest[i + 1] === 'filter') { hasFilterType = true; i++; }
        else if (rest[i] === 'hook') {
          const hookWord = (rest[++i] || '').toUpperCase();
          if (!['INPUT', 'OUTPUT', 'FORWARD'].includes(hookWord)) throw new Error(`unsupported hook '${hookWord}'`);
          hook = hookWord as FirewallChain;
        } else if (rest[i] === 'priority') {
          priority = Number(rest[++i]);
          if (!Number.isInteger(priority)) throw new Error('priority must be an integer');
        } else if (rest[i] === 'policy') {
          const policyWord = rest[++i] || '';
          policy = policyWord === 'accept' || policyWord === 'drop' ? asAction(policyWord) || undefined : undefined;
          if (!policy) throw new Error('nft base-chain policy must be accept or drop');
        } else throw new Error(`unsupported chain option '${rest[i]}'`);
      }
      if (hook && (!hasFilterType || priority === undefined)) throw new Error('base chains require: type filter hook HOOK priority INTEGER');
      if (!hook && (hasFilterType || priority !== undefined || policy !== undefined)) throw new Error('type, hook, priority, and policy are only valid on a base chain');
      globalFirewallEngine.addChain({ table: 'filter', name: objectName, hook, priority, policy });
      return '';
    }
    if (verb === 'list') {
      return renderTable(objectName);
    }
    if (verb === 'delete' || verb === 'destroy') { globalFirewallEngine.deleteChain('filter', objectName); return ''; }
    if (verb === 'flush') {
      if (!globalFirewallEngine.getChain('filter', objectName)) throw new Error(`chain '${objectName}' does not exist`);
      globalFirewallEngine.flushRules(objectName, 'filter'); return '';
    }
  }
  if (object === 'rule' && (verb === 'add' || verb === 'insert')) {
    if (family !== 'inet') throw new Error('rule family must be inet');
    const chain = objectName;
    if (!globalFirewallEngine.getChain('filter', chain)) throw new Error(`chain '${chain}' does not exist`);
    let protocol: FirewallProtocol = 'all';
    let source = '0.0.0.0/0';
    let destination: string | undefined;
    let port: number | undefined;
    let sourcePort: number | undefined;
    let conntrackStates: FirewallConntrackState[] | undefined;
    let verdict: FirewallAction | null = null;
    let jump: string | undefined;
    let position: number | undefined;
    if (verb === 'insert' && rest[0] === 'position') {
      const handle = Number(rest[1]);
      const rules = globalFirewallEngine.getRules('filter', chain);
      const referenceIndex = rules.findIndex((rule) => rule.id === handle);
      if (!Number.isInteger(handle) || referenceIndex < 0) throw new Error(`rule handle '${rest[1] || ''}' does not exist`);
      position = referenceIndex + 1;
      rest.splice(0, 2);
    } else if (verb === 'insert' && rest[0] === 'index') {
      const index = Number(rest[1]);
      const count = globalFirewallEngine.getRules('filter', chain).length;
      if (!Number.isInteger(index) || index < 0 || index > count) throw new Error(`invalid insertion index '${rest[1] || ''}'`);
      position = index + 1;
      rest.splice(0, 2);
    }
    for (let i = 0; i < rest.length; i++) {
      const token = rest[i];
      if (token === 'tcp' || token === 'udp' || token === 'icmp') protocol = token;
      else if ((token === 'meta' && rest[i + 1] === 'l4proto') || (token === 'ip' && rest[i + 1] === 'protocol')) protocol = rest[i += 2] as FirewallProtocol;
      else if (token === 'ip' && rest[i + 1] === 'saddr') source = rest[i += 2];
      else if (token === 'ip' && rest[i + 1] === 'daddr') destination = rest[i += 2];
      else if (token === 'ct' && rest[i + 1] === 'state') {
        const stateList = rest[i += 2] || '';
        const states = stateList.split(',').map((state) => state.toUpperCase());
        if (!stateList || states.some((state) => !['NEW', 'ESTABLISHED', 'RELATED', 'INVALID'].includes(state))) throw new Error(`invalid conntrack state list '${stateList}'`);
        conntrackStates = states as FirewallConntrackState[];
      }
      else if (token === 'dport') port = Number(rest[++i]);
      else if (token === 'sport') sourcePort = Number(rest[++i]);
      else if (['accept', 'drop', 'reject'].includes(token)) verdict = asAction(token);
      else if (globalFirewallEngine.getChain('filter', token)) jump = token;
      else throw new Error(`unsupported nft expression '${token}'`);
    }
    if (!verdict && !jump) throw new Error('rule requires accept, drop, reject, or a supported chain verdict');
    if (protocol !== 'all' && !['tcp', 'udp', 'icmp'].includes(protocol)) throw new Error(`unsupported protocol '${protocol}'`);
    if ((port !== undefined || sourcePort !== undefined) && protocol !== 'tcp' && protocol !== 'udp') {
      throw new Error('port expressions require tcp or udp');
    }
    globalFirewallEngine.addRule(verdict || 'ALLOW', port, protocol, source, 'INPUT', false,
      { table: 'filter', chain, sourcePort, destination, jump, conntrackStates, position });
    return '';
  }
  if (object === 'rule' && (verb === 'delete' || verb === 'destroy')) {
    if (rest[0] === 'handle') {
      const handle = Number(rest[1]);
      const rule = globalFirewallEngine.getRules('filter', objectName).find((entry) => entry.id === handle);
      if (!rule || !globalFirewallEngine.deleteRule(rule.id)) throw new Error(`rule handle '${rest[1] || ''}' does not exist`);
      return '';
    }
    const index = rest[0] === 'index' ? Number(rest[1]) : Number(rest[0]);
    if (!Number.isInteger(index) || index < 0 || !globalFirewallEngine.deleteRuleAt('filter', objectName, index)) throw new Error('rule index does not exist');
    return '';
  }
  throw new Error(`unsupported command '${tokens.join(' ')}'; run 'nft --help' for supported teaching syntax`);
}

export const netSecurityCommands: Command[] = [
  {
    name: 'fwtest', aliases: ['firewall-test'], description: 'evaluate a packet against the simulated firewall rules', category: 'net',
    execute: (ctx) => {
      const chain = (ctx.args[0] || 'INPUT').toUpperCase() as FirewallChain;
      if (!['INPUT', 'OUTPUT', 'FORWARD'].includes(chain)) return { stdout: '', stderr: 'fwtest: chain must be INPUT, OUTPUT, or FORWARD\n', exitCode: 2 };
      const packet: { target: FirewallChain; protocol: FirewallProtocol; port?: number; sourcePort?: number; source?: string; destination?: string; conntrackState?: FirewallConntrackState } = { target: chain, protocol: 'tcp' };
      for (let i = 1; i < ctx.args.length; i++) {
        const flag = ctx.args[i]; const value = ctx.args[++i];
        if (flag === '-p' || flag === '--protocol') packet.protocol = value as FirewallProtocol;
        else if (flag === '--dport') packet.port = Number(value);
        else if (flag === '--sport') packet.sourcePort = Number(value);
        else if (flag === '--ctstate') {
          const state = (value || '').toUpperCase();
          if (!['NEW', 'ESTABLISHED', 'RELATED', 'INVALID'].includes(state)) return { stdout: '', stderr: `fwtest: invalid conntrack state '${value || ''}'\n`, exitCode: 2 };
          packet.conntrackState = state as FirewallConntrackState;
        }
        else if (flag === '-s' || flag === '--source') packet.source = value;
        else if (flag === '-d' || flag === '--destination') packet.destination = value;
        else return { stdout: '', stderr: `fwtest: unsupported option '${flag}'\n`, exitCode: 2 };
      }
      if (!['tcp', 'udp', 'icmp', 'all'].includes(packet.protocol)) return { stdout: '', stderr: `fwtest: invalid protocol '${packet.protocol}'\n`, exitCode: 2 };
      if (packet.port !== undefined && (!Number.isInteger(packet.port) || packet.port < 1 || packet.port > 65535)) return { stdout: '', stderr: 'fwtest: invalid destination port\n', exitCode: 2 };
      const connectionState = globalFirewallEngine.getConntrackState(packet);
      const result = globalFirewallEngine.evaluatePacket(packet);
      const translated = result.transformations.length ? `\n  NAT: ${result.transformations.join('; ')}` : '';
      const endpoint = `\n  Final packet: ${result.packet.source || '?'}${result.packet.sourcePort === undefined ? '' : `:${result.packet.sourcePort}`} -> ${result.packet.destination || '?'}${result.packet.port === undefined ? '' : `:${result.packet.port}`}`;
      return { stdout: `Simulated ${chain} packet (ctstate ${connectionState}): ${result.verdict}${translated}${endpoint}\n`, stderr: '', exitCode: result.verdict === 'ALLOW' ? 0 : 1 };
    },
  },
  {
    name: 'ufw', description: 'manage the simulated firewall', category: 'net',
    execute: (ctx) => {
      if (!hasFirewallAdmin(ctx)) return { stdout: '', stderr: 'ERROR: CAP_NET_ADMIN is required to manage the simulated firewall\n', exitCode: 1 };
      const [sub, target] = ctx.args;
      if (!sub || sub === 'help') return { stdout: 'ufw status [numbered] | enable | disable | default allow|deny|reject incoming|outgoing|routed | allow|deny|reject PORT[/tcp|udp] | allow|deny from CIDR [port PORT [proto tcp|udp]] | insert NUMBER allow|deny PORT[/tcp|udp] | delete NUMBER | reset\n', stderr: '', exitCode: 0 };
      if (sub === 'status') {
        if (!globalFirewallEngine.isEnabled()) return { stdout: 'Status: inactive\n', stderr: '', exitCode: 0 };
        const rules = globalFirewallEngine.getRules('filter', 'INPUT');
        const numbered = target === 'numbered';
        const labelPolicy = (chain: FirewallChain) => {
          const policy = globalFirewallEngine.getPolicy(chain);
          return policy === 'ALLOW' ? 'allow' : policy === 'DROP' ? 'deny' : 'reject';
        };
        let out = `Status: active\nDefault: ${labelPolicy('INPUT')} (incoming), ${labelPolicy('OUTPUT')} (outgoing), ${labelPolicy('FORWARD')} (routed)\n\n`;
        out += numbered ? '     To                         Action      From\n     --                         ------      ----\n' : 'To                         Action      From\n--                         ------      ----\n';
        rules.forEach((rule, index) => { out += `${numbered ? `[${index + 1}] ` : ''}${(rule.port ? `${rule.port}/${rule.protocol}` : 'Anywhere').padEnd(26)} ${(rule.action === 'ALLOW' ? 'ALLOW' : rule.action === 'DROP' ? 'DENY' : 'REJECT').padEnd(11)} ${rule.source}\n`; });
        return { stdout: out, stderr: '', exitCode: 0 };
      }
      if (sub === 'enable' || sub === 'disable') { globalFirewallEngine.setEnabled(sub === 'enable'); return { stdout: `Firewall ${sub === 'enable' ? 'is active' : 'stopped'}\n`, stderr: '', exitCode: 0 }; }
      if (sub === 'reset') { globalFirewallEngine.flushRules(); globalFirewallEngine.setPolicy('INPUT', 'ALLOW'); globalFirewallEngine.setPolicy('OUTPUT', 'ALLOW'); globalFirewallEngine.setPolicy('FORWARD', 'DROP'); globalFirewallEngine.setEnabled(true); return { stdout: 'Firewall rules reset to defaults\n', stderr: '', exitCode: 0 }; }
      if (sub === 'default') {
        const direction = ctx.args[2];
        const chain = direction === 'incoming' ? 'INPUT' : direction === 'outgoing' ? 'OUTPUT' : direction === 'routed' ? 'FORWARD' : null;
        const action = asAction(target || '');
        if (!chain || !action) return { stdout: '', stderr: 'ufw: usage: ufw default allow|deny|reject incoming|outgoing|routed\n', exitCode: 2 };
        globalFirewallEngine.setPolicy(chain, action); return { stdout: `Default ${direction} policy changed\n`, stderr: '', exitCode: 0 };
      }
      if (['allow', 'deny', 'reject', 'insert'].includes(sub)) {
        const inserting = sub === 'insert';
        const actionName = inserting ? ctx.args[2] : sub;
        const action = actionName === 'allow' ? 'ALLOW' : actionName === 'deny' ? 'DROP' : actionName === 'reject' ? 'REJECT' : null;
        const position = inserting ? Number(target) : undefined;
        if (!action || (inserting && (!Number.isInteger(position) || position! < 1))) return { stdout: '', stderr: 'ufw: invalid action or insertion position\n', exitCode: 2 };
        const params = ctx.args.slice(inserting ? 3 : 1);
        let port: number | undefined;
        let protocol: FirewallProtocol = 'tcp';
        let source = '0.0.0.0/0';
        if (params[0] === 'from') {
          source = params[1] || '';
          if (!source) return { stdout: '', stderr: 'ufw: missing source address\n', exitCode: 2 };
          protocol = 'all';
          let i = 2;
          if (params[i] === 'to') {
            if (params[i + 1] !== 'any') return { stdout: '', stderr: 'ufw: only "to any" is supported\n', exitCode: 2 };
            i += 2;
          }
          while (i < params.length) {
            if (params[i] === 'port') {
              const spec = /^(\d+)(?:\/(tcp|udp))?$/.exec(params[i + 1] || '');
              if (!spec) return { stdout: '', stderr: 'ufw: invalid port specification\n', exitCode: 2 };
              port = Number(spec[1]);
              protocol = (spec[2] || 'tcp') as FirewallProtocol;
              i += 2;
            } else if (params[i] === 'proto') {
              protocol = params[i + 1] as FirewallProtocol;
              i += 2;
            } else return { stdout: '', stderr: `ufw: unsupported source rule option '${params[i]}'\n`, exitCode: 2 };
          }
        } else {
          const match = /^(\d+)(?:\/(tcp|udp))?$/.exec(params[0] || '');
          if (!match) return { stdout: '', stderr: `ufw ${actionName}: unsupported port specification '${params[0] || ''}'\n`, exitCode: 2 };
          port = Number(match[1]); protocol = (match[2] || 'tcp') as FirewallProtocol;
        }
        if (port !== undefined && protocol !== 'tcp' && protocol !== 'udp') return { stdout: '', stderr: 'ufw: protocol must be tcp or udp when a port is specified\n', exitCode: 2 };
        try { globalFirewallEngine.addRule(action, port, protocol, source, 'INPUT', inserting && position === undefined, { table: 'filter', chain: 'INPUT', position }); }
        catch (error) { return { stdout: '', stderr: `ufw ${sub}: ${(error as Error).message}\n`, exitCode: 2 }; }
        return { stdout: 'Rules updated\n', stderr: '', exitCode: 0 };
      }
      if (sub === 'delete') {
        const n = Number(target); if (!Number.isInteger(n) || n < 1 || !globalFirewallEngine.deleteRuleAt('filter', 'INPUT', n - 1)) return { stdout: '', stderr: `ufw delete: rule '${target || ''}' does not exist\n`, exitCode: 1 };
        return { stdout: 'Rules updated\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: `ufw: unsupported command '${sub}'\n`, exitCode: 2 };
    },
  },
  {
    name: 'iptables', description: 'manage simulated IPv4 packet filtering rules', category: 'net',
    execute: (ctx) => {
      if (!hasFirewallAdmin(ctx)) return { stdout: '', stderr: 'iptables: Permission denied (CAP_NET_ADMIN is required)\n', exitCode: 4 };
      try { return { stdout: parseIptables([...ctx.args]), stderr: '', exitCode: 0 }; }
      catch (error) { return { stdout: '', stderr: `iptables: ${(error as Error).message}\n`, exitCode: 2 }; }
    },
  },
  {
    name: 'nft', description: 'manage the simulated firewall using the nft teaching subset', category: 'net',
    execute: (ctx) => {
      if (!hasFirewallAdmin(ctx)) return { stdout: '', stderr: 'nft: Error: CAP_NET_ADMIN is required\n', exitCode: 1 };
      if (ctx.args.includes('--help') || ctx.args.includes('-h')) return { stdout: 'Earendel nft teaching subset: nft list ruleset|table inet filter|chain inet filter CHAIN; nft add chain inet filter NAME { type filter hook input|output|forward priority N ; policy accept|drop ; }; nft add|insert rule inet filter CHAIN [position HANDLE] [meta l4proto tcp|udp|icmp] [ct state new,established] [ip saddr CIDR] [ip daddr CIDR] [tcp|udp dport PORT] accept|drop|reject; nft delete rule inet filter CHAIN handle HANDLE; nft flush chain|table inet filter [CHAIN]\n', stderr: '', exitCode: 0 };
      try { return { stdout: executeNft([...ctx.args]) + '\n', stderr: '', exitCode: 0 }; }
      catch (error) { return { stdout: '', stderr: `nft: Error: ${(error as Error).message}\n`, exitCode: 1 }; }
    },
  },
];
