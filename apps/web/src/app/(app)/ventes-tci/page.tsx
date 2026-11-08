'use client';

import {
  addDays,
  businessToday,
  formatBusinessDate,
  formatBusinessDateTime,
  formatKmf,
  hasPermission,
  isoWeekOf,
  isoWeekRange,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONE,
  type EarningsOrder,
  type TciEarnings,
} from '@digecom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { Forbidden } from '@/components/forbidden';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, KpiCard } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/queries';

function useEarnings(isTci: boolean, week: string, enabled = true) {
  return useQuery({
    queryKey: ['tci', 'earnings', isTci ? 'me' : 'team', week],
    enabled,
    queryFn: () => apiFetch<TciEarnings>(`/tci/${isTci ? 'me' : 'team'}/earnings?week=${week}`),
  });
}

function weekLabel(week: string, current: string) {
  const r = isoWeekRange(week);
  const span = `${formatBusinessDate(r.start).slice(0, 5)} – ${formatBusinessDate(r.end).slice(0, 5)}`;
  if (week === current) return `Cette semaine (${span})`;
  if (week === isoWeekOf(addDays(isoWeekRange(current).start, -7)))
    return `Semaine dernière (${span})`;
  return `Semaine du ${span}`;
}

export default function TciSalesPage() {
  const { state } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const current = isoWeekOf(businessToday());
  const [week, setWeek] = useState(current);
  const isTci = state.status === 'authenticated' && state.user.role === 'TELECONSULTANT';
  const data = useEarnings(isTci, week, state.status === 'authenticated');
  const close = useMutation({
    mutationFn: ({ order, result }: { order: EarningsOrder; result: 'SOLD' | 'REFUSED' }) => {
      const reason = result === 'REFUSED' ? window.prompt('Motif du refus du client') : undefined;
      if (result === 'REFUSED' && (!reason || reason.trim().length < 3))
        throw new Error('Motif obligatoire (3 caractères minimum)');
      return apiFetch(`/tci/sales/${order.id}/close`, {
        method: 'POST',
        body: JSON.stringify({ result, reason }),
      });
    },
    onSuccess: (_r, v) => {
      toast(
        v.result === 'SOLD'
          ? `${v.order.number} vendue : prime de ${formatKmf(v.order.bonus)} ajoutée`
          : `${v.order.number} : refus enregistré, retour au site`,
        'success',
      );
      void queryClient.invalidateQueries({ queryKey: ['tci'] });
    },
    onError: (err) =>
      toast(err instanceof Error && !('code' in err) ? err.message : errorMessage(err), 'error'),
  });

  if (state.status !== 'authenticated') return null;
  const mod = state.user.modules.find((m) => m.key === 'tci_sales');
  if (!mod) return <Forbidden />;
  const canClose = hasPermission(state.user.role, 'tci_sales:close');
  const d = data.data;
  const weeks = [0, -1, -2, -3].map((n) => isoWeekOf(addDays(isoWeekRange(current).start, n * 7)));

  return (
    <>
      <PageHeader
        title={mod.label}
        subtitle="Calculé automatiquement à partir des ventes clôturées « Vendu »"
      />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Semaine">
        {weeks.map((w) => (
          <Button
            key={w}
            size="sm"
            variant={w === week ? 'primary' : 'outline'}
            aria-pressed={w === week}
            onClick={() => setWeek(w)}
          >
            {weekLabel(w, current)}
          </Button>
        ))}
      </div>
      <div
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        data-testid="earnings-kpis"
      >
        <KpiCard
          label="Montant vendu"
          value={d ? formatKmf(d.soldAmount) : '—'}
          hint={d ? `${d.soldCount} produit(s) vendu(s)` : undefined}
        />
        <KpiCard
          label={isTci ? 'Mes gains de la semaine' : 'Primes de la semaine'}
          value={d ? formatKmf(d.weekEarnings) : '—'}
          accent
        />
        <KpiCard
          label={isTci ? 'Mes gains globaux' : 'Primes globales'}
          value={d ? formatKmf(d.totalEarnings) : '—'}
          hint="Depuis le début"
        />
        <KpiCard label="Livrées à clôturer" value={d ? d.toClose.length : '—'} />
      </div>

      {d?.byTci ? (
        <Table aria-label="Ventes par téléconseiller">
          <THead>
            <TR>
              <TH>Téléconseiller</TH>
              <TH>Produits vendus</TH>
              <TH>Montant vendu</TH>
              <TH>Primes de la semaine</TH>
              <TH>Primes globales</TH>
              <TH>À clôturer</TH>
            </TR>
          </THead>
          <TBody>
            {d.byTci.map((t) => (
              <TR key={t.tci.id}>
                <TD className="font-semibold">{t.tci.fullName}</TD>
                <TD>{t.soldCount}</TD>
                <TD className="whitespace-nowrap">{formatKmf(t.soldAmount)}</TD>
                <TD className="whitespace-nowrap font-semibold">{formatKmf(t.weekEarnings)}</TD>
                <TD className="whitespace-nowrap">{formatKmf(t.totalEarnings)}</TD>
                <TD>{t.toClose}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : null}

      <h2 className="text-lg font-bold">Commandes de la semaine</h2>
      <Table aria-label="Commandes de la semaine">
        <THead>
          <TR>
            <TH>N°</TH>
            <TH>Date</TH>
            {!isTci ? <TH>TCI</TH> : null}
            <TH>Client</TH>
            <TH>Produit</TH>
            <TH>Montant</TH>
            <TH>Prime</TH>
            <TH>Statut</TH>
            <TH>
              <span className="sr-only">Actions</span>
            </TH>
          </TR>
        </THead>
        <TBody>
          {[
            ...(d?.toClose ?? []).filter((o) => !d?.weekOrders.some((w) => w.id === o.id)),
            ...(d?.weekOrders ?? []),
          ].map((o) => (
            <TR key={o.id} data-tci-order={o.number}>
              <TD className="font-semibold">{o.number}</TD>
              <TD className="whitespace-nowrap text-xs text-ink-muted">
                {formatBusinessDateTime(o.soldAt ?? o.createdAt)}
              </TD>
              {!isTci ? <TD>{o.tci.fullName}</TD> : null}
              <TD>{o.customerName}</TD>
              <TD>{o.product}</TD>
              <TD className="whitespace-nowrap">{formatKmf(o.amount)}</TD>
              <TD className="whitespace-nowrap">{formatKmf(o.bonus)}</TD>
              <TD>
                <Badge tone={o.status === 'HANDED_OVER' ? 'orange' : ORDER_STATUS_TONE[o.status]}>
                  {o.status === 'HANDED_OVER'
                    ? 'Livrée – à clôturer'
                    : ORDER_STATUS_LABELS[o.status]}
                </Badge>
              </TD>
              <TD>
                {canClose &&
                o.status === 'HANDED_OVER' &&
                (isTci || state.user.role === 'ADMIN') ? (
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      onClick={() => close.mutate({ order: o, result: 'SOLD' })}
                      aria-label={`${o.number} : Vendu`}
                    >
                      Vendu
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => close.mutate({ order: o, result: 'REFUSED' })}
                    >
                      Client a refusé
                    </Button>
                  </div>
                ) : null}
              </TD>
            </TR>
          ))}
          {d && !d.weekOrders.length && !d.toClose.length ? (
            <TR>
              <TD colSpan={9} className="py-6 text-center text-ink-muted">
                Aucune commande cette semaine.
              </TD>
            </TR>
          ) : null}
        </TBody>
      </Table>

      <Card className="flex flex-col gap-2">
        <h2 className="text-base font-bold">Gains par produit</h2>
        <ul className="divide-y divide-surface-border text-sm" aria-label="Gains par produit">
          {d?.byProduct.map((p) => (
            <li
              key={`${p.product}-${p.bonus}`}
              className="flex flex-wrap justify-between gap-2 py-2"
            >
              <span>
                <strong>{p.product}</strong>{' '}
                <span className="text-ink-muted">· prime fixée par {p.leader}</span>
              </span>
              <span>
                {p.count} × {formatKmf(p.bonus)} = <strong>{formatKmf(p.total)}</strong>
              </span>
            </li>
          ))}
          {d && !d.byProduct.length ? (
            <li className="py-2 text-ink-muted">Aucune vente clôturée cette semaine.</li>
          ) : null}
        </ul>
      </Card>
    </>
  );
}
