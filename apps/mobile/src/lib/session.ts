import type { AuthResponse, AuthTokens, UserDto } from '@finanzas/shared';
import { create } from 'zustand';
import { secureStorage } from './storage';

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
 * seguro del sistema (Keychain / Keystore; en web, el del navegador); el token de acceso vive solo en memoria.
 */
export const useSession = create<SessionState>((set) => ({
  status: 'loading',
  user: null,
  accessToken: null,
  refreshToken: null,
  companyId: null,

  hydrate: async () => {
    const [refreshToken, companyId] = await Promise.all([
      secureStorage.get(REFRESH_KEY),
      secureStorage.get(COMPANY_KEY),
    ]);
    // Con refresh token se considera iniciada; el primer request renovará el token de acceso.
    set({ refreshToken, companyId, status: refreshToken ? 'signedIn' : 'signedOut' });
  },

  signIn: async ({ user, tokens }) => {
    await secureStorage.set(REFRESH_KEY, tokens.refreshToken);
    set({
      status: 'signedIn',
      user,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
  },

  setTokens: async (tokens) => {
    await secureStorage.set(REFRESH_KEY, tokens.refreshToken);
    set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
  },

  setUser: (user) => set({ user }),

  setCompany: async (companyId) => {
    if (companyId) await secureStorage.set(COMPANY_KEY, companyId);
    else await secureStorage.remove(COMPANY_KEY);
    set({ companyId });
  },

  signOut: async () => {
    await Promise.all([secureStorage.remove(REFRESH_KEY), secureStorage.remove(COMPANY_KEY)]);
    set({
      status: 'signedOut',
      user: null,
      accessToken: null,
      refreshToken: null,
      companyId: null,
    });
  },
}));
