import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { api, ApiError } from './api';

/**
 * File d'actions hors ligne. Une action de terrain (réception, retrait, remise, client a pris /
 * refusé, échec) est d'abord tentée en direct ; sans réseau, elle est gardée sur le téléphone et
 * rejouée dans l'ordre au retour du réseau. Chaque action porte une clé d'idempotence fixée à sa
 * création : un renvoi après une coupure ne crée jamais de doublon côté serveur.
 */

const STORAGE_KEY = 'dc_offline_queue';

export interface QueuedAction {
  id: string;
  path: string;
  body: unknown;
  /** Texte affiché à l'utilisateur (« Client a pris – #C-0042 »). */
  label: string;
  createdAt: string;
  /** Dernière erreur définitive du serveur : l'action est retirée et signalée. */
  error?: string;
}

export interface QueueState {
  pending: QueuedAction[];
  failed: QueuedAction[];
  flushing: boolean;
}

let state: QueueState = { pending: [], failed: [], flushing: false };
let loaded: Promise<void> | null = null;
const listeners = new Set<(s: QueueState) => void>();
/** Appelé après chaque action rejouée avec succès (rafraîchit les écrans). */
let onSynced: (() => void) | null = null;

export function newActionId(): string {
  const rnd = Math.random().toString(36).slice(2, 10);
  return `m-${Date.now().toString(36)}-${rnd}`;
}

function set(patch: Partial<QueueState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}

async function persist() {
  await AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ pending: state.pending, failed: state.failed }),
  );
}

function load(): Promise<void> {
  loaded ??= AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
    if (!raw) return;
    const saved = JSON.parse(raw) as Pick<QueueState, 'pending' | 'failed'>;
    set({ pending: saved.pending ?? [], failed: saved.failed ?? [] });
  });
  return loaded;
}

export function subscribeQueue(fn: (s: QueueState) => void): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

export function setOnSynced(fn: () => void) {
  onSynced = fn;
}

export type SubmitResult<T> = { status: 'sent'; data: T } | { status: 'queued' };

/**
 * Envoie l'action maintenant, ou la met en file si le réseau manque.
 * Une erreur du serveur (droits, statut déjà changé…) est remontée tout de suite.
 */
export async function submitAction<T>(
  path: string,
  body: unknown,
  label: string,
): Promise<SubmitResult<T>> {
  await load();
  const action: QueuedAction = {
    id: newActionId(),
    path,
    body,
    label,
    createdAt: new Date().toISOString(),
  };
  // Des actions attendent déjà : on respecte l'ordre.
  if (state.pending.length) {
    await enqueue(action);
    void flush();
    return { status: 'queued' };
  }
  try {
    const data = await api<T>(path, { method: 'POST', body, idempotencyKey: action.id });
    return { status: 'sent', data };
  } catch (err) {
    if (err instanceof ApiError && err.isNetwork) {
      await enqueue(action);
      return { status: 'queued' };
    }
    throw err;
  }
}

async function enqueue(action: QueuedAction) {
  set({ pending: [...state.pending, action] });
  await persist();
}

/** Rejoue les actions en attente, dans l'ordre. S'arrête à la première coupure réseau. */
export async function flush(): Promise<void> {
  await load();
  if (state.flushing || !state.pending.length) return;
  set({ flushing: true });
  let synced = false;
  try {
    while (state.pending.length) {
      const [next, ...rest] = state.pending;
      try {
        await api(next!.path, { method: 'POST', body: next!.body, idempotencyKey: next!.id });
        set({ pending: rest });
        synced = true;
      } catch (err) {
        if (err instanceof ApiError && (err.isNetwork || err.status >= 500 || err.status === 409)) {
          // Réseau absent, serveur indisponible ou action encore en cours : on réessaiera.
          break;
        }
        const message = err instanceof Error ? err.message : 'Erreur';
        set({ pending: rest, failed: [...state.failed, { ...next!, error: message }] });
      }
      await persist();
    }
  } finally {
    set({ flushing: false });
    await persist();
    if (synced) onSynced?.();
  }
}

export async function dismissFailed(id: string) {
  set({ failed: state.failed.filter((a) => a.id !== id) });
  await persist();
}

/** Vide la file (déconnexion : les actions d'un compte ne partent jamais avec un autre). */
export async function resetQueue() {
  set({ pending: [], failed: [] });
  await AsyncStorage.removeItem(STORAGE_KEY);
}

/** Rejoue automatiquement la file dès que le réseau revient. */
export function startAutoFlush(): () => void {
  void flush();
  return NetInfo.addEventListener((s) => {
    if (s.isConnected && s.isInternetReachable !== false) void flush();
  });
}
