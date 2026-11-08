'use client';

import {
  formatBusinessDate,
  formatBusinessDateTime,
  formatKmf,
  hasPermission,
  ISLAND_LABELS,
  ORDER_STATUS_LABELS,
  ROLE_SCOPE,
  type DashboardKpi,
  type DashboardView,
  type OrderStatus,
} from '@digecom/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { PageHeader, useIslandFilter } from '@/components/app-shell';
import { Forbidden } from '@/components/forbidden';
import { SaleReference } from '@/components/sale-reference';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { qs, useIslands } from '@/lib/queries';
import { cn } from '@/lib/utils';

function formatValue(k: DashboardKpi): string {
  if (k.value === null) return '—';
  if (k.format === 'kmf') return formatKmf(k.value);
  if (k.format === 'pct') return `${String(k.value).replace('.', ',')} %`;
  return k.value.toLocaleString('fr-FR');
}

function Kpi({ k }: { k: DashboardKpi }) {
  const blue = k.tone === 'blue';
  const body = (
    <Card
      className={cn(
        'flex h-full flex-col gap-1 transition hover:shadow-md',
        blue && 'border-brand-blue bg-brand-blue text-white',
        k.tone === 'orange' && 'border-brand-orange',
      )}
    >
      <span
        className={cn(
          'text-xs font-semibold uppercase tracking-wide',
          blue ? 'text-white/80' : 'text-ink-muted',
        )}
      >
        {k.label}
      </span>
      <span className={cn('text-2xl font-extrabold', blue ? 'text-white' : 'text-ink')}>
        {formatValue(k)}
      </span>
      {k.hint ? (
        <span className={cn('text-xs', blue ? 'text-white/80' : 'text-ink-muted')}>{k.hint}</span>
      ) : null}
    </Card>
  );
  return k.link ? (
    <Link href={k.link} data-kpi={k.key} aria-label={`${k.label} : ${formatValue(k)}`}>
      {body}
    </Link>
  ) : (
    <div data-kpi={k.key}>{body}</div>
  );
}

export default function DashboardPage() {
  const { state } = useAuth();
  const island = useIslandFilter();
  const islands = useIslands();
  const islandId = island === 'all' ? undefined : islands.data?.find((i) => i.code === island)?.id;
  const enabled = state.status === 'authenticated' && (island === 'all' || !!islandId);
  const dash = useQuery({
    queryKey: ['dashboard', islandId ?? 'all'],
    enabled,
    queryFn: () => apiFetch<DashboardView>(`/dashboard${qs({ islandId })}`),
    refetchInterval: 60_000,
  });
  if (state.status !== 'authenticated') return null;
  const user = state.user;
  if (!user.modules.some((m) => m.key === 'dashboard')) return <Forbidden />;

  const d = dash.data;
  const firstName = user.fullName.split(' ')[0];
  const global = ROLE_SCOPE[user.role] === 'GLOBAL';
  const scope = global
    ? island === 'all'
      ? 'Toutes les îles'
      : ISLAND_LABELS[island]
    : (user.island?.name ?? '');
  const maxIsland = Math.max(1, ...(d?.islands ?? []).map((i) => i.revenue));

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        subtitle={`Bonjour ${firstName} · ${scope}${
          d
            ? ` · ${d.period.label} (${formatBusinessDate(d.period.start)} → ${formatBusinessDate(d.period.end)})`
            : ''
        }`}
      />
      <div
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        data-testid="dashboard-kpis"
      >
        {(d?.kpis ?? []).map((k) => (
          <Kpi key={k.key} k={k} />
        ))}
        {!d && dash.isLoading
          ? [0, 1, 2, 3].map((i) => <Card key={i} className="h-24 animate-pulse" />)
          : null}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="flex flex-col gap-3">
          <h2 className="text-base font-bold text-ink">À traiter</h2>
          <ul className="flex flex-col gap-1" data-testid="dashboard-todo">
            {(d?.todo ?? []).map((t) => (
              <li key={t.key}>
                <Link
                  href={t.link ?? '#'}
                  className="flex min-h-touch items-center justify-between rounded-md px-2 text-sm hover:bg-surface-muted"
                >
                  <span>{t.label}</span>
                  <Badge tone={t.alert && t.count ? 'red' : t.count ? 'orange' : 'blue'}>
                    {t.count}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        {d?.ranking ? (
          <Card className="flex flex-col gap-3 lg:col-span-2">
            <h2 className="text-base font-bold text-ink">{d.ranking.title}</h2>
            <Table aria-label={d.ranking.title}>
              <THead>
                <TR>
                  <TH>#</TH>
                  <TH>Nom</TH>
                  <TH>Vendus</TH>
                  <TH>Chiffre d’affaires</TH>
                  {d.ranking.rows.some((r) => r.remaining !== undefined) ? <TH>Restant</TH> : null}
                </TR>
              </THead>
              <TBody>
                {d.ranking.rows.map((r, i) => (
                  <TR key={r.id}>
                    <TD>{i + 1}</TD>
                    <TD className="font-semibold">{r.fullName}</TD>
                    <TD>{r.sold}</TD>
                    <TD className="whitespace-nowrap">{formatKmf(r.revenue)}</TD>
                    {r.remaining !== undefined ? <TD>{r.remaining}</TD> : null}
                  </TR>
                ))}
                {!d.ranking.rows.length ? (
                  <TR>
                    <TD colSpan={5} className="py-6 text-center text-ink-muted">
                      Aucune vente sur la période.
                    </TD>
                  </TR>
                ) : null}
              </TBody>
            </Table>
          </Card>
        ) : null}

        {d?.islands && island === 'all' ? (
          <Card className="flex flex-col gap-3" data-testid="dashboard-islands">
            <h2 className="text-base font-bold text-ink">Chiffre d’affaires par île</h2>
            {d.islands.map((i) => (
              <div key={i.code} className="flex flex-col gap-1">
                <div className="flex justify-between text-sm">
                  <span>{i.name}</span>
                  <span className="font-semibold">{formatKmf(i.revenue)}</span>
                </div>
                <div className="h-3 rounded-full bg-surface-muted">
                  <div
                    className="h-3 rounded-full bg-brand-blue"
                    style={{ width: `${Math.round((i.revenue / maxIsland) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </Card>
        ) : null}
      </div>

      {d?.recentOrders?.length ? (
        <Card className="flex flex-col gap-3">
          <h2 className="text-base font-bold text-ink">
            {user.role.startsWith('LEADER') ? 'Commandes de mon équipe' : 'Commandes récentes'}
          </h2>
          <Table aria-label="Commandes récentes">
            <THead>
              <TR>
                <TH>Commande</TH>
                <TH>Client</TH>
                <TH>Vendeur</TH>
                <TH>Île</TH>
                <TH>Montant</TH>
                <TH>Statut</TH>
                <TH>Créée</TH>
              </TR>
            </THead>
            <TBody>
              {d.recentOrders.map((o) => (
                <TR key={o.id}>
                  <TD>
                    <Link className="font-semibold text-brand-blue" href={`/commandes?id=${o.id}`}>
                      {o.number}
                    </Link>
                  </TD>
                  <TD>{o.customerName}</TD>
                  <TD>{o.seller}</TD>
                  <TD>{o.island}</TD>
                  <TD className="whitespace-nowrap">{formatKmf(o.amount)}</TD>
                  <TD>{ORDER_STATUS_LABELS[o.status as OrderStatus] ?? o.status}</TD>
                  <TD className="whitespace-nowrap text-xs text-ink-muted">
                    {formatBusinessDateTime(o.createdAt)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : null}

      {global && hasPermission(user.role, 'reports:read') ? <SaleReference /> : null}
    </>
  );
}
