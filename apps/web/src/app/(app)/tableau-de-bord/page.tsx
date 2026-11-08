'use client';

import { hasPermission, ISLAND_LABELS } from '@digecom/shared';
import { PageHeader, useIslandFilter } from '@/components/app-shell';
import { Forbidden } from '@/components/forbidden';
import { Card, KpiCard } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';
import { SaleReference } from '@/components/sale-reference';
import { TciDashboard } from '@/components/tci-dashboard';

export default function DashboardPage() {
  const { state } = useAuth();
  const island = useIslandFilter();
  if (state.status !== 'authenticated') return null;
  const user = state.user;
  if (!user.modules.some((m) => m.key === 'dashboard')) return <Forbidden />;

  const firstName = user.fullName.split(' ')[0];
  const scope = island === 'all' ? 'Toutes les îles' : ISLAND_LABELS[island];

  return (
    <>
      <PageHeader title="Tableau de bord" subtitle={`Bonjour ${firstName} · ${scope}`} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Ventes du jour" value="—" hint="Disponible en phase 6" />
        <KpiCard label="Commandes en cours" value="—" hint="Disponible en phase 3" />
        <KpiCard label="Stock en alerte" value="—" hint="Disponible en phase 2" />
        <KpiCard label="Règlements à traiter" value="—" hint="Disponible en phase 4" accent />
      </div>
      {user.scope === 'GLOBAL' && hasPermission(user.role, 'reports:read') ? (
        <SaleReference />
      ) : null}
      {user.role === 'TELECONSULTANT' || user.role === 'LEADER_JUNIOR' ? (
        <TciDashboard role={user.role} />
      ) : null}
      <Card className="flex flex-col gap-2">
        <h2 className="text-base font-bold text-ink">Bientôt</h2>
        <p className="text-sm text-ink-muted">
          Le tableau de bord se remplira au fil des phases : commandes, stock, finance et réseau
          commercial.
        </p>
      </Card>
    </>
  );
}
