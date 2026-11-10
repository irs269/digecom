import { zodResolver } from '@hookform/resolvers/zod';
import {
  createOrderSchema,
  DELIVERY_MODE_LABELS,
  DELIVERY_MODES,
  formatKmf,
  type CreateOrderInput,
  type DeliveryMode,
  type OrderView,
  type VisibleProduct,
} from '@digecom/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Image, Pressable, View } from 'react-native';
import {
  Button,
  Card,
  Empty,
  Field,
  Loading,
  Notice,
  Row,
  Screen,
  T,
  Title,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { reportLocation } from '@/lib/location';
import { cartEarnings, commonSites, type Cart } from '@/lib/cart';
import { keys, useCatalog } from '@/lib/hooks';
import { colors, radius } from '@/theme';

const MODE_DESC: Record<DeliveryMode, string> = {
  TO_SELLER: 'Un livreur t’apporte le produit, tu le remets au client.',
  TO_CUSTOMER: 'Un livreur livre le client et encaisse.',
  PICKUP: 'Tu récupères le produit au site.',
};

/** Au plus 10 produits différents par commande (limite de l'API). */
const MAX_LINES = 10;

export default function NouvelleVente() {
  const qc = useQueryClient();
  const catalog = useCatalog();
  /** Panier : produit → quantité. Une seule commande, préparée sur un site, une seule course. */
  const [cart, setCart] = useState<Cart>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<OrderView | null>(null);

  const form = useForm<z.input<typeof createOrderSchema>, unknown, CreateOrderInput>({
    resolver: zodResolver(createOrderSchema),
    defaultValues: {
      items: [],
      customerName: '',
      customerPhone: '',
      customerAddress: '',
      deliveryMode: 'TO_SELLER',
    },
  });
  const mode = form.watch('deliveryMode');

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      void reportLocation(0);
      const order = await api<OrderView>('/me/orders', { method: 'POST', body: values });
      setDone(order);
      setCart({});
      form.reset();
      void qc.invalidateQueries({ queryKey: keys.myOrders });
      void qc.invalidateQueries({ queryKey: keys.catalog });
    } catch (err) {
      setError(
        err instanceof ApiError && err.isNetwork
          ? 'Pas de réseau : une vente doit vérifier le stock en direct. Réessaie dès que le réseau revient.'
          : err instanceof Error
            ? err.message
            : 'Erreur',
      );
    }
  });

  const updateCart = (next: Cart) => {
    setCart(next);
    form.setValue(
      'items',
      Object.entries(next).map(([productId, quantity]) => ({ productId, quantity })),
    );
  };
  /** Toucher un produit l'ajoute au panier, ou l'en retire s'il y est déjà. */
  const toggle = (p: VisibleProduct) => {
    if (cart[p.id]) {
      const rest = { ...cart };
      delete rest[p.id];
      updateCart(rest);
    } else if (Object.keys(cart).length < MAX_LINES) {
      updateCart({ ...cart, [p.id]: 1 });
    }
  };
  const changeQty = (p: VisibleProduct, q: number) => {
    if (q < 1) return toggle(p);
    updateCart({ ...cart, [p.id]: Math.min(q, p.available) });
  };

  if (done) {
    return (
      <Screen>
        <Notice tone="green">
          Vente enregistrée (#{done.number}). Le site de {done.site.name} va la préparer.
        </Notice>
        <Button
          label="Voir la commande"
          onPress={() => router.push(`/vendeur/commande/${done.id}`)}
        />
        <Button label="Nouvelle vente" variant="outline" onPress={() => setDone(null)} />
      </Screen>
    );
  }

  const products = catalog.data?.products ?? [];
  const lines = Object.keys(cart).length;
  const calc = lines ? cartEarnings(products, cart) : null;
  // L'API prépare toute la commande sur un seul site : il doit avoir tout le panier en stock.
  const sitesOk = lines ? commonSites(products, cart) : [];

  return (
    <Screen onRefresh={() => void catalog.refetch()} refreshing={catalog.isRefetching}>
      <Title>Nouvelle vente</Title>
      {error ? <Notice tone="red">{error}</Notice> : null}

      <T weight="semibold" style={{ fontSize: 16 }}>
        1. Produits · catalogue de ton leader
      </T>
      <T style={{ color: colors.muted, fontSize: 13, marginBottom: 10 }}>
        Tu vois uniquement les produits et le stock publiés par{' '}
        {catalog.data?.leader.fullName ?? 'ton leader'}. Touche plusieurs produits : ils partent
        ensemble, en une seule livraison.
      </T>
      {catalog.isLoading ? <Loading /> : null}
      {catalog.data && catalog.data.products.length === 0 ? (
        <Empty
          title="Aucun produit disponible"
          text="Ton leader n’a pas encore publié de produit avec du stock sur ton île."
        />
      ) : null}
      {catalog.data?.products.map((p) => {
        const qty = cart[p.id] ?? 0;
        const selected = qty > 0;
        const out = p.available <= 0;
        return (
          <Pressable
            key={p.id}
            disabled={out}
            onPress={() => toggle(p)}
            testID={`produit-${p.sku}`}
          >
            <Card
              style={{
                borderColor: selected ? colors.blue : colors.line,
                borderWidth: selected ? 2 : 1,
                opacity: out ? 0.5 : 1,
              }}
            >
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                {p.photos[0] ? (
                  <Image
                    source={{ uri: p.photos[0].url }}
                    style={{ width: 52, height: 52, borderRadius: radius.sm }}
                  />
                ) : (
                  <View
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: radius.sm,
                      backgroundColor: colors.blueSoft,
                    }}
                  />
                )}
                <View style={{ flex: 1 }}>
                  <T weight="semibold">{p.name}</T>
                  <T style={{ color: out ? colors.red : colors.muted, fontSize: 13 }}>
                    {out
                      ? 'Rupture chez ton leader – vente bloquée'
                      : `${p.available} disponible${p.available > 1 ? 's' : ''}`}
                  </T>
                </View>
                <T weight="bold">{formatKmf(p.salePrice)}</T>
              </View>
              {selected ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 }}>
                  <T style={{ flex: 1, color: colors.muted }}>Quantité</T>
                  <Button label="−" variant="outline" onPress={() => changeQty(p, qty - 1)} />
                  <T weight="bold" testID={`quantite-${p.sku}`}>
                    {qty}
                  </T>
                  <Button
                    label="+"
                    variant="outline"
                    disabled={qty >= p.available}
                    onPress={() => changeQty(p, qty + 1)}
                  />
                </View>
              ) : null}
            </Card>
          </Pressable>
        );
      })}
      {catalog.data?.hiddenCount ? (
        <T style={{ color: colors.muted, fontSize: 12, marginBottom: 8 }}>
          {catalog.data.hiddenCount} produit(s) du catalogue en rupture ou retiré(s) : vente
          impossible.
        </T>
      ) : null}

      {lines >= MAX_LINES ? (
        <Notice tone="orange">10 produits différents au maximum par vente.</Notice>
      ) : null}
      {lines > 1 && sitesOk.length === 0 ? (
        <Notice tone="orange">
          Aucun site de ton île n’a tout ce panier en stock : fais deux ventes séparées, ou réduis
          les quantités.
        </Notice>
      ) : null}

      <T weight="semibold" style={{ fontSize: 16, marginTop: 12, marginBottom: 8 }}>
        2. Client
      </T>
      {(
        [
          ['customerName', 'Nom du client', 'default'],
          ['customerPhone', 'Téléphone', 'phone-pad'],
          ['customerAddress', 'Adresse ou quartier', 'default'],
        ] as const
      ).map(([name, label, kb]) => (
        <Controller
          key={name}
          control={form.control}
          name={name}
          render={({ field, fieldState }) => (
            <Field
              testID={name}
              label={label}
              keyboardType={kb}
              value={field.value ?? ''}
              onChangeText={field.onChange}
              error={fieldState.error?.message}
            />
          )}
        />
      ))}

      <T weight="semibold" style={{ fontSize: 16, marginTop: 4, marginBottom: 8 }}>
        3. Mode de remise
      </T>
      {DELIVERY_MODES.map((m) => (
        <Pressable key={m} onPress={() => form.setValue('deliveryMode', m)} testID={`mode-${m}`}>
          <Card
            style={{
              borderColor: mode === m ? colors.blue : colors.line,
              borderWidth: mode === m ? 2 : 1,
            }}
          >
            <T weight="semibold">{DELIVERY_MODE_LABELS[m]}</T>
            <T style={{ color: colors.muted, fontSize: 13 }}>{MODE_DESC[m]}</T>
          </Card>
        </Pressable>
      ))}

      {calc ? (
        <Card style={{ backgroundColor: colors.blueSoft, borderColor: colors.blueSoft }}>
          <T weight="semibold" style={{ marginBottom: 6 }}>
            Ce que tu gagnes sur cette vente
          </T>
          <Row
            label={`${calc.units} article${calc.units > 1 ? 's' : ''} · prix de vente`}
            value={formatKmf(calc.price)}
          />
          <Row label="Ta part" value={formatKmf(calc.part)} />
          <Row label="Taxe e-commerçant" value={`− ${formatKmf(calc.tax)}`} />
          <Row label="Net pour toi" value={formatKmf(calc.net)} strong />
          <T style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
            Validé seulement quand le client a pris le produit.
          </T>
        </Card>
      ) : null}

      {form.formState.errors.items ? (
        <Notice tone="red">Choisis au moins un produit.</Notice>
      ) : null}
      <Button
        testID="enregistrer-vente"
        label={lines > 1 ? `Enregistrer la vente (${lines} produits)` : 'Enregistrer la vente'}
        disabled={!lines || (lines > 1 && sitesOk.length === 0)}
        loading={form.formState.isSubmitting}
        onPress={() => void submit()}
      />
    </Screen>
  );
}
