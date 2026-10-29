import { Injectable } from '@nestjs/common';
import {
  canGrant,
  isPermission,
  type CreateRoleInput,
  type MemberDto,
  type RoleDto,
} from '@finanzas/shared';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import type { TenantContext } from '../common/request-context';
import { DbService, type Tx } from '../db/db.service';
import { uuidv7 } from '../db/ids';
import { roleRef } from './mappers';

const permissionKeys = (role: { permissions: { permissionKey: string }[] }) =>
  role.permissions.map((p) => p.permissionKey);

/**
 * Miembros y roles de una empresa. Reglas anti-escalamiento:
 * - Nadie cambia su propio rol ni revoca su propio acceso.
 * - Solo se puede asignar un rol cuyos permisos el actor ya tiene, y solo se puede modificar
 *   a miembros cuyo rol actual no excede los permisos del actor.
 * - La empresa siempre conserva al menos un Propietario activo.
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(t: TenantContext): Promise<MemberDto[]> {
    const rows = await this.db.tenant(t, (tx) =>
      tx.companyMembership.findMany({
        where: { companyId: t.companyId },
        include: { user: { select: { email: true, fullName: true } }, role: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return rows.map((m) => ({
      id: m.id,
      userId: m.userId,
      email: m.user.email,
      fullName: m.user.fullName,
      status: m.status,
      role: roleRef(m.role),
      joinedAt: m.createdAt.toISOString(),
    }));
  }

  async changeRole(t: TenantContext, membershipId: string, roleId: string): Promise<void> {
    await this.db.tenant(t, async (tx) => {
      const target = await this.loadTarget(tx, t, membershipId);
      if (target.userId === t.userId) throw Errors.forbidden('No puedes cambiar tu propio rol');
      const newRole = await this.loadAssignableRole(tx, t, roleId);
      if (target.roleId === newRole.id) return;
      if (target.role.key === 'OWNER' && newRole.key !== 'OWNER') {
        await this.ensureAnotherOwner(tx, t.companyId, target.id);
      }
      await tx.companyMembership.update({
        where: { id: target.id },
        data: { roleId: newRole.id, updatedBy: t.userId, version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        companyId: t.companyId,
        actorUserId: t.userId,
        action: 'member.role_changed',
        entityType: 'CompanyMembership',
        entityId: target.id,
        data: { userId: target.userId, fromRoleId: target.roleId, toRoleId: newRole.id },
        requestId: t.requestId,
      });
    });
  }

  async setStatus(
    t: TenantContext,
    membershipId: string,
    status: 'ACTIVE' | 'REVOKED',
  ): Promise<void> {
    await this.db.tenant(t, async (tx) => {
      const target = await this.loadTarget(tx, t, membershipId);
      if (target.userId === t.userId) throw Errors.forbidden('No puedes cambiar tu propio acceso');
      if (target.status === status) return;
      if (status === 'REVOKED' && target.role.key === 'OWNER') {
        await this.ensureAnotherOwner(tx, t.companyId, target.id);
      }
      await tx.companyMembership.update({
        where: { id: target.id },
        data: {
          status,
          revokedAt: status === 'REVOKED' ? new Date() : null,
          updatedBy: t.userId,
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        companyId: t.companyId,
        actorUserId: t.userId,
        action: status === 'REVOKED' ? 'member.revoked' : 'member.reactivated',
        entityType: 'CompanyMembership',
        entityId: target.id,
        data: { userId: target.userId },
        requestId: t.requestId,
      });
    });
  }

  async listRoles(t: TenantContext): Promise<RoleDto[]> {
    const roles = await this.db.tenant(t, (tx) =>
      tx.role.findMany({
        where: { archivedAt: null, OR: [{ companyId: null }, { companyId: t.companyId }] },
        include: { permissions: true },
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      }),
    );
    return roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      permissions: permissionKeys(r).sort(),
    }));
  }

  async createRole(t: TenantContext, input: CreateRoleInput): Promise<RoleDto> {
    const permissions = [...new Set(input.permissions)];
    const invalid = permissions.filter((p) => !isPermission(p));
    if (invalid.length)
      throw Errors.badRequest('INVALID_PERMISSION', `Permisos desconocidos: ${invalid.join(', ')}`);
    if (!canGrant(t.permissions, permissions)) {
      throw Errors.forbidden('No puedes crear un rol con permisos que tú no tienes');
    }
    return this.db.tenant(t, async (tx) => {
      const role = await tx.role.create({
        data: {
          id: uuidv7(),
          companyId: t.companyId,
          name: input.name,
          description: input.description ?? null,
          isSystem: false,
          createdBy: t.userId,
        },
      });
      await tx.rolePermission.createMany({
        data: permissions.map((permissionKey) => ({ roleId: role.id, permissionKey })),
      });
      await this.audit.record(tx, {
        companyId: t.companyId,
        actorUserId: t.userId,
        action: 'role.created',
        entityType: 'Role',
        entityId: role.id,
        data: { name: role.name, permissions },
        requestId: t.requestId,
      });
      return {
        id: role.id,
        key: null,
        name: role.name,
        description: role.description,
        isSystem: false,
        permissions: permissions.sort(),
      };
    });
  }

  /** Rol visible para la empresa y que el actor tiene derecho a otorgar. */
  async loadAssignableRole(tx: Tx, t: TenantContext, roleId: string) {
    const role = await tx.role.findFirst({
      where: {
        id: roleId,
        archivedAt: null,
        OR: [{ companyId: null }, { companyId: t.companyId }],
      },
      include: { permissions: true },
    });
    if (!role) throw Errors.notFound('Rol no encontrado');
    if (!canGrant(t.permissions, permissionKeys(role))) {
      throw Errors.forbidden('No puedes asignar un rol con permisos que tú no tienes');
    }
    return role;
  }

  private async loadTarget(tx: Tx, t: TenantContext, membershipId: string) {
    const target = await tx.companyMembership.findFirst({
      where: { id: membershipId, companyId: t.companyId },
      include: { role: { include: { permissions: true } } },
    });
    if (!target) throw Errors.notFound('Miembro no encontrado');
    if (!canGrant(t.permissions, permissionKeys(target.role))) {
      throw Errors.forbidden('No puedes modificar a un miembro con más permisos que tú');
    }
    return target;
  }

  /** Bloquea las membresías de Propietario para que dos cambios simultáneos no dejen la empresa sin dueño. */
  private async ensureAnotherOwner(
    tx: Tx,
    companyId: string,
    excludingMembershipId: string,
  ): Promise<void> {
    const owners = await tx.$queryRaw<{ id: string }[]>`
      SELECT m.id FROM company_memberships m
      JOIN roles r ON r.id = m.role_id
      WHERE m.company_id = ${companyId}::uuid AND m.status = 'ACTIVE' AND r.key = 'OWNER'
      FOR UPDATE OF m`;
    if (!owners.some((o) => o.id !== excludingMembershipId)) {
      throw Errors.conflict(
        'LAST_OWNER',
        'La empresa debe conservar al menos un Propietario activo',
      );
    }
  }
}
