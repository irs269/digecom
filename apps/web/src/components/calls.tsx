'use client';

import {
  CALL_STATUS_LABELS,
  formatBusinessDateTime,
  formatDuration,
  type CallContact,
  type CallView,
} from '@digecom/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { apiFetch } from '@/lib/api';
import { useWebCalls } from '@/lib/calls';
import { cn } from '@/lib/utils';

/** Bandeau d'appel en bas à droite, au-dessus de toutes les pages. */
export function CallOverlay({ userId }: { userId: string }) {
  const { state, accept, hangup, toggleMute } = useWebCalls();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (state.phase !== 'active') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state.phase]);
  if (state.phase === 'idle') return null;

  const c = state.call;
  const peer = c ? (c.caller.id === userId ? c.callee : c.caller) : null;
  const status =
    state.phase === 'dialing'
      ? 'Appel en cours…'
      : state.phase === 'ringing-out'
        ? 'Ça sonne…'
        : state.phase === 'ringing-in'
          ? 'Appel Dig’eCom entrant'
          : state.phase === 'connecting'
            ? 'Connexion…'
            : state.phase === 'active'
              ? formatDuration((now - (state.connectedAt ?? now)) / 1000)
              : (state.endText ?? 'Appel terminé');

  return (
    <div
      role="dialog"
      aria-live="assertive"
      aria-label="Appel Dig’eCom"
      data-testid="call-overlay"
      className="fixed bottom-4 right-4 z-[60] w-[calc(100%-32px)] max-w-sm rounded-xl bg-brand-blue-dark p-5 text-white shadow-2xl"
    >
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white text-2xl font-bold text-brand-blue">
          {(peer?.fullName ?? '?').slice(0, 1)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-lg font-bold">{peer?.fullName ?? '…'}</p>
          <p className="text-sm text-white/75">
            {c?.orderNumber ? `Commande #${c.orderNumber}` : 'Appel Dig’eCom'}
          </p>
          <p className="mt-1 font-semibold" data-testid="call-status">
            {status}
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {state.phase === 'ringing-in' ? (
          <>
            <Button variant="danger" onClick={() => void hangup()}>
              Refuser
            </Button>
            <Button
              className="bg-status-green-fg text-white hover:opacity-90"
              onClick={() => void accept()}
              data-testid="call-accept"
            >
              Décrocher
            </Button>
          </>
        ) : state.phase === 'ended' ? null : (
          <>
            {state.phase === 'active' || state.phase === 'connecting' ? (
              <Button variant="outline" onClick={toggleMute} aria-pressed={state.muted}>
                {state.muted ? 'Micro coupé' : 'Couper le micro'}
              </Button>
            ) : null}
            <Button variant="danger" onClick={() => void hangup()} data-testid="call-hangup">
              Raccrocher
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** Bouton « Appeler » vers un utilisateur (annuaire) ; masqué si la règle ne le permet pas. */
export function CallUserButton({
  userId,
  name,
  size = 'sm',
}: {
  userId: string;
  name: string;
  size?: 'sm' | 'md';
}) {
  const { call, state, available } = useWebCalls();
  const contacts = useCallContacts();
  const allowed = contacts.data?.some((c) => c.id === userId);
  if (!available || !allowed) return null;
  const busy = state.phase !== 'idle' && state.phase !== 'ended';
  return (
    <Button
      size={size}
      variant="accent"
      disabled={busy}
      onClick={() => void call({ userId })}
      aria-label={`Appeler ${name} par Dig’eCom`}
      data-testid="call-user"
    >
      Appeler
    </Button>
  );
}

export function useCallContacts() {
  return useQuery({
    queryKey: ['calls', 'contacts'],
    queryFn: () => apiFetch<CallContact[]>('/calls/contacts'),
    staleTime: 5 * 60_000,
  });
}

/** En-tête : annuaire d'appel et derniers appels. */
export function CallsButton({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const { call, available, state } = useWebCalls();
  const contacts = useCallContacts();
  const recent = useQuery({
    queryKey: ['calls', 'mine'],
    queryFn: () => apiFetch<CallView[]>('/calls/mine'),
    enabled: open,
  });
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (contacts.data ?? []).filter(
      (c) =>
        !term ||
        c.fullName.toLowerCase().includes(term) ||
        c.roleLabel.toLowerCase().includes(term) ||
        (c.island ?? '').toLowerCase().includes(term),
    );
  }, [contacts.data, q]);
  if (!contacts.data?.length) return null;
  const busy = state.phase !== 'idle' && state.phase !== 'ended';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-touch items-center gap-2 rounded-md border border-surface-border bg-white px-3 text-sm font-semibold text-ink hover:bg-surface"
        data-testid="calls-button"
      >
        <span aria-hidden="true">📞</span> Appels
      </button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Appels Dig’eCom"
        description="Appel par Internet, numéro masqué, non enregistré."
      >
        {!available ? (
          <p className="rounded-md bg-status-orange-bg p-3 text-sm text-status-orange-fg">
            Ce navigateur ne permet pas les appels (micro ou WebRTC indisponible).
          </p>
        ) : null}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher un nom, un rôle, une île"
          className="min-h-touch rounded-md border border-surface-border px-3 text-sm"
          aria-label="Rechercher un contact"
        />
        <ul className="flex flex-col divide-y divide-surface-border" data-testid="call-contacts">
          {list.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink">{c.fullName}</p>
                <p className="text-xs text-ink-muted">
                  {c.roleLabel}
                  {c.island ? ` · ${c.island}` : ''}
                </p>
              </div>
              <Button
                size="sm"
                variant="accent"
                disabled={!available || busy}
                onClick={() => {
                  setOpen(false);
                  void call({ userId: c.id });
                }}
              >
                Appeler
              </Button>
            </li>
          ))}
        </ul>
        {recent.data?.length ? (
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-bold text-ink">Derniers appels</h3>
            {recent.data.slice(0, 15).map((c) => {
              const out = c.caller.id === userId;
              const missed = ['MISSED', 'DECLINED', 'CANCELLED', 'FAILED'].includes(c.status);
              return (
                <div key={c.id} className="flex justify-between gap-2 text-sm">
                  <span className="truncate">
                    {out ? `↗ ${c.callee.fullName}` : `↙ ${c.caller.fullName}`}
                    <span className="text-ink-muted"> · {formatBusinessDateTime(c.createdAt)}</span>
                  </span>
                  <span className={cn(missed ? 'text-status-red-fg' : 'text-status-green-fg')}>
                    {c.durationSeconds !== null
                      ? formatDuration(c.durationSeconds)
                      : CALL_STATUS_LABELS[c.status]}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
      </Sheet>
    </>
  );
}
