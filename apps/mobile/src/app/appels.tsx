import {
  CALL_STATUS_LABELS,
  formatDuration,
  type CallContact,
  type CallView,
} from '@digecom/shared';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Button, Card, Empty, Loading, Notice, Screen, T, Title } from '@/components/ui';
import { api } from '@/lib/api';
import { useCalls } from '@/lib/calls/CallProvider';
import { useSession } from '@/lib/session';
import { colors, toneColors } from '@/theme';

/** Annuaire d'appel (site, leader, administration) et derniers appels. */
export default function Appels() {
  const { user } = useSession();
  const { available, start, state } = useCalls();
  const contacts = useQuery({
    queryKey: ['calls', 'contacts'],
    queryFn: () => api<CallContact[]>('/calls/contacts'),
  });
  const recent = useQuery({
    queryKey: ['calls', 'mine'],
    queryFn: () => api<CallView[]>('/calls/mine'),
  });
  const busy = state.phase !== 'idle' && state.phase !== 'ended';

  return (
    <Screen
      onRefresh={() => {
        void contacts.refetch();
        void recent.refetch();
      }}
      refreshing={contacts.isRefetching}
    >
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
        <T style={{ color: colors.blue, marginBottom: 10 }}>← Retour</T>
      </Pressable>
      <Title sub="Appel par Internet · numéro masqué · non enregistré">Appels Dig’eCom</Title>
      {!available ? (
        <Notice tone="orange">
          Les appels Dig’eCom demandent la version installée de l’application (pas Expo Go).
        </Notice>
      ) : null}

      <T weight="semibold" style={{ fontSize: 16, marginBottom: 8 }}>
        Contacts
      </T>
      {contacts.isLoading ? <Loading /> : null}
      {contacts.data?.length === 0 ? <Empty title="Aucun contact" /> : null}
      {contacts.data?.map((c) => (
        <Card
          key={c.id}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <View style={{ flex: 1 }}>
            <T weight="semibold">{c.fullName}</T>
            <T style={{ color: colors.muted, fontSize: 13 }}>
              {c.roleLabel}
              {c.island ? ` · ${c.island}` : ''}
            </T>
          </View>
          <View style={{ width: 120 }}>
            <Button
              testID={`appeler-${c.id}`}
              label="Appeler"
              variant="orange"
              disabled={!available || busy}
              onPress={() => void start({ userId: c.id })}
            />
          </View>
        </Card>
      ))}

      {recent.data?.length ? (
        <Card>
          <T weight="semibold" style={{ marginBottom: 6 }}>
            Derniers appels
          </T>
          {recent.data.slice(0, 20).map((c) => {
            const out = c.caller.id === user?.id;
            const missed = ['MISSED', 'DECLINED', 'CANCELLED', 'FAILED'].includes(c.status);
            const tone = toneColors[missed ? 'red' : 'green'];
            return (
              <View
                key={c.id}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  paddingVertical: 6,
                }}
              >
                <View style={{ flex: 1 }}>
                  <T weight="medium">{out ? `↗ ${c.callee.fullName}` : `↙ ${c.caller.fullName}`}</T>
                  <T style={{ color: colors.muted, fontSize: 12 }}>
                    {new Date(c.createdAt).toLocaleString('fr-FR', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {c.orderNumber ? ` · #${c.orderNumber}` : ''}
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
      ) : null}
    </Screen>
  );
}
