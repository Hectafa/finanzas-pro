import type { CategoryNature, FinancialAccountType } from '@finanzas/shared';
import type { Tx } from '../db/db.service';
import { uuidv7 } from '../db/ids';
import type { LedgerAccountType } from '../generated/prisma/client';

/**
 * Plan de cuentas interno. El usuario no lo administra: nace de sus cuentas de dinero y
 * categorías, más unas cuentas de sistema que los asientos usan por su clave.
 */
export const SYSTEM_LEDGER_ACCOUNTS = {
  VAT_RECEIVABLE: { code: '1180', name: 'IVA acreditable', type: 'ASSET' },
  VAT_PAYABLE: { code: '2110', name: 'IVA trasladado', type: 'LIABILITY' },
  OPENING_BALANCE: { code: '3100', name: 'Saldos iniciales', type: 'EQUITY' },
  OWNER_CAPITAL: { code: '3200', name: 'Aportaciones de socios', type: 'EQUITY' },
  OWNER_DRAWINGS: { code: '3300', name: 'Retiros de socios', type: 'EQUITY' },
} as const satisfies Record<string, { code: string; name: string; type: LedgerAccountType }>;

export type SystemLedgerKey = keyof typeof SYSTEM_LEDGER_ACCOUNTS;
export type SystemLedgerIds = Record<SystemLedgerKey, string>;

/** Prefijo de código contable por tipo de cuenta de dinero y por naturaleza de categoría. */
const FINANCIAL_PREFIX: Record<FinancialAccountType, string> = {
  CASH: '1110',
  BANK: '1120',
  DIGITAL_WALLET: '1130',
  TERMINAL: '1140',
};
const CATEGORY_PREFIX: Record<CategoryNature, string> = { INCOME: '4100', EXPENSE: '6100' };

export const DEFAULT_CATEGORIES: readonly { name: string; nature: CategoryNature }[] = [
  { name: 'Ventas', nature: 'INCOME' },
  { name: 'Otros ingresos', nature: 'INCOME' },
  { name: 'Insumos y mercancía', nature: 'EXPENSE' },
  { name: 'Renta', nature: 'EXPENSE' },
  { name: 'Servicios (luz, agua, gas, internet)', nature: 'EXPENSE' },
  { name: 'Sueldos y honorarios', nature: 'EXPENSE' },
  { name: 'Mantenimiento', nature: 'EXPENSE' },
  { name: 'Publicidad', nature: 'EXPENSE' },
  { name: 'Transporte y envíos', nature: 'EXPENSE' },
  { name: 'Comisiones bancarias', nature: 'EXPENSE' },
  { name: 'Impuestos y derechos', nature: 'EXPENSE' },
  { name: 'Otros gastos', nature: 'EXPENSE' },
];

/** Serializa la creación de cuentas contables de una empresa (los códigos son consecutivos). */
async function lockChart(tx: Tx, companyId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`chart:${companyId}`}, 0))`;
}

/** Siguiente código libre bajo un prefijo: 1110.001, 1110.002… */
async function nextCode(tx: Tx, companyId: string, prefix: string): Promise<string> {
  const rows = await tx.ledgerAccount.findMany({
    where: { companyId, code: { startsWith: `${prefix}.` } },
    select: { code: true },
  });
  const max = rows.reduce((m, r) => Math.max(m, Number(r.code.slice(prefix.length + 1)) || 0), 0);
  return `${prefix}.${String(max + 1).padStart(3, '0')}`;
}

async function createLedgerAccount(
  tx: Tx,
  companyId: string,
  prefix: string,
  name: string,
  type: LedgerAccountType,
): Promise<string> {
  await lockChart(tx, companyId);
  const id = uuidv7();
  await tx.ledgerAccount.create({
    data: {
      id,
      companyId,
      code: await nextCode(tx, companyId, prefix),
      name: name.slice(0, 120),
      type,
    },
  });
  return id;
}

export const createFinancialLedgerAccount = (
  tx: Tx,
  companyId: string,
  type: FinancialAccountType,
  name: string,
) => createLedgerAccount(tx, companyId, FINANCIAL_PREFIX[type], name, 'ASSET');

export const createCategoryLedgerAccount = (
  tx: Tx,
  companyId: string,
  nature: CategoryNature,
  name: string,
) =>
  createLedgerAccount(
    tx,
    companyId,
    CATEGORY_PREFIX[nature],
    name,
    nature === 'INCOME' ? 'INCOME' : 'EXPENSE',
  );

/** Cuentas de sistema de la empresa; crea las que falten (idempotente). */
export async function systemLedgerAccounts(tx: Tx, companyId: string): Promise<SystemLedgerIds> {
  const keys = Object.keys(SYSTEM_LEDGER_ACCOUNTS) as SystemLedgerKey[];
  let rows = await tx.ledgerAccount.findMany({
    where: { companyId, systemKey: { in: keys } },
    select: { id: true, systemKey: true },
  });
  if (rows.length < keys.length) {
    await lockChart(tx, companyId);
    const present = new Set(
      (
        await tx.ledgerAccount.findMany({
          where: { companyId, systemKey: { in: keys } },
          select: { systemKey: true },
        })
      ).map((r) => r.systemKey),
    );
    const missing = keys.filter((k) => !present.has(k));
    if (missing.length) {
      await tx.ledgerAccount.createMany({
        data: missing.map((systemKey) => ({
          id: uuidv7(),
          companyId,
          systemKey,
          ...SYSTEM_LEDGER_ACCOUNTS[systemKey],
        })),
      });
    }
    rows = await tx.ledgerAccount.findMany({
      where: { companyId, systemKey: { in: keys } },
      select: { id: true, systemKey: true },
    });
  }
  return Object.fromEntries(rows.map((r) => [r.systemKey, r.id])) as SystemLedgerIds;
}

/**
 * Configuración financiera inicial de una empresa: cuentas de sistema y, si aún no tiene
 * categorías, las predeterminadas. Idempotente: se usa al crear la empresa y en el seed.
 */
export async function ensureCompanyFinance(
  tx: Tx,
  companyId: string,
  userId: string | null,
): Promise<void> {
  await systemLedgerAccounts(tx, companyId);
  if ((await tx.transactionCategory.count({ where: { companyId } })) > 0) return;
  for (const c of DEFAULT_CATEGORIES) {
    const ledgerAccountId = await createCategoryLedgerAccount(tx, companyId, c.nature, c.name);
    await tx.transactionCategory.create({
      data: {
        id: uuidv7(),
        companyId,
        name: c.name,
        nature: c.nature,
        ledgerAccountId,
        createdBy: userId,
      },
    });
  }
}
