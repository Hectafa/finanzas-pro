import { Injectable } from '@nestjs/common';
import { Dec, type LedgerVerificationDto } from '@finanzas/shared';
import type { Tx } from '../db/db.service';
import { uuidv7 } from '../db/ids';
import { Prisma, type LedgerAccountType } from '../generated/prisma/client';

export interface PostingLine {
  ledgerAccountId: string;
  debit?: Dec;
  credit?: Dec;
  financialAccountId?: string | null;
  categoryId?: string | null;
}

export interface PostingInput {
  companyId: string;
  userId: string;
  sourceType: string;
  sourceId: string;
  /** MAIN para el efecto principal; OPENING, REVERSAL… para otros asientos del mismo origen. */
  purpose: string;
  /** Fecha contable YYYY-MM-DD. */
  date: string;
  memo?: string | null;
  reversesEntryId?: string;
  lines: PostingLine[];
}

export class UnbalancedEntryError extends Error {}

/** Fecha de negocio (YYYY-MM-DD) ↔ columna DATE. */
export const toDbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
export const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Libro contable de partida doble. Es el ÚNICO lugar que escribe asientos; los demás módulos
 * lo llaman dentro de la misma transacción que su documento. Los asientos no se modifican:
 * una corrección es un asiento de reversa.
 */
@Injectable()
export class LedgerService {
  async post(tx: Tx, input: PostingInput): Promise<string> {
    const lines = input.lines
      .map((l) => ({ ...l, debit: l.debit ?? new Dec(0), credit: l.credit ?? new Dec(0) }))
      .filter((l) => !l.debit.isZero() || !l.credit.isZero());
    const debit = lines.reduce((s, l) => s.plus(l.debit), new Dec(0));
    const credit = lines.reduce((s, l) => s.plus(l.credit), new Dec(0));
    if (
      lines.length < 2 ||
      !debit.eq(credit) ||
      lines.some((l) => l.debit.isNeg() || l.credit.isNeg())
    ) {
      // Error de programación: las reglas de contabilización deben producir asientos cuadrados.
      throw new UnbalancedEntryError(
        `Asiento ${input.sourceType}/${input.purpose} no cuadra: ${debit} ≠ ${credit}`,
      );
    }

    const entryId = uuidv7();
    await tx.journalEntry.create({
      data: {
        id: entryId,
        companyId: input.companyId,
        entryDate: toDbDate(input.date),
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        purpose: input.purpose,
        memo: input.memo?.slice(0, 200) ?? null,
        reversesEntryId: input.reversesEntryId ?? null,
        createdBy: input.userId,
      },
    });
    await tx.journalLine.createMany({
      data: lines.map((l, i) => ({
        id: uuidv7(),
        entryId,
        companyId: input.companyId,
        lineNo: i + 1,
        ledgerAccountId: l.ledgerAccountId,
        debit: l.debit.toFixed(4),
        credit: l.credit.toFixed(4),
        financialAccountId: l.financialAccountId ?? null,
        categoryId: l.categoryId ?? null,
      })),
    });
    return entryId;
  }

  /**
   * Reversa exacta del asiento MAIN de un origen, en la misma fecha contable: el hecho deja de
   * contar en su periodo. La restricción única impide revertir dos veces.
   */
  async reverse(
    tx: Tx,
    args: {
      companyId: string;
      userId: string;
      sourceType: string;
      sourceId: string;
      memo?: string;
    },
  ): Promise<string> {
    const original = await tx.journalEntry.findFirstOrThrow({
      where: {
        companyId: args.companyId,
        sourceType: args.sourceType,
        sourceId: args.sourceId,
        purpose: 'MAIN',
      },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    });
    const entryId = await this.post(tx, {
      companyId: args.companyId,
      userId: args.userId,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      purpose: 'REVERSAL',
      date: fromDbDate(original.entryDate),
      memo: args.memo,
      reversesEntryId: original.id,
      lines: original.lines.map((l) => ({
        ledgerAccountId: l.ledgerAccountId,
        debit: new Dec(l.credit.toString()),
        credit: new Dec(l.debit.toString()),
        financialAccountId: l.financialAccountId,
        categoryId: l.categoryId,
      })),
    });
    return entryId;
  }

  /**
   * Saldo (cargos − abonos) por cuenta contable, opcionalmente dentro de un rango de fechas.
   * `excludeOpening`: omite los saldos iniciales (no son movimientos de dinero del periodo).
   */
  async balances(
    tx: Tx,
    companyId: string,
    ledgerAccountIds: string[],
    range?: { from?: string; to?: string; excludeOpening?: boolean },
  ): Promise<Map<string, Dec>> {
    const result = new Map(ledgerAccountIds.map((id) => [id, new Dec(0)]));
    if (ledgerAccountIds.length === 0) return result;
    const rows = await tx.$queryRaw<{ id: string; balance: string }[]>`
      SELECT l.ledger_account_id::text AS id, SUM(l.debit - l.credit)::text AS balance
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.company_id = ${companyId}::uuid
        AND l.ledger_account_id = ANY(${ledgerAccountIds}::uuid[])
        ${range?.from ? Prisma.sql`AND e.entry_date >= ${range.from}::date` : Prisma.empty}
        ${range?.to ? Prisma.sql`AND e.entry_date <= ${range.to}::date` : Prisma.empty}
        ${range?.excludeOpening ? Prisma.sql`AND e.purpose <> 'OPENING'` : Prisma.empty}
      GROUP BY l.ledger_account_id`;
    for (const r of rows) result.set(r.id, new Dec(r.balance));
    return result;
  }

  /** Suma (cargos − abonos) de todas las cuentas contables de un tipo dentro de un rango. */
  async totalByType(
    tx: Tx,
    companyId: string,
    type: LedgerAccountType,
    range: { from: string; to: string },
  ): Promise<Dec> {
    const [row] = await tx.$queryRaw<{ total: string | null }[]>`
      SELECT SUM(l.debit - l.credit)::text AS total
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.entry_id
      JOIN ledger_accounts a ON a.id = l.ledger_account_id
      WHERE l.company_id = ${companyId}::uuid
        AND a.type = ${type}::"LedgerAccountType"
        AND e.entry_date BETWEEN ${range.from}::date AND ${range.to}::date`;
    return new Dec(row?.total ?? 0);
  }

  /**
   * Verificación del libro: todos los asientos cuadran y cada movimiento tiene exactamente
   * los asientos que su estado exige. Base de la conciliación nocturna (Fase 6).
   */
  async verify(tx: Tx, companyId: string): Promise<LedgerVerificationDto> {
    const unbalanced = await tx.$queryRaw<{ id: string }[]>`
      SELECT e.id::text AS id
      FROM journal_entries e
      LEFT JOIN journal_lines l ON l.entry_id = e.id
      WHERE e.company_id = ${companyId}::uuid
      GROUP BY e.id
      HAVING COUNT(l.id) < 2 OR COALESCE(SUM(l.debit), 0) <> COALESCE(SUM(l.credit), 0)`;
    const entries = await tx.journalEntry.count({ where: { companyId } });
    // Confirmado: MAIN sin REVERSAL. Anulado tras confirmarse: MAIN + REVERSAL. Nunca confirmado: ninguno.
    const inconsistent = await tx.$queryRaw<{ id: string }[]>`
      SELECT t.id::text AS id
      FROM financial_transactions t
      LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE purpose = 'MAIN') AS main,
               COUNT(*) FILTER (WHERE purpose = 'REVERSAL') AS reversal
        FROM journal_entries e
        WHERE e.company_id = t.company_id AND e.source_type = 'TRANSACTION' AND e.source_id = t.id
      ) j ON true
      WHERE t.company_id = ${companyId}::uuid
        AND NOT (
          (t.status = 'POSTED' AND j.main = 1 AND j.reversal = 0)
          OR (t.status = 'VOIDED' AND t.posted_at IS NOT NULL AND j.main = 1 AND j.reversal = 1)
          OR (t.status IN ('PENDING_REVIEW', 'VOIDED') AND t.posted_at IS NULL AND j.main = 0 AND j.reversal = 0)
        )`;
    return {
      balanced: unbalanced.length === 0,
      entries,
      unbalancedEntryIds: unbalanced.map((r) => r.id),
      consistent: inconsistent.length === 0,
      inconsistentTransactionIds: inconsistent.map((r) => r.id),
    };
  }
}
