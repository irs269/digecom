import { describe, expect, it } from 'vitest';
import { formatKmf, NBSP } from '../src/money';

describe('formatKmf', () => {
  it('formate 12 500 KMF avec des espaces insécables', () => {
    expect(formatKmf(12500)).toBe(`12${NBSP}500${NBSP}KMF`);
  });

  it.each([
    [0, '0 KMF'],
    [500, '500 KMF'],
    [7000, '7 000 KMF'],
    [1250000, '1 250 000 KMF'],
    [-20000, '-20 000 KMF'],
  ])('%i → %s', (amount, expected) => {
    expect(formatKmf(amount).replaceAll(NBSP, ' ')).toBe(expected);
  });

  it("n'utilise aucune espace ordinaire", () => {
    expect(formatKmf(1250000)).not.toContain(' ');
  });

  it('refuse les montants non entiers', () => {
    expect(() => formatKmf(12.5)).toThrow(RangeError);
    expect(() => formatKmf(Number.NaN)).toThrow(RangeError);
  });
});
