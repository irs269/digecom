import { describe, expect, it } from 'vitest';
import { canCallDirectly, type CallPeer } from './calls';

const u = (
  id: string,
  role: CallPeer['role'],
  islandId: string | null,
  leaderId: string | null = null,
): CallPeer => ({
  id,
  role,
  islandId,
  leaderId,
});

const admin = u('admin', 'ADMIN', null);
const logGC = u('log-gc', 'LOGISTICS_ASSISTANT', 'GC');
const courierGC = u('karim', 'COURIER', 'GC');
const courierAN = u('djamal', 'COURIER', 'AN');
const ali = u('ali', 'LEADER_SENIOR', 'GC');
const fatima = u('fatima', 'SELLER', 'GC', 'ali');
const autreVendeur = u('zainaba', 'SELLER', 'MO', 'moinaecha');
const kamaria = u('kamaria', 'LEADER_JUNIOR', 'AN');
const tci = u('anlia', 'TELECONSULTANT', 'AN', 'kamaria');
const caissier = u('caisse', 'CASHIER', 'GC');

describe('canCallDirectly', () => {
  it('administrateur ↔ tout le monde, dans les deux sens', () => {
    for (const x of [logGC, courierAN, fatima, tci, caissier]) {
      expect(canCallDirectly(admin, x)).toBe(true);
      expect(canCallDirectly(x, admin)).toBe(true);
    }
  });

  it('logistique ↔ livreurs et e-commerçants de son île seulement', () => {
    expect(canCallDirectly(logGC, courierGC)).toBe(true);
    expect(canCallDirectly(fatima, logGC)).toBe(true);
    expect(canCallDirectly(logGC, courierAN)).toBe(false);
    expect(canCallDirectly(logGC, autreVendeur)).toBe(false);
    expect(canCallDirectly(logGC, caissier)).toBe(false);
  });

  it('leaders ↔ leur équipe seulement', () => {
    expect(canCallDirectly(ali, fatima)).toBe(true);
    expect(canCallDirectly(fatima, ali)).toBe(true);
    expect(canCallDirectly(ali, autreVendeur)).toBe(false);
    expect(canCallDirectly(kamaria, tci)).toBe(true);
    expect(canCallDirectly(ali, tci)).toBe(false);
  });

  it('pas d’appel direct entre terrain, ni vers soi-même', () => {
    expect(canCallDirectly(fatima, courierGC)).toBe(false);
    expect(canCallDirectly(courierGC, courierGC)).toBe(false);
    expect(canCallDirectly(caissier, fatima)).toBe(false);
  });
});
