import {
  CALL_STATUS_LABELS,
  CALLABLE_ORDER_STATUSES,
  type CallView,
  type OrderStatus,
} from '@digecom/shared';
import { useQuery } from '@tanstack/react-query';
import { Linking, View } from 'react-native';
import { api } from '@/lib/api';
import { useCalls } from '@/lib/calls/CallProvider';
import { formatDuration } from '@/lib/calls/machine';
import { useSession } from '@/lib/session';
import { colors, toneColors } from '@/theme';
import { Button, Card, T } from './ui';

/**
 * Boutons d'appel vers l'autre participant d'une commande :
 * « Appel Dig'eCom » (dans l'application, numéro masqué) quand c'est possible, et l'appel
 * téléphonique classique en secours (réseau faible, Expo Go, client sans l'application).
 */
export function CallButtons({
  orderId,
  orderStatus,
  peerName,
  peerPhone,
  primary = true,
}: {
  orderId: string;
  orderStatus: OrderStatus;
  peerName: string;
  peerPhone: string;
  primary?: boolean;
}) {
  const { available, start, state } = useCalls();
  const callable = CALLABLE_ORDER_STATUSES.includes(orderStatus);
  const busy = state.phase !== 'idle' && state.phase !== 'ended';
  return (
    <View>
      {available && callable ? (
        <Button
          testID="appel-digecom"
          label={`Appel Dig’eCom · ${peerName}`}
          variant={primary ? 'orange' : 'primary'}
          disabled={busy}
          onPress={() => void start(orderId)}
        />
      ) : null}
      <Button
        testID="appel-telephone"
        label={available && callable ? 'Appeler par téléphone' : `Appeler ${peerName}`}
        variant={available && callable ? 'ghost' : primary ? 'orange' : 'outline'}
        onPress={() => void Linking.openURL(`tel:${peerPhone}`)}
      />
    </View>
  );
}

/** Journal des appels Dig'eCom de la commande (qui, quand, durée, manqué). */
export function CallLog({ orderId }: { orderId: string }) {
  const { user } = useSession();
  const q = useQuery({
    queryKey: ['calls', orderId],
    queryFn: () => api<CallView[]>(`/calls?orderId=${encodeURIComponent(orderId)}`),
  });
  if (!q.data?.length) return null;
  return (
    <Card>
      <T style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>APPELS DIG’ECOM</T>
      {q.data.map((c) => {
        const mine = c.caller.id === user?.id;
        const missed = ['MISSED', 'DECLINED', 'CANCELLED', 'FAILED'].includes(c.status);
        const tone = toneColors[missed ? 'red' : 'green'];
        return (
          <View
            key={c.id}
            testID="appel-journal"
            style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}
          >
            <View style={{ flex: 1 }}>
              <T weight="medium">
                {mine ? `↗ Vers ${c.callee.fullName}` : `↙ De ${c.caller.fullName}`}
              </T>
              <T style={{ color: colors.muted, fontSize: 12 }}>
                {new Date(c.createdAt).toLocaleString('fr-FR', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </T>
            </View>
            <T style={{ color: tone.fg }}>
              {c.durationSeconds !== null
                ? formatDuration(c.durationSeconds)
                : CALL_STATUS_LABELS[c.status]}
            </T>
          </View>
        );
      })}
    </Card>
  );
}
