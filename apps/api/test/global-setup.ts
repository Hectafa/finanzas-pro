import { execSync } from 'node:child_process';
import { applyTestEnv } from './test-env';

/** Aplica las migraciones a la base de pruebas una vez por ejecución. */
export default function setup(): void {
  applyTestEnv();
  execSync('npx prisma migrate deploy', { stdio: 'pipe', env: process.env });
}
