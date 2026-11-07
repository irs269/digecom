/** Espace insécable utilisée comme séparateur de milliers et avant l'unité. */
export const NBSP = ' ';

/**
 * Formate un montant entier en KMF : `formatKmf(12500)` → `"12 500 KMF"`
 * (espaces insécables). Refuse les montants non entiers (règle : argent en entiers).
 */
export function formatKmf(amount: number): string {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`Montant KMF invalide (entier attendu) : ${amount}`);
  }
  const sign = amount < 0 ? '-' : '';
  const digits = Math.abs(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${sign}${digits}${NBSP}KMF`;
}
