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

/**
 * Parse an IPv6 literal into eight 16-bit groups. Handles `::` compression and a trailing
 * dotted IPv4 part (e.g. `::ffff:1.2.3.4`). Returns null when the text is not valid IPv6.
 */
export function parseIpv6(address: string): number[] | null {
  let text = address.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  if (!text.includes(':')) return null;

  // Convert a trailing dotted IPv4 into two hex groups.
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = ipv4ToInt(tail);
    if (v4 === null) return null;
    text = `${text.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parseGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const groups: number[] = [];
    for (const group of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      groups.push(parseInt(group, 16));
    }
    return groups;
  };

  const head = parseGroups(halves[0] ?? '');
  const rest = halves.length === 2 ? parseGroups(halves[1] ?? '') : [];
  if (!head || !rest) return null;

  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - rest.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...rest];
}

function embeddedIpv4(high: number, low: number): string {
  return [high >>> 8, high & 0xff, low >>> 8, low & 0xff].join('.');
}

function isBlockedIpv4(address: string): boolean {
  if (ipv4ToInt(address) === null) return false;
  return BLOCKED_IPV4.some(([base, prefix]) => inIpv4Cidr(address, base, prefix));
}

function isBlockedIpv6(groups: number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  const firstSixZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0;

  // :: (unspecified) and ::1 (loopback)
  if (firstSixZero && g6 === 0 && (g7 === 0 || g7 === 1)) return true;
  // IPv4-compatible ::a.b.c.d (deprecated) and IPv4-mapped ::ffff:a.b.c.d
  if (firstSixZero || (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff)) {
    return isBlockedIpv4(embeddedIpv4(g6, g7));
  }
  // IPv4-translated ::ffff:0:a.b.c.d
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0xffff && g5 === 0) {
    return isBlockedIpv4(embeddedIpv4(g6, g7));
  }
  // NAT64 well-known prefix 64:ff9b::/96 can reach internal IPv4 through a translator.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isBlockedIpv4(embeddedIpv4(g6, g7));
  }
  // Local-use NAT64 64:ff9b:1::/48
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 1) return true;
  // 6to4 2002::/16 embeds an IPv4 address in groups 1-2.
  if (g0 === 0x2002) return isBlockedIpv4(embeddedIpv4(g1, g2));
  // Teredo 2001::/32, documentation 2001:db8::/32, ORCHID and benchmarking 2001:2::/48 / 2001:10::/28
  if (g0 === 0x2001 && (g1 === 0 || g1 === 0xdb8 || g1 === 2 || (g1 & 0xfff0) === 0x10)) return true;
  // Discard-only 100::/64
  if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) return true;
  // Unique local fc00::/7
  if ((g0 & 0xfe00) === 0xfc00) return true;
  // Link-local fe80::/10 and deprecated site-local fec0::/10
  if ((g0 & 0xffc0) === 0xfe80 || (g0 & 0xffc0) === 0xfec0) return true;
  // Multicast ff00::/8
  if ((g0 & 0xff00) === 0xff00) return true;
  return false;
}

/** True when the address is not publicly routable and must never receive webhooks. */
export function isBlockedAddress(address: string): boolean {
  const normalized = address.trim().toLowerCase().replace(/^\[|\]$/g, '');

  if (normalized.includes(':')) {
    const groups = parseIpv6(normalized);
    // Unparseable IPv6-looking input is rejected rather than trusted.
    return groups === null ? true : isBlockedIpv6(groups);
  }

  return isBlockedIpv4(normalized);
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

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
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
