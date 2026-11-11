import { describe, expect, it } from 'vitest';
import { assertDeliverableWebhookUrl, isBlockedAddress, validateWebhookUrl } from '../ssrf.js';

describe('isBlockedAddress', () => {
  it('blocks loopback, private, link-local, CGNAT and reserved IPv4 ranges', () => {
    for (const ip of [
      '0.0.0.0',
      '10.1.2.3',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.5.5',
      '192.168.1.1',
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255',
    ]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it('allows public IPv4 addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34']) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  it('blocks loopback, unique-local, link-local and mapped IPv6 addresses', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false);
  });
});

describe('validateWebhookUrl', () => {
  it('accepts a public HTTPS URL', () => {
    expect(validateWebhookUrl('https://example.com/webhooks/cryptopay')).toEqual({ ok: true });
  });

  it('rejects plain HTTP', () => {
    expect(validateWebhookUrl('http://example.com/hook').ok).toBe(false);
  });

  it('rejects credentials, custom ports and local hostnames', () => {
    expect(validateWebhookUrl('https://user:pass@example.com/hook').ok).toBe(false);
    expect(validateWebhookUrl('https://example.com:8443/hook').ok).toBe(false);
    expect(validateWebhookUrl('https://localhost/hook').ok).toBe(false);
    expect(validateWebhookUrl('https://api.internal/hook').ok).toBe(false);
    expect(validateWebhookUrl('https://router.local/hook').ok).toBe(false);
  });

  it('rejects raw private addresses and the metadata endpoint', () => {
    expect(validateWebhookUrl('https://127.0.0.1/hook').ok).toBe(false);
    expect(validateWebhookUrl('https://169.254.169.254/latest/meta-data').ok).toBe(false);
    expect(validateWebhookUrl('https://[::1]/hook').ok).toBe(false);
  });

  it('rejects malformed and non-HTTP URLs', () => {
    expect(validateWebhookUrl('not-a-url').ok).toBe(false);
    expect(validateWebhookUrl('file:///etc/passwd').ok).toBe(false);
  });
});

describe('assertDeliverableWebhookUrl', () => {
  it('accepts a hostname that resolves only to public addresses', async () => {
    const result = await assertDeliverableWebhookUrl('https://example.com/hook', async () => [
      '93.184.216.34',
    ]);
    expect(result.ok).toBe(true);
  });

  it('rejects DNS rebinding to a private address', async () => {
    const result = await assertDeliverableWebhookUrl('https://example.com/hook', async () => [
      '93.184.216.34',
      '10.0.0.5',
    ]);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/private|reserved/i);
  });

  it('rejects hostnames that fail to resolve', async () => {
    const result = await assertDeliverableWebhookUrl('https://example.com/hook', async () => {
      throw new Error('ENOTFOUND');
    });
    expect(result.ok).toBe(false);
  });
});
