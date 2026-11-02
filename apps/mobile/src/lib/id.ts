import { randomUUID } from 'expo-crypto';

/**
 * Identificador de un movimiento generado en el dispositivo. Reenviar el mismo id no lo duplica
 * (la API es idempotente), así que un reintento tras un error de red es seguro.
 */
export const newId = (): string => randomUUID();
