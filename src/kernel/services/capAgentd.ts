// Earendel Microkernel AI Intent Security Firewall Daemon (capAgentd, PID 6)
import { AgentAction, AgentObservation, IKernelAgent, globalKernelAgentManager } from '../agentFramework';
import { syscall } from '../syscall';
import { SyscallNo } from '../types';

export class CapAgentDaemon implements IKernelAgent {
  public readonly id = 'capAgentd';
  public readonly name = 'Kernel AI Capability Intent Firewall';
  public readonly description = 'Audits high-risk Syscall & IPC actions (e.g. rm -rf /, chmod 777 /etc/shadow), infers hostile intent, and blocks malicious execution';
  public readonly isDaemon = true;
  public enabled = true;

  constructor() {
    globalKernelAgentManager.registerAgent(this);
  }

  public async observe(obs: AgentObservation): Promise<boolean> {
    // capAgentd audits high-risk syscall, IPC, and VFS modification events
    if (obs.source === 'syscall' || obs.source === 'vfs' || obs.source === 'ipc') {
      const payloadStr = JSON.stringify(obs.payload).toLowerCase();
      return (
        payloadStr.includes('rm ') ||
        payloadStr.includes('chmod') ||
        payloadStr.includes('shadow') ||
        payloadStr.includes('passwd') ||
        payloadStr.includes('/etc/') ||
        payloadStr.includes('kill')
      );
    }
    return false;
  }

  public async infer(obs: AgentObservation): Promise<AgentAction> {
    const payloadStr = JSON.stringify(obs.payload);

    // Fast-path intent heuristics
    if (payloadStr.includes('rm -rf /') || payloadStr.includes('/etc/shadow')) {
      return {
        actionType: 'BLOCK',
        reason: 'CRITICAL SECURITY BREACH: Attempted root filesystem destruction or shadow hash access!',
        targetPid: obs.payload?.pid,
      };
    }

    // AI-driven intent inference
    const prompt = `Security Audit Event (${obs.event}): ${payloadStr}. Is this action hostile or unauthorized? Answer BLOCK or ALLOW.`;
    const inferRes = await syscall(SyscallNo.SYS_INFER, prompt);
    const aiResp = inferRes.data || '';

    const isHostile = aiResp.includes('BLOCK') || aiResp.includes('Audit') || aiResp.includes('Privileges');

    return {
      actionType: isHostile ? 'BLOCK' : 'ALLOW',
      reason: `capAgentd Firewall Intent Audit: ${isHostile ? 'BLOCKED hostile action' : 'ALLOWED safe action'}`,
      targetPid: obs.payload?.pid,
    };
  }

  public async act(action: AgentAction): Promise<boolean> {
    if (action.actionType === 'BLOCK') {
      console.warn(`\x1b[31m[capAgentd AI Firewall Intercept]\x1b[0m ${action.reason}`);
      return false;
    }
    return true;
  }
}

export const globalCapAgentDaemon = new CapAgentDaemon();
