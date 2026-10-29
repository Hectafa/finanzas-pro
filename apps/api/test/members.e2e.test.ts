import type { CompanyContextDto, MemberDto } from '@finanzas/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  bearer,
  createCompany,
  createTestContext,
  inCompany,
  registerUser,
  resetDatabase,
  systemRole,
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
  owner = await registerUser(ctx, 'duena@cafe.mx', 'Dueña');
  companyId = (await createCompany(ctx, owner, 'Café Central')).id;
});

const membershipOf = async (userId: string) =>
  ctx.owner.companyMembership.findFirstOrThrow({ where: { userId, companyId } });

describe('creación de empresa', () => {
  it('el creador queda como Propietario con todos los permisos y se crea la sucursal principal', async () => {
    const res = await ctx.http().get('/v1/companies/current').set(inCompany(owner, companyId));
    const company = res.body as CompanyContextDto;
    expect(company.role.key).toBe('OWNER');
    expect(company.permissions).toContain('users:manage');
    const branches = await ctx.owner.branch.findMany({ where: { companyId } });
    expect(branches).toEqual([expect.objectContaining({ name: 'Principal', isDefault: true })]);
  });

  it('valida RFC y zona horaria', async () => {
    const bad = await ctx.http().post('/v1/companies').set(bearer(owner)).send({ name: 'X', taxId: 'NOVALIDO', timeZone: 'Marte/Base' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(['taxId', 'timeZone']);
  });
});

describe('permisos por rol', () => {
  it('el empleado no ve miembros, roles, auditoría ni dashboard; sí ve su empresa', async () => {
    const emp = await addMember(ctx, owner, companyId, 'emp@cafe.mx', 'EMPLOYEE');
    for (const path of ['/v1/members', '/v1/roles', '/v1/audit', '/v1/dashboard/summary', '/v1/invitations']) {
      const res = await ctx.http().get(path).set(inCompany(emp, companyId));
      expect(res.status, path).toBe(403);
    }
    const current = await ctx.http().get('/v1/companies/current').set(inCompany(emp, companyId));
    expect(current.status).toBe(200);
    expect(current.body.permissions).not.toContain('users:view');
  });

  it('el administrador puede invitar empleados pero no propietarios ni contadores', async () => {
    const admin = await addMember(ctx, owner, companyId, 'admin@cafe.mx', 'ADMIN');
    const employeeRole = await systemRole(ctx, admin, companyId, 'EMPLOYEE');
    const ownerRole = await systemRole(ctx, admin, companyId, 'OWNER');
    const accountantRole = await systemRole(ctx, admin, companyId, 'ACCOUNTANT');

    const ok = await ctx.http().post('/v1/invitations').set(inCompany(admin, companyId)).send({ email: 'nuevo@cafe.mx', roleId: employeeRole.id });
    expect(ok.status).toBe(201);
    for (const role of [ownerRole, accountantRole]) {
      const res = await ctx.http().post('/v1/invitations').set(inCompany(admin, companyId)).send({ email: 'otro@cafe.mx', roleId: role.id });
      expect(res.status).toBe(403);
    }
  });

  it('el administrador no puede cambiar roles (requiere users:manage)', async () => {
    const admin = await addMember(ctx, owner, companyId, 'admin@cafe.mx', 'ADMIN');
    const emp = await addMember(ctx, owner, companyId, 'emp@cafe.mx', 'EMPLOYEE');
    const adminRole = await systemRole(ctx, owner, companyId, 'ADMIN');
    const res = await ctx.http()
      .patch(`/v1/members/${(await membershipOf(emp.id)).id}/role`)
      .set(inCompany(admin, companyId))
      .send({ roleId: adminRole.id });
    expect(res.status).toBe(403);
  });

  it('los cambios de rol y revocaciones surten efecto en la siguiente solicitud', async () => {
    const emp = await addMember(ctx, owner, companyId, 'emp@cafe.mx', 'EMPLOYEE');
    const accountant = await systemRole(ctx, owner, companyId, 'ACCOUNTANT');
    const membership = await membershipOf(emp.id);

    expect((await ctx.http().get('/v1/dashboard/summary').set(inCompany(emp, companyId))).status).toBe(403);
    await ctx.http().patch(`/v1/members/${membership.id}/role`).set(inCompany(owner, companyId)).send({ roleId: accountant.id });
    expect((await ctx.http().get('/v1/dashboard/summary').set(inCompany(emp, companyId))).status).toBe(200);

    expect((await ctx.http().post(`/v1/members/${membership.id}/revoke`).set(inCompany(owner, companyId))).status).toBe(204);
    expect((await ctx.http().get('/v1/companies/current').set(inCompany(emp, companyId))).status).toBe(404);
    expect((await ctx.http().get('/v1/companies').set(bearer(emp))).body).toEqual([]);

    expect((await ctx.http().post(`/v1/members/${membership.id}/reactivate`).set(inCompany(owner, companyId))).status).toBe(204);
    expect((await ctx.http().get('/v1/companies/current').set(inCompany(emp, companyId))).status).toBe(200);
  });
});

describe('prevención de escalamiento de privilegios', () => {
  it('nadie puede cambiar su propio rol', async () => {
    const accountant = await systemRole(ctx, owner, companyId, 'ACCOUNTANT');
    const res = await ctx.http()
      .patch(`/v1/members/${(await membershipOf(owner.id)).id}/role`)
      .set(inCompany(owner, companyId))
      .send({ roleId: accountant.id });
    expect(res.status).toBe(403);
  });

  it('campos extra como role o permissions en el registro se ignoran', async () => {
    const res = await ctx.http().post('/v1/auth/register').send({
      email: 'pirata@x.mx',
      password: 'clave-de-prueba-segura-2026',
      fullName: 'Pirata',
      role: 'OWNER',
      permissions: ['users:manage'],
      companyId,
    });
    expect(res.status).toBe(201);
    const pirate = { token: res.body.tokens.accessToken } as TestUser;
    expect((await ctx.http().get('/v1/companies/current').set(inCompany(pirate, companyId))).status).toBe(404);
  });

  it('un rol personalizado no puede incluir permisos que el creador no tiene ni permisos inventados', async () => {
    const invented = await ctx.http().post('/v1/roles').set(inCompany(owner, companyId)).send({ name: 'Raro', permissions: ['super:admin'] });
    expect(invented.status).toBe(400);
    expect(invented.body.error.code).toBe('INVALID_PERMISSION');

    const custom = await ctx.http().post('/v1/roles').set(inCompany(owner, companyId)).send({ name: 'Cajero', permissions: ['sales:create', 'sales:view'] });
    expect(custom.status).toBe(201);
    const dup = await ctx.http().post('/v1/roles').set(inCompany(owner, companyId)).send({ name: 'CAJERO', permissions: ['sales:view'] });
    expect(dup.status).toBe(409);
  });

  it('un administrador no puede revocar ni modificar a un propietario', async () => {
    const admin = await addMember(ctx, owner, companyId, 'admin@cafe.mx', 'ADMIN');
    const ownerMembership = await membershipOf(owner.id);
    // Necesita users:manage; además, el rol del objetivo excede sus permisos.
    expect((await ctx.http().post(`/v1/members/${ownerMembership.id}/revoke`).set(inCompany(admin, companyId))).status).toBe(403);
  });
});

describe('último propietario', () => {
  it('no se puede degradar ni revocar al único propietario', async () => {
    const second = await addMember(ctx, owner, companyId, 'socio@cafe.mx', 'OWNER');
    const adminRole = await systemRole(ctx, owner, companyId, 'ADMIN');
    // Con dos propietarios, uno puede degradar al otro.
    expect(
      (await ctx.http().patch(`/v1/members/${(await membershipOf(second.id)).id}/role`).set(inCompany(owner, companyId)).send({ roleId: adminRole.id })).status,
    ).toBe(204);
    // El socio (ahora admin) no puede tocar al único propietario restante.
    const res = await ctx.http().post(`/v1/members/${(await membershipOf(owner.id)).id}/revoke`).set(inCompany(second, companyId));
    expect(res.status).toBe(403);
  });

  it('dos propietarios degradándose al mismo tiempo: la empresa conserva al menos uno', async () => {
    const second = await addMember(ctx, owner, companyId, 'socio@cafe.mx', 'OWNER');
    const adminRole = await systemRole(ctx, owner, companyId, 'ADMIN');
    const [a, b] = await Promise.all([
      ctx.http().patch(`/v1/members/${(await membershipOf(second.id)).id}/role`).set(inCompany(owner, companyId)).send({ roleId: adminRole.id }),
      ctx.http().patch(`/v1/members/${(await membershipOf(owner.id)).id}/role`).set(inCompany(second, companyId)).send({ roleId: adminRole.id }),
    ]);
    const statuses = [a.status, b.status].sort();
    // Una solicitud gana; la otra falla (sin permiso tras el cambio, o LAST_OWNER).
    expect(statuses[0]).toBe(204);
    expect([403, 409]).toContain(statuses[1]);

    const owners = await ctx.owner.companyMembership.count({ where: { companyId, status: 'ACTIVE', role: { key: 'OWNER' } } });
    expect(owners).toBe(1);
  });
});

describe('invitaciones', () => {
  it('flujo completo: invitar, aceptar con el mismo correo y aparecer como miembro', async () => {
    const emp = await addMember(ctx, owner, companyId, 'Emp@Cafe.mx', 'EMPLOYEE');
    const members = (await ctx.http().get('/v1/members').set(inCompany(owner, companyId))).body as MemberDto[];
    expect(members.map((m) => [m.email, m.role.key])).toEqual([
      ['duena@cafe.mx', 'OWNER'],
      ['emp@cafe.mx', 'EMPLOYEE'],
    ]);
    const companies = await ctx.http().get('/v1/companies').set(bearer(emp));
    expect(companies.body.map((c: { id: string }) => c.id)).toEqual([companyId]);
  });

  it('el token no sirve para otra cuenta, ni dos veces, ni vencido, ni revocado', async () => {
    const role = await systemRole(ctx, owner, companyId, 'EMPLOYEE');
    await ctx.http().post('/v1/invitations').set(inCompany(owner, companyId)).send({ email: 'emp@cafe.mx', roleId: role.id });
    const token = tokenFromMail(ctx, 'emp@cafe.mx');
    const intruder = await registerUser(ctx, 'intruso@otro.mx');
    const mismatch = await ctx.http().post('/v1/invitations/accept').set(bearer(intruder)).send({ token });
    expect(mismatch.status).toBe(403);

    const emp = await registerUser(ctx, 'emp@cafe.mx');
    expect((await ctx.http().post('/v1/invitations/accept').set(bearer(emp)).send({ token })).status).toBe(200);
    expect((await ctx.http().post('/v1/invitations/accept').set(bearer(emp)).send({ token })).status).toBe(400);

    // Vencida
    await ctx.http().post('/v1/invitations').set(inCompany(owner, companyId)).send({ email: 'tarde@cafe.mx', roleId: role.id });
    const late = tokenFromMail(ctx, 'tarde@cafe.mx');
    await ctx.owner.invitation.updateMany({ where: { email: 'tarde@cafe.mx' }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const lateUser = await registerUser(ctx, 'tarde@cafe.mx');
    expect((await ctx.http().post('/v1/invitations/accept').set(bearer(lateUser)).send({ token: late })).status).toBe(400);

    // Revocada
    const inv = await ctx.http().post('/v1/invitations').set(inCompany(owner, companyId)).send({ email: 'revocada@cafe.mx', roleId: role.id });
    const revokedToken = tokenFromMail(ctx, 'revocada@cafe.mx');
    expect((await ctx.http().post(`/v1/invitations/${inv.body.id}/revoke`).set(inCompany(owner, companyId))).status).toBe(204);
    const revokedUser = await registerUser(ctx, 'revocada@cafe.mx');
    expect((await ctx.http().post('/v1/invitations/accept').set(bearer(revokedUser)).send({ token: revokedToken })).status).toBe(400);
  });

  it('reinvitar reemplaza la invitación pendiente; no se invita a quien ya es miembro', async () => {
    const role = await systemRole(ctx, owner, companyId, 'EMPLOYEE');
    await ctx.http().post('/v1/invitations').set(inCompany(owner, companyId)).send({ email: 'emp@cafe.mx', roleId: role.id });
    const first = tokenFromMail(ctx, 'emp@cafe.mx');
    await ctx.http().post('/v1/invitations').set(inCompany(owner, companyId)).send({ email: 'emp@cafe.mx', roleId: role.id });
    const list = await ctx.http().get('/v1/invitations').set(inCompany(owner, companyId));
    expect(list.body.map((i: { status: string }) => i.status).sort()).toEqual(['PENDING', 'REVOKED']);

    const emp = await registerUser(ctx, 'emp@cafe.mx');
    expect((await ctx.http().post('/v1/invitations/accept').set(bearer(emp)).send({ token: first })).status).toBe(400);
    expect((await ctx.http().post('/v1/invitations/accept').set(bearer(emp)).send({ token: tokenFromMail(ctx, 'emp@cafe.mx') })).status).toBe(200);

    const again = await ctx.http().post('/v1/invitations').set(inCompany(owner, companyId)).send({ email: 'emp@cafe.mx', roleId: role.id });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_MEMBER');
  });

  it('el token de invitación se guarda solo como hash', async () => {
    const role = await systemRole(ctx, owner, companyId, 'EMPLOYEE');
    await ctx.http().post('/v1/invitations').set(inCompany(owner, companyId)).send({ email: 'emp@cafe.mx', roleId: role.id });
    const token = tokenFromMail(ctx, 'emp@cafe.mx');
    const stored = await ctx.owner.invitation.findFirstOrThrow({ where: { email: 'emp@cafe.mx' } });
    expect(stored.tokenHash).not.toBe(token);
    expect(stored.tokenHash).toHaveLength(64);
  });
});
