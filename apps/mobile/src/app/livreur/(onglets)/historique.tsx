import { formatKmf } from '@digecom/shared';
import { View } from 'react-native';
import { Card, Empty, Loading, Screen, T, Title } from '@/components/ui';
import { useHistory } from '@/lib/hooks';
import { colors, toneColors } from '@/theme';

const FAILED = ['DELIVERY_FAILED', 'REFUSED', 'RETURN_IN_PROGRESS', 'RETURNED_TO_STOCK', 'DAMAGED'];

export default function Historique() {
  const q = useHistory();
  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Title>Historique</Title>
      {q.isLoading ? <Loading /> : null}
      {q.data?.runs.length === 0 ? <Empty title="Aucune course terminée" /> : null}
      {q.data?.runs.map((r) => {
        const failed = FAILED.includes(r.status);
        const tone = toneColors[failed ? 'red' : 'green'];
        return (
          <Card
            key={r.id}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <View>
              <T weight="semibold">#{r.number}</T>
              <T style={{ color: colors.muted, fontSize: 13 }}>
                {new Date(r.handedOverAt).toLocaleString('fr-FR', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {r.courierFee ? ` · ${formatKmf(r.courierFee)}` : ''}
              </T>
            </View>
            <View
              style={{
                backgroundColor: tone.bg,
                borderRadius: 999,
                paddingHorizontal: 10,
                paddingVertical: 3,
              }}
            >
              <T weight="medium" style={{ color: tone.fg, fontSize: 12 }}>
                {failed ? 'Échouée' : 'Livrée'}
              </T>
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}
