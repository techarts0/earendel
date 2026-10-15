// Earendel Microkernel Agent Infrastructure (Observe -> Infer -> Act Loop)

export type ObservationSource = 'dmesg' | 'syscall' | 'ipc' | 'vfs' | 'process' | 'network';
const OBSERVATION_SOURCES = new Set<ObservationSource>(['dmesg', 'syscall', 'ipc', 'vfs', 'process', 'network']);

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
  observe(obs: AgentObservation, signal?: AbortSignal): Promise<boolean>;

  /**
   * Infer stage: Agent reasons via SYS_INFER or rule engine
   */
  infer(obs: AgentObservation, signal?: AbortSignal): Promise<AgentAction>;

  /**
   * Act stage: Agent executes microkernel action
   */
  act(action: AgentAction, signal?: AbortSignal): Promise<boolean>;
}

export type AgentTestResult =
  | { status: 'completed'; interested: false }
  | { status: 'completed'; interested: true; action: AgentAction; acted: boolean }
  | { status: 'busy' }
  | { status: 'not-found' }
  | { status: 'timed-out' }
  | { status: 'aborted' }
  | { status: 'failed'; error?: string };

export interface AgentActionHistoryEntry {
  agentId: string;
  action: AgentAction;
  acted: boolean;
  timestamp: string;
}

export class KernelAgentManager {
  private agents: Map<string, IKernelAgent> = new Map();
  private agentGenerations = new Map<string, number>();
  private activeAgentRuns = new Map<string, symbol>();
  private activeAgentControllers = new Map<string, { runToken: symbol; controller: AbortController }>();
  private observationHistory: AgentObservation[] = [];
  private actionHistory: AgentActionHistoryEntry[] = [];
  private pendingObservations: Array<{ source: ObservationSource; event: string; payload: any }> = [];
  private observationDrainScheduled = false;
  private observationDrainActive = false;
  private droppedObservationCount = 0;
  private readonly maxPendingObservations = 256;
  private readonly maxRegisteredAgents = 32;
  private readonly maxAgentResponseMs = 35_000;

  public registerAgent(agent: IKernelAgent) {
    if (!this.agents.has(agent.id) && this.agents.size >= this.maxRegisteredAgents) {
      console.warn(`[KernelAgentManager] Agent registration limit (${this.maxRegisteredAgents}) reached; rejected '${agent.id}'.`);
      return;
    }
    if (this.agents.has(agent.id) && this.agents.get(agent.id) !== agent) {
      this.activeAgentControllers.get(agent.id)?.controller.abort(new Error('Agent instance was replaced'));
    }
    this.agents.set(agent.id, agent);
    this.advanceAgentGeneration(agent.id);
  }

  private advanceAgentGeneration(id: string): number {
    const next = (this.agentGenerations.get(id) || 0) + 1;
    this.agentGenerations.set(id, next);
    return next;
  }

  public getAgents(): IKernelAgent[] {
    return Array.from(this.agents.values());
  }

  public getAgent(id: string): IKernelAgent | undefined {
    return this.agents.get(id);
  }

  public getAgentResponseDeadlineMs(): number {
    return this.maxAgentResponseMs;
  }

  /** Run one explicitly requested diagnostic through the same per-Agent lock and cancellation policy. */
  public async runAgentTest(agentId: string, observation: AgentObservation, signal?: AbortSignal): Promise<AgentTestResult> {
    const agent = this.agents.get(agentId);
    if (!agent) return { status: 'not-found' };
    if (this.activeAgentRuns.has(agentId)) return { status: 'busy' };

    const runToken = Symbol(agentId);
    const controller = new AbortController();
    this.activeAgentRuns.set(agentId, runToken);
    this.activeAgentControllers.set(agentId, { runToken, controller });
    const generation = this.agentGenerations.get(agentId) || 0;
    const isCurrentRun = () => this.agents.get(agentId) === agent &&
      this.agentGenerations.get(agentId) === generation && !controller.signal.aborted;
    let timedOut = false;
    let workSettled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => controller.abort(signal?.reason || new Error('Agent test aborted'));
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });

    const releaseRun = () => {
      workSettled = true;
      if ((timedOut || controller.signal.aborted) && this.activeAgentRuns.get(agentId) === runToken) {
        this.activeAgentRuns.delete(agentId);
        if (this.activeAgentControllers.get(agentId)?.runToken === runToken) this.activeAgentControllers.delete(agentId);
      }
    };
    const work = (async (): Promise<AgentTestResult> => {
      if (!isCurrentRun()) return { status: 'aborted' };
      const interested = await agent.observe(observation, controller.signal);
      if (!isCurrentRun()) return { status: 'aborted' };
      if (!interested) return { status: 'completed', interested: false };
      const action = await agent.infer(observation, controller.signal);
      if (!isCurrentRun()) return { status: 'aborted' };
      const acted = await agent.act(action, controller.signal);
      if (!isCurrentRun()) return { status: 'aborted' };
      return { status: 'completed', interested: true, action, acted };
    })();
    void work.then(releaseRun, releaseRun);

    const deadline = new Promise<AgentTestResult>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        resolve({ status: 'timed-out' });
        controller.abort(new Error(`Agent test exceeded ${this.maxAgentResponseMs}ms.`));
      }, this.maxAgentResponseMs);
    });
    const aborted = new Promise<AgentTestResult>((resolve) => {
      if (controller.signal.aborted) resolve({ status: 'aborted' });
      else controller.signal.addEventListener('abort', () => resolve({ status: 'aborted' }), { once: true });
    });
    try {
      return await Promise.race([work, deadline, aborted]);
    } catch (error) {
      return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (workSettled && this.activeAgentRuns.get(agentId) === runToken) {
        this.activeAgentRuns.delete(agentId);
        if (this.activeAgentControllers.get(agentId)?.runToken === runToken) this.activeAgentControllers.delete(agentId);
      }
    }
  }

  /**
   * Queue a kernel observation for later-task processing. Kernel callers never
   * run agent code, inference, or payload inspection on their syscall stack.
   */
  public enqueueObservation(source: ObservationSource, event: string, payload: any): void {
    if (!OBSERVATION_SOURCES.has(source)) return;
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
    if (typeof payload === 'string') return payload.slice(0, 2_048);
    if (payload === null || ['number', 'boolean', 'undefined'].includes(typeof payload)) return payload;
    // Do not enumerate or stringify arbitrary objects on a syscall stack:
    // getters and Proxy traps are executable and can block the kernel thread.
    // Kernel producers that need diagnostic detail must supply a bounded string.
    return '[object payload omitted]';
  }

  public getObservationQueueStats(): { pending: number; dropped: number; draining: boolean } {
    return {
      pending: this.pendingObservations.length,
      dropped: this.droppedObservationCount,
      draining: this.observationDrainActive || this.activeAgentRuns.size > 0,
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
        // Dispatch starts every eligible Agent up to its first await, then the
        // queue advances without waiting for inference/act. Per-Agent run locks
        // and the registry limit bound outstanding work independently.
        void this.dispatchObservation(observation.source, observation.event, observation.payload)
          .catch((error) => console.error('[KernelAgentManager] Queued observation failed:', error));
        // Give already-resolved observe() stages a full event-loop turn to
        // release non-interested Agents before starting the next observation.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      this.observationDrainActive = false;
      if (this.pendingObservations.length) this.scheduleObservationDrain();
    }
  }

  public setAgentStatus(id: string, enabled: boolean): boolean {
    const agent = this.agents.get(id);
    if (!agent) return false;
    if (agent.enabled !== enabled) this.advanceAgentGeneration(id);
    agent.enabled = enabled;
    if (!enabled) this.activeAgentControllers.get(id)?.controller.abort(new Error('Agent was stopped'));
    return true;
  }

  /**
   * Main Kernel Event Loop Dispatcher: Drives the Observe -> Infer -> Act pipeline for all enabled agents
   */
  public async dispatchObservation(source: ObservationSource, event: string, payload: any): Promise<AgentAction[]> {
    // Keep the public dispatcher safe even when called outside the bounded
    // kernel queue. Direct callers must not retain arbitrary object graphs or
    // make Agent code inspect getters/Proxy traps from user controlled data.
    if (!OBSERVATION_SOURCES.has(source)) return [];
    const obs: AgentObservation = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      source,
      event: typeof event === 'string' ? event.slice(0, 160) : '[invalid event]',
      payload: this.snapshotPayload(payload),
    };

    this.observationHistory.push(obs);
    if (this.observationHistory.length > 200) {
      this.observationHistory.shift();
    }

    const agentRuns = [...this.agents.values()].map(async (agent): Promise<{ agentId: string; action: AgentAction; acted: boolean } | undefined> => {
      if (!agent.enabled || this.activeAgentRuns.has(agent.id)) return undefined;
      const runToken = Symbol(agent.id);
      this.activeAgentRuns.set(agent.id, runToken);
      const controller = new AbortController();
      this.activeAgentControllers.set(agent.id, { runToken, controller });
      const generation = this.agentGenerations.get(agent.id) || 0;
      const isCurrentRun = () => this.agents.get(agent.id) === agent &&
        agent.enabled && !controller.signal.aborted && this.agentGenerations.get(agent.id) === generation;

      let timedOut = false;
      let workSettled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const work = (async (): Promise<{ action: AgentAction; acted: boolean } | undefined> => {
          const interested = await agent.observe(obs, controller.signal);
          if (!interested || timedOut || !isCurrentRun()) return undefined;
          const action = await agent.infer(obs, controller.signal);
          if (timedOut || !isCurrentRun()) return undefined;
          const acted = await agent.act(action, controller.signal);
          if (timedOut || !isCurrentRun()) return undefined;
          return { action, acted };
        })();
        const releaseSettledRun = () => {
          workSettled = true;
          if ((timedOut || controller.signal.aborted) && this.activeAgentRuns.get(agent.id) === runToken) {
            this.activeAgentRuns.delete(agent.id);
            if (this.activeAgentControllers.get(agent.id)?.runToken === runToken) this.activeAgentControllers.delete(agent.id);
          }
        };
        // A timeout stops waiting for this work, but cannot cancel an arbitrary
        // Agent promise. Keep its per-Agent slot occupied until it really settles
        // so retries/re-registration cannot accumulate detached work without bound.
        void work.then(releaseSettledRun, releaseSettledRun);
        const deadline = new Promise<undefined>((resolve) => {
          timer = setTimeout(() => {
            timedOut = true;
            // An older run may time out after the Agent was stopped and then
            // explicitly re-enabled. Only the still-current generation owns
            // the authority to disable itself.
            if (isCurrentRun()) {
              agent.enabled = false;
              this.advanceAgentGeneration(agent.id);
            }
            controller.abort(new Error(`Agent exceeded ${this.maxAgentResponseMs}ms.`));
            resolve(undefined);
          }, this.maxAgentResponseMs);
        });
        const aborted = new Promise<undefined>((resolve) => {
          if (controller.signal.aborted) resolve(undefined);
          else controller.signal.addEventListener('abort', () => resolve(undefined), { once: true });
        });
        const result = await Promise.race([work, deadline, aborted]);
        if (!result) {
          if (timedOut) console.warn(`[KernelAgentManager] Disabled unresponsive agent '${agent.id}' after ${this.maxAgentResponseMs}ms.`);
          return undefined;
        }
        return { agentId: agent.id, ...result };
      } catch (err) {
        console.error(`[KernelAgentManager] Error executing agent '${agent.id}':`, err);
        return undefined;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        if (workSettled && this.activeAgentRuns.get(agent.id) === runToken) {
          this.activeAgentRuns.delete(agent.id);
          if (this.activeAgentControllers.get(agent.id)?.runToken === runToken) this.activeAgentControllers.delete(agent.id);
        }
      }
    });
    const results = await Promise.all(agentRuns);
    const executedActions: AgentAction[] = [];
    for (const result of results) {
      if (!result) continue;
      executedActions.push(result.action);
      this.actionHistory.push({ agentId: result.agentId, action: result.action, acted: result.acted, timestamp: new Date().toISOString() });
      if (this.actionHistory.length > 200) this.actionHistory.shift();
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
