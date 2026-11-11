import { z } from 'zod';

/**
 * Opaque cursor pagination (SRS 6.4). The cursor encodes the last row's sort key so the
 * next page continues deterministically even while new rows are inserted.
 */
const cursorSchema = z.object({
  t: z.string().datetime(),
  id: z.string().min(1),
});

export interface CursorPosition {
  createdAt: Date;
  id: string;
}

export function encodeCursor(position: CursorPosition): string {
  return Buffer.from(
    JSON.stringify({ t: position.createdAt.toISOString(), id: position.id }),
    'utf8',
  ).toString('base64url');
}

export function decodeCursor(cursor: string): CursorPosition {
  const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  if (!parsed.success) {
    throw new Error('Invalid pagination cursor');
  }
  return { createdAt: new Date(parsed.data.t), id: parsed.data.id };
}
