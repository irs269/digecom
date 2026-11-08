'use client';

import {
  DELIVERY_MODE_SHORT,
  formatKmf,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONE,
  type ApiError,
  type CourierView,
  type DeliveryOfferView,
  type OrderAction,
  type OrderView,
  type Paginated,
} from '@digecom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { Forbidden } from '@/components/forbidden';
import { OrderActions } from '@/components/order-detail';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SelectField } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { apiFetch, ApiRequestError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/queries';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

/** Appel d'API avec le jeton du livreur / vendeur simulé (et non celui de l'administrateur). */
async function asUser<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Partial<ApiError>;
    throw new ApiRequestError(
      res.status,
      body.code ?? 'HTTP_ERROR',
      body.message ?? 'Erreur',
      body.details,
    );
  }
  return (await res.json()) as T;
}

function useImpersonation(userId: string) {
  return useQuery({
    queryKey: ['simulator', 'token', userId],
    enabled: !!userId,
    staleTime: 10 * 60_000,
    queryFn: () =>
      apiFetch<{ accessToken: string }>(`/dev/impersonate/${userId}`, { method: 'POST' }).then(
        (r) => r.accessToken,
      ),
  });
}

function OrderLine({ order, children }: { order: OrderView; children?: React.ReactNode }) {
  return (
    <li
      className="flex flex-col gap-2 rounded-md border border-surface-border p-3"
      data-sim-order={order.number}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{order.number}</span>
        <Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
      </div>
      <span className="text-sm text-ink-muted">
        {order.items.map((i) => i.product.name).join(', ')} · {formatKmf(order.total)} ·{' '}
        {order.customerName} · {DELIVERY_MODE_SHORT[order.deliveryMode]}
      </span>
      {children}
    </li>
  );
}

function CourierSimulator() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const couriers = useQuery({
    queryKey: ['simulator', 'couriers'],
    queryFn: () => apiFetch<CourierView[]>('/deliveries/couriers'),
  });
  const [courierId, setCourierId] = useState('');
  const token = useImpersonation(courierId);
  const t = token.data;
  const offers = useQuery({
    queryKey: ['simulator', 'offers', courierId],
    enabled: !!t,
    queryFn: () => asUser<DeliveryOfferView[]>(t!, '/courier/offers'),
    refetchInterval: 15_000,
  });
  const runs = useQuery({
    queryKey: ['simulator', 'runs', courierId],
    enabled: !!t,
    queryFn: () => asUser<OrderView[]>(t!, '/courier/runs'),
    refetchInterval: 15_000,
  });
  const me = couriers.data?.find((c) => c.id === courierId);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['simulator'] });
  const accept = useMutation({
    mutationFn: (orderId: string) =>
      asUser<OrderView>(t!, `/courier/offers/${orderId}/accept`, { method: 'POST' }),
    onSuccess: (o) => {
      toast(`${o.number} acceptée`, 'success');
      refresh();
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  const availability = useMutation({
    mutationFn: (isAvailable: boolean) =>
      asUser(t!, '/courier/availability', {
        method: 'PATCH',
        body: JSON.stringify({ isAvailable }),
      }),
    onSuccess: refresh,
  });
  const send = (orderId: string) => (action: OrderAction, body?: Record<string, unknown>) =>
    asUser<OrderView>(t!, `/courier/runs/${orderId}/${action}`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    });

  return (
    <Card className="flex flex-col gap-4" data-testid="courier-simulator">
      <h2 className="text-lg font-bold text-ink">Livreur</h2>
      <SelectField
        label="Livreur simulé"
        value={courierId}
        onChange={(e) => setCourierId(e.target.value)}
        placeholder="Choisir un livreur"
        options={(couriers.data ?? []).map((c) => ({
          value: c.id,
          label: `${c.fullName} · ${c.island?.name ?? ''}`,
        }))}
      />
      {me && t ? (
        <>
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => availability.mutate(!me.isAvailable)}
          >
            {me.isAvailable ? 'Se rendre indisponible' : 'Se rendre disponible'}
          </Button>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-bold">Courses proposées ({offers.data?.length ?? 0})</h3>
            <ul className="flex flex-col gap-2" aria-label="Courses proposées">
              {offers.data?.map((o) => (
                <li
                  key={o.orderId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-surface-border p-3"
                >
                  <span className="text-sm">
                    <strong>{o.number}</strong> · {o.site.name} →{' '}
                    {o.zone ?? o.customerAddress ?? '—'} · {formatKmf(o.total)}
                  </span>
                  <Button size="sm" onClick={() => accept.mutate(o.orderId)}>
                    Accepter
                  </Button>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-bold">Mes courses</h3>
            <ul className="flex flex-col gap-2" aria-label="Mes courses">
              {runs.data?.map((o) => (
                <OrderLine key={o.id} order={o}>
                  <OrderActions
                    order={o}
                    send={send(o.id)}
                    actions={o.actions.filter((a) =>
                      ['pickup', 'handover', 'fail', 'markSold', 'markRefused'].includes(a),
                    )}
                  />
                </OrderLine>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </Card>
  );
}

function SellerSimulator() {
  const sellers = useQuery({
    queryKey: ['simulator', 'sellers'],
    queryFn: () =>
      apiFetch<{ id: string; fullName: string; role: string; island: { name: string } | null }[]>(
        '/orders/sellers',
      ),
  });
  const [sellerId, setSellerId] = useState('');
  const token = useImpersonation(sellerId);
  const t = token.data;
  const orders = useQuery({
    queryKey: ['simulator', 'seller-orders', sellerId],
    enabled: !!t,
    queryFn: () => asUser<Paginated<OrderView>>(t!, '/me/orders?pageSize=20'),
    refetchInterval: 15_000,
  });
  const send = (orderId: string) => (action: OrderAction, body?: Record<string, unknown>) =>
    asUser<OrderView>(t!, `/me/orders/${orderId}/${action}`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    });

  return (
    <Card className="flex flex-col gap-4" data-testid="seller-simulator">
      <h2 className="text-lg font-bold text-ink">E-commerçant / TCI</h2>
      <SelectField
        label="Vendeur simulé"
        value={sellerId}
        onChange={(e) => setSellerId(e.target.value)}
        placeholder="Choisir un vendeur"
        options={(sellers.data ?? []).map((s) => ({
          value: s.id,
          label: `${s.fullName} · ${s.island?.name ?? ''}`,
        }))}
      />
      {t ? (
        <ul className="flex flex-col gap-2" aria-label="Commandes du vendeur">
          {orders.data?.items.map((o) => (
            <OrderLine key={o.id} order={o}>
              {o.actions.length ? <OrderActions order={o} send={send(o.id)} /> : null}
            </OrderLine>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

/** Écran temporaire (dev, admin) : joue les actions de l'application mobile avant la phase 8. */
export default function SimulatorPage() {
  const { state } = useAuth();
  const status = useQuery({
    queryKey: ['simulator', 'status'],
    queryFn: () => apiFetch<{ enabled: boolean }>('/dev/status'),
  });
  if (state.status !== 'authenticated') return null;
  if (status.data && !status.data.enabled) return <Forbidden />;
  return (
    <>
      <PageHeader
        title="Simulateur livreur / vendeur"
        subtitle="Environnement de développement : joue les actions mobiles (phase 8)"
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CourierSimulator />
        <SellerSimulator />
      </div>
    </>
  );
}
