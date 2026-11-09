'use client';

import type { CallEvent, LiveEvent, NotificationView } from '@digecom/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useToast } from '@/components/ui/toast';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

/** Événements d'appel reçus sur le flux temps réel, remis au fournisseur d'appel. */
const callListeners = new Set<(e: CallEvent) => void>();
export function onCallEvent(fn: (e: CallEvent) => void): () => void {
  callListeners.add(fn);
  return () => {
    callListeners.delete(fn);
  };
}

/**
 * Connexion temps réel (SSE, authentifiée par le cookie de session) : nouvelles notifications
 * en toast + rafraîchissement des listes de commandes, livraisons et courses.
 */
export function useLiveUpdates(enabled: boolean) {
  const queryClient = useQueryClient();
  const toast = useToast();

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const source = new EventSource(`${API_URL}/notifications/stream`, { withCredentials: true });

    source.addEventListener('notification', (e) => {
      const event = JSON.parse((e as MessageEvent<string>).data) as Extract<
        LiveEvent,
        { kind: 'notification' }
      >;
      const n: NotificationView = event.notification;
      toast(`${n.title} — ${n.body}`, 'info');
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    });
    source.addEventListener('order', () => {
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      void queryClient.invalidateQueries({ queryKey: ['simulator'] });
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
    });
    source.addEventListener('call', (e) => {
      const event = JSON.parse((e as MessageEvent<string>).data) as Extract<
        LiveEvent,
        { kind: 'call' }
      >;
      callListeners.forEach((l) => l(event.event));
    });
    return () => source.close();
  }, [enabled, queryClient, toast]);
}
