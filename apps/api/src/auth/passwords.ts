import { hash, verify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';

// Argon2id (algoritmo por defecto de la biblioteca) con los parámetros mínimos de OWASP:
// 19 MiB de memoria, 2 iteraciones, 1 hilo.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}

let dummyHash: Promise<string> | undefined;

/**
 * Verificación contra un hash ficticio cuando el usuario no existe, para que el tiempo de
 * respuesta no revele qué correos están registrados.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(24).toString('base64url'));
  await verify(await dummyHash, password);
}
