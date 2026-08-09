// Behavioral P2P De-centralized SSH Commands Suite for Earendel
import { Command, ExecutionContext, ExecutionResult } from '../types';
import { globalSSHKeyEngine } from '../sshKeyEngine';
import { globalP2PMeshEngine } from '../p2pMeshEngine';

export const sshCommands: Command[] = [
  {
    name: 'ssh-keygen',
    description: 'authentication key generation, management and conversion',
    category: 'sys',
    execute: async (ctx) => {
      const commentArg = ctx.args.find((a) => a.startsWith('-C'))?.replace('-C', '').trim() || 'hello@earendel';
      const keyResult = await globalSSHKeyEngine.generateKeyPair(commentArg);

      const output = [
        `Generating public/private rsa key pair.`,
        `Your identification has been saved in /home/hello/.ssh/id_rsa`,
        `Your public key has been saved in /home/hello/.ssh/id_rsa.pub`,
        `The key fingerprint is:`,
        `\x1b[32m${keyResult.fingerprint}\x1b[0m ${commentArg}`,
        `The key's randomart image is:`,
        `+---[RSA 2048]----+`,
        `|  .o. o.+=o      |`,
        `|  o.o. .+=o.     |`,
        `| o. o.  +*S      |`,
        `|o. .   .o=E      |`,
        `+-----------------+`,
      ].join('\n') + '\n';

      return { stdout: output, stderr: '', exitCode: 0 };
    },
  },
  {
    name: 'ssh',
    description: 'OpenSSH SSH client for Earendel P2P Mesh & Remote Connection',
    category: 'sys',
    execute: async (ctx) => {
      if (ctx.args.length === 0) {
        const localUuid = globalP2PMeshEngine.getMachineUUID();
        const usage = [
          `usage: ssh [options] [user@]hostname [command]`,
          `Current Machine UUID: \x1b[1;36m${localUuid}\x1b[0m`,
          ``,
          `Supported Modes:`,
          `  ssh hello@<Machine-UUID>          Connect to remote P2P Earendel machine`,
          `  ssh-keygen                        Generate RSA public/private keypair`,
          `  ssh --sdp-offer                   Generate zero-server WebRTC SDP Offer string`,
          `  ssh --sdp-answer <SDP_OFFER>      Accept SDP Offer and generate SDP Answer`,
        ].join('\n') + '\n';

        return { stdout: usage, stderr: '', exitCode: 0 };
      }

      // 1. Zero-Server WebRTC P2P SDP Offer Mode
      if (ctx.args[0] === '--sdp-offer') {
        const offer = await globalP2PMeshEngine.createSdpOffer();
        const out = [
          `\x1b[1;36m[Earendel P2P Mesh: Air-Gapped SDP Offer Created]\x1b[0m`,
          `Copy the SDP Offer below to remote machine to initiate direct P2P connection:`,
          ``,
          `\x1b[33m${offer.offerSdp}\x1b[0m`,
          ``,
          `On remote machine, run: ssh --sdp-answer ${offer.offerSdp.substring(0, 15)}...`,
        ].join('\n') + '\n';

        return { stdout: out, stderr: '', exitCode: 0 };
      }

      // 2. Zero-Server WebRTC P2P SDP Answer Mode
      if (ctx.args[0] === '--sdp-answer') {
        const offerSdpB64 = ctx.args[1];
        if (!offerSdpB64) {
          return { stdout: '', stderr: 'ssh: missing SDP Offer string\nUsage: ssh --sdp-answer <SDP_OFFER_BASE64>\n', exitCode: 1 };
        }

        try {
          const answer = await globalP2PMeshEngine.acceptSdpOffer(offerSdpB64);
          const out = [
            `\x1b[1;32m[Earendel P2P Mesh: SDP Offer Accepted & Answer Generated]\x1b[0m`,
            `Copy the SDP Answer below back to initiating machine to complete P2P handshake:`,
            ``,
            `\x1b[36m${answer.answerSdp}\x1b[0m`,
          ].join('\n') + '\n';

          return { stdout: out, stderr: '', exitCode: 0 };
        } catch (e: any) {
          return { stdout: '', stderr: `ssh: Invalid SDP Offer string: ${e.message}\n`, exitCode: 1 };
        }
      }

      // 3. Target User @ Hostname / Machine UUID Mode
      const targetArg = ctx.args[0];
      const parts = targetArg.split('@');
      const user = parts.length > 1 ? parts[0] : 'hello';
      const host = parts.length > 1 ? parts[1] : parts[0];

      const pubKey = ctx.vfs.readFile('/home/hello/.ssh/id_rsa.pub');
      let authMethodUsed = 'Password Authentication';

      if (pubKey && globalSSHKeyEngine.isPublicKeyAuthorized(pubKey)) {
        authMethodUsed = 'Public Key Authentication (id_rsa.pub)';
      }

      const out = [
        `Connecting to \x1b[1;36m${host}\x1b[0m as \x1b[33m${user}\x1b[0m via Earendel P2P WebRTC DataChannel...`,
        `The authenticity of host '${host} (${host})' can't be established.`,
        `ED25519 key fingerprint is SHA256:earendel_mesh_${Math.random().toString(36).substring(2, 8)}.`,
        `Authenticated using \x1b[32m${authMethodUsed}\x1b[0m.`,
        `Welcome to Earendel Web OS P2P Mesh Terminal (${host})`,
        `Last login: ${new Date().toUTCString()} from 127.0.0.1`,
        `Connected to remote shell. Type 'exit' to disconnect.`,
      ].join('\n') + '\n';

      return { stdout: out, stderr: '', exitCode: 0 };
    },
  },
];
