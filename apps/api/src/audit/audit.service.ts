import { Injectable } from '@nestjs/common';
import type { Tx } from '../db/db.service';
import { uuidv7 } from '../db/ids';
import type { Prisma } from '../generated/prisma/client';
import { computeAuditHash } from './audit-hash';

export interface AuditEntry {
  companyId: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  /** Solo datos no sensibles: nunca contraseñas, tokens ni documentos completos. */
  data?: Record<string, string | number | boolean | null | string[]>;
  requestId?: string;
}

export interface AuditVerification {
  valid: boolean;
  checked: number;
  firstInvalidSeq: string | null;
}

/**
 * Bitácora encadenada por empresa (o cadena "global" para eventos sin empresa, como el login).
 * Se escribe dentro de la misma transacción que la operación auditada.
 */
@Injectable()
export class AuditService {
  async record(tx: Tx, entry: AuditEntry): Promise<void> {
    const chain = `audit:${entry.companyId ?? 'global'}`;
    // Serializa las inserciones de una misma cadena hasta el commit.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${chain}, 0))`;
    const prev = await tx.auditLog.findFirst({
      where: { companyId: entry.companyId },
      orderBy: { seq: 'desc' },
      select: { hash: true },
    });

    const row = {
      id: uuidv7(),
      companyId: entry.companyId,
      actorUserId: entry.actorUserId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      data: entry.data ?? null,
      createdAt: new Date(),
    };
    const prevHash = prev?.hash ?? null;
    await tx.auditLog.create({
      data: {
        ...row,
        data: (row.data ?? undefined) as Prisma.InputJsonValue | undefined,
        requestId: entry.requestId ?? null,
        prevHash,
        hash: computeAuditHash(prevHash, row),
      },
    });
  }

  async verify(tx: Tx, companyId: string): Promise<AuditVerification> {
    let prevHash: string | null = null;
    let checked = 0;
    let cursor: bigint | undefined;
    for (;;) {
      const batch = await tx.auditLog.findMany({
        where: { companyId, ...(cursor !== undefined ? { seq: { gt: cursor } } : {}) },
        orderBy: { seq: 'asc' },
        take: 500,
      });
      if (batch.length === 0) break;
      for (const row of batch) {
        const expected = computeAuditHash(prevHash, row);
        if (row.prevHash !== prevHash || row.hash !== expected) {
          return { valid: false, checked, firstInvalidSeq: row.seq.toString() };
        }
        prevHash = row.hash;
        checked++;
      }
      cursor = batch[batch.length - 1]!.seq;
    }
    return { valid: true, checked, firstInvalidSeq: null };
  }
}
