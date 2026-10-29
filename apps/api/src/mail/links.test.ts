import { describe, expect, it } from 'vitest';
import { loadEnv } from '../config/env';
import { linksText } from './links';

const base = { DATABASE_URL: 'postgresql://x', JWT_ACCESS_SECRET: 'x'.repeat(32) };

describe('enlaces en correos', () => {
  it('sin versión web, solo el enlace de la app', () => {
    const env = loadEnv({ ...base, APP_WEB_URL: '' });
    expect(env.APP_WEB_URL).toBeUndefined();
    expect(linksText(env, 'reset-password?token=abc')).toBe(
      'finanzaspro://reset-password?token=abc\n',
    );
  });

  it('con versión web, ambos enlaces (sin doble diagonal)', () => {
    const env = loadEnv({ ...base, APP_WEB_URL: 'https://app.finanzas.mx/' });
    const text = linksText(env, 'accept-invite?token=abc');
    expect(text).toContain('finanzaspro://accept-invite?token=abc');
    expect(text).toContain('https://app.finanzas.mx/accept-invite?token=abc');
  });

  it('rechaza una URL web inválida', () => {
    expect(() => loadEnv({ ...base, APP_WEB_URL: 'no-es-url' })).toThrow(/APP_WEB_URL/);
  });
});
