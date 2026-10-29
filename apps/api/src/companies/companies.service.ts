import { Injectable } from '@nestjs/common';
import type { CompanyContextDto, CompanySummaryDto, CreateCompanyInput, UpdateCompanyInput } from '@finanzas/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, TenantContext } from '../common/request-context';
import { DbService } from '../db/db.service';
import { uuidv7 } from '../db/ids';
import { roleRef, toCompanySummary } from './mappers';

@Injectable()
export class CompaniesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** Crea la empresa, su sucursal principal y la membresía del creador como Propietario. */
  async create(auth: AuthContext, input: CreateCompanyInput): Promise<CompanySummaryDto> {
    const companyId = uuidv7();
    return this.db.tenant({ companyId, userId: auth.userId }, async (tx) => {
      const ownerRole = await tx.role.findFirstOrThrow({ where: { key: 'OWNER', companyId: null } });
      const company = await tx.company.create({
        data: {
          id: companyId,
          name: input.name,
          legalName: input.legalName ?? null,
          taxId: input.taxId ?? null,
          currency: input.currency,
          timeZone: input.timeZone,
          createdBy: auth.userId,
        },
      });
      await tx.branch.create({
        data: { id: uuidv7(), companyId, name: 'Principal', isDefault: true, createdBy: auth.userId },
      });
      await tx.companyMembership.create({
        data: { id: uuidv7(), companyId, userId: auth.userId, roleId: ownerRole.id, createdBy: auth.userId },
      });
      await this.audit.record(tx, {
        companyId,
        actorUserId: auth.userId,
        action: 'company.created',
        entityType: 'Company',
        entityId: companyId,
        data: { name: company.name, currency: company.currency, timeZone: company.timeZone },
        requestId: auth.requestId,
      });
      return toCompanySummary(company, ownerRole);
    });
  }

  async listMine(auth: AuthContext): Promise<CompanySummaryDto[]> {
    const memberships = await this.db.asUser(auth.userId, (tx) =>
      tx.companyMembership.findMany({
        where: { userId: auth.userId, status: 'ACTIVE' },
        include: { company: true, role: true },
        orderBy: { company: { name: 'asc' } },
      }),
    );
    return memberships.map((m) => toCompanySummary(m.company, m.role));
  }

  async current(t: TenantContext): Promise<CompanyContextDto> {
    const { company, role } = await this.db.tenant(t, async (tx) => ({
      company: await tx.company.findUniqueOrThrow({ where: { id: t.companyId } }),
      role: await tx.role.findUniqueOrThrow({ where: { id: t.roleId } }),
    }));
    return {
      ...toCompanySummary(company, role),
      role: roleRef(role),
      legalName: company.legalName,
      taxId: company.taxId,
      permissions: [...t.permissions].sort(),
    };
  }

  async update(t: TenantContext, input: UpdateCompanyInput): Promise<CompanyContextDto> {
    await this.db.tenant(t, async (tx) => {
      await tx.company.update({
        where: { id: t.companyId },
        data: { ...input, updatedBy: t.userId, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        companyId: t.companyId,
        actorUserId: t.userId,
        action: 'company.updated',
        entityType: 'Company',
        entityId: t.companyId,
        data: { fields: Object.keys(input) },
        requestId: t.requestId,
      });
    });
    return this.current(t);
  }
}
