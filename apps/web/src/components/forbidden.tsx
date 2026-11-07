import Link from 'next/link';
import { Card } from '@/components/ui/card';

export function Forbidden() {
  return (
    <Card
      className="mx-auto flex max-w-lg flex-col items-center gap-3 py-10 text-center"
      data-testid="forbidden"
    >
      <span className="rounded-full bg-status-red-bg px-3 py-1 text-xs font-bold text-status-red-fg">
        403
      </span>
      <h1 className="text-xl font-extrabold text-ink">
        Ce module n&apos;est pas accessible à ton profil
      </h1>
      <p className="text-sm text-ink-muted">
        Si tu penses que c&apos;est une erreur, contacte l&apos;administrateur.
      </p>
      <Link href="/tableau-de-bord" className="text-sm font-semibold">
        Retour au tableau de bord
      </Link>
    </Card>
  );
}
