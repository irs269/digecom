import { describe, expect, it } from 'vitest';
import {
  channelEnabled,
  REPORT_TYPES,
  reportsForRole,
  reportTotals,
  simulation,
  type ReportColumn,
} from '../src/reports';

describe('rapports', () => {
  it('simulation 100 produits = SPEC §4.1', () => {
    const s = simulation(100);
    expect(s.purchases).toBe(25_000);
    expect(s.shipping).toBe(50_000);
    expect(s.sale).toMatchObject({
      cost: 75_000,
      revenue: 1_250_000,
      digecomShare: 500_000,
      sellerGross: 750_000,
      grossMargin: 425_000,
      digecomTax: 50_000,
      sellerTax: 50_000,
      sellerNet: 700_000,
      marginAfterTax: 375_000,
    });
  });

  it('totaux : seules les colonnes marquées, valeurs nulles ignorées', () => {
    const columns: ReportColumn[] = [
      { key: 'name', label: 'Nom', kind: 'text' },
      { key: 'revenue', label: 'CA', kind: 'kmf', total: true },
      { key: 'unitCost', label: 'Coût unitaire', kind: 'kmf' },
    ];
    expect(
      reportTotals(columns, [
        { name: 'a', revenue: 12_500, unitCost: 750 },
        { name: 'b', revenue: null, unitCost: 750 },
        { name: 'c', revenue: 25_000, unitCost: 750 },
      ]),
    ).toEqual({ revenue: 37_500 });
  });

  it('leaders : rapports de leur équipe seulement', () => {
    expect(reportsForRole('ADMIN')).toEqual([...REPORT_TYPES]);
    expect(reportsForRole('LEADER_SENIOR')).toEqual(['daily', 'weekly', 'product', 'seller']);
    expect(reportsForRole('LEADER_JUNIOR')).toContain('tci');
    expect(reportsForRole('LEADER_SENIOR')).not.toContain('margins');
  });

  it('préférences : push actif par défaut, SMS et WhatsApp inactifs', () => {
    expect(channelEnabled({}, 'ORDER_NEW', 'push')).toBe(true);
    expect(channelEnabled({}, 'ORDER_NEW', 'sms')).toBe(false);
    expect(channelEnabled({ ORDER_NEW: { push: false } }, 'ORDER_NEW', 'push')).toBe(false);
    expect(channelEnabled({ ORDER_NEW: { sms: true } }, 'ORDER_NEW', 'sms')).toBe(true);
  });
});
