'use client';

import {
  formatBusinessDate,
  formatKmf,
  hasPermission,
  lotUnitCost,
  NEXT_PURCHASE_STATUS,
  PURCHASE_STATUS_LABELS,
  PURCHASE_STATUSES,
  toKmf,
  type Paginated,
  type ProductView,
  type PurchaseOrderStatus,
  type PurchaseOrderView,
  type SupplierView,
} from '@digecom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader, useIslandFilter } from '@/components/app-shell';
import { Forbidden } from '@/components/forbidden';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/input';
import { SelectField } from '@/components/ui/select';
import { Sheet } from '@/components/ui/sheet';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorMessage, fieldErrors, useSites } from '@/lib/queries';

const STATUS_TONE: Record<PurchaseOrderStatus, 'blue' | 'orange' | 'green' | 'red'> = {
  DRAFT: 'blue',
  ORDERED: 'blue',
  IN_TRANSIT: 'orange',
  ARRIVED: 'orange',
  IN_CUSTOMS: 'orange',
  RECEIVED: 'green',
  CLOSED: 'green',
};

function Timeline({ po }: { po: PurchaseOrderView }) {
  const reached = PURCHASE_STATUSES.indexOf(po.status);
  return (
    <ol className="flex flex-col gap-1" aria-label="Étapes du lot">
      {PURCHASE_STATUSES.map((s, i) => (
        <li
          key={s}
          className={`flex items-center gap-2 text-sm ${i <= reached ? 'text-ink' : 'text-ink-muted'}`}
        >
          <span
            aria-hidden="true"
            className={`h-2.5 w-2.5 rounded-full ${i <= reached ? 'bg-brand-blue' : 'bg-surface-border'}`}
          />
          <span className={i === reached ? 'font-bold' : ''}>{PURCHASE_STATUS_LABELS[s]}</span>
          {po.dates[s] ? (
            <span className="text-xs text-ink-muted">· {formatBusinessDate(po.dates[s]!)}</span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function PurchaseForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const sites = useSites();
  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => apiFetch<SupplierView[]>('/suppliers'),
  });
  const products = useQuery({
    queryKey: ['products', 'all'],
    queryFn: () => apiFetch<Paginated<ProductView>>('/products?pageSize=200').then((p) => p.items),
  });
  const [f, setF] = useState({
    supplierId: '',
    productId: '',
    destinationSiteId: '',
    quantity: '',
    currency: 'USD',
    exchangeRate: '',
    purchaseAmountForeign: '',
    shippingKmf: '0',
    customsKmf: '0',
    otherFeesKmf: '0',
    notes: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const n = (v: string) => Number(v) || 0;
  const purchaseKmf = toKmf(n(f.purchaseAmountForeign), n(f.exchangeRate));
  const preview =
    n(f.quantity) > 0
      ? lotUnitCost(
          {
            purchaseKmf,
            shippingKmf: n(f.shippingKmf),
            customsKmf: n(f.customsKmf),
            otherFeesKmf: n(f.otherFeesKmf),
          },
          n(f.quantity),
        )
      : null;
  const save = useMutation({
    mutationFn: () =>
      apiFetch<PurchaseOrderView>('/purchase-orders', {
        method: 'POST',
        body: JSON.stringify({
          ...f,
          quantity: n(f.quantity),
          exchangeRate: n(f.exchangeRate),
          purchaseAmountForeign: n(f.purchaseAmountForeign),
          shippingKmf: n(f.shippingKmf),
          customsKmf: n(f.customsKmf),
          otherFeesKmf: n(f.otherFeesKmf),
        }),
      }),
    onSuccess: (po) => {
      toast(`${po.number} créé en préparation`, 'success');
      void queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      onDone();
    },
    onError: (err) => {
      setErrors(fieldErrors(err));
      toast(errorMessage(err), 'error');
    },
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  return (
    <form
      className="flex flex-col gap-3"
      aria-label="Commande fournisseur"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <SelectField
        label="Fournisseur"
        value={f.supplierId}
        onChange={set('supplierId')}
        placeholder="Choisir"
        options={(suppliers.data ?? [])
          .filter((s) => s.isActive)
          .map((s) => ({ value: s.id, label: `${s.name}${s.platform ? ` (${s.platform})` : ''}` }))}
        error={errors.supplierId}
      />
      <SelectField
        label="Produit (catalogue du leader)"
        value={f.productId}
        onChange={set('productId')}
        placeholder="Choisir"
        options={(products.data ?? []).map((p) => ({
          value: p.id,
          label: `${p.name} · ${p.leader.fullName}`,
        }))}
        error={errors.productId}
      />
      <SelectField
        label="Site de destination"
        value={f.destinationSiteId}
        onChange={set('destinationSiteId')}
        placeholder="Choisir"
        options={(sites.data ?? []).map((s) => ({
          value: s.id,
          label: `${s.name} (${s.island.name})`,
        }))}
        error={errors.destinationSiteId}
      />
      <Field
        label="Quantité commandée"
        type="number"
        min={1}
        value={f.quantity}
        onChange={set('quantity')}
        error={errors.quantity}
      />
      <div className="grid grid-cols-3 gap-3">
        <Field
          label="Devise"
          value={f.currency}
          maxLength={3}
          onChange={set('currency')}
          error={errors.currency}
        />
        <Field
          label="Taux (KMF)"
          type="number"
          step="0.0001"
          min={0}
          value={f.exchangeRate}
          onChange={set('exchangeRate')}
          error={errors.exchangeRate}
        />
        <Field
          label="Montant achat"
          type="number"
          step="0.01"
          min={0}
          value={f.purchaseAmountForeign}
          onChange={set('purchaseAmountForeign')}
          error={errors.purchaseAmountForeign}
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field
          label="Expédition (KMF)"
          type="number"
          min={0}
          value={f.shippingKmf}
          onChange={set('shippingKmf')}
        />
        <Field
          label="Douane (KMF)"
          type="number"
          min={0}
          value={f.customsKmf}
          onChange={set('customsKmf')}
        />
        <Field
          label="Autres frais (KMF)"
          type="number"
          min={0}
          value={f.otherFeesKmf}
          onChange={set('otherFeesKmf')}
        />
      </div>
      <div className="rounded-md bg-surface p-3 text-sm">
        Achat converti : <strong>{formatKmf(purchaseKmf)}</strong>
        {preview !== null ? (
          <>
            {' '}
            · coût unitaire estimé :{' '}
            <strong data-testid="unit-cost-preview">{formatKmf(preview)}</strong>
          </>
        ) : null}
      </div>
      <Field label="Notes" value={f.notes} onChange={set('notes')} />
      <Button type="submit" disabled={save.isPending}>
        Créer la commande
      </Button>
    </form>
  );
}

function ReceiveForm({ po, onDone }: { po: PurchaseOrderView; onDone: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const sites = useSites();
  const [f, setF] = useState({
    siteId: po.destinationSite.id,
    receivedQuantity: String(po.quantity),
    paidAmountKmf: String(po.purchaseAmountKmf),
    paidAt: '',
  });
  const received = Number(f.receivedQuantity) || 0;
  const cost =
    received > 0
      ? lotUnitCost(
          {
            purchaseKmf: po.purchaseAmountKmf,
            shippingKmf: po.shippingKmf,
            customsKmf: po.customsKmf,
            otherFeesKmf: po.otherFeesKmf,
          },
          received,
        )
      : null;
  const save = useMutation({
    mutationFn: () =>
      apiFetch<PurchaseOrderView>(`/purchase-orders/${po.id}/receive`, {
        method: 'POST',
        body: JSON.stringify({
          siteId: f.siteId,
          receivedQuantity: received,
          paidAmountKmf: f.paidAmountKmf ? Number(f.paidAmountKmf) : undefined,
          paidAt: f.paidAt || undefined,
        }),
      }),
    onSuccess: (r) => {
      toast(
        `${r.number} réceptionné : ${r.receivedQuantity} unités à ${formatKmf(r.unitCost)}`,
        'success',
      );
      void queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      onDone();
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  return (
    <form
      className="flex flex-col gap-3"
      aria-label="Réception"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <p className="text-sm text-ink-muted">
        Le lot {po.number} entre en stock au coût réel (achat + frais) divisé par la quantité
        réellement reçue.
      </p>
      <SelectField
        label="Site de réception"
        value={f.siteId}
        onChange={(e) => setF({ ...f, siteId: e.target.value })}
        options={(sites.data ?? [])
          .filter((s) => s.island.id === po.destinationSite.island.id)
          .map((s) => ({ value: s.id, label: s.name }))}
      />
      <Field
        label="Quantité réellement reçue"
        type="number"
        min={1}
        value={f.receivedQuantity}
        onChange={(e) => setF({ ...f, receivedQuantity: e.target.value })}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Montant payé au fournisseur (KMF)"
          type="number"
          min={0}
          value={f.paidAmountKmf}
          onChange={(e) => setF({ ...f, paidAmountKmf: e.target.value })}
        />
        <Field
          label="Date de paiement"
          type="date"
          value={f.paidAt}
          onChange={(e) => setF({ ...f, paidAt: e.target.value })}
        />
      </div>
      {cost !== null ? (
        <p className="rounded-md bg-status-green-bg px-3 py-2 text-sm text-status-green-fg">
          Coût unitaire du lot : <strong>{formatKmf(cost)}</strong>
        </p>
      ) : null}
      <Button type="submit" disabled={save.isPending || received < 1}>
        Réceptionner et entrer en stock
      </Button>
    </form>
  );
}

export default function PurchasesPage() {
  const { state } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const island = useIslandFilter();
  const [panel, setPanel] = useState<
    { mode: 'new' } | { mode: 'receive' | 'detail'; po: PurchaseOrderView } | null
  >(null);
  const orders = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: () => apiFetch<PurchaseOrderView[]>('/purchase-orders'),
  });
  const advance = useMutation({
    mutationFn: (po: PurchaseOrderView) =>
      apiFetch<PurchaseOrderView>(`/purchase-orders/${po.id}/advance`, { method: 'POST' }),
    onSuccess: (po) => {
      toast(`${po.number} : ${PURCHASE_STATUS_LABELS[po.status]}`, 'success');
      void queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  if (state.status !== 'authenticated') return null;
  const user = state.user;
  const mod = user.modules.find((m) => m.key === 'purchases');
  if (!mod) return <Forbidden />;
  const canCreate = hasPermission(user.role, 'purchases:create');
  const canAdvance = hasPermission(user.role, 'purchases:advance');
  const canReceive = hasPermission(user.role, 'purchases:receive');
  const list = (orders.data ?? []).filter(
    (o) => island === 'all' || o.destinationSite.island.code === island,
  );
  const inProgress = list.filter((o) => o.status !== 'CLOSED' && o.status !== 'RECEIVED');

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title="Achats Chine"
          subtitle="Commandes fournisseurs, lots et coût d’approvisionnement réel"
        />
        {canCreate ? (
          <Button variant="accent" onClick={() => setPanel({ mode: 'new' })}>
            + Commande fournisseur
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <span className="text-xs font-semibold uppercase text-ink-muted">Lots en cours</span>
          <div className="text-2xl font-extrabold">{inProgress.length}</div>
        </Card>
        <Card>
          <span className="text-xs font-semibold uppercase text-ink-muted">Engagé (en cours)</span>
          <div className="text-2xl font-extrabold">
            {formatKmf(inProgress.reduce((s, o) => s + o.totalCostKmf, 0))}
          </div>
        </Card>
        <Card>
          <span className="text-xs font-semibold uppercase text-ink-muted">Réceptionnés</span>
          <div className="text-2xl font-extrabold">{list.length - inProgress.length}</div>
        </Card>
      </div>
      <Table aria-label="Lots">
        <THead>
          <TR>
            <TH>Lot</TH>
            <TH>Fournisseur</TH>
            <TH>Produit</TH>
            <TH>Qté</TH>
            <TH>Achat</TH>
            <TH>Frais</TH>
            <TH>Coût unitaire</TH>
            <TH>Destination</TH>
            <TH>Statut</TH>
            <TH>
              <span className="sr-only">Actions</span>
            </TH>
          </TR>
        </THead>
        <TBody>
          {list.map((po) => {
            const next = NEXT_PURCHASE_STATUS[po.status];
            return (
              <TR key={po.id} data-lot={po.number}>
                <TD>
                  <button
                    type="button"
                    className="font-semibold text-brand-blue hover:underline"
                    onClick={() => setPanel({ mode: 'detail', po })}
                  >
                    {po.number}
                  </button>
                </TD>
                <TD>{po.supplier.name}</TD>
                <TD>
                  <div className="font-semibold">{po.product.name}</div>
                  <div className="text-xs text-ink-muted">{po.product.leader.fullName}</div>
                </TD>
                <TD>{po.receivedQuantity ?? po.quantity}</TD>
                <TD className="whitespace-nowrap">{formatKmf(po.purchaseAmountKmf)}</TD>
                <TD className="whitespace-nowrap">
                  {formatKmf(po.shippingKmf + po.customsKmf + po.otherFeesKmf)}
                </TD>
                <TD className="whitespace-nowrap font-semibold">{formatKmf(po.unitCost)}</TD>
                <TD className="text-ink-muted">{po.destinationSite.island.name}</TD>
                <TD>
                  <Badge tone={STATUS_TONE[po.status]}>{PURCHASE_STATUS_LABELS[po.status]}</Badge>
                </TD>
                <TD className="text-right">
                  {next === 'RECEIVED' && canReceive ? (
                    <Button size="sm" onClick={() => setPanel({ mode: 'receive', po })}>
                      Réceptionner
                    </Button>
                  ) : next && next !== 'RECEIVED' && canAdvance ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={advance.isPending}
                      onClick={() => advance.mutate(po)}
                      aria-label={`${po.number} : passer à « ${PURCHASE_STATUS_LABELS[next]} »`}
                    >
                      Étape suivante
                    </Button>
                  ) : null}
                  {po.status === 'ARRIVED' && canReceive ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPanel({ mode: 'receive', po })}
                    >
                      Réceptionner
                    </Button>
                  ) : null}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>

      <Sheet
        open={panel?.mode === 'new'}
        onOpenChange={(o) => !o && setPanel(null)}
        title="Nouvelle commande fournisseur"
        description="Devise, taux de change, montants et frais : le coût unitaire est calculé."
      >
        {panel?.mode === 'new' ? <PurchaseForm onDone={() => setPanel(null)} /> : null}
      </Sheet>
      <Sheet
        open={panel?.mode === 'receive'}
        onOpenChange={(o) => !o && setPanel(null)}
        title={panel && panel.mode !== 'new' ? `Réception ${panel.po.number}` : ''}
      >
        {panel?.mode === 'receive' ? (
          <ReceiveForm po={panel.po} onDone={() => setPanel(null)} />
        ) : null}
      </Sheet>
      <Sheet
        open={panel?.mode === 'detail'}
        onOpenChange={(o) => !o && setPanel(null)}
        title={panel && panel.mode !== 'new' ? panel.po.number : ''}
        description={
          panel && panel.mode !== 'new'
            ? `${panel.po.supplier.name} · ${panel.po.product.name}`
            : undefined
        }
      >
        {panel?.mode === 'detail' ? (
          <div className="flex flex-col gap-4 text-sm">
            <Timeline po={panel.po} />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              <dt className="text-ink-muted">Achat</dt>
              <dd>
                {panel.po.purchaseAmountForeign.toLocaleString('fr-FR')} {panel.po.currency} ×{' '}
                {panel.po.exchangeRate} = {formatKmf(panel.po.purchaseAmountKmf)}
              </dd>
              <dt className="text-ink-muted">Expédition</dt>
              <dd>{formatKmf(panel.po.shippingKmf)}</dd>
              <dt className="text-ink-muted">Douane</dt>
              <dd>{formatKmf(panel.po.customsKmf)}</dd>
              <dt className="text-ink-muted">Autres frais</dt>
              <dd>{formatKmf(panel.po.otherFeesKmf)}</dd>
              <dt className="font-semibold">Coût total</dt>
              <dd className="font-semibold">{formatKmf(panel.po.totalCostKmf)}</dd>
              <dt className="font-semibold">Coût unitaire</dt>
              <dd className="font-semibold">{formatKmf(panel.po.unitCost)}</dd>
              <dt className="text-ink-muted">Payé</dt>
              <dd>
                {panel.po.paidAmountKmf !== null
                  ? `${formatKmf(panel.po.paidAmountKmf)}${panel.po.paidAt ? ` le ${formatBusinessDate(panel.po.paidAt)}` : ''}`
                  : '—'}
              </dd>
            </dl>
          </div>
        ) : null}
      </Sheet>
    </>
  );
}
