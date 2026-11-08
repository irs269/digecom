'use client';

import {
  formatBusinessDate,
  formatBusinessDateTime,
  formatKmf,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  SETTLEMENT_STATUS_LABELS,
  SETTLEMENT_STATUSES,
  type SettlementStatus,
  type SettlementView,
} from '@digecom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader, useIslandFilter } from '@/components/app-shell';
import { Forbidden } from '@/components/forbidden';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/input';
import { SelectField } from '@/components/ui/select';
import { Sheet } from '@/components/ui/sheet';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { apiFetch, getAccessToken } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorMessage, qs, useIslands } from '@/lib/queries';

const TONE: Record<SettlementStatus, 'blue' | 'orange' | 'green'> = {
  GENERATED: 'orange',
  VERIFIED: 'blue',
  APPROVED: 'blue',
  PAID: 'green',
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

function Circuit() {
  const steps = [
    { label: 'Généré', who: 'automatique tous les 14 jours' },
    { label: 'Vérifié', who: 'comptable' },
    { label: 'Validé', who: 'responsable financier' },
    { label: 'Payé', who: 'caissier de l’île' },
  ];
  return (
    <ol
      className="grid grid-cols-2 gap-2 rounded-xl bg-brand-blue p-4 text-white sm:grid-cols-4"
      aria-label="Circuit de règlement"
    >
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-orange text-sm font-bold text-brand-on-orange">
            {i + 1}
          </span>
          <span className="flex flex-col">
            <span className="text-sm font-bold">{s.label}</span>
            <span className="text-xs text-brand-blue-soft">{s.who}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function Statement({ id }: { id: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [method, setMethod] = useState('HURI_MONEY');
  const [ref, setRef] = useState('');
  const s = useQuery({
    queryKey: ['settlements', id],
    queryFn: () => apiFetch<SettlementView>(`/settlements/${id}`),
  });
  const act = useMutation({
    mutationFn: (action: 'verify' | 'approve' | 'pay') =>
      apiFetch<SettlementView>(`/settlements/${id}/${action}`, {
        method: 'POST',
        body:
          action === 'pay'
            ? JSON.stringify({ paymentMethod: method, paymentRef: ref || null })
            : '{}',
      }),
    onSuccess: (r) => {
      toast(`Relevé ${r.number} : ${SETTLEMENT_STATUS_LABELS[r.status]}`, 'success');
      void queryClient.invalidateQueries({ queryKey: ['settlements'] });
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  const download = async () => {
    const token = getAccessToken();
    const res = await fetch(`${API_URL}/settlements/${id}/pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return toast('Téléchargement impossible', 'error');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `releve-${s.data?.number ?? id}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const r = s.data;
  if (!r) return <p className="text-sm text-ink-muted">Chargement…</p>;
  const row = (label: string, value: string, strong = false) => (
    <div
      className={`flex justify-between gap-3 py-1.5 ${strong ? 'border-t border-surface-border pt-2 text-base font-extrabold' : 'text-sm'}`}
    >
      <span className={strong ? '' : 'text-ink-muted'}>{label}</span>
      <span>{value}</span>
    </div>
  );
  return (
    <div className="flex flex-col gap-4" data-testid="statement">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={TONE[r.status]}>{SETTLEMENT_STATUS_LABELS[r.status]}</Badge>
        <span className="text-sm text-ink-muted">
          du {formatBusinessDate(r.periodStart)} au {formatBusinessDate(r.periodEnd)} ·{' '}
          {r.island.name}
        </span>
      </div>
      <div className="rounded-lg border border-surface-border p-4">
        {row(
          `Commissions (${r.salesCount} vente${r.salesCount > 1 ? 's' : ''})`,
          formatKmf(r.grossCommission),
        )}
        {row('Taxes e-commerçant', `− ${formatKmf(r.taxes)}`)}
        {row('Abonnements', `− ${formatKmf(r.subscriptions)}`)}
        {row('Autres retenues', `− ${formatKmf(r.otherDeductions)}`)}
        {r.carriedOver ? row('Report du cycle précédent', formatKmf(r.carriedOver)) : null}
        {row('Net à payer', formatKmf(r.netToPay), true)}
        {r.balance < 0 ? (
          <p className="mt-1 text-xs text-status-orange-fg">
            Solde négatif reporté au prochain cycle : {formatKmf(r.balance)}
          </p>
        ) : null}
      </div>
      <ul className="flex flex-col gap-1 text-xs text-ink-muted">
        {r.verifiedBy ? (
          <li>
            Vérifié par {r.verifiedBy.fullName} le {formatBusinessDateTime(r.verifiedAt!)}
          </li>
        ) : null}
        {r.approvedBy ? (
          <li>
            Validé par {r.approvedBy.fullName} le {formatBusinessDateTime(r.approvedAt!)}
          </li>
        ) : null}
        {r.paidBy ? (
          <li>
            Payé par {r.paidBy.fullName} le {formatBusinessDateTime(r.paidAt!)} ·{' '}
            {PAYMENT_METHOD_LABELS[r.paymentMethod as keyof typeof PAYMENT_METHOD_LABELS] ??
              r.paymentMethod}
            {r.paymentRef ? ` · ${r.paymentRef}` : ''}
          </li>
        ) : null}
      </ul>
      {r.nextAction === 'pay' ? (
        <div className="flex flex-col gap-3 rounded-lg bg-surface p-3">
          <SelectField
            label="Moyen de paiement"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))}
          />
          <Field
            label="Référence (facultatif)"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="N° de transaction, reçu…"
          />
        </div>
      ) : null}
      {r.nextAction ? (
        <Button variant="accent" disabled={act.isPending} onClick={() => act.mutate(r.nextAction!)}>
          {
            {
              verify: 'Vérifier le relevé',
              approve: 'Valider le relevé',
              pay: `Payer ${formatKmf(r.netToPay)}`,
            }[r.nextAction]
          }
        </Button>
      ) : r.waitingFor ? (
        <p className="rounded-md bg-status-orange-bg px-3 py-2 text-sm text-status-orange-fg">
          En attente : {r.waitingFor}.
        </p>
      ) : null}
      <Button variant="outline" onClick={() => void download()}>
        Télécharger le relevé PDF
      </Button>
      {r.lines?.length ? (
        <details className="text-sm">
          <summary className="min-h-touch cursor-pointer py-2 font-semibold text-brand-blue">
            Détail ({r.lines.length} écritures)
          </summary>
          <ul className="flex flex-col divide-y divide-surface-border">
            {r.lines.map((l) => (
              <li key={l.id} className="flex justify-between gap-2 py-1.5">
                <span>
                  {formatBusinessDate(l.periodDate)} · {l.label}
                  {l.orderNumber ? ` · ${l.orderNumber}` : ''}
                </span>
                <span className="whitespace-nowrap">{formatKmf(l.amount)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export default function SettlementsPage() {
  const { state } = useAuth();
  const island = useIslandFilter();
  const islands = useIslands();
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const islandId = island === 'all' ? undefined : islands.data?.find((i) => i.code === island)?.id;
  const cycle = useQuery({
    queryKey: ['settlements', 'cycle'],
    queryFn: () => apiFetch<{ start: string; end: string }>('/settlements/current-cycle'),
  });
  const list = useQuery({
    queryKey: ['settlements', 'list', status, islandId],
    queryFn: () => apiFetch<SettlementView[]>(`/settlements${qs({ status, islandId })}`),
  });

  if (state.status !== 'authenticated') return null;
  if (!state.user.modules.some((m) => m.key === 'settlements')) return <Forbidden />;
  const rows = list.data ?? [];
  const total = rows.filter((r) => r.status !== 'PAID').reduce((s, r) => s + r.netToPay, 0);

  return (
    <>
      <PageHeader title="Règlements" subtitle="Relevés des e-commerçants tous les 14 jours" />
      <Circuit />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <span className="text-xs font-semibold uppercase text-ink-muted">Dernier cycle clos</span>
          <div className="text-lg font-extrabold">
            {cycle.data
              ? `${formatBusinessDate(cycle.data.start)} → ${formatBusinessDate(cycle.data.end)}`
              : '—'}
          </div>
        </Card>
        <Card>
          <span className="text-xs font-semibold uppercase text-ink-muted">Relevés en cours</span>
          <div className="text-2xl font-extrabold">
            {rows.filter((r) => r.status !== 'PAID').length}
          </div>
        </Card>
        <Card className="border-brand-orange">
          <span className="text-xs font-semibold uppercase text-ink-muted">Reste à payer</span>
          <div className="text-2xl font-extrabold">{formatKmf(total)}</div>
        </Card>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="settlement-status" className="text-sm font-semibold text-ink">
            Statut
          </label>
          <select
            id="settlement-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="min-h-touch rounded-md border border-surface-border bg-white px-3 text-sm"
          >
            <option value="">Tous</option>
            {SETTLEMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {SETTLEMENT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Table aria-label="Relevés">
        <THead>
          <TR>
            <TH>Relevé</TH>
            <TH>E-commerçant</TH>
            <TH>Île</TH>
            <TH>Période</TH>
            <TH>Ventes</TH>
            <TH>Net à payer</TH>
            <TH>Statut</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id} data-settlement={r.seller.fullName}>
              <TD>
                <button
                  type="button"
                  className="font-semibold text-brand-blue hover:underline"
                  onClick={() => setSelected(r.id)}
                  aria-label={`Ouvrir le relevé de ${r.seller.fullName}`}
                >
                  {r.number}
                </button>
              </TD>
              <TD className="font-semibold">{r.seller.fullName}</TD>
              <TD className="text-ink-muted">{r.island.name}</TD>
              <TD className="whitespace-nowrap text-xs text-ink-muted">
                {formatBusinessDate(r.periodStart)} → {formatBusinessDate(r.periodEnd)}
              </TD>
              <TD>{r.salesCount}</TD>
              <TD className="whitespace-nowrap font-semibold">{formatKmf(r.netToPay)}</TD>
              <TD>
                <Badge tone={TONE[r.status]}>{SETTLEMENT_STATUS_LABELS[r.status]}</Badge>
              </TD>
            </TR>
          ))}
          {list.data && !rows.length ? (
            <TR>
              <TD colSpan={7} className="py-8 text-center text-ink-muted">
                Aucun relevé.
              </TD>
            </TR>
          ) : null}
        </TBody>
      </Table>
      <Sheet
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        title={
          rows.find((r) => r.id === selected)
            ? `Relevé de ${rows.find((r) => r.id === selected)!.seller.fullName}`
            : 'Relevé'
        }
      >
        {selected ? <Statement id={selected} /> : null}
      </Sheet>
    </>
  );
}
