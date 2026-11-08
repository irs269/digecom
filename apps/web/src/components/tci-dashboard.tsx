'use client';

import {
  businessToday,
  formatKmf,
  isoWeekOf,
  type CampaignView,
  type ProspectView,
  type TciEarnings,
} from '@digecom/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { KpiCard } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';

/** Cartes du tableau de bord pour le Leader Junior et le téléconseiller (comme le prototype). */
export function TciDashboard({ role }: { role: 'TELECONSULTANT' | 'LEADER_JUNIOR' }) {
  const isTci = role === 'TELECONSULTANT';
  const week = isoWeekOf(businessToday());
  const earnings = useQuery({
    queryKey: ['tci', 'earnings', isTci ? 'me' : 'team', week],
    queryFn: () => apiFetch<TciEarnings>(`/tci/${isTci ? 'me' : 'team'}/earnings?week=${week}`),
  });
  const prospects = useQuery({
    queryKey: ['prospects', 'dashboard'],
    queryFn: () => apiFetch<ProspectView[]>('/prospects'),
  });
  const campaigns = useQuery({
    queryKey: ['campaigns'],
    enabled: !isTci,
    queryFn: () => apiFetch<CampaignView[]>('/campaigns'),
  });
  const e = earnings.data;
  const toCall = prospects.data?.filter((p) => p.status === 'TO_CALL').length ?? 0;
  const recall = prospects.data?.filter((p) => p.status === 'UNREACHABLE').length ?? 0;
  const active = campaigns.data?.filter((c) => c.status === 'ACTIVE') ?? [];

  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      data-testid="tci-dashboard"
    >
      {isTci ? (
        <KpiCard
          label="Prospects à appeler"
          value={<Link href="/prospects">{toCall + recall}</Link>}
          hint={`${recall} à rappeler`}
        />
      ) : (
        <KpiCard
          label="Campagnes actives"
          value={<Link href="/campagnes">{active.length}</Link>}
          hint={formatKmf(active.reduce((s, c) => s + c.budget, 0)) + ' engagés'}
        />
      )}
      <KpiCard
        label="Vendu cette semaine"
        value={e ? formatKmf(e.soldAmount) : '—'}
        hint={e ? `${e.soldCount} produit(s) vendu(s)` : undefined}
      />
      <KpiCard
        label={isTci ? 'Mes gains de la semaine' : 'Primes de l’équipe (semaine)'}
        value={e ? formatKmf(e.weekEarnings) : '—'}
        hint="Primes des ventes clôturées"
        accent
      />
      <KpiCard
        label={isTci ? 'Mes gains globaux' : 'Primes globales de l’équipe'}
        value={e ? formatKmf(e.totalEarnings) : '—'}
        hint={e && e.toClose.length ? `${e.toClose.length} vente(s) à clôturer` : 'Depuis le début'}
      />
    </div>
  );
}
