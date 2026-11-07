import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Digecom2026!';
// Compte admin distinct de auth.spec.ts pour ne pas consommer le même quota de connexion.
const ADMIN = '+269 330 00 01';
const ACCOUNTANT = '+269 330 00 03';

async function signIn(page: Page, phone: string, password = PASSWORD) {
  await page.goto('/connexion');
  await page.getByLabel('Téléphone').fill(phone);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/(tableau-de-bord|mot-de-passe)$/);
}

test('admin : crée un e-commerçant chez Ali Mohamed, le réaffecte et retrouve l’historique', async ({
  page,
}) => {
  const suffix = String(Date.now()).slice(-4);
  const name = `Saïd Test ${suffix}`;
  const phone = `+269 34${suffix.slice(0, 1)} ${suffix.slice(1, 3)} ${suffix.slice(3)}0`;

  await signIn(page, ADMIN);
  await page.goto('/utilisateurs');
  await expect(page.getByRole('heading', { name: 'Utilisateurs et droits' })).toBeVisible();

  // Création
  await page.getByRole('button', { name: '+ Nouveau compte' }).click();
  const create = page.getByRole('dialog', { name: 'Nouveau compte' });
  await create.getByLabel('Nom complet').fill(name);
  await create.getByLabel('Téléphone').fill(phone);
  await create.getByLabel('Rôle').selectOption({ label: 'E-commerçant' });
  await create.getByLabel('Île').selectOption({ label: 'Grande Comore' });
  await create.getByLabel(/Leader/).selectOption({ label: 'Ali Mohamed' });
  await create.getByRole('button', { name: 'Créer le compte' }).click();

  const secret = page.getByRole('dialog', { name: 'Compte créé' });
  await expect(secret.getByTestId('temporary-password')).toHaveText(
    /^[A-Za-z]{4}-\d{4}-[A-Za-z]{4}$/,
  );
  await secret.getByRole('button', { name: 'J’ai noté le mot de passe' }).click();

  // Retrouver le compte
  await page.getByLabel('Recherche').fill(name);
  const row = page.getByRole('row', { name: new RegExp(name) });
  await expect(row).toContainText('équipe Ali Mohamed');
  await expect(row).toContainText('Mot de passe temporaire');

  // Réaffectation
  await row.getByRole('button', { name: `Gérer le compte de ${name}` }).click();
  await page.getByRole('button', { name: 'Réaffecter à un autre leader' }).click();
  const reassign = page.getByRole('dialog', { name: `Réaffecter ${name}` });
  await reassign.getByLabel(/Nouveau leader/).selectOption({ label: 'Nassur Ahmed · Anjouan' });
  await expect(reassign.getByText('passera sur l’île Anjouan')).toBeVisible();
  await reassign.getByLabel('Motif').fill('Rejoint l’équipe d’Anjouan');
  await reassign.getByRole('button', { name: 'Réaffecter', exact: true }).click();

  // Historique dans le panneau du compte
  await expect(page.getByText(`${name} rejoint l’équipe de Nassur Ahmed`)).toBeVisible();
  await page.getByRole('button', { name: 'Réaffecter à un autre leader' }).click();
  const history = page.getByTestId('team-history');
  await expect(history).toContainText('Ali Mohamed → Nassur Ahmed');
  await expect(history).toContainText('Rejoint l’équipe d’Anjouan');
  await expect(history).toContainText('Création du compte');
  await page.keyboard.press('Escape');

  // Onglet Équipes : historique global
  await page.getByRole('tab', { name: 'Équipes' }).click();
  await expect(page.getByRole('table', { name: 'Historique des réaffectations' })).toContainText(
    name,
  );

  // Onglet Journal : l'action est tracée
  await page.getByRole('tab', { name: 'Journal d’activité' }).click();
  await expect(page.getByRole('table', { name: "Journal d'activité" })).toContainText(
    'Réaffectation à un leader',
  );

  // Onglet Matrice : même matrice que l'API
  await page.getByRole('tab', { name: 'Matrice des droits' }).click();
  const matrix = page.getByTestId('permissions-matrix');
  await expect(matrix.getByRole('row')).toHaveCount(17);
});

test('un comptable ne voit pas le module Utilisateurs', async ({ page }) => {
  await signIn(page, ACCOUNTANT);
  const menu = page.getByRole('navigation', { name: 'Menu principal' });
  await expect(menu.getByRole('link', { name: /Tableau de bord/ })).toBeVisible();
  await expect(menu.getByRole('link', { name: /Utilisateurs/ })).toHaveCount(0);
  await page.goto('/utilisateurs');
  await expect(page.getByTestId('forbidden')).toBeVisible();
});
