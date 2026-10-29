import * as SecureStore from 'expo-secure-store';

/** Almacenamiento de la sesión en el teléfono: Keychain (iOS) / Keystore (Android). En web: storage.web.ts. */
export const secureStorage = {
  get: (key: string) => SecureStore.getItemAsync(key),
  set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  remove: (key: string) => SecureStore.deleteItemAsync(key),
};
