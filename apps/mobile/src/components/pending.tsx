import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { dismissFailed, subscribeQueue, type QueueState } from '@/lib/offline';
import { colors } from '@/theme';
import { Notice, T } from './ui';

export function useQueue(): QueueState {
  const [q, setQ] = useState<QueueState>({ pending: [], failed: [], flushing: false });
  useEffect(() => subscribeQueue(setQ), []);
  return q;
}

/** Bandeau : actions en attente de réseau, et actions refusées au moment du renvoi. */
export function PendingBanner() {
  const q = useQueue();
  if (!q.pending.length && !q.failed.length) return null;
  return (
    <View testID="pending-banner">
      {q.pending.length ? (
        <Notice tone="orange">
          {q.flushing ? 'Envoi en cours… ' : 'Hors ligne : '}
          {q.pending.length} action{q.pending.length > 1 ? 's' : ''} en attente d’envoi. Elles
          partiront automatiquement au retour du réseau.
        </Notice>
      ) : null}
      {q.failed.map((a) => (
        <Pressable key={a.id} onPress={() => void dismissFailed(a.id)}>
          <Notice tone="red">
            {a.label} : refusée par le serveur ({a.error}).{' '}
            <T style={{ color: colors.red, textDecorationLine: 'underline' }}>OK</T>
          </Notice>
        </Pressable>
      ))}
    </View>
  );
}
