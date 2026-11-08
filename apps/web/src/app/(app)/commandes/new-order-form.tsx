'use client';

import {
  DELIVERY_MODE_LABELS,
  DELIVERY_MODES,
  formatKmf,
  type DeliveryMode,
  type OrderView,
  type VisibleCatalog,
} from '@digecom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import { SelectField } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api';
import { errorMessage, fieldErrors } from '@/lib/queries';

/** « Nouvelle commande pour le compte de » : vendeur → catalogue de son leader → stock → mode. */
export function NewOrderForm({ onCreated }: { onCreated: (o: OrderView) => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const sellers = useQuery({
    queryKey: ['orders', 'sellers'],
    queryFn: () =>
      apiFetch<
        {
          id: string;
          fullName: string;
          role: string;
          island: { name: string } | null;
          leader: { id: string; fullName: string } | null;
        }[]
      >('/orders/sellers'),
  });
  const [sellerId, setSellerId] = useState('');
  const seller = sellers.data?.find((s) => s.id === sellerId);
  const catalog = useQuery({
    queryKey: ['orders', 'catalog', seller?.leader?.id],
    enabled: !!seller?.leader,
    queryFn: () => apiFetch<VisibleCatalog>(`/catalog/visible?asLeader=${seller!.leader!.id}`),
  });
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [f, setF] = useState({
    customerName: '',
    customerPhone: '',
    customerAddress: '',
    zone: '',
    deliveryMode: 'TO_CUSTOMER' as DeliveryMode,
    note: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const product = catalog.data?.products.find((p) => p.id === productId);

  const save = useMutation({
    mutationFn: () =>
      apiFetch<OrderView>('/orders', {
        method: 'POST',
        body: JSON.stringify({
          sellerId,
          items: [{ productId, quantity: Number(quantity) }],
          ...f,
        }),
      }),
    onSuccess: (o) => {
      toast(`${o.number} créée : stock réservé`, 'success');
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      onCreated(o);
    },
    onError: (err) => {
      setErrors(fieldErrors(err));
      toast(errorMessage(err), 'error');
    },
  });

  return (
    <form
      className="flex flex-col gap-3"
      aria-label="Nouvelle commande"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <SelectField
        label="Vendeur"
        value={sellerId}
        onChange={(e) => {
          setSellerId(e.target.value);
          setProductId('');
        }}
        placeholder="Choisir l’e-commerçant ou le TCI"
        options={(sellers.data ?? []).map((s) => ({
          value: s.id,
          label: `${s.fullName} · équipe ${s.leader?.fullName ?? '—'} · ${s.island?.name ?? ''}`,
        }))}
        error={errors.sellerId}
      />
      {seller ? (
        <SelectField
          label={`Produit (catalogue de ${seller.leader?.fullName ?? 'son leader'})`}
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          placeholder={
            catalog.data && !catalog.data.products.length ? 'Aucun produit disponible' : 'Choisir'
          }
          options={(catalog.data?.products ?? []).map((p) => ({
            value: p.id,
            label: `${p.name}${p.quality ? ` (${p.quality})` : ''} · ${formatKmf(p.salePrice)} · ${p.available} dispo`,
          }))}
          error={errors.items}
        />
      ) : null}
      {product ? (
        <Field
          label={`Quantité (max ${product.available})`}
          type="number"
          min={1}
          max={product.available}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      ) : null}
      <Field
        label="Nom du client"
        value={f.customerName}
        onChange={(e) => setF({ ...f, customerName: e.target.value })}
        error={errors.customerName}
      />
      <Field
        label="Téléphone du client"
        type="tel"
        value={f.customerPhone}
        onChange={(e) => setF({ ...f, customerPhone: e.target.value })}
        error={errors.customerPhone}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Adresse / quartier"
          value={f.customerAddress}
          onChange={(e) => setF({ ...f, customerAddress: e.target.value })}
        />
        <Field label="Zone" value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })} />
      </div>
      <SelectField
        label="Mode de remise"
        value={f.deliveryMode}
        onChange={(e) => setF({ ...f, deliveryMode: e.target.value as DeliveryMode })}
        options={DELIVERY_MODES.map((m) => ({ value: m, label: DELIVERY_MODE_LABELS[m] }))}
      />
      {product ? (
        <p className="rounded-md bg-surface px-3 py-2 text-sm">
          Total : <strong>{formatKmf(product.salePrice * (Number(quantity) || 0))}</strong>
        </p>
      ) : null}
      <Button type="submit" disabled={save.isPending || !productId}>
        Créer la commande
      </Button>
    </form>
  );
}
