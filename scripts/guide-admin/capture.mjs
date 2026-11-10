/**
 * Captures d'écran du guide Administrateur (docs/guides/administrateur/).
 *
 *   SEED_DEFAULT_PASSWORD=… BASE_URL=http://localhost:3100 \
 *     node scripts/guide-admin/capture.mjs [dossier-texte]
 *
 * Se connecte avec le compte Administrateur de démonstration (+269 330 00 01), parcourt chaque
 * module, enregistre une capture PNG et, si un dossier est donné, le texte visible de l'écran.
 * Chaque étape est tolérante : un bouton absent n'arrête pas le parcours.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(join(process.cwd(), 'apps/web/package.json'));
const { chromium } = require('@playwright/test');

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', '..', 'docs', 'guides', 'administrateur', 'img');
const TEXT = process.argv[2] ?? null;
const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const PASSWORD = process.env.SEED_DEFAULT_PASSWORD;
if (!PASSWORD) throw new Error('SEED_DEFAULT_PASSWORD manquant');
mkdirSync(OUT, { recursive: true });
if (TEXT) mkdirSync(TEXT, { recursive: true });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** Attend la fin du chargement : plus de « Chargement… », réseau calme. */
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 90_000 }).catch(() => undefined);
  await page
    .waitForFunction(() => !document.body.innerText.includes('Chargement…'), null, {
      timeout: 90_000,
    })
    .catch(() => undefined);
  await page.waitForTimeout(1200);
}

async function shot(page, id, { full = false, text = true } = {}) {
  await page.mouse.move(5, 5);
  await page.screenshot({ path: join(OUT, `${id}.png`), fullPage: full, animations: 'disabled' });
  if (TEXT && text) {
    const body = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      return (dlg ?? document.querySelector('main') ?? document.body).innerText;
    });
    writeFileSync(join(TEXT, `${id}.txt`), body.slice(0, 6000));
  }
  log('capture', id);
}

async function go(page, path, extraWait = 0) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  // Badge du mode développement de Next.js : absent des captures.
  await page
    .addStyleTag({ content: 'nextjs-portal{display:none!important}' })
    .catch(() => undefined);
  await settle(page);
  if (extraWait) await page.waitForTimeout(extraWait);
}

/** Clique le premier bouton (ou lien) dont le nom correspond ; faux si absent. */
async function click(page, name, { role = 'button', nth = 0 } = {}) {
  const loc = page.getByRole(role, { name }).nth(nth);
  if (!(await loc.count())) {
    log('  (absent)', String(name));
    return false;
  }
  await loc.click({ timeout: 10_000 }).catch(() => undefined);
  await settle(page);
  return true;
}

async function closeDialog(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  locale: 'fr-FR',
  timezoneId: 'Indian/Comoro',
  permissions: [],
});
const page = await ctx.newPage();

// --- Connexion ----------------------------------------------------------------------------------
await go(page, '/connexion');
await shot(page, '00-connexion');
await page.getByLabel('Téléphone').fill('+269 330 00 01');
await page.getByLabel('Mot de passe').fill(PASSWORD);
await page.getByRole('button', { name: 'Se connecter' }).click();
await page.waitForURL(/tableau-de-bord/, { timeout: 120_000 });
await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
// Tableau de bord : indicateurs, commandes récentes et bouton d'appels chargés.
await page
  .getByText('Commandes récentes')
  .waitFor({ timeout: 120_000 })
  .catch(() => undefined);
await page
  .getByTestId('calls-button')
  .waitFor({ timeout: 120_000 })
  .catch(() => undefined);
await settle(page);

// --- Tableau de bord et cadre -------------------------------------------------------------------
await shot(page, '01-tableau-de-bord');
await shot(page, '01b-tableau-de-bord-complet', { full: true, text: false });
if (await click(page, /Notifications/)) {
  await shot(page, '01c-notifications');
  await closeDialog(page);
}
if (await page.getByTestId('calls-button').count()) {
  await page.getByTestId('calls-button').click();
  await page
    .getByTestId('call-contacts')
    .waitFor({ timeout: 60_000 })
    .catch(() => undefined);
  await settle(page);
  await shot(page, '01d-appels');
  await closeDialog(page);
}

// --- Commandes ----------------------------------------------------------------------------------
await go(page, '/commandes');
await shot(page, '02-commandes');
if (await click(page, /Nouvelle commande/)) {
  await shot(page, '02b-nouvelle-commande');
  await closeDialog(page);
}
if (await click(page, /^Ouvrir la commande/)) {
  await shot(page, '02c-detail-commande');
  await shot(page, '02d-detail-commande-suite', { full: true, text: false });
  await closeDialog(page);
}

// --- Livraisons ---------------------------------------------------------------------------------
await go(page, '/livraisons');
await shot(page, '03-livraisons');
await shot(page, '03b-livraisons-complet', { full: true, text: false });

// --- Stock --------------------------------------------------------------------------------------
await go(page, '/stock');
await shot(page, '04-stock');
for (const [label, id] of [
  ['Entrée', '04b-stock-entree'],
  ['Transfert', '04c-stock-transfert'],
  ['Inventaire', '04d-stock-inventaire'],
  ['Ajustement', '04e-stock-ajustement'],
]) {
  if (await click(page, new RegExp(`^${label}$`))) {
    await shot(page, id);
    await closeDialog(page);
  }
}

// --- Achats Chine -------------------------------------------------------------------------------
await go(page, '/achats');
await shot(page, '05-achats');
if (await click(page, /Commande fournisseur/)) {
  await shot(page, '05b-nouvel-achat');
  await closeDialog(page);
}
if (await click(page, /^LOT-/)) {
  await shot(page, '05c-detail-achat');
  await closeDialog(page);
}
if (await click(page, /^Réceptionner$/)) {
  await shot(page, '05d-reception-lot');
  await closeDialog(page);
}

// --- Réseau commercial --------------------------------------------------------------------------
await go(page, '/reseau');
await shot(page, '06-reseau');
await shot(page, '06b-reseau-complet', { full: true, text: false });

// --- Catalogues leaders -------------------------------------------------------------------------
await go(page, '/catalogues');
await shot(page, '07-catalogues');
if (await click(page, /Publier un produit/)) {
  await shot(page, '07b-nouveau-produit');
  await closeDialog(page);
}
if (await click(page, /^Modifier$/)) {
  await shot(page, '07c-fiche-produit');
  await closeDialog(page);
}

// --- Campagnes, prospects, ventes TCI -----------------------------------------------------------
await go(page, '/campagnes');
await shot(page, '08-campagnes');
if (await click(page, /Nouvelle campagne/)) {
  await shot(page, '08b-nouvelle-campagne');
  await closeDialog(page);
}
await go(page, '/prospects');
await shot(page, '09-prospects');
if (await click(page, /Importer/)) {
  await shot(page, '09b-import-prospects');
  await closeDialog(page);
}
await go(page, '/ventes-tci', 5000);
await shot(page, '10-ventes-tci');

// --- Finance ------------------------------------------------------------------------------------
await go(page, '/reglements');
await shot(page, '11-reglements');
if (await click(page, /^Ouvrir le relevé/)) {
  await shot(page, '11b-detail-releve');
  await closeDialog(page);
}
await go(page, '/caisse', 3000);
await shot(page, '12-caisse');
await shot(page, '12b-caisse-complet', { full: true, text: false });
await go(page, '/depenses', 5000);
await shot(page, '13-depenses');
if (await click(page, /Nouvelle dépense/)) {
  await shot(page, '13b-nouvelle-depense');
  await closeDialog(page);
}

// --- Rapports -----------------------------------------------------------------------------------
await go(page, '/rapports', 5000);
await shot(page, '14-rapports');
for (const [name, id] of [
  [/^Rapport journalier/, '14a-rapport-journalier'],
  [/^Marges/, '14b-rapport-marges'],
  [/^Par vendeur/, '14d-rapport-vendeurs'],
  [/^Simulation 100 produits/, '14c-rapport-simulation'],
]) {
  if (await click(page, name)) {
    await page.waitForTimeout(3000);
    await shot(page, id);
  }
}

// --- Utilisateurs et droits ---------------------------------------------------------------------
await go(page, '/utilisateurs');
await shot(page, '15-utilisateurs');
if (await click(page, /Nouveau compte|Nouvel utilisateur/)) {
  await shot(page, '15b-nouveau-compte');
  await closeDialog(page);
}
for (const [name, id] of [
  [/Matrice des droits/, '15c-matrice-droits'],
  [/^Équipes$/, '15e-equipes'],
  [/Journal d’activité/, '15d-journal-activite'],
]) {
  if (await click(page, name, { role: 'tab' })) await shot(page, id);
}

// --- Paramètres, préférences, simulateur --------------------------------------------------------
await go(page, '/parametres');
await shot(page, '16-parametres');
await shot(page, '16b-parametres-complet', { full: true, text: false });
await go(page, '/preferences');
await shot(page, '17-preferences');
await go(page, '/simulateur');
await shot(page, '18-simulateur');

// --- Filtre île ---------------------------------------------------------------------------------
await go(page, '/tableau-de-bord');
const island = page.getByRole('combobox').first();
if (await island.count()) {
  await island.selectOption({ label: 'Anjouan' }).catch(() => undefined);
  await settle(page);
  await shot(page, '19-filtre-ile-anjouan');
}

await browser.close();
log('terminé');
