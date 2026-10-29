/**
 * Almacenamiento de la sesión en el navegador. No existe un equivalente a Keychain/Keystore:
 * localStorage es accesible a cualquier script de la página, así que la versión web depende de
 * no tener XSS (sin HTML de terceros, CSP en producción). Ver docs/fase-1-fundacion.md §6.
 * Si el navegador bloquea el almacenamiento (modo privado estricto), la sesión dura lo que la pestaña.
 */
const memory = new Map<string, string>();

function local(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export const secureStorage = {
  get: async (key: string): Promise<string | null> => {
    try {
      return local()?.getItem(key) ?? memory.get(key) ?? null;
    } catch {
      return memory.get(key) ?? null;
    }
  },
  set: async (key: string, value: string): Promise<void> => {
    memory.set(key, value);
    try {
      local()?.setItem(key, value);
    } catch {
      // Sin almacenamiento persistente: queda solo en memoria.
    }
  },
  remove: async (key: string): Promise<void> => {
    memory.delete(key);
    try {
      local()?.removeItem(key);
    } catch {
      // Nada que borrar.
    }
  },
};
