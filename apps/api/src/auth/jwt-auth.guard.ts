import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Errors } from '../common/errors';
import { IS_PUBLIC, type AppRequest } from '../common/request-context';
import { DbService } from '../db/db.service';
import { TokenService } from './token.service';

/**
 * Guarda global: toda ruta requiere token salvo @Public().
 * Además de la firma, verifica en base de datos que la sesión siga vigente, de modo que
 * cerrar sesión o restablecer la contraseña invalida el acceso de inmediato.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly db: DbService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) {
      return true;
    }
    const req = context.switchToHttp().getRequest<AppRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw Errors.unauthorized();

    let payload;
    try {
      payload = await this.tokens.verifyAccess(header.slice(7).trim());
    } catch {
      throw Errors.sessionExpired();
    }

    const session = await this.db.client.session.findUnique({
      where: { id: payload.sid },
      select: { userId: true, revokedAt: true, expiresAt: true, user: { select: { status: true } } },
    });
    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.status !== 'ACTIVE'
    ) {
      throw Errors.sessionExpired();
    }

    req.auth = { userId: payload.sub, sessionId: payload.sid, requestId: req.id ? String(req.id) : undefined };
    return true;
  }
}
