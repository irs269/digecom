import { describe, expect, it } from 'vitest';
import {
  computeSale,
  computeSettlement,
  computeTciSale,
  settlementCycle,
  sumSales,
  weekStart,
} from '../src/finance';
import { sellerShareAmount } from '../src/stock';

/** SPEC §4.1 : vente d'un e-commerçant, exemple de référence obligatoire. */
const REFERENCE = {
  price: 12500,
  sellerShare: 7500,
  unitCost: 750,
  digecomTax: 500,
  sellerTax: 500,
};

describe('computeSale – exemple de référence (SPEC 4.1)', () => {
  it('tombe juste au KMF près', () => {
    expect(computeSale(REFERENCE)).toEqual({
      quantity: 1,
      revenue: 12500,
      cost: 750,
      sellerGross: 7500,
      digecomShare: 5000,
      grossMargin: 4250,
      digecomTax: 500,
      marginAfterTax: 3750,
      sellerTax: 500,
      sellerNet: 7000,
    });
  });

  it('simulation 100 produits exacte', () => {
    const r = computeSale({ ...REFERENCE, quantity: 100 });
    expect(r).toMatchObject({
      revenue: 1_250_000,
      cost: 75_000,
      digecomShare: 500_000,
      sellerGross: 750_000,
      grossMargin: 425_000,
      digecomTax: 50_000,
      sellerTax: 50_000,
      sellerNet: 700_000,
      marginAfterTax: 375_000,
    });
    // Coût total = achats 25 000 + expédition 50 000.
    expect(100 * 250 + 100 * 500).toBe(r.cost);
  });

  it('somme de ventes = vente unique multipliée', () => {
    const many = sumSales(Array.from({ length: 100 }, () => computeSale(REFERENCE)));
    expect(many).toEqual(computeSale({ ...REFERENCE, quantity: 100 }));
  });

  it('part vendeur en pourcentage : arrondi à l’unité (demi vers le haut)', () => {
    expect(sellerShareAmount(12500, 'PERCENT', 60)).toBe(7500);
    expect(sellerShareAmount(9999, 'PERCENT', 33)).toBe(3300); // 3299,67 → 3300
    expect(sellerShareAmount(1001, 'PERCENT', 50)).toBe(501); // 500,5 → 501
    const r = computeSale({ ...REFERENCE, sellerShare: sellerShareAmount(12500, 'PERCENT', 60) });
    expect(r.sellerNet).toBe(7000);
  });

  it('refuse les montants non entiers', () => {
    expect(() => computeSale({ ...REFERENCE, price: 12500.5 })).toThrow(RangeError);
  });
});

describe('computeTciSale (SPEC 4.3)', () => {
  it('CA, prime et coût ; partage Dig’eCom / Leader Junior non calculé', () => {
    expect(computeTciSale({ price: 17000, tciBonus: 3000, unitCost: 3200 })).toEqual({
      quantity: 1,
      revenue: 17000,
      tciBonus: 3000,
      cost: 3200,
      marginBeforeLeaderShare: 10800,
      leaderShare: null,
    });
  });
});

describe('computeSettlement (SPEC 4.2)', () => {
  const sale = { commission: 7500, sellerTax: 500 };

  it('10 ventes × 7 000 − 2 abonnements de 10 000 = 50 000 KMF', () => {
    const r = computeSettlement({
      sales: Array.from({ length: 10 }, () => sale),
      subscriptions: [10000, 10000],
      otherDeductions: 0,
      carriedOver: 0,
    });
    expect(r).toEqual({
      salesCount: 10,
      grossCommission: 75000,
      taxes: 5000,
      subscriptions: 20000,
      otherDeductions: 0,
      carriedOver: 0,
      balance: 50000,
      netToPay: 50000,
      carryForward: 0,
    });
  });

  it('solde négatif : rien à payer, reporté au cycle suivant', () => {
    const r = computeSettlement({
      sales: [sale],
      subscriptions: [10000, 10000],
      otherDeductions: 0,
      carriedOver: 0,
    });
    expect(r).toMatchObject({ balance: -13000, netToPay: 0, carryForward: -13000 });
    const next = computeSettlement({
      sales: Array.from({ length: 5 }, () => sale),
      subscriptions: [10000, 10000],
      otherDeductions: 0,
      carriedOver: r.carryForward,
    });
    expect(next).toMatchObject({ balance: 35000 - 20000 - 13000, netToPay: 2000, carryForward: 0 });
  });

  it('corrections (retours après vente) diminuent la commission', () => {
    const r = computeSettlement({
      sales: [sale, sale, { commission: -7500, sellerTax: -500 }],
      subscriptions: [],
      otherDeductions: 1000,
      carriedOver: 0,
    });
    expect(r).toMatchObject({
      salesCount: 1,
      grossCommission: 7500,
      taxes: 500,
      otherDeductions: 1000,
      netToPay: 6000,
    });
  });
});

describe('cycles et semaines (Indian/Comoro)', () => {
  it('cycle de 14 jours depuis la date d’ancrage', () => {
    expect(settlementCycle('2026-01-05', 14, '2026-01-05')).toEqual({
      index: 0,
      start: '2026-01-05',
      end: '2026-01-19',
    });
    expect(settlementCycle('2026-01-05', 14, '2026-01-18')).toEqual({
      index: 0,
      start: '2026-01-05',
      end: '2026-01-19',
    });
    expect(settlementCycle('2026-01-05', 14, '2026-11-08')).toEqual({
      index: 21,
      start: '2026-10-26',
      end: '2026-11-09',
    });
  });

  it('semaine = lundi → dimanche', () => {
    expect(weekStart('2026-11-08')).toBe('2026-11-02'); // dimanche → lundi précédent
    expect(weekStart('2026-11-09')).toBe('2026-11-09'); // lundi
  });
});
