import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { APP_ENV, type AppEnv } from '../config/env';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
}

const ISSUER = 'finanzas-pro-api';
const AUDIENCE = 'finanzas-pro-app';

/** Token de acceso JWT (HS256, vida corta). Solo identifica usuario y sesión: nunca roles ni permisos. */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async signAccess(userId: string, sessionId: string): Promise<{ token: string; expiresAt: Date }> {
    const ttl = this.env.ACCESS_TOKEN_TTL_SECONDS;
    const token = await this.jwt.signAsync({ sub: userId, sid: sessionId } satisfies AccessTokenPayload, {
      secret: this.env.JWT_ACCESS_SECRET,
      algorithm: 'HS256',
      expiresIn: ttl,
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return { token, expiresAt: new Date(Date.now() + ttl * 1000) };
  }

  /** Lanza si el token es inválido o expiró. */
  async verifyAccess(token: string): Promise<AccessTokenPayload> {
    const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
      secret: this.env.JWT_ACCESS_SECRET,
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') throw new Error('Token sin sujeto');
    return payload;
  }
}
