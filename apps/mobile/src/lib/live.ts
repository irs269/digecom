import type { LiveEvent } from '@digecom/shared';
import EventSource from 'react-native-sse';
import { API_URL, getAccessToken, refresh } from './api';

/**
 * Flux temps réel de l'application (`GET /calls/stream`, SSE avec jeton Bearer) : appels
 * entrants, messages WebRTC et changements de statut des commandes. Reconnexion automatique
 * avec un jeton neuf (le jeton d'accès dure 15 min).
 */

type Listener = (event: LiveEvent) => void;

const listeners = new Set<Listener>();
let source: EventSource<'call' | 'order' | 'notification' | 'ready'> | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;
let running = false;

export function onLive(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function dispatch(raw: string | null) {
  if (!raw) return;
  try {
    const event = JSON.parse(raw) as LiveEvent;
    listeners.forEach((l) => l(event));
  } catch {
    // Message illisible : ignoré.
  }
}

function scheduleReconnect() {
  if (!running || retry) return;
  // 1 s, 2 s, 4 s… jusqu'à 30 s.
  const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempts, 5));
  attempts += 1;
  retry = setTimeout(() => {
    retry = null;
    void connect();
  }, delay);
}

async function connect() {
  source?.removeAllEventListeners();
  source?.close();
  source = null;
  if (!running) return;
  // Jeton neuf à chaque connexion : le flux reste ouvert plus longtemps que le jeton.
  if (attempts > 0) await refresh().catch(() => false);
  const token = getAccessToken();
  if (!token) return scheduleReconnect();
  const es = new EventSource<'call' | 'order' | 'notification' | 'ready'>(
    `${API_URL}/calls/stream`,
    {
      headers: { Authorization: `Bearer ${token}`, 'X-Client': 'mobile' },
      // Pas de délai de lecture : le serveur envoie un battement toutes les 25 s.
      timeout: 0,
      pollingInterval: 0,
    },
  );
  source = es;
  es.addEventListener('ready', () => {
    attempts = 0;
  });
  for (const type of ['call', 'order', 'notification'] as const) {
    es.addEventListener(type, (e) => dispatch(e.data));
  }
  es.addEventListener('error', () => scheduleReconnect());
  es.addEventListener('close', () => scheduleReconnect());
}

/** Ouvre le flux (après connexion). */
export function startLive() {
  if (running) return;
  running = true;
  attempts = 0;
  void connect();
}

/** Ferme le flux (déconnexion). */
export function stopLive() {
  running = false;
  if (retry) clearTimeout(retry);
  retry = null;
  source?.removeAllEventListeners();
  source?.close();
  source = null;
}

/** Retour au premier plan : reconnexion immédiate si le flux est tombé pendant la veille. */
export function wakeLive() {
  if (!running) return;
  if (retry) clearTimeout(retry);
  retry = null;
  attempts = 0;
  void connect();
}
