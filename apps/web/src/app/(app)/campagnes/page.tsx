'use client';

import {
  businessToday,
  addDays,
  CAMPAIGN_CHANNEL_LABELS,
  CAMPAIGN_CHANNELS,
  CAMPAIGN_STATUS_LABELS,
  formatBusinessDate,
  formatKmf,
  hasPermission,
  type CampaignView,
  type Paginated,
  type ProductView,
} from '@digecom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { Forbidden } from '@/components/forbidden';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { KpiCard } from '@/components/ui/card';
import { Field } from '@/components/ui/input';
import { SelectField } from '@/components/ui/select';
import { Sheet } from '@/components/ui/sheet';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorMessage, fieldErrors } from '@/lib/queries';

function CampaignForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const products = useQuery({
    queryKey: ['products', 'mine'],
    queryFn: () =>
      apiFetch<Paginated<ProductView>>('/products?pageSize=200').then((p) =>
        p.items.filter((x) => x.leader.role === 'LEADER_JUNIOR'),
      ),
  });
  const today = businessToday();
  const [f, setF] = useState({
    name: '',
    productId: '',
    channel: 'FACEBOOK',
    budget: '',
    startDate: today,
    endDate: addDays(today, 14),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () =>
      apiFetch<CampaignView>('/campaigns', {
        method: 'POST',
        body: JSON.stringify({ ...f, budget: Number(f.budget) || 0 }),
      }),
    onSuccess: (c) => {
      toast(`${c.number} créée · budget envoyé en validation`, 'success');
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
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
      aria-label="Nouvelle campagne"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field
        label="Nom de la campagne"
        value={f.name}
        onChange={(e) => setF({ ...f, name: e.target.value })}
        error={errors.name}
      />
      <SelectField
        label="Produit (ton catalogue)"
        value={f.productId}
        onChange={(e) => setF({ ...f, productId: e.target.value })}
        placeholder="Choisir"
        options={(products.data ?? []).map((p) => ({
          value: p.id,
          label: `${p.name} · ${formatKmf(p.salePrice)} · prime ${formatKmf(p.tciBonus ?? 0)}`,
        }))}
        error={errors.productId}
      />
      <SelectField
        label="Canal"
        value={f.channel}
        onChange={(e) => setF({ ...f, channel: e.target.value })}
        options={CAMPAIGN_CHANNELS.map((c) => ({ value: c, label: CAMPAIGN_CHANNEL_LABELS[c] }))}
      />
      <Field
        label="Budget (KMF)"
        type="number"
        min={0}
        value={f.budget}
        onChange={(e) => setF({ ...f, budget: e.target.value })}
        hint="Enregistré comme dépense publicitaire, validée par le responsable financier"
      />
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Début"
          type="date"
          value={f.startDate}
          onChange={(e) => setF({ ...f, startDate: e.target.value })}
        />
        <Field
          label="Fin"
          type="date"
          value={f.endDate}
          onChange={(e) => setF({ ...f, endDate: e.target.value })}
          error={errors.endDate}
        />
      </div>
      <Button type="submit" disabled={save.isPending}>
        Lancer la campagne
      </Button>
    </form>
  );
}

export default function CampaignsPage() {
  const { state } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const list = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => apiFetch<CampaignView[]>('/campaigns'),
  });
  const toggle = useMutation({
    mutationFn: (c: CampaignView) =>
      apiFetch<CampaignView>(`/campaigns/${c.id}/${c.status === 'ACTIVE' ? 'pause' : 'resume'}`, {
        method: 'POST',
      }),
    onSuccess: (c) => {
      toast(`${c.number} : ${CAMPAIGN_STATUS_LABELS[c.status]}`, 'success');
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  if (state.status !== 'authenticated') return null;
  if (!state.user.modules.some((m) => m.key === 'campaigns')) return <Forbidden />;
  const canCreate = hasPermission(state.user.role, 'campaigns:create');
  const rows = list.data ?? [];
  const budget = rows.reduce((s, c) => s + c.budget, 0);
  const contacts = rows.reduce((s, c) => s + c.contacts, 0);
  const confirmed = rows.reduce((s, c) => s + c.confirmed, 0);
  const sold = rows.reduce((s, c) => s + c.sold, 0);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title="Campagnes"
          subtitle="Publicités du Leader Junior : contacts, confirmations, ventes, coût par vente"
        />
        {canCreate ? (
          <Button variant="accent" onClick={() => setCreating(true)}>
            + Nouvelle campagne
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Budget engagé"
          value={formatKmf(budget)}
          hint={`${rows.length} campagne(s)`}
        />
        <KpiCard
          label="Contacts reçus"
          value={contacts}
          hint={contacts ? `${Math.round((confirmed / contacts) * 100)} % confirmés` : '—'}
        />
        <KpiCard label="Ventes" value={sold} hint={`${confirmed} commande(s) confirmée(s)`} />
        <KpiCard
          label="Coût par vente"
          value={sold ? formatKmf(Math.round(budget / sold)) : '—'}
          accent
        />
      </div>
      <Table aria-label="Campagnes">
        <THead>
          <TR>
            <TH>Campagne</TH>
            <TH>Produit</TH>
            <TH>Canal</TH>
            <TH>Budget</TH>
            <TH>Période</TH>
            <TH>Contacts</TH>
            <TH>Confirmées</TH>
            <TH>Vendues</TH>
            <TH>Coût / vente</TH>
            <TH>Statut</TH>
            <TH>
              <span className="sr-only">Actions</span>
            </TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((c) => (
            <TR key={c.id} data-campaign={c.name}>
              <TD>
                <div className="font-semibold">{c.name}</div>
                <div className="text-xs text-ink-muted">
                  {c.number} · {c.leader.fullName}
                </div>
              </TD>
              <TD>{c.product.name}</TD>
              <TD>{CAMPAIGN_CHANNEL_LABELS[c.channel]}</TD>
              <TD className="whitespace-nowrap">
                {formatKmf(c.budget)}
                {c.expense?.status === 'PENDING' ? (
                  <div className="text-xs text-status-orange-fg">à valider</div>
                ) : null}
              </TD>
              <TD className="whitespace-nowrap text-xs text-ink-muted">
                {formatBusinessDate(c.startDate)} → {formatBusinessDate(c.endDate)}
              </TD>
              <TD>{c.contacts}</TD>
              <TD>
                {c.confirmed}
                {c.confirmationRate !== null ? (
                  <span className="text-xs text-ink-muted"> ({c.confirmationRate} %)</span>
                ) : null}
              </TD>
              <TD className="font-semibold">{c.sold}</TD>
              <TD className="whitespace-nowrap">
                {c.costPerSale !== null ? formatKmf(c.costPerSale) : '—'}
              </TD>
              <TD>
                <Badge
                  tone={c.status === 'ACTIVE' ? 'green' : c.status === 'PAUSED' ? 'orange' : 'blue'}
                >
                  {CAMPAIGN_STATUS_LABELS[c.status]}
                </Badge>
              </TD>
              <TD>
                {canCreate && c.status !== 'ENDED' ? (
                  <Button size="sm" variant="outline" onClick={() => toggle.mutate(c)}>
                    {c.status === 'ACTIVE' ? 'Pause' : 'Relancer'}
                  </Button>
                ) : null}
              </TD>
            </TR>
          ))}
          {list.data && !rows.length ? (
            <TR>
              <TD colSpan={11} className="py-8 text-center text-ink-muted">
                Aucune campagne.
              </TD>
            </TR>
          ) : null}
        </TBody>
      </Table>
      <Sheet open={creating} onOpenChange={setCreating} title="Nouvelle campagne">
        {creating ? <CampaignForm onDone={() => setCreating(false)} /> : null}
      </Sheet>
    </>
  );
}
