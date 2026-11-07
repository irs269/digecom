'use client';

import { MODULE_KEYS, MODULE_PATHS } from '@digecom/shared';
import { notFound, useParams } from 'next/navigation';
import { PageHeader } from '@/components/app-shell';
import { Forbidden } from '@/components/forbidden';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/auth';

/**
 * Pages des modules pas encore construits : 403 si le module est interdit au profil,
 * sinon une page « bientôt ». Chaque phase remplacera ces pages par de vraies routes.
 */
export default function ModulePlaceholderPage() {
  const params = useParams<{ slug: string[] }>();
  const { state } = useAuth();
  const path = `/${params.slug[0] ?? ''}`;
  const key = MODULE_KEYS.find((k) => MODULE_PATHS[k] === path);
  if (!key) notFound();
  if (state.status !== 'authenticated') return null;

  const mod = state.user.modules.find((m) => m.key === key);
  if (!mod) return <Forbidden />;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <PageHeader title={mod.label} subtitle="Module en cours de construction" />
        {mod.access === 'L' ? <Badge tone="orange">Lecture seule</Badge> : null}
      </div>
      <Card>
        <p className="text-sm text-ink-muted">Ce module arrive dans une prochaine phase.</p>
      </Card>
    </>
  );
}
