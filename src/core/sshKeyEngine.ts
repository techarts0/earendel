// Earendel SSH Key & Authentication Infrastructure Engine
import { globalVFS } from './vfs';

export interface SSHKeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
  fingerprint: string;
}

export class SSHKeyEngine {
  /**
   * Generates RSA 2048-bit SSH Key Pair using Web Crypto API
   */
  public async generateKeyPair(comment: string = 'hello@earendel'): Promise<SSHKeyPair> {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    );

    const pubExported = await crypto.subtle.exportKey('spki', keyPair.publicKey);
    const privExported = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

    const pubB64 = this.arrayBufferToBase64(pubExported);
    const privB64 = this.arrayBufferToBase64(privExported);

    const publicKeyPem = `ssh-rsa ${pubB64} ${comment}`;
    const privateKeyPem = `-----BEGIN RSA PRIVATE KEY-----\n${this.formatPemBody(privB64)}\n-----END RSA PRIVATE KEY-----`;

    const fingerprint = await this.calculateFingerprint(pubExported);

    // Save physical keys to /home/hello/.ssh/
    globalVFS.mkdir('/home/hello/.ssh', true);
    globalVFS.chmod('/home/hello/.ssh', 'rwx------');
    globalVFS.writeFile('/home/hello/.ssh/id_rsa', privateKeyPem);
    globalVFS.chmod('/home/hello/.ssh/id_rsa', 'rw-------');
    globalVFS.writeFile('/home/hello/.ssh/id_rsa.pub', publicKeyPem);
    globalVFS.chmod('/home/hello/.ssh/id_rsa.pub', 'rw-r--r--');

    return { publicKeyPem, privateKeyPem, fingerprint };
  }

  /**
   * Helper to format Base64 string into 64-char PEM lines
   */
  private formatPemBody(b64: string): string {
    const lines = [];
    for (let i = 0; i < b64.length; i += 64) {
      lines.push(b64.substring(i, i + 64));
    }
    return lines.join('\n');
  }

  /**
   * Base64 conversion helper
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Calculate SHA256 Fingerprint for SSH Key
   */
  private async calculateFingerprint(buffer: ArrayBuffer): Promise<string> {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
      const digest = await crypto.subtle.digest('SHA-256', buffer);
      const b64 = this.arrayBufferToBase64(digest).replace(/=/g, '');
      return `SHA256:${b64}`;
    }
    return `SHA256:EARENDEL_LOCAL_KEY_FINGERPRINT`;
  }

  /**
   * Validates if a public key exists in remote target's ~/.ssh/authorized_keys
   */
  public isPublicKeyAuthorized(pubKeyStr: string): boolean {
    const authKeysStr = globalVFS.readFile('/home/hello/.ssh/authorized_keys') || '';
    if (!authKeysStr.trim()) return false;

    const targetBase64 = pubKeyStr.split(' ')[1] || pubKeyStr.trim();
    const lines = authKeysStr.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const lineBase64 = trimmed.split(' ')[1] || trimmed;
      if (lineBase64 === targetBase64) return true;
    }
    return false;
  }
}

export const globalSSHKeyEngine = new SSHKeyEngine();
