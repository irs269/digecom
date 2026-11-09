import { formatKmf } from '@digecom/shared';
import { Card, Loading, Screen, T, Title } from '@/components/ui';
import { useHistory } from '@/lib/hooks';
import { colors, radius } from '@/theme';
import { View } from 'react-native';

export default function Gains() {
  const q = useHistory();
  const delivered = q.data?.runs.filter((r) => r.courierFee).length ?? 0;
  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Title sub="Sur tes 100 dernières courses">Mes gains</Title>
      {q.isLoading ? <Loading /> : null}
      {q.data ? (
        <>
          <View
            style={{
              backgroundColor: colors.blue,
              borderRadius: radius.lg,
              padding: 18,
              marginBottom: 12,
            }}
          >
            <T style={{ color: colors.blueSoft }}>Frais de course</T>
            <T weight="bold" style={{ color: colors.white, fontSize: 30 }}>
              {formatKmf(q.data.totalFees)}
            </T>
            <T style={{ color: colors.white }}>{delivered} courses livrées</T>
          </View>
          <Card>
            <T style={{ color: colors.muted }}>Argent encaissé à remettre à la caisse</T>
            <T weight="bold" style={{ fontSize: 26, color: colors.ink }}>
              {formatKmf(q.data.totalCollected)}
            </T>
            <T style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
              Remets cet argent au caissier de ton site : il l’enregistre dans la caisse avec tes
              commandes.
            </T>
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
