import { describe, expect, it } from 'vitest';
import {
  availableActions,
  checkTransition,
  statusAfterConfirmations,
  taxAmount,
  type ActorContext,
  type DeliveryMode,
  type HandoverKind,
  type OrderAction,
  type OrderContext,
  type OrderStatus,
} from '../src/orders';
import type { Role } from '../src/roles';

const order = (
  status: OrderStatus,
  deliveryMode: DeliveryMode = 'TO_CUSTOMER',
  confirmations: HandoverKind[] = [],
): OrderContext => ({
  status,
  deliveryMode,
  confirmations,
});
const actor = (role: Role, extra: Partial<ActorContext> = {}): ActorContext => ({
  role,
  isSeller: false,
  isCourier: false,
  ...extra,
});
const ok = (a: OrderAction, o: OrderContext, who: ActorContext) =>
  checkTransition(a, o, who).allowed;

describe('OrderStateMachine : transitions valides', () => {
  const logistics = actor('LOGISTICS_ASSISTANT');
  const seller = actor('SELLER', { isSeller: true });
  const courier = actor('COURIER', { isCourier: true });

  it.each<[OrderAction, OrderContext, ActorContext]>([
    ['confirm', order('NEW'), logistics],
    ['prepare', order('CONFIRMED'), logistics],
    ['ready', order('PREPARING'), logistics],
    ['assign', order('READY', 'TO_SELLER'), logistics],
    ['assign', order('ASSIGNED', 'TO_CUSTOMER'), logistics],
    ['accept', order('READY', 'TO_CUSTOMER'), actor('COURIER', { hasPendingOffer: true })],
    ['pickup', order('ASSIGNED', 'TO_SELLER'), courier],
    ['handover', order('OUT_FOR_DELIVERY', 'TO_CUSTOMER'), courier],
    ['handover', order('OUT_FOR_DELIVERY', 'TO_SELLER'), courier],
    ['sellerConfirm', order('OUT_FOR_DELIVERY', 'TO_SELLER', ['TO_SELLER']), seller],
    ['sellerConfirm', order('READY', 'PICKUP'), seller],
    ['siteHandover', order('READY', 'PICKUP'), logistics],
    ['markSold', order('HANDED_OVER'), seller],
    ['markSold', order('HANDED_OVER'), courier],
    ['markSold', order('HANDED_OVER'), logistics],
    ['markRefused', order('HANDED_OVER'), seller],
    ['fail', order('OUT_FOR_DELIVERY', 'TO_CUSTOMER'), courier],
    ['restock', order('RETURN_IN_PROGRESS'), actor('STOCK_MANAGER')],
    ['damaged', order('RETURN_IN_PROGRESS'), actor('STOCK_MANAGER')],
    ['cancel', order('NEW'), seller],
    ['cancel', order('READY'), logistics],
    ['changeMode', order('PREPARING'), logistics],
    ['returnAfterSale', order('SOLD'), actor('ADMIN')],
  ])('%s depuis %o', (action, o, who) => {
    expect(checkTransition(action, o, who)).toEqual({ allowed: true });
  });
});

describe('OrderStateMachine : transitions invalides', () => {
  it('statut de départ non prévu → CONFLICT (409)', () => {
    expect(checkTransition('confirm', order('READY'), actor('ADMIN'))).toEqual({
      allowed: false,
      reason: 'CONFLICT',
    });
    expect(
      checkTransition('pickup', order('READY'), actor('COURIER', { isCourier: true })).reason,
    ).toBe('CONFLICT');
    expect(checkTransition('cancel', order('OUT_FOR_DELIVERY'), actor('ADMIN')).reason).toBe(
      'CONFLICT',
    );
    expect(checkTransition('markSold', order('OUT_FOR_DELIVERY'), actor('ADMIN')).reason).toBe(
      'CONFLICT',
    );
    expect(checkTransition('restock', order('SOLD'), actor('ADMIN')).reason).toBe('CONFLICT');
    expect(checkTransition('changeMode', order('OUT_FOR_DELIVERY'), actor('ADMIN')).reason).toBe(
      'CONFLICT',
    );
  });

  it('mode de remise incompatible → CONFLICT', () => {
    expect(checkTransition('assign', order('READY', 'PICKUP'), actor('ADMIN')).reason).toBe(
      'CONFLICT',
    );
    expect(
      checkTransition('siteHandover', order('READY', 'TO_CUSTOMER'), actor('ADMIN')).reason,
    ).toBe('CONFLICT');
    expect(
      checkTransition(
        'sellerConfirm',
        order('OUT_FOR_DELIVERY', 'TO_CUSTOMER'),
        actor('SELLER', { isSeller: true }),
      ).reason,
    ).toBe('CONFLICT');
  });

  it('confirmation déjà donnée → CONFLICT', () => {
    expect(
      checkTransition(
        'handover',
        order('OUT_FOR_DELIVERY', 'TO_SELLER', ['TO_SELLER']),
        actor('COURIER', { isCourier: true }),
      ).reason,
    ).toBe('CONFLICT');
  });

  it('rôle non autorisé → FORBIDDEN (403)', () => {
    expect(checkTransition('confirm', order('NEW'), actor('FINANCE_MANAGER')).reason).toBe(
      'FORBIDDEN',
    );
    expect(
      checkTransition('restock', order('RETURN_IN_PROGRESS'), actor('LOGISTICS_ASSISTANT')).reason,
    ).toBe('FORBIDDEN');
    expect(
      checkTransition('returnAfterSale', order('SOLD'), actor('LOGISTICS_ASSISTANT')).reason,
    ).toBe('FORBIDDEN');
    expect(checkTransition('accept', order('READY'), actor('ADMIN')).reason).toBe('FORBIDDEN');
  });

  it('propriétaires : seulement leurs commandes', () => {
    expect(ok('markSold', order('HANDED_OVER'), actor('SELLER'))).toBe(false);
    expect(ok('pickup', order('ASSIGNED'), actor('COURIER'))).toBe(false);
    expect(ok('accept', order('READY'), actor('COURIER'))).toBe(false);
    expect(ok('cancel', order('CONFIRMED'), actor('SELLER', { isSeller: true }))).toBe(false);
    expect(ok('confirm', order('NEW'), actor('SELLER', { isSeller: true }))).toBe(false);
    expect(ok('sellerConfirm', order('READY', 'PICKUP'), actor('ADMIN'))).toBe(false);
  });
});

describe('remises doubles', () => {
  it('TO_SELLER : livreur + vendeur', () => {
    expect(statusAfterConfirmations('TO_SELLER', 'OUT_FOR_DELIVERY', ['TO_SELLER'])).toBe(
      'OUT_FOR_DELIVERY',
    );
    expect(
      statusAfterConfirmations('TO_SELLER', 'OUT_FOR_DELIVERY', ['TO_SELLER', 'SELLER_RECEIVED']),
    ).toBe('HANDED_OVER');
  });
  it('TO_CUSTOMER : livreur seul', () => {
    expect(statusAfterConfirmations('TO_CUSTOMER', 'OUT_FOR_DELIVERY', ['TO_CUSTOMER'])).toBe(
      'HANDED_OVER',
    );
  });
  it('PICKUP : site + vendeur', () => {
    expect(statusAfterConfirmations('PICKUP', 'READY', ['SITE_HANDOVER'])).toBe('READY');
    expect(statusAfterConfirmations('PICKUP', 'READY', ['SELLER_RECEIVED', 'SITE_HANDOVER'])).toBe(
      'HANDED_OVER',
    );
  });
});

describe('boutons proposés', () => {
  it('lecture seule : aucune action pour le responsable financier', () => {
    expect(availableActions(order('NEW'), actor('FINANCE_MANAGER'))).toEqual([]);
  });
  it('logistique sur une commande prête à livrer', () => {
    expect(availableActions(order('READY', 'TO_SELLER'), actor('LOGISTICS_ASSISTANT'))).toEqual([
      'assign',
      'cancel',
      'changeMode',
    ]);
  });
});

describe('taxes (exemple 4.1)', () => {
  it('500 KMF fixes, ou pourcentage de la base', () => {
    expect(taxAmount({ mode: 'FIXED', value: 500 }, 7500)).toBe(500);
    expect(taxAmount({ mode: 'PERCENT', value: 10 }, 5000)).toBe(500);
  });
});
