import { ROLES, type Role } from '@digecom/shared';
import type { AuthUser } from '../auth/auth.types';
import { ScopeService } from './scope.service';

const scope = new ScopeService();
const ORDER_FIELDS = { island: 'islandId', leader: 'leaderId', owner: 'sellerId' };

function user(role: Role, extra: Partial<AuthUser> = {}): AuthUser {
  return {
    id: `u-${role}`,
    role,
    islandId: 'island-MO',
    siteId: null,
    leaderId: role === 'SELLER' || role === 'TELECONSULTANT' ? 'leader-1' : null,
    mustChangePassword: false,
    ...extra,
  };
}

const EXPECTED: Record<Role, Record<string, unknown>> = {
  ADMIN: {},
  FINANCE_MANAGER: {},
  ACCOUNTANT: {},
  ACCOUNTANT_ASSISTANT: {},
  CASHIER: { islandId: 'island-MO' },
  STOCK_MANAGER: { islandId: 'island-MO' },
  LOGISTICS_ASSISTANT: { islandId: 'island-MO' },
  COURIER: { islandId: 'island-MO' },
  LEADER_SENIOR: { leaderId: 'u-LEADER_SENIOR' },
  LEADER_JUNIOR: { leaderId: 'u-LEADER_JUNIOR' },
  SELLER: { sellerId: 'u-SELLER' },
  TELECONSULTANT: { sellerId: 'u-TELECONSULTANT' },
};

describe('ScopeService.filter', () => {
  it.each(ROLES.map((r) => [r]))('%s : filtre conforme à PERMISSIONS.md', (role) => {
    expect(scope.filter(user(role), ORDER_FIELDS)).toEqual(EXPECTED[role]);
  });

  it('les rôles globaux acceptent un filtre île facultatif', () => {
    expect(scope.filter(user('FINANCE_MANAGER'), ORDER_FIELDS, 'island-GC')).toEqual({
      islandId: 'island-GC',
    });
  });

  it("un rôle d'île ignore le filtre île demandé (reste sur son île)", () => {
    expect(scope.filter(user('CASHIER'), ORDER_FIELDS, 'island-GC')).toEqual({
      islandId: 'island-MO',
    });
  });

  it("un rôle d'île sans île ne voit rien", () => {
    expect(scope.filter(user('CASHIER', { islandId: null }), ORDER_FIELDS)).toEqual({
      id: '__hors_perimetre__',
    });
  });

  it("une entité sans la colonne exigée n'est pas visible", () => {
    expect(scope.filter(user('LEADER_SENIOR'), { island: 'islandId' })).toEqual({
      id: '__hors_perimetre__',
    });
    expect(scope.filter(user('SELLER'), { island: 'islandId' })).toEqual({
      id: '__hors_perimetre__',
    });
  });
});

describe('ScopeService.users', () => {
  it('global : tout', () => expect(scope.users(user('ADMIN'))).toEqual({}));
  it('île : soi + son île', () =>
    expect(scope.users(user('STOCK_MANAGER'))).toEqual({
      OR: [{ id: 'u-STOCK_MANAGER' }, { islandId: 'island-MO' }],
    }));
  it('leader : soi + son équipe', () =>
    expect(scope.users(user('LEADER_JUNIOR'))).toEqual({
      OR: [{ id: 'u-LEADER_JUNIOR' }, { leaderId: 'u-LEADER_JUNIOR' }],
    }));
  it('vendeur : soi uniquement', () =>
    expect(scope.users(user('TELECONSULTANT'))).toEqual({ id: 'u-TELECONSULTANT' }));
});

describe('ScopeService.catalogLeaderId', () => {
  it('un vendeur voit le catalogue de son leader', () => {
    expect(scope.catalogLeaderId(user('SELLER'))).toBe('leader-1');
    expect(scope.catalogLeaderId(user('TELECONSULTANT'))).toBe('leader-1');
  });
  it('un leader voit son propre catalogue', () => {
    expect(scope.catalogLeaderId(user('LEADER_SENIOR'))).toBe('u-LEADER_SENIOR');
  });
  it('les autres rôles : pas de catalogue imposé', () => {
    expect(scope.catalogLeaderId(user('ADMIN'))).toBeNull();
  });
});

describe('ScopeService.ensureFound', () => {
  it('lève 404 hors périmètre', () => {
    expect(() => scope.ensureFound(null, 'Commande')).toThrow('Commande introuvable');
  });
});
