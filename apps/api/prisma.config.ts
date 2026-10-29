import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// La CLI de Prisma (migraciones) se conecta con el rol dueño del esquema.
// La API en ejecución usa DATABASE_URL (rol finanzas_app, sujeto a RLS).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_MIGRATION_URL'),
  },
});
