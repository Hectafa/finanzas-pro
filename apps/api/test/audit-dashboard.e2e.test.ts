import type { DashboardSummaryDto } from '@finanzas/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PASSWORD,
  addMember,
  createCompany,
  createTestContext,
  inCompany,
  registerUser,
  resetDatabase,
  tokenFromMail,
  type TestContext,
  type TestUser,
} from './helpers';

let ctx: TestContext;
let owner: TestUser;
let companyId: string;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx);
  owner = await registerUser(ctx, 'duena@cafe.mx');
  companyId = (await createCompany(ctx, owner, 'Café Central')).id;
});

describe('bitácora de auditoría', () => {
  it('registra quién hizo qué, en orden, y la cadena de hashes es válida', async () => {
    await addMember(ctx, owner, companyId, 'emp@cafe.mx', 'EMPLOYEE');
    await ctx.http().patch('/v1/companies/current').set(inCompany(owner, companyId)).send({ name: 'Café Central 2' });

    const list = await ctx.http().get('/v1/audit').set(inCompany(owner, companyId));
    expect(list.body.map((e: { action: string }) => e.action)).toEqual([
      'company.updated',
      'invitation.accepted',
      'invitation.created',
      'company.created',
    ]);
    expect(list.body[0].actorUserId).toBe(owner.id);

    const verify = await ctx.http().get('/v1/audit/verify').set(inCompany(owner, companyId));
    expect(verify.body).toEqual({ valid: true, checked: 4, firstInvalidSeq: null });
  });

  it('detecta una alteración hecha directamente en la base de datos', async () => {
    await ctx.http().patch('/v1/companies/current').set(inCompany(owner, companyId)).send({ name: 'Otro nombre' });
    const first = await ctx.owner.auditLog.findFirstOrThrow({ where: { companyId }, orderBy: { seq: 'asc' } });
    // Solo el rol dueño (no la API) puede hacer esto; simula una manipulación externa.
    await ctx.owner.auditLog.update({ where: { id: first.id }, data: { actorUserId: null } });

    const verify = await ctx.http().get('/v1/audit/verify').set(inCompany(owner, companyId));
    expect(verify.body.valid).toBe(false);
    expect(verify.body.firstInvalidSeq).toBe(first.seq.toString());
  });

  it('nunca guarda contraseñas ni tokens en la bitácora', async () => {
    await ctx.http().post('/v1/auth/forgot-password').send({ email: 'duena@cafe.mx' });
    const resetToken = tokenFromMail(ctx, 'duena@cafe.mx');
    const rows = await ctx.owner.auditLog.findMany();
    const dump = JSON.stringify(rows, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
    expect(rows.some((r) => r.action === 'auth.password_reset_requested')).toBe(true);
    for (const secret of [PASSWORD, resetToken, owner.refreshToken, owner.token]) {
      expect(dump).not.toContain(secret);
    }
  });

  it('escrituras concurrentes mantienen la cadena íntegra', async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        ctx.http().patch('/v1/companies/current').set(inCompany(owner, companyId)).send({ name: `Nombre ${i}` }),
      ),
    );
    const verify = await ctx.http().get('/v1/audit/verify').set(inCompany(owner, companyId));
    expect(verify.body).toEqual({ valid: true, checked: 9, firstInvalidSeq: null });
  });
});

describe('dashboard', () => {
  it('devuelve el periodo en la zona horaria de la empresa y no inventa cifras', async () => {
    const res = await ctx.http().get('/v1/dashboard/summary?period=month&date=2026-02-10').set(inCompany(owner, companyId));
    expect(res.status).toBe(200);
    const body = res.body as DashboardSummaryDto;
    expect(body.period.fromDate).toBe('2026-02-01');
    expect(body.period.toDate).toBe('2026-02-28');
    expect(body.currency).toBe('MXN');
    for (const metric of Object.values(body.metrics)) {
      expect(metric).toMatchObject({ value: null, status: 'NOT_AVAILABLE' });
    }
    expect(body.team).toEqual({ activeMembers: 1, pendingInvitations: 0 });
  });

  it('acepta periodo personalizado y rechaza periodos inválidos', async () => {
    const ok = await ctx.http().get('/v1/dashboard/summary?period=custom&from=2026-01-01&to=2026-03-31').set(inCompany(owner, companyId));
    expect(ok.body.period.toDate).toBe('2026-03-31');
    const inverted = await ctx.http().get('/v1/dashboard/summary?period=custom&from=2026-03-01&to=2026-01-01').set(inCompany(owner, companyId));
    expect(inverted.status).toBe(400);
    expect(inverted.body.error.code).toBe('INVALID_PERIOD');
    const missing = await ctx.http().get('/v1/dashboard/summary?period=custom').set(inCompany(owner, companyId));
    expect(missing.status).toBe(400);
  });
});
