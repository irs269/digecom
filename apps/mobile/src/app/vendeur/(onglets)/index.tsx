import { formatKmf } from '@digecom/shared';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { PendingBanner } from '@/components/pending';
import { Button, Card, Empty, Screen, T } from '@/components/ui';
import { useBalance, useCatalog, useMyOrders } from '@/lib/hooks';
import { todoOf } from '@/lib/orders';
import { useSession } from '@/lib/session';
import { colors, radius } from '@/theme';

const ACTIVE = [
  'NEW',
  'CONFIRMED',
  'PREPARING',
  'READY',
  'ASSIGNED',
  'OUT_FOR_DELIVERY',
  'HANDED_OVER',
];

export default function Accueil() {
  const { user, logout } = useSession();
  const balance = useBalance();
  const orders = useMyOrders();
  const catalog = useCatalog();
  const list = orders.data?.items ?? [];
  const todo = list.filter((o) => todoOf(o));
  const fmtDay = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

  const refresh = () => {
    void balance.refetch();
    void orders.refetch();
    void catalog.refetch();
  };

  return (
    <Screen onRefresh={refresh} refreshing={orders.isRefetching}>
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
        <View style={{ flex: 1 }}>
          <T style={{ color: colors.muted }}>Bonjour</T>
          <T weight="bold" style={{ fontSize: 22 }}>
            {user?.fullName}
          </T>
          <T style={{ color: colors.muted, fontSize: 13 }}>
            {user?.island?.name}
            {catalog.data ? ` · Catalogue de ${catalog.data.leader.fullName}` : ''}
          </T>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 10 }}>
          <Pressable
            onPress={() => router.push('/appels')}
            accessibilityRole="button"
            testID="ouvrir-appels"
          >
            <T weight="semibold" style={{ color: colors.blue, fontSize: 14 }}>
              📞 Appels
            </T>
          </Pressable>
          <Pressable onPress={() => void logout()} accessibilityRole="button">
            <T style={{ color: colors.blue, fontSize: 13 }}>Déconnexion</T>
          </Pressable>
        </View>
      </View>

      <PendingBanner />

      <View
        style={{
          backgroundColor: colors.blue,
          borderRadius: radius.lg,
          padding: 18,
          marginVertical: 14,
        }}
      >
        <T style={{ color: colors.blueSoft, fontSize: 13 }}>
          Solde du cycle en cours
          {balance.data
            ? ` (${fmtDay(balance.data.cycle.start)} – ${fmtDay(balance.data.cycle.end)})`
            : ''}
        </T>
        <T
          weight="bold"
          style={{ color: colors.white, fontSize: 30, marginVertical: 4 }}
          testID="solde-net"
        >
          {balance.data ? formatKmf(balance.data.current.estimatedNet) : '…'}
        </T>
        <T style={{ color: colors.white }}>
          {balance.data?.current.salesCount ?? 0} ventes validées
        </T>
        {balance.data?.current.subscriptions ? (
          <T style={{ color: colors.blueSoft, fontSize: 13 }}>
            Abonnement : {formatKmf(balance.data.current.subscriptions)} retenus
          </T>
        ) : null}
      </View>

      <Button
        label="+ Nouvelle vente"
        variant="orange"
        onPress={() => router.navigate('/vendeur/vente')}
        testID="nouvelle-vente"
      />

      <T weight="semibold" style={{ fontSize: 17, marginTop: 20, marginBottom: 10 }}>
        À faire
      </T>
      {todo.length === 0 ? (
        <Empty title="Rien à faire pour l’instant." text="Bonne vente !" />
      ) : (
        todo.map((o) => (
          <Pressable key={o.id} onPress={() => router.push(`/vendeur/commande/${o.id}`)}>
            <Card style={{ borderLeftWidth: 4, borderLeftColor: colors.orange }}>
              <T weight="semibold">{todoOf(o)}</T>
              <T style={{ color: colors.muted, fontSize: 13 }}>
                #{o.number} · {o.items.map((i) => i.product.name).join(', ')}
              </T>
            </Card>
          </Pressable>
        ))
      )}

      <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
        <Card style={{ flex: 1 }}>
          <T weight="bold" style={{ fontSize: 24 }}>
            {list.filter((o) => ACTIVE.includes(o.status)).length}
          </T>
          <T style={{ color: colors.muted }}>Commandes en cours</T>
        </Card>
        <Card style={{ flex: 1 }}>
          <T weight="bold" style={{ fontSize: 24 }}>
            {list.filter((o) => o.status === 'SOLD').length}
          </T>
          <T style={{ color: colors.muted }}>Ventes réussies</T>
        </Card>
      </View>
    </Screen>
  );
}
