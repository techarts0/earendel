/** Stable, privacy-safe addresses used by the virtual network. */
export const simulatedNetwork = {
  localIp: '192.168.1.100',
  publicIp: '203.0.113.10',
  gateway: '192.168.1.1',
  dns: '192.168.1.1',
};

export function isValidIPv4(value: string): boolean {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

export function normalizeHostname(input: string): string | null {
  let value = input.trim();
  if (/^https?:\/\//i.test(value)) {
    try { value = new URL(value).hostname; } catch { return null; }
  }
  value = value.replace(/\.$/, '').toLowerCase();
  if (isValidIPv4(value) || value === '::1' || value === 'localhost') return value;
  if (value.length > 253 || !value || !value.split('.').every((label) => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
  return value;
}

/** Resolve names into TEST-NET addresses without querying third-party DNS. */
export function simulatedResolve(hostInput: string, hostsText = ''): string | null {
  const host = normalizeHostname(hostInput);
  if (!host) return null;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return '127.0.0.1';
  if (isValidIPv4(host)) return host;

  for (const line of hostsText.split(/\r?\n/)) {
    const fields = line.replace(/#.*/, '').trim().split(/\s+/).filter(Boolean);
    if (fields.length > 1 && fields.slice(1).some((alias) => alias.toLowerCase() === host) && isValidIPv4(fields[0])) return fields[0];
  }

  let hash = 0;
  for (const char of host) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return `203.0.113.${(hash % 253) + 1}`;
}
