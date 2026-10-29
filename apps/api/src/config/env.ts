import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    DATABASE_URL: z.string().startsWith('postgres'),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET debe tener al menos 32 caracteres'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    SESSION_MAX_DAYS: z.coerce.number().int().min(1).max(365).default(90),
    APP_LINK_BASE: z.string().min(1).default('finanzaspro://'),
    MAIL_DRIVER: z.enum(['file', 'memory', 'resend']).default('file'),
    MAIL_FROM: z.string().min(3).default('Finanzas Pro <no-reply@example.com>'),
    RESEND_API_KEY: z.string().optional(),
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
    DOCS_ENABLED: bool.default(true),
    THROTTLE_LIMIT: z.coerce.number().int().min(1).default(120),
    AUTH_THROTTLE_LIMIT: z.coerce.number().int().min(1).default(10),
  })
  .superRefine((env, ctx) => {
    if (env.MAIL_DRIVER === 'resend' && !env.RESEND_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['RESEND_API_KEY'], message: 'Requerido con MAIL_DRIVER=resend' });
    }
    if (env.NODE_ENV === 'production' && env.MAIL_DRIVER !== 'resend') {
      ctx.addIssue({ code: 'custom', path: ['MAIL_DRIVER'], message: 'En producción solo se admite resend' });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export const APP_ENV = Symbol('APP_ENV');

/** Valida la configuración al arrancar. Los mensajes nunca incluyen los valores (pueden ser secretos). */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuración inválida: ${problems}`);
  }
  return result.data;
}
