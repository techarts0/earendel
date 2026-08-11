// Kernel Agent Framework Management Command Suite (agent-list, agent-start, agent-stop, agent-test)
import { globalKernelAgentManager } from '../../kernel/agentFramework';
import { Command } from '../types';

export const agentListCommand: Command = {
  name: 'agent-list',
  description: 'List all registered OS Kernel Agent Daemons (Observe -> Infer -> Act)',
  category: 'sys',
  execute: () => {
    const agents = globalKernelAgentManager.getAgents();
    let out = `\x1b[1;36m[Earendel OS Kernel Agent Framework Daemons]\x1b[0m\n\n`;
    out += `ID          NAME                                  TYPE     STATUS    DESCRIPTION\n`;
    out += `--------------------------------------------------------------------------------------------------\n`;

    agents.forEach((ag) => {
      const typeStr = ag.isDaemon ? 'DAEMON' : 'TASK';
      const statusStr = ag.enabled ? '\x1b[32mRUNNING\x1b[0m' : '\x1b[90mSTOPPED\x1b[0m';
      const namePadded = ag.name.padEnd(37, ' ');
      out += `${ag.id.padEnd(11, ' ')} ${namePadded} ${typeStr.padEnd(8, ' ')} ${statusStr.padEnd(18, ' ')} ${ag.description}\n`;
    });

    out += `\n\x1b[90mTotal Registered Kernel Agents: ${agents.length}\x1b[0m\n`;
    return { stdout: out, stderr: '', exitCode: 0 };
  },
};

export const agentStartCommand: Command = {
  name: 'agent-start',
  description: 'Start and enable a Kernel Agent Daemon (e.g. agent-start kagentd)',
  category: 'sys',
  execute: (ctx) => {
    const agentId = ctx.args[0];
    if (!agentId) {
      return { stdout: '', stderr: 'agent-start: error: missing agent ID\nUsage: agent-start <agentId>\n', exitCode: 1 };
    }

    const ok = globalKernelAgentManager.setAgentStatus(agentId, true);
    if (!ok) {
      return { stdout: '', stderr: `agent-start: error: agent '${agentId}' not found\n`, exitCode: 1 };
    }

    return { stdout: `\x1b[32m[agent-start] Kernel Agent Daemon '${agentId}' started successfully.\x1b[0m\n`, stderr: '', exitCode: 0 };
  },
};

export const agentStopCommand: Command = {
  name: 'agent-stop',
  description: 'Stop and disable a Kernel Agent Daemon (e.g. agent-stop capAgentd)',
  category: 'sys',
  execute: (ctx) => {
    const agentId = ctx.args[0];
    if (!agentId) {
      return { stdout: '', stderr: 'agent-stop: error: missing agent ID\nUsage: agent-stop <agentId>\n', exitCode: 1 };
    }

    const ok = globalKernelAgentManager.setAgentStatus(agentId, false);
    if (!ok) {
      return { stdout: '', stderr: `agent-stop: error: agent '${agentId}' not found\n`, exitCode: 1 };
    }

    return { stdout: `\x1b[33m[agent-stop] Kernel Agent Daemon '${agentId}' stopped.\x1b[0m\n`, stderr: '', exitCode: 0 };
  },
};

export const agentTestCommand: Command = {
  name: 'agent-test',
  description: 'Manually trigger an Observe-Infer-Act loop test for a Kernel Agent (e.g. agent-test capAgentd "rm -rf /")',
  category: 'sys',
  execute: async (ctx) => {
    const agentId = ctx.args[0];
    const eventStr = ctx.args.slice(1).join(' ') || 'Segmentation fault in PID 42';

    if (!agentId) {
      return { stdout: '', stderr: 'agent-test: error: missing agent ID\nUsage: agent-test <agentId> [eventPayload]\n', exitCode: 1 };
    }

    const agent = globalKernelAgentManager.getAgent(agentId);
    if (!agent) {
      return { stdout: '', stderr: `agent-test: error: agent '${agentId}' not found\n`, exitCode: 1 };
    }

    let out = `\x1b[1;36m[Kernel Agent Framework: Observe -> Infer -> Act Loop Test]\x1b[0m\n`;
    out += `  Target Agent:  ${agent.name} (${agent.id})\n`;
    out += `  Test Event:    "${eventStr}"\n\n`;

    const obs = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      source: 'syscall' as const,
      event: 'TEST_EVENT',
      payload: { pid: 42, cmd: eventStr },
    };

    out += `\x1b[33m1. Observe Stage:\x1b[0m Querying interest...\n`;
    const interested = await agent.observe(obs);
    out += `   -> Result: ${interested ? '\x1b[32mINTERESTED\x1b[0m' : '\x1b[90mIGNORED\x1b[0m'}\n\n`;

    if (!interested) {
      return { stdout: out + `Agent ignored event. Test finished.\n`, stderr: '', exitCode: 0 };
    }

    out += `\x1b[33m2. Infer Stage:\x1b[0m Calling SYS_INFER reasoning engine...\n`;
    const action = await agent.infer(obs);
    out += `   -> Action Type: \x1b[1;35m${action.actionType}\x1b[0m\n`;
    out += `   -> Reason:      ${action.reason}\n\n`;

    out += `\x1b[33m3. Act Stage:\x1b[0m Executing microkernel action...\n`;
    const actRes = await agent.act(action);
    out += `   -> Execution:   ${actRes ? '\x1b[32mSUCCESS (ALLOWED/HANDLED)\x1b[0m' : '\x1b[31mINTERCEPTED (BLOCKED)\x1b[0m'}\n`;

    return { stdout: out + `\n\x1b[32mObserve-Infer-Act Pipeline Test Completed.\x1b[0m\n`, stderr: '', exitCode: 0 };
  },
};
