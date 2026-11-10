import { Platform } from 'react-native';
import { MOBILE_CLIENT_VALUE, type LoginResponse, type MeResponse } from '@digecom/shared';
import { secure } from './secure';

/**
 * Adresse de l'API : le back-office relaie `/api/*` vers l'API, en dev comme en production.
 * Émulateur Android : 10.0.2.2 désigne le PC. Production : https://<domaine>/api.
 */
// PWA : l'application est servie par le back-office, l'API est sur la même origine (/api).
export const API_URL = (
  Platform.OS === 'web' ? '/api' : (process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3100/api')
).replace(/\/$/, '');

const REFRESH_KEY = 'dc_refresh';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
  /** Pas de réponse du serveur (réseau coupé, délai dépassé) : l'action peut être rejouée. */
  get isNetwork() {
    return this.status === 0;
  }
}

type Listener = (user: MeResponse | null) => void;

let accessToken: string | null = null;

/** Jeton d'accès courant (flux temps réel ouvert à part, hors `api`). */
export function getAccessToken(): string | null {
  return accessToken;
}
let refreshing: Promise<boolean> | null = null;
const listeners = new Set<Listener>();

export function onSessionChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(user: MeResponse | null) {
  listeners.forEach((l) => l(user));
}
/** Profil mis à jour (après un changement de mot de passe, par exemple). */
export function updateUser(user: MeResponse) {
  emit(user);
}

async function store(res: LoginResponse) {
  accessToken = res.accessToken;
  if (res.refreshToken) await secure.set(REFRESH_KEY, res.refreshToken);
  emit(res.user);
}

async function raw(path: string, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  try {
    return await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'X-Client': MOBILE_CLIENT_VALUE,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Pas de connexion au serveur');
  }
}

async function toError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
  return new ApiError(res.status, body?.code ?? 'ERROR', body?.message ?? `Erreur ${res.status}`);
}

export async function login(phone: string, password: string): Promise<MeResponse> {
  const res = await raw('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ phone, password }),
  });
  if (!res.ok) throw await toError(res);
  const body = (await res.json()) as LoginResponse;
  await store(body);
  return body.user;
}

/** Renouvelle le jeton d'accès. Faux si la session est terminée (compte désactivé, révoquée…). */
export function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    const token = await secure.get(REFRESH_KEY);
    if (!token) return false;
    const res = await raw('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: token }),
    });
    if (res.ok) {
      await store((await res.json()) as LoginResponse);
      return true;
    }
    // Refus explicite du serveur : session terminée. Erreur réseau : on garde le jeton.
    if (res.status === 401 || res.status === 403) await clearSession();
    return false;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function clearSession() {
  accessToken = null;
  await secure.remove(REFRESH_KEY);
  emit(null);
}

export async function logout() {
  const token = await secure.get(REFRESH_KEY);
  if (token) {
    await raw('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: token }),
    }).catch(() => undefined);
  }
  await clearSession();
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Clé d'idempotence : rejouer la même action ne la refait pas côté serveur. */
  idempotencyKey?: string;
}

/** Appel authentifié ; renouvelle le jeton une fois sur 401. */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    headers: opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : undefined,
  };
  let res = await raw(path, init);
  if (res.status === 401 && (await refresh())) res = await raw(path, init);
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Envoie un fichier vers une URL pré-signée (MinIO). */
export async function uploadFile(url: string, uri: string, contentType: string) {
  const blob = await (await fetch(uri)).blob();
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: blob,
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Envoi de la photo impossible');
  }
  if (!res.ok) throw new ApiError(res.status, 'UPLOAD', 'Envoi de la photo refusé');
}
