import type {
  CategoryDto,
  DashboardSummaryDto,
  FinancialAccountDto,
  LedgerVerificationDto,
  TransactionDto,
  TransactionPageDto,
} from '@finanzas/shared';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/db/ids';
import { todayIn } from '@finanzas/shared';
import {
  addMember,
  createCompany,
  createTestContext,
  inCompany,
  registerUser,
  resetDatabase,
  type TestContext,
  type TestUser,
} from './helpers';

const TZ = 'America/Mexico_City';
const today = () => todayIn(TZ);

let ctx: TestContext;
let owner: TestUser;
let companyId: string;
let categories: CategoryDto[];

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx);
  owner = await registerUser(ctx, 'duena@cafe.mx', 'Dueña');
  companyId = (await createCompany(ctx, owner, 'Café Central')).id;
  categories = (await ctx.http().get('/v1/categories').set(inCompany(owner, companyId))).body;
});

const as = (user: TestUser) => inCompany(user, companyId);
const category = (name: string) => categories.find((c) => c.name === name)!;

async function createAccount(
  name: string,
  type = 'CASH',
  openingBalance = '0',
): Promise<FinancialAccountDto> {
  const res = await ctx
    .http()
    .post('/v1/accounts')
    .set(as(owner))
    .send({ name, type, openingBalance });
  if (res.status !== 201)
    throw new Error(`Crear cuenta falló: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

function send(user: TestUser, body: Record<string, unknown>) {
  return ctx
    .http()
    .post('/v1/transactions')
    .set(as(user))
    .send({ id: uuidv7(), date: today(), ...body });
}

async function record(user: TestUser, body: Record<string, unknown>): Promise<TransactionDto> {
  const res = await send(user, body);
  if (res.status !== 201)
    throw new Error(`Registrar falló: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

const income = (accountId: string, amount: string, extra: Record<string, unknown> = {}) => ({
  type: 'INCOME',
  accountId,
  categoryId: category('Ventas').id,
  amount,
  ...extra,
});
const expense = (accountId: string, amount: string, extra: Record<string, unknown> = {}) => ({
  type: 'EXPENSE',
  accountId,
  categoryId: category('Renta').id,
  amount,
  ...extra,
});

async function balances(user = owner): Promise<Record<string, string | null>> {
  const res = await ctx.http().get('/v1/accounts').set(as(user));
  return Object.fromEntries((res.body as FinancialAccountDto[]).map((a) => [a.name, a.balance]));
}

async function dashboard(query = 'period=month'): Promise<DashboardSummaryDto> {
  return (await ctx.http().get(`/v1/dashboard/summary?${query}`).set(as(owner))).body;
}

async function verifyLedger(): Promise<LedgerVerificationDto> {
  return (await ctx.http().get('/v1/ledger/verify').set(as(owner))).body;
}

async function journalOf(transactionId: string) {
  return ctx.owner.journalEntry.findMany({
    where: { sourceType: 'TRANSACTION', sourceId: transactionId },
    include: { lines: { orderBy: { lineNo: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  });
}

describe('configuración inicial', () => {
  it('una empresa nueva trae categorías predeterminadas y cuentas contables de sistema', async () => {
    expect(categories.filter((c) => c.nature === 'INCOME').map((c) => c.name)).toEqual([
      'Otros ingresos',
      'Ventas',
    ]);
    expect(categories.filter((c) => c.nature === 'EXPENSE')).toHaveLength(10);
    const system = await ctx.owner.ledgerAccount.findMany({
      where: { companyId, systemKey: { not: null } },
    });
    expect(system.map((a) => a.systemKey).sort()).toEqual([
      'OPENING_BALANCE',
      'OWNER_CAPITAL',
      'OWNER_DRAWINGS',
      'VAT_PAYABLE',
      'VAT_RECEIVABLE',
    ]);
  });

  it('el saldo inicial de una cuenta se registra como asiento y cuadra', async () => {
    await createAccount('Caja', 'CASH', '1500.50');
    expect(await balances()).toEqual({ Caja: '1500.50' });
    const d = await dashboard();
    expect(d.metrics.availableCash).toMatchObject({ value: '1500.50', status: 'CONFIRMED' });
    // El saldo inicial no es ingreso.
    expect(d.metrics.income.value).toBe('0.00');
    expect(await verifyLedger()).toMatchObject({ balanced: true, consistent: true, entries: 1 });
  });

  it('sin cuentas, el dashboard pide agregar una', async () => {
    const d = await dashboard();
    expect(d.metrics.availableCash.status).toBe('NOT_AVAILABLE');
    expect(d.metrics.receivables.status).toBe('NOT_AVAILABLE');
  });
});

describe('reglas de contabilización', () => {
  let caja: FinancialAccountDto;
  let banco: FinancialAccountDto;
  beforeEach(async () => {
    caja = await createAccount('Caja', 'CASH', '1000.00');
    banco = await createAccount('Banco', 'BANK', '5000.00');
  });

  it('ingreso con IVA: el ingreso es neto de IVA y el IVA va a su cuenta', async () => {
    const t = await record(owner, income(caja.id, '116.00', { vatRate: '16' }));
    expect(t).toMatchObject({
      status: 'POSTED',
      amount: '116.00',
      vatAmount: '16.00',
      vatRate: '16',
    });

    const [entry] = await journalOf(t.id);
    expect(entry!.lines.map((l) => [l.debit.toFixed(2), l.credit.toFixed(2)])).toEqual([
      ['116.00', '0.00'],
      ['0.00', '100.00'],
      ['0.00', '16.00'],
    ]);
    expect((await balances()).Caja).toBe('1116.00');
    const d = await dashboard();
    expect(d.metrics.income.value).toBe('100.00');
    expect(d.metrics.netCashFlow.value).toBe('116.00');
  });

  it('gasto con IVA: el gasto es neto de IVA', async () => {
    await record(owner, expense(banco.id, '1160.00', { vatRate: '16' }));
    expect((await balances()).Banco).toBe('3840.00');
    expect((await dashboard()).metrics.expenses.value).toBe('1000.00');
  });

  it('transferencia: ni ingreso ni gasto, el disponible total no cambia', async () => {
    const before = await dashboard();
    await record(owner, {
      type: 'TRANSFER',
      accountId: banco.id,
      toAccountId: caja.id,
      amount: '700.00',
    });
    const after = await dashboard();
    expect(await balances()).toEqual({ Caja: '1700.00', Banco: '4300.00' });
    expect(after.metrics.income.value).toBe('0.00');
    expect(after.metrics.expenses.value).toBe('0.00');
    expect(after.metrics.availableCash.value).toBe(before.metrics.availableCash.value);
    expect(after.metrics.netCashFlow.value).toBe(before.metrics.netCashFlow.value);
  });

  it('el dinero en terminal se reporta como por depositar, no como disponible', async () => {
    const terminal = await createAccount('Terminal', 'TERMINAL');
    await record(owner, income(terminal.id, '500.00'));
    const d = await dashboard();
    expect(d.metrics.availableCash.value).toBe('6000.00');
    expect(d.metrics.undeposited.value).toBe('500.00');
    expect(d.metrics.income.value).toBe('500.00');
    // Al depositar (transferencia terminal → banco) el ingreso no se cuenta otra vez.
    await record(owner, {
      type: 'TRANSFER',
      accountId: terminal.id,
      toAccountId: banco.id,
      amount: '500.00',
    });
    const after = await dashboard();
    expect(after.metrics.availableCash.value).toBe('6500.00');
    expect(after.metrics.undeposited.value).toBe('0.00');
    expect(after.metrics.income.value).toBe('500.00');
  });

  it('aportaciones y retiros de socios mueven el dinero sin afectar ingresos ni gastos', async () => {
    await record(owner, { type: 'OWNER_CONTRIBUTION', accountId: banco.id, amount: '10000.00' });
    await record(owner, { type: 'OWNER_WITHDRAWAL', accountId: caja.id, amount: '300.00' });
    const d = await dashboard();
    expect(d.metrics.income.value).toBe('0.00');
    expect(d.metrics.expenses.value).toBe('0.00');
    expect(d.metrics.availableCash.value).toBe('15700.00');
  });

  it('los ingresos y gastos se asignan al periodo de su fecha', async () => {
    const lastMonth = DateTime.now().setZone(TZ).startOf('month').minus({ days: 1 }).toISODate()!;
    await record(owner, income(caja.id, '400.00', { date: lastMonth }));
    await record(owner, income(caja.id, '100.00'));
    expect((await dashboard()).metrics.income.value).toBe('100.00');
    expect((await dashboard(`period=month&date=${lastMonth}`)).metrics.income.value).toBe('400.00');
    // El disponible es al día de hoy: incluye ambos.
    expect((await dashboard()).metrics.availableCash.value).toBe('6500.00');
  });

  it('importes extremos sin pérdida de precisión', async () => {
    await record(owner, income(banco.id, '999999999.99'));
    await record(owner, income(banco.id, '0.01'));
    expect((await balances()).Banco).toBe('1000005000.00');
    expect(await verifyLedger()).toMatchObject({ balanced: true, consistent: true });
  });
});

describe('idempotencia', () => {
  it('el mismo movimiento enviado 5 veces en paralelo se registra una sola vez', async () => {
    const caja = await createAccount('Caja');
    const body = { id: uuidv7(), date: today(), ...income(caja.id, '250.00') };
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        ctx.http().post('/v1/transactions').set(as(owner)).send(body),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    expect(await ctx.owner.financialTransaction.count({ where: { companyId } })).toBe(1);
    expect(await journalOf(body.id)).toHaveLength(1);
    expect((await balances()).Caja).toBe('250.00');
  });

  it('el mismo id con otro contenido se rechaza', async () => {
    const caja = await createAccount('Caja');
    const id = uuidv7();
    expect((await send(owner, { id, ...income(caja.id, '250.00') })).status).toBe(201);
    const altered = await send(owner, { id, ...income(caja.id, '2500.00') });
    expect(altered.status).toBe(409);
    expect(altered.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect((await balances()).Caja).toBe('250.00');
  });
});

describe('revisión de movimientos capturados por empleados', () => {
  let employee: TestUser;
  let caja: FinancialAccountDto;
  beforeEach(async () => {
    employee = await addMember(ctx, owner, companyId, 'emp@cafe.mx', 'EMPLOYEE');
    caja = await createAccount('Caja', 'CASH', '100.00');
  });

  it('queda por revisar, sin efecto en saldos, y se informa aparte en el dashboard', async () => {
    const t = await record(employee, expense(caja.id, '40.00'));
    expect(t.status).toBe('PENDING_REVIEW');
    expect(await journalOf(t.id)).toHaveLength(0);
    expect((await balances()).Caja).toBe('100.00');
    const d = await dashboard();
    expect(d.metrics.expenses.value).toBe('0.00');
    expect(d.pendingReview).toEqual({ count: 1, income: '0.00', expenses: '40.00' });
    expect(d.metrics.expenses.note).toContain('1 movimiento(s) por revisar');
  });

  it('al aprobarse se contabiliza una sola vez', async () => {
    const t = await record(employee, expense(caja.id, '40.00'));
    expect(
      (await ctx.http().post(`/v1/transactions/${t.id}/approve`).set(as(employee))).status,
    ).toBe(403);
    const approved = await ctx.http().post(`/v1/transactions/${t.id}/approve`).set(as(owner));
    expect(approved.body.status).toBe('POSTED');
    const again = await ctx.http().post(`/v1/transactions/${t.id}/approve`).set(as(owner));
    expect(again.status).toBe(200);
    expect(await journalOf(t.id)).toHaveLength(1);
    expect((await balances()).Caja).toBe('60.00');
    expect(await verifyLedger()).toMatchObject({ consistent: true });
  });

  it('el empleado ve solo sus movimientos y las cuentas sin saldo', async () => {
    const own = await record(employee, expense(caja.id, '10.00'));
    const others = await record(owner, income(caja.id, '20.00'));
    const list = (await ctx.http().get('/v1/transactions').set(as(employee)))
      .body as TransactionPageDto;
    expect(list.items.map((i) => i.id)).toEqual([own.id]);
    expect((await ctx.http().get(`/v1/transactions/${others.id}`).set(as(employee))).status).toBe(
      404,
    );
    expect(await balances(employee)).toEqual({ Caja: null });
    expect(
      (await ctx.http().post('/v1/accounts').set(as(employee)).send({ name: 'Mía', type: 'CASH' }))
        .status,
    ).toBe(403);
  });

  it('el autor corrige la descripción mientras está por revisar; después ya no', async () => {
    const t = await record(employee, expense(caja.id, '10.00', { description: 'renta' }));
    const fix = await ctx
      .http()
      .patch(`/v1/transactions/${t.id}`)
      .set(as(employee))
      .send({ version: t.version, description: 'Renta de octubre' });
    expect(fix.body.description).toBe('Renta de octubre');
    await ctx.http().post(`/v1/transactions/${t.id}/approve`).set(as(owner));
    const late = await ctx
      .http()
      .patch(`/v1/transactions/${t.id}`)
      .set(as(employee))
      .send({ version: fix.body.version + 1, notes: 'x' });
    expect(late.status).toBe(403);
  });
});

describe('anulación', () => {
  let caja: FinancialAccountDto;
  beforeEach(async () => {
    caja = await createAccount('Caja', 'CASH', '100.00');
  });

  it('un movimiento confirmado se revierte exactamente y deja de contar en su periodo', async () => {
    const t = await record(owner, income(caja.id, '58.00', { vatRate: '16' }));
    const res = await ctx
      .http()
      .post(`/v1/transactions/${t.id}/void`)
      .set(as(owner))
      .send({ reason: 'Capturado dos veces' });
    expect(res.body).toMatchObject({ status: 'VOIDED', voidReason: 'Capturado dos veces' });

    const [main, reversal] = await journalOf(t.id);
    expect(reversal!.purpose).toBe('REVERSAL');
    expect(reversal!.reversesEntryId).toBe(main!.id);
    expect(reversal!.entryDate).toEqual(main!.entryDate);
    expect(
      reversal!.lines.map((l) => [l.ledgerAccountId, l.debit.toFixed(2), l.credit.toFixed(2)]),
    ).toEqual(main!.lines.map((l) => [l.ledgerAccountId, l.credit.toFixed(2), l.debit.toFixed(2)]));
    expect((await balances()).Caja).toBe('100.00');
    expect((await dashboard()).metrics.income.value).toBe('0.00');
    expect(await verifyLedger()).toMatchObject({ balanced: true, consistent: true });

    // Anular otra vez no genera otra reversa; aprobar un anulado se rechaza.
    expect(
      (
        await ctx
          .http()
          .post(`/v1/transactions/${t.id}/void`)
          .set(as(owner))
          .send({ reason: 'otra vez' })
      ).status,
    ).toBe(200);
    expect(await journalOf(t.id)).toHaveLength(2);
    expect((await ctx.http().post(`/v1/transactions/${t.id}/approve`).set(as(owner))).status).toBe(
      409,
    );
  });

  it('rechazar uno por revisar no toca el libro', async () => {
    const employee = await addMember(ctx, owner, companyId, 'emp@cafe.mx', 'EMPLOYEE');
    const t = await record(employee, expense(caja.id, '30.00'));
    await ctx
      .http()
      .post(`/v1/transactions/${t.id}/void`)
      .set(as(owner))
      .send({ reason: 'No corresponde' });
    expect(await journalOf(t.id)).toHaveLength(0);
    expect(await verifyLedger()).toMatchObject({ consistent: true });
  });

  it('exige motivo y permiso', async () => {
    const t = await record(owner, income(caja.id, '10.00'));
    expect(
      (await ctx.http().post(`/v1/transactions/${t.id}/void`).set(as(owner)).send({ reason: '' }))
        .status,
    ).toBe(400);
    const employee = await addMember(ctx, owner, companyId, 'emp@cafe.mx', 'EMPLOYEE');
    expect(
      (
        await ctx
          .http()
          .post(`/v1/transactions/${t.id}/void`)
          .set(as(employee))
          .send({ reason: 'porque sí' })
      ).status,
    ).toBe(403);
  });
});

describe('validaciones', () => {
  let caja: FinancialAccountDto;
  beforeEach(async () => {
    caja = await createAccount('Caja');
  });

  const fieldOf = (res: { body: { error: { details?: { path: string }[] } } }) =>
    res.body.error.details?.map((d) => d.path);

  it('rechaza importes inválidos', async () => {
    for (const amount of ['0.00', '-5', '1.005', '1e3', '1,000.00']) {
      const res = await send(owner, income(caja.id, amount));
      expect(res.status, amount).toBe(400);
      expect(fieldOf(res)).toContain('amount');
    }
  });

  it('rechaza fechas futuras o inválidas', async () => {
    const tomorrow = DateTime.now().setZone(TZ).plus({ days: 1 }).toISODate();
    expect(fieldOf(await send(owner, income(caja.id, '1.00', { date: tomorrow })))).toEqual([
      'date',
    ]);
    expect(fieldOf(await send(owner, income(caja.id, '1.00', { date: '2026-02-30' })))).toEqual([
      'date',
    ]);
  });

  it('la categoría debe corresponder al tipo y la transferencia requiere dos cuentas distintas', async () => {
    const wrong = await send(owner, {
      ...income(caja.id, '1.00'),
      categoryId: category('Renta').id,
    });
    expect(fieldOf(wrong)).toEqual(['categoryId']);
    const same = await send(owner, {
      type: 'TRANSFER',
      accountId: caja.id,
      toAccountId: caja.id,
      amount: '1.00',
    });
    expect(fieldOf(same)).toEqual(['toAccountId']);
  });

  it('no acepta cuentas o categorías de otra empresa (sin revelar que existen)', async () => {
    const other = await registerUser(ctx, 'otro@x.mx');
    const otherCompany = (await createCompany(ctx, other, 'Otra')).id;
    const foreign = await ctx
      .http()
      .post('/v1/accounts')
      .set(inCompany(other, otherCompany))
      .send({ name: 'Ajena', type: 'CASH' });
    const res = await send(owner, income(foreign.body.id, '1.00'));
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { path: 'accountId', message: 'Cuenta no encontrada' },
    ]);
  });
});

describe('integridad del libro en la base de datos', () => {
  it('la API no puede modificar ni borrar asientos ni movimientos (append-only)', async () => {
    const caja = await createAccount('Caja', 'CASH', '50.00');
    const t = await record(owner, income(caja.id, '10.00'));
    const scope = { companyId, userId: owner.id };
    await expect(
      ctx.db.tenant(scope, (tx) => tx.$executeRaw`UPDATE journal_lines SET debit = debit + 1`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      ctx.db.tenant(scope, (tx) => tx.$executeRaw`DELETE FROM journal_entries`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      ctx.db.tenant(
        scope,
        (tx) => tx.$executeRaw`DELETE FROM financial_transactions WHERE id = ${t.id}::uuid`,
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('un asiento que no cuadra se rechaza al confirmar la transacción', async () => {
    const caja = await createAccount('Caja');
    const ledger = await ctx.owner.financialAccount.findUniqueOrThrow({ where: { id: caja.id } });
    const entryId = uuidv7();
    await expect(
      ctx.owner.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO journal_entries (id, company_id, entry_date, source_type, source_id, purpose, created_by)
          VALUES (${entryId}::uuid, ${companyId}::uuid, CURRENT_DATE, 'TEST', ${uuidv7()}::uuid, 'MAIN', ${owner.id}::uuid)`;
        await tx.$executeRaw`INSERT INTO journal_lines (id, entry_id, company_id, line_no, ledger_account_id, debit, credit)
          VALUES (${uuidv7()}::uuid, ${entryId}::uuid, ${companyId}::uuid, 1, ${ledger.ledgerAccountId}::uuid, 10, 0)`;
      }),
    ).rejects.toThrow(/no cuadra/);
    expect(await ctx.owner.journalEntry.count({ where: { id: entryId } })).toBe(0);
  });

  it('una línea no puede apuntar a una cuenta contable de otra empresa', async () => {
    const other = await registerUser(ctx, 'otro@x.mx');
    const otherCompany = (await createCompany(ctx, other, 'Otra')).id;
    const foreignLedger = await ctx.owner.ledgerAccount.findFirstOrThrow({
      where: { companyId: otherCompany },
    });
    const entryId = uuidv7();
    await expect(
      ctx.owner.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO journal_entries (id, company_id, entry_date, source_type, source_id, purpose, created_by)
          VALUES (${entryId}::uuid, ${companyId}::uuid, CURRENT_DATE, 'TEST', ${uuidv7()}::uuid, 'MAIN', ${owner.id}::uuid)`;
        await tx.$executeRaw`INSERT INTO journal_lines (id, entry_id, company_id, line_no, ledger_account_id, debit, credit)
          VALUES (${uuidv7()}::uuid, ${entryId}::uuid, ${companyId}::uuid, 1, ${foreignLedger.id}::uuid, 10, 0)`;
      }),
    ).rejects.toThrow(/empresa inconsistente/);
  });
});

describe('cuentas y categorías', () => {
  it('una cuenta con saldo no se archiva; vacía sí, y ya no se puede usar', async () => {
    const caja = await createAccount('Caja', 'CASH', '80.00');
    const banco = await createAccount('Banco', 'BANK');
    const blocked = await ctx.http().post(`/v1/accounts/${caja.id}/archive`).set(as(owner));
    expect(blocked.body.error.code).toBe('ACCOUNT_NOT_EMPTY');
    await record(owner, {
      type: 'TRANSFER',
      accountId: caja.id,
      toAccountId: banco.id,
      amount: '80.00',
    });
    expect((await ctx.http().post(`/v1/accounts/${caja.id}/archive`).set(as(owner))).status).toBe(
      204,
    );
    expect(Object.keys(await balances())).toEqual(['Banco']);
    const use = await send(owner, income(caja.id, '1.00'));
    expect(use.body.error.details).toEqual([
      { path: 'accountId', message: 'La cuenta está archivada' },
    ]);
    // El nombre queda libre.
    expect(
      (await ctx.http().post('/v1/accounts').set(as(owner)).send({ name: 'caja', type: 'CASH' }))
        .status,
    ).toBe(201);
  });

  it('renombrar una cuenta usa control de versión', async () => {
    const caja = await createAccount('Caja');
    const ok = await ctx
      .http()
      .patch(`/v1/accounts/${caja.id}`)
      .set(as(owner))
      .send({ version: caja.version, name: 'Caja chica' });
    expect(ok.body).toMatchObject({ name: 'Caja chica', version: caja.version + 1 });
    const stale = await ctx
      .http()
      .patch(`/v1/accounts/${caja.id}`)
      .set(as(owner))
      .send({ version: caja.version, name: 'Otra' });
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('subcategorías de un solo nivel y de la misma naturaleza', async () => {
    const renta = category('Renta');
    const sub = await ctx
      .http()
      .post('/v1/categories')
      .set(as(owner))
      .send({ name: 'Renta del local', nature: 'EXPENSE', parentId: renta.id });
    expect(sub.status).toBe(201);
    const deep = await ctx
      .http()
      .post('/v1/categories')
      .set(as(owner))
      .send({ name: 'X', nature: 'EXPENSE', parentId: sub.body.id });
    expect(deep.body.error.code).toBe('CATEGORY_DEPTH');
    const mixed = await ctx
      .http()
      .post('/v1/categories')
      .set(as(owner))
      .send({ name: 'X', nature: 'INCOME', parentId: renta.id });
    expect(mixed.body.error.code).toBe('CATEGORY_NATURE');
    expect(
      (await ctx.http().post(`/v1/categories/${renta.id}/archive`).set(as(owner))).body.error.code,
    ).toBe('CATEGORY_HAS_CHILDREN');
    const dup = await ctx
      .http()
      .post('/v1/categories')
      .set(as(owner))
      .send({ name: 'RENTA', nature: 'EXPENSE' });
    expect(dup.status).toBe(409);
  });

  it('un gasto en una categoría nueva aparece en su propia cuenta contable', async () => {
    const caja = await createAccount('Caja', 'CASH', '100.00');
    const gas = await ctx
      .http()
      .post('/v1/categories')
      .set(as(owner))
      .send({ name: 'Gas LP', nature: 'EXPENSE' });
    const t = await record(owner, {
      type: 'EXPENSE',
      accountId: caja.id,
      categoryId: gas.body.id,
      amount: '45.00',
    });
    const [entry] = await journalOf(t.id);
    const ledger = await ctx.owner.transactionCategory.findUniqueOrThrow({
      where: { id: gas.body.id },
    });
    expect(entry!.lines.find((l) => l.debit.gt(0))!.ledgerAccountId).toBe(ledger.ledgerAccountId);
  });
});

describe('listado', () => {
  it('pagina sin repetir ni omitir, y filtra', async () => {
    const caja = await createAccount('Caja', 'CASH', '1000.00');
    const banco = await createAccount('Banco', 'BANK');
    const ids = [];
    for (let i = 0; i < 5; i++)
      ids.push(
        (await record(owner, income(caja.id, `${i + 1}.00`, { description: `Venta ${i}` }))).id,
      );
    ids.push(
      (
        await record(owner, {
          type: 'TRANSFER',
          accountId: caja.id,
          toAccountId: banco.id,
          amount: '10.00',
        })
      ).id,
    );

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: TransactionPageDto = (
        await ctx
          .http()
          .get(`/v1/transactions?limit=2${cursor ? `&cursor=${cursor}` : ''}`)
          .set(as(owner))
      ).body;
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(6);
    expect(new Set(seen)).toEqual(new Set(ids));

    const transfers = (await ctx.http().get('/v1/transactions?type=TRANSFER').set(as(owner)))
      .body as TransactionPageDto;
    expect(transfers.items).toHaveLength(1);
    const byBank = (await ctx.http().get(`/v1/transactions?accountId=${banco.id}`).set(as(owner)))
      .body as TransactionPageDto;
    expect(byBank.items.map((i) => i.type)).toEqual(['TRANSFER']);
    const search = (await ctx.http().get('/v1/transactions?q=venta%203').set(as(owner)))
      .body as TransactionPageDto;
    expect(search.items.map((i) => i.description)).toEqual(['Venta 3']);
    expect((await ctx.http().get('/v1/transactions?cursor=basura').set(as(owner))).status).toBe(
      400,
    );
  });
});
