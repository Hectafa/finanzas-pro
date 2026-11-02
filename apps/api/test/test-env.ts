import 'dotenv/config';

/** URLs de la base de pruebas. Los valores por defecto corresponden a infra/docker-compose.yml. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://finanzas_app:finanzas_app_dev@localhost:5433/finanzas_test';
export const TEST_DATABASE_MIGRATION_URL =
  process.env.TEST_DATABASE_MIGRATION_URL ??
  'postgresql://finanzas_owner:finanzas_owner_dev@localhost:5433/finanzas_test';

export function applyTestEnv(): void {
  if (!TEST_DATABASE_URL.includes('test')) {
    throw new Error(
      'TEST_DATABASE_URL debe apuntar a una base de pruebas (su nombre debe contener "test")',
    );
  }
  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: TEST_DATABASE_URL,
    DATABASE_MIGRATION_URL: TEST_DATABASE_MIGRATION_URL,
    JWT_ACCESS_SECRET: 'secreto-de-pruebas-que-no-se-usa-fuera-de-pruebas-0123456789',
    MAIL_DRIVER: 'memory',
    DOCS_ENABLED: 'false',
    THROTTLE_LIMIT: '100000',
    AUTH_THROTTLE_LIMIT: '100000',
    APP_LINK_BASE: 'finanzaspro://',
  });
}
