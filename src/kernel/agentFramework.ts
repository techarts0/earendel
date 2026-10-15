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
  private pendingObservations: Array<{ source: ObservationSource; event: string; payload: any }> = [];
  private observationDrainScheduled = false;
  private observationDrainActive = false;
  private droppedObservationCount = 0;
  private readonly maxPendingObservations = 256;
  private readonly maxAgentResponseMs = 35_000;

  public registerAgent(agent: IKernelAgent) {
    this.agents.set(agent.id, agent);
  }

  public getAgents(): IKernelAgent[] {
    return Array.from(this.agents.values());
  }

  public getAgent(id: string): IKernelAgent | undefined {
    return this.agents.get(id);
  }

  /**
   * Queue a kernel observation for later-task processing. Kernel callers never
   * run agent code, inference, or payload inspection on their syscall stack.
   */
  public enqueueObservation(source: ObservationSource, event: string, payload: any): void {
    if (this.pendingObservations.length >= this.maxPendingObservations) {
      this.pendingObservations.shift();
      this.droppedObservationCount++;
    }
    this.pendingObservations.push({
      source,
      event: typeof event === 'string' ? event.slice(0, 160) : '[invalid event]',
      payload: this.snapshotPayload(payload),
    });
    this.scheduleObservationDrain();
  }

  private snapshotPayload(payload: any): any {
    const summarize = (value: any): any => {
      if (typeof value === 'string') return value.slice(0, 256);
      if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
      if (Array.isArray(value)) return `[Array(${value.length})]`;
      return `[${typeof value}]`;
    };
    if (payload === null || typeof payload !== 'object') return summarize(payload);
    if (Array.isArray(payload)) return `[Array(${payload.length})]`;
    const snapshot: Record<string, any> = Object.create(null);
    let count = 0;
    try {
      for (const key in payload) {
        if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
        if (count++ >= 16) break;
        try { snapshot[key.slice(0, 80)] = summarize(payload[key]); } catch { snapshot[key.slice(0, 80)] = '[unavailable]'; }
      }
    } catch { return '[unavailable]'; }
    return snapshot;
  }

  public getObservationQueueStats(): { pending: number; dropped: number; draining: boolean } {
    return {
      pending: this.pendingObservations.length,
      dropped: this.droppedObservationCount,
      draining: this.observationDrainActive,
    };
  }

  private scheduleObservationDrain(): void {
    if (this.observationDrainScheduled || this.observationDrainActive) return;
    this.observationDrainScheduled = true;
    setTimeout(() => {
      this.observationDrainScheduled = false;
      void this.drainObservationQueue();
    }, 0);
  }

  private async drainObservationQueue(): Promise<void> {
    if (this.observationDrainActive) return;
    this.observationDrainActive = true;
    try {
      while (this.pendingObservations.length) {
        const observation = this.pendingObservations.shift()!;
        try {
          await this.dispatchObservation(observation.source, observation.event, observation.payload);
        } catch (error) {
          console.error('[KernelAgentManager] Queued observation failed:', error);
        }
      }
    } finally {
      this.observationDrainActive = false;
      if (this.pendingObservations.length) this.scheduleObservationDrain();
    }
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

      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const work = (async (): Promise<AgentAction | undefined> => {
          const interested = await agent.observe(obs);
          if (!interested || timedOut) return undefined;
          const action = await agent.infer(obs);
          if (timedOut) return undefined;
          await agent.act(action);
          if (timedOut) return undefined;
          return action;
        })();
        const deadline = new Promise<undefined>((resolve) => {
          timer = setTimeout(() => {
            timedOut = true;
            agent.enabled = false;
            resolve(undefined);
          }, this.maxAgentResponseMs);
        });
        const action = await Promise.race([work, deadline]);
        if (timer !== undefined) clearTimeout(timer);
        if (!action) {
          if (timedOut) console.warn(`[KernelAgentManager] Disabled unresponsive agent '${agent.id}' after ${this.maxAgentResponseMs}ms.`);
          continue;
        }

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
        if (timer !== undefined) clearTimeout(timer);
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
