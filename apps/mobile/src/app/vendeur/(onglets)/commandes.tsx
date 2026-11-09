import { DELIVERY_MODE_SHORT, formatKmf } from '@digecom/shared';
import { router } from 'expo-router';
import { Linking, Pressable, View } from 'react-native';
import { PendingBanner } from '@/components/pending';
import { Badge, Card, Empty, Loading, Screen, T, Title } from '@/components/ui';
import { useMyOrders } from '@/lib/hooks';
import { colors } from '@/theme';

/** Statuts où un livreur a la commande : on peut l'appeler depuis la liste. */
const COURIER_ACTIVE = ['ASSIGNED', 'OUT_FOR_DELIVERY', 'HANDED_OVER'];

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
          onPress={() => router.push(`/vendeur/commande/${o.id}`)}
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
            {o.courier && COURIER_ACTIVE.includes(o.status) ? (
              <Pressable
                testID={`appeler-livreur-${o.number}`}
                accessibilityRole="button"
                onPress={() => void Linking.openURL(`tel:${o.courier!.phone}`)}
                style={{
                  marginTop: 10,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  backgroundColor: colors.orangeSoft,
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                }}
              >
                <T style={{ flex: 1 }}>
                  Livreur : <T weight="semibold">{o.courier.fullName}</T>
                </T>
                <T weight="semibold" style={{ color: colors.blue }}>
                  📞 Appeler
                </T>
              </Pressable>
            ) : null}
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
