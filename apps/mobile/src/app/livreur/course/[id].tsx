import { FAIL_REASONS, formatKmf, type OrderView } from '@digecom/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, Linking, Pressable, View } from 'react-native';
import { CallButtons, CallLog } from '@/components/CallButtons';
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
import { keys, useRuns } from '@/lib/hooks';
import { submitAction } from '@/lib/offline';
import { colors, radius } from '@/theme';

type Action = 'pickup' | 'handover' | 'fail' | 'markSold' | 'markRefused';

/** Photo de preuve compressée avant envoi : 1280 px de large, JPEG 70 %. */
export async function compressProof(uri: string): Promise<string> {
  const ref = await ImageManipulator.manipulate(uri, { maxWidth: 2560 })
    .resize({ width: 1280 })
    .renderAsync();
  const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 });
  return out.uri;
}

export default function Course() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const runs = useRuns();
  const run = runs.data?.find((r) => r.id === id);
  const [busy, setBusy] = useState<Action | null>(null);
  const [amount, setAmount] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [problem, setProblem] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: 'green' | 'red' | 'orange';
    text: string;
  } | null>(null);

  if (runs.isLoading)
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  if (!run) {
    return (
      <Screen>
        <Notice tone="blue">Cette course n’est plus en cours (terminée ou réaffectée).</Notice>
        <Button
          label="← Mes courses"
          variant="outline"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/livreur'))}
        />
      </Screen>
    );
  }

  const direct = run.deliveryMode === 'TO_CUSTOMER';
  const dest = direct ? run.customerName : run.seller.fullName;
  const destPhone = direct ? run.customerPhone : run.seller.phone;
  const can = (a: Action) => run.actions.includes(a);

  const patchLocal = (patch: Partial<OrderView>) =>
    qc.setQueryData<OrderView[]>(keys.runs, (old) =>
      old?.map((r) => (r.id === run.id ? { ...r, ...patch } : r)),
    );

  const act = async (
    action: Action,
    label: string,
    body: Record<string, unknown>,
    done: string,
    withPhoto = false,
  ) => {
    setBusy(action);
    setFeedback(null);
    try {
      const res = await submitAction<OrderView>(
        `/courier/runs/${run.id}/${action}`,
        body,
        `${label} – #${run.number}`,
        withPhoto && photo
          ? { uri: photo, contentType: 'image/jpeg', presignPath: '/courier/proof-upload-url' }
          : undefined,
      );
      if (res.status === 'sent') {
        patchLocal(res.data);
        setFeedback({ tone: 'green', text: done });
        void qc.invalidateQueries({ queryKey: keys.history });
      } else {
        patchLocal({ actions: [] });
        setFeedback({
          tone: 'orange',
          text: 'Pas de réseau : action gardée sur le téléphone, envoi automatique au retour du réseau.',
        });
      }
      setProblem(false);
    } catch (err) {
      setFeedback({ tone: 'red', text: err instanceof Error ? err.message : 'Erreur' });
    } finally {
      setBusy(null);
    }
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setFeedback({ tone: 'red', text: 'Autorise l’appareil photo pour ajouter une preuve.' });
      return;
    }
    const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (shot.canceled || !shot.assets[0]) return;
    setPhoto(await compressProof(shot.assets[0].uri));
  };

  const amountValue = Number(amount.replace(/\s/g, ''));
  const amountOk =
    !direct || (amount.trim() !== '' && Number.isInteger(amountValue) && amountValue >= 0);
  const pickedUp = !['ASSIGNED'].includes(run.status);

  return (
    <Screen onRefresh={() => void runs.refetch()} refreshing={runs.isRefetching}>
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/livreur'))}>
        <T style={{ color: colors.blue, marginBottom: 10 }}>← Mes courses</T>
      </Pressable>
      <PendingBanner />
      <T style={{ color: colors.muted, fontSize: 12 }}>COURSE EN COURS · #{run.number}</T>
      <T weight="bold" style={{ fontSize: 20, marginBottom: 6 }}>
        {run.items
          .map((i) => `${i.product.name}${i.quantity > 1 ? ` × ${i.quantity}` : ''}`)
          .join(', ')}
      </T>
      <Badge status={run.status} />
      {feedback ? (
        <View style={{ marginTop: 12 }}>
          <Notice tone={feedback.tone}>{feedback.text}</Notice>
        </View>
      ) : null}

      <Card style={{ marginTop: 12 }}>
        <Steps
          steps={[
            { label: `Récupérer au site ${run.site.name}`, done: pickedUp, current: !pickedUp },
            {
              label: direct ? 'Remettre au client et encaisser' : 'Remettre à l’e-commerçant',
              done: run.status === 'HANDED_OVER',
              current: run.status === 'OUT_FOR_DELIVERY',
            },
          ]}
        />
      </Card>

      {can('pickup') ? (
        <>
          <Notice tone="blue">Rends-toi à {run.site.name} et récupère le colis.</Notice>
          <Button
            testID="recupere"
            label="J’ai récupéré le produit"
            loading={busy === 'pickup'}
            onPress={() => void act('pickup', 'Retrait', {}, 'Retrait confirmé. En route !')}
          />
        </>
      ) : null}

      <Card style={{ marginTop: 12 }}>
        <T style={{ color: colors.muted, fontSize: 12 }}>{direct ? 'CLIENT' : 'E-COMMERÇANT'}</T>
        <T weight="semibold" style={{ fontSize: 16 }}>
          {dest}
        </T>
        <T style={{ color: colors.muted }}>
          {[run.zone, run.customerAddress].filter(Boolean).join(' · ') || '—'} · {destPhone}
        </T>
        {direct ? (
          // Le client n'a pas l'application : appel téléphonique.
          <Button
            label={`Appeler ${dest}`}
            variant="outline"
            onPress={() => void Linking.openURL(`tel:${destPhone}`)}
          />
        ) : (
          <CallButtons
            orderId={run.id}
            orderStatus={run.status}
            peerName={dest}
            peerPhone={destPhone}
            primary={false}
          />
        )}
      </Card>

      {direct ? (
        <Card>
          <T style={{ color: colors.muted, fontSize: 12 }}>E-COMMERÇANT</T>
          <T weight="semibold">{run.seller.fullName}</T>
          <CallButtons
            orderId={run.id}
            orderStatus={run.status}
            peerName={run.seller.fullName}
            peerPhone={run.seller.phone}
            primary={false}
          />
        </Card>
      ) : null}

      <CallLog orderId={run.id} />

      {can('handover') ? (
        <Card>
          <T weight="semibold" style={{ marginBottom: 8 }}>
            {direct ? 'Remise au client' : 'Remise à l’e-commerçant'}
          </T>
          {direct ? (
            <>
              <Row label="Montant à encaisser" value={formatKmf(run.total)} />
              <Field
                testID="montant"
                label="Montant encaissé auprès du client (KMF)"
                keyboardType="number-pad"
                value={amount}
                onChangeText={setAmount}
                placeholder={String(run.total)}
              />
            </>
          ) : null}
          {photo ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <Image
                source={{ uri: photo }}
                style={{ width: 56, height: 56, borderRadius: radius.sm }}
              />
              <T style={{ color: colors.green, flex: 1 }}>Photo de preuve ajoutée</T>
              <Pressable onPress={() => setPhoto(null)}>
                <T style={{ color: colors.red }}>Retirer</T>
              </Pressable>
            </View>
          ) : (
            <Button
              label="+ Prendre une photo de preuve"
              variant="outline"
              onPress={() => void takePhoto()}
            />
          )}
          <Button
            testID="confirmer-livraison"
            label="Confirmer la livraison"
            disabled={!amountOk}
            loading={busy === 'handover'}
            onPress={() =>
              void act(
                'handover',
                'Remise',
                direct ? { amountCollected: amountValue } : {},
                direct
                  ? 'Remise confirmée. Indique maintenant si le client a pris le produit.'
                  : `Remise confirmée de ton côté. ${dest} doit maintenant confirmer la réception dans son application.`,
                true,
              )
            }
          />
        </Card>
      ) : null}

      {can('markSold') || can('markRefused') ? (
        <Card>
          <T weight="semibold">Le client a-t-il pris le produit ?</T>
          {can('markSold') ? (
            <Button
              testID="client-a-pris"
              label="Oui, le client a pris"
              loading={busy === 'markSold'}
              onPress={() => void act('markSold', 'Client a pris', {}, 'Vente validée.')}
            />
          ) : null}
          {can('markRefused') ? (
            <Button
              label="Non, le client a refusé"
              variant="danger"
              loading={busy === 'markRefused'}
              onPress={() =>
                void act(
                  'markRefused',
                  'Client a refusé',
                  { reason: 'Client a refusé à la livraison' },
                  'Refus enregistré. Rapporte le produit au site.',
                )
              }
            />
          ) : null}
        </Card>
      ) : null}

      {can('fail') ? (
        problem ? (
          <Card>
            <T weight="semibold" style={{ marginBottom: 6 }}>
              Que s’est-il passé ?
            </T>
            {FAIL_REASONS.map((r) => (
              <Pressable key={r} onPress={() => setReason(r)}>
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
            <Button
              label="Signaler l’échec"
              variant="danger"
              disabled={!reason}
              loading={busy === 'fail'}
              onPress={() =>
                void act('fail', 'Échec', { reason }, 'Échec signalé. Rapporte le produit au site.')
              }
            />
            <Button label="Annuler" variant="ghost" onPress={() => setProblem(false)} />
          </Card>
        ) : (
          <Button label="Signaler un problème" variant="ghost" onPress={() => setProblem(true)} />
        )
      ) : null}
    </Screen>
  );
}
