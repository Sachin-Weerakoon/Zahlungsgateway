import { prisma, type Prisma } from '@cryptopay/db';
import { AuditAction } from '@cryptopay/shared';
import { logger } from './logger';

export interface AuditEntry {
  actor: string;
  action: AuditAction | string;
  target?: string | null;
  merchantId?: string | null;
  ip?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Append-only audit trail (FR-ADM-4). Failures are logged but never break the caller's
 * business transaction; the database role cannot UPDATE or DELETE this table.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actor: entry.actor.toLowerCase(),
        action: entry.action,
        target: entry.target ?? null,
        merchantId: entry.merchantId ?? null,
        ip: entry.ip ?? null,
        metadata: (entry.metadata as Prisma.InputJsonValue | undefined) ?? undefined,
      },
    });
  } catch (error) {
    logger.error('audit log write failed', {
      action: entry.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
