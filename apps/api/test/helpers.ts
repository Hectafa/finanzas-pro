import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import type { AuthResponse, CompanySummaryDto, RoleDto } from '@finanzas/shared';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { DbService } from '../src/db/db.service';
import { syncReferenceData } from '../src/db/reference-data';
import { PrismaClient } from '../src/generated/prisma/client';
import { Mailer, type MemoryMailer } from '../src/mail/mailer';
import { TEST_DATABASE_MIGRATION_URL } from './test-env';

export const PASSWORD = 'clave-de-prueba-segura-2026';

export interface TestContext {
  app: INestApplication;
  http: () => ReturnType<typeof request>;
  mailer: MemoryMailer;
  db: DbService;
  /** Conexión con el rol dueño (sin RLS): solo para preparar y limpiar datos. */
  owner: PrismaClient;
  close: () => Promise<void>;
}

export async function createTestContext(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ bodyParser: false, bufferLogs: true });
  configureApp(app);
  await app.init();

  const owner = new PrismaClient({
    adapter: new PrismaPg({ connectionString: TEST_DATABASE_MIGRATION_URL }),
  });
  return {
    app,
    http: () => request(app.getHttpServer()),
    mailer: app.get(Mailer) as MemoryMailer,
    db: app.get(DbService),
    owner,
    close: async () => {
      await app.close();
      await owner.$disconnect();
    },
  };
}

// Orden respetando llaves foráneas. Conserva permisos y roles de sistema (se resincronizan).
const RESET_STATEMENTS = [
  'DELETE FROM audit_logs',
  'DELETE FROM invitations',
  'DELETE FROM company_memberships',
  'DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE company_id IS NOT NULL)',
  'DELETE FROM roles WHERE company_id IS NOT NULL',
  'DELETE FROM branches',
  'DELETE FROM companies',
  'DELETE FROM refresh_tokens',
  'DELETE FROM sessions',
  'DELETE FROM password_reset_tokens',
  'DELETE FROM users',
];

export async function resetDatabase(ctx: TestContext): Promise<void> {
  for (const sql of RESET_STATEMENTS) await ctx.owner.$executeRawUnsafe(sql);
  await syncReferenceData(ctx.owner);
  ctx.mailer.sent.length = 0;
}

export interface TestUser {
  id: string;
  email: string;
  token: string;
  refreshToken: string;
  sessionId: string;
}

export async function registerUser(
  ctx: TestContext,
  email: string,
  fullName = 'Usuario Prueba',
): Promise<TestUser> {
  const res = await ctx
    .http()
    .post('/v1/auth/register')
    .send({ email, password: PASSWORD, fullName });
  if (res.status !== 201)
    throw new Error(`Registro falló: ${res.status} ${JSON.stringify(res.body)}`);
  const body = res.body as AuthResponse;
  return {
    id: body.user.id,
    email: body.user.email,
    token: body.tokens.accessToken,
    refreshToken: body.tokens.refreshToken,
    sessionId: body.tokens.sessionId,
  };
}

export async function createCompany(
  ctx: TestContext,
  user: TestUser,
  name = 'Taquería Prueba',
): Promise<CompanySummaryDto> {
  const res = await ctx.http().post('/v1/companies').set(bearer(user)).send({ name });
  if (res.status !== 201)
    throw new Error(`Crear empresa falló: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as CompanySummaryDto;
}

export const bearer = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });

export const inCompany = (user: TestUser, companyId: string) => ({
  ...bearer(user),
  'X-Company-Id': companyId,
});

export async function systemRole(
  ctx: TestContext,
  user: TestUser,
  companyId: string,
  key: string,
): Promise<RoleDto> {
  const res = await ctx.http().get('/v1/roles').set(inCompany(user, companyId));
  const role = (res.body as RoleDto[]).find((r) => r.key === key);
  if (!role) throw new Error(`Rol ${key} no encontrado`);
  return role;
}

export function tokenFromMail(ctx: TestContext, to: string): string {
  const mail = ctx.mailer.lastTo(to.toLowerCase());
  const match = mail?.text.match(/token=([\w-]+)/);
  if (!match) throw new Error(`No hay correo con token para ${to}`);
  return match[1]!;
}

/** Invita a `email` con el rol indicado y acepta la invitación como ese usuario (registrándolo). */
export async function addMember(
  ctx: TestContext,
  owner: TestUser,
  companyId: string,
  email: string,
  roleKey: string,
): Promise<TestUser> {
  const role = await systemRole(ctx, owner, companyId, roleKey);
  const inv = await ctx
    .http()
    .post('/v1/invitations')
    .set(inCompany(owner, companyId))
    .send({ email, roleId: role.id });
  if (inv.status !== 201)
    throw new Error(`Invitación falló: ${inv.status} ${JSON.stringify(inv.body)}`);
  const member = await registerUser(ctx, email);
  const accepted = await ctx
    .http()
    .post('/v1/invitations/accept')
    .set(bearer(member))
    .send({ token: tokenFromMail(ctx, email) });
  if (accepted.status !== 200)
    throw new Error(`Aceptar falló: ${accepted.status} ${JSON.stringify(accepted.body)}`);
  return member;
}
