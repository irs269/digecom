import {
  DELIVERY_MODE_LABELS,
  formatKmf,
  type DeliveryOfferView,
  type MeResponse,
  type OrderView,
} from '@digecom/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { PendingBanner } from '@/components/pending';
import { Badge, Button, Card, Empty, Notice, Row, Screen, T } from '@/components/ui';
import { api, ApiError, updateUser } from '@/lib/api';
import { keys, useOffers, useRuns } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { colors, radius } from '@/theme';

export default function Courses() {
  const { user, logout } = useSession();
  const qc = useQueryClient();
  const available = user?.isAvailable ?? false;
  const offers = useOffers(available);
  const runs = useRuns();
  const [ignored, setIgnored] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'red' | 'orange' | 'green'; text: string } | null>(
    null,
  );

  const toggle = async (next: boolean) => {
    if (!user) return;
    setBusy('dispo');
    setMessage(null);
    try {
      await api('/courier/availability', { method: 'PATCH', body: { isAvailable: next } });
      updateUser({ ...user, isAvailable: next } as MeResponse);
      if (next) void offers.refetch();
    } catch (err) {
      setMessage({
        tone: 'red',
        text:
          err instanceof ApiError && err.isNetwork
            ? 'Pas de réseau : réessaie.'
            : (err as Error).message,
      });
    } finally {
      setBusy(null);
    }
  };

  /** Accepter demande le réseau : la course revient au premier qui accepte. */
  const accept = async (o: DeliveryOfferView) => {
    setBusy(o.orderId);
    setMessage(null);
    try {
      const order = await api<OrderView>(`/courier/offers/${o.orderId}/accept`, { method: 'POST' });
      void qc.invalidateQueries({ queryKey: keys.offers });
      await qc.invalidateQueries({ queryKey: keys.runs });
      router.push(`/livreur/course/${order.id}`);
    } catch (err) {
      void qc.invalidateQueries({ queryKey: keys.offers });
      setMessage({
        tone: err instanceof ApiError && err.status === 409 ? 'orange' : 'red',
        text:
          err instanceof ApiError && err.isNetwork
            ? 'Pas de réseau : impossible d’accepter la course pour l’instant.'
            : err instanceof ApiError && err.status === 409
              ? 'Trop tard : un autre livreur a pris cette course.'
              : (err as Error).message,
      });
    } finally {
      setBusy(null);
    }
  };

  const visibleOffers = (offers.data ?? []).filter((o) => !ignored.includes(o.orderId));
  const refresh = () => {
    void offers.refetch();
    void runs.refetch();
  };

  return (
    <Screen onRefresh={refresh} refreshing={runs.isRefetching || offers.isRefetching}>
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
        <View>
          <T weight="bold" style={{ fontSize: 22 }}>
            {user?.fullName}
          </T>
          <T style={{ color: colors.muted }}>Livreur · {user?.island?.name}</T>
        </View>
        <Pressable onPress={() => void logout()}>
          <T style={{ color: colors.blue, fontSize: 13 }}>Déconnexion</T>
        </Pressable>
      </View>

      <Card
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 14,
          backgroundColor: available ? colors.greenSoft : colors.white,
        }}
      >
        <T
          weight="semibold"
          style={{ fontSize: 16, color: available ? colors.green : colors.muted }}
        >
          {available ? 'Disponible' : 'Indisponible'}
        </T>
        <Switch
          testID="disponible"
          value={available}
          disabled={busy === 'dispo'}
          onValueChange={(v) => void toggle(v)}
          trackColor={{ true: colors.green, false: colors.line }}
        />
      </Card>

      <PendingBanner />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {runs.data?.length ? (
        <>
          <T weight="semibold" style={{ fontSize: 17, marginVertical: 8 }}>
            Course en cours
          </T>
          {runs.data.map((r) => (
            <Pressable
              key={r.id}
              onPress={() => router.push(`/livreur/course/${r.id}`)}
              testID={`course-${r.number}`}
            >
              <Card style={{ borderLeftWidth: 4, borderLeftColor: colors.blue }}>
                <T style={{ color: colors.muted, fontSize: 12 }}>#{r.number}</T>
                <T weight="semibold">{r.items.map((i) => i.product.name).join(', ')}</T>
                <T style={{ color: colors.muted, fontSize: 13, marginBottom: 6 }}>
                  {DELIVERY_MODE_LABELS[r.deliveryMode]}
                </T>
                <Badge status={r.status} />
              </Card>
            </Pressable>
          ))}
        </>
      ) : null}

      {!available ? (
        <Empty
          title="Tu es indisponible"
          text="Aucune course ne te sera proposée. Repasse en disponible quand tu es prêt."
        />
      ) : visibleOffers.length === 0 ? (
        !runs.data?.length ? (
          <Empty
            title="Aucune course pour le moment"
            text={`Tu recevras une notification dès qu’une livraison est prête sur ${user?.island?.name ?? 'ton île'}.`}
          />
        ) : null
      ) : (
        visibleOffers.map((o) => (
          <View
            key={o.orderId}
            style={{
              backgroundColor: colors.blue,
              borderRadius: radius.lg,
              padding: 16,
              marginBottom: 12,
            }}
            testID={`offre-${o.number}`}
          >
            <T weight="semibold" style={{ color: colors.orange, fontSize: 12 }}>
              NOUVELLE LIVRAISON
            </T>
            <T style={{ color: colors.blueSoft }}>Commande #{o.number}</T>
            <T weight="bold" style={{ color: colors.white, fontSize: 18, marginBottom: 8 }}>
              {o.items
                .map((i) => `${i.name}${i.quantity > 1 ? ` × ${i.quantity}` : ''}`)
                .join(', ')}
            </T>
            <View style={{ backgroundColor: colors.white, borderRadius: radius.md, padding: 12 }}>
              <Row label="Récupérer au site" value={o.site.name} />
              <Row
                label={
                  o.deliveryMode === 'TO_CUSTOMER' ? 'Livrer au client' : 'Livrer à l’e-commerçant'
                }
                value={o.zone ?? o.customerAddress ?? '—'}
              />
              {o.deliveryMode === 'TO_CUSTOMER' ? (
                <Row label="À encaisser" value={formatKmf(o.total)} />
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button
                  label="Ignorer"
                  variant="outline"
                  onPress={() => setIgnored((l) => [...l, o.orderId])}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  testID={`accepter-${o.number}`}
                  label="Accepter"
                  variant="orange"
                  loading={busy === o.orderId}
                  onPress={() => void accept(o)}
                />
              </View>
            </View>
            <T style={{ color: colors.blueSoft, fontSize: 12, marginTop: 8 }}>
              Proposée aux livreurs disponibles de {user?.island?.name}. Le premier qui accepte la
              prend.
            </T>
          </View>
        ))
      )}
    </Screen>
  );
}
