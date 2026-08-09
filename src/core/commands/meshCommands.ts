// Earendel P2P Mesh Collaboration Suite Commands (mesh share / mesh join)
import { Command, ExecutionContext, ExecutionResult } from '../types';
import { globalP2PMeshEngine } from '../p2pMeshEngine';

export const meshCommands: Command[] = [
  {
    name: 'mesh',
    description: 'Earendel P2P Mesh Collaboration Suite for instant sandbox sharing & joining',
    category: 'sys',
    execute: async (ctx) => {
      const sub = ctx.args[0] || 'help';

      // 1. mesh share (Host Mode: Start P2P sandbox sharing)
      if (sub === 'share' || sub === 'start') {
        const shareRes = await globalP2PMeshEngine.startMeshShare();
        const output = [
          `\x1b[1;36m[Mesh] Session active. Share this Peer ID with your classmate:\x1b[0m`,
          `\x1b[1;33m${shareRes.peerId}\x1b[0m`,
          ``,
          `On classmate's machine, run:`,
          `\x1b[32mmesh join ${shareRes.peerId}\x1b[0m`,
        ].join('\n') + '\n';

        return { stdout: output, stderr: '', exitCode: 0 };
      }

      // 2. mesh join <peer-id> (Guest Mode: Connect into host's sandbox)
      if (sub === 'join' || sub === 'connect') {
        const targetPeerId = ctx.args[1];
        if (!targetPeerId) {
          return {
            stdout: '',
            stderr: `mesh join: missing Peer ID\nUsage: mesh join peer-earendel-XXXX-2026\n`,
            exitCode: 1,
          };
        }

        // Verify if remote Peer ID is active and online
        const isOnline = await globalP2PMeshEngine.verifyPeerOnline(targetPeerId);
        if (!isOnline) {
          return {
            stdout: '',
            stderr: `mesh: Peer ID '\x1b[33m${targetPeerId}\x1b[0m' not found or offline.\nPlease ensure Host has started sharing via 'mesh share'.\n`,
            exitCode: 1,
          };
        }

        const joinRes = await globalP2PMeshEngine.joinMeshPeer(targetPeerId);

        const shortPeer = targetPeerId.startsWith('peer-earendel-')
          ? targetPeerId.replace('peer-earendel-', 'peer-').substring(0, 15)
          : targetPeerId.substring(0, 12);

        const output = [
          `[Mesh] Connecting via WebRTC DataChannel to \x1b[1;36m${targetPeerId}\x1b[0m ... Connected!`,
          `[Mesh] Synchronizing VFS state... Done.`,
          `\x1b[1;32m[hello@earendel-${shortPeer}:~$]\x1b[0m Session attached. Type 'exit' or 'mesh stop' to disconnect.`,
        ].join('\n') + '\n';

        return { stdout: output, stderr: '', exitCode: 0 };
      }

      // 3. mesh status (View active mesh session)
      if (sub === 'status' || sub === 'info') {
        const activePeerId = globalP2PMeshEngine.getCurrentSharePeerId();
        if (activePeerId) {
          return {
            stdout: `[Mesh Status] Active Host Session: \x1b[1;33m${activePeerId}\x1b[0m\nMode: WebRTC P2P DataChannel Waiting Room\n`,
            stderr: '',
            exitCode: 0,
          };
        }
        return {
          stdout: `[Mesh Status] No active mesh sharing session. Type 'mesh share' to host.\n`,
          stderr: '',
          exitCode: 0,
        };
      }

      // 4. mesh stop / disconnect / unshare (Terminate active session)
      if (sub === 'stop' || sub === 'unshare' || sub === 'close' || sub === 'disconnect') {
        const joinedId = globalP2PMeshEngine.getActiveJoinedPeerId();
        if (joinedId) {
          globalP2PMeshEngine.disconnectMeshJoin();
          return { stdout: `Connection to \x1b[1;36m${joinedId}\x1b[0m closed.\n`, stderr: '', exitCode: 0 };
        }

        const ok = globalP2PMeshEngine.stopMeshShare();
        if (ok) {
          return { stdout: `[Mesh] Session closed and sharing unshared successfully.\n`, stderr: '', exitCode: 0 };
        }
        return { stdout: `[Mesh] No active session to stop.\n`, stderr: '', exitCode: 0 };
      }

      // Usage Help
      const usage = [
        `\x1b[1;36mEarendel P2P Mesh Collaboration Suite\x1b[0m`,
        `Usage: mesh <command> [args]`,
        ``,
        `Commands:`,
        `  mesh share               Host a new P2P sandbox session and get Peer ID`,
        `  mesh join <Peer-ID>      Join classmate's Earendel sandbox session`,
        `  mesh status              View active mesh session status`,
        `  mesh stop                Stop hosting and unshare active mesh session`,
      ].join('\n') + '\n';

      return { stdout: usage, stderr: '', exitCode: 0 };
    },
  },
];
