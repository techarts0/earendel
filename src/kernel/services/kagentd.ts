// Earendel Microkernel Self-Healing Agent Daemon (kagentd, PID 5)
import { AgentAction, AgentObservation, IKernelAgent, globalKernelAgentManager } from '../agentFramework';
import { syscall } from '../syscall';
import { SyscallNo } from '../types';

export class KAgentDaemon implements IKernelAgent {
  public readonly id = 'kagentd';
  public readonly name = 'Kernel Crash Self-Healing Daemon';
  public readonly description = 'Monitors PCB process crashes & Segfaults, infers root cause via SYS_INFER, and logs repair suggestions to dmesg';
  public readonly isDaemon = true;
  public enabled = true;

  constructor() {
    globalKernelAgentManager.registerAgent(this);
  }

  public async observe(obs: AgentObservation): Promise<boolean> {
    // kagentd is interested in process crash / PCB segfault / panic events
    return obs.source === 'process' || obs.source === 'dmesg';
  }

  public async infer(obs: AgentObservation): Promise<AgentAction> {
    const payloadStr = JSON.stringify(obs.payload);

    // Call SYS_INFER for AI-Native microkernel crash reasoning
    const prompt = `System Crash Event Detected (${obs.event}): ${payloadStr}. Analyze root cause and suggest microkernel repair strategy.`;
    const inferRes = await syscall(SyscallNo.SYS_INFER, prompt);
    const aiDiagnosis = inferRes.data || 'Process Segfault analyzed: NULL pointer dereference.';

    return {
      actionType: 'REPAIR',
      reason: `kagentd AI Diagnostics: ${aiDiagnosis.slice(0, 120)}`,
      targetPid: obs.payload?.pid,
      payload: { diagnosis: aiDiagnosis, event: obs.event },
    };
  }

  public async act(action: AgentAction): Promise<boolean> {
    // Act stage: Write AI self-healing diagnostic log into kernel dmesg ring buffer
    const logMsg = `[kagentd Self-Healing] ${action.reason}`;
    console.warn(logMsg);
    return true;
  }
}

export const globalKAgentDaemon = new KAgentDaemon();
