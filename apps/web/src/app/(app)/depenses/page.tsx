'use client';

import {
  addDays,
  businessToday,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  formatBusinessDate,
  formatKmf,
  hasPermission,
  type ExpenseView,
  type NetResult,
} from '@digecom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader, useIslandFilter } from '@/components/app-shell';
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
import { errorMessage, fieldErrors, qs, useIslands } from '@/lib/queries';

function ExpenseForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const islands = useIslands();
  const [f, setF] = useState({
    category: 'RENT',
    label: '',
    amount: '',
    islandId: '',
    periodDate: businessToday(),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () =>
      apiFetch<ExpenseView>('/expenses', {
        method: 'POST',
        body: JSON.stringify({ ...f, amount: Number(f.amount) }),
      }),
    onSuccess: () => {
      toast('Dépense saisie : en attente de validation', 'success');
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
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
      aria-label="Nouvelle dépense"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <SelectField
        label="Catégorie"
        value={f.category}
        onChange={(e) => setF({ ...f, category: e.target.value })}
        options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: EXPENSE_CATEGORY_LABELS[c] }))}
      />
      <Field
        label="Libellé"
        value={f.label}
        onChange={(e) => setF({ ...f, label: e.target.value })}
        error={errors.label}
      />
      <Field
        label="Montant (KMF)"
        type="number"
        min={1}
        value={f.amount}
        onChange={(e) => setF({ ...f, amount: e.target.value })}
        error={errors.amount}
      />
      <SelectField
        label="Île"
        value={f.islandId}
        onChange={(e) => setF({ ...f, islandId: e.target.value })}
        placeholder="Choisir"
        options={(islands.data ?? []).map((i) => ({ value: i.id, label: i.name }))}
        error={errors.islandId}
      />
      <Field
        label="Période (date)"
        type="date"
        value={f.periodDate}
        onChange={(e) => setF({ ...f, periodDate: e.target.value })}
      />
      <Button type="submit" disabled={save.isPending}>
        Enregistrer la dépense
      </Button>
    </form>
  );
}

export default function ExpensesPage() {
  const { state } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const island = useIslandFilter();
  const islands = useIslands();
  const [creating, setCreating] = useState(false);
  const islandId = island === 'all' ? undefined : islands.data?.find((i) => i.code === island)?.id;
  const today = businessToday();
  const from = `${today.slice(0, 8)}01`;
  const list = useQuery({
    queryKey: ['expenses', islandId],
    queryFn: () => apiFetch<ExpenseView[]>(`/expenses${qs({ islandId })}`),
  });
  const result = useQuery({
    queryKey: ['expenses', 'result', islandId, from],
    queryFn: () => apiFetch<NetResult>(`/finance/result${qs({ from, to: today, islandId })}`),
  });
  const act = useMutation({
    mutationFn: ({
      id,
      action,
      reason,
    }: {
      id: string;
      action: 'approve' | 'reject' | 'reverse';
      reason?: string;
    }) =>
      apiFetch<ExpenseView>(`/expenses/${id}/${action}`, {
        method: 'POST',
        body: JSON.stringify(reason ? { reason } : {}),
      }),
    onSuccess: (e) => {
      toast(
        `${e.label} : ${e.reversed ? 'annulée' : e.status === 'APPROVED' ? 'validée' : 'rejetée'}`,
        'success',
      );
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  if (state.status !== 'authenticated') return null;
  if (!state.user.modules.some((m) => m.key === 'expenses')) return <Forbidden />;
  const canCreate = hasPermission(state.user.role, 'expenses:create');
  const canApprove = hasPermission(state.user.role, 'expenses:approve');
  const r = result.data;
  const ask = (id: string, action: 'reject' | 'reverse') => {
    const reason = window.prompt(
      action === 'reject' ? 'Motif du rejet' : 'Justification de l’annulation',
    );
    if (reason && reason.trim().length >= 3) act.mutate({ id, action, reason });
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title="Dépenses"
          subtitle={`Charges opérationnelles et résultat net · depuis le ${formatBusinessDate(from)}`}
        />
        {canCreate ? (
          <Button variant="accent" onClick={() => setCreating(true)}>
            + Nouvelle dépense
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Marge après coût et taxes"
          value={r ? formatKmf(r.marginAfterTax) : '—'}
          hint={r ? `CA ${formatKmf(r.revenue)}` : undefined}
        />
        <KpiCard
          label="Charges validées"
          value={r ? formatKmf(r.expenses + r.courierFees) : '—'}
          hint={r ? `dont frais de course ${formatKmf(r.courierFees)}` : undefined}
        />
        <KpiCard label="Résultat net" value={r ? formatKmf(r.netResult) : '—'} accent />
        <KpiCard label="En attente de validation" value={r ? formatKmf(r.pendingExpenses) : '—'} />
      </div>
      <Table aria-label="Dépenses">
        <THead>
          <TR>
            <TH>Date</TH>
            <TH>Catégorie</TH>
            <TH>Libellé</TH>
            <TH>Île</TH>
            <TH>Saisie par</TH>
            <TH>Montant</TH>
            <TH>Statut</TH>
            <TH>
              <span className="sr-only">Actions</span>
            </TH>
          </TR>
        </THead>
        <TBody>
          {list.data?.map((e) => (
            <TR key={e.id} data-expense={e.label}>
              <TD className="whitespace-nowrap text-xs text-ink-muted">
                {formatBusinessDate(e.periodDate)}
              </TD>
              <TD>{EXPENSE_CATEGORY_LABELS[e.category]}</TD>
              <TD className="font-semibold">{e.label}</TD>
              <TD className="text-ink-muted">{e.island.name}</TD>
              <TD className="text-ink-muted">{e.createdBy.fullName}</TD>
              <TD className={`whitespace-nowrap font-semibold ${e.reversed ? 'line-through' : ''}`}>
                {formatKmf(e.amount)}
              </TD>
              <TD>
                <Badge
                  tone={
                    e.status === 'APPROVED'
                      ? e.reversed
                        ? 'red'
                        : 'green'
                      : e.status === 'PENDING'
                        ? 'orange'
                        : 'red'
                  }
                >
                  {e.reversed
                    ? 'Annulée'
                    : { PENDING: 'En attente', APPROVED: 'Validée', REJECTED: 'Rejetée' }[e.status]}
                </Badge>
              </TD>
              <TD className="text-right">
                {e.canApprove ? (
                  <div className="flex justify-end gap-1">
                    <Button size="sm" onClick={() => act.mutate({ id: e.id, action: 'approve' })}>
                      Valider
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => ask(e.id, 'reject')}>
                      Rejeter
                    </Button>
                  </div>
                ) : canApprove && e.status === 'APPROVED' && !e.reversed ? (
                  <Button size="sm" variant="ghost" onClick={() => ask(e.id, 'reverse')}>
                    Annuler
                  </Button>
                ) : null}
              </TD>
            </TR>
          ))}
          {list.data && !list.data.length ? (
            <TR>
              <TD colSpan={8} className="py-8 text-center text-ink-muted">
                Aucune dépense.
              </TD>
            </TR>
          ) : null}
        </TBody>
      </Table>
      <p className="text-xs text-ink-muted">
        Une dépense validée ne se modifie plus : on l’annule par une écriture inverse justifiée,
        puis on saisit la bonne. Période du résultat : {formatBusinessDate(from)} →{' '}
        {formatBusinessDate(addDays(today, 0))}.
      </p>
      <Sheet
        open={creating}
        onOpenChange={setCreating}
        title="Nouvelle dépense"
        description="Validée ensuite par le responsable financier."
      >
        {creating ? <ExpenseForm onDone={() => setCreating(false)} /> : null}
      </Sheet>
    </>
  );
}
