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
}
