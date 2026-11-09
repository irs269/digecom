'use client';

import {
  DELIVERY_MODE_LABELS,
  DELIVERY_MODES,
  FAIL_REASONS,
  formatBusinessDateTime,
  formatKmf,
  formatPhone,
  ORDER_RULES,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONE,
  timelineSteps,
  formatDistance,
  mapPointUrl,
  type CourierCandidate,
  type OrderAction,
  type OrderView,
} from '@digecom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/input';
import { SelectField } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { CallUserButton } from '@/components/calls';
import { apiFetch } from '@/lib/api';
import { errorMessage } from '@/lib/queries';

/** Libellés des boutons du back-office (plus explicites que les noms d'action). */
const BUTTON_LABEL: Partial<Record<OrderAction, string>> = {
  confirm: 'Confirmer et préparer',
  prepare: 'Lancer la préparation',
  ready: 'Marquer prête',
  assign: 'Affecter un livreur de l’île',
  siteHandover: 'Confirmer le retrait au site',
  markSold: 'Client a pris',
  markRefused: 'Client a refusé',
  restock: 'Contrôler et remettre en stock',
  damaged: 'Déclarer endommagée',
  cancel: 'Annuler la commande',
  changeMode: 'Changer le mode de remise',
  returnAfterSale: 'Retour après vente',
};

/** Actions qui demandent une saisie avant envoi. */
const NEEDS_INPUT: OrderAction[] = [
  'assign',
  'cancel',
  'markRefused',
  'fail',
  'damaged',
  'changeMode',
  'returnAfterSale',
  'handover',
];

type Sender = (action: OrderAction, body?: Record<string, unknown>) => Promise<OrderView>;

/** Exécute une action avec le bon jeton (back-office ou simulateur). */
export function useOrderAction(order: OrderView, send?: Sender) {
  const toast = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, body }: { action: OrderAction; body?: Record<string, unknown> }) =>
      send
        ? send(action, body)
        : apiFetch<OrderView>(`/orders/${order.id}/actions/${action}`, {
            method: 'POST',
            body: JSON.stringify(body ?? {}),
          }),
    onSuccess: (o) => {
      toast(`${o.number} : ${ORDER_STATUS_LABELS[o.status]}`, 'success');
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      void queryClient.invalidateQueries({ queryKey: ['simulator'] });
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });
}

function ActionDialog({
  order,
  action,
  onClose,
  run,
}: {
  order: OrderView;
  action: OrderAction | null;
  onClose: () => void;
  run: (action: OrderAction, body: Record<string, unknown>) => void;
}) {
  const [reason, setReason] = useState('');
  const [courierId, setCourierId] = useState('');
  const [mode, setMode] = useState('');
  const [amount, setAmount] = useState(String(order.total));
  // Livreurs de l'île classés : disponibles d'abord, puis du plus proche au plus loin du site.
  const candidates = useQuery({
    queryKey: ['deliveries', 'candidates', order.id],
    enabled: action === 'assign',
    queryFn: () => apiFetch<CourierCandidate[]>(`/deliveries/${order.id}/candidates`),
  });
  const best = candidates.data?.find((c) => c.isAvailable && c.id !== order.courier?.id);
  useEffect(() => {
    if (action === 'assign' && !courierId && best) setCourierId(best.id);
  }, [action, best, courierId]);
  if (!action) return null;
  const body: Record<string, unknown> =
    action === 'assign'
      ? { courierId }
      : action === 'changeMode'
        ? { deliveryMode: mode }
        : action === 'handover'
          ? order.deliveryMode === 'TO_CUSTOMER'
            ? { amountCollected: Number(amount) }
            : {}
          : { reason };
  const valid =
    action === 'assign'
      ? !!courierId
      : action === 'changeMode'
        ? !!mode
        : action === 'handover'
          ? true
          : reason.trim().length >= 3;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`${BUTTON_LABEL[action] ?? ORDER_RULES[action].label} – ${order.number}`}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(action, body);
            onClose();
          }}
        >
          {action === 'assign' ? (
            <CourierPicker
              order={order}
              list={candidates.data}
              loading={candidates.isLoading}
              bestId={best?.id ?? null}
              value={courierId}
              onChange={setCourierId}
            />
          ) : action === 'changeMode' ? (
            <SelectField
              label="Nouveau mode de remise"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              placeholder="Choisir"
              options={DELIVERY_MODES.filter((m) => m !== order.deliveryMode).map((m) => ({
                value: m,
                label: DELIVERY_MODE_LABELS[m],
              }))}
            />
          ) : action === 'handover' ? (
            order.deliveryMode === 'TO_CUSTOMER' ? (
              <Field
                label="Montant encaissé (KMF)"
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            ) : (
              <p className="text-sm text-ink-muted">Le vendeur devra confirmer la réception.</p>
            )
          ) : action === 'fail' ? (
            <SelectField
              label="Motif"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Choisir"
              options={FAIL_REASONS.map((r) => ({ value: r, label: r }))}
            />
          ) : (
            <Field
              label="Motif (obligatoire)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
          <Button type="submit" disabled={!valid}>
            Valider
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function OrderActions({
  order,
  send,
  actions,
}: {
  order: OrderView;
  send?: Sender;
  actions?: OrderAction[];
}) {
  const mutation = useOrderAction(order, send);
  const [pending, setPending] = useState<OrderAction | null>(null);
  const list = actions ?? order.actions;
  if (!list.length) {
    return (
      <p className="rounded-md bg-surface px-3 py-2 text-sm text-ink-muted" data-testid="read-only">
        Ton profil peut consulter cette commande mais pas la faire avancer.
      </p>
    );
  }
  const run = (action: OrderAction, body?: Record<string, unknown>) =>
    mutation.mutate({ action, body });
  return (
    <div className="flex flex-wrap gap-2">
      {list.map((a) => (
        <Button
          key={a}
          size="sm"
          variant={
            ['cancel', 'damaged', 'markRefused', 'fail'].includes(a)
              ? 'outline'
              : a === 'changeMode'
                ? 'ghost'
                : 'primary'
          }
          disabled={mutation.isPending}
          onClick={() => (NEEDS_INPUT.includes(a) ? setPending(a) : run(a))}
        >
          {BUTTON_LABEL[a] ?? ORDER_RULES[a].label}
        </Button>
      ))}
      <ActionDialog order={order} action={pending} onClose={() => setPending(null)} run={run} />
    </div>
  );
}

/** Panneau de détail : client, vendeur, leader, livreur, frise ✓ et actions. */
export function OrderDetail({ order }: { order: OrderView }) {
  const steps = timelineSteps(order.deliveryMode);
  const reached = new Set(order.events.map((e) => e.toStatus));
  const offPath = !steps.includes(order.status);

  return (
    <div className="flex flex-col gap-5 text-sm" data-testid="order-detail">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
        <span className="text-ink-muted">{DELIVERY_MODE_LABELS[order.deliveryMode]}</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <dt className="text-ink-muted">Client</dt>
        <dd>
          <div className="font-semibold">{order.customerName}</div>
          <div className="text-ink-muted">
            {formatPhone(order.customerPhone)}
            {order.zone ? ` · ${order.zone}` : ''}
          </div>
          {order.customerAddress ? (
            <div className="text-ink-muted">{order.customerAddress}</div>
          ) : null}
        </dd>
        <dt className="text-ink-muted">Vendeur</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <span>
            {order.seller.fullName}
            {order.sellerType === 'TELECONSULTANT' ? ' (TCI)' : ''}
          </span>
          <CallUserButton userId={order.seller.id} name={order.seller.fullName} />
        </dd>
        <dt className="text-ink-muted">Leader</dt>
        <dd>{order.leader.fullName}</dd>
        <dt className="text-ink-muted">Site</dt>
        <dd>
          {order.site.name} · {order.island.name}
        </dd>
        <dt className="text-ink-muted">Livreur</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <span>
            {order.courier
              ? `${order.courier.fullName} · ${formatPhone(order.courier.phone)}`
              : '—'}
          </span>
          {order.courier ? (
            <CallUserButton userId={order.courier.id} name={order.courier.fullName} />
          ) : null}
        </dd>
        {order.createdOnBehalfBy ? (
          <>
            <dt className="text-ink-muted">Saisie par</dt>
            <dd>{order.createdOnBehalfBy.fullName}</dd>
          </>
        ) : null}
      </dl>

      <div className="rounded-md border border-surface-border">
        {order.items.map((i) => (
          <div
            key={i.id}
            className="flex items-start justify-between gap-3 border-b border-surface-border px-3 py-2 last:border-0"
          >
            <div>
              <div className="font-semibold">
                {i.quantity} × {i.product.name}
              </div>
              <div className="text-xs text-ink-muted">
                {i.sellerShare !== null ? `part vendeur ${formatKmf(i.sellerShare)} · ` : ''}
                {i.tciBonus !== null ? `prime TCI ${formatKmf(i.tciBonus)} · ` : ''}
                taxes {formatKmf(i.sellerTax + i.digecomTax)}
                {i.unitCost !== null ? ` · coût ${formatKmf(i.unitCost)}` : ''}
              </div>
            </div>
            <span className="whitespace-nowrap font-semibold">
              {formatKmf(i.unitPrice * i.quantity)}
            </span>
          </div>
        ))}
        <div className="flex justify-between px-3 py-2 font-bold">
          <span>Total</span>
          <span>{formatKmf(order.total)}</span>
        </div>
      </div>

      {order.amountCollected !== null ||
      order.failReason ||
      order.refuseReason ||
      order.cancelReason ? (
        <div className="flex flex-col gap-1 rounded-md bg-surface px-3 py-2">
          {order.amountCollected !== null ? (
            <span>
              Encaissé par le livreur : <strong>{formatKmf(order.amountCollected)}</strong>
            </span>
          ) : null}
          {order.courierFee !== null ? (
            <span>Frais de course : {formatKmf(order.courierFee)}</span>
          ) : null}
          {order.failReason ? (
            <span className="text-status-red-fg">Échec : {order.failReason}</span>
          ) : null}
          {order.refuseReason ? (
            <span className="text-status-red-fg">Refus : {order.refuseReason}</span>
          ) : null}
          {order.cancelReason ? (
            <span className="text-status-red-fg">Annulation : {order.cancelReason}</span>
          ) : null}
          {order.proofUrl ? (
            <a href={order.proofUrl} target="_blank" rel="noreferrer">
              Voir la preuve de remise
            </a>
          ) : null}
        </div>
      ) : null}

      <ol className="flex flex-col gap-1.5" aria-label="Étapes de la commande">
        {steps.map((s) => {
          const done = reached.has(s);
          const at = order.events.find((e) => e.toStatus === s);
          return (
            <li
              key={s}
              className={`flex items-center gap-2 ${done ? 'text-ink' : 'text-ink-muted'}`}
            >
              <span
                aria-hidden="true"
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${done ? 'bg-status-green-bg text-status-green-fg' : 'bg-surface text-ink-muted'}`}
              >
                {done ? '✓' : ''}
              </span>
              <span className={order.status === s ? 'font-bold' : ''}>
                {ORDER_STATUS_LABELS[s]}
              </span>
              {at ? (
                <span className="text-xs text-ink-muted">
                  {formatBusinessDateTime(at.at)}
                  {at.by ? ` · ${at.by.fullName}` : ''}
                </span>
              ) : null}
            </li>
          );
        })}
        {offPath ? (
          <li className="flex items-center gap-2 font-bold text-status-red-fg">
            <span
              aria-hidden="true"
              className="flex h-5 w-5 items-center justify-center rounded-full bg-status-red-bg text-[11px]"
            >
              !
            </span>
            {ORDER_STATUS_LABELS[order.status]}
          </li>
        ) : null}
      </ol>

      <OrderActions order={order} />
    </div>
  );
}

/** Âge d'une position : « il y a 4 min », « il y a 2 h ». */
function ago(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `il y a ${h} h` : `il y a ${Math.round(h / 24)} j`;
}

/**
 * Choix du livreur par la personne qui prépare le colis : livreurs de l'île classés par
 * disponibilité puis par distance au site de retrait (dernière position envoyée par l'application).
 */
function CourierPicker({
  order,
  list,
  loading,
  bestId,
  value,
  onChange,
}: {
  order: OrderView;
  list: CourierCandidate[] | undefined;
  loading: boolean;
  bestId: string | null;
  value: string;
  onChange: (id: string) => void;
}) {
  const site = order.site;
  const located = site.latitude !== null && site.longitude !== null;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold text-ink">
        Livreurs de {order.island.name} · distance au site {site.name}
      </legend>
      {!located ? (
        <p className="rounded-md bg-status-orange-bg p-2 text-xs text-status-orange-fg">
          Position GPS du site non renseignée : distances indisponibles. Ajoute-la dans Utilisateurs
          → Sites.
        </p>
      ) : (
        <a
          className="text-xs font-semibold text-brand-blue hover:underline"
          href={mapPointUrl({ latitude: site.latitude!, longitude: site.longitude! })}
          target="_blank"
          rel="noreferrer"
        >
          Voir le site sur Google Maps
        </a>
      )}
      {loading ? <p className="text-sm text-ink-muted">Calcul des distances…</p> : null}
      {list && list.length === 0 ? (
        <p className="text-sm text-ink-muted">Aucun livreur actif sur cette île.</p>
      ) : null}
      <ul className="flex max-h-[45vh] flex-col gap-2 overflow-y-auto" data-testid="courier-picker">
        {(list ?? []).map((c) => {
          const selected = value === c.id;
          const current = order.courier?.id === c.id;
          return (
            <li key={c.id}>
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 ${
                  selected ? 'border-brand-blue ring-2 ring-brand-blue/30' : 'border-surface-border'
                } ${c.isAvailable ? '' : 'opacity-70'}`}
              >
                <input
                  type="radio"
                  name="courier"
                  value={c.id}
                  checked={selected}
                  disabled={current}
                  onChange={() => onChange(c.id)}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                    {c.fullName}
                    {c.id === bestId ? (
                      <Badge tone="green">
                        {c.distanceKm !== null
                          ? 'Plus proche disponible'
                          : 'Disponible, sans position'}
                      </Badge>
                    ) : null}
                    {current ? <Badge tone="blue">Déjà affecté</Badge> : null}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {c.isAvailable ? 'Disponible' : 'Indisponible'} · {c.activeRuns} course(s) en
                    cours
                    {c.locationAt ? ` · position ${ago(c.locationAt)}` : ' · position inconnue'}
                    {c.locationAt && !c.locationFresh ? ' (ancienne)' : ''}
                  </span>
                </span>
                <span className="whitespace-nowrap text-sm font-bold text-ink">
                  {c.distanceKm !== null ? formatDistance(c.distanceKm) : '—'}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-ink-muted">
        Distance à vol d’oiseau entre la dernière position du livreur et le site. Le livreur est
        notifié dès l’affectation.
      </p>
    </fieldset>
  );
}
