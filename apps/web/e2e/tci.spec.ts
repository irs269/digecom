import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Digecom2026!';
const RACHAD = '+269 330 00 09';
const ANLIA = '+269 330 00 10';

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

/** Jeton d'API d'un compte (étapes logistique / livreur jouées hors écran). */
async function token(api: APIRequestContext, phone: string) {
  const r = await api.post('/api/auth/login', { data: { phone, password: PASSWORD } });
  expect(r.ok()).toBe(true);
  return ((await r.json()) as { accessToken: string }).accessToken;
}

const kmfText = async (page: Page, label: string) => {
  const card = page.getByTestId('earnings-kpis').getByText(label, { exact: true }).locator('..');
  const text = ((await card.textContent()) ?? '').split(String.fromCharCode(0xa0)).join(' ');
  return Number((text.match(/([\d ]+) ?KMF/)?.[1] ?? '0').replace(/[^\d]/g, ''));
};

test('Leader Junior : campagne, import, répartition ; TCI : appel, confirmation, clôture, gains', async ({
  page,
  request,
}) => {
  const tag = String(Date.now()).slice(-5);
  const campaign = `Montre Sport E2E ${tag}`;

  // 1. Leader Junior (Rachad Ibrahim)
  await signIn(page, RACHAD);
  await page.goto('/campagnes');
  await page.getByRole('button', { name: '+ Nouvelle campagne' }).click();
  const form = page.getByRole('form', { name: 'Nouvelle campagne' });
  await form.getByLabel('Nom de la campagne').fill(campaign);
  const option = form
    .getByLabel('Produit (ton catalogue)')
    .locator('option', { hasText: 'Montre connectée Sport' });
  await form
    .getByLabel('Produit (ton catalogue)')
    .selectOption((await option.getAttribute('value'))!);
  await form.getByLabel('Canal').selectOption('WHATSAPP');
  await form.getByLabel('Budget (KMF)').fill('30000');
  await form.getByRole('button', { name: 'Lancer la campagne' }).click();
  await expect(page.locator(`tr[data-campaign="${campaign}"]`)).toContainText('Active');

  await page.goto('/prospects');
  await page.getByRole('button', { name: 'Importer des contacts' }).click();
  const panel = page.getByRole('dialog', { name: 'Importer des contacts' });
  const choice = panel.getByLabel('Campagne').locator('option', { hasText: campaign });
  await panel.getByLabel('Campagne').selectOption((await choice.getAttribute('value'))!);
  const phones = Array.from({ length: 6 }, (_, i) =>
    `3${tag.slice(0, 2)}${String(i)}${tag.slice(2)}`.slice(0, 7),
  );
  const csv = [
    'nom;téléphone;note',
    ...phones.map((p, i) => `Contact ${tag}-${i};${p};`),
    `Doublon ${tag};${phones[0]};`,
    `Invalide ${tag};12;`,
  ].join('\n');
  await panel.getByLabel(/Fichier CSV ou Excel/).setInputFiles({
    name: 'contacts.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  });
  await panel.getByRole('button', { name: 'Aperçu' }).click();
  await expect(panel.getByTestId('import-report')).toContainText(
    '6 à importer · 1 doublon(s) · 1 invalide(s) sur 8 ligne(s)',
  );
  await panel.getByRole('button', { name: 'Importer' }).click();
  await expect(page.getByText('6 contact(s) importé(s)')).toBeVisible();
  await panel.getByRole('button', { name: 'Répartir équitablement entre les TCI' }).click();
  await expect(page.getByText(/6 prospect\(s\) répartis/)).toBeVisible();
  await signOut(page);

  // 2. Téléconseillère (Anlia Hassani) : appel, confirmation
  await signIn(page, ANLIA);
  await page.goto('/prospects');
  const mine = page.locator(`tr[data-prospect^="Contact ${tag}-"]`);
  await expect(mine.first()).toBeVisible();
  const name = (await mine.first().getAttribute('data-prospect'))!;
  if ((await mine.count()) > 1) {
    const secondName = (await mine.nth(1).getAttribute('data-prospect'))!;
    const second = page.locator(`tr[data-prospect="${secondName}"]`);
    await second.getByRole('button', { name: 'Injoignable' }).click();
    await expect(second).toContainText('Injoignable – à rappeler');
  }
  await page
    .locator(`tr[data-prospect="${name}"]`)
    .getByRole('button', { name: `Commande confirmée pour ${name}` })
    .click();
  const confirm = page.getByRole('form', { name: 'Commande confirmée' });
  await expect(confirm.getByLabel('Client')).toHaveValue(name);
  await confirm.getByLabel('Zone').fill('Moroni Nord');
  await confirm.getByRole('button', { name: 'Créer la commande' }).click();
  await expect(page.locator(`tr[data-prospect="${name}"]`)).toContainText(/CMD-\d{6}/);
  const orderNumber = (
    (await page.locator(`tr[data-prospect="${name}"]`).textContent()) ?? ''
  ).match(/CMD-\d{6}/)![0];

  // 3. Livraison (logistique + livreur via l'API, comme en phase 3)
  const logistics = await token(request, '+2693300007');
  const courier = await token(request, '+2693300023');
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const list = await request.get(`/api/orders?q=${orderNumber}`, { headers: auth(logistics) });
  const orderId = ((await list.json()) as { items: { id: string }[] }).items[0]!.id;
  for (const a of ['confirm', 'prepare', 'ready']) {
    expect(
      (
        await request.post(`/api/orders/${orderId}/actions/${a}`, {
          headers: auth(logistics),
          data: {},
        })
      ).ok(),
    ).toBe(true);
  }
  // Plus d'offre « premier qui accepte » : la logistique affecte le livreur (liste classée).
  const candidates = (await (
    await request.get(`/api/deliveries/${orderId}/candidates`, { headers: auth(logistics) })
  ).json()) as { id: string; phone: string }[];
  const courierId = candidates.find((c) => c.phone === '+2693300023')!.id;
  expect(
    (
      await request.post(`/api/deliveries/${orderId}/assign`, {
        headers: auth(logistics),
        data: { courierId },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.post(`/api/courier/runs/${orderId}/pickup`, {
        headers: auth(courier),
        data: {},
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.post(`/api/courier/runs/${orderId}/handover`, {
        headers: auth(courier),
        data: { amountCollected: 17000 },
      })
    ).ok(),
  ).toBe(true);

  // 4. Clôture « Vendu » : la prime de 3 000 KMF s'ajoute aux gains.
  await page.goto('/ventes-tci');
  await expect(page.getByRole('heading', { name: 'Mes ventes et gains' })).toBeVisible();
  const row = page.locator(`tr[data-tci-order="${orderNumber}"]`);
  await expect(row).toContainText('Livrée – à clôturer');
  await expect(page.getByTestId('earnings-kpis')).toContainText('KMF');
  const before = await kmfText(page, 'Mes gains de la semaine');
  await row.getByRole('button', { name: `${orderNumber} : Vendu` }).click();
  await expect(row).toContainText('Vendue');
  await expect.poll(() => kmfText(page, 'Mes gains de la semaine')).toBe(before + 3000);
});
