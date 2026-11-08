'use client';

import { ISLAND_CODES, ISLAND_LABELS, type IslandCode, type MeResponse } from '@digecom/shared';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { useLiveUpdates } from '@/lib/live';
import { NotificationBell } from './notification-bell';
import { cn } from '@/lib/utils';

export type IslandFilter = IslandCode | 'all';

const IslandFilterContext = createContext<IslandFilter>('all');

/** Filtre île courant (rôles globaux) ou île du périmètre (rôles d'île). */
export function useIslandFilter(): IslandFilter {
  return useContext(IslandFilterContext);
}

function Sidebar({ user, onLogout }: { user: MeResponse; onLogout: () => void }) {
  const pathname = usePathname();
  return (
    <aside className="flex w-full flex-col gap-6 bg-brand-blue px-4 py-6 text-white desk:sticky desk:top-0 desk:h-screen desk:w-[260px] desk:shrink-0 desk:overflow-y-auto">
      <div className="flex items-center gap-3 px-2">
        <Image
          src="/logo.jpg"
          alt="Logo Dig'eCom Agency"
          width={50}
          height={50}
          className="h-[50px] w-[50px] rounded-[14px] border-2 border-white object-cover"
        />
        <div className="flex flex-col">
          <span className="text-xl font-extrabold tracking-tight">Dig&apos;eCom</span>
          <span className="text-xs text-brand-blue-soft">Back-office</span>
        </div>
      </div>

      <nav aria-label="Menu principal">
        {user.modules.length === 0 ? (
          <p className="rounded-md bg-white/10 px-3 py-3 text-sm text-brand-blue-soft">
            Ce profil utilise l&apos;application mobile Dig&apos;eCom.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2 desk:grid-cols-1" data-testid="menu">
            {user.modules.map((m) => {
              const active = pathname === m.path || pathname.startsWith(`${m.path}/`);
              return (
                <li key={m.key}>
                  <Link
                    href={m.path}
                    aria-current={active ? 'page' : undefined}
                    data-module={m.key}
                    className={cn(
                      'flex min-h-touch items-center justify-between gap-2 rounded-md px-3 text-sm font-medium text-white hover:bg-white/10 hover:text-white',
                      active &&
                        'bg-white font-semibold text-brand-blue hover:bg-white hover:text-brand-blue',
                    )}
                  >
                    <span>{m.label}</span>
                    {m.access === 'L' ? (
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide',
                          active
                            ? 'bg-status-orange-bg text-status-orange-fg'
                            : 'bg-white/15 text-white',
                        )}
                      >
                        LECTURE
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      <div className="mt-auto flex flex-col gap-3 rounded-lg bg-white/10 p-3">
        <div className="flex flex-col">
          <span className="text-xs text-brand-blue-soft">Connecté en tant que</span>
          <span className="text-sm font-semibold" data-testid="current-user">
            {user.fullName}
          </span>
          <span className="text-xs text-brand-blue-soft">
            {user.roleLabel}
            {user.island ? ` · ${user.island.name}` : ''}
          </span>
        </div>
        {user.role === 'ADMIN' ? (
          <Link
            href="/simulateur"
            className="flex min-h-touch items-center text-sm font-semibold text-white underline-offset-2 hover:text-white hover:underline"
          >
            Simulateur livreur / vendeur (dev)
          </Link>
        ) : null}
        <Link
          href="/mot-de-passe"
          className="flex min-h-touch items-center text-sm font-semibold text-white underline-offset-2 hover:text-white hover:underline"
        >
          Changer mon mot de passe
        </Link>
        <Button variant="accent" size="sm" onClick={onLogout}>
          Se déconnecter
        </Button>
      </div>
    </aside>
  );
}

interface PageHeaderProps {
  title: string;
  subtitle?: string;
}

export function PageHeader({ title, subtitle }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-2xl font-extrabold tracking-tight text-ink">{title}</h1>
      {subtitle ? <p className="text-sm text-ink-muted">{subtitle}</p> : null}
    </div>
  );
}

function ScopeBar({
  user,
  island,
  onChange,
}: {
  user: MeResponse;
  island: IslandFilter;
  onChange: (value: IslandFilter) => void;
}) {
  if (user.scope === 'GLOBAL') {
    return (
      <div className="flex items-center gap-2">
        <label htmlFor="island-filter" className="text-sm font-semibold text-ink-muted">
          Île
        </label>
        <select
          id="island-filter"
          value={island}
          onChange={(e) => onChange(e.target.value as IslandFilter)}
          className="min-h-touch rounded-md border border-surface-border bg-white px-3 text-sm font-medium text-ink"
        >
          <option value="all">Toutes les îles</option>
          {ISLAND_CODES.map((code) => (
            <option key={code} value={code}>
              {ISLAND_LABELS[code]}
            </option>
          ))}
        </select>
      </div>
    );
  }
  const scopeLabel = user.island
    ? `Périmètre : ${user.island.name}${user.site ? ` · ${user.site.name}` : ''}`
    : 'Périmètre : mon équipe';
  return (
    <span className="rounded-full bg-status-blue-bg px-3 py-1.5 text-sm font-semibold text-status-blue-fg">
      {scopeLabel}
    </span>
  );
}

export function AppShell({ user, children }: { user: MeResponse; children: React.ReactNode }) {
  const { logout } = useAuth();
  useLiveUpdates(true);
  const [island, setIsland] = useState<IslandFilter>(
    user.scope === 'GLOBAL' ? 'all' : (user.island?.code ?? 'all'),
  );

  return (
    <IslandFilterContext.Provider value={island}>
      <div className="flex min-h-screen flex-col desk:flex-row">
        <Sidebar user={user} onLogout={() => void logout()} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex flex-wrap items-center justify-end gap-3 border-b border-surface-border bg-white px-4 py-3 desk:px-8">
            <ScopeBar user={user} island={island} onChange={setIsland} />
            <NotificationBell />
          </header>
          <main className="flex flex-1 flex-col gap-6 px-4 py-6 desk:px-8">{children}</main>
        </div>
      </div>
    </IslandFilterContext.Provider>
  );
}
