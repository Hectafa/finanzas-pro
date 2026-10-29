import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Authorize, CurrentTenant, type TenantContext } from '../common/request-context';
import { ZodPipe } from '../common/zod';
import { DbService } from '../db/db.service';
import { AuditService, type AuditVerification } from './audit.service';

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  beforeSeq: z.string().regex(/^\d+$/).optional(),
});

@ApiTags('Auditoría')
@Controller('audit')
export class AuditController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Authorize('audit:view')
  async list(@CurrentTenant() t: TenantContext, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    const rows = await this.db.tenant(t, (tx) =>
      tx.auditLog.findMany({
        where: { companyId: t.companyId, ...(q.beforeSeq ? { seq: { lt: BigInt(q.beforeSeq) } } : {}) },
        orderBy: { seq: 'desc' },
        take: q.limit,
      }),
    );
    return rows.map((r) => ({
      seq: r.seq.toString(),
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      actorUserId: r.actorUserId,
      data: r.data,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  @Get('verify')
  @Authorize('audit:view')
  verify(@CurrentTenant() t: TenantContext): Promise<AuditVerification> {
    return this.db.tenant(t, (tx) => this.audit.verify(tx, t.companyId));
  }
}
