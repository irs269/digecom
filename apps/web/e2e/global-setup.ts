/**
 * Préchauffe le serveur Next.js : en mode dev, chaque page est compilée à sa première visite
 * (jusqu'à ~40 s sur un montage Windows), ce qui ferait expirer les tests.
 */
const PAGES = [
  '/connexion',
  '/tableau-de-bord',
  '/utilisateurs',
  '/parametres',
  '/mot-de-passe',
  '/commandes',
  '/acces-refuse',
  '/catalogues',
  '/stock',
  '/achats',
  '/livraisons',
  '/simulateur',
  '/reglements',
  '/caisse',
  '/depenses',
  '/campagnes',
  '/prospects',
  '/ventes-tci',
];

export default async function globalSetup(): Promise<void> {
  const base = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
  for (const path of PAGES) {
    const started = Date.now();
    const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(180_000) });
    console.log(
      `Préchauffage ${path} : ${res.status} en ${Math.round((Date.now() - started) / 1000)} s`,
    );
  }
  // L'API (nest --watch) peut redémarrer au lancement : attendre qu'elle réponde.
  const deadline = Date.now() + 120_000;
  for (;;) {
    const ok = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5_000) })
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) break;
    if (Date.now() > deadline) throw new Error('API injoignable (/api/health)');
    await new Promise((r) => setTimeout(r, 1_000));
  }
  // Laisser le temps à un éventuel redémarrage différé (recompilation) de se terminer.
  await new Promise((r) => setTimeout(r, 3_000));
  while (
    !(await fetch(`${base}/api/health`)
      .then((r) => r.ok)
      .catch(() => false))
  )
    await new Promise((r) => setTimeout(r, 1_000));
}
