import type { AuthResponse, AuthTokens, UserDto } from '@finanzas/shared';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

const REFRESH_KEY = 'fp.refreshToken';
const COMPANY_KEY = 'fp.companyId';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface SessionState {
  status: Status;
  user: UserDto | null;
  /** Solo en memoria: nunca se persiste. */
  accessToken: string | null;
  refreshToken: string | null;
  companyId: string | null;
  hydrate: () => Promise<void>;
  signIn: (auth: AuthResponse) => Promise<void>;
  setTokens: (tokens: AuthTokens) => Promise<void>;
  setUser: (user: UserDto) => void;
  setCompany: (companyId: string | null) => Promise<void>;
  signOut: () => Promise<void>;
}

/**
 * Sesión del dispositivo. El refresh token y la empresa activa se guardan en el almacenamiento
 * seguro del sistema (Keychain / Keystore); el token de acceso vive solo en memoria.
 */
export const useSession = create<SessionState>((set) => ({
  status: 'loading',
  user: null,
  accessToken: null,
  refreshToken: null,
  companyId: null,

  hydrate: async () => {
    const [refreshToken, companyId] = await Promise.all([
      SecureStore.getItemAsync(REFRESH_KEY),
      SecureStore.getItemAsync(COMPANY_KEY),
    ]);
    // Con refresh token se considera iniciada; el primer request renovará el token de acceso.
    set({ refreshToken, companyId, status: refreshToken ? 'signedIn' : 'signedOut' });
  },

  signIn: async ({ user, tokens }) => {
    await SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken);
    set({
      status: 'signedIn',
      user,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
  },

  setTokens: async (tokens) => {
    await SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken);
    set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
  },

  setUser: (user) => set({ user }),

  setCompany: async (companyId) => {
    if (companyId) await SecureStore.setItemAsync(COMPANY_KEY, companyId);
    else await SecureStore.deleteItemAsync(COMPANY_KEY);
    set({ companyId });
  },

  signOut: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(REFRESH_KEY),
      SecureStore.deleteItemAsync(COMPANY_KEY),
    ]);
    set({
      status: 'signedOut',
      user: null,
      accessToken: null,
      refreshToken: null,
      companyId: null,
    });
  },
}));
