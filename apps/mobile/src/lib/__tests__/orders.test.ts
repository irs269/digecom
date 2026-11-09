import type { OrderView } from '@digecom/shared';
import { receiveLabel, sellerNet, statusHint, timeline, todoOf } from '../orders';

const order = (patch: Partial<OrderView>): OrderView =>
  ({
    id: 'o1',
    number: 'C-0001',
    status: 'NEW',
    deliveryMode: 'TO_SELLER',
    actions: [],
    items: [
      {
        id: 'i1',
        product: { id: 'p1', sku: 'S1', name: 'Ventilateur', quality: null },
        quantity: 2,
        unitPrice: 15000,
        sellerShare: 7500,
        sellerTax: 500,
        digecomTax: 0,
        tciBonus: null,
        unitCost: null,
      },
    ],
    ...patch,
  }) as OrderView;

test('net vendeur : (part − taxe) × quantité, instantanés de la commande', () => {
  expect(sellerNet(order({}))).toBe(14000);
});

test('à faire : réception puis décision du client', () => {
  expect(todoOf(order({ actions: ['sellerConfirm'] }))).toBe('J’ai reçu le produit');
  expect(todoOf(order({ actions: ['markSold', 'markRefused'] }))).toBe(
    'Le client a-t-il pris le produit ?',
  );
  expect(todoOf(order({ actions: [] }))).toBeNull();
  expect(receiveLabel('PICKUP')).toBe('J’ai récupéré au site');
});

test('frise : étapes franchies et étape courante', () => {
  const steps = timeline(order({ status: 'OUT_FOR_DELIVERY' }));
  expect(steps.map((s) => s.done)).toEqual([true, true, true, false, false]);
  expect(steps.findIndex((s) => s.current)).toBe(3);
  expect(timeline(order({ status: 'REFUSED' })).every((s) => !s.done)).toBe(true);
});

test('explication du statut pour l’e-commerçant', () => {
  const o = (p: Partial<OrderView>) =>
    order({ site: { id: 's', name: 'Moroni' }, courier: null, ...p } as Partial<OrderView>);
  expect(statusHint(o({ status: 'PREPARING' }))).toBe('Le site de Moroni prépare ta commande.');
  expect(
    statusHint(
      o({
        status: 'OUT_FOR_DELIVERY',
        deliveryMode: 'TO_CUSTOMER',
        courier: { id: 'c', fullName: 'Karim Bacar', phone: '+269' },
      }),
    ),
  ).toBe('Karim Bacar est en route vers ton client.');
  expect(statusHint(o({ status: 'HANDED_OVER', actions: ['sellerConfirm'] }))).toBe(
    'Le produit t’a été remis : confirme la réception.',
  );
});
