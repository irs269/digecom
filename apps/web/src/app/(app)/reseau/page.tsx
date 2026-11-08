'use client';

import {
  formatBusinessDate,
  formatKmf,
  formatPhone,
  hasPermission,
  type NetworkTeam,
  type NetworkView,
  type Paginated,
  type ProductView,
} from '@digecom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader, useIslandFilter } from '@/components/app-shell';
import { Forbidden } from '@/components/forbidden';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, KpiCard } from '@/components/ui/card';
import { Field } from '@/components/ui/input';
import { SelectField } from '@/components/ui/select';
import { Sheet } from '@/components/ui/sheet';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorMessage, fieldErrors, qs, useIslands } from '@/lib/queries';

function AllocateForm({
  team,
  sellerId,
  onDone,
}: {
  team: NetworkTeam;
  sellerId: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const products = useQuery({
    queryKey: ['products', 'leader', team.leader.id],
    queryFn: () =>
      apiFetch<Paginated<ProductView>>(`/products${qs({ pageSize: 200 })}`).then((p) =>
        p.items.filter((x) => x.leader.id === team.leader.id),
      ),
  });
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('5');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const member = team.members.find((m) => m.id === sellerId)!;
  const save = useMutation({
    mutationFn: () =>
      apiFetch('/network/allocations', {
        method: 'POST',
        body: JSON.stringify({ sellerId, productId, quantity: Number(quantity) }),
      }),
    onSuccess: () => {
      toast(`${quantity} unité(s) attribuée(s) à ${member.fullName}`, 'success');
      void queryClient.invalidateQueries({ queryKey: ['network'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
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
      aria-label="Attribuer des quantités"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <p className="text-sm text-ink-muted">
        Quantités réservées à {member.fullName} sur le stock de l’équipe. Une valeur négative en
        retire (jamais sous les unités déjà commandées).
      </p>
      <SelectField
        label="Produit"
        value={productId}
        onChange={(e) => setProductId(e.target.value)}
        placeholder="Choisir"
        options={(products.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
        error={errors.productId}
      />
      <Field
        label="Quantité"
        type="number"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        error={errors.quantity}
      />
      <Button type="submit" disabled={save.isPending || !productId}>
        Attribuer
      </Button>
    </form>
  );
}

function TargetForm({ team, onDone }: { team: NetworkTeam; onDone: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(String(team.weeklyTarget ?? ''));
  const save = useMutation({
    mutationFn: () =>
      apiFetch(`/network/targets/${team.leader.id}`, {
        method: 'PUT',
        body: JSON.stringify({ weeklyRevenue: Number(value) || 0 }),
      }),
    onSuccess: () => {
      toast('Objectif enregistré', 'success');
      void queryClient.invalidateQueries({ queryKey: ['network'] });
      onDone();
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  return (
    <form
      className="flex flex-col gap-3"
      aria-label="Objectif hebdomadaire"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field
        label="Objectif de chiffre d’affaires par semaine (KMF)"
        type="number"
        min={0}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        hint="Une notification est envoyée quand l’équipe l’atteint (0 = aucun objectif)"
      />
      <Button type="submit" disabled={save.isPending}>
        Enregistrer
      </Button>
    </form>
  );
}

function TeamCard({
  team,
  canAllocate,
  canTarget,
}: {
  team: NetworkTeam;
  canAllocate: boolean;
  canTarget: boolean;
}) {
  const [allocating, setAllocating] = useState<string | null>(null);
  const [target, setTarget] = useState(false);
  const senior = team.leader.role === 'LEADER_SENIOR';
  const progress = team.weeklyTarget
    ? Math.min(100, Math.round((team.weekRevenue / team.weeklyTarget) * 100))
    : null;
  return (
    <Card className="flex flex-col gap-3" data-team={team.leader.fullName}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-ink">
            {team.leader.fullName}{' '}
            <Badge tone={senior ? 'blue' : 'orange'}>
              {senior ? 'Leader Senior' : 'Leader Junior'}
            </Badge>
          </h2>
          <p className="text-xs text-ink-muted">
            {team.leader.island ?? '—'} · {team.members.length} membre(s) · {team.activeMembers}{' '}
            actif(s)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span>
            <strong>{team.sold}</strong> vendus
          </span>
          <span>
            <strong>{formatKmf(team.revenue)}</strong> de CA
          </span>
          <span className="text-ink-muted">Marge {formatKmf(team.marginAfterTax)}</span>
          {canTarget ? (
            <Button size="sm" variant="outline" onClick={() => setTarget(true)}>
              Objectif
            </Button>
          ) : null}
        </div>
      </div>
      {progress !== null ? (
        <div className="flex flex-col gap-1" aria-label="Objectif de la semaine">
          <div className="flex justify-between text-xs text-ink-muted">
            <span>Objectif de la semaine</span>
            <span>
              {formatKmf(team.weekRevenue)} / {formatKmf(team.weeklyTarget!)}
            </span>
          </div>
          <div className="h-2 rounded-full bg-surface-muted">
            <div className="h-2 rounded-full bg-brand-orange" style={{ width: `${progress}%` }} />
          </div>
        </div>
      ) : null}
      <Table aria-label={`Équipe ${team.leader.fullName}`}>
        <THead>
          <TR>
            <TH>Membre</TH>
            <TH>Téléphone</TH>
            <TH>Vendus</TH>
            <TH>CA</TH>
            {senior ? <TH>Quantités attribuées</TH> : null}
            {senior ? <TH>Restant</TH> : null}
            <TH>
              <span className="sr-only">Actions</span>
            </TH>
          </TR>
        </THead>
        <TBody>
          {team.members.map((m) => (
            <TR key={m.id} data-member={m.fullName}>
              <TD>
                <div className="font-semibold">{m.fullName}</div>
                {!m.isActive ? <Badge tone="red">Inactif</Badge> : null}
              </TD>
              <TD className="whitespace-nowrap">{formatPhone(m.phone)}</TD>
              <TD>{m.sold}</TD>
              <TD className="whitespace-nowrap">{formatKmf(m.revenue)}</TD>
              {senior ? (
                <TD>
                  {m.allocated}
                  {m.allocations.length ? (
                    <div className="text-xs text-ink-muted">
                      {m.allocations.map((a) => `${a.product} : ${a.allocated}`).join(' · ')}
                    </div>
                  ) : null}
                </TD>
              ) : null}
              {senior ? <TD className="font-semibold">{m.remaining}</TD> : null}
              <TD>
                {canAllocate && senior && m.role === 'SELLER' ? (
                  <Button size="sm" variant="outline" onClick={() => setAllocating(m.id)}>
                    Attribuer
                  </Button>
                ) : null}
              </TD>
            </TR>
          ))}
          {!team.members.length ? (
            <TR>
              <TD colSpan={7} className="py-6 text-center text-ink-muted">
                Aucun membre.
              </TD>
            </TR>
          ) : null}
        </TBody>
      </Table>
      <Sheet
        open={!!allocating}
        onOpenChange={(o) => !o && setAllocating(null)}
        title="Attribuer des quantités"
      >
        {allocating ? (
          <AllocateForm team={team} sellerId={allocating} onDone={() => setAllocating(null)} />
        ) : null}
      </Sheet>
      <Sheet open={target} onOpenChange={setTarget} title={`Objectif – ${team.leader.fullName}`}>
        {target ? <TargetForm team={team} onDone={() => setTarget(false)} /> : null}
      </Sheet>
    </Card>
  );
}

export default function NetworkPage() {
  const { state } = useAuth();
  const island = useIslandFilter();
  const islands = useIslands();
  const islandId = island === 'all' ? undefined : islands.data?.find((i) => i.code === island)?.id;
  const data = useQuery({
    queryKey: ['network', islandId ?? 'all'],
    queryFn: () => apiFetch<NetworkView>(`/network${qs({ islandId })}`),
  });
  if (state.status !== 'authenticated') return null;
  const mod = state.user.modules.find((m) => m.key === 'network');
  if (!mod) return <Forbidden />;
  const role = state.user.role;
  const canAllocate = hasPermission(role, 'network:allocate');
  const canTarget = mod.access === 'C';
  const teams = data.data?.teams ?? [];
  const best = [...teams].sort((a, b) => b.revenue - a.revenue)[0];

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <PageHeader
          title="Réseau commercial"
          subtitle={
            data.data
              ? `Leaders, équipes et quantités attribuées · du ${formatBusinessDate(data.data.period.start)} au ${formatBusinessDate(data.data.period.end)}`
              : 'Leaders, équipes et quantités attribuées'
          }
        />
        {mod.access === 'L' ? <Badge tone="orange">Lecture seule</Badge> : null}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Équipes"
          value={teams.length}
          hint={`${teams.reduce((s, t) => s + t.members.length, 0)} membres`}
        />
        <KpiCard
          label="Produits vendus"
          value={teams.reduce((s, t) => s + t.sold, 0)}
          hint="Cycle en cours"
        />
        <KpiCard
          label="Chiffre d’affaires"
          value={formatKmf(teams.reduce((s, t) => s + t.revenue, 0))}
          accent
        />
        <KpiCard
          label="Meilleure équipe"
          value={best?.leader.fullName ?? '—'}
          hint={best ? formatKmf(best.revenue) : undefined}
        />
      </div>
      {teams.length > 1 ? (
        <Card className="flex flex-col gap-2">
          <h2 className="text-base font-bold text-ink">Comparaison des équipes</h2>
          {[...teams]
            .sort((a, b) => b.revenue - a.revenue)
            .map((t) => (
              <div key={t.leader.id} className="flex items-center gap-3 text-sm">
                <span className="w-40 shrink-0 truncate">{t.leader.fullName}</span>
                <div className="h-3 flex-1 rounded-full bg-surface-muted">
                  <div
                    className="h-3 rounded-full bg-brand-blue"
                    style={{
                      width: `${Math.round((t.revenue / Math.max(1, best!.revenue)) * 100)}%`,
                    }}
                  />
                </div>
                <span className="w-28 shrink-0 text-right font-semibold">
                  {formatKmf(t.revenue)}
                </span>
              </div>
            ))}
        </Card>
      ) : null}
      {teams.map((t) => (
        <TeamCard key={t.leader.id} team={t} canAllocate={canAllocate} canTarget={canTarget} />
      ))}
      {role === 'ADMIN' ? (
        <p className="text-xs text-ink-muted">
          Les réaffectations d’un membre à un autre leader se font depuis{' '}
          <Link className="text-brand-blue underline" href="/utilisateurs">
            Utilisateurs
          </Link>{' '}
          et sont historisées.
        </p>
      ) : null}
    </>
  );
}
