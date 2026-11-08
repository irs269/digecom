'use client';

import {
  CASH_CATEGORY_LABELS,
  formatBusinessDate,
  formatBusinessDateTime,
  formatKmf,
  hasPermission,
  type CashRegisterView,
  type CashSessionView,
  type PendingRemittance,
} from '@digecom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { Forbidden } from '@/components/forbidden';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/input';
import { SelectField } from '@/components/ui/select';
import { Sheet } from '@/components/ui/sheet';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { businessToday } from '@digecom/shared';
import { errorMessage } from '@/lib/queries';

type Panel = { kind: 'open' | 'in' | 'out' | 'remit' | 'close'; reg: CashRegisterView } | null;

function useCashMutation(path: string, onDone: () => void, success: string) {
  const toast = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: object) =>
      apiFetch<CashSessionView>(path, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (s) => {
      toast(
        s.difference ? `${success} · écart ${formatKmf(s.difference)}` : success,
        s.difference ? 'error' : 'success',
      );
      void queryClient.invalidateQueries({ queryKey: ['cash'] });
      onDone();
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });
}

function OpenForm({ reg, onDone }: { reg: CashRegisterView; onDone: () => void }) {
  const [amount, setAmount] = useState(String(reg.last?.countedAmount ?? 0));
  const m = useCashMutation('/cash/open', onDone, 'Caisse ouverte');
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate({ siteId: reg.site.id, openingAmount: Number(amount) });
      }}
    >
      <Field
        label="Fond de caisse à l’ouverture (KMF)"
        type="number"
        min={0}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <Button type="submit" disabled={m.isPending}>
        Ouvrir la caisse
      </Button>
    </form>
  );
}

function OperationForm({
  reg,
  direction,
  onDone,
}: {
  reg: CashRegisterView;
  direction: 'IN' | 'OUT';
  onDone: () => void;
}) {
  const [category, setCategory] = useState(direction === 'IN' ? 'COUNTER_SALE' : 'OTHER');
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const m = useCashMutation(
    `/cash/${reg.site.id}/operations`,
    onDone,
    direction === 'IN' ? 'Encaissement enregistré' : 'Décaissement enregistré',
  );
  const categories =
    direction === 'IN' ? ['COUNTER_SALE', 'SUBSCRIPTION_CASH', 'OTHER'] : ['OTHER'];
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate({ direction, category, amount: Number(amount), label: label || undefined });
      }}
    >
      <SelectField
        label="Nature"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        options={categories.map((c) => ({
          value: c,
          label: CASH_CATEGORY_LABELS[c as keyof typeof CASH_CATEGORY_LABELS],
        }))}
      />
      <Field
        label="Montant (KMF)"
        type="number"
        min={1}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <Field label="Libellé" value={label} onChange={(e) => setLabel(e.target.value)} />
      <Button type="submit" disabled={m.isPending || !(Number(amount) > 0)}>
        Enregistrer
      </Button>
    </form>
  );
}

function RemittanceForm({ reg, onDone }: { reg: CashRegisterView; onDone: () => void }) {
  const pending = useQuery({
    queryKey: ['cash', 'remittances', reg.site.id],
    queryFn: () => apiFetch<PendingRemittance[]>(`/cash/remittances/${reg.site.id}`),
  });
  const [courierId, setCourierId] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const m = useCashMutation(
    `/cash/${reg.site.id}/operations`,
    onDone,
    'Remise du livreur encaissée',
  );
  const courier = pending.data?.find((p) => p.courier.id === courierId);
  const total =
    courier?.orders
      .filter((o) => chosen.includes(o.id))
      .reduce((s, o) => s + o.amountCollected, 0) ?? 0;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate({
          direction: 'IN',
          category: 'COURIER_REMITTANCE',
          amount: total,
          courierId,
          orderIds: chosen,
        });
      }}
    >
      <SelectField
        label="Livreur"
        value={courierId}
        onChange={(e) => {
          setCourierId(e.target.value);
          setChosen([]);
        }}
        placeholder={pending.data?.length ? 'Choisir' : 'Aucun argent en attente'}
        options={(pending.data ?? []).map((p) => ({
          value: p.courier.id,
          label: `${p.courier.fullName} · ${formatKmf(p.total)}`,
        }))}
      />
      {courier ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-semibold">Commandes concernées</legend>
          {courier.orders.map((o) => (
            <label key={o.id} className="flex min-h-touch items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-5 w-5 accent-brand-blue"
                checked={chosen.includes(o.id)}
                onChange={(e) =>
                  setChosen(e.target.checked ? [...chosen, o.id] : chosen.filter((x) => x !== o.id))
                }
              />
              {o.number} · {formatKmf(o.amountCollected)} · {formatBusinessDateTime(o.handedOverAt)}
            </label>
          ))}
        </fieldset>
      ) : null}
      <p className="text-sm">
        Total remis : <strong>{formatKmf(total)}</strong>
      </p>
      <Button type="submit" disabled={m.isPending || !chosen.length}>
        Encaisser la remise
      </Button>
    </form>
  );
}

function CloseForm({ reg, onDone }: { reg: CashRegisterView; onDone: () => void }) {
  const expected = reg.current?.expectedAmount ?? 0;
  const [counted, setCounted] = useState(String(expected));
  const [note, setNote] = useState('');
  const m = useCashMutation(`/cash/${reg.site.id}/close`, onDone, 'Caisse clôturée');
  const diff = Number(counted || 0) - expected;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate({ countedAmount: Number(counted), note: note || undefined });
      }}
    >
      <p className="text-sm">
        Montant théorique : <strong>{formatKmf(expected)}</strong>
      </p>
      <Field
        label="Montant compté (KMF)"
        type="number"
        min={0}
        value={counted}
        onChange={(e) => setCounted(e.target.value)}
      />
      <p
        className={`rounded-md px-3 py-2 text-sm font-semibold ${diff === 0 ? 'bg-status-green-bg text-status-green-fg' : 'bg-status-red-bg text-status-red-fg'}`}
        data-testid="cash-difference"
      >
        Écart : {diff > 0 ? '+' : ''}
        {formatKmf(diff)}
      </p>
      <Field label="Commentaire" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button type="submit" disabled={m.isPending}>
        Clôturer la caisse
      </Button>
    </form>
  );
}

function BankBalance({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const bank = useQuery({
    queryKey: ['cash', 'bank'],
    queryFn: () =>
      apiFetch<{ date: string; amount: number; source: string; by: string } | null>(
        '/cash/bank-balance',
      ),
  });
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState('');
  const save = useMutation({
    mutationFn: () =>
      apiFetch('/cash/bank-balance', {
        method: 'POST',
        body: JSON.stringify({ date: businessToday(), amount: Number(amount), source }),
      }),
    onSuccess: () => {
      toast('Solde bancaire enregistré', 'success');
      void queryClient.invalidateQueries({ queryKey: ['cash', 'bank'] });
      setAmount('');
      setSource('');
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  return (
    <Card className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase text-ink-muted">Solde bancaire</span>
      <span className="text-2xl font-extrabold">
        {bank.data ? formatKmf(bank.data.amount) : '—'}
      </span>
      {bank.data ? (
        <span className="text-xs text-ink-muted">
          au {formatBusinessDate(bank.data.date)} · {bank.data.source}
        </span>
      ) : null}
      {canEdit ? (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field
            label="Nouveau solde"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Field
            label="Source (relevé)"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
          <Button type="submit" size="sm" disabled={!amount || source.length < 2}>
            Enregistrer
          </Button>
        </form>
      ) : null}
    </Card>
  );
}

export default function CashPage() {
  const { state } = useAuth();
  const [panel, setPanel] = useState<Panel>(null);
  const registers = useQuery({
    queryKey: ['cash', 'registers'],
    queryFn: () => apiFetch<CashRegisterView[]>('/cash/registers'),
  });
  if (state.status !== 'authenticated') return null;
  const mod = state.user.modules.find((m) => m.key === 'cash');
  if (!mod) return <Forbidden />;
  const role = state.user.role;
  const canOpen = hasPermission(role, 'cash:open');
  const canCollect = hasPermission(role, 'cash:collect');
  const close = () => setPanel(null);
  const titles = {
    open: 'Ouvrir la caisse',
    in: 'Encaissement',
    out: 'Décaissement',
    remit: 'Remise d’argent d’un livreur',
    close: 'Clôture de caisse',
  };

  return (
    <>
      <PageHeader
        title="Caisse"
        subtitle="Une caisse par site : ouverture, mouvements, clôture avec écart"
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {registers.data?.map((reg) => (
          <Card key={reg.site.id} className="flex flex-col gap-3" data-register={reg.site.name}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold">{reg.site.name}</h2>
                <p className="text-xs text-ink-muted">{reg.site.island.name}</p>
              </div>
              <Badge tone={reg.current ? 'green' : 'blue'}>
                {reg.current ? 'Ouverte' : 'Fermée'}
              </Badge>
            </div>
            {reg.current ? (
              <>
                <div className="text-2xl font-extrabold">
                  {formatKmf(reg.current.expectedAmount)}
                </div>
                <div className="text-xs text-ink-muted">
                  Fond {formatKmf(reg.current.openingAmount)} · entrées{' '}
                  {formatKmf(reg.current.totalIn)} · sorties {formatKmf(reg.current.totalOut)}
                </div>
                {canCollect ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => setPanel({ kind: 'in', reg })}>
                      Encaisser
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPanel({ kind: 'remit', reg })}
                    >
                      Remise livreur
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPanel({ kind: 'out', reg })}
                    >
                      Décaisser
                    </Button>
                    {canOpen ? (
                      <Button
                        size="sm"
                        variant="accent"
                        onClick={() => setPanel({ kind: 'close', reg })}
                      >
                        Clôturer
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                {reg.last ? (
                  <p className="text-xs text-ink-muted">
                    Dernière clôture {formatBusinessDateTime(reg.last.closedAt!)} · écart{' '}
                    {formatKmf(reg.last.difference ?? 0)}
                  </p>
                ) : (
                  <p className="text-xs text-ink-muted">Jamais ouverte</p>
                )}
                {canOpen ? (
                  <Button size="sm" onClick={() => setPanel({ kind: 'open', reg })}>
                    Ouvrir la caisse
                  </Button>
                ) : null}
              </>
            )}
          </Card>
        ))}
        <BankBalance canEdit={role !== 'CASHIER' && hasPermission(role, 'cash:write')} />
      </div>

      {registers.data
        ?.filter((r) => r.current)
        .map((reg) => (
          <div key={reg.site.id} className="flex flex-col gap-2">
            <h2 className="text-lg font-bold">Mouvements du jour – {reg.site.name}</h2>
            <Table aria-label={`Mouvements ${reg.site.name}`}>
              <THead>
                <TR>
                  <TH>Heure</TH>
                  <TH>Nature</TH>
                  <TH>Libellé</TH>
                  <TH>Montant</TH>
                  <TH>Par</TH>
                </TR>
              </THead>
              <TBody>
                {reg.current!.operations.map((o) => (
                  <TR key={o.id}>
                    <TD className="whitespace-nowrap text-xs text-ink-muted">
                      {formatBusinessDateTime(o.at)}
                    </TD>
                    <TD>{CASH_CATEGORY_LABELS[o.category]}</TD>
                    <TD className="text-ink-muted">{o.label ?? '—'}</TD>
                    <TD
                      className={`whitespace-nowrap font-semibold ${o.direction === 'IN' ? 'text-status-green-fg' : 'text-status-red-fg'}`}
                    >
                      {o.direction === 'IN' ? '+' : '−'}
                      {formatKmf(o.amount)}
                    </TD>
                    <TD className="text-xs text-ink-muted">{o.by.fullName}</TD>
                  </TR>
                ))}
                {!reg.current!.operations.length ? (
                  <TR>
                    <TD colSpan={5} className="py-6 text-center text-ink-muted">
                      Aucun mouvement.
                    </TD>
                  </TR>
                ) : null}
              </TBody>
            </Table>
          </div>
        ))}

      <Sheet
        open={!!panel}
        onOpenChange={(o) => !o && close()}
        title={panel ? `${titles[panel.kind]} – ${panel.reg.site.name}` : ''}
      >
        {panel?.kind === 'open' ? <OpenForm reg={panel.reg} onDone={close} /> : null}
        {panel?.kind === 'in' ? (
          <OperationForm reg={panel.reg} direction="IN" onDone={close} />
        ) : null}
        {panel?.kind === 'out' ? (
          <OperationForm reg={panel.reg} direction="OUT" onDone={close} />
        ) : null}
        {panel?.kind === 'remit' ? <RemittanceForm reg={panel.reg} onDone={close} /> : null}
        {panel?.kind === 'close' ? <CloseForm reg={panel.reg} onDone={close} /> : null}
      </Sheet>
    </>
  );
}
