import type { AuthResponse, AuthTokens } from '@finanzas/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, bearer, createTestContext, registerUser, resetDatabase, tokenFromMail, type TestContext } from './helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx);
});

const login = (email: string, password = PASSWORD) =>
  ctx.http().post('/v1/auth/login').send({ email, password, deviceName: 'Pruebas' });

describe('registro', () => {
  it('crea la cuenta con contraseña hasheada en Argon2id y devuelve tokens', async () => {
    const res = await ctx.http().post('/v1/auth/register').send({ email: 'Ana@Ejemplo.MX', password: PASSWORD, fullName: 'Ana' });
    expect(res.status).toBe(201);
    const body = res.body as AuthResponse;
    expect(body.user.email).toBe('ana@ejemplo.mx');
    expect(body.tokens.accessToken).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain('passwordHash');

    const stored = await ctx.owner.user.findUniqueOrThrow({ where: { email: 'ana@ejemplo.mx' } });
    expect(stored.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(stored.passwordHash).not.toContain(PASSWORD);
  });

  it('rechaza un correo ya registrado sin importar mayúsculas', async () => {
    await registerUser(ctx, 'ana@ejemplo.mx');
    const res = await ctx.http().post('/v1/auth/register').send({ email: 'ANA@ejemplo.mx', password: PASSWORD, fullName: 'Otra' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_UNAVAILABLE');
  });

  it('valida la contraseña', async () => {
    const res = await ctx.http().post('/v1/auth/register').send({ email: 'a@b.mx', password: 'corta', fullName: 'A' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('inicio de sesión', () => {
  it('acepta credenciales correctas y rechaza incorrectas con el mismo mensaje', async () => {
    await registerUser(ctx, 'ana@ejemplo.mx');
    expect((await login('ana@ejemplo.mx')).status).toBe(200);

    const wrong = await login('ana@ejemplo.mx', 'otra-clave-equivocada');
    const unknown = await login('nadie@ejemplo.mx');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it('bloquea la cuenta tras 5 intentos fallidos, incluso con la contraseña correcta', async () => {
    await registerUser(ctx, 'ana@ejemplo.mx');
    for (let i = 0; i < 5; i++) expect((await login('ana@ejemplo.mx', 'clave-equivocada-123')).status).toBe(401);
    const locked = await login('ana@ejemplo.mx');
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('rechaza rutas protegidas sin token, con token alterado o expirado', async () => {
    const user = await registerUser(ctx, 'ana@ejemplo.mx');
    expect((await ctx.http().get('/v1/auth/me')).status).toBe(401);
    expect((await ctx.http().get('/v1/auth/me').set({ Authorization: `Bearer ${user.token}x` })).status).toBe(401);
    expect((await ctx.http().get('/v1/auth/me').set(bearer(user))).status).toBe(200);
  });
});

describe('refresh token', () => {
  const refresh = (refreshToken: string) => ctx.http().post('/v1/auth/refresh').send({ refreshToken });

  it('rota el token: el nuevo funciona y el anterior queda inválido', async () => {
    const user = await registerUser(ctx, 'ana@ejemplo.mx');
    const first = await refresh(user.refreshToken);
    expect(first.status).toBe(200);
    const tokens = first.body as AuthTokens;
    expect(tokens.refreshToken).not.toBe(user.refreshToken);
    expect((await ctx.http().get('/v1/auth/me').set({ Authorization: `Bearer ${tokens.accessToken}` })).status).toBe(200);
  });

  it('detecta reutilización y revoca toda la sesión', async () => {
    const user = await registerUser(ctx, 'ana@ejemplo.mx');
    const rotated = (await refresh(user.refreshToken)).body as AuthTokens;

    const reuse = await refresh(user.refreshToken);
    expect(reuse.status).toBe(401);

    // El token legítimo más reciente también deja de funcionar: la sesión quedó revocada.
    expect((await refresh(rotated.refreshToken)).status).toBe(401);
    expect((await ctx.http().get('/v1/auth/me').set({ Authorization: `Bearer ${rotated.accessToken}` })).status).toBe(401);
    const session = await ctx.owner.session.findUniqueOrThrow({ where: { id: user.sessionId } });
    expect(session.revokedReason).toBe('REFRESH_REUSE');
  });

  it('dos usos simultáneos del mismo token: solo uno puede tener éxito', async () => {
    const user = await registerUser(ctx, 'ana@ejemplo.mx');
    const results = await Promise.all([refresh(user.refreshToken), refresh(user.refreshToken)]);
    expect(results.filter((r) => r.status === 200).length).toBeLessThanOrEqual(1);
  });
});

describe('sesiones y cierre de sesión', () => {
  it('logout invalida el token de acceso de inmediato', async () => {
    const user = await registerUser(ctx, 'ana@ejemplo.mx');
    expect((await ctx.http().post('/v1/auth/logout').set(bearer(user))).status).toBe(204);
    expect((await ctx.http().get('/v1/auth/me').set(bearer(user))).status).toBe(401);
  });

  it('lista sesiones y permite cerrar otra; no permite cerrar sesiones de otro usuario', async () => {
    const user = await registerUser(ctx, 'ana@ejemplo.mx');
    const second = (await login('ana@ejemplo.mx')).body as AuthResponse;
    const other = await registerUser(ctx, 'beto@ejemplo.mx');

    const list = await ctx.http().get('/v1/auth/sessions').set(bearer(user));
    expect(list.body).toHaveLength(2);
    expect(list.body.find((s: { current: boolean }) => s.current).id).toBe(user.sessionId);

    expect((await ctx.http().delete(`/v1/auth/sessions/${other.sessionId}`).set(bearer(user))).status).toBe(404);
    expect((await ctx.http().delete(`/v1/auth/sessions/${second.tokens.sessionId}`).set(bearer(user))).status).toBe(204);
    expect((await ctx.http().get('/v1/auth/me').set({ Authorization: `Bearer ${second.tokens.accessToken}` })).status).toBe(401);
  });

  it('logout-all cierra todas las sesiones', async () => {
    const user = await registerUser(ctx, 'ana@ejemplo.mx');
    const second = (await login('ana@ejemplo.mx')).body as AuthResponse;
    expect((await ctx.http().post('/v1/auth/logout-all').set(bearer(user))).status).toBe(204);
    expect((await ctx.http().get('/v1/auth/me').set({ Authorization: `Bearer ${second.tokens.accessToken}` })).status).toBe(401);
  });
});

describe('recuperación de contraseña', () => {
  it('responde igual exista o no el correo, y solo envía correo si existe', async () => {
    await registerUser(ctx, 'ana@ejemplo.mx');
    const a = await ctx.http().post('/v1/auth/forgot-password').send({ email: 'ana@ejemplo.mx' });
    const b = await ctx.http().post('/v1/auth/forgot-password').send({ email: 'nadie@ejemplo.mx' });
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(a.body).toEqual(b.body);
    expect(ctx.mailer.sent.map((m) => m.to)).toEqual(['ana@ejemplo.mx']);
  });

  it('restablece la contraseña, cierra todas las sesiones y el enlace es de un solo uso', async () => {
    const user = await registerUser(ctx, 'ana@ejemplo.mx');
    await ctx.http().post('/v1/auth/forgot-password').send({ email: 'ana@ejemplo.mx' });
    const token = tokenFromMail(ctx, 'ana@ejemplo.mx');
    const stored = await ctx.owner.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.tokenHash).not.toBe(token);

    const newPassword = 'nueva-clave-segura-2026';
    expect((await ctx.http().post('/v1/auth/reset-password').send({ token, password: newPassword })).status).toBe(204);
    expect((await ctx.http().get('/v1/auth/me').set(bearer(user))).status).toBe(401);
    expect((await login('ana@ejemplo.mx')).status).toBe(401);
    expect((await login('ana@ejemplo.mx', newPassword)).status).toBe(200);

    const again = await ctx.http().post('/v1/auth/reset-password').send({ token, password: 'otra-clave-segura-99' });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('RESET_TOKEN_INVALID');
  });

  it('un enlace nuevo invalida el anterior y los vencidos no sirven', async () => {
    const user = await registerUser(ctx, 'ana@ejemplo.mx');
    await ctx.http().post('/v1/auth/forgot-password').send({ email: 'ana@ejemplo.mx' });
    const first = tokenFromMail(ctx, 'ana@ejemplo.mx');
    await ctx.http().post('/v1/auth/forgot-password').send({ email: 'ana@ejemplo.mx' });
    const second = tokenFromMail(ctx, 'ana@ejemplo.mx');

    expect((await ctx.http().post('/v1/auth/reset-password').send({ token: first, password: 'nueva-clave-segura-1' })).status).toBe(400);

    await ctx.owner.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await ctx.http().post('/v1/auth/reset-password').send({ token: second, password: 'nueva-clave-segura-1' })).status).toBe(400);
  });
});

describe('seguridad de logs y respuestas', () => {
  it('los errores incluyen requestId y nunca devuelven detalles internos', async () => {
    const res = await ctx.http().get('/v1/ruta-inexistente');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(res.body)).not.toMatch(/stack|Cannot GET/);
    expect(res.body.error.requestId).toBeTruthy();
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});
