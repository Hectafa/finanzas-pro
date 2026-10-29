import { Injectable } from '@nestjs/common';
import {
  Dec,
  type CreateFinancialAccountInput,
  type FinancialAccountDto,
  type UpdateFinancialAccountInput,
} from '@finanzas/shared';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import type { TenantContext } from '../common/request-context';
import { DbService, type Tx } from '../db/db.service';
import { uuidv7 } from '../db/ids';
import type { FinancialAccount } from '../generated/prisma/client';
import { createFinancialLedgerAccount, systemLedgerAccounts } from './chart';
import { assertNotFuture, companySettings, requireAny, todayIn, versionConflict } from './common';
import { LedgerService } from './ledger.service';

/**
 * Cuentas donde está el dinero. Su saldo es el de su cuenta contable: se deriva del libro.
 * Quien solo captura (transactions:create) ve las cuentas para elegirlas, pero no sus saldos.
 */
@Injectable()
export class AccountsService {
  constructor(
    private readonly db: DbService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async list(t: TenantContext, includeArchived = false): Promise<FinancialAccountDto[]> {
    requireAny(
      t,
      'accounts:view',
      'transactions:create',
      'transactions:view',
      'transactions:view_own',
    );
    const withBalance = t.permissions.has('accounts:view');
    return this.db.tenant(t, async (tx) => {
      const accounts = await tx.financialAccount.findMany({
        where: { companyId: t.companyId, ...(includeArchived ? {} : { archivedAt: null }) },
        orderBy: [
          { archivedAt: { sort: 'asc', nulls: 'first' } },
          { type: 'asc' },
          { name: 'asc' },
        ],
      });
      const balances = withBalance
        ? await this.ledger.balances(
            tx,
            t.companyId,
            accounts.map((a) => a.ledgerAccountId),
          )
        : null;
      return accounts.map((a) => toDto(a, balances?.get(a.ledgerAccountId) ?? null));
    });
  }

  async create(t: TenantContext, input: CreateFinancialAccountInput): Promise<FinancialAccountDto> {
    return this.db.tenant(t, async (tx) => {
      const company = await companySettings(tx, t.companyId);
      const openingDate = input.openingDate ?? todayIn(company.timeZone);
      assertNotFuture(openingDate, company.timeZone, 'openingDate');

      const ledgerAccountId = await createFinancialLedgerAccount(
        tx,
        t.companyId,
        input.type,
        input.name,
      );
      const account = await tx.financialAccount.create({
        data: {
          id: uuidv7(),
          companyId: t.companyId,
          name: input.name,
          type: input.type,
          institution: input.institution ?? null,
          currency: company.currency,
          ledgerAccountId,
          createdBy: t.userId,
        },
      });

      const opening = new Dec(input.openingBalance);
      if (opening.gt(0)) {
        const system = await systemLedgerAccounts(tx, t.companyId);
        await this.ledger.post(tx, {
          companyId: t.companyId,
          userId: t.userId,
          sourceType: 'FINANCIAL_ACCOUNT',
          sourceId: account.id,
          purpose: 'OPENING',
          date: openingDate,
          memo: `Saldo inicial de ${account.name}`,
          lines: [
            { ledgerAccountId, debit: opening, financialAccountId: account.id },
            { ledgerAccountId: system.OPENING_BALANCE, credit: opening },
          ],
        });
      }

      await this.audit.record(tx, {
        companyId: t.companyId,
        actorUserId: t.userId,
        action: 'account.created',
        entityType: 'FinancialAccount',
        entityId: account.id,
        data: {
          name: account.name,
          type: account.type,
          openingBalance: opening.toFixed(2),
          openingDate,
        },
        requestId: t.requestId,
      });
      return toDto(account, t.permissions.has('accounts:view') ? opening : null);
    });
  }

  async update(
    t: TenantContext,
    id: string,
    input: UpdateFinancialAccountInput,
  ): Promise<FinancialAccountDto> {
    return this.db.tenant(t, async (tx) => {
      const current = await this.load(tx, t, id);
      if (current.archivedAt) throw Errors.conflict('ACCOUNT_ARCHIVED', 'La cuenta está archivada');
      const { count } = await tx.financialAccount.updateMany({
        where: { id, companyId: t.companyId, version: input.version },
        data: {
          name: input.name,
          institution: input.institution,
          updatedBy: t.userId,
          version: { increment: 1 },
        },
      });
      if (count === 0) throw versionConflict('esta cuenta');
      await this.audit.record(tx, {
        companyId: t.companyId,
        actorUserId: t.userId,
        action: 'account.updated',
        entityType: 'FinancialAccount',
        entityId: id,
        data: {
          ...(input.name !== undefined && input.name !== current.name
            ? { previousName: current.name, name: input.name }
            : {}),
          ...(input.institution !== undefined ? { institution: input.institution } : {}),
        },
        requestId: t.requestId,
      });
      const updated = await tx.financialAccount.findUniqueOrThrow({ where: { id } });
      const balance = t.permissions.has('accounts:view')
        ? (await this.ledger.balances(tx, t.companyId, [updated.ledgerAccountId])).get(
            updated.ledgerAccountId,
          )!
        : null;
      return toDto(updated, balance);
    });
  }

  /** Solo se archiva una cuenta en cero y sin movimientos por revisar. */
  async archive(t: TenantContext, id: string): Promise<void> {
    await this.db.tenant(t, async (tx) => {
      await tx.$queryRaw`SELECT id FROM financial_accounts WHERE id = ${id}::uuid FOR UPDATE`;
      const account = await this.load(tx, t, id);
      if (account.archivedAt) return;
      const balance = (await this.ledger.balances(tx, t.companyId, [account.ledgerAccountId])).get(
        account.ledgerAccountId,
      )!;
      if (!balance.isZero()) {
        throw Errors.conflict(
          'ACCOUNT_NOT_EMPTY',
          `La cuenta tiene saldo (${balance.toFixed(2)}). Transfiérelo antes de archivarla`,
        );
      }
      const pending = await tx.financialTransaction.count({
        where: {
          companyId: t.companyId,
          status: 'PENDING_REVIEW',
          OR: [{ accountId: id }, { toAccountId: id }],
        },
      });
      if (pending > 0) {
        throw Errors.conflict('ACCOUNT_HAS_PENDING', 'Hay movimientos por revisar en esta cuenta');
      }
      await tx.financialAccount.update({
        where: { id },
        data: { archivedAt: new Date(), updatedBy: t.userId, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        companyId: t.companyId,
        actorUserId: t.userId,
        action: 'account.archived',
        entityType: 'FinancialAccount',
        entityId: id,
        data: { name: account.name },
        requestId: t.requestId,
      });
    });
  }

  private async load(tx: Tx, t: TenantContext, id: string): Promise<FinancialAccount> {
    const account = await tx.financialAccount.findFirst({ where: { id, companyId: t.companyId } });
    if (!account) throw Errors.notFound('Cuenta no encontrada');
    return account;
  }
}

function toDto(a: FinancialAccount, balance: Dec | null): FinancialAccountDto {
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    institution: a.institution,
    currency: a.currency,
    balance: balance ? balance.toFixed(2) : null,
    archived: a.archivedAt !== null,
    version: a.version,
    createdAt: a.createdAt.toISOString(),
  };
}
