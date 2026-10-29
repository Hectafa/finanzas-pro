import { Injectable } from '@nestjs/common';
import type { CategoryDto, CreateCategoryInput, UpdateCategoryInput } from '@finanzas/shared';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import type { TenantContext } from '../common/request-context';
import { DbService, type Tx } from '../db/db.service';
import { uuidv7 } from '../db/ids';
import type { TransactionCategory } from '../generated/prisma/client';
import { createCategoryLedgerAccount } from './chart';
import { versionConflict } from './common';

/**
 * Categorías de ingresos y gastos (un nivel de subcategoría). Cada una tiene su cuenta contable,
 * así los reportes por categoría salen directamente del libro.
 */
@Injectable()
export class CategoriesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(t: TenantContext, includeArchived = false): Promise<CategoryDto[]> {
    const rows = await this.db.tenant(t, (tx) =>
      tx.transactionCategory.findMany({
        where: { companyId: t.companyId, ...(includeArchived ? {} : { archivedAt: null }) },
        orderBy: [{ nature: 'asc' }, { name: 'asc' }],
      }),
    );
    return rows.map(toDto);
  }

  async create(t: TenantContext, input: CreateCategoryInput): Promise<CategoryDto> {
    return this.db.tenant(t, async (tx) => {
      if (input.parentId) {
        const parent = await this.load(tx, t, input.parentId);
        if (parent.archivedAt)
          throw Errors.conflict('CATEGORY_ARCHIVED', 'La categoría principal está archivada');
        if (parent.parentId)
          throw Errors.badRequest('CATEGORY_DEPTH', 'Solo se permite un nivel de subcategorías');
        if (parent.nature !== input.nature) {
          throw Errors.badRequest(
            'CATEGORY_NATURE',
            'La subcategoría debe ser del mismo tipo que su categoría principal',
          );
        }
      }
      const ledgerAccountId = await createCategoryLedgerAccount(
        tx,
        t.companyId,
        input.nature,
        input.name,
      );
      const category = await tx.transactionCategory.create({
        data: {
          id: uuidv7(),
          companyId: t.companyId,
          name: input.name,
          nature: input.nature,
          parentId: input.parentId ?? null,
          ledgerAccountId,
          createdBy: t.userId,
        },
      });
      await this.audit.record(tx, {
        companyId: t.companyId,
        actorUserId: t.userId,
        action: 'category.created',
        entityType: 'TransactionCategory',
        entityId: category.id,
        data: { name: category.name, nature: category.nature, parentId: category.parentId },
        requestId: t.requestId,
      });
      return toDto(category);
    });
  }

  async update(t: TenantContext, id: string, input: UpdateCategoryInput): Promise<CategoryDto> {
    return this.db.tenant(t, async (tx) => {
      const current = await this.load(tx, t, id);
      if (current.archivedAt)
        throw Errors.conflict('CATEGORY_ARCHIVED', 'La categoría está archivada');
      const { count } = await tx.transactionCategory.updateMany({
        where: { id, companyId: t.companyId, version: input.version },
        data: { name: input.name, updatedBy: t.userId, version: { increment: 1 } },
      });
      if (count === 0) throw versionConflict('esta categoría');
      await this.audit.record(tx, {
        companyId: t.companyId,
        actorUserId: t.userId,
        action: 'category.updated',
        entityType: 'TransactionCategory',
        entityId: id,
        data: { previousName: current.name, name: input.name },
        requestId: t.requestId,
      });
      return toDto(await tx.transactionCategory.findUniqueOrThrow({ where: { id } }));
    });
  }

  /** Archivar no afecta movimientos pasados; solo impide usarla en nuevos. */
  async archive(t: TenantContext, id: string): Promise<void> {
    await this.db.tenant(t, async (tx) => {
      const category = await this.load(tx, t, id);
      if (category.archivedAt) return;
      const activeChildren = await tx.transactionCategory.count({
        where: { companyId: t.companyId, parentId: id, archivedAt: null },
      });
      if (activeChildren > 0) {
        throw Errors.conflict('CATEGORY_HAS_CHILDREN', 'Archiva primero sus subcategorías');
      }
      await tx.transactionCategory.update({
        where: { id },
        data: { archivedAt: new Date(), updatedBy: t.userId, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        companyId: t.companyId,
        actorUserId: t.userId,
        action: 'category.archived',
        entityType: 'TransactionCategory',
        entityId: id,
        data: { name: category.name },
        requestId: t.requestId,
      });
    });
  }

  private async load(tx: Tx, t: TenantContext, id: string): Promise<TransactionCategory> {
    const category = await tx.transactionCategory.findFirst({
      where: { id, companyId: t.companyId },
    });
    if (!category) throw Errors.notFound('Categoría no encontrada');
    return category;
  }
}

function toDto(c: TransactionCategory): CategoryDto {
  return {
    id: c.id,
    name: c.name,
    nature: c.nature,
    parentId: c.parentId,
    archived: c.archivedAt !== null,
    version: c.version,
  };
}
