import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { APP_ENV, type AppEnv } from '../config/env';
import { PrismaClient, type Prisma } from '../generated/prisma/client';

export type Tx = Prisma.TransactionClient;

export interface TenantScope {
  companyId: string;
  userId: string;
}

const TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

/**
 * Acceso a datos. Las tablas de empresa tienen seguridad por fila (RLS) en PostgreSQL;
 * cada transacción declara su contexto con `set_config(..., true)` (local a la transacción).
 *
 * - tenant(): operaciones dentro de una empresa. Es la vía normal.
 * - asUser(): datos del propio usuario a través de empresas (p. ej. "mis empresas").
 * - system(): omite RLS. Solo para flujos sin empresa todavía (autenticación, aceptar
 *   invitaciones por token, seed). Cada uso debe justificarse en el código.
 *
 * `client` no tiene contexto: sirve para tablas sin RLS (usuarios, sesiones, tokens).
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(APP_ENV) env: AppEnv) {
    this.client = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
  }

  tenant<T>(scope: TenantScope, fn: (tx: Tx) => Promise<T>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<T> {
    return this.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.company_id', ${scope.companyId}, true), set_config('app.user_id', ${scope.userId}, true)`;
      return fn(tx);
    }, { ...TX_OPTIONS, ...options });
  }

  asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
      return fn(tx);
    }, TX_OPTIONS);
  }

  system<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      return fn(tx);
    }, TX_OPTIONS);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
