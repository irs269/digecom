import { expect, test, type Locator, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Digecom2026!';
const ADMIN = '+269 330 00 01';
const CASHIER_MO = '+269 330 00 05';
const LOGISTICS_GC = '+269 330 00 07';

async function signIn(page: Page, phone: string) {
  await page.goto('/connexion');
  await page.getByLabel('Téléphone').fill(phone);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/tableau-de-bord$/);
}

async function signOut(page: Page) {
  // Ferme un éventuel panneau modal (il masque le reste de la page).
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/connexion/);
}

/** Choisit l'option dont le libellé contient `text`. */
async function pick(select: Locator, text: string) {
  const option = select.locator('option', { hasText: text }).first();
  await expect(option).toBeAttached();
  await select.selectOption((await option.getAttribute('value'))!);
}

test('logistique GC : commande pour Fatima Said, préparée, affectée, livrée par un livreur simulé ; invisible pour la caisse de Mohéli', async ({
  page,
}) => {
  const customer = `Client E2E ${String(Date.now()).slice(-5)}`;

  // 1. Assistant logistique de Grande Comore
  await signIn(page, LOGISTICS_GC);
  await page.goto('/commandes');
  await page.getByRole('button', { name: '+ Nouvelle commande pour le compte de' }).click();
  const form = page.getByRole('form', { name: 'Nouvelle commande' });
  await pick(form.getByLabel('Vendeur'), 'Fatima Said');
  await pick(form.getByLabel(/^Produit/), 'Sac à main');
  await form.getByLabel('Nom du client').fill(customer);
  await form.getByLabel('Téléphone du client').fill('+269 332 14 87');
  await form.getByLabel('Zone').fill('Moroni Nord');
  await form.getByLabel('Mode de remise').selectOption('TO_CUSTOMER');
  await form.getByRole('button', { name: 'Créer la commande' }).click();

  const detail = page.getByTestId('order-detail');
  await expect(detail).toContainText(customer);
  await expect(detail).toContainText('Nouvelle');
  for (const [button, status] of [
    ['Confirmer et préparer', 'Confirmée'],
    ['Lancer la préparation', 'En préparation'],
    ['Marquer prête', 'Prête'],
  ] as const) {
    await detail.getByRole('button', { name: button }).click();
    await expect(detail.getByText(status, { exact: true }).first()).toBeVisible();
  }
  await detail.getByRole('button', { name: 'Affecter un livreur de l’île' }).click();
  const dialog = page.getByRole('dialog', { name: /Affecter un livreur/ });
  await pick(dialog.getByLabel(/^Livreur/), 'Karim Bacar');
  await dialog.getByRole('button', { name: 'Valider' }).click();
  await expect(detail).toContainText('Karim Bacar');
  await expect(detail.getByText('Livreur affecté', { exact: true }).first()).toBeVisible();
  const number = (await page
    .getByRole('dialog', { name: /^Commande CMD-/ })
    .getByRole('heading')
    .first()
    .textContent())!
    .replace('Commande ', '')
    .trim();
  await signOut(page);

  // 2. Le livreur (simulé par l'administrateur) récupère, remet et déclare la vente.
  await signIn(page, ADMIN);
  await page.goto('/simulateur');
  const sim = page.getByTestId('courier-simulator');
  await pick(sim.getByLabel('Livreur simulé'), 'Karim Bacar');
  const run = sim.locator(`[data-sim-order="${number}"]`);
  await expect(run).toContainText('Livreur affecté');
  await run.getByRole('button', { name: 'Récupérer au site' }).click();
  await expect(run).toContainText('En livraison');
  await run.getByRole('button', { name: 'Confirmer la remise' }).click();
  const handover = page.getByRole('dialog', { name: /Confirmer la remise/ });
  await handover.getByLabel('Montant encaissé (KMF)').fill('14000');
  await handover.getByRole('button', { name: 'Valider' }).click();
  await expect(run).toContainText('Remise effectuée');
  await run.getByRole('button', { name: 'Client a pris' }).click();
  await expect(sim.locator(`[data-sim-order="${number}"]`)).toHaveCount(0); // sortie des courses en cours

  await page.goto('/commandes');
  await page.getByLabel('Recherche').fill(number);
  const row = page.getByRole('row', { name: new RegExp(number) });
  await expect(row).toContainText('Vendue');
  await signOut(page);

  // 3. La caisse de Mohéli n'a pas accès aux commandes.
  await signIn(page, CASHIER_MO);
  await expect(
    page
      .getByRole('navigation', { name: 'Menu principal' })
      .getByRole('link', { name: /Commandes/ }),
  ).toHaveCount(0);
  await page.goto('/commandes');
  await expect(page.getByTestId('forbidden')).toBeVisible();
});
