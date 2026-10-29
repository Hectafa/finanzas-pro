import type { RoleDto } from '@finanzas/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
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

async function createRole(actor: TestUser, name: string, permissions: string[]): Promise<RoleDto> {
  const res = await ctx
    .http()
    .post('/v1/roles')
    .set(inCompany(actor, companyId))
    .send({ name, permissions });
  if (res.status !== 201)
    throw new Error(`Crear rol falló: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as RoleDto;
}

/** Agrega un miembro como Empleado y luego le asigna el rol indicado. */
async function memberWithRole(email: string, roleId: string): Promise<TestUser> {
  const user = await addMember(ctx, owner, companyId, email, 'EMPLOYEE');
  const membership = await ctx.owner.companyMembership.findFirstOrThrow({
    where: { userId: user.id, companyId },
  });
  const res = await ctx
    .http()
    .patch(`/v1/members/${membership.id}/role`)
    .set(inCompany(owner, companyId))
    .send({ roleId });
  if (res.status !== 204) throw new Error(`Asignar rol falló: ${res.status}`);
  return user;
}

const membershipOf = (userId: string) =>
  ctx.owner.companyMembership.findFirstOrThrow({ where: { userId, companyId } });

describe('edición de roles personalizados', () => {
  it('renombra, cambia descripción y permisos; los miembros reciben el cambio en la siguiente solicitud', async () => {
    const role = await createRole(owner, 'Cajero', ['sales:view', 'sales:create']);
    const cashier = await memberWithRole('caja@cafe.mx', role.id);
    expect(
      (await ctx.http().get('/v1/dashboard/summary').set(inCompany(cashier, companyId))).status,
    ).toBe(403);

    const res = await ctx
      .http()
      .patch(`/v1/roles/${role.id}`)
      .set(inCompany(owner, companyId))
      .send({
        version: role.version,
        name: 'Cajero principal',
        description: 'Turno matutino',
        permissions: ['sales:view', 'dashboard:view'],
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Cajero principal',
      description: 'Turno matutino',
      permissions: ['dashboard:view', 'sales:view'],
      version: role.version + 1,
      memberCount: 1,
    });

    expect(
      (await ctx.http().get('/v1/dashboard/summary').set(inCompany(cashier, companyId))).status,
    ).toBe(200);
    const current = await ctx
      .http()
      .get('/v1/companies/current')
      .set(inCompany(cashier, companyId));
    expect(current.body.permissions).not.toContain('sales:create');

    const audit = await ctx.owner.auditLog.findFirstOrThrow({
      where: { companyId, action: 'role.updated' },
    });
    expect(audit.data).toMatchObject({
      previousName: 'Cajero',
      name: 'Cajero principal',
      addedPermissions: ['dashboard:view'],
      removedPermissions: ['sales:create'],
    });
  });

  it('rechaza una versión desactualizada (otra persona editó el rol)', async () => {
    const role = await createRole(owner, 'Cajero', ['sales:view']);
    const first = await ctx
      .http()
      .patch(`/v1/roles/${role.id}`)
      .set(inCompany(owner, companyId))
      .send({ version: role.version, name: 'A' });
    expect(first.status).toBe(200);
    const stale = await ctx
      .http()
      .patch(`/v1/roles/${role.id}`)
      .set(inCompany(owner, companyId))
      .send({ version: role.version, name: 'B' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('dos ediciones simultáneas con la misma versión: solo una se aplica', async () => {
    const role = await createRole(owner, 'Cajero', ['sales:view']);
    const send = (permissions: string[]) =>
      ctx
        .http()
        .patch(`/v1/roles/${role.id}`)
        .set(inCompany(owner, companyId))
        .send({ version: role.version, permissions });
    const statuses = (await Promise.all([send(['sales:create']), send(['dashboard:view'])]))
      .map((r) => r.status)
      .sort();
    expect(statuses).toEqual([200, 409]);
    const stored = await ctx.owner.role.findUniqueOrThrow({
      where: { id: role.id },
      include: { permissions: true },
    });
    expect(stored.version).toBe(role.version + 1);
    expect(stored.permissions).toHaveLength(1);
  });

  it('valida la entrada: sin cambios, sin permisos o con permisos inventados', async () => {
    const role = await createRole(owner, 'Cajero', ['sales:view']);
    const url = `/v1/roles/${role.id}`;
    expect(
      (await ctx.http().patch(url).set(inCompany(owner, companyId)).send({ version: 1 })).status,
    ).toBe(400);
    expect(
      (
        await ctx
          .http()
          .patch(url)
          .set(inCompany(owner, companyId))
          .send({ version: 1, permissions: [] })
      ).status,
    ).toBe(400);
    const invented = await ctx
      .http()
      .patch(url)
      .set(inCompany(owner, companyId))
      .send({ version: 1, permissions: ['super:admin'] });
    expect(invented.body.error.code).toBe('INVALID_PERMISSION');
  });

  it('un nombre repetido (sin distinguir mayúsculas) responde 409', async () => {
    await createRole(owner, 'Barista', ['sales:view']);
    const role = await createRole(owner, 'Cajero', ['sales:view']);
    const res = await ctx
      .http()
      .patch(`/v1/roles/${role.id}`)
      .set(inCompany(owner, companyId))
      .send({ version: role.version, name: 'BARISTA' });
    expect(res.status).toBe(409);
  });

  it('los roles del sistema no se editan ni se archivan', async () => {
    const employee = await systemRole(ctx, owner, companyId, 'EMPLOYEE');
    const edit = await ctx
      .http()
      .patch(`/v1/roles/${employee.id}`)
      .set(inCompany(owner, companyId))
      .send({ version: employee.version, permissions: ['users:manage'] });
    expect(edit.status).toBe(403);
    expect(
      (await ctx.http().post(`/v1/roles/${employee.id}/archive`).set(inCompany(owner, companyId)))
        .status,
    ).toBe(403);
  });
});

describe('prevención de escalamiento al editar roles', () => {
  let manager: TestUser;
  let managerRole: RoleDto;

  beforeEach(async () => {
    managerRole = await createRole(owner, 'Gerente', [
      'users:view',
      'users:manage',
      'sales:view',
      'sales:create',
    ]);
    manager = await memberWithRole('gerente@cafe.mx', managerRole.id);
  });

  it('no puede agregar a un rol permisos que no tiene', async () => {
    const cashier = await createRole(owner, 'Cajero', ['sales:view']);
    const res = await ctx
      .http()
      .patch(`/v1/roles/${cashier.id}`)
      .set(inCompany(manager, companyId))
      .send({ version: cashier.version, permissions: ['sales:view', 'payroll:view'] });
    expect(res.status).toBe(403);
    // Sí puede ajustar dentro de sus propios permisos.
    const ok = await ctx
      .http()
      .patch(`/v1/roles/${cashier.id}`)
      .set(inCompany(manager, companyId))
      .send({ version: cashier.version, permissions: ['sales:view', 'sales:create'] });
    expect(ok.status).toBe(200);
  });

  it('no puede editar ni archivar un rol que tiene permisos que él no tiene', async () => {
    const accountantLike = await createRole(owner, 'Auxiliar contable', [
      'sales:view',
      'reports:view',
    ]);
    const edit = await ctx
      .http()
      .patch(`/v1/roles/${accountantLike.id}`)
      .set(inCompany(manager, companyId))
      .send({ version: accountantLike.version, permissions: ['sales:view'] });
    expect(edit.status).toBe(403);
    expect(
      (
        await ctx
          .http()
          .post(`/v1/roles/${accountantLike.id}/archive`)
          .set(inCompany(manager, companyId))
      ).status,
    ).toBe(403);
  });

  it('no puede editar el rol que él mismo tiene', async () => {
    const res = await ctx
      .http()
      .patch(`/v1/roles/${managerRole.id}`)
      .set(inCompany(manager, companyId))
      .send({ version: managerRole.version, name: 'Supergerente' });
    expect(res.status).toBe(403);
  });

  it('sin users:manage no se pueden editar roles', async () => {
    const admin = await addMember(ctx, owner, companyId, 'admin@cafe.mx', 'ADMIN');
    const cashier = await createRole(owner, 'Cajero', ['sales:view']);
    const res = await ctx
      .http()
      .patch(`/v1/roles/${cashier.id}`)
      .set(inCompany(admin, companyId))
      .send({ version: cashier.version, name: 'X' });
    expect(res.status).toBe(403);
  });
});

describe('archivo de roles', () => {
  it('no se archiva un rol asignado; tras reasignar se archiva, desaparece y libera su nombre', async () => {
    const role = await createRole(owner, 'Cajero', ['sales:view']);
    const cashier = await memberWithRole('caja@cafe.mx', role.id);

    const blocked = await ctx
      .http()
      .post(`/v1/roles/${role.id}/archive`)
      .set(inCompany(owner, companyId));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('ROLE_IN_USE');

    const employee = await systemRole(ctx, owner, companyId, 'EMPLOYEE');
    await ctx
      .http()
      .patch(`/v1/members/${(await membershipOf(cashier.id)).id}/role`)
      .set(inCompany(owner, companyId))
      .send({ roleId: employee.id });
    expect(
      (await ctx.http().post(`/v1/roles/${role.id}/archive`).set(inCompany(owner, companyId)))
        .status,
    ).toBe(204);

    const roles = (await ctx.http().get('/v1/roles').set(inCompany(owner, companyId)))
      .body as RoleDto[];
    expect(roles.map((r) => r.id)).not.toContain(role.id);
    // Ya no se puede asignar, editar ni volver a archivar.
    const assign = await ctx
      .http()
      .patch(`/v1/members/${(await membershipOf(cashier.id)).id}/role`)
      .set(inCompany(owner, companyId))
      .send({ roleId: role.id });
    expect(assign.status).toBe(404);
    expect(
      (
        await ctx
          .http()
          .patch(`/v1/roles/${role.id}`)
          .set(inCompany(owner, companyId))
          .send({ version: 2, name: 'X' })
      ).status,
    ).toBe(404);
    expect(
      (await ctx.http().post(`/v1/roles/${role.id}/archive`).set(inCompany(owner, companyId)))
        .status,
    ).toBe(404);
    // El nombre queda libre.
    expect(
      (
        await ctx
          .http()
          .post('/v1/roles')
          .set(inCompany(owner, companyId))
          .send({ name: 'cajero', permissions: ['sales:view'] })
      ).status,
    ).toBe(201);
  });

  it('también lo bloquea un miembro revocado (lo recuperaría al reactivarse)', async () => {
    const role = await createRole(owner, 'Cajero', ['sales:view']);
    const cashier = await memberWithRole('caja@cafe.mx', role.id);
    await ctx
      .http()
      .post(`/v1/members/${(await membershipOf(cashier.id)).id}/revoke`)
      .set(inCompany(owner, companyId));
    expect(
      (await ctx.http().post(`/v1/roles/${role.id}/archive`).set(inCompany(owner, companyId)))
        .status,
    ).toBe(409);
  });

  it('cancela las invitaciones pendientes con ese rol y registra la auditoría', async () => {
    const role = await createRole(owner, 'Cajero', ['sales:view']);
    await ctx
      .http()
      .post('/v1/invitations')
      .set(inCompany(owner, companyId))
      .send({ email: 'nuevo@cafe.mx', roleId: role.id });
    expect(
      (await ctx.http().post(`/v1/roles/${role.id}/archive`).set(inCompany(owner, companyId)))
        .status,
    ).toBe(204);

    const invitation = await ctx.owner.invitation.findFirstOrThrow({
      where: { email: 'nuevo@cafe.mx' },
    });
    expect(invitation.status).toBe('REVOKED');
    const audit = await ctx.owner.auditLog.findFirstOrThrow({
      where: { companyId, action: 'role.archived' },
    });
    expect(audit.data).toMatchObject({ name: 'Cajero', revokedInvitations: 1 });
    const verify = await ctx.http().get('/v1/audit/verify').set(inCompany(owner, companyId));
    expect(verify.body.valid).toBe(true);
  });

  it('archivar y asignar al mismo tiempo: nunca queda un miembro con un rol archivado', async () => {
    const role = await createRole(owner, 'Cajero', ['sales:view']);
    const emp = await addMember(ctx, owner, companyId, 'emp@cafe.mx', 'EMPLOYEE');
    const membership = await membershipOf(emp.id);
    await Promise.all([
      ctx.http().post(`/v1/roles/${role.id}/archive`).set(inCompany(owner, companyId)),
      ctx
        .http()
        .patch(`/v1/members/${membership.id}/role`)
        .set(inCompany(owner, companyId))
        .send({ roleId: role.id }),
    ]);
    const stored = await ctx.owner.role.findUniqueOrThrow({ where: { id: role.id } });
    const assigned = await ctx.owner.companyMembership.count({ where: { roleId: role.id } });
    expect(stored.archivedAt !== null && assigned > 0).toBe(false);
  });
});
