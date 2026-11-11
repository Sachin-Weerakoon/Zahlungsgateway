import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from '../pagination.js';

describe('cursor pagination', () => {
  it('round-trips a position', () => {
    const position = { createdAt: new Date('2026-11-11T10:00:00.000Z'), id: 'inv_1' };
    const decoded = decodeCursor(encodeCursor(position));
    expect(decoded.id).toBe('inv_1');
    expect(decoded.createdAt.toISOString()).toBe('2026-11-11T10:00:00.000Z');
  });

  it('rejects malformed cursors', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrow();
    expect(() =>
      decodeCursor(Buffer.from(JSON.stringify({ id: 'x' }), 'utf8').toString('base64url')),
    ).toThrow();
  });
});
