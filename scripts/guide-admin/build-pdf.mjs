/**
 * Génère le PDF du guide Administrateur à partir de docs/guides/administrateur/guide.html
 * et des captures de docs/guides/administrateur/img :
 *
 *   node scripts/guide-admin/build-pdf.mjs
 *
 * Sortie : docs/guides/administrateur/Guide-Administrateur-DigeCom.pdf (A4, numéros de page).
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(join(process.cwd(), 'apps/web/package.json'));
const { chromium } = require('@playwright/test');

const here = dirname(fileURLToPath(import.meta.url));
const DIR = join(here, '..', '..', 'docs', 'guides', 'administrateur');
const SRC = join(DIR, 'guide.html');
const OUT = join(DIR, 'Guide-Administrateur-DigeCom.pdf');

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage();
await page.goto(pathToFileURL(SRC).href, { waitUntil: 'load' });
// Polices et images chargées avant l'impression.
await page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all(
    [...document.images].map((img) =>
      img.complete ? null : new Promise((r) => img.addEventListener('load', r, { once: true })),
    ),
  );
});
// Sommaire : numéros de page calculés d'après la position de chaque section imprimée.
await page.pdf({
  path: OUT,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  margin: { top: '18mm', bottom: '18mm', left: '14mm', right: '14mm' },
  headerTemplate:
    '<div style="width:100%;font-size:8px;color:#5B6385;padding:0 14mm;font-family:Arial">Dig’eCom · Guide de l’administrateur</div>',
  footerTemplate:
    '<div style="width:100%;font-size:8px;color:#5B6385;padding:0 14mm;font-family:Arial;display:flex;justify-content:space-between"><span>Version du <span class="date"></span></span><span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
});
await browser.close();
console.log('PDF :', OUT);
