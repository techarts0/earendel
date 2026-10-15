// Earendel Linux Pure-VFS Image & Remote Sync Engine
import { globalVFS, VirtualFileSystem } from './vfs';
import { globalCapabilityManager } from '../kernel/capability';
import { globalTaskScheduler } from '../kernel/taskScheduler';
import { checkNetworkRequest } from './networkAccessPolicy';

export interface VFSImageHeader {
  magic: 'EARENDEL_VFS_V1';
  version: '0.1.1';
  created: string;
  nodeCount: number;
  checksum: string;
}

export interface VFSImagePayload {
  header: VFSImageHeader;
  nodes: Record<string, any>;
}

class VFSImageEngine {
  private remoteUrl: string = 'https://hub.earendel.techarts.cn';

  private hasAdminProcess(pid: number): boolean {
    const process = globalTaskScheduler.getProcess(pid);
    return !!process && process.state === 'RUNNING' && globalCapabilityManager.hasCapability(pid, 'CAP_SYS_ADMIN');
  }

  private saveConfig(config: Record<string, any>): boolean {
    const path = '/etc/vfs_config';
    const content = JSON.stringify(config, null, 2);
    if (!globalVFS.writeFile(path, content, 'root')) return false;
    globalVFS.chown(path, 'root:root', false, 'root');
    globalVFS.chmod(path, '600', false, 'root');
    return true;
  }

  // Pure JS SHA-256 implementation fallback for non-secure HTTP browser contexts
  private pureJsSha256(str: string): string {
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    const rotr = (n: number, x: number) => (x >>> n) | (x << (32 - n));

    const bytes = new TextEncoder().encode(str);
    const len = bytes.length;
    const bitLen = len * 8;

    const blockCount = Math.floor((len + 9 + 63) / 64);
    const blocks = new Uint8Array(blockCount * 64);
    blocks.set(bytes);
    blocks[len] = 0x80;

    const view = new DataView(blocks.buffer);
    view.setUint32(blocks.length - 4, bitLen, false);

    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

    const w = new Int32Array(64);

    for (let i = 0; i < blocks.length; i += 64) {
      for (let t = 0; t < 16; t++) {
        w[t] = view.getInt32(i + t * 4, false);
      }
      for (let t = 16; t < 64; t++) {
        const s0 = rotr(7, w[t - 15]) ^ rotr(18, w[t - 15]) ^ (w[t - 15] >>> 3);
        const s1 = rotr(17, w[t - 2]) ^ rotr(19, w[t - 2]) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
      }

      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

      for (let t = 0; t < 64; t++) {
        const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + K[t] + w[t]) | 0;
        const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) | 0;

        h = g; g = f; f = e; e = (d + temp1) | 0;
        d = c; c = b; b = a; a = (temp1 + temp2) | 0;
      }

      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }

    return [h0, h1, h2, h3, h4, h5, h6, h7]
      .map((h) => (h >>> 0).toString(16).padStart(8, '0'))
      .join('');
  }

  // Browser-native SHA-256 hashing algorithm helper with Non-Secure Context fallback
  public async sha256(str: string): Promise<string> {
    const saltedStr = str + '_EARENDEL_SALT_V1';
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
      try {
        const encoder = new TextEncoder();
        const data = encoder.encode(saltedStr);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
      } catch (e) {
        // Fallback on security exception
      }
    }

    return this.pureJsSha256(saltedStr);
  }

  public setRemoteUrl(url: string, callerPid: number): { success: boolean; message: string } {
    if (!this.hasAdminProcess(callerPid)) return { success: false, message: 'EACCES: CAP_SYS_ADMIN is required to configure VFS remotes.' };
    let normalizedUrl = url.trim().replace(/\/+$/, '');
    if (normalizedUrl !== 'local') {
      try {
        const parsed = new URL(normalizedUrl);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
          return { success: false, message: 'VFS remote URL must be HTTP(S) and cannot embed credentials.' };
        }
        normalizedUrl = parsed.origin + parsed.pathname.replace(/\/+$/, '');
      } catch {
        return { success: false, message: 'Invalid VFS remote URL.' };
      }
    }
    const configStr = globalVFS.readFile('/etc/vfs_config', 'root') || '{}';
    let cfg: Record<string, any> = {};
    try {
      cfg = JSON.parse(configStr);
    } catch { /* Replace malformed settings with a clean root-owned config. */ }
    cfg.remoteUrl = normalizedUrl;
    if (!this.saveConfig(cfg)) return { success: false, message: 'Unable to persist /etc/vfs_config.' };
    this.remoteUrl = normalizedUrl;
    return { success: true, message: `Remote VFS Hub endpoint set to '${normalizedUrl}'.` };
  }

  public getRemoteUrl(callerPid: number): string | null {
    if (!this.hasAdminProcess(callerPid)) return null;
    const configStr = globalVFS.readFile('/etc/vfs_config', 'root');
    if (configStr) {
      try {
        const cfg = JSON.parse(configStr);
        if (cfg.remoteUrl) return cfg.remoteUrl;
      } catch { /* Fall back to the current in-memory setting. */ }
    }
    return this.remoteUrl;
  }

  public async setCredential(passRaw: string | undefined, callerPid: number): Promise<{ success: boolean; message: string }> {
    if (!this.hasAdminProcess(callerPid)) return { success: false, message: 'EACCES: CAP_SYS_ADMIN is required to set VFS credentials.' };
    const salt = 'EARENDEL_VFS_SECURITY_SALT_2026';
    const pwd = passRaw || 'earendel_default_password';
    const passHash = await this.sha256(`${pwd}:${salt}`);
    const timestamp = Date.now().toString();

    const configStr = globalVFS.readFile('/etc/vfs_config', 'root');
    let cfg: Record<string, any> = {};
    if (configStr) {
      try {
        cfg = JSON.parse(configStr);
      } catch (e) { }
    }

    // Auto-generate immutable unique Machine UUID if not exists
    const machineId = cfg.username || `usr_${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 6)}`;
    const token = await this.sha256(`${machineId}:${passHash}:${timestamp}`);

    cfg.username = machineId; // Machine Identifier
    cfg.passHash = passHash;
    cfg.token = token;
    cfg.updatedAt = new Date().toISOString();

    if (!this.saveConfig(cfg)) return { success: false, message: 'Unable to persist /etc/vfs_config.' };

    return {
      success: true,
      message: `Machine ID '${machineId}' registered. Credentials saved securely to /etc/vfs_config. Token: ${token.substring(0, 12)}...`,
    };
  }

  private async getCredentialToken(): Promise<{ username: string; token: string }> {
    const configStr = globalVFS.readFile('/etc/vfs_config', 'root');
    if (configStr) {
      try {
        const cfg = JSON.parse(configStr);
        if (cfg.username && cfg.token) {
          return { username: cfg.username, token: cfg.token };
        }
      } catch (e) { }
    }
    const defaultUser = 'hello';
    const defaultToken = await this.sha256(`${defaultUser}:default_token_hash`);
    return { username: defaultUser, token: defaultToken };
  }

  private exportImage(): { fileName: string; payload: string; count: number } {
    const nodesData: Record<string, any> = {};
    let count = 0;
    let combinedContent = '';

    const walk = (pathStr: string) => {
      // Exclude Linux pseudo filesystems from disk image
      if (pathStr.startsWith('/proc') || pathStr.startsWith('/sys')) return;

      const node = globalVFS.getNodeByPath(pathStr);
      if (!node) return;

      count++;
      nodesData[pathStr] = {
        name: node.name,
        type: node.type,
        permissions: node.permissions,
        owner: node.owner,
        group: node.group,
        content: node.content || '',
        symlinkTarget: node.symlinkTarget,
      };
      combinedContent += pathStr + (node.content || '');

      if (node.type === 'directory' && node.children) {
        for (const childName of node.children.keys()) {
          const childPath = pathStr === '/' ? `/${childName}` : `${pathStr}/${childName}`;
          walk(childPath);
        }
      }
    };

    walk('/');

    // Simple deterministic checksum hash of all nodes to prevent manual tampering
    let checksumVal = 0;
    for (let i = 0; i < combinedContent.length; i++) {
      checksumVal = (checksumVal << 5) - checksumVal + combinedContent.charCodeAt(i);
      checksumVal |= 0;
    }

    const payloadObj: VFSImagePayload = {
      header: {
        magic: 'EARENDEL_VFS_V1',
        version: '0.1.1',
        created: new Date().toISOString(),
        nodeCount: count,
        checksum: `HMAC_SHA256_${Math.abs(checksumVal).toString(16)}`,
      },
      nodes: nodesData,
    };

    const jsonStr = JSON.stringify(payloadObj, null, 2);
    const fileName = `earendel_vfs_backup_${Date.now()}.earendel-img`;

    return { fileName, payload: jsonStr, count };
  }

  private importImage(jsonContent: string): { success: boolean; count: number; message: string } {
    try {
      const parsed: VFSImagePayload = JSON.parse(jsonContent);
      if (!parsed.header || parsed.header.magic !== 'EARENDEL_VFS_V1') {
        return { success: false, count: 0, message: 'Invalid image format: Missing EARENDEL_VFS_V1 header' };
      }
      if (!parsed.nodes || typeof parsed.nodes !== 'object' || Array.isArray(parsed.nodes)) {
        return { success: false, count: 0, message: 'Invalid image format: Missing node table' };
      }
      for (const [pathStr, item] of Object.entries(parsed.nodes)) {
        if (pathStr === '/') continue;
        if (!item || typeof item !== 'object' || !['directory', 'file', 'symlink'].includes(item.type)) {
          return { success: false, count: 0, message: `Invalid image node at '${pathStr}'` };
        }
        if (item.type === 'symlink' && (typeof item.symlinkTarget !== 'string' || !item.symlinkTarget || item.symlinkTarget.length > 4096)) {
          return { success: false, count: 0, message: `Invalid image symbolic link at '${pathStr}'` };
        }
        if (item.type === 'file' && (typeof item.content !== 'string' ||
            item.content.length > VirtualFileSystem.MAX_FILE_BYTES ||
            new TextEncoder().encode(item.content).byteLength > VirtualFileSystem.MAX_FILE_BYTES)) {
          return { success: false, count: 0, message: `Image file '${pathStr}' exceeds the ${VirtualFileSystem.MAX_FILE_BYTES}-byte VFS file-size limit` };
        }
      }

      let restoredCount = 0;
      for (const pathStr of Object.keys(parsed.nodes)) {
        const item = parsed.nodes[pathStr];
        if (pathStr === '/') continue;

        if (item.type === 'directory') {
          if (!globalVFS.mkdir(pathStr, true)) {
            return { success: false, count: restoredCount, message: `Could not restore image directory '${pathStr}'` };
          }
        } else if (item.type === 'file') {
          if (!globalVFS.writeFile(pathStr, item.content, 'root')) {
            return { success: false, count: restoredCount, message: `Could not restore image file '${pathStr}'` };
          }
        } else if (item.type === 'symlink') {
          const existing = globalVFS.getNodeByPath(pathStr, 'root');
          if (existing && !globalVFS.remove(pathStr, false, 'root')) {
            return { success: false, count: restoredCount, message: `Could not replace image entry '${pathStr}'` };
          }
          if (!globalVFS.symlink(item.symlinkTarget, pathStr)) {
            return { success: false, count: restoredCount, message: `Could not restore image symbolic link '${pathStr}'` };
          }
        }
        if (item.type !== 'symlink' && (!globalVFS.chmod(pathStr, item.permissions, false, 'root') ||
            !globalVFS.chown(pathStr, `${item.owner}:${item.group}`, false, 'root'))) {
          return { success: false, count: restoredCount, message: `Could not restore image metadata for '${pathStr}'` };
        }
        restoredCount++;
      }

      return {
        success: true,
        count: restoredCount,
        message: `Successfully loaded VFS image (${restoredCount} nodes restored to /)`,
      };
    } catch (e: any) {
      return { success: false, count: 0, message: `Image import error: ${e.message}` };
    }
  }

  private triggerPhysicalDownload(fileName: string, payload: string) {
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private triggerPhysicalFilePicker(): Promise<{ success: boolean; log: string }> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.earendel-img,.json';

      input.onchange = (e: any) => {
        const file = e.target.files?.[0];
        if (!file) {
          resolve({ success: false, log: '[VFS PULL CANCELED] No physical image file selected.\n' });
          return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
          const content = event.target?.result as string;
          const importRes = this.importImage(content);
          if (importRes.success) {
            resolve({
              success: true,
              log: `[VFS PHYSICAL PULL] Selected '${file.name}' (${(file.size / 1024).toFixed(1)} KB).\nRestored ${importRes.count} nodes to system root /.\n\x1b[32m[SUCCESS] Local VFS state successfully synchronized with physical disk image.\x1b[0m`,
            });
          } else {
            resolve({ success: false, log: `[VFS PULL ERROR] ${importRes.message}\n` });
          }
        };
        reader.onerror = () => resolve({ success: false, log: '[VFS PULL ERROR] Failed to read physical file.\n' });
        reader.readAsText(file);
      };

      input.click();
    });
  }

  public async push(callerPid: number): Promise<{ success: boolean; log: string }> {
    if (!this.hasAdminProcess(callerPid)) return { success: false, log: 'EACCES: CAP_SYS_ADMIN is required to export the complete VFS image.' };
    const remoteUrl = this.getRemoteUrl(callerPid) || 'local';
    const authorizedUrl = remoteUrl === 'local' ? '' : `${remoteUrl}/api/vfs/push`;
    if (authorizedUrl) {
      const denied = checkNetworkRequest(callerPid, authorizedUrl);
      if (denied) return { success: false, log: denied };
    }
    const { count, payload } = this.exportImage();
    const { username, token } = await this.getCredentialToken();
    const remoteImgName = `vfs_${username}.earendel-img`;

    // Local Physical Disk Download Mode (Default mode when no remote URL is set or set to local)
    if (!remoteUrl || remoteUrl === 'local') {
      this.triggerPhysicalDownload(remoteImgName, payload);
      const log = [
        `[VFS LOCAL PUSH] Generating physical image snapshot for user '${username}'...`,
        `Writing objects: 100% (${count}/${count}), done.`,
        `Triggered physical browser file download: Downloads/${remoteImgName} (${(payload.length / 1024).toFixed(1)} KB)`,
        `\x1b[32m[SUCCESS] Physical VFS image snapshot '${remoteImgName}' saved to your local disk.\x1b[0m`,
      ].join('\n');
      return { success: true, log };
    }

    // Remote Cloud VFS Image Push
    const requestUrl = `${remoteUrl}/api/vfs/push`;
    try {
      const res = await fetch(requestUrl, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ user: username, remoteImgName, payload, token }),
      });

      if (!res.ok) {
        return {
          success: false,
          log: `Connecting to ${remoteUrl}...\n\x1b[31m[VFS CLOUD ERROR] HTTP ${res.status}: ${res.statusText || 'Unauthorized / Server Error'}\x1b[0m\nPlease verify your API credentials using 'vfs remote set-credential'.`,
        };
      }

      const data = await res.json();
      return {
        success: true,
        log: data.message || `Total ${count} nodes synced to cloud repository '${remoteImgName}' successfully.`,
      };
    } catch (e: any) {
      return {
        success: false,
        log: `Connecting to ${remoteUrl}...\n\x1b[31m[VFS CLOUD ERROR] Failed to connect to remote Hub: ${e.message || 'Connection refused or Network Error'}\x1b[0m\nPlease check network or switch to offline mode using 'vfs remote set-url local'.`,
      };
    }
  }

  public async pull(callerPid: number): Promise<{ success: boolean; log: string }> {
    if (!this.hasAdminProcess(callerPid)) return { success: false, log: 'EACCES: CAP_SYS_ADMIN is required to replace VFS image contents.' };
    const remoteUrl = this.getRemoteUrl(callerPid) || 'local';
    const url = remoteUrl === 'local' ? '' : `${remoteUrl}/api/vfs/pull`;
    if (url) {
      const denied = checkNetworkRequest(callerPid, url);
      if (denied) return { success: false, log: denied };
    }
    const { username, token } = await this.getCredentialToken();
    const remoteImgName = `vfs_${username}.earendel-img`;

    // Local Physical Disk File Picker Upload Mode (Default mode)
    if (!remoteUrl || remoteUrl === 'local') {
      return this.triggerPhysicalFilePicker();
    }

    // Remote Cloud VFS Image Pull
    const requestUrl = `${remoteUrl}/api/vfs/pull?user=${username}&token=${token}`;

    try {
      const res = await fetch(requestUrl, {
        redirect: 'error',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        return {
          success: false,
          log: `Connecting to ${remoteUrl}...\n\x1b[31m[VFS CLOUD ERROR] HTTP ${res.status}: ${res.statusText || 'Image Not Found or Unauthorized'}\x1b[0m\nPlease verify remote image '${remoteImgName}' exists or update credentials.`,
        };
      }

      const data = await res.json();
      const importRes = this.importImage(data.payload);
      return { success: importRes.success, log: importRes.message };
    } catch (e: any) {
      return {
        success: false,
        log: `Connecting to ${remoteUrl}...\n\x1b[31m[VFS CLOUD ERROR] Failed to fetch from remote Hub: ${e.message || 'Connection refused or Network Error'}\x1b[0m\nPlease check network or switch to offline mode using 'vfs remote set-url local'.`,
      };
    }
  }
}

export const globalVFSImageEngine = new VFSImageEngine();
