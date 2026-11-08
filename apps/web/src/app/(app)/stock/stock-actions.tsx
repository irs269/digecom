'use client';

import type { InventoryView, Paginated, ProductView, SiteView } from '@digecom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import { SelectField } from '@/components/ui/select';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api';
import { errorMessage, fieldErrors } from '@/lib/queries';

export type StockAction = 'entry' | 'transfer' | 'adjust' | 'inventory';

function useProducts() {
  return useQuery({
    queryKey: ['products', 'all'],
    queryFn: () => apiFetch<Paginated<ProductView>>('/products?pageSize=200').then((p) => p.items),
  });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['stock'] });
    void queryClient.invalidateQueries({ queryKey: ['products'] });
    void queryClient.invalidateQueries({ queryKey: ['stock-movements'] });
  };
}

interface Common {
  sites: SiteView[];
  allSites: SiteView[];
  onDone: () => void;
}

function productOptions(products: ProductView[] | undefined) {
  return (products ?? []).map((p) => ({
    value: p.id,
    label: `${p.name} · ${p.leader.fullName} (${p.sku})`,
  }));
}

function Reason({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <Field
      label="Motif (obligatoire)"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={error}
    />
  );
}

export function EntryForm({ sites, onDone }: Common) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const products = useProducts();
  const [f, setF] = useState({ productId: '', siteId: '', quantity: '', unitCost: '', reason: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ lotNumber: string }>('/stock/entry', {
        method: 'POST',
        body: JSON.stringify({ ...f, quantity: Number(f.quantity), unitCost: Number(f.unitCost) }),
      }),
    onSuccess: (r) => {
      toast(`Entrée enregistrée (${r.lotNumber})`, 'success');
      invalidate();
      onDone();
    },
    onError: (err) => {
      setErrors(fieldErrors(err));
      toast(errorMessage(err), 'error');
    },
  });
  return (
    <form
      className="flex flex-col gap-3"
      aria-label="Entrée de marchandises"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <p className="text-sm text-ink-muted">
        Pour un lot importé, utilise la réception dans « Achats Chine ». Ici : achat local ou
        reprise, avec son coût unitaire réel.
      </p>
      <SelectField
        label="Produit"
        value={f.productId}
        onChange={(e) => setF({ ...f, productId: e.target.value })}
        placeholder="Choisir"
        options={productOptions(products.data)}
        error={errors.productId}
      />
      <SelectField
        label="Site"
        value={f.siteId}
        onChange={(e) => setF({ ...f, siteId: e.target.value })}
        placeholder="Choisir"
        options={sites.map((s) => ({ value: s.id, label: s.name }))}
        error={errors.siteId}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Quantité"
          type="number"
          min={1}
          value={f.quantity}
          onChange={(e) => setF({ ...f, quantity: e.target.value })}
          error={errors.quantity}
        />
        <Field
          label="Coût unitaire (KMF)"
          type="number"
          min={0}
          value={f.unitCost}
          onChange={(e) => setF({ ...f, unitCost: e.target.value })}
          error={errors.unitCost}
        />
      </div>
      <Reason value={f.reason} onChange={(v) => setF({ ...f, reason: v })} error={errors.reason} />
      <Button type="submit" disabled={save.isPending}>
        Enregistrer l’entrée
      </Button>
    </form>
  );
}

export function TransferForm({ sites, allSites, onDone }: Common) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const products = useProducts();
  const [f, setF] = useState({
    productId: '',
    fromSiteId: '',
    toSiteId: '',
    quantity: '',
    reason: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () =>
      apiFetch('/stock/transfer', {
        method: 'POST',
        body: JSON.stringify({ ...f, quantity: Number(f.quantity) }),
      }),
    onSuccess: () => {
      toast('Transfert enregistré : sortie au départ, entrée à l’arrivée', 'success');
      invalidate();
      onDone();
    },
    onError: (err) => {
      setErrors(fieldErrors(err));
      toast(errorMessage(err), 'error');
    },
  });
  return (
    <form
      className="flex flex-col gap-3"
      aria-label="Transfert"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <SelectField
        label="Produit"
        value={f.productId}
        onChange={(e) => setF({ ...f, productId: e.target.value })}
        placeholder="Choisir"
        options={productOptions(products.data)}
        error={errors.productId}
      />
      <SelectField
        label="Site de départ"
        value={f.fromSiteId}
        onChange={(e) => setF({ ...f, fromSiteId: e.target.value })}
        placeholder="Choisir"
        options={sites.map((s) => ({ value: s.id, label: s.name }))}
        error={errors.fromSiteId}
      />
      <SelectField
        label="Site d’arrivée"
        value={f.toSiteId}
        onChange={(e) => setF({ ...f, toSiteId: e.target.value })}
        placeholder="Choisir"
        options={allSites
          .filter((s) => s.id !== f.fromSiteId)
          .map((s) => ({ value: s.id, label: `${s.name} (${s.island.name})` }))}
        error={errors.toSiteId}
      />
      <Field
        label="Quantité"
        type="number"
        min={1}
        value={f.quantity}
        onChange={(e) => setF({ ...f, quantity: e.target.value })}
        error={errors.quantity}
      />
      <Reason value={f.reason} onChange={(v) => setF({ ...f, reason: v })} error={errors.reason} />
      <Button type="submit" disabled={save.isPending}>
        Transférer
      </Button>
    </form>
  );
}

export function AdjustForm({
  sites,
  onDone,
  initial,
}: Common & { initial?: { productId: string; siteId: string } }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const products = useProducts();
  const [f, setF] = useState({
    productId: initial?.productId ?? '',
    siteId: initial?.siteId ?? '',
    kind: 'ADJUST',
    delta: '',
    reason: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () =>
      apiFetch('/stock/adjust', {
        method: 'POST',
        body: JSON.stringify({ ...f, delta: Number(f.delta) }),
      }),
    onSuccess: () => {
      toast('Mouvement enregistré', 'success');
      invalidate();
      onDone();
    },
    onError: (err) => {
      setErrors(fieldErrors(err));
      toast(errorMessage(err), 'error');
    },
  });
  return (
    <form
      className="flex flex-col gap-3"
      aria-label="Ajustement"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <SelectField
        label="Produit"
        value={f.productId}
        onChange={(e) => setF({ ...f, productId: e.target.value })}
        placeholder="Choisir"
        options={productOptions(products.data)}
        error={errors.productId}
      />
      <SelectField
        label="Site"
        value={f.siteId}
        onChange={(e) => setF({ ...f, siteId: e.target.value })}
        placeholder="Choisir"
        options={sites.map((s) => ({ value: s.id, label: s.name }))}
        error={errors.siteId}
      />
      <SelectField
        label="Type"
        value={f.kind}
        onChange={(e) => setF({ ...f, kind: e.target.value })}
        options={[
          { value: 'ADJUST', label: 'Ajustement (+ ou −)' },
          { value: 'DAMAGED', label: 'Casse' },
          { value: 'LOSS', label: 'Perte' },
        ]}
      />
      <Field
        label={f.kind === 'ADJUST' ? 'Variation (ex. 2 ou −3)' : 'Quantité'}
        type="number"
        value={f.delta}
        onChange={(e) => setF({ ...f, delta: e.target.value })}
        error={errors.delta}
      />
      <Reason value={f.reason} onChange={(v) => setF({ ...f, reason: v })} error={errors.reason} />
      <Button type="submit" disabled={save.isPending}>
        Enregistrer
      </Button>
    </form>
  );
}

export function InventoryPanel({ sites, onDone }: Common) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const queryClient = useQueryClient();
  const [siteId, setSiteId] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const inventories = useQuery({
    queryKey: ['stock', 'inventories'],
    queryFn: () => apiFetch<InventoryView[]>('/inventories'),
  });
  const open = inventories.data?.find(
    (i) => i.status === 'OPEN' && (!siteId || i.site.id === siteId),
  );
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['stock', 'inventories'] });

  const start = useMutation({
    mutationFn: () =>
      apiFetch<InventoryView>('/inventories', { method: 'POST', body: JSON.stringify({ siteId }) }),
    onSuccess: () => {
      toast('Inventaire ouvert : saisis les quantités comptées', 'success');
      refresh();
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  const close = useMutation({
    mutationFn: async (inv: InventoryView) => {
      await apiFetch(`/inventories/${inv.id}/count`, {
        method: 'PATCH',
        body: JSON.stringify({
          lines: inv.lines.map((l) => ({
            productId: l.productId,
            counted: Number(counts[l.productId] ?? l.counted ?? l.expected),
          })),
        }),
      });
      return apiFetch<InventoryView>(`/inventories/${inv.id}/close`, { method: 'POST' });
    },
    onSuccess: (inv) => {
      const diffs = inv.lines.filter((l) => l.difference).length;
      toast(`Inventaire clôturé : ${diffs} écart(s) appliqué(s)`, 'success');
      refresh();
      invalidate();
      onDone();
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  return (
    <div className="flex flex-col gap-4">
      <SelectField
        label="Site"
        value={siteId}
        onChange={(e) => setSiteId(e.target.value)}
        placeholder="Choisir"
        options={sites.map((s) => ({ value: s.id, label: s.name }))}
      />
      {!open ? (
        <Button disabled={!siteId || start.isPending} onClick={() => start.mutate()}>
          Ouvrir un inventaire
        </Button>
      ) : (
        <>
          <p className="text-sm text-ink-muted">
            Inventaire en cours à {open.site.name}. Le stock théorique a été figé à l’ouverture.
          </p>
          <Table aria-label="Comptage">
            <THead>
              <TR>
                <TH>Produit</TH>
                <TH>Théorique</TH>
                <TH>Compté</TH>
              </TR>
            </THead>
            <TBody>
              {open.lines.map((l) => (
                <TR key={l.productId}>
                  <TD>
                    <div className="font-semibold">{l.productName}</div>
                    <div className="text-xs text-ink-muted">{l.sku}</div>
                  </TD>
                  <TD>{l.expected}</TD>
                  <TD>
                    <input
                      aria-label={`Quantité comptée : ${l.productName}`}
                      type="number"
                      min={0}
                      className="min-h-touch w-24 rounded-md border border-surface-border px-2"
                      value={counts[l.productId] ?? String(l.counted ?? l.expected)}
                      onChange={(e) => setCounts({ ...counts, [l.productId]: e.target.value })}
                    />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Button disabled={close.isPending} onClick={() => close.mutate(open)}>
            Clôturer et appliquer les écarts
          </Button>
        </>
      )}
    </div>
  );
}
