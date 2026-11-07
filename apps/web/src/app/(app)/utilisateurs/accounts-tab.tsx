'use client';

import {
  formatBusinessDateTime,
  formatPhone,
  REQUIRED_LEADER_ROLE,
  ROLE_LABELS,
  ROLES,
  type CreatedUserResponse,
  type Paginated,
  type Role,
  type UserView,
} from '@digecom/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api';
import { errorMessage, qs, useIslands } from '@/lib/queries';
import { ReassignForm } from './reassign-form';
import { UserForm } from './user-form';

const PAGE_SIZE = 20;

export function userScope(u: UserView): string {
  const parts = [u.island?.name ?? 'Toutes les îles'];
  if (u.site) parts.push(u.site.name);
  if (u.leader) parts.push(`équipe ${u.leader.fullName}`);
  if (u.teamSize) parts.push(`${u.teamSize} membre${u.teamSize > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

export function UserStatus({ user }: { user: UserView }) {
  if (!user.isActive) return <Badge tone="red">Désactivé</Badge>;
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    return <Badge tone="orange">Verrouillé</Badge>;
  }
  if (user.mustChangePassword) return <Badge tone="orange">Mot de passe temporaire</Badge>;
  return <Badge tone="green">Actif</Badge>;
}

type Panel =
  | { mode: 'create' }
  | { mode: 'edit'; user: UserView }
  | { mode: 'reassign'; user: UserView }
  | null;

function TemporaryPasswordDialog({
  result,
  onClose,
}: {
  result: { title: string; user: UserView; password: string } | null;
  onClose: () => void;
}) {
  const toast = useToast();
  return (
    <Dialog open={!!result} onOpenChange={(o) => !o && onClose()}>
      {result ? (
        <DialogContent
          title={result.title}
          description="Communique ce mot de passe à la personne. Il ne sera plus affiché."
        >
          <div className="flex flex-col gap-1 rounded-md bg-surface p-4">
            <span className="text-sm text-ink-muted">
              {result.user.fullName} · {formatPhone(result.user.phone)}
            </span>
            <span
              className="font-mono text-xl font-bold tracking-wider text-ink"
              data-testid="temporary-password"
            >
              {result.password}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(result.password)
                  .then(() => toast('Mot de passe copié', 'success'))
              }
            >
              Copier
            </Button>
            <Button onClick={onClose}>J’ai noté le mot de passe</Button>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

export function AccountsTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const islands = useIslands();
  const [q, setQ] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [islandId, setIslandId] = useState('');
  const [status, setStatus] = useState<'' | 'active' | 'inactive'>('');
  const [page, setPage] = useState(1);
  const [panel, setPanel] = useState<Panel>(null);
  const [secret, setSecret] = useState<{ title: string; user: UserView; password: string } | null>(
    null,
  );

  const list = useQuery({
    queryKey: ['users', 'list', { q, role, islandId, status, page }],
    queryFn: () =>
      apiFetch<Paginated<UserView>>(
        `/users${qs({ q, role, islandId, status, page, pageSize: PAGE_SIZE })}`,
      ),
    placeholderData: keepPreviousData,
  });

  const action = useMutation({
    mutationFn: ({
      user,
      op,
    }: {
      user: UserView;
      op: 'deactivate' | 'reactivate' | 'reset-password';
    }) => apiFetch<UserView | CreatedUserResponse>(`/users/${user.id}/${op}`, { method: 'POST' }),
    onSuccess: (result, { user, op }) => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      if (op === 'reset-password') {
        const r = result as CreatedUserResponse;
        setSecret({
          title: 'Mot de passe réinitialisé',
          user: r.user,
          password: r.temporaryPassword,
        });
        setPanel(null);
      } else {
        const u = result as UserView;
        toast(
          op === 'deactivate' ? `${user.fullName} est désactivé` : `${user.fullName} est réactivé`,
          'success',
        );
        setPanel((p) => (p && p.mode !== 'create' ? { ...p, user: u } : p));
      }
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  const resetFilters = (fn: () => void) => {
    fn();
    setPage(1);
  };
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
          <label htmlFor="users-search" className="text-sm font-semibold text-ink">
            Recherche
          </label>
          <Input
            id="users-search"
            type="search"
            placeholder="Nom ou téléphone"
            value={q}
            onChange={(e) => resetFilters(() => setQ(e.target.value))}
          />
        </div>
        <FilterSelect
          id="users-role"
          label="Rôle"
          value={role}
          onChange={(v) => resetFilters(() => setRole(v as Role | ''))}
          options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
          all="Tous les rôles"
        />
        <FilterSelect
          id="users-island"
          label="Île"
          value={islandId}
          onChange={(v) => resetFilters(() => setIslandId(v))}
          options={(islands.data ?? []).map((i) => ({ value: i.id, label: i.name }))}
          all="Toutes les îles"
        />
        <FilterSelect
          id="users-status"
          label="Statut"
          value={status}
          onChange={(v) => resetFilters(() => setStatus(v as typeof status))}
          options={[
            { value: 'active', label: 'Actifs' },
            { value: 'inactive', label: 'Désactivés' },
          ]}
          all="Tous"
        />
        <Button variant="accent" onClick={() => setPanel({ mode: 'create' })}>
          + Nouveau compte
        </Button>
      </div>

      <Table aria-label="Comptes">
        <THead>
          <TR>
            <TH>Nom</TH>
            <TH>Rôle</TH>
            <TH>Périmètre</TH>
            <TH>Dernière connexion</TH>
            <TH>Statut</TH>
            <TH>
              <span className="sr-only">Actions</span>
            </TH>
          </TR>
        </THead>
        <TBody>
          {data?.items.map((u) => (
            <TR key={u.id}>
              <TD>
                <div className="font-semibold">{u.fullName}</div>
                <div className="text-xs text-ink-muted">{formatPhone(u.phone)}</div>
              </TD>
              <TD>{ROLE_LABELS[u.role]}</TD>
              <TD className="text-ink-muted">{userScope(u)}</TD>
              <TD className="whitespace-nowrap text-ink-muted">
                {u.lastLoginAt ? formatBusinessDateTime(u.lastLoginAt) : 'Jamais'}
              </TD>
              <TD>
                <UserStatus user={u} />
              </TD>
              <TD className="text-right">
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Gérer le compte de ${u.fullName}`}
                  onClick={() => setPanel({ mode: 'edit', user: u })}
                >
                  Gérer
                </Button>
              </TD>
            </TR>
          ))}
          {data && data.items.length === 0 ? (
            <TR>
              <TD colSpan={6} className="py-8 text-center text-ink-muted">
                Aucun compte ne correspond à ces filtres.
              </TD>
            </TR>
          ) : null}
        </TBody>
      </Table>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-ink-muted">
        <span>{data ? `${data.total} compte${data.total > 1 ? 's' : ''}` : 'Chargement…'}</span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Précédent
          </Button>
          <span>
            Page {page} / {pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Suivant
          </Button>
        </div>
      </div>

      <Sheet
        open={panel?.mode === 'create'}
        onOpenChange={(o) => !o && setPanel(null)}
        title="Nouveau compte"
        description="Nom, téléphone, rôle et rattachements."
      >
        {panel?.mode === 'create' ? (
          <UserForm
            onCreated={(r) => {
              setPanel(null);
              setSecret({ title: 'Compte créé', user: r.user, password: r.temporaryPassword });
            }}
            onSaved={() => setPanel(null)}
          />
        ) : null}
      </Sheet>

      <Sheet
        open={panel?.mode === 'edit'}
        onOpenChange={(o) => !o && setPanel(null)}
        title={panel?.mode === 'edit' ? panel.user.fullName : 'Compte'}
        description={panel?.mode === 'edit' ? ROLE_LABELS[panel.user.role] : undefined}
      >
        {panel?.mode === 'edit' ? (
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-2">
              <UserStatus user={panel.user} />
              <span className="text-xs text-ink-muted">
                Dernière connexion :{' '}
                {panel.user.lastLoginAt ? formatBusinessDateTime(panel.user.lastLoginAt) : 'jamais'}
              </span>
            </div>
            <UserForm
              key={panel.user.id + panel.user.isActive}
              user={panel.user}
              onCreated={() => undefined}
              onSaved={(u) => setPanel({ mode: 'edit', user: u })}
              onReassign={
                REQUIRED_LEADER_ROLE[panel.user.role]
                  ? () => setPanel({ mode: 'reassign', user: panel.user })
                  : undefined
              }
            />
            <div className="flex flex-col gap-2 border-t border-surface-border pt-4">
              <h3 className="text-sm font-bold text-ink">Actions</h3>
              <Button
                variant="outline"
                disabled={action.isPending}
                onClick={() => action.mutate({ user: panel.user, op: 'reset-password' })}
              >
                Réinitialiser le mot de passe
              </Button>
              {panel.user.isActive ? (
                <Button
                  variant="danger"
                  disabled={action.isPending}
                  onClick={() => action.mutate({ user: panel.user, op: 'deactivate' })}
                >
                  Désactiver le compte
                </Button>
              ) : (
                <Button
                  disabled={action.isPending}
                  onClick={() => action.mutate({ user: panel.user, op: 'reactivate' })}
                >
                  Réactiver le compte
                </Button>
              )}
              <p className="text-xs text-ink-muted">
                Un compte désactivé ne peut plus se connecter ; ses sessions sont fermées. Rien
                n’est supprimé.
              </p>
            </div>
          </div>
        ) : null}
      </Sheet>

      <Sheet
        open={panel?.mode === 'reassign'}
        onOpenChange={(o) => !o && setPanel(null)}
        title={panel?.mode === 'reassign' ? `Réaffecter ${panel.user.fullName}` : 'Réaffecter'}
        description="Le changement est historisé et journalisé."
      >
        {panel?.mode === 'reassign' ? (
          <ReassignForm user={panel.user} onDone={(u) => setPanel({ mode: 'edit', user: u })} />
        ) : null}
      </Sheet>

      <TemporaryPasswordDialog result={secret} onClose={() => setSecret(null)} />
    </>
  );
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
  all,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  all: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-touch rounded-md border border-surface-border bg-white px-3 text-sm text-ink"
      >
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
