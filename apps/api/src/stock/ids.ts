import { randomBytes } from 'node:crypto';

/** Identifiant opaque (ligne de stock, transfert) : 'c' + 24 caractères aléatoires. */
export function createId(): string {
  return `c${randomBytes(12).toString('hex')}`;
}
