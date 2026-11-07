import type { ApiError, LoginResponse } from '@digecom/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

/** Erreur d'API typée (format `{ code, message, details }`). */
export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

/**
 * Jeton d'accès gardé en mémoire uniquement (jamais dans localStorage).
 * Le refresh token vit dans un cookie httpOnly posé par l'API.
 */
let accessToken: string | null = null;
let refreshInFlight: Promise<LoginResponse | null> | null = null;
let onSessionExpired: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

async function parseError(res: Response): Promise<ApiRequestError> {
  let body: Partial<ApiError> = {};
  try {
    body = (await res.json()) as Partial<ApiError>;
  } catch {
    // corps vide ou non JSON
  }
  return new ApiRequestError(
    res.status,
    body.code ?? 'HTTP_ERROR',
    body.message ?? 'Une erreur est survenue. Réessaie.',
    body.details,
  );
}

/** Refresh silencieux, mutualisé : un seul appel à la fois même si plusieurs requêtes échouent. */
export function refreshSession(): Promise<LoginResponse | null> {
  refreshInFlight ??= fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })
    .then(async (res) => {
      if (!res.ok) return null;
      const data = (await res.json()) as LoginResponse;
      setAccessToken(data.accessToken);
      return data;
    })
    .catch(() => null)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  const res = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'include' });

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) return apiFetch<T>(path, init, false);
    setAccessToken(null);
    onSessionExpired?.();
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function login(phone: string, password: string): Promise<LoginResponse> {
  const data = await apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ phone, password }),
  });
  setAccessToken(data.accessToken);
  return data;
}

export async function logout(): Promise<void> {
  try {
    await apiFetch<void>('/auth/logout', { method: 'POST' });
  } finally {
    setAccessToken(null);
  }
}
