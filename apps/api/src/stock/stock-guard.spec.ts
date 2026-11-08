import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Critère d'acceptation phase 2 : aucun chemin de code ne modifie `StockLevel` hors StockService.
 * Ce test parcourt les sources (API + seed) et échoue si un autre fichier écrit dans la table.
 */
const ROOT = join(__dirname, '..', '..');
const ALLOWED = [join('src', 'stock', 'stock.service.ts')];
const WRITE_PATTERNS = [
  /stockLevel\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/,
  /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"StockLevel"/i,
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === 'node_modules' || name === 'dist') return [];
    if (statSync(full).isDirectory()) return files(full);
    return /\.ts$/.test(name) && !/\.spec\.ts$/.test(name) ? [full] : [];
  });
}

describe('StockLevel : écriture réservée à StockService', () => {
  it('aucun autre fichier ne modifie StockLevel', () => {
    const offenders = [...files(join(ROOT, 'src')), ...files(join(ROOT, 'prisma'))]
      .map((f) => relative(ROOT, f))
      .filter((f) => !ALLOWED.includes(f.split('/').join(sep)))
      .filter((f) => WRITE_PATTERNS.some((re) => re.test(readFileSync(join(ROOT, f), 'utf8'))));
    expect(offenders).toEqual([]);
  });

  it('StockService écrit bien dans StockLevel (le test détecte les écritures)', () => {
    const src = readFileSync(join(ROOT, ALLOWED[0]!), 'utf8');
    expect(WRITE_PATTERNS.some((re) => re.test(src))).toBe(true);
  });
});
