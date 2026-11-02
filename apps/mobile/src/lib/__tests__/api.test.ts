import type { AuthTokens } from '@finanzas/shared';
import { ApiError, NETWORK_ERROR, createApiClient, type ApiSessionPort } from '../api';

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const newTokens: AuthTokens = {
  accessToken: 'acceso-nuevo',
  accessTokenExpiresAt: '2026-01-01T00:15:00Z',
  refreshToken: 'refresh-nuevo',
  refreshTokenExpiresAt: '2026-02-01T00:00:00Z',
  sessionId: 's1',
};

function makeSession(overrides: Partial<ApiSessionPort> = {}) {
  const state = {
    access: 'acceso-viejo' as string | null,
    refresh: 'refresh-viejo' as string | null,
    lost: 0,
  };
  const port: ApiSessionPort = {
    getAccessToken: () => state.access,
    getRefreshToken: () => state.refresh,
    getCompanyId: () => 'empresa-1',
    onTokens: (t) => {
      state.access = t.accessToken;
      state.refresh = t.refreshToken;
    },
    onSessionLost: () => {
      state.lost++;
      state.access = null;
      state.refresh = null;
    },
    ...overrides,
  };
  return { state, port };
}

describe('createApiClient', () => {
  it('envía token y empresa activa', async () => {
    const fetchMock = jest.fn().mockResolvedValue(json(200, { ok: true }));
    const { port } = makeSession();
    const api = createApiClient('http://api', port, fetchMock);
    await api.request('/members', { company: true, query: { period: 'month', x: undefined } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api/v1/members?period=month');
    expect(init.headers.Authorization).toBe('Bearer acceso-viejo');
    expect(init.headers['X-Company-Id']).toBe('empresa-1');
  });

  it('las rutas anónimas no envían token', async () => {
    const fetchMock = jest.fn().mockResolvedValue(json(200, {}));
    const api = createApiClient('http://api', makeSession().port, fetchMock);
    await api.request('/auth/login', { method: 'POST', body: {}, anonymous: true });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('ante 401 renueva el token una vez y repite la solicitud', async () => {
    const { state, port } = makeSession();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(json(401, { error: { code: 'SESSION_EXPIRED', message: 'x' } }))
      .mockResolvedValueOnce(json(200, newTokens))
      .mockResolvedValueOnce(json(200, { dato: 1 }));
    const api = createApiClient('http://api', port, fetchMock);
    await expect(api.request('/auth/me')).resolves.toEqual({ dato: 1 });
    expect(fetchMock.mock.calls[1][0]).toBe('http://api/v1/auth/refresh');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ refreshToken: 'refresh-viejo' });
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer acceso-nuevo');
    expect(state.refresh).toBe('refresh-nuevo');
  });

  it('varias solicitudes con 401 simultáneas comparten una sola renovación', async () => {
    const { port } = makeSession();
    let refreshCalls = 0;
    const fetchMock = jest.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCalls++;
        return json(200, newTokens);
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer acceso-nuevo'
        ? json(200, { ok: true })
        : json(401, { error: { code: 'SESSION_EXPIRED', message: 'x' } });
    });
    const api = createApiClient('http://api', port, fetchMock as unknown as typeof fetch);
    await Promise.all([api.request('/a'), api.request('/b'), api.request('/c')]);
    expect(refreshCalls).toBe(1);
  });

  it('si la renovación es rechazada, cierra la sesión local y propaga el error', async () => {
    const { state, port } = makeSession();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        json(401, { error: { code: 'SESSION_EXPIRED', message: 'Tu sesión expiró' } }),
      )
      .mockResolvedValueOnce(json(401, { error: { code: 'SESSION_EXPIRED', message: 'x' } }));
    const api = createApiClient('http://api', port, fetchMock);
    await expect(api.request('/auth/me')).rejects.toMatchObject({
      status: 401,
      code: 'SESSION_EXPIRED',
    });
    expect(state.lost).toBe(1);
  });

  it('sin red no cierra la sesión y devuelve un error de red claro', async () => {
    const { state, port } = makeSession();
    const fetchMock = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    const api = createApiClient('http://api', port, fetchMock);
    await expect(api.request('/auth/me')).rejects.toMatchObject({ code: NETWORK_ERROR, status: 0 });
    expect(state.lost).toBe(0);
    expect(state.refresh).toBe('refresh-viejo');
  });

  it('expone errores de validación por campo', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(
        json(400, {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Datos inválidos',
            details: [{ path: 'email', message: 'Correo inválido' }],
          },
        }),
      );
    const api = createApiClient('http://api', makeSession().port, fetchMock);
    const err = await api
      .request('/auth/register', { method: 'POST', body: {}, anonymous: true })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).fieldErrors).toEqual({ email: 'Correo inválido' });
  });

  it('204 devuelve undefined', async () => {
    const api = createApiClient(
      'http://api',
      makeSession().port,
      jest.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );
    await expect(api.request('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('envía FormData tal cual, sin forzar JSON (subida de archivos)', async () => {
    const fetchMock = jest.fn().mockResolvedValue(json(201, { id: 'a1' }));
    const api = createApiClient('http://api', makeSession().port, fetchMock);
    const form = new FormData();
    form.append('id', 'a1');
    await api.request('/transactions/t1/attachments', {
      method: 'POST',
      body: form,
      company: true,
    });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(form);
    expect(init.headers['Content-Type']).toBeUndefined();
  });
});
