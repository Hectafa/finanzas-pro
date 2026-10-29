import { Inject, Injectable } from '@nestjs/common';
import type {
  AuthResponse,
  AuthTokens,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  SessionDto,
  UserDto,
} from '@finanzas/shared';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import type { AuthContext } from '../common/request-context';
import { APP_ENV, type AppEnv } from '../config/env';
import { DbService, type Tx } from '../db/db.service';
import { newOpaqueToken, sha256Hex, uuidv7 } from '../db/ids';
import type { User } from '../generated/prisma/client';
import { Mailer } from '../mail/mailer';
import { burnPasswordCheck, hashPassword, verifyPassword } from './passwords';
import { TokenService } from './token.service';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const RESET_TOKEN_MINUTES = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly mailer: Mailer,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async register(input: RegisterInput, requestId?: string): Promise<AuthResponse> {
    const passwordHash = await hashPassword(input.password);
    const existing = await this.db.client.user.findUnique({ where: { email: input.email }, select: { id: true } });
    if (existing) throw Errors.conflict('EMAIL_UNAVAILABLE', 'No es posible registrarse con ese correo');

    return this.db.system(async (tx) => {
      const user = await tx.user.create({
        data: { id: uuidv7(), email: input.email, passwordHash, fullName: input.fullName },
      });
      const tokens = await this.openSession(tx, user.id, input.deviceName);
      await this.audit.record(tx, {
        companyId: null,
        actorUserId: user.id,
        action: 'auth.register',
        entityType: 'User',
        entityId: user.id,
        requestId,
      });
      return { user: toUserDto(user), tokens };
    });
  }

  async login(input: LoginInput, requestId?: string): Promise<AuthResponse> {
    const user = await this.db.client.user.findUnique({ where: { email: input.email } });
    if (!user) {
      await burnPasswordCheck(input.password);
      throw Errors.invalidCredentials();
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) throw Errors.accountLocked(user.lockedUntil);

    const valid = await verifyPassword(user.passwordHash, input.password);
    if (!valid || user.status !== 'ACTIVE') {
      await this.db.system(async (tx) => {
        const failed = user.failedLoginCount + 1;
        const lock = failed >= MAX_FAILED_LOGINS;
        await tx.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: lock ? 0 : failed,
            lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
          },
        });
        await this.audit.record(tx, {
          companyId: null,
          actorUserId: user.id,
          action: lock ? 'auth.login_locked' : 'auth.login_failed',
          entityType: 'User',
          entityId: user.id,
          requestId,
        });
      });
      throw Errors.invalidCredentials();
    }

    return this.db.system(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
      const tokens = await this.openSession(tx, user.id, input.deviceName);
      await this.audit.record(tx, {
        companyId: null,
        actorUserId: user.id,
        action: 'auth.login',
        entityType: 'Session',
        entityId: tokens.sessionId,
        requestId,
      });
      return { user: toUserDto(user), tokens };
    });
  }

  /**
   * Rotación de refresh token: cada token se usa una sola vez. Si llega uno ya usado,
   * se asume robo y se revoca la sesión completa.
   */
  async refresh(refreshToken: string, requestId?: string): Promise<AuthTokens> {
    const tokenHash = sha256Hex(refreshToken);
    const result = await this.db.system(async (tx) => {
      const stored = await tx.refreshToken.findUnique({ where: { tokenHash }, include: { session: true } });
      if (!stored) return { error: 'invalid' as const };
      const { session } = stored;
      const now = new Date();
      if (session.revokedAt || session.expiresAt <= now || stored.expiresAt <= now) return { error: 'invalid' as const };

      const claimed = await tx.refreshToken.updateMany({ where: { id: stored.id, usedAt: null }, data: { usedAt: now } });
      if (claimed.count === 0) {
        await tx.session.update({ where: { id: session.id }, data: { revokedAt: now, revokedReason: 'REFRESH_REUSE' } });
        await this.audit.record(tx, {
          companyId: null,
          actorUserId: session.userId,
          action: 'auth.refresh_reuse_detected',
          entityType: 'Session',
          entityId: session.id,
          requestId,
        });
        return { error: 'reuse' as const };
      }
      await tx.session.update({ where: { id: session.id }, data: { lastUsedAt: now } });
      return { tokens: await this.issueTokens(tx, session.userId, session.id, session.expiresAt) };
    });
    if ('error' in result) throw Errors.sessionExpired();
    return result.tokens;
  }

  async logout(auth: AuthContext): Promise<void> {
    await this.db.system(async (tx) => {
      await tx.session.updateMany({
        where: { id: auth.sessionId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'LOGOUT' },
      });
      await this.audit.record(tx, {
        companyId: null,
        actorUserId: auth.userId,
        action: 'auth.logout',
        entityType: 'Session',
        entityId: auth.sessionId,
        requestId: auth.requestId,
      });
    });
  }

  async logoutAll(auth: AuthContext): Promise<void> {
    await this.db.system(async (tx) => {
      await tx.session.updateMany({
        where: { userId: auth.userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'LOGOUT_ALL' },
      });
      await this.audit.record(tx, {
        companyId: null,
        actorUserId: auth.userId,
        action: 'auth.logout_all',
        entityType: 'User',
        entityId: auth.userId,
        requestId: auth.requestId,
      });
    });
  }

  async listSessions(auth: AuthContext): Promise<SessionDto[]> {
    const sessions = await this.db.client.session.findMany({
      where: { userId: auth.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      deviceName: s.deviceName,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      current: s.id === auth.sessionId,
    }));
  }

  async revokeSession(auth: AuthContext, sessionId: string): Promise<void> {
    await this.db.system(async (tx) => {
      const { count } = await tx.session.updateMany({
        where: { id: sessionId, userId: auth.userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'REVOKED_BY_USER' },
      });
      if (count === 0) throw Errors.notFound('Sesión no encontrada');
      await this.audit.record(tx, {
        companyId: null,
        actorUserId: auth.userId,
        action: 'auth.session_revoked',
        entityType: 'Session',
        entityId: sessionId,
        requestId: auth.requestId,
      });
    });
  }

  /** Siempre responde igual, exista o no el correo. */
  async forgotPassword(email: string, requestId?: string): Promise<void> {
    const user = await this.db.client.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') return;

    const { token, hash } = newOpaqueToken();
    await this.db.system(async (tx) => {
      await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
      await tx.passwordResetToken.create({
        data: { id: uuidv7(), userId: user.id, tokenHash: hash, expiresAt: new Date(Date.now() + RESET_TOKEN_MINUTES * 60_000) },
      });
      await this.audit.record(tx, {
        companyId: null,
        actorUserId: user.id,
        action: 'auth.password_reset_requested',
        entityType: 'User',
        entityId: user.id,
        requestId,
      });
    });

    const link = `${this.env.APP_LINK_BASE}reset-password?token=${token}`;
    await this.mailer.send({
      to: user.email,
      subject: 'Restablece tu contraseña de Finanzas Pro',
      text:
        `Hola ${user.fullName}:\n\nPara crear una nueva contraseña abre este enlace desde tu teléfono ` +
        `(válido ${RESET_TOKEN_MINUTES} minutos):\n\n${link}\n\nSi no lo solicitaste, ignora este mensaje.`,
    });
  }

  async resetPassword(input: ResetPasswordInput, requestId?: string): Promise<void> {
    const passwordHash = await hashPassword(input.password);
    const tokenHash = sha256Hex(input.token);
    const ok = await this.db.system(async (tx) => {
      const now = new Date();
      const stored = await tx.passwordResetToken.findUnique({ where: { tokenHash } });
      if (!stored || stored.usedAt || stored.expiresAt <= now) return false;
      const claimed = await tx.passwordResetToken.updateMany({ where: { id: stored.id, usedAt: null }, data: { usedAt: now } });
      if (claimed.count === 0) return false;

      await tx.user.update({
        where: { id: stored.userId },
        data: { passwordHash, passwordChangedAt: now, failedLoginCount: 0, lockedUntil: null },
      });
      await tx.session.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: now, revokedReason: 'PASSWORD_RESET' },
      });
      await this.audit.record(tx, {
        companyId: null,
        actorUserId: stored.userId,
        action: 'auth.password_reset',
        entityType: 'User',
        entityId: stored.userId,
        requestId,
      });
      return true;
    });
    if (!ok) throw Errors.badRequest('RESET_TOKEN_INVALID', 'El enlace no es válido o ya expiró');
  }

  async me(userId: string): Promise<UserDto> {
    const user = await this.db.client.user.findUniqueOrThrow({ where: { id: userId } });
    return toUserDto(user);
  }

  private async openSession(tx: Tx, userId: string, deviceName?: string): Promise<AuthTokens> {
    const session = await tx.session.create({
      data: {
        id: uuidv7(),
        userId,
        deviceName: deviceName ?? null,
        expiresAt: new Date(Date.now() + this.env.SESSION_MAX_DAYS * DAY_MS),
      },
    });
    return this.issueTokens(tx, userId, session.id, session.expiresAt);
  }

  private async issueTokens(tx: Tx, userId: string, sessionId: string, sessionExpiresAt: Date): Promise<AuthTokens> {
    const { token, hash } = newOpaqueToken();
    const refreshExpiresAt = new Date(
      Math.min(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * DAY_MS, sessionExpiresAt.getTime()),
    );
    await tx.refreshToken.create({ data: { id: uuidv7(), sessionId, tokenHash: hash, expiresAt: refreshExpiresAt } });
    const access = await this.tokens.signAccess(userId, sessionId);
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken: token,
      refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
      sessionId,
    };
  }
}

function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}
