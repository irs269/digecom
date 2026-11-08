'use client';

import {
  DELIVERY_MODE_SHORT,
  formatBusinessDateTime,
  formatKmf,
  hasPermission,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONE,
  ORDER_STATUSES,
  type OrderView,
  type Paginated,
} from '@digecom/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { PageHeader, useIslandFilter } from '@/components/app-shell';
import { Forbidden } from '@/components/forbidden';
import { OrderDetail } from '@/components/order-detail';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { qs, useIslands } from '@/lib/queries';
import { NewOrderForm } from './new-order-form';

function OrdersPage() {
  const { state } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const island = useIslandFilter();
  const islands = useIslands();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const selectedId = params.get('id');

  const islandId = island === 'all' ? undefined : islands.data?.find((i) => i.code === island)?.id;
  const list = useQuery({
    queryKey: ['orders', 'list', { q, status, page, islandId }],
    queryFn: () =>
      apiFetch<Paginated<OrderView>>(`/orders${qs({ q, status, page, islandId, pageSize: 25 })}`),
    placeholderData: keepPreviousData,
  });
  const selected = useQuery({
    queryKey: ['orders', 'detail', selectedId],
    enabled: !!selectedId,
    queryFn: () => apiFetch<OrderView>(`/orders/${selectedId}`),
  });

  if (state.status !== 'authenticated') return null;
  const mod = state.user.modules.find((m) => m.key === 'orders');
  if (!mod) return <Forbidden />;
  const canCreate = hasPermission(state.user.role, 'orders:create_on_behalf');
  const select = (id: string | null) =>
    router.replace(id ? `/commandes?id=${id}` : '/commandes', { scroll: false });
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / 25)) : 1;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader title="Commandes" subtitle="Création, préparation, remise et retours" />
        {canCreate ? (
          <Button variant="accent" onClick={() => setCreating(true)}>
            + Nouvelle commande pour le compte de
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
          <label htmlFor="orders-q" className="text-sm font-semibold text-ink">
            Recherche
          </label>
          <Input
            id="orders-q"
            type="search"
            placeholder="Numéro, client ou téléphone"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="orders-status" className="text-sm font-semibold text-ink">
            Statut
          </label>
          <select
            id="orders-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="min-h-touch rounded-md border border-surface-border bg-white px-3 text-sm"
          >
            <option value="">Tous</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Table aria-label="Commandes">
        <THead>
          <TR>
            <TH>N°</TH>
            <TH>Date</TH>
            <TH>Vendeur</TH>
            <TH>Produit</TH>
            <TH>Client</TH>
            <TH>Montant</TH>
            <TH>Remise</TH>
            <TH>Île</TH>
            <TH>Statut</TH>
          </TR>
        </THead>
        <TBody>
          {data?.items.map((o) => (
            <TR key={o.id} className={o.id === selectedId ? 'bg-status-blue-bg/50' : undefined}>
              <TD>
                <button
                  type="button"
                  className="font-semibold text-brand-blue hover:underline"
                  onClick={() => select(o.id)}
                  aria-label={`Ouvrir la commande ${o.number}`}
                >
                  {o.number}
                </button>
              </TD>
              <TD className="whitespace-nowrap text-xs text-ink-muted">
                {formatBusinessDateTime(o.createdAt)}
              </TD>
              <TD>
                <div className="font-semibold">{o.seller.fullName}</div>
                <div className="text-xs text-ink-muted">{o.leader.fullName}</div>
              </TD>
              <TD>
                {o.items
                  .map((i) => `${i.quantity > 1 ? `${i.quantity} × ` : ''}${i.product.name}`)
                  .join(', ')}
              </TD>
              <TD>{o.customerName}</TD>
              <TD className="whitespace-nowrap">{formatKmf(o.total)}</TD>
              <TD className="text-ink-muted">{DELIVERY_MODE_SHORT[o.deliveryMode]}</TD>
              <TD className="text-ink-muted">{o.island.code}</TD>
              <TD>
                <Badge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge>
              </TD>
            </TR>
          ))}
          {data && !data.items.length ? (
            <TR>
              <TD colSpan={9} className="py-8 text-center text-ink-muted">
                Aucune commande.
              </TD>
            </TR>
          ) : null}
        </TBody>
      </Table>
      <div className="flex items-center justify-end gap-2 text-sm text-ink-muted">
        <span>{data ? `${data.total} commande(s)` : ''}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Précédent
        </Button>
        <span>
          Page {page} / {pages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pages}
          onClick={() => setPage((p) => p + 1)}
        >
          Suivant
        </Button>
      </div>

      <Sheet
        open={!!selectedId}
        onOpenChange={(o) => !o && select(null)}
        title={selected.data ? `Commande ${selected.data.number}` : 'Commande'}
        description={selected.data ? formatBusinessDateTime(selected.data.createdAt) : undefined}
      >
        {selected.data ? (
          <OrderDetail order={selected.data} />
        ) : (
          <p className="text-sm text-ink-muted">Chargement…</p>
        )}
      </Sheet>
      <Sheet
        open={creating}
        onOpenChange={setCreating}
        title="Nouvelle commande pour le compte de"
        description="Le stock est réservé dès la création."
      >
        {creating ? (
          <NewOrderForm
            onCreated={(o) => {
              setCreating(false);
              select(o.id);
            }}
          />
        ) : null}
      </Sheet>
    </>
  );
}

export default function OrdersPageWrapper() {
  return (
    <Suspense>
      <OrdersPage />
    </Suspense>
  );
}
