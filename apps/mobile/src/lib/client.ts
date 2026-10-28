import { createApiClient } from './api';
import { useSession } from './session';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3000').replace(/\/$/, '');

export const api = createApiClient(API_URL, {
  getAccessToken: () => useSession.getState().accessToken,
  getRefreshToken: () => useSession.getState().refreshToken,
  getCompanyId: () => useSession.getState().companyId,
  onTokens: (tokens) => useSession.getState().setTokens(tokens),
  onSessionLost: () => useSession.getState().signOut(),
});
