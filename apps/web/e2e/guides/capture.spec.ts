/**
 * Captures d'écran des guides utilisateur (docs/guides/img), sur les données de démonstration :
 *   GUIDES=1 docker compose --profile e2e run --rm e2e sh -c 'corepack enable && pnpm --filter web exec playwright test e2e/guides'
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Digecom2026!';
const OUT = join(__dirname, '..', '..', '..', '..', 'docs', 'guides', 'img');

const ROLES: { slug: string; phone: string; pages: [string, string][] }[] = [
  {
    slug: 'administrateur',
    phone: '+269 330 00 01',
    pages: [
      ['tableau-de-bord', '/tableau-de-bord'],
      ['utilisateurs', '/utilisateurs'],
      ['parametres', '/parametres'],
    ],
  },
  {
    slug: 'responsable-financier',
    phone: '+269 330 00 02',
    pages: [
      ['tableau-de-bord', '/tableau-de-bord'],
      ['reglements', '/reglements'],
      ['depenses', '/depenses'],
    ],
  },
  {
    slug: 'comptable',
    phone: '+269 330 00 03',
    pages: [
      ['tableau-de-bord', '/tableau-de-bord'],
      ['reglements', '/reglements'],
      ['rapports', '/rapports?type=margins'],
    ],
  },
  {
    slug: 'assistant-comptable',
    phone: '+269 330 00 04',
    pages: [
      ['tableau-de-bord', '/tableau-de-bord'],
      ['caisse', '/caisse'],
      ['depenses', '/depenses'],
    ],
  },
  {
    slug: 'caissier',
    phone: '+269 330 00 05',
    pages: [
      ['tableau-de-bord', '/tableau-de-bord'],
      ['caisse', '/caisse'],
      ['reglements', '/reglements'],
    ],
  },
  {
    slug: 'gestionnaire-stock',
    phone: '+269 330 00 06',
    pages: [
      ['tableau-de-bord', '/tableau-de-bord'],
      ['stock', '/stock'],
      ['achats', '/achats'],
    ],
  },
  {
    slug: 'assistant-logistique',
    phone: '+269 330 00 07',
    pages: [
      ['tableau-de-bord', '/tableau-de-bord'],
      ['commandes', '/commandes'],
      ['livraisons', '/livraisons'],
    ],
  },
  {
    slug: 'leader-senior',
    phone: '+269 330 00 08',
    pages: [
      ['tableau-de-bord', '/tableau-de-bord'],
      ['catalogue', '/catalogues'],
      ['reseau', '/reseau'],
    ],
  },
  {
    slug: 'leader-junior',
    phone: '+269 330 00 09',
    pages: [
      ['tableau-de-bord', '/tableau-de-bord'],
      ['campagnes', '/campagnes'],
      ['prospects', '/prospects'],
    ],
  },
  {
    slug: 'teleconseiller',
    phone: '+269 330 00 10',
    pages: [
      ['tableau-de-bord', '/tableau-de-bord'],
      ['prospects', '/prospects'],
      ['ventes', '/ventes-tci'],
    ],
  },
];

async function signIn(page: Page, phone: string) {
  await page.goto('/connexion');
  await page.getByLabel('Téléphone').fill(phone);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/tableau-de-bord$/);
}

test.use({ viewport: { width: 1366, height: 860 } });

for (const r of ROLES) {
  test(`captures : ${r.slug}`, async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await signIn(page, r.phone);
    for (const [name, path] of r.pages) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(OUT, `${r.slug}-${name}.png`) });
    }
  });
}

test('captures : connexion', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.goto('/connexion');
  await page.screenshot({ path: join(OUT, 'connexion.png') });
});
