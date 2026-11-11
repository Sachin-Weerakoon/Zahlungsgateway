/**
 * SSRF protection for merchant webhook URLs (SRS FR-WH-5, AC-9).
 *
 * Two layers:
 *  1. Synchronous structural validation: HTTPS only, no credentials, no obvious local names.
 *  2. Asynchronous DNS resolution: every resolved address must be public.
 *
 * The delivery worker must also refuse redirects, because a public URL can redirect to an
 * internal one after validation.
 */

const BLOCKED_IPV4: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.intranet',
  '.home.arpa',
  '.lan',
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function inIpv4Cidr(ip: string, base: string, prefix: number): boolean {
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === null || baseInt === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/** True when the address is not publicly routable and must never receive webhooks. */
export function isBlockedAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase().replace(/^\[|\]$/g, '');

  if (normalized.includes(':')) {
    // IPv4-mapped IPv6, e.g. ::ffff:127.0.0.1
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return isBlockedAddress(mapped[1]);

    if (normalized === '::' || normalized === '::1') return true;
    if (normalized.startsWith('fe8') || normalized.startsWith('fe9')) return true; // link-local
    if (normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
    if (/^f[cd]/.test(normalized)) return true; // unique local fc00::/7
    if (normalized.startsWith('ff')) return true; // multicast
    return false;
  }

  for (const [base, prefix] of BLOCKED_IPV4) {
    if (inIpv4Cidr(normalized, base, prefix)) return true;
  }
  return false;
}

export interface WebhookUrlValidation {
  ok: boolean;
  reason?: string;
}

/** Structural validation that does not require network access. */
export function validateWebhookUrl(rawUrl: string): WebhookUrlValidation {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'Webhook URL is not a valid absolute URL' };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'Webhook URL must use HTTPS' };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'Webhook URL must not contain credentials' };
  }
  if (url.port && url.port !== '443') {
    return { ok: false, reason: 'Webhook URL must use the default HTTPS port' };
  }
  if (!url.hostname) {
    return { ok: false, reason: 'Webhook URL is missing a hostname' };
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return { ok: false, reason: 'Webhook URL must not target a local hostname' };
  }
  if (isBlockedAddress(hostname)) {
    return { ok: false, reason: 'Webhook URL must not target a private or reserved address' };
  }

  return { ok: true };
}

export type LookupAddress = (hostname: string) => Promise<string[]>;

/**
 * Full validation used before a delivery attempt: structure plus DNS resolution.
 * Every resolved address must be public, which also defeats DNS rebinding to a private range.
 */
export async function assertDeliverableWebhookUrl(
  rawUrl: string,
  lookup: LookupAddress,
): Promise<WebhookUrlValidation> {
  const structural = validateWebhookUrl(rawUrl);
  if (!structural.ok) return structural;

  const hostname = new URL(rawUrl).hostname;
  if (isBlockedAddress(hostname)) {
    return { ok: false, reason: 'Webhook URL must not target a private or reserved address' };
  }

  let addresses: string[];
  try {
    addresses = await lookup(hostname);
  } catch {
    return { ok: false, reason: 'Webhook hostname could not be resolved' };
  }

  if (addresses.length === 0) {
    return { ok: false, reason: 'Webhook hostname did not resolve to any address' };
  }
  if (addresses.some((address) => isBlockedAddress(address))) {
    return { ok: false, reason: 'Webhook hostname resolves to a private or reserved address' };
  }
  return { ok: true };
}
