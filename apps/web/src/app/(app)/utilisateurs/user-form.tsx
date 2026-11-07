'use client';

import {
  GLOBAL_ROLES,
  REQUIRED_LEADER_ROLE,
  ROLE_LABELS,
  ROLES,
  ROLES_WITH_SITE,
  type CreatedUserResponse,
  type Paginated,
  type Role,
  type UserView,
} from '@digecom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import { SelectField } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api';
import { errorMessage, fieldErrors, qs, useIslands, useSites } from '@/lib/queries';

interface FormState {
  fullName: string;
  phone: string;
  email: string;
  role: Role | '';
  islandId: string;
  siteId: string;
  leaderId: string;
}

function initial(user?: UserView): FormState {
  return {
    fullName: user?.fullName ?? '',
    phone: user?.phone ?? '',
    email: user?.email ?? '',
    role: user?.role ?? '',
    islandId: user?.island?.id ?? '',
    siteId: user?.site?.id ?? '',
    leaderId: user?.leader?.id ?? '',
  };
}

export function useLeaders(role: Role | undefined, islandId?: string) {
  return useQuery({
    queryKey: ['users', 'leaders', role, islandId],
    enabled: !!role,
    queryFn: () =>
      apiFetch<Paginated<UserView>>(
        `/users${qs({ role, islandId, status: 'active', pageSize: 200 })}`,
      ).then((p) => p.items),
  });
}

interface UserFormProps {
  user?: UserView;
  onCreated: (result: CreatedUserResponse) => void;
  onSaved: (user: UserView) => void;
  onReassign?: () => void;
}

/** Création ou modification d'un compte (île, site, leader selon le rôle). */
export function UserForm({ user, onCreated, onSaved, onReassign }: UserFormProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(() => initial(user));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const islands = useIslands();
  const sites = useSites();

  const role = form.role || undefined;
  const isGlobal = role ? GLOBAL_ROLES.includes(role) : false;
  const hasSite = role ? ROLES_WITH_SITE.includes(role) : false;
  const leaderRole = role ? REQUIRED_LEADER_ROLE[role] : undefined;
  const leaders = useLeaders(leaderRole, form.islandId || undefined);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (key === 'islandId') {
        next.siteId = '';
        if (!user) next.leaderId = '';
      }
      if (key === 'role') {
        const r = value as Role;
        if (GLOBAL_ROLES.includes(r)) next.islandId = '';
        if (!ROLES_WITH_SITE.includes(r)) next.siteId = '';
        if (!user) next.leaderId = '';
      }
      return next;
    });

  const mutation = useMutation({
    mutationFn: async () => {
      const base = {
        fullName: form.fullName,
        phone: form.phone,
        email: form.email || null,
        role: form.role,
        islandId: isGlobal ? null : form.islandId || null,
        siteId: hasSite ? form.siteId || null : null,
      };
      if (user) {
        return {
          kind: 'saved' as const,
          user: await apiFetch<UserView>(`/users/${user.id}`, {
            method: 'PATCH',
            body: JSON.stringify(base),
          }),
        };
      }
      const created = await apiFetch<CreatedUserResponse>('/users', {
        method: 'POST',
        body: JSON.stringify({ ...base, leaderId: leaderRole ? form.leaderId || null : null }),
      });
      return { kind: 'created' as const, created };
    },
    onSuccess: (r) => {
      setErrors({});
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['leaders'] });
      if (r.kind === 'created') onCreated(r.created);
      else {
        toast('Compte mis à jour', 'success');
        onSaved(r.user);
      }
    },
    onError: (err) => {
      setErrors(fieldErrors(err));
      toast(errorMessage(err), 'error');
    },
  });

  const islandOptions = (islands.data ?? []).map((i) => ({ value: i.id, label: i.name }));
  const siteOptions = (sites.data ?? [])
    .filter((s) => s.island.id === form.islandId)
    .map((s) => ({ value: s.id, label: s.name }));
  const leaderOptions = (leaders.data ?? []).map((l) => ({ value: l.id, label: l.fullName }));

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      aria-label={user ? 'Modifier le compte' : 'Nouveau compte'}
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <Field
        label="Nom complet"
        value={form.fullName}
        onChange={(e) => set('fullName', e.target.value)}
        error={errors.fullName}
        required
      />
      <Field
        label="Téléphone"
        type="tel"
        inputMode="tel"
        placeholder="+269 3XX XX XX"
        value={form.phone}
        onChange={(e) => set('phone', e.target.value)}
        error={errors.phone}
        required
      />
      <Field
        label="E-mail (facultatif)"
        type="email"
        value={form.email}
        onChange={(e) => set('email', e.target.value)}
        error={errors.email}
      />
      <SelectField
        label="Rôle"
        value={form.role}
        onChange={(e) => set('role', e.target.value as Role)}
        placeholder="Choisir un rôle"
        options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
        error={errors.role}
        required
      />
      {role && !isGlobal ? (
        <SelectField
          label="Île"
          value={form.islandId}
          onChange={(e) => set('islandId', e.target.value)}
          placeholder="Choisir une île"
          options={islandOptions}
          error={errors.islandId}
          disabled={!!user && !!leaderRole}
          hint={
            user && leaderRole
              ? 'L’île d’un vendeur suit celle de son leader (réaffectation).'
              : undefined
          }
        />
      ) : null}
      {hasSite ? (
        <SelectField
          label="Site (facultatif)"
          value={form.siteId}
          onChange={(e) => set('siteId', e.target.value)}
          placeholder={form.islandId ? 'Aucun site' : 'Choisis d’abord une île'}
          options={siteOptions}
          error={errors.siteId}
          disabled={!form.islandId}
        />
      ) : null}
      {leaderRole && !user ? (
        <SelectField
          label={`Leader (${ROLE_LABELS[leaderRole]})`}
          value={form.leaderId}
          onChange={(e) => set('leaderId', e.target.value)}
          placeholder={form.islandId ? 'Choisir un leader' : 'Choisis d’abord une île'}
          options={leaderOptions}
          error={errors.leaderId}
          disabled={!form.islandId}
          hint="Le vendeur ne verra que le catalogue et le stock de ce leader."
        />
      ) : null}
      {leaderRole && user ? (
        <div className="flex flex-col gap-2 rounded-md border border-surface-border p-3">
          <span className="text-sm font-semibold text-ink">Leader</span>
          <span className="text-sm text-ink">{user.leader?.fullName ?? '—'}</span>
          {errors.leaderId ? (
            <span role="alert" className="text-xs font-medium text-status-red-fg">
              {errors.leaderId}
            </span>
          ) : null}
          {onReassign ? (
            <Button variant="outline" size="sm" onClick={onReassign} className="self-start">
              Réaffecter à un autre leader
            </Button>
          ) : null}
        </div>
      ) : null}
      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? 'Enregistrement…' : user ? 'Enregistrer' : 'Créer le compte'}
      </Button>
      {!user ? (
        <p className="text-xs text-ink-muted">
          Un mot de passe temporaire sera généré ; la personne devra le changer à sa première
          connexion.
        </p>
      ) : null}
    </form>
  );
}
