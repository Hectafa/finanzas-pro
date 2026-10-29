import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { z } from 'zod';
import { Errors } from '../common/errors';
import { COMPANY_SCOPE, type AppRequest } from '../common/request-context';
import { DbService } from '../db/db.service';

const companyIdSchema = z.uuid();

/**
 * Para rutas con @Authorize(...): exige X-Company-Id, membresía ACTIVA del usuario en esa
 * empresa y los permisos requeridos. Los permisos se leen de la base de datos en cada
 * solicitud, así que revocar un acceso o cambiar un rol surte efecto inmediato.
 * Si el usuario no pertenece a la empresa responde 404 (no revela que exista).
 */
@Injectable()
export class CompanyAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DbService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(COMPANY_SCOPE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required === undefined) return true;

    const req = context.switchToHttp().getRequest<AppRequest>();
    if (!req.auth) throw Errors.unauthorized();

    const parsed = companyIdSchema.safeParse(req.headers['x-company-id']);
    if (!parsed.success) throw Errors.badRequest('COMPANY_REQUIRED', 'Selecciona una empresa');
    const companyId = parsed.data;
    const { userId } = req.auth;

    const membership = await this.db.tenant({ companyId, userId }, (tx) =>
      tx.companyMembership.findUnique({
        where: { companyId_userId: { companyId, userId } },
        select: {
          id: true,
          status: true,
          roleId: true,
          role: { select: { archivedAt: true, permissions: { select: { permissionKey: true } } } },
        },
      }),
    );
    if (!membership || membership.status !== 'ACTIVE' || membership.role.archivedAt) {
      throw Errors.notFound('Empresa no encontrada');
    }

    const permissions = new Set(membership.role.permissions.map((p) => p.permissionKey));
    if (!required.every((p) => permissions.has(p))) throw Errors.forbidden();

    req.tenant = { ...req.auth, companyId, membershipId: membership.id, roleId: membership.roleId, permissions };
    return true;
  }
}
