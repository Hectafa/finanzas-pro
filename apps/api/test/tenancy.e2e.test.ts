import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/db/ids';
import {
  addMember,
  bearer,
  createCompany,
  createTestContext,
  inCompany,
  registerUser,
  resetDatabase,
  systemRole,
  type TestContext,
  type TestUser,
} from './helpers';

let ctx: TestContext;
let ana: TestUser;
let beto: TestUser;
let companyA: string;
let companyB: string;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx);
  ana = await registerUser(ctx, 'ana@empresa-a.mx');
  beto = await registerUser(ctx, 'beto@empresa-b.mx');
  companyA = (await createCompany(ctx, ana, 'Empresa A')).id;
  companyB = (await createCompany(ctx, beto, 'Empresa B')).id;
});

/** Todas las rutas con @Authorize. Si se agrega una nueva, debe agregarse aquí. */
const companyRoutes: Array<[method: 'get' | 'post' | 'patch', path: string, body?: object]> = [
  ['get', '/v1/companies/current'],
  ['patch', '/v1/companies/current', { name: 'Hackeada' }],
  ['get', '/v1/members'],
  ['patch', `/v1/members/${uuidv7()}/role`, { roleId: uuidv7() }],
  ['post', `/v1/members/${uuidv7()}/revoke`],
  ['post', `/v1/members/${uuidv7()}/reactivate`],
  ['get', '/v1/roles'],
  ['post', '/v1/roles', { name: 'X', permissions: ['dashboard:view'] }],
  ['patch', `/v1/roles/${uuidv7()}`, { version: 1, name: 'Hackeado' }],
  ['post', `/v1/roles/${uuidv7()}/archive`],
  ['get', '/v1/invitations'],
  ['post', '/v1/invitations', { email: 'x@y.mx', roleId: uuidv7() }],
  ['post', `/v1/invitations/${uuidv7()}/revoke`],
  ['get', '/v1/dashboard/summary'],
  ['get', '/v1/audit'],
  ['get', '/v1/audit/verify'],
  ['get', '/v1/accounts'],
  ['post', '/v1/accounts', { name: 'Caja', type: 'CASH' }],
  ['patch', `/v1/accounts/${uuidv7()}`, { version: 1, name: 'X' }],
  ['post', `/v1/accounts/${uuidv7()}/archive`],
  ['get', '/v1/categories'],
  ['post', '/v1/categories', { name: 'X', nature: 'EXPENSE' }],
  ['patch', `/v1/categories/${uuidv7()}`, { version: 1, name: 'X' }],
  ['post', `/v1/categories/${uuidv7()}/archive`],
  ['get', '/v1/transactions'],
  ['get', `/v1/transactions/${uuidv7()}`],
  [
    'post',
    '/v1/transactions',
    {
      id: uuidv7(),
      type: 'OWNER_CONTRIBUTION',
      date: '2026-01-01',
      amount: '1.00',
      accountId: uuidv7(),
    },
  ],
  ['patch', `/v1/transactions/${uuidv7()}`, { version: 1, notes: 'x' }],
  ['post', `/v1/transactions/${uuidv7()}/approve`],
  ['post', `/v1/transactions/${uuidv7()}/void`, { reason: 'prueba' }],
  ['get', '/v1/ledger/verify'],
];

describe('aislamiento entre empresas (API)', () => {
  it.each(companyRoutes)(
    '%s %s responde 404 a un usuario de otra empresa',
    async (method, path, body) => {
      const res = await ctx
        .http()
        [method](path)
        .set(inCompany(beto, companyA))
        .send(body ?? {});
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    },
  );

  it('cada usuario solo lista sus propias empresas', async () => {
    const res = await ctx.http().get('/v1/companies').set(bearer(beto));
    expect(res.body.map((c: { id: string }) => c.id)).toEqual([companyB]);
  });

  it('no se puede revocar ni cambiar el rol de un miembro de otra empresa usando la empresa propia', async () => {
    const employee = await addMember(ctx, ana, companyA, 'emp@empresa-a.mx', 'EMPLOYEE');
    const membershipA = await ctx.owner.companyMembership.findFirstOrThrow({
      where: { userId: employee.id, companyId: companyA },
    });
    const ownerRoleB = await systemRole(ctx, beto, companyB, 'OWNER');

    const revoke = await ctx
      .http()
      .post(`/v1/members/${membershipA.id}/revoke`)
      .set(inCompany(beto, companyB));
    expect(revoke.status).toBe(404);
    const role = await ctx
      .http()
      .patch(`/v1/members/${membershipA.id}/role`)
      .set(inCompany(beto, companyB))
      .send({ roleId: ownerRoleB.id });
    expect(role.status).toBe(404);

    const unchanged = await ctx.owner.companyMembership.findUniqueOrThrow({
      where: { id: membershipA.id },
    });
    expect(unchanged.status).toBe('ACTIVE');
  });

  it('un rol personalizado de otra empresa no puede asignarse', async () => {
    const custom = await ctx
      .http()
      .post('/v1/roles')
      .set(inCompany(beto, companyB))
      .send({ name: 'Cajero B', permissions: ['sales:create'] });
    expect(custom.status).toBe(201);
    const res = await ctx
      .http()
      .post('/v1/invitations')
      .set(inCompany(ana, companyA))
      .send({ email: 'x@y.mx', roleId: custom.body.id });
    expect(res.status).toBe(404);
  });

  it('un rol personalizado de otra empresa no puede editarse ni archivarse desde la empresa propia', async () => {
    const custom = await ctx
      .http()
      .post('/v1/roles')
      .set(inCompany(beto, companyB))
      .send({ name: 'Cajero B', permissions: ['sales:create'] });
    const edit = await ctx
      .http()
      .patch(`/v1/roles/${custom.body.id}`)
      .set(inCompany(ana, companyA))
      .send({ version: 1, permissions: ['users:manage'] });
    expect(edit.status).toBe(404);
    const archive = await ctx
      .http()
      .post(`/v1/roles/${custom.body.id}/archive`)
      .set(inCompany(ana, companyA));
    expect(archive.status).toBe(404);

    const unchanged = await ctx.owner.role.findUniqueOrThrow({
      where: { id: custom.body.id },
      include: { permissions: true },
    });
    expect(unchanged.archivedAt).toBeNull();
    expect(unchanged.permissions.map((p) => p.permissionKey)).toEqual(['sales:create']);
  });

  it('exige un X-Company-Id válido', async () => {
    const missing = await ctx.http().get('/v1/members').set(bearer(ana));
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('COMPANY_REQUIRED');
    const malformed = await ctx
      .http()
      .get('/v1/members')
      .set({ ...bearer(ana), 'X-Company-Id': "1' OR '1'='1" });
    expect(malformed.status).toBe(400);
  });
});

describe('aislamiento entre empresas (seguridad por fila en PostgreSQL)', () => {
  it('dentro del contexto de A, consultas SIN filtro por empresa solo ven datos de A', async () => {
    await addMember(ctx, beto, companyB, 'emp@empresa-b.mx', 'EMPLOYEE');

    const seen = await ctx.db.tenant({ companyId: companyA, userId: ana.id }, async (tx) => ({
      companies: await tx.company.findMany(),
      memberships: await tx.companyMembership.findMany(),
      invitations: await tx.invitation.findMany(),
      audit: await tx.auditLog.findMany(),
      branches: await tx.branch.findMany(),
    }));
    expect(seen.companies.map((c) => c.id)).toEqual([companyA]);
    expect(seen.memberships.every((m) => m.companyId === companyA)).toBe(true);
    expect(seen.invitations).toHaveLength(0);
    expect(seen.audit.every((a) => a.companyId === companyA)).toBe(true);
    expect(seen.branches.every((b) => b.companyId === companyA)).toBe(true);
  });

  it('sin contexto, el rol de la API no ve ningún dato de empresas', async () => {
    const companies = await ctx.db.client.company.findMany();
    const memberships = await ctx.db.client.companyMembership.findMany();
    expect(companies).toHaveLength(0);
    expect(memberships).toHaveLength(0);
  });

  it('no permite insertar ni mover filas hacia otra empresa', async () => {
    await expect(
      ctx.db.tenant({ companyId: companyA, userId: ana.id }, (tx) =>
        tx.branch.create({
          data: { id: uuidv7(), companyId: companyB, name: 'Intrusa', createdBy: ana.id },
        }),
      ),
    ).rejects.toThrow();

    const updated = await ctx.db.tenant({ companyId: companyA, userId: ana.id }, (tx) =>
      tx.company.updateMany({ where: { id: companyB }, data: { name: 'Hackeada' } }),
    );
    expect(updated.count).toBe(0);
    const b = await ctx.owner.company.findUniqueOrThrow({ where: { id: companyB } });
    expect(b.name).toBe('Empresa B');
  });

  it('la bitácora no puede modificarse ni borrarse con el rol de la API', async () => {
    await expect(
      ctx.db.tenant({ companyId: companyA, userId: ana.id }, (tx) =>
        tx.auditLog.updateMany({ data: { action: 'alterado' } }),
      ),
    ).rejects.toThrow();
    await expect(
      ctx.db.tenant({ companyId: companyA, userId: ana.id }, (tx) => tx.auditLog.deleteMany()),
    ).rejects.toThrow();
  });

  it('el catálogo de permisos es de solo lectura para la API', async () => {
    await expect(
      ctx.db.system((tx) =>
        tx.permission.create({ data: { key: 'super:admin', module: 'super', action: 'admin' } }),
      ),
    ).rejects.toThrow();
  });
});
