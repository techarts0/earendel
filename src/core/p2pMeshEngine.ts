// Earendel P2P WebRTC Mesh Stream Engine
import { globalVFS } from './vfs';

export interface P2PPeerSession {
  peerId: string;
  connection: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  status: 'connecting' | 'connected' | 'closed';
  role: 'host' | 'guest';
}

export class P2PMeshEngine {
  private activeSessions: Map<string, P2PPeerSession> = new Map();
  private currentSharePeerId: string | null = null;
  private currentShareSession: P2PPeerSession | null = null;
  private activeJoinedPeerId: string | null = null;
  private iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];

  public getActiveJoinedPeerId(): string | null {
    return this.activeJoinedPeerId;
  }

  public disconnectMeshJoin(): boolean {
    if (!this.activeJoinedPeerId) return false;
    const session = this.activeSessions.get(this.activeJoinedPeerId);
    if (session) {
      try {
        session.connection.close();
      } catch (e) {}
      this.activeSessions.delete(this.activeJoinedPeerId);
    }
    this.activeJoinedPeerId = null;
    return true;
  }

  /**
   * Generates human-friendly ephemeral Peer ID format: peer-earendel-XXXX-2026
   */
  public generateEphemeralPeerId(): string {
    const randTag = Math.random().toString(36).substring(2, 6);
    return `peer-earendel-${randTag}-2026`;
  }

  private instanceId: string = `node_${Math.random().toString(36).substring(2, 9)}`;
  private bc: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('earendel_p2p_mesh') : null;

  constructor() {
    if (this.bc) {
      this.bc.addEventListener('message', async (event: MessageEvent) => {
        const data = event.data;
        if (!data || typeof data !== 'object') return;

        // Ignore self-posted BroadcastChannel messages
        if (data.senderId === this.instanceId) return;

        // Host responds to ping discovery requests
        if (data.type === 'p2p_ping' && data.peerId === this.currentSharePeerId) {
          this.bc?.postMessage({
            type: 'p2p_pong',
            reqId: data.reqId,
            peerId: data.peerId,
            senderId: this.instanceId,
          });
          return;
        }

        // Host listens for remote command execution requests from other instances
        if (data.type === 'p2p_cmd_req' && data.peerId === this.currentSharePeerId) {
          const { globalShellEngine } = await import('./shellEngine');
          const res = await globalShellEngine.execute(data.command);
          this.bc?.postMessage({
            type: 'p2p_cmd_res',
            reqId: data.reqId,
            peerId: data.peerId,
            senderId: this.instanceId,
            stdout: res.stdout,
            stderr: res.stderr,
            exitCode: res.exitCode,
          });
        }
      });
    }
  }

  /**
   * Verifies if a remote Peer ID is active and online
   */
  public async verifyPeerOnline(peerId: string): Promise<boolean> {
    if (peerId === this.currentSharePeerId && this.currentSharePeerId !== null) return true;
    if (!this.bc) return true;

    const reqId = `ping_${Math.random().toString(36).substring(2, 9)}`;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.bc?.removeEventListener('message', handler);
        resolve(false);
      }, 800);

      const handler = (event: MessageEvent) => {
        const data = event.data;
        if (data && data.type === 'p2p_pong' && data.reqId === reqId) {
          clearTimeout(timer);
          this.bc?.removeEventListener('message', handler);
          resolve(true);
        }
      };

      this.bc?.addEventListener('message', handler);
      this.bc?.postMessage({ type: 'p2p_ping', reqId, peerId, senderId: this.instanceId });
    });
  }

  /**
   * Executes a command on the target Host machine context
   */
  public async executeOnHost(peerId: string, cmdStr: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const { globalShellEngine } = await import('./shellEngine');

    if (peerId === this.currentSharePeerId || !peerId) {
      return await globalShellEngine.execute(cmdStr);
    }

    return new Promise((resolve) => {
      let isResolved = false;

      const safeResolve = (res: { stdout: string; stderr: string; exitCode: number }) => {
        if (!isResolved) {
          isResolved = true;
          resolve(res);
        }
      };

      // 4000ms safety timeout for remote P2P execution
      const timer = setTimeout(() => {
        safeResolve({ stdout: '', stderr: `mesh: Connection to host '${peerId}' timed out.\n`, exitCode: 1 });
      }, 4000);

      // 1. WebRTC DataChannel (for remote networks)
      const session = this.activeSessions.get(peerId);
      if (session && session.dataChannel && session.dataChannel.readyState === 'open') {
        const messageHandler = (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'remote_cmd_res') {
              clearTimeout(timer);
              session.dataChannel?.removeEventListener('message', messageHandler);
              safeResolve({ stdout: data.stdout || '', stderr: data.stderr || '', exitCode: data.exitCode || 0 });
            }
          } catch (e) {}
        };
        session.dataChannel.addEventListener('message', messageHandler);
        session.dataChannel.send(JSON.stringify({ type: 'remote_cmd_req', command: cmdStr }));
        return;
      }

      // 2. BroadcastChannel (for cross-tab P2P execution)
      if (this.bc) {
        const reqId = `req_${Math.random().toString(36).substring(2, 9)}`;
        const handler = (event: MessageEvent) => {
          const data = event.data;
          if (data && data.type === 'p2p_cmd_res' && data.reqId === reqId && data.senderId !== this.instanceId) {
            clearTimeout(timer);
            this.bc?.removeEventListener('message', handler);
            safeResolve({ stdout: data.stdout || '', stderr: data.stderr || '', exitCode: data.exitCode || 0 });
          }
        };

        this.bc.addEventListener('message', handler);
        this.bc.postMessage({ type: 'p2p_cmd_req', reqId, peerId, senderId: this.instanceId, command: cmdStr });
        return;
      }

      clearTimeout(timer);
      globalShellEngine.execute(cmdStr).then(safeResolve);
    });
  }

  // Starts a new Mesh Share session (host mode)
  public async startMeshShare(): Promise<{ peerId: string; offerSdp: string }> {
    if (!this.hostVFSMap) {
      this.hostVFSMap = new Map();
    }

    const peerId = this.generateEphemeralPeerId();
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const dc = pc.createDataChannel('earendel_mesh_stream');

    // Snapshot host VFS tree for P2P shared isolation
    try {
      this.hostVFSMap.set(peerId, globalVFS.exportFileSystemTree());
    } catch (e) {}

    const session: P2PPeerSession = {
      peerId,
      connection: pc,
      dataChannel: dc,
      status: 'connecting',
      role: 'host',
    };

    this.activeSessions.set(peerId, session);
    this.currentSharePeerId = peerId;
    this.currentShareSession = session;

    return new Promise((resolve) => {
      pc.onicecandidate = (event) => {
        if (!event.candidate) {
          const offerSdp = btoa(JSON.stringify(pc.localDescription));
          resolve({ peerId, offerSdp });
        }
      };

      pc.createOffer().then((offer) => pc.setLocalDescription(offer));
    });
  }

  /**
   * Gets current active Mesh share Peer ID
   */
  public getCurrentSharePeerId(): string | null {
    return this.currentSharePeerId;
  }

  /**
   * Stops current Mesh share session
   */
  public stopMeshShare(): boolean {
    if (!this.currentShareSession) return false;
    try {
      this.currentShareSession.connection.close();
    } catch (e) {}
    this.activeSessions.delete(this.currentShareSession.peerId);
    this.currentSharePeerId = null;
    this.currentShareSession = null;
    return true;
  }

  /**
   * Joins a Mesh Share session (guest mode) using Peer ID or SDP Offer
   */
  public async joinMeshPeer(peerIdOrSdp: string): Promise<{ answerSdp: string; peerId: string }> {
    let offerObj: any;
    try {
      offerObj = JSON.parse(atob(peerIdOrSdp));
    } catch (e) {
      // Ephemeral Peer ID simulation mode
      offerObj = { type: 'offer', sdp: `v=0\r\no=- ${Date.now()} 2 IN IP4 127.0.0.1\r\ns=earendel_mesh\r\nt=0 0\r\n` };
    }

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peerId = peerIdOrSdp.startsWith('peer-earendel-') ? peerIdOrSdp : this.generateEphemeralPeerId();

    const session: P2PPeerSession = {
      peerId,
      connection: pc,
      dataChannel: null,
      status: 'connecting',
      role: 'guest',
    };

    this.activeSessions.set(peerId, session);

    pc.ondatachannel = (event) => {
      session.dataChannel = event.channel;
      this.setupDataChannelHandlers(session);
    };

    try {
      await pc.setRemoteDescription(offerObj);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
    } catch (e) {}

    this.activeJoinedPeerId = peerId;

    return new Promise((resolve) => {
      pc.onicecandidate = (event) => {
        if (!event.candidate) {
          const answerSdp = btoa(JSON.stringify(pc.localDescription || { type: 'answer', sdp: 'earendel_ans' }));
          resolve({ answerSdp, peerId });
        }
      };
      // Fallback resolve
      setTimeout(() => {
        const answerSdp = btoa(JSON.stringify(pc.localDescription || { type: 'answer', sdp: 'earendel_ans' }));
        resolve({ answerSdp, peerId });
      }, 500);
    });
  }

  /**
   * Legacy SDP Offer creation
   */
  public async createSdpOffer(): Promise<{ offerSdp: string; peerSession: P2PPeerSession }> {
    const res = await this.startMeshShare();
    return { offerSdp: res.offerSdp, peerSession: this.currentShareSession! };
  }

  /**
   * Legacy SDP Answer acceptance
   */
  public async acceptSdpOffer(offerSdpB64: string): Promise<{ answerSdp: string; peerSession: P2PPeerSession }> {
    const res = await this.joinMeshPeer(offerSdpB64);
    const session = this.activeSessions.get(res.peerId)!;
    return { answerSdp: res.answerSdp, peerSession: session };
  }

  /**
   * DataChannel Handlers to link remote stdin/stdout
   */
  private setupDataChannelHandlers(session: P2PPeerSession) {
    if (!session.dataChannel) return;

    session.dataChannel.onopen = () => {
      session.status = 'connected';
    };

    session.dataChannel.onclose = () => {
      session.status = 'closed';
    };

    session.dataChannel.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'remote_cmd_req') {
          const { globalShellEngine } = await import('./shellEngine');
          const res = await globalShellEngine.execute(data.command);
          session.dataChannel?.send(
            JSON.stringify({
              type: 'remote_cmd_res',
              stdout: res.stdout,
              stderr: res.stderr,
              exitCode: res.exitCode,
            })
          );
        }
      } catch (e) {}
    };
  }

  /**
   * Returns current Machine UUID from /etc/vfs_config
   */
  public getMachineUUID(): string {
    const configStr = globalVFS.readFile('/etc/vfs_config') || '{}';
    try {
      const cfg = JSON.parse(configStr);
      if (cfg.machineId) return cfg.machineId;
    } catch (e) {}

    const newId = `usr_${Math.random().toString(36).substring(2, 10)}`;
    globalVFS.writeFile('/etc/vfs_config', JSON.stringify({ machineId: newId }, null, 2));
    return newId;
  }
}

export const globalP2PMeshEngine = new P2PMeshEngine();
