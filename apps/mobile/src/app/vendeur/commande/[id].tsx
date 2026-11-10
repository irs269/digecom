import {
  DELIVERY_MODE_LABELS,
  formatKmf,
  mapPointUrl,
  ORDER_STATUS_LABELS,
  type OrderView,
} from '@digecom/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { CallButtons, CallLog } from '@/components/CallButtons';
import { MapSection } from '@/components/MapSection';
import { PendingBanner } from '@/components/pending';
import {
  Badge,
  Button,
  Card,
  Field,
  Loading,
  Notice,
  Row,
  Screen,
  Steps,
  T,
} from '@/components/ui';
import { keys, useMyOrders } from '@/lib/hooks';
import { submitAction } from '@/lib/offline';
import { receiveLabel, REFUSE_REASONS, sellerNet, statusHint, timeline } from '@/lib/orders';
import { colors } from '@/theme';

type Feedback = { tone: 'green' | 'red' | 'orange'; text: string };

export default function Commande() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const orders = useMyOrders();
  const order = orders.data?.items.find((o) => o.id === id);
  const [busy, setBusy] = useState<string | null>(null);
  const [refuseOpen, setRefuseOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [other, setOther] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  if (orders.isLoading)
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  if (!order) {
    return (
      <Screen>
        <Notice tone="red">Commande introuvable.</Notice>
        <Button
          label="← Mes commandes"
          variant="outline"
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace('/vendeur/commandes')
          }
        />
      </Screen>
    );
  }

  /** Mise à jour locale immédiate : l'écran reflète l'action même hors ligne. */
  const patchLocal = (patch: Partial<OrderView>) =>
    qc.setQueryData<{ items: OrderView[]; total: number }>(keys.myOrders, (old) =>
      old
        ? { ...old, items: old.items.map((o) => (o.id === order.id ? { ...o, ...patch } : o)) }
        : old,
    );

  const run = async (
    action: 'sellerConfirm' | 'markSold' | 'markRefused' | 'cancel',
    label: string,
    body: Record<string, unknown>,
    success: Feedback,
  ) => {
    setBusy(action);
    setFeedback(null);
    try {
      const res = await submitAction<OrderView>(
        `/me/orders/${order.id}/${action}`,
        body,
        `${label} – #${order.number}`,
      );
      if (res.status === 'sent') {
        patchLocal(res.data);
        setFeedback(success);
        void qc.invalidateQueries({ queryKey: keys.balance });
      } else {
        // Hors ligne : on retire le bouton pour éviter un double envoi.
        patchLocal({
          actions: order.actions.filter(
            (a) =>
              a !== action &&
              !(action === 'markSold' && a === 'markRefused') &&
              !(action === 'markRefused' && a === 'markSold'),
          ),
        });
        setFeedback({
          tone: 'orange',
          text: 'Pas de réseau : action gardée sur le téléphone, envoi automatique au retour du réseau.',
        });
      }
      setRefuseOpen(false);
    } catch (err) {
      setFeedback({ tone: 'red', text: err instanceof Error ? err.message : 'Erreur' });
    } finally {
      setBusy(null);
    }
  };

  const refuseReason = reason === 'Autre' ? other.trim() : reason;
  /** Un livreur a la commande en main ou va la chercher. */
  const inDelivery = ['ASSIGNED', 'OUT_FOR_DELIVERY'].includes(order.status);
  const fmtDate = (d: string) =>
    new Date(d).toLocaleString('fr-FR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  const can = (a: string) => order.actions.includes(a as never);

  return (
    <Screen onRefresh={() => void orders.refetch()} refreshing={orders.isRefetching}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/vendeur/commandes'))}
      >
        <T style={{ color: colors.blue, marginBottom: 10 }}>← Mes commandes</T>
      </Pressable>
      <PendingBanner />
      <T style={{ color: colors.muted, fontSize: 12 }}>COMMANDE #{order.number}</T>
      <T style={{ color: colors.muted, marginBottom: 8 }}>
        Créée le {fmtDate(order.createdAt)} · {DELIVERY_MODE_LABELS[order.deliveryMode]}
      </T>

      {/* Statut */}
      <Card>
        <T style={{ color: colors.muted, fontSize: 12, marginBottom: 6 }}>STATUT</T>
        <Badge status={order.status} />
        <T style={{ marginTop: 8 }} testID="statut-explication">
          {statusHint(order)}
        </T>
      </Card>

      {/* Livreur : mis en avant pendant la livraison */}
      {order.courier ? (
        <Card
          style={
            inDelivery
              ? { borderColor: colors.orange, borderWidth: 2, backgroundColor: colors.orangeSoft }
              : undefined
          }
        >
          <T style={{ color: colors.muted, fontSize: 12 }}>
            {inDelivery ? 'LIVREUR EN COURS' : 'LIVREUR'}
          </T>
          <T weight="semibold" style={{ fontSize: 17 }} testID="livreur-nom">
            {order.courier.fullName}
          </T>
          <T style={{ color: colors.muted }}>{order.courier.phone}</T>
          {inDelivery ? (
            <T style={{ marginTop: 4 }}>
              {order.status === 'ASSIGNED'
                ? `Va récupérer la commande au site de ${order.site.name}.`
                : order.deliveryMode === 'TO_CUSTOMER'
                  ? 'En route vers ton client.'
                  : 'En route vers toi.'}
            </T>
          ) : null}
          <CallButtons
            orderId={order.id}
            orderStatus={order.status}
            peerName={order.courier.fullName}
            peerPhone={order.courier.phone}
            primary={inDelivery}
          />
          {order.courierLocation ? (
            <MapSection
              testID="position-livreur"
              destination={order.courierLocation}
              externalUrl={mapPointUrl(order.courierLocation)}
            />
          ) : null}
        </Card>
      ) : order.status === 'READY' && order.deliveryMode !== 'PICKUP' ? (
        <Notice tone="orange">
          Aucun livreur pour l’instant : la course est proposée aux livreurs de ton île.
        </Notice>
      ) : null}

      {/* Produits */}
      <Card>
        <T style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>
          PRODUITS ({order.items.reduce((s, i) => s + i.quantity, 0)})
        </T>
        {order.items.map((i) => (
          <View
            key={i.id}
            testID="produit-ligne"
            style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <T weight="semibold" style={{ flex: 1 }}>
                {i.product.name}
              </T>
              <T weight="semibold">{formatKmf(i.unitPrice * i.quantity)}</T>
            </View>
            <T style={{ color: colors.muted, fontSize: 13 }}>
              {i.quantity} × {formatKmf(i.unitPrice)}
              {i.product.quality ? ` · ${i.product.quality}` : ''} · réf. {i.product.sku}
            </T>
            <T style={{ color: colors.green, fontSize: 13 }}>
              Ta part : {formatKmf(((i.sellerShare ?? 0) - i.sellerTax) * i.quantity)} net
            </T>
          </View>
        ))}
        <Row label="Total client" value={formatKmf(order.total)} strong />
        <Row label="Net pour toi" value={formatKmf(sellerNet(order))} />
        {order.amountCollected !== null ? (
          <Row label="Encaissé par le livreur" value={formatKmf(order.amountCollected)} />
        ) : null}
      </Card>

      {/* Client et remise */}
      <Card>
        <T style={{ color: colors.muted, fontSize: 12, marginBottom: 4 }}>CLIENT</T>
        <T weight="semibold">{order.customerName}</T>
        <T style={{ color: colors.muted }}>{order.customerPhone}</T>
        {order.customerAddress || order.zone ? (
          <T style={{ color: colors.muted }}>
            {[order.zone, order.customerAddress].filter(Boolean).join(' · ')}
          </T>
        ) : null}
        <Row label="Mode de remise" value={DELIVERY_MODE_LABELS[order.deliveryMode]} />
        <Row label="Site" value={order.site.name} />
        {order.refuseReason ? <Row label="Motif du refus" value={order.refuseReason} /> : null}
        {order.failReason ? <Row label="Motif de l’échec" value={order.failReason} /> : null}
        {order.cancelReason ? <Row label="Motif d’annulation" value={order.cancelReason} /> : null}
      </Card>

      {feedback ? (
        <View style={{ marginTop: 12 }}>
          <Notice tone={feedback.tone}>{feedback.text}</Notice>
        </View>
      ) : null}

      <Card style={{ marginTop: 12 }}>
        <Steps steps={timeline(order)} />
      </Card>

      <CallLog orderId={order.id} />

      {order.events.length ? (
        <Card>
          <T weight="semibold" style={{ marginBottom: 6 }}>
            Historique
          </T>
          {[...order.events].reverse().map((e) => (
            <View key={e.id} style={{ paddingVertical: 6 }} testID="evenement">
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <T weight="medium" style={{ flex: 1 }}>
                  {ORDER_STATUS_LABELS[e.toStatus]}
                </T>
                <T style={{ color: colors.muted, fontSize: 12 }}>
                  {new Date(e.at).toLocaleString('fr-FR', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </T>
              </View>
              {e.by || e.note ? (
                <T style={{ color: colors.muted, fontSize: 12 }}>
                  {[e.by?.fullName, e.note].filter(Boolean).join(' · ')}
                </T>
              ) : null}
            </View>
          ))}
        </Card>
      ) : null}

      {can('sellerConfirm') ? (
        <Button
          testID="recu"
          label={receiveLabel(order.deliveryMode)}
          loading={busy === 'sellerConfirm'}
          onPress={() =>
            void run(
              'sellerConfirm',
              receiveLabel(order.deliveryMode),
              {},
              { tone: 'green', text: 'Réception confirmée.' },
            )
          }
        />
      ) : null}

      {can('markSold') || can('markRefused') ? (
        <Card style={{ marginTop: 12 }}>
          <T weight="semibold" style={{ marginBottom: 4 }}>
            Le client a-t-il pris le produit ?
          </T>
          {can('markSold') ? (
            <Button
              testID="client-a-pris"
              label="Oui, le client a pris"
              loading={busy === 'markSold'}
              onPress={() =>
                void run(
                  'markSold',
                  'Client a pris',
                  {},
                  {
                    tone: 'green',
                    text: `Vente validée : ${formatKmf(sellerNet(order))} ajoutés à ton solde.`,
                  },
                )
              }
            />
          ) : null}
          {can('markRefused') && !refuseOpen ? (
            <Button
              testID="client-a-refuse"
              label="Non, le client a refusé"
              variant="danger"
              onPress={() => setRefuseOpen(true)}
            />
          ) : null}
          {refuseOpen ? (
            <View style={{ marginTop: 10 }}>
              <T weight="medium" style={{ marginBottom: 6 }}>
                Motif du refus
              </T>
              {REFUSE_REASONS.map((r) => (
                <Pressable key={r} onPress={() => setReason(r)} testID={`motif-${r}`}>
                  <View
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      borderWidth: 1,
                      marginBottom: 6,
                      borderColor: reason === r ? colors.red : colors.line,
                    }}
                  >
                    <T>{r}</T>
                  </View>
                </Pressable>
              ))}
              {reason === 'Autre' ? (
                <Field label="Précise" value={other} onChangeText={setOther} />
              ) : null}
              <T style={{ color: colors.muted, fontSize: 12 }}>
                Les propriétaires sont notifiés et le produit retourne au site.
              </T>
              <Button
                testID="confirmer-refus"
                label="Confirmer le refus"
                variant="danger"
                disabled={!refuseReason}
                loading={busy === 'markRefused'}
                onPress={() =>
                  void run(
                    'markRefused',
                    'Client a refusé',
                    { reason: refuseReason },
                    {
                      tone: 'orange',
                      text: 'Refus enregistré. Aucune commission sur cette vente.',
                    },
                  )
                }
              />
              <Button label="Annuler" variant="ghost" onPress={() => setRefuseOpen(false)} />
            </View>
          ) : null}
        </Card>
      ) : null}

      {can('cancel') ? (
        <Button
          label="Annuler la commande"
          variant="ghost"
          loading={busy === 'cancel'}
          onPress={() =>
            void run(
              'cancel',
              'Annulation',
              { reason: 'Annulée par l’e-commerçant' },
              { tone: 'orange', text: 'Commande annulée.' },
            )
          }
        />
      ) : null}
    </Screen>
  );
}
