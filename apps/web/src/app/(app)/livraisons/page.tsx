'use client';

import {
  DELIVERY_MODE_SHORT,
  formatBusinessDateTime,
  formatKmf,
  hasPermission,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONE,
  type CourierView,
  type OrderView,
} from '@digecom/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader, useIslandFilter } from '@/components/app-shell';
import { Forbidden } from '@/components/forbidden';
import { OrderActions } from '@/components/order-detail';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { qs, useIslands } from '@/lib/queries';

interface Board {
  waiting: OrderView[];
  inProgress: OrderView[];
  pickupReady: OrderView[];
  issues: OrderView[];
}

const COLUMNS: { key: keyof Board; title: string; hint: string }[] = [
  { key: 'waiting', title: 'En attente d’un livreur', hint: 'Proposées aux livreurs de l’île' },
  { key: 'inProgress', title: 'En cours', hint: 'Affectées ou en livraison' },
  { key: 'pickupReady', title: 'Prêtes au retrait', hint: 'L’e-commerçant passe au site' },
  { key: 'issues', title: 'Refus et échecs', hint: 'Retours à contrôler' },
];

function OrderCard({ order, canAssign }: { order: OrderView; canAssign: boolean }) {
  const minutes = Math.round((Date.now() - new Date(order.updatedAt).getTime()) / 60_000);
  return (
    <li
      className="flex flex-col gap-2 rounded-lg border border-surface-border bg-white p-3"
      data-order={order.number}
    >
      <div className="flex items-center justify-between gap-2">
        <Link href={`/commandes?id=${order.id}`} className="font-semibold">
          {order.number}
        </Link>
        <Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
      </div>
      <div className="text-sm">
        {order.items.map((i) => i.product.name).join(', ')} · {formatKmf(order.total)}
      </div>
      <div className="text-xs text-ink-muted">
        {order.seller.fullName} → {order.customerName}
        {order.zone ? ` · ${order.zone}` : ''} · {DELIVERY_MODE_SHORT[order.deliveryMode]}
      </div>
      {order.courier ? (
        <div className="text-xs font-semibold">Livreur : {order.courier.fullName}</div>
      ) : null}
      {order.failReason || order.refuseReason ? (
        <div className="text-xs text-status-red-fg">{order.failReason ?? order.refuseReason}</div>
      ) : null}
      <div className="text-[11px] text-ink-muted">
        Mis à jour {formatBusinessDateTime(order.updatedAt)}
        {order.status === 'READY' && minutes >= 10 ? ` · ${minutes} min sans livreur` : ''}
      </div>
      {canAssign && order.actions.includes('assign') ? (
        <OrderActions order={order} actions={['assign']} />
      ) : null}
      {order.actions.includes('restock') ? (
        <OrderActions
          order={order}
          actions={order.actions.filter((a) => a === 'restock' || a === 'damaged')}
        />
      ) : null}
    </li>
  );
}

export default function DeliveriesPage() {
  const { state } = useAuth();
  const island = useIslandFilter();
  const islands = useIslands();
  const [showCouriers] = useState(true);
  const islandId = island === 'all' ? undefined : islands.data?.find((i) => i.code === island)?.id;
  const board = useQuery({
    queryKey: ['deliveries', 'board', islandId],
    queryFn: () => apiFetch<Board>(`/deliveries/board${qs({ islandId })}`),
    refetchInterval: 60_000,
  });
  const couriers = useQuery({
    queryKey: ['deliveries', 'couriers', islandId ?? 'all'],
    queryFn: () => apiFetch<CourierView[]>(`/deliveries/couriers${qs({ islandId })}`),
    refetchInterval: 60_000,
  });

  if (state.status !== 'authenticated') return null;
  const mod = state.user.modules.find((m) => m.key === 'deliveries');
  if (!mod) return <Forbidden />;
  const canAssign = hasPermission(state.user.role, 'deliveries:assign_manual');

  return (
    <>
      <PageHeader title="Livraisons" subtitle="Courses par île, mises à jour en temps réel" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {COLUMNS.map((col) => {
          const items = board.data?.[col.key] ?? [];
          return (
            <section
              key={col.key}
              aria-label={col.title}
              className="flex flex-col gap-3 rounded-xl bg-surface-border/40 p-3"
              data-column={col.key}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-ink">{col.title}</h2>
                  <p className="text-xs text-ink-muted">{col.hint}</p>
                </div>
                <span className="rounded-full bg-white px-2 py-0.5 text-sm font-bold">
                  {items.length}
                </span>
              </div>
              <ul className="flex flex-col gap-2">
                {items.map((o) => (
                  <OrderCard key={o.id} order={o} canAssign={canAssign} />
                ))}
                {board.data && !items.length ? (
                  <li className="text-center text-xs text-ink-muted">Rien ici</li>
                ) : null}
              </ul>
            </section>
          );
        })}
      </div>
      {showCouriers ? (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-bold text-ink">Livreurs</h2>
          <ul
            className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
            aria-label="Livreurs"
          >
            {couriers.data?.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-2 rounded-md border border-surface-border px-3 py-2"
              >
                <div>
                  <div className="font-semibold">{c.fullName}</div>
                  <div className="text-xs text-ink-muted">
                    {c.island?.name} · {c.deliveredToday} livrée(s) aujourd’hui
                  </div>
                </div>
                <Badge tone={c.activeRuns ? 'orange' : c.isAvailable ? 'green' : 'red'}>
                  {c.activeRuns
                    ? `En course (${c.activeRuns})`
                    : c.isAvailable
                      ? 'Disponible'
                      : 'Indisponible'}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
