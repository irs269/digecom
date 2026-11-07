import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Digecom2026!';

/** Comptes seedés (apps/api/prisma/seed-data.ts). */
const ADMIN = { phone: '+269 330 00 01', name: "Direction Dig'eCom" };
const CASHIER = { phone: '+269 330 00 05', name: 'Mariama Combo' };
// Comptes différents par test : la connexion est limitée à 5 essais / 15 min par IP + téléphone.
const FINANCE = '+269 330 00 02';
const ACCOUNTANT = '+269 330 00 03';
const LOGISTICS = '+269 330 00 07';

async function signIn(page: Page, phone: string, password = PASSWORD) {
  await page.goto('/connexion');
  await page.getByLabel('Téléphone').fill(phone);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

test('connexion administrateur : menu complet de 16 entrées', async ({ page }) => {
  await signIn(page, ADMIN.phone);
  await expect(page).toHaveURL(/\/tableau-de-bord$/);
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
  const menu = page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link');
  await expect(menu).toHaveCount(16);
  await expect(page.getByTestId('current-user')).toHaveText(ADMIN.name);
  await expect(page.getByLabel('Île')).toBeVisible();
  // Aucun module en lecture seule pour l'administrateur.
  await expect(page.getByRole('navigation').getByText('LECTURE')).toHaveCount(0);
});

test('connexion caissier : 3 entrées, périmètre Mohéli, module interdit → 403', async ({
  page,
}) => {
  await signIn(page, CASHIER.phone);
  await expect(page).toHaveURL(/\/tableau-de-bord$/);
  const menu = page.getByRole('navigation', { name: 'Menu principal' }).getByRole('link');
  await expect(menu).toHaveCount(3);
  await expect(menu).toHaveText([/Tableau de bord/, /Règlements/, /Caisse/]);
  await expect(page.getByText('Périmètre : Mohéli', { exact: false })).toBeVisible();

  await page.goto('/utilisateurs');
  await expect(page.getByTestId('forbidden')).toBeVisible();
});

test('mauvais mot de passe : message d’erreur', async ({ page }) => {
  await signIn(page, ADMIN.phone, 'mauvais-mot-de-passe');
  await expect(page.getByText('Téléphone ou mot de passe incorrect')).toBeVisible();
  await expect(page).toHaveURL(/\/connexion/);
});

test('déconnexion puis accès protégé → retour à la connexion', async ({ page }) => {
  await signIn(page, FINANCE);
  await expect(page).toHaveURL(/\/tableau-de-bord$/);
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/connexion/);
  await page.goto('/tableau-de-bord');
  await expect(page).toHaveURL(/\/connexion/);
});

test('session conservée après rechargement (refresh silencieux)', async ({ page }) => {
  await signIn(page, ACCOUNTANT);
  await expect(page).toHaveURL(/\/tableau-de-bord$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();
});

test('@mobile menu au-dessus du contenu sous 900 px', async ({ page }) => {
  await signIn(page, LOGISTICS);
  await expect(page).toHaveURL(/\/tableau-de-bord$/);
  const nav = await page.getByRole('navigation', { name: 'Menu principal' }).boundingBox();
  const heading = await page.getByRole('heading', { name: 'Tableau de bord' }).boundingBox();
  expect(nav && heading && nav.y < heading.y).toBe(true);
});
