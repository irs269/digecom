import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Digecom2026!';
const STOCK_AN = '+269 330 00 06';
const ALI = '+269 330 00 08';
const NASSUR = '+269 330 00 13';

async function signIn(page: Page, phone: string) {
  await page.goto('/connexion');
  await page.getByLabel('Téléphone').fill(phone);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/tableau-de-bord$/);
}

test('le gestionnaire de stock d’Anjouan ne voit que les sites d’Anjouan', async ({ page }) => {
  await signIn(page, STOCK_AN);
  await page.goto('/stock');
  await expect(page.getByRole('heading', { name: 'Stock' })).toBeVisible();
  const table = page.getByRole('table', { name: 'Stock par site' });
  await expect(table.getByRole('row').nth(1)).toBeVisible();
  const sites = await table.getByRole('row').locator('td:nth-child(4)').allTextContents();
  expect(sites.length).toBeGreaterThan(0);
  expect(sites.every((s) => s.startsWith('Mutsamudu'))).toBe(true);
  const options = await page
    .getByLabel('Site', { exact: true })
    .locator('option')
    .allTextContents();
  expect(
    options.filter((o) => o !== 'Tous les sites').every((o) => o.startsWith('Mutsamudu')),
  ).toBe(true);
});

test('Ali Mohamed publie un produit : visible pour son équipe, pas pour celle de Nassur', async ({
  page,
}) => {
  const name = `Radio FM ${String(Date.now()).slice(-5)}`;
  await signIn(page, ALI);
  await page.goto('/catalogues');
  await expect(page.getByRole('heading', { name: 'Mon catalogue' })).toBeVisible();

  await page.getByRole('button', { name: '+ Publier un produit' }).click();
  const form = page.getByRole('dialog', { name: 'Publier un produit' });
  await form.getByLabel('Nom du produit').fill(name);
  await form.getByLabel('Qualité').fill('Standard');
  await form.getByLabel('Prix de vente (KMF)').fill('10000');
  await form.getByLabel('Montant (KMF)').fill('6000');
  await expect(form.getByText('L’e-commerçant touche 6 000 KMF')).toBeVisible();
  await form.getByRole('button', { name: 'Publier le produit' }).click();

  const row = page.locator(`tr[data-product="${name}"]`);
  await expect(row).toContainText('Rupture');
  await row.getByRole('button', { name: `Ajouter du stock à ${name}` }).click();
  const dialog = page.getByRole('dialog', { name: new RegExp(`Ajouter du stock – ${name}`) });
  await dialog.getByLabel('Quantité').fill('4');
  await dialog.getByLabel('Motif').fill('Arrivage local');
  await dialog.getByLabel('Coût unitaire (KMF)').fill('3500');
  await dialog.getByRole('button', { name: 'Valider' }).click();
  await expect(row).toContainText('Publié');

  const preview = page.getByTestId('team-preview');
  await expect(preview.getByRole('list', { name: 'Produits visibles' })).toContainText(name);

  // Nassur Ahmed (autre leader) : le produit n'apparaît ni dans son catalogue ni chez son équipe.
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/connexion/);
  await signIn(page, NASSUR);
  await page.goto('/catalogues');
  await expect(page.getByRole('table', { name: 'Produits publiés' })).not.toContainText(name);
  const nassurPreview = page.getByTestId('team-preview');
  await expect(nassurPreview).toContainText('Nassur Ahmed');
  await expect(nassurPreview).not.toContainText(name);
});
