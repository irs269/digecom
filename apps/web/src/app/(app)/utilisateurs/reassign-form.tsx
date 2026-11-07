'use client';

import {
  formatBusinessDateTime,
  REQUIRED_LEADER_ROLE,
  ROLE_LABELS,
  type TeamAssignmentView,
  type UserView,
} from '@digecom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api';
import { errorMessage, fieldErrors } from '@/lib/queries';
import { useLeaders } from './user-form';

export function TeamHistory({ userId }: { userId: string }) {
  const history = useQuery({
    queryKey: ['users', userId, 'team-history'],
    queryFn: () => apiFetch<TeamAssignmentView[]>(`/users/${userId}/team-history`),
  });
  if (!history.data?.length) {
    return <p className="text-sm text-ink-muted">Aucun rattachement enregistré.</p>;
  }
  return (
    <ol
      className="flex flex-col gap-2"
      aria-label="Historique des rattachements"
      data-testid="team-history"
    >
      {history.data.map((h) => (
        <li key={h.id} className="rounded-md border border-surface-border p-3 text-sm">
          <div className="font-semibold text-ink">
            {h.fromLeader ? `${h.fromLeader.fullName} → ` : ''}
            {h.toLeader.fullName}
          </div>
          <div className="text-ink-muted">{h.reason}</div>
          <div className="text-xs text-ink-muted">
            {formatBusinessDateTime(h.at)} · par {h.by.fullName}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Réaffectation d'un vendeur à un autre leader (motif obligatoire, historisée). */
export function ReassignForm({ user, onDone }: { user: UserView; onDone: (u: UserView) => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const leaderRole = REQUIRED_LEADER_ROLE[user.role];
  const leaders = useLeaders(leaderRole);
  const [leaderId, setLeaderId] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<UserView>(`/users/${user.id}/reassign`, {
        method: 'POST',
        body: JSON.stringify({ leaderId, reason }),
      }),
    onSuccess: (updated) => {
      toast(`${updated.fullName} rejoint l’équipe de ${updated.leader?.fullName}`, 'success');
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['leaders'] });
      void queryClient.invalidateQueries({ queryKey: ['team-assignments'] });
      onDone(updated);
    },
    onError: (err) => {
      setErrors(fieldErrors(err));
      toast(errorMessage(err), 'error');
    },
  });

  if (!leaderRole) return null;
  const options = (leaders.data ?? [])
    .filter((l) => l.id !== user.leader?.id)
    .map((l) => ({ value: l.id, label: `${l.fullName} · ${l.island?.name ?? '—'}` }));
  const target = leaders.data?.find((l) => l.id === leaderId);

  return (
    <form
      noValidate
      aria-label="Réaffectation"
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <p className="text-sm text-ink-muted">
        Leader actuel : <strong className="text-ink">{user.leader?.fullName ?? '—'}</strong>
      </p>
      <SelectField
        label={`Nouveau leader (${ROLE_LABELS[leaderRole]})`}
        value={leaderId}
        onChange={(e) => setLeaderId(e.target.value)}
        placeholder="Choisir un leader"
        options={options}
        error={errors.leaderId}
      />
      {target && target.island?.id !== user.island?.id ? (
        <p className="rounded-md bg-status-orange-bg px-3 py-2 text-sm text-status-orange-fg">
          {user.fullName} passera sur l’île {target.island?.name} (même île que son leader).
        </p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="reassign-reason" className="text-sm font-semibold text-ink">
          Motif
        </label>
        <textarea
          id="reassign-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          aria-invalid={errors.reason ? true : undefined}
          className="rounded-md border border-surface-border px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
        />
        {errors.reason ? (
          <span role="alert" className="text-xs font-medium text-status-red-fg">
            {errors.reason}
          </span>
        ) : null}
      </div>
      <Button type="submit" disabled={mutation.isPending || !leaderId}>
        {mutation.isPending ? 'Réaffectation…' : 'Réaffecter'}
      </Button>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-bold text-ink">Historique</h3>
        <TeamHistory userId={user.id} />
      </div>
    </form>
  );
}
