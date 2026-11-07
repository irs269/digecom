import { describe, expect, it } from 'vitest';
import { businessToday, startOfBusinessDay, toBusinessDay } from '../src/dates';
import { createUserSchema, changePasswordSchema } from '../src/organization';
import { formatSettingValue, SETTINGS, SETTING_KEYS } from '../src/settings';

describe('registre des paramètres', () => {
  it('chaque valeur par défaut respecte son schéma', () => {
    for (const key of SETTING_KEYS) {
      expect(SETTINGS[key].schema.safeParse(SETTINGS[key].defaultValue).success, key).toBe(true);
    }
  });

  it('contient les clés de DATA-MODEL.md', () => {
    expect(SETTING_KEYS).toEqual(
      expect.arrayContaining([
        'tax.digecom',
        'tax.seller',
        'subscription.weekly',
        'settlement.cycleDays',
        'settlement.anchorDate',
        'tci.bonusMin',
        'tci.bonusMax',
        'delivery.noCourierAlertMinutes',
        'delivery.feePerRun',
        'stock.lowThresholdDefault',
        'stock.unsoldDaysAlert',
      ]),
    );
  });

  it('refuse les montants négatifs ou décimaux', () => {
    expect(SETTINGS['subscription.weekly'].schema.safeParse(-1).success).toBe(false);
    expect(SETTINGS['subscription.weekly'].schema.safeParse(10.5).success).toBe(false);
    expect(SETTINGS['tax.digecom'].schema.safeParse({ mode: 'PERCENT', value: 120 }).success).toBe(
      false,
    );
  });

  it('formate les valeurs pour l’écran', () => {
    expect(formatSettingValue('tax.digecom', { mode: 'FIXED', value: 500 })).toBe('500 KMF');
    expect(formatSettingValue('subscription.weekly', 10000)).toBe('10 000 KMF / semaine');
    expect(formatSettingValue('catalog.requireApproval', false)).toBe('Non');
  });
});

describe('dates métier (Indian/Comoro, UTC+3)', () => {
  it('le jour métier bascule à 21:00 UTC', () => {
    expect(toBusinessDay(new Date('2026-11-07T20:59:59Z'))).toBe('2026-11-07');
    expect(toBusinessDay(new Date('2026-11-07T21:00:00Z'))).toBe('2026-11-08');
  });

  it('début de journée = 00:00 heure des Comores', () => {
    expect(startOfBusinessDay('2026-11-08').toISOString()).toBe('2026-11-07T21:00:00.000Z');
    expect(() => startOfBusinessDay('2026-02-30')).toThrow(RangeError);
  });

  it('businessToday renvoie un jour AAAA-MM-JJ', () => {
    expect(businessToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('schémas organisation', () => {
  it('normalise le téléphone et l’e-mail vide', () => {
    const r = createUserSchema.parse({
      fullName: 'Test',
      phone: '330 00 99',
      email: '',
      role: 'ADMIN',
    });
    expect(r.phone).toBe('+2693300099');
    expect(r.email).toBeNull();
    expect(r.leaderId).toBeNull();
  });

  it('impose la politique de mot de passe', () => {
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'a', newPassword: 'court1' }).success,
    ).toBe(false);
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'a', newPassword: 'sans-chiffre-ici' })
        .success,
    ).toBe(false);
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'a', newPassword: 'Nouveau-mdp-2026' })
        .success,
    ).toBe(true);
  });
});

describe('formatPhone', () => {
  it('formate un numéro comorien normalisé', async () => {
    const { formatPhone } = await import('../src/schemas');
    expect(formatPhone('+2693300003')).toBe('+269 330 00 03');
    expect(formatPhone('autre')).toBe('autre');
  });
});
