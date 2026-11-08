'use client';

import {
  DELIVERY_MODE_LABELS,
  DELIVERY_MODES,
  formatBusinessDateTime,
  formatKmf,
  formatPhone,
  hasPermission,
  PROSPECT_STATUS_LABELS,
  PROSPECT_STATUSES,
  type CampaignView,
  type ImportReport,
  type ProspectStatus,
  type ProspectView,
  type TciEarnings,
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
import { errorMessage, fieldErrors, qs } from '@/lib/queries';

const TONE: Record<ProspectStatus, 'blue' | 'orange' | 'green' | 'red'> = {
  TO_CALL: 'blue',
  UNREACHABLE: 'orange',
  CONFIRMED: 'green',
  NOT_INTERESTED: 'red',
};

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function ImportPanel({ campaigns, onDone }: { campaigns: CampaignView[]; onDone: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [campaignId, setCampaignId] = useState(
    campaigns.find((c) => c.status === 'ACTIVE')?.id ?? '',
  );
  const [file, setFile] = useState<{ name: string; data: string } | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const send = useMutation({
    mutationFn: (dryRun: boolean) =>
      apiFetch<ImportReport>(`/campaigns/${campaignId}/prospects/import`, {
        method: 'POST',
        body: JSON.stringify({ fileName: file!.name, contentBase64: file!.data, dryRun }),
      }),
    onSuccess: (r, dryRun) => {
      setReport(r);
      if (!dryRun) {
        toast(`${r.imported} contact(s) importé(s)`, 'success');
        void queryClient.invalidateQueries({ queryKey: ['prospects'] });
        void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      }
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  const assign = useMutation({
    mutationFn: () =>
      apiFetch<{ assigned: number; byTci: { tci: string; count: number }[] }>(
        `/campaigns/${campaignId}/prospects/assign`,
        { method: 'POST', body: JSON.stringify({ mode: 'auto' }) },
      ),
    onSuccess: (r) => {
      toast(
        r.assigned
          ? `${r.assigned} prospect(s) répartis : ${r.byTci.map((t) => `${t.tci} ${t.count}`).join(', ')}`
          : 'Aucun prospect à répartir',
        'success',
      );
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      onDone();
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  return (
    <div className="flex flex-col gap-4">
      <SelectField
        label="Campagne"
        value={campaignId}
        onChange={(e) => {
          setCampaignId(e.target.value);
          setReport(null);
        }}
        placeholder="Choisir"
        options={campaigns
          .filter((c) => c.status !== 'ENDED')
          .map((c) => ({ value: c.id, label: `${c.number} · ${c.name}` }))}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="prospect-file" className="text-sm font-semibold">
          Fichier CSV ou Excel (nom, téléphone, note)
        </label>
        <input
          id="prospect-file"
          type="file"
          accept=".csv,.txt,.xlsx"
          className="min-h-touch text-sm"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            setReport(null);
            if (!f) return setFile(null);
            if (f.size > 5 * 1024 * 1024)
              return toast('Fichier trop lourd (5 Mo maximum)', 'error');
            setFile({ name: f.name, data: await toBase64(f) });
          }}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={!file || !campaignId || send.isPending}
          onClick={() => send.mutate(true)}
        >
          Aperçu
        </Button>
        <Button
          disabled={!file || !campaignId || !report || send.isPending}
          onClick={() => send.mutate(false)}
        >
          Importer
        </Button>
      </div>
      {report ? (
        <div
          className="flex flex-col gap-2 rounded-md bg-surface p-3 text-sm"
          data-testid="import-report"
        >
          <p>
            <strong>{report.imported}</strong> à importer · {report.duplicates} doublon(s) ·{' '}
            {report.invalid} invalide(s) sur {report.rows} ligne(s)
          </p>
          <ul className="max-h-48 overflow-y-auto text-xs">
            {report.lines
              .filter((l) => l.status !== 'OK')
              .map((l) => (
                <li key={l.line}>
                  Ligne {l.line} · {l.fullName || '(sans nom)'} : {l.error}
                </li>
              ))}
          </ul>
        </div>
      ) : null}
      <div className="border-t border-surface-border pt-3">
        <Button
          variant="accent"
          disabled={!campaignId || assign.isPending}
          onClick={() => assign.mutate()}
        >
          Répartir équitablement entre les TCI
        </Button>
      </div>
    </div>
  );
}

function ConfirmForm({ prospect, onDone }: { prospect: ProspectView; onDone: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [f, setF] = useState({
    customerName: prospect.fullName,
    customerPhone: formatPhone(prospect.phone),
    customerAddress: '',
    zone: '',
    quantity: '1',
    deliveryMode: 'TO_CUSTOMER',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ order: { number: string } }>(`/prospects/${prospect.id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ ...f, quantity: Number(f.quantity) }),
      }),
    onSuccess: (r) => {
      toast(`Commande ${r.order.number} créée : préparation par le site`, 'success');
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
      void queryClient.invalidateQueries({ queryKey: ['tci'] });
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
      aria-label="Commande confirmée"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <p className="text-sm text-ink-muted">
        Campagne {prospect.campaign.number} · {prospect.campaign.name}
      </p>
      <Field
        label="Client"
        value={f.customerName}
        onChange={(e) => setF({ ...f, customerName: e.target.value })}
        error={errors.customerName}
      />
      <Field
        label="Téléphone"
        type="tel"
        value={f.customerPhone}
        onChange={(e) => setF({ ...f, customerPhone: e.target.value })}
        error={errors.customerPhone}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Adresse / quartier"
          value={f.customerAddress}
          onChange={(e) => setF({ ...f, customerAddress: e.target.value })}
        />
        <Field label="Zone" value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })} />
      </div>
      <Field
        label="Quantité"
        type="number"
        min={1}
        value={f.quantity}
        onChange={(e) => setF({ ...f, quantity: e.target.value })}
      />
      <SelectField
        label="Mode de remise"
        value={f.deliveryMode}
        onChange={(e) => setF({ ...f, deliveryMode: e.target.value })}
        options={DELIVERY_MODES.map((m) => ({ value: m, label: DELIVERY_MODE_LABELS[m] }))}
      />
      <Button type="submit" variant="accent" disabled={save.isPending}>
        Créer la commande
      </Button>
    </form>
  );
}

export default function ProspectsPage() {
  const { state } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [importing, setImporting] = useState(false);
  const [confirming, setConfirming] = useState<ProspectView | null>(null);
  const list = useQuery({
    queryKey: ['prospects', status],
    queryFn: () => apiFetch<ProspectView[]>(`/prospects${qs({ status })}`),
  });
  const isTci = state.status === 'authenticated' && state.user.role === 'TELECONSULTANT';
  const canImport =
    state.status === 'authenticated' && hasPermission(state.user.role, 'prospects:import');
  const campaigns = useQuery({
    queryKey: ['campaigns'],
    enabled: canImport,
    queryFn: () => apiFetch<CampaignView[]>('/campaigns'),
  });
  const earnings = useQuery({
    queryKey: ['tci', 'earnings', 'prospects'],
    enabled: !!state.user,
    queryFn: () =>
      apiFetch<TciEarnings>(isTci ? '/tci/me/earnings' : '/tci/team/earnings').catch(() => null),
  });
  const call = useMutation({
    mutationFn: ({ id, outcome }: { id: string; outcome: 'UNREACHABLE' | 'NOT_INTERESTED' }) =>
      apiFetch<ProspectView>(`/prospects/${id}/call`, {
        method: 'POST',
        body: JSON.stringify({ outcome }),
      }),
    onSuccess: (p) => {
      toast(`${p.fullName} : ${PROSPECT_STATUS_LABELS[p.status]}`, 'success');
      void queryClient.invalidateQueries({ queryKey: ['prospects'] });
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  if (state.status !== 'authenticated') return null;
  if (!state.user.modules.some((m) => m.key === 'prospects')) return <Forbidden />;
  const all = list.data ?? [];
  const toCall = all.filter((p) => p.status === 'TO_CALL').length;
  const recall = all.filter((p) => p.status === 'UNREACHABLE').length;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title="Prospects"
          subtitle={
            isTci ? 'Tes contacts à appeler' : 'Contacts des campagnes et répartition entre les TCI'
          }
        />
        {canImport ? (
          <Button variant="accent" onClick={() => setImporting(true)}>
            Importer des contacts
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="À appeler" value={toCall + recall} hint={`${recall} à rappeler`} />
        <KpiCard
          label="Commandes confirmées"
          value={all.filter((p) => p.status === 'CONFIRMED').length}
        />
        <KpiCard
          label="Ventes de la semaine"
          value={earnings.data ? earnings.data.soldCount : '—'}
          hint={earnings.data ? formatKmf(earnings.data.soldAmount) : undefined}
        />
        <KpiCard
          label={isTci ? 'Mes primes de la semaine' : 'Primes de la semaine'}
          value={earnings.data ? formatKmf(earnings.data.weekEarnings) : '—'}
          accent
        />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="prospect-status" className="text-sm font-semibold">
            Statut
          </label>
          <select
            id="prospect-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="min-h-touch rounded-md border border-surface-border bg-white px-3 text-sm"
          >
            <option value="">Tous</option>
            {PROSPECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROSPECT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Table aria-label="Prospects">
        <THead>
          <TR>
            <TH>Contact</TH>
            <TH>Téléphone</TH>
            <TH>Campagne</TH>
            {!isTci ? <TH>TCI</TH> : null}
            <TH>Statut</TH>
            <TH>Dernier appel</TH>
            <TH>
              <span className="sr-only">Actions</span>
            </TH>
          </TR>
        </THead>
        <TBody>
          {all.map((p) => (
            <TR key={p.id} data-prospect={p.fullName}>
              <TD>
                <div className="font-semibold">{p.fullName}</div>
                {p.note ? (
                  <div className="max-w-[240px] truncate text-xs text-ink-muted">{p.note}</div>
                ) : null}
              </TD>
              <TD className="whitespace-nowrap">
                <a href={`tel:${p.phone}`}>{formatPhone(p.phone)}</a>
              </TD>
              <TD className="text-ink-muted">{p.campaign.number}</TD>
              {!isTci ? (
                <TD>{p.tci?.fullName ?? <span className="text-ink-muted">Non attribué</span>}</TD>
              ) : null}
              <TD>
                <Badge tone={TONE[p.status]}>{PROSPECT_STATUS_LABELS[p.status]}</Badge>
                {p.attempts ? (
                  <span className="ml-1 text-xs text-ink-muted">{p.attempts} appel(s)</span>
                ) : null}
                {p.order ? <div className="text-xs text-ink-muted">{p.order.number}</div> : null}
              </TD>
              <TD className="whitespace-nowrap text-xs text-ink-muted">
                {p.lastCallAt ? formatBusinessDateTime(p.lastCallAt) : '—'}
              </TD>
              <TD>
                {isTci && (p.status === 'TO_CALL' || p.status === 'UNREACHABLE') ? (
                  <div className="flex flex-wrap justify-end gap-1">
                    <Button
                      size="sm"
                      onClick={() => setConfirming(p)}
                      aria-label={`Commande confirmée pour ${p.fullName}`}
                    >
                      Commande confirmée
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => call.mutate({ id: p.id, outcome: 'UNREACHABLE' })}
                    >
                      Injoignable
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => call.mutate({ id: p.id, outcome: 'NOT_INTERESTED' })}
                    >
                      Pas intéressé
                    </Button>
                  </div>
                ) : null}
              </TD>
            </TR>
          ))}
          {list.data && !all.length ? (
            <TR>
              <TD colSpan={7} className="py-8 text-center text-ink-muted">
                Aucun prospect.
              </TD>
            </TR>
          ) : null}
        </TBody>
      </Table>
      <Sheet
        open={importing}
        onOpenChange={setImporting}
        title="Importer des contacts"
        description="Aperçu, doublons et numéros invalides signalés avant l’import."
      >
        {importing ? (
          <ImportPanel campaigns={campaigns.data ?? []} onDone={() => setImporting(false)} />
        ) : null}
      </Sheet>
      <Sheet
        open={!!confirming}
        onOpenChange={(o) => !o && setConfirming(null)}
        title={confirming ? `Commande confirmée – ${confirming.fullName}` : ''}
      >
        {confirming ? (
          <ConfirmForm prospect={confirming} onDone={() => setConfirming(null)} />
        ) : null}
      </Sheet>
    </>
  );
}
