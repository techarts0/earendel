import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { checkNetworkRequest, globalCapabilityManager, globalFirewallEngine, netSecurityCommands } =
  require(join(process.env.EARENDEL_FIREWALL_BUILD, 'tools', 'firewall.integration.js'));

const rootContext = (args) => ({ args, callerPid: 1 });
async function run(commandName, args) {
  const command = netSecurityCommands.find((entry) => entry.name === commandName);
  assert.ok(command, `missing ${commandName} command`);
  return await command.execute(rootContext(args));
}

async function scenario(name, runScenario) {
  await runScenario();
  console.log(`ok - ${name}`);
}

async function main() {
  globalCapabilityManager.grantDefaultCaps(1);
  globalFirewallEngine.setEnabled(true);
  globalFirewallEngine.flushRules();
  for (const chain of ['INPUT', 'OUTPUT', 'FORWARD']) globalFirewallEngine.setPolicy(chain, chain === 'FORWARD' ? 'DROP' : 'ALLOW');

  await scenario('nft ordered rules, chain listing, handles, and validation', async () => {
    const chainName = 'regression_in';
    let result = await run('nft', ['add', 'chain', 'inet', 'filter', chainName, '{', 'type', 'filter', 'hook', 'input', 'priority', '0', ';', 'policy', 'accept', ';', '}']);
    assert.equal(result.exitCode, 0, result.stderr);
    result = await run('nft', ['add', 'rule', 'inet', 'filter', chainName, 'tcp', 'dport', '443', 'drop']);
    assert.equal(result.exitCode, 0, result.stderr);
    const firstHandle = Number(/# handle (\d+)/.exec((await run('nft', ['list', 'chain', 'inet', 'filter', chainName])).stdout)?.[1]);
    assert.ok(Number.isInteger(firstHandle));

    result = await run('nft', ['insert', 'rule', 'inet', 'filter', chainName, 'position', String(firstHandle), 'tcp', 'dport', '443', 'accept']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(globalFirewallEngine.evaluate({ target: 'INPUT', protocol: 'tcp', port: 443 }), 'ALLOW');
    result = await run('nft', ['add', 'rule', 'inet', 'filter', chainName, 'ip', 'saddr', '198.51.100.0/24', 'tcp', 'dport', '8443', 'drop']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(globalFirewallEngine.evaluate({ target: 'INPUT', protocol: 'tcp', port: 8443, source: '198.51.100.55' }), 'DROP');
    assert.equal(globalFirewallEngine.evaluate({ target: 'INPUT', protocol: 'tcp', port: 8443, source: '203.0.113.55' }), 'ALLOW');

    const chainListing = (await run('nft', ['-a', 'list', 'chain', 'inet', 'filter', chainName])).stdout;
    assert.match(chainListing, new RegExp(`chain ${chainName} \\{`));
    assert.doesNotMatch(chainListing, /chain INPUT \{/);
    assert.doesNotMatch(chainListing, /chain OUTPUT \{/);
    assert.match((await run('nft', ['list', 'ruleset'])).stdout, new RegExp(`chain ${chainName} \\{`));
    assert.match((await run('nft', ['list', 'table', 'inet', 'filter'])).stdout, new RegExp(`chain ${chainName} \\{`));
    result = await run('nft', ['add', 'rule', 'ip', 'filter', 'INPUT', 'tcp', 'dport', '80', 'accept']);
    assert.notEqual(result.exitCode, 0);

    result = await run('nft', ['delete', 'rule', 'inet', 'filter', chainName, 'handle', String(firstHandle)]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(globalFirewallEngine.evaluate({ target: 'INPUT', protocol: 'tcp', port: 443 }), 'ALLOW');
    result = await run('nft', ['flush', 'chain', 'inet', 'filter', 'missing_chain']);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /does not exist/);
    result = await run('nft', ['delete', 'chain', 'inet', 'filter', chainName]);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /not empty/);
    result = await run('nft', ['delete', 'chain', 'inet', 'filter', 'INPUT']);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /built-in chain/);

    result = await run('nft', ['flush', 'chain', 'inet', 'filter', chainName]);
    assert.equal(result.exitCode, 0, result.stderr);
    result = await run('nft', ['delete', 'chain', 'inet', 'filter', chainName]);
    assert.equal(result.exitCode, 0, result.stderr);
  });

  await scenario('iptables, UFW, and nft observe the same filter rules', async () => {
    let result = await run('iptables', ['-A', 'INPUT', '-p', 'tcp', '--dport', '2222', '-j', 'DROP']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(globalFirewallEngine.evaluate({ target: 'INPUT', protocol: 'tcp', port: 2222 }), 'DROP');
    assert.match((await run('nft', ['list', 'chain', 'inet', 'filter', 'INPUT'])).stdout, /tcp dport 2222 drop/);

    result = await run('ufw', ['deny', '8443/tcp']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(globalFirewallEngine.evaluate({ target: 'INPUT', protocol: 'tcp', port: 8443 }), 'DROP');
    result = await run('iptables', ['-D', 'INPUT', '1']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(globalFirewallEngine.evaluate({ target: 'INPUT', protocol: 'tcp', port: 2222 }), 'ALLOW');
  });

  await scenario('conntrack, NAT simulation, and outbound network policy', async () => {
    globalFirewallEngine.flushRules();
    globalFirewallEngine.setPolicy('OUTPUT', 'DROP');
    globalFirewallEngine.setPolicy('INPUT', 'DROP');
    let result = await run('nft', ['add', 'rule', 'inet', 'filter', 'OUTPUT', 'meta', 'l4proto', 'tcp', 'tcp', 'dport', '443', 'accept']);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(checkNetworkRequest(1, 'https://example.org/'), null);
    assert.match(checkNetworkRequest(1, 'http://example.org/'), /blocked by simulated firewall/i);

    result = await run('iptables', ['-A', 'INPUT', '-p', 'tcp', '-m', 'conntrack', '--ctstate', 'ESTABLISHED', '-j', 'ACCEPT']);
    assert.equal(result.exitCode, 0, result.stderr);
    const flow = { source: '192.168.1.100', sourcePort: 51000, destination: '203.0.113.10', port: 443, protocol: 'tcp', target: 'OUTPUT' };
    const connectionId = globalFirewallEngine.trackConnection(flow);
    assert.equal(globalFirewallEngine.evaluate({ source: flow.destination, sourcePort: 443, destination: flow.source, port: 51000, protocol: 'tcp', target: 'INPUT' }), 'ALLOW');
    globalFirewallEngine.closeConnection(connectionId);
    assert.equal(globalFirewallEngine.evaluate({ source: flow.destination, sourcePort: 443, destination: flow.source, port: 51000, protocol: 'tcp', target: 'INPUT' }), 'DROP');

    globalFirewallEngine.flushRules(undefined, 'nat');
    result = await run('iptables', ['-t', 'nat', '-A', 'PREROUTING', '-p', 'tcp', '--dport', '8080', '-j', 'DNAT', '--to-destination', '192.168.1.20:80']);
    assert.equal(result.exitCode, 0, result.stderr);
    const packet = globalFirewallEngine.evaluatePacket({ target: 'INPUT', protocol: 'tcp', port: 8080, source: '203.0.113.5', destination: '192.168.1.100' });
    assert.equal(packet.verdict, 'DROP');
    assert.equal(packet.packet.destination, '192.168.1.20');
    assert.equal(packet.packet.port, 80);
    assert.match(packet.transformations[0], /DNAT/);
  });
}

try {
  await main();
} catch (error) {
  console.error('not ok - firewall integration:', error);
  process.exitCode = 1;
}
