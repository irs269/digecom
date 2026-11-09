import { DELIVERY_MODE_SHORT, formatKmf } from '@digecom/shared';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { PendingBanner } from '@/components/pending';
import { Badge, Card, Empty, Loading, Screen, T, Title } from '@/components/ui';
import { useMyOrders } from '@/lib/hooks';
import { colors } from '@/theme';

export default function Commandes() {
  const orders = useMyOrders();
  return (
    <Screen onRefresh={() => void orders.refetch()} refreshing={orders.isRefetching}>
      <Title>Mes commandes</Title>
      <PendingBanner />
      {orders.isLoading ? <Loading /> : null}
      {orders.data?.items.length === 0 ? (
        <Empty title="Aucune commande" text="Tes ventes apparaîtront ici." />
      ) : null}
      {orders.data?.items.map((o) => (
        <Pressable
          key={o.id}
          onPress={() => router.navigate(`/vendeur/commande/${o.id}`)}
          testID={`commande-${o.number}`}
        >
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T weight="semibold" style={{ flex: 1 }}>
                {o.items.map((i) => i.product.name).join(', ')}
              </T>
              <T weight="bold">{formatKmf(o.total)}</T>
            </View>
            <T style={{ color: colors.muted, fontSize: 13, marginVertical: 4 }}>
              #{o.number} · {o.customerName} · {DELIVERY_MODE_SHORT[o.deliveryMode]}
            </T>
            <Badge status={o.status} />
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
