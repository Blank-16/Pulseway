const BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? '/api';

let accessToken: string | null = null;

// Singleton promise — all concurrent 401s share one refresh call instead of each firing separately
let refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(token: string | null): void { accessToken = token; }
export function getAccessToken(): string | null { return accessToken; }

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body  : unknown,
  ) {
    super(`API error ${status}`);
    this.name = 'ApiError';
  }
}

interface FetchOptions extends RequestInit { skipAuth?: boolean; }

async function doRefresh(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
    if (!res.ok) { setAccessToken(null); return null; }
    const { data } = await res.json() as { data: { accessToken: string } };
    setAccessToken(data.accessToken);
    return data.accessToken;
  } catch {
    setAccessToken(null);
    return null;
  } finally {
    refreshPromise = null;
  }
}

function getRefreshToken(): Promise<string | null> {
  // Coalesce concurrent refresh attempts — only one fetch in flight at a time
  if (!refreshPromise) refreshPromise = doRefresh();
  return refreshPromise;
}

async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { skipAuth = false, body, ...init } = options;
  const headers = new Headers(init.headers);

  // Only set Content-Type when there is a body — avoids rejections from servers
  // that treat Content-Type on bodyless requests (GET, DELETE) as malformed
  if (body !== undefined && body !== null) {
    headers.set('Content-Type', 'application/json');
  }

  if (!skipAuth && accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    body,
    headers,
    credentials: 'include',
  });

  if (res.status === 401 && !skipAuth) {
    const newToken = await getRefreshToken();
    if (!newToken) {
      if (typeof window !== 'undefined') {
        window.location.href = `/auth/login?next=${encodeURIComponent(window.location.pathname)}`;
      }
      throw new ApiError(401, { error: { code: 'UNAUTHORIZED', message: 'Session expired' } });
    }

    headers.set('Authorization', `Bearer ${newToken}`);
    const retry = await fetch(`${BASE_URL}${path}`, { ...init, body, headers, credentials: 'include' });
    if (!retry.ok) {
      const errBody = await retry.json().catch(() => ({ error: { code: 'UNKNOWN', message: 'Request failed' } }));
      throw new ApiError(retry.status, errBody);
    }
    if (retry.status === 204) return undefined as unknown as T;
    return retry.json() as Promise<T>;
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: { code: 'UNKNOWN', message: 'Request failed' } }));
    throw new ApiError(res.status, errBody);
  }

  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string, opts?: FetchOptions): Promise<T> =>
    apiFetch<T>(path, { method: 'GET', ...opts }),

  post: <T>(path: string, body?: unknown, opts?: FetchOptions): Promise<T> =>
    apiFetch<T>(path, {
      method: 'POST',
      body  : body !== undefined ? JSON.stringify(body) : undefined,
      ...opts,
    }),

  patch: <T>(path: string, body?: unknown, opts?: FetchOptions): Promise<T> =>
    apiFetch<T>(path, {
      method: 'PATCH',
      body  : body !== undefined ? JSON.stringify(body) : undefined,
      ...opts,
    }),

  put: <T>(path: string, body?: unknown, opts?: FetchOptions): Promise<T> =>
    apiFetch<T>(path, {
      method: 'PUT',
      body  : body !== undefined ? JSON.stringify(body) : undefined,
      ...opts,
    }),

  del: <T>(path: string, opts?: FetchOptions): Promise<T> =>
    // No body on DELETE — Content-Type is not set
    apiFetch<T>(path, { method: 'DELETE', ...opts }),
};
