import { Injectable } from '@nestjs/common';
import {
  Dec,
  vatIncluded,
  type CreateTransactionInput,
  type ListTransactionsQuery,
  type TransactionDto,
  type TransactionPageDto,
  type UpdateTransactionInput,
} from '@finanzas/shared';
import { createHash } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import type { TenantContext } from '../common/request-context';
import { DbService, type Tx } from '../db/db.service';
import {
  Prisma,
  type FinancialAccount,
  type TransactionCategory,
} from '../generated/prisma/client';
import { systemLedgerAccounts } from './chart';
import { assertNotFuture, companySettings, requireAny, versionConflict } from './common';
import { fromDbDate, LedgerService, toDbDate, type PostingLine } from './ledger.service';

const SOURCE = 'TRANSACTION';

const withRelations = {
  account: true,
  toAccount: true,
  category: true,
  creator: { select: { id: true, fullName: true } },
} satisfies Prisma.FinancialTransactionInclude;

type TransactionRow = Prisma.FinancialTransactionGetPayload<{ include: typeof withRelations }>;

/** Huella de la solicitud: mismas claves en el mismo orden, sin importar cómo llegaron. */
export function requestHash(input: CreateTransactionInput): string {
  const sorted = Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)));
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

/**
 * Movimientos: ingresos, gastos, transferencias, aportaciones y retiros de socios.
 *
 * - Idempotencia: el dispositivo genera el id. Reenviar la misma solicitud devuelve el mismo
 *   movimiento; el mismo id con otro contenido se rechaza (409).
 * - Revisión: quien no tiene transactions:approve captura en PENDING_REVIEW, sin efecto en saldos.
 * - Inmutabilidad: lo que afecta saldos no se edita. Anular genera un asiento de reversa.
 */
@Injectable()
export class TransactionsService {
  constructor(
    private readonly db: DbService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async create(
    t: TenantContext,
    input: CreateTransactionInput,
  ): Promise<{ created: boolean; transaction: TransactionDto }> {
    const hash = requestHash(input);
    try {
      return await this.db.tenant(t, async (tx) => {
        const existing = await tx.financialTransaction.findFirst({
          where: { id: input.id, companyId: t.companyId },
          include: withRelations,
        });
        if (existing) return { created: false, transaction: this.replay(existing, hash) };
        return { created: true, transaction: await this.insert(tx, t, input, hash) };
      });
    } catch (e) {
      // Dos envíos simultáneos del mismo id: el segundo choca con la llave primaria.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.db.tenant(t, (tx) =>
          tx.financialTransaction.findFirst({
            where: { id: input.id, companyId: t.companyId },
            include: withRelations,
          }),
        );
        if (existing) return { created: false, transaction: this.replay(existing, hash) };
      }
      throw e;
    }
  }

  private replay(existing: TransactionRow, hash: string): TransactionDto {
    if (existing.requestHash !== hash) {
      throw Errors.conflict(
        'IDEMPOTENCY_CONFLICT',
        'Ya existe un movimiento con ese identificador y datos distintos',
      );
    }
    return toDto(existing);
  }

  private async insert(
    tx: Tx,
    t: TenantContext,
    input: CreateTransactionInput,
    hash: string,
  ): Promise<TransactionDto> {
    const company = await companySettings(tx, t.companyId);
    assertNotFuture(input.date, company.timeZone);

    const account = await this.usableAccount(tx, t, input.accountId, 'accountId');
    const toAccount =
      input.type === 'TRANSFER'
        ? await this.usableAccount(tx, t, input.toAccountId, 'toAccountId')
        : null;
    let category: TransactionCategory | null = null;
    let vatRate: string | null = null;
    if (input.type === 'INCOME' || input.type === 'EXPENSE') {
      category = await this.usableCategory(tx, t, input.categoryId, input.type);
      vatRate = input.vatRate;
    }
    for (const a of [account, toAccount]) {
      if (a && a.currency !== company.currency) {
        throw Errors.badRequest('CURRENCY_MISMATCH', 'La cuenta opera en otra moneda');
      }
    }

    const amount = new Dec(input.amount);
    const vat =
      input.type === 'INCOME' || input.type === 'EXPENSE'
        ? vatIncluded(amount, input.vatRate)
        : new Dec(0);
    const status = t.permissions.has('transactions:approve') ? 'POSTED' : 'PENDING_REVIEW';
    const now = new Date();

    const row = await tx.financialTransaction.create({
      data: {
        id: input.id,
        companyId: t.companyId,
        type: input.type,
        status,
        transactionDate: toDbDate(input.date),
        amount: amount.toFixed(4),
        vatRate,
        vatAmount: vat.toFixed(4),
        currency: company.currency,
        accountId: account.id,
        toAccountId: toAccount?.id ?? null,
        categoryId: category?.id ?? null,
        description: input.description ?? null,
        reference: input.reference ?? null,
        counterparty: input.counterparty ?? null,
        notes: input.notes ?? null,
        requestHash: hash,
        createdBy: t.userId,
        ...(status === 'POSTED' ? { postedAt: now, postedBy: t.userId } : {}),
      },
      include: withRelations,
    });
    if (status === 'POSTED') await this.post(tx, t, row);

    await this.audit.record(tx, {
      companyId: t.companyId,
      actorUserId: t.userId,
      action: 'transaction.created',
      entityType: 'FinancialTransaction',
      entityId: row.id,
      data: {
        type: row.type,
        status,
        amount: amount.toFixed(2),
        date: input.date,
        accountId: account.id,
      },
      requestId: t.requestId,
    });
    return toDto(row);
  }

  /** Reglas de contabilización (docs/fase-0 §5). Nada de esto es ingreso o gasto salvo INCOME/EXPENSE. */
  private async post(tx: Tx, t: TenantContext, row: TransactionRow): Promise<void> {
    const amount = new Dec(row.amount.toString());
    const vat = new Dec(row.vatAmount.toString());
    const net = amount.minus(vat);
    const money = (a: FinancialAccount) => ({
      ledgerAccountId: a.ledgerAccountId,
      financialAccountId: a.id,
    });
    const system = await systemLedgerAccounts(tx, t.companyId);
    const cat = row.category
      ? { ledgerAccountId: row.category.ledgerAccountId, categoryId: row.category.id }
      : null;

    let lines: PostingLine[];
    switch (row.type) {
      case 'INCOME': // Cargo a la cuenta de dinero; abono al ingreso y al IVA trasladado.
        lines = [
          { ...money(row.account), debit: amount },
          { ...cat!, credit: net },
          { ledgerAccountId: system.VAT_PAYABLE, credit: vat },
        ];
        break;
      case 'EXPENSE': // Cargo al gasto y al IVA acreditable; abono a la cuenta de dinero.
        lines = [
          { ...cat!, debit: net },
          { ledgerAccountId: system.VAT_RECEIVABLE, debit: vat },
          { ...money(row.account), credit: amount },
        ];
        break;
      case 'TRANSFER': // Ni ingreso ni gasto: el dinero solo cambia de cuenta.
        lines = [
          { ...money(row.toAccount!), debit: amount },
          { ...money(row.account), credit: amount },
        ];
        break;
      case 'OWNER_CONTRIBUTION': // Capital, no ingreso: no afecta la utilidad.
        lines = [
          { ...money(row.account), debit: amount },
          { ledgerAccountId: system.OWNER_CAPITAL, credit: amount },
        ];
        break;
      case 'OWNER_WITHDRAWAL': // Retiro de capital, no gasto.
        lines = [
          { ledgerAccountId: system.OWNER_DRAWINGS, debit: amount },
          { ...money(row.account), credit: amount },
        ];
        break;
    }
    await this.ledger.post(tx, {
      companyId: t.companyId,
      userId: t.userId,
      sourceType: SOURCE,
      sourceId: row.id,
      purpose: 'MAIN',
      date: fromDbDate(row.transactionDate),
      memo: row.description,
      lines,
    });
  }

  async approve(t: TenantContext, id: string): Promise<TransactionDto> {
    return this.db.tenant(t, async (tx) => {
      const row = await this.lock(tx, t, id);
      if (row.status === 'POSTED') return toDto(row);
      if (row.status === 'VOIDED')
        throw Errors.conflict('TRANSACTION_VOIDED', 'El movimiento está anulado');
      const now = new Date();
      const updated = await tx.financialTransaction.update({
        where: { id },
        data: {
          status: 'POSTED',
          postedAt: now,
          postedBy: t.userId,
          updatedBy: t.userId,
          version: { increment: 1 },
        },
        include: withRelations,
      });
      await this.post(tx, t, updated);
      await this.audit.record(tx, {
        companyId: t.companyId,
        actorUserId: t.userId,
        action: 'transaction.approved',
        entityType: 'FinancialTransaction',
        entityId: id,
        data: { createdBy: row.createdBy },
        requestId: t.requestId,
      });
      return toDto(updated);
    });
  }

  /** Confirmado → asiento de reversa. Por revisar → se rechaza sin tocar el libro. */
  async void(t: TenantContext, id: string, reason: string): Promise<TransactionDto> {
    return this.db.tenant(t, async (tx) => {
      const row = await this.lock(tx, t, id);
      if (row.status === 'VOIDED') return toDto(row);
      if (row.status === 'POSTED') {
        await this.ledger.reverse(tx, {
          companyId: t.companyId,
          userId: t.userId,
          sourceType: SOURCE,
          sourceId: id,
          memo: `Anulación: ${reason}`,
        });
      }
      const updated = await tx.financialTransaction.update({
        where: { id },
        data: {
          status: 'VOIDED',
          voidedAt: new Date(),
          voidedBy: t.userId,
          voidReason: reason,
          updatedBy: t.userId,
          version: { increment: 1 },
        },
        include: withRelations,
      });
      await this.audit.record(tx, {
        companyId: t.companyId,
        actorUserId: t.userId,
        action: 'transaction.voided',
        entityType: 'FinancialTransaction',
        entityId: id,
        data: { previousStatus: row.status, reason },
        requestId: t.requestId,
      });
      return toDto(updated);
    });
  }

  /** Solo campos descriptivos. Con transactions:update, o quien lo capturó mientras está por revisar. */
  async update(
    t: TenantContext,
    id: string,
    input: UpdateTransactionInput,
  ): Promise<TransactionDto> {
    return this.db.tenant(t, async (tx) => {
      const row = await this.visible(tx, t, id);
      const ownPending = row.createdBy === t.userId && row.status === 'PENDING_REVIEW';
      if (!t.permissions.has('transactions:update') && !ownPending) throw Errors.forbidden();
      if (row.status === 'VOIDED')
        throw Errors.conflict('TRANSACTION_VOIDED', 'El movimiento está anulado');
      const { count } = await tx.financialTransaction.updateMany({
        where: { id, companyId: t.companyId, version: input.version },
        data: {
          description: input.description,
          reference: input.reference,
          counterparty: input.counterparty,
          notes: input.notes,
          updatedBy: t.userId,
          version: { increment: 1 },
        },
      });
      if (count === 0) throw versionConflict('este movimiento');
      await this.audit.record(tx, {
        companyId: t.companyId,
        actorUserId: t.userId,
        action: 'transaction.updated',
        entityType: 'FinancialTransaction',
        entityId: id,
        data: { fields: Object.keys(input).filter((k) => k !== 'version') },
        requestId: t.requestId,
      });
      return toDto(
        await tx.financialTransaction.findUniqueOrThrow({ where: { id }, include: withRelations }),
      );
    });
  }

  async get(t: TenantContext, id: string): Promise<TransactionDto> {
    return toDto(await this.db.tenant(t, (tx) => this.visible(tx, t, id)));
  }

  async list(t: TenantContext, q: ListTransactionsQuery): Promise<TransactionPageDto> {
    requireAny(t, 'transactions:view', 'transactions:view_own');
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    const where: Prisma.FinancialTransactionWhereInput = {
      companyId: t.companyId,
      ...(t.permissions.has('transactions:view') ? {} : { createdBy: t.userId }),
      ...(q.type ? { type: q.type } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.accountId ? { OR: [{ accountId: q.accountId }, { toAccountId: q.accountId }] } : {}),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.from || q.to
        ? {
            transactionDate: {
              ...(q.from ? { gte: toDbDate(q.from) } : {}),
              ...(q.to ? { lte: toDbDate(q.to) } : {}),
            },
          }
        : {}),
      AND: [
        ...(q.q
          ? [
              {
                OR: [
                  { description: { contains: q.q, mode: 'insensitive' as const } },
                  { counterparty: { contains: q.q, mode: 'insensitive' as const } },
                  { reference: { contains: q.q, mode: 'insensitive' as const } },
                ],
              },
            ]
          : []),
        ...(cursor
          ? [
              {
                OR: [
                  { transactionDate: { lt: toDbDate(cursor.date) } },
                  { transactionDate: toDbDate(cursor.date), id: { lt: cursor.id } },
                ],
              },
            ]
          : []),
      ],
    };
    const rows = await this.db.tenant(t, (tx) =>
      tx.financialTransaction.findMany({
        where,
        include: withRelations,
        orderBy: [{ transactionDate: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
      }),
    );
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toDto),
      nextCursor:
        rows.length > q.limit && last
          ? encodeCursor(fromDbDate(last.transactionDate), last.id)
          : null,
    };
  }

  /** Movimiento de la empresa visible para el usuario (con view_own, solo los propios). */
  private async visible(tx: Tx, t: TenantContext, id: string): Promise<TransactionRow> {
    requireAny(t, 'transactions:view', 'transactions:view_own');
    const row = await tx.financialTransaction.findFirst({
      where: {
        id,
        companyId: t.companyId,
        ...(t.permissions.has('transactions:view') ? {} : { createdBy: t.userId }),
      },
      include: withRelations,
    });
    if (!row) throw Errors.notFound('Movimiento no encontrado');
    return row;
  }

  private async lock(tx: Tx, t: TenantContext, id: string): Promise<TransactionRow> {
    await tx.$queryRaw`SELECT id FROM financial_transactions WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.financialTransaction.findFirst({
      where: { id, companyId: t.companyId },
      include: withRelations,
    });
    if (!row) throw Errors.notFound('Movimiento no encontrado');
    return row;
  }

  private async usableAccount(
    tx: Tx,
    t: TenantContext,
    id: string,
    field: string,
  ): Promise<FinancialAccount> {
    const account = await tx.financialAccount.findFirst({ where: { id, companyId: t.companyId } });
    if (!account) throw Errors.validation([{ path: field, message: 'Cuenta no encontrada' }]);
    if (account.archivedAt)
      throw Errors.validation([{ path: field, message: 'La cuenta está archivada' }]);
    return account;
  }

  private async usableCategory(
    tx: Tx,
    t: TenantContext,
    id: string,
    type: 'INCOME' | 'EXPENSE',
  ): Promise<TransactionCategory> {
    const category = await tx.transactionCategory.findFirst({
      where: { id, companyId: t.companyId },
    });
    if (!category)
      throw Errors.validation([{ path: 'categoryId', message: 'Categoría no encontrada' }]);
    if (category.archivedAt)
      throw Errors.validation([{ path: 'categoryId', message: 'La categoría está archivada' }]);
    if (category.nature !== type) {
      throw Errors.validation([
        {
          path: 'categoryId',
          message:
            type === 'INCOME' ? 'Elige una categoría de ingreso' : 'Elige una categoría de gasto',
        },
      ]);
    }
    return category;
  }
}

const encodeCursor = (date: string, id: string) =>
  Buffer.from(`${date}|${id}`).toString('base64url');

function decodeCursor(cursor: string): { date: string; id: string } {
  const [date, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  if (!date || !id || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw Errors.badRequest('INVALID_CURSOR', 'Cursor de paginación inválido');
  }
  return { date, id };
}

const ref = (a: FinancialAccount) => ({ id: a.id, name: a.name, type: a.type });

function toDto(r: TransactionRow): TransactionDto {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    date: fromDbDate(r.transactionDate),
    amount: new Dec(r.amount.toString()).toFixed(2),
    vatRate: r.vatRate,
    vatAmount: new Dec(r.vatAmount.toString()).toFixed(2),
    currency: r.currency,
    account: ref(r.account),
    toAccount: r.toAccount ? ref(r.toAccount) : null,
    category: r.category ? { id: r.category.id, name: r.category.name } : null,
    description: r.description,
    reference: r.reference,
    counterparty: r.counterparty,
    notes: r.notes,
    createdBy: r.creator,
    createdAt: r.createdAt.toISOString(),
    postedAt: r.postedAt?.toISOString() ?? null,
    voidedAt: r.voidedAt?.toISOString() ?? null,
    voidReason: r.voidReason,
    version: r.version,
  };
}
