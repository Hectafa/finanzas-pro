import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
};

describe('loadEnv', () => {
  it('aplica valores por defecto seguros', () => {
    const env = loadEnv(base);
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(env.CORS_ORIGINS).toEqual([]);
  });

  it('rechaza secretos cortos sin mostrar su valor', () => {
    expect(() => loadEnv({ ...base, JWT_ACCESS_SECRET: 'corto-secreto' })).toThrow(/JWT_ACCESS_SECRET/);
    try {
      loadEnv({ ...base, JWT_ACCESS_SECRET: 'corto-secreto' });
    } catch (e) {
      expect((e as Error).message).not.toContain('corto-secreto');
    }
  });

  it('en producción exige un proveedor de correo real', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', MAIL_DRIVER: 'file' })).toThrow(/MAIL_DRIVER/);
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', MAIL_DRIVER: 'resend' })).toThrow(/RESEND_API_KEY/);
  });
});
