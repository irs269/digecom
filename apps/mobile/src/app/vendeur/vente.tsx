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
import { keys, useCatalog } from '@/lib/hooks';
import { colors, radius } from '@/theme';

const MODE_DESC: Record<DeliveryMode, string> = {
  TO_SELLER: 'Un livreur t’apporte le produit, tu le remets au client.',
  TO_CUSTOMER: 'Un livreur livre le client et encaisse.',
  PICKUP: 'Tu récupères le produit au site.',
};

/** Ce que le vendeur gagne : part − taxe, par unité × quantité. */
export function earnings(p: VisibleProduct, quantity: number) {
  const part = (p.sellerAmount ?? 0) * quantity;
  const tax = p.sellerTax * quantity;
  return { price: p.salePrice * quantity, part, tax, net: part - tax };
}

export default function NouvelleVente() {
  const qc = useQueryClient();
  const catalog = useCatalog();
  const [product, setProduct] = useState<VisibleProduct | null>(null);
  const [quantity, setQuantity] = useState(1);
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
      const order = await api<OrderView>('/me/orders', { method: 'POST', body: values });
      setDone(order);
      setProduct(null);
      setQuantity(1);
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

  const choose = (p: VisibleProduct) => {
    setProduct(p);
    setQuantity(1);
    form.setValue('items', [{ productId: p.id, quantity: 1 }], { shouldValidate: false });
  };
  const changeQty = (q: number) => {
    if (!product) return;
    const next = Math.max(1, Math.min(q, product.available));
    setQuantity(next);
    form.setValue('items', [{ productId: product.id, quantity: next }]);
  };

  if (done) {
    return (
      <Screen>
        <Notice tone="green">
          Vente enregistrée (#{done.number}). Le site de {done.site.name} va la préparer.
        </Notice>
        <Button
          label="Voir la commande"
          onPress={() => router.navigate(`/vendeur/commande/${done.id}`)}
        />
        <Button label="Nouvelle vente" variant="outline" onPress={() => setDone(null)} />
      </Screen>
    );
  }

  const calc = product ? earnings(product, quantity) : null;

  return (
    <Screen onRefresh={() => void catalog.refetch()} refreshing={catalog.isRefetching}>
      <Title>Nouvelle vente</Title>
      {error ? <Notice tone="red">{error}</Notice> : null}

      <T weight="semibold" style={{ fontSize: 16 }}>
        1. Produit · catalogue de ton leader
      </T>
      <T style={{ color: colors.muted, fontSize: 13, marginBottom: 10 }}>
        Tu vois uniquement les produits et le stock publiés par{' '}
        {catalog.data?.leader.fullName ?? 'ton leader'}.
      </T>
      {catalog.isLoading ? <Loading /> : null}
      {catalog.data && catalog.data.products.length === 0 ? (
        <Empty
          title="Aucun produit disponible"
          text="Ton leader n’a pas encore publié de produit avec du stock sur ton île."
        />
      ) : null}
      {catalog.data?.products.map((p) => {
        const selected = product?.id === p.id;
        const out = p.available <= 0;
        return (
          <Pressable
            key={p.id}
            disabled={out}
            onPress={() => choose(p)}
            testID={`produit-${p.sku}`}
          >
            <Card
              style={{
                flexDirection: 'row',
                gap: 12,
                alignItems: 'center',
                borderColor: selected ? colors.blue : colors.line,
                borderWidth: selected ? 2 : 1,
                opacity: out ? 0.5 : 1,
              }}
            >
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

      {product ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <T>Quantité</T>
          <Button label="−" variant="outline" onPress={() => changeQty(quantity - 1)} />
          <T weight="bold" testID="quantite">
            {quantity}
          </T>
          <Button label="+" variant="outline" onPress={() => changeQty(quantity + 1)} />
        </View>
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
          <Row label="Prix de vente" value={formatKmf(calc.price)} />
          <Row label="Ta part" value={formatKmf(calc.part)} />
          <Row label="Taxe e-commerçant" value={`− ${formatKmf(calc.tax)}`} />
          <Row label="Net pour toi" value={formatKmf(calc.net)} strong />
          <T style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
            Validé seulement quand le client a pris le produit.
          </T>
        </Card>
      ) : null}

      {form.formState.errors.items ? <Notice tone="red">Choisis un produit.</Notice> : null}
      <Button
        testID="enregistrer-vente"
        label="Enregistrer la vente"
        disabled={!product}
        loading={form.formState.isSubmitting}
        onPress={() => void submit()}
      />
    </Screen>
  );
}
