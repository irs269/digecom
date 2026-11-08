import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Digecom2026!';
const ADMIN = '+269 330 00 01';
const ALI = '+269 330 00 08';

async function signIn(page: Page, phone: string) {
  await page.goto('/connexion');
  await page.getByLabel('Téléphone').fill(phone);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/tableau-de-bord$/);
}

async function signOut(page: Page) {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/connexion/);
}

test('direction : tableau de bord cliquable, rapport par produit et export Excel', async ({
  page,
}) => {
  await signIn(page, ADMIN);
  const kpis = page.getByTestId('dashboard-kpis');
  await expect(kpis.locator('[data-kpi="revenue"]')).toContainText('KMF');
  await expect(page.getByTestId('dashboard-todo')).toContainText('Relevés à vérifier');
  await expect(page.getByTestId('dashboard-islands')).toContainText('Grande Comore');

  // Le CA du cycle ouvre le rapport journalier de la même période.
  const revenue = (await kpis.locator('[data-kpi="revenue"] .text-2xl').textContent()) ?? '';
  await kpis.locator('[data-kpi="revenue"]').click();
  await expect(page).toHaveURL(/\/rapports\?type=daily/);
  const totals = page.getByTestId('report-totals');
  await expect(totals).toBeVisible();
  await expect(totals).toContainText(revenue.trim());

  await page.getByRole('button', { name: /Par produit/ }).click();
  await expect(page).toHaveURL(/type=product/);
  await expect(page.getByRole('table', { name: 'Par produit' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel' }).click();
  expect((await download).suggestedFilename()).toMatch(/^rapport-product-.*\.xlsx$/);
  await signOut(page);
});

test('Leader Senior : son équipe, attribution de quantités, rapports de l’équipe', async ({
  page,
}) => {
  await signIn(page, ALI);
  await expect(page.getByTestId('dashboard-kpis').locator('[data-kpi="remaining"]')).toBeVisible();
  await page.goto('/reseau');
  const team = page.locator('[data-team="Ali Mohamed"]');
  await expect(team).toBeVisible();
  await expect(page.locator('[data-team]')).toHaveCount(1);
  const row = team.locator('tr[data-member="Fatima Said"]');
  const before = Number(((await row.locator('td').nth(5).textContent()) ?? '0').trim());
  await row.getByRole('button', { name: 'Attribuer' }).click();
  const form = page.getByRole('form', { name: 'Attribuer des quantités' });
  await form.getByLabel('Produit').selectOption({ index: 1 });
  await form.getByLabel('Quantité').fill('3');
  await form.getByRole('button', { name: 'Attribuer' }).click();
  await expect(row.locator('td').nth(5)).toHaveText(String(before + 3));

  await page.goto('/rapports');
  await expect(page.getByRole('button', { name: /Marges/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Par vendeur/ }).click();
  await expect(page.getByRole('table', { name: 'Par vendeur' })).toBeVisible();
  await signOut(page);
});
