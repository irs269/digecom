'use client';

import {
  AUDIT_ACTION_LABELS,
  formatBusinessDateTime,
  ROLE_LABELS,
  type AccessLevel,
  type AuditEntryView,
  type LeaderTeamView,
  type ModuleKey,
  type ModuleMatrix,
  type Paginated,
  type Role,
  type ScopeKind,
  type TeamAssignmentView,
  type UserView,
} from '@digecom/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { apiFetch } from '@/lib/api';
import { qs } from '@/lib/queries';
import { ReassignForm } from './reassign-form';

// --- Matrice des droits -------------------------------------------------------

interface MatrixResponse {
  modules: { key: ModuleKey; label: string }[];
  roles: { role: Role; label: string; scope: ScopeKind }[];
  permissions: Record<Role, ModuleMatrix>;
}

/** Rôles du back-office affichés dans la matrice (vendeurs et livreurs : mobile). */
const WEB_ROLES: Role[] = [
  'ADMIN',
  'FINANCE_MANAGER',
  'ACCOUNTANT',
  'ACCOUNTANT_ASSISTANT',
  'CASHIER',
  'STOCK_MANAGER',
  'LOGISTICS_ASSISTANT',
  'LEADER_SENIOR',
  'LEADER_JUNIOR',
  'TELECONSULTANT',
];

function AccessBadge({ level }: { level: AccessLevel | undefined }) {
  if (level === 'C') return <Badge tone="green">Complet</Badge>;
  if (level === 'L') return <Badge tone="blue">Lecture</Badge>;
  return (
    <span className="text-ink-muted" aria-label="Aucun accès">
      —
    </span>
  );
}

export function MatrixTab() {
  const matrix = useQuery({
    queryKey: ['permissions', 'matrix'],
    queryFn: () => apiFetch<MatrixResponse>('/permissions/matrix'),
    staleTime: Infinity,
  });
  const m = matrix.data;
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink">Matrice des droits d’accès</h2>
          <p className="text-sm text-ink-muted">
            Ce que chaque rôle voit et peut faire, module par module. Générée depuis la même source
            que les contrôles de l’API.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="green">Complet = consulter et agir</Badge>
          <Badge tone="blue">Lecture = consulter</Badge>
        </div>
      </div>
      {m ? (
        <Table aria-label="Matrice des droits" data-testid="permissions-matrix">
          <THead>
            <TR>
              <TH>Module</TH>
              {WEB_ROLES.map((r) => (
                <TH key={r} className="whitespace-nowrap">
                  {ROLE_LABELS[r]}
                </TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {m.modules.map((mod) => (
              <TR key={mod.key}>
                <TD className="whitespace-nowrap font-semibold">{mod.label}</TD>
                {WEB_ROLES.map((r) => (
                  <TD key={r}>
                    <AccessBadge level={m.permissions[r][mod.key]} />
                  </TD>
                ))}
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <p className="text-sm text-ink-muted">Chargement…</p>
      )}
      <p className="text-xs text-ink-muted">
        Les rôles de terrain (caissier, stock, logistique) ne voient que leur île. Un leader ne voit
        que son équipe. E-commerçants et livreurs utilisent l’application mobile.
      </p>
    </Card>
  );
}

// --- Équipes ---------------------------------------------------------------------

export function TeamsTab() {
  const [reassign, setReassign] = useState<UserView | null>(null);
  const teams = useQuery({
    queryKey: ['users', 'leaders-teams'],
    queryFn: () => apiFetch<LeaderTeamView[]>('/leaders'),
  });
  const history = useQuery({
    queryKey: ['users', 'team-assignments'],
    queryFn: () => apiFetch<TeamAssignmentView[]>('/team-assignments'),
  });

  return (
    <>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {teams.data?.map(({ leader, members }) => (
          <Card key={leader.id} className="flex flex-col gap-3" data-testid={`team-${leader.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-ink">{leader.fullName}</h3>
                <p className="text-xs text-ink-muted">
                  {ROLE_LABELS[leader.role]} · {leader.island?.name ?? '—'}
                </p>
              </div>
              <Badge tone={leader.role === 'LEADER_SENIOR' ? 'blue' : 'orange'}>
                {members.length}{' '}
                {leader.role === 'LEADER_SENIOR' ? 'e-commerçant' : 'téléconseiller'}
                {members.length > 1 ? 's' : ''}
              </Badge>
            </div>
            {members.length ? (
              <ul className="flex flex-col divide-y divide-surface-border">
                {members.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="text-sm">
                      {m.fullName}
                      {!m.isActive ? (
                        <span className="ml-2 text-xs text-status-red-fg">(désactivé)</span>
                      ) : null}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Réaffecter ${m.fullName}`}
                      onClick={() => setReassign(m)}
                    >
                      Réaffecter
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">Aucun membre.</p>
            )}
          </Card>
        ))}
      </div>

      <Card className="flex flex-col gap-3">
        <h2 className="text-lg font-bold text-ink">Historique des réaffectations</h2>
        <Table aria-label="Historique des réaffectations">
          <THead>
            <TR>
              <TH>Date</TH>
              <TH>Vendeur</TH>
              <TH>Ancien leader</TH>
              <TH>Nouveau leader</TH>
              <TH>Motif</TH>
              <TH>Par</TH>
            </TR>
          </THead>
          <TBody>
            {history.data?.map((h) => (
              <TR key={h.id}>
                <TD className="whitespace-nowrap text-ink-muted">{formatBusinessDateTime(h.at)}</TD>
                <TD className="font-semibold">{h.user.fullName}</TD>
                <TD>{h.fromLeader?.fullName ?? '—'}</TD>
                <TD>{h.toLeader.fullName}</TD>
                <TD className="text-ink-muted">{h.reason}</TD>
                <TD className="text-ink-muted">{h.by.fullName}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      <Sheet
        open={!!reassign}
        onOpenChange={(o) => !o && setReassign(null)}
        title={reassign ? `Réaffecter ${reassign.fullName}` : 'Réaffecter'}
        description="Le changement est historisé et journalisé."
      >
        {reassign ? <ReassignForm user={reassign} onDone={() => setReassign(null)} /> : null}
      </Sheet>
    </>
  );
}

// --- Journal d'activité ----------------------------------------------------------

const JOURNAL_PAGE = 25;

function describe(e: AuditEntryView): string {
  return AUDIT_ACTION_LABELS[e.action] ?? e.action;
}

export function JournalTab() {
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const journal = useQuery({
    queryKey: ['audit', { action, entity, from, to, page }],
    queryFn: () =>
      apiFetch<Paginated<AuditEntryView>>(
        `/audit${qs({ action, entity, from, to, page, pageSize: JOURNAL_PAGE })}`,
      ),
    placeholderData: keepPreviousData,
  });
  const data = journal.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / JOURNAL_PAGE)) : 1;
  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <LabeledInput
          id="j-action"
          label="Action"
          value={action}
          placeholder="ex. USER_"
          onChange={(v) => reset(() => setAction(v))}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="j-entity" className="text-sm font-semibold text-ink">
            Entité
          </label>
          <select
            id="j-entity"
            value={entity}
            onChange={(e) => reset(() => setEntity(e.target.value))}
            className="min-h-touch rounded-md border border-surface-border bg-white px-3 text-sm"
          >
            <option value="">Toutes</option>
            <option value="User">Comptes</option>
            <option value="Site">Sites</option>
            <option value="Setting">Paramètres</option>
          </select>
        </div>
        <LabeledInput
          id="j-from"
          label="Du"
          type="date"
          value={from}
          onChange={(v) => reset(() => setFrom(v))}
        />
        <LabeledInput
          id="j-to"
          label="Au"
          type="date"
          value={to}
          onChange={(v) => reset(() => setTo(v))}
        />
      </div>
      <Table aria-label="Journal d'activité">
        <THead>
          <TR>
            <TH>Date</TH>
            <TH>Qui</TH>
            <TH>Action</TH>
            <TH>Objet</TH>
            <TH>IP</TH>
          </TR>
        </THead>
        <TBody>
          {data?.items.map((e) => (
            <TR key={e.id}>
              <TD className="whitespace-nowrap text-ink-muted">{formatBusinessDateTime(e.at)}</TD>
              <TD>
                {e.actor ? (
                  <>
                    <div className="font-semibold">{e.actor.fullName}</div>
                    <div className="text-xs text-ink-muted">{ROLE_LABELS[e.actor.role]}</div>
                  </>
                ) : (
                  <span className="text-ink-muted">Inconnu</span>
                )}
              </TD>
              <TD>{describe(e)}</TD>
              <TD className="text-ink-muted">
                {e.entity}
                {e.entityId ? ` · ${e.entityId.slice(0, 24)}` : ''}
              </TD>
              <TD className="text-xs text-ink-muted">{e.ip ?? '—'}</TD>
            </TR>
          ))}
          {data && data.items.length === 0 ? (
            <TR>
              <TD colSpan={5} className="py-8 text-center text-ink-muted">
                Aucune activité pour ces filtres.
              </TD>
            </TR>
          ) : null}
        </TBody>
      </Table>
      <div className="flex items-center justify-end gap-2 text-sm text-ink-muted">
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
    </>
  );
}

function LabeledInput({
  id,
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
