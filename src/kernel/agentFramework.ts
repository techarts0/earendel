// Earendel Microkernel Agent Infrastructure (Observe -> Infer -> Act Loop)

export type ObservationSource = 'dmesg' | 'syscall' | 'ipc' | 'vfs' | 'process' | 'network';

export interface AgentObservation {
  id: string;
  timestamp: string;
  source: ObservationSource;
  event: string;
  payload: any;
}

export type ActionType = 'ALLOW' | 'BLOCK' | 'REPAIR' | 'LOG' | 'NOTIFY' | 'KILL_PROCESS' | 'CUSTOM';

export interface AgentAction {
  actionType: ActionType;
  reason: string;
  targetPid?: number;
  payload?: any;
}

export interface IKernelAgent {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly isDaemon: boolean;
  enabled: boolean;

  /**
   * Observe stage: Kernel feeds system events to agent
   */
  observe(obs: AgentObservation): Promise<boolean>;

  /**
   * Infer stage: Agent reasons via SYS_INFER or rule engine
   */
  infer(obs: AgentObservation): Promise<AgentAction>;

  /**
   * Act stage: Agent executes microkernel action
   */
  act(action: AgentAction): Promise<boolean>;
}

export class KernelAgentManager {
  private agents: Map<string, IKernelAgent> = new Map();
  private observationHistory: AgentObservation[] = [];
  private actionHistory: Array<{ agentId: string; action: AgentAction; timestamp: string }> = [];

  public registerAgent(agent: IKernelAgent) {
    this.agents.set(agent.id, agent);
  }

  public getAgents(): IKernelAgent[] {
    return Array.from(this.agents.values());
  }

  public getAgent(id: string): IKernelAgent | undefined {
    return this.agents.get(id);
  }

  public setAgentStatus(id: string, enabled: boolean): boolean {
    const agent = this.agents.get(id);
    if (!agent) return false;
    agent.enabled = enabled;
    return true;
  }

  /**
   * Main Kernel Event Loop Dispatcher: Drives the Observe -> Infer -> Act pipeline for all enabled agents
   */
  public async dispatchObservation(source: ObservationSource, event: string, payload: any): Promise<AgentAction[]> {
    const obs: AgentObservation = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      source,
      event,
      payload,
    };

    this.observationHistory.push(obs);
    if (this.observationHistory.length > 200) {
      this.observationHistory.shift();
    }

    const executedActions: AgentAction[] = [];

    for (const agent of this.agents.values()) {
      if (!agent.enabled) continue;

      try {
        const interested = await agent.observe(obs);
        if (!interested) continue;

        const action = await agent.infer(obs);
        await agent.act(action);

        executedActions.push(action);
        this.actionHistory.push({
          agentId: agent.id,
          action,
          timestamp: new Date().toISOString(),
        });

        if (this.actionHistory.length > 200) {
          this.actionHistory.shift();
        }
      } catch (err) {
        console.error(`[KernelAgentManager] Error executing agent '${agent.id}':`, err);
      }
    }

    return executedActions;
  }

  public getObservationHistory(): AgentObservation[] {
    return [...this.observationHistory];
  }

  public getActionHistory() {
    return [...this.actionHistory];
  }
}

export const globalKernelAgentManager = new KernelAgentManager();
