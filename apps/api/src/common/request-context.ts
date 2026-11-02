import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
  applyDecorators,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import type { Permission } from '@finanzas/shared';
import type { Request } from 'express';

export interface AuthContext {
  userId: string;
  sessionId: string;
  requestId?: string;
}

export interface TenantContext extends AuthContext {
  companyId: string;
  membershipId: string;
  roleId: string;
  permissions: ReadonlySet<string>;
}

export type AppRequest = Request & {
  id?: string | number;
  auth?: AuthContext;
  tenant?: TenantContext;
};

export const IS_PUBLIC = 'finanzas:isPublic';
export const COMPANY_SCOPE = 'finanzas:companyScope';
export const AUTH_RATE_LIMIT = 'finanzas:authRateLimit';

/** Ruta sin autenticación. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Aplica el límite estricto de solicitudes de autenticación (por IP). */
export const AuthRateLimit = () => SetMetadata(AUTH_RATE_LIMIT, true);

/**
 * Ruta dentro de una empresa (encabezado X-Company-Id). Exige membresía activa y todos los
 * permisos indicados, resueltos en el servidor desde la base de datos.
 */
export const Authorize = (...permissions: Permission[]) =>
  applyDecorators(
    SetMetadata(COMPANY_SCOPE, permissions),
    ApiHeader({ name: 'X-Company-Id', required: true, description: 'Empresa activa' }),
    ApiBearerAuth(),
  );

export const CurrentAuth = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthContext => {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    if (!req.auth) throw new Error('CurrentAuth usado en una ruta pública');
    return req.auth;
  },
);

export const CurrentTenant = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): TenantContext => {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    if (!req.tenant) throw new Error('CurrentTenant usado en una ruta sin @Authorize');
    return req.tenant;
  },
);
