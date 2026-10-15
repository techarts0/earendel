import { VirtualFileSystem } from './vfs';

const PBKDF2_PREFIX = 'pbkdf2-sha256';
const PBKDF2_ITERATIONS = 310_000;
const MIN_PBKDF2_ITERATIONS = 100_000;
const MAX_PBKDF2_ITERATIONS = 600_000;

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(value: string): Uint8Array | null {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value)) return null;
  return new Uint8Array(value.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)));
}

async function derivePasswordHash(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const saltBuffer = new ArrayBuffer(salt.byteLength);
  new Uint8Array(saltBuffer).set(salt);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBuffer, iterations }, material, 256);
  return new Uint8Array(bits);
}

export async function hashAccountPassword(password: string): Promise<string | null> {
  if (!password || password.length > 1024 || !globalThis.crypto?.subtle || !globalThis.crypto.getRandomValues) return null;
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const derived = await derivePasswordHash(password, salt, PBKDF2_ITERATIONS);
    return `${PBKDF2_PREFIX}$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(derived)}`;
  } catch {
    return null;
  }
}

/** Trusted login-service check. The interactive user must never read /etc/shadow. */
export async function verifyAccountPassword(vfs: VirtualFileSystem, username: string, candidate: string): Promise<boolean> {
  if (!/^[a-z_][a-z0-9_-]*[$]?$/i.test(username) || !candidate || candidate.length > 1024) return false;
  // The login flow waits for IndexedDB hydration, but other callers (su/login
  // and tests) can reach authentication independently. Repair incomplete
  // classroom account rows at the trust boundary, after hydration has settled.
  await vfs.waitUntilReady?.();
  vfs.ensureDefaultLoginAccounts?.();
  const shadowContent = vfs.readFile('/etc/shadow', 'root') ?? '';
  const line = shadowContent.split('\n').find((entry) => entry.startsWith(`${username}:`));
  if (!line) return false;
  const storedPassword = line.split(':')[1] ?? '';
  if (!storedPassword || storedPassword === '!' || storedPassword === '*') return false;
  if (storedPassword.startsWith(`${PBKDF2_PREFIX}$`)) {
    const [, rawIterations, rawSalt, rawHash] = storedPassword.split('$');
    const iterations = Number(rawIterations);
    const salt = rawSalt ? fromHex(rawSalt) : null;
    const expected = rawHash ? fromHex(rawHash) : null;
    if (!Number.isSafeInteger(iterations) || iterations < MIN_PBKDF2_ITERATIONS || iterations > MAX_PBKDF2_ITERATIONS || !salt || !expected) return false;
    try {
      const actual = await derivePasswordHash(candidate, salt, iterations);
      if (actual.length !== expected.length) return false;
      let difference = 0;
      for (let index = 0; index < actual.length; index++) difference |= actual[index] ^ expected[index];
      return difference === 0;
    } catch {
      return false;
    }
  }
  // Fresh images store the documented classroom credential directly. Legacy
  // plaintext entries remain supported; passwd upgrades them to PBKDF2.
  return candidate === storedPassword;
}

export type PasswordUpdateResult = 'updated' | 'invalid-account' | 'hash-unavailable' | 'write-failed' | 'persistence-failed';

/** Update one existing account and only report success after its shadow row is durable. */
export async function updateAccountPassword(
  vfs: VirtualFileSystem,
  username: string,
  newPassword: string,
): Promise<PasswordUpdateResult> {
  if (!/^[a-z_][a-z0-9_-]*[$]?$/i.test(username) || !newPassword || newPassword.length > 1024) return 'invalid-account';
  const currentContent = vfs.readFile('/etc/shadow', 'root');
  if (currentContent === null) return 'write-failed';
  const hasAccount = currentContent.split('\n').some((line) => line.startsWith(`${username}:`));
  if (!hasAccount) return 'invalid-account';
  const passwordHash = await hashAccountPassword(newPassword);
  if (!passwordHash) return 'hash-unavailable';
  const updatedContent = currentContent.split('\n').map((line) => {
    if (!line.startsWith(`${username}:`)) return line;
    const fields = line.split(':');
    fields[1] = passwordHash;
    return fields.join(':');
  }).join('\n');
  if (!vfs.writeFile('/etc/shadow', updatedContent, 'root')) return 'write-failed';
  if (!await vfs.persistPaths(['/etc/shadow'])) {
    vfs.writeFile('/etc/shadow', currentContent, 'root');
    return 'persistence-failed';
  }
  return vfs.readFile('/etc/shadow', 'root') === updatedContent ? 'updated' : 'write-failed';
}
