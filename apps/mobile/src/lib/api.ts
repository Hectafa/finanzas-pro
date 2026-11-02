import type { ApiErrorBody, AuthTokens } from '@finanzas/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Errores de validación por campo, tal como los devuelve la API. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    const out: Record<string, string> = {};
    for (const d of this.details as { path?: string; message?: string }[]) {
      if (d.path && d.message && !out[d.path]) out[d.path] = d.message;
    }
    return out;
  }
}

export const NETWORK_ERROR = 'NETWORK_ERROR';

export interface ApiSessionPort {
  getAccessToken(): string | null;
  getRefreshToken(): string | null;
  getCompanyId(): string | null;
  onTokens(tokens: AuthTokens): void | Promise<void>;
  onSessionLost(): void | Promise<void>;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | undefined>;
  /** Incluye X-Company-Id con la empresa activa. */
  company?: boolean;
  /** Ruta pública: sin token ni reintento de refresh. */
  anonymous?: boolean;
}

/**
 * Cliente HTTP de la API. Si el token de acceso expiró, renueva la sesión una sola vez
 * (aunque varias solicitudes fallen al mismo tiempo) y repite la solicitud original.
 * El servidor rota el refresh token en cada uso, por eso nunca se envían dos renovaciones en paralelo.
 */
export function createApiClient(
  baseUrl: string,
  session: ApiSessionPort,
  fetchImpl: typeof fetch = fetch,
) {
  let refreshing: Promise<boolean> | null = null;

  async function send(path: string, opts: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (!opts.anonymous) {
      const token = session.getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    if (opts.company) {
      const companyId = session.getCompanyId();
      if (companyId) headers['X-Company-Id'] = companyId;
    }
    const qs = opts.query
      ? Object.entries(opts.query)
          .filter((e): e is [string, string] => e[1] !== undefined)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join('&')
      : '';
    try {
      return await fetchImpl(`${baseUrl}/v1${path}${qs ? `?${qs}` : ''}`, {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch {
      throw new ApiError(
        0,
        NETWORK_ERROR,
        'Sin conexión con el servidor. Revisa tu internet e intenta de nuevo',
      );
    }
  }

  async function refresh(): Promise<boolean> {
    refreshing ??= (async () => {
      const refreshToken = session.getRefreshToken();
      if (!refreshToken) return false;
      const res = await send('/auth/refresh', {
        method: 'POST',
        body: { refreshToken },
        anonymous: true,
      }).catch(() => null);
      if (!res) return false; // Sin red: no se cierra la sesión, se reintentará después.
      if (!res.ok) {
        await session.onSessionLost();
        return false;
      }
      await session.onTokens((await res.json()) as AuthTokens);
      return true;
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    let res = await send(path, opts);
    if (res.status === 401 && !opts.anonymous && session.getRefreshToken()) {
      if (await refresh()) res = await send(path, opts);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : undefined;
    if (!res.ok) {
      const err = (data as ApiErrorBody | undefined)?.error;
      throw new ApiError(
        res.status,
        err?.code ?? 'HTTP_ERROR',
        err?.message ?? 'Ocurrió un error inesperado',
        err?.details,
      );
    }
    return data as T;
  }

  return { request, refresh };
}

export type ApiClient = ReturnType<typeof createApiClient>;
