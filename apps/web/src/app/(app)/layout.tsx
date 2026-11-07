'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AppShell } from '@/components/app-shell';
import { useAuth } from '@/lib/auth';

/** Layout authentifié : redirige vers /connexion sans session valide. */
export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (state.status === 'anonymous') router.replace('/connexion');
  }, [state.status, router]);

  if (state.status !== 'authenticated') {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status">
        <span className="text-sm font-medium text-ink-muted">Chargement…</span>
      </div>
    );
  }
  return <AppShell user={state.user}>{children}</AppShell>;
}
