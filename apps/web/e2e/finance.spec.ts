import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Digecom2026!';
const ACCOUNTANT = '+269 330 00 03';
const FINANCE = '+269 330 00 02';
const CASHIER_GC = '+269 330 00 25';

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

async function openFatima(page: Page) {
  await page.goto('/reglements');
  const row = page.locator('tr[data-settlement="Fatima Said"]').first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Ouvrir le relevé de Fatima Said' }).click();
  const statement = page.getByTestId('statement');
  await expect(statement).toBeVisible();
  return { row, statement };
}

test('relevé de Fatima Said : comptable → responsable financier → caissier (10 ventes → 50 000 KMF)', async ({
  page,
}) => {
  // 1. Le comptable vérifie.
  await signIn(page, ACCOUNTANT);
  const first = await openFatima(page);
  const row = first.row;
  let statement = first.statement;
  test.skip(
    !(await row.textContent())?.includes('À vérifier'),
    'Relevé de démonstration déjà traité : relancer `make seed` sur une base neuve.',
  );
  await expect(row).toContainText('10');
  await expect(row).toContainText('50 000 KMF');
  await expect(statement).toContainText('Commissions (10 ventes)');
  await expect(statement).toContainText('75 000 KMF');
  await expect(statement).toContainText('− 5 000 KMF');
  await expect(statement).toContainText('− 20 000 KMF');
  await expect(statement.getByRole('button', { name: 'Valider le relevé' })).toHaveCount(0);
  await statement.getByRole('button', { name: 'Vérifier le relevé' }).click();
  await expect(statement).toContainText('Vérifié par Abdallah Saïd');
  await expect(statement).toContainText('En attente : le responsable financier.');
  await signOut(page);

  // 2. Le responsable financier valide.
  await signIn(page, FINANCE);
  ({ statement } = await openFatima(page));
  await expect(statement.getByRole('button', { name: 'Vérifier le relevé' })).toHaveCount(0);
  await statement.getByRole('button', { name: 'Valider le relevé' }).click();
  await expect(statement).toContainText('Validé par Soifia Mohamed');
  await expect(statement).toContainText('En attente : le caissier de l’île.');
  await signOut(page);

  // 3. Le caissier de Grande Comore paie.
  await signIn(page, CASHIER_GC);
  ({ statement } = await openFatima(page));
  await statement.getByLabel('Moyen de paiement').selectOption('HURI_MONEY');
  await statement.getByLabel('Référence (facultatif)').fill('HM-2026-0001');
  await statement.getByRole('button', { name: 'Payer 50 000 KMF' }).click();
  await expect(statement).toContainText('Payé par Halima Abdou');
  await expect(statement).toContainText('HM-2026-0001');
  await page.keyboard.press('Escape');
  await expect(page.locator('tr[data-settlement="Fatima Said"]').first()).toContainText('Payé');
});
