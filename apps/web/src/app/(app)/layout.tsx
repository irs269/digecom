'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AppShell } from '@/components/app-shell';
import { useAuth } from '@/lib/auth';

/** Layout authentifié : redirige vers /connexion sans session valide. */
export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();
  const router = useRouter();

  const mustChange = state.status === 'authenticated' && state.user.mustChangePassword;
  useEffect(() => {
    if (state.status === 'anonymous') router.replace('/connexion');
    // Mot de passe temporaire : rien d'autre n'est accessible (l'API le refuse aussi).
    else if (mustChange) router.replace('/mot-de-passe');
  }, [state.status, mustChange, router]);

  if (state.status !== 'authenticated' || mustChange) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status">
        <span className="text-sm font-medium text-ink-muted">Chargement…</span>
      </div>
    );
  }
  return <AppShell user={state.user}>{children}</AppShell>;
}
