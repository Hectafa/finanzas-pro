import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CompanyAccessGuard } from './auth/company-access.guard';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { AUTH_RATE_LIMIT } from './common/request-context';
import { CompaniesModule } from './companies/companies.module';
import { ConfigModule } from './config/config.module';
import { APP_ENV, type AppEnv } from './config/env';
import { DashboardModule } from './dashboard/dashboard.controller';
import { DbModule } from './db/db.module';
import { FinanceModule } from './finance/finance.module';
import { HealthModule } from './health/health.controller';
import { MailModule } from './mail/mail.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [APP_ENV],
      useFactory: (env: AppEnv) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          genReqId: (req, res) => {
            const incoming = req.headers['x-request-id'];
            const id =
              typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming)
                ? incoming
                : randomUUID();
            res.setHeader('X-Request-Id', id);
            return id;
          },
          // Nunca se registran credenciales, tokens ni cuerpos de solicitud.
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
              'req.query.token',
            ],
            censor: '[oculto]',
          },
          transport:
            env.NODE_ENV === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [APP_ENV],
      useFactory: (env: AppEnv) => [
        { name: 'default', ttl: 60_000, limit: env.THROTTLE_LIMIT },
        {
          name: 'auth',
          ttl: 60_000,
          limit: env.AUTH_THROTTLE_LIMIT,
          // Solo cuenta en rutas marcadas con @AuthRateLimit().
          skipIf: (ctx) => !Reflect.getMetadata(AUTH_RATE_LIMIT, ctx.getHandler()),
        },
      ],
    }),
    DbModule,
    MailModule,
    AuditModule,
    AuthModule,
    CompaniesModule,
    FinanceModule,
    DashboardModule,
    HealthModule,
  ],
  providers: [
    // Orden: límite de solicitudes → autenticación → empresa y permisos.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: CompanyAccessGuard },
  ],
})
export class AppModule {}
