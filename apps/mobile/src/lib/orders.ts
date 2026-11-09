import {
  type DeliveryMode,
  type OrderAction,
  type OrderStatus,
  type OrderView,
} from '@digecom/shared';

/** Motifs de refus proposés au vendeur (prototype). « Autre » ouvre une saisie libre. */
export const REFUSE_REASONS = [
  'Client a changé d’avis',
  'Produit ne correspond pas',
  'Prix trop élevé',
  'Client absent',
  'Autre',
] as const;

/** Actions du vendeur sur sa commande, dans l'ordre d'affichage. */
export const SELLER_ACTIONS: OrderAction[] = ['sellerConfirm', 'markSold', 'markRefused', 'cancel'];

/** Libellé du bouton de réception selon le mode de remise. */
export function receiveLabel(mode: DeliveryMode): string {
  return mode === 'PICKUP' ? 'J’ai récupéré au site' : 'J’ai reçu le produit';
}

/** Ce que le vendeur doit faire (encart « À faire » de l'accueil). */
export function todoOf(o: OrderView): string | null {
  if (o.actions.includes('sellerConfirm')) return receiveLabel(o.deliveryMode);
  if (o.actions.includes('markSold')) return 'Le client a-t-il pris le produit ?';
  return null;
}

const ORDER_PATH: OrderStatus[] = [
  'NEW',
  'CONFIRMED',
  'PREPARING',
  'READY',
  'ASSIGNED',
  'OUT_FOR_DELIVERY',
  'HANDED_OVER',
  'SOLD',
];

/** Frise simplifiée pour le terrain. */
export function timeline(o: OrderView): { label: string; done: boolean; current?: boolean }[] {
  const steps: { label: string; reached: OrderStatus }[] =
    o.deliveryMode === 'PICKUP'
      ? [
          { label: 'Commande enregistrée', reached: 'NEW' },
          { label: 'Préparée au site', reached: 'READY' },
          { label: 'Récupérée au site', reached: 'HANDED_OVER' },
          { label: 'Client a pris', reached: 'SOLD' },
        ]
      : [
          { label: 'Commande enregistrée', reached: 'NEW' },
          { label: 'Préparée au site', reached: 'READY' },
          { label: 'Livreur en route', reached: 'OUT_FOR_DELIVERY' },
          {
            label: o.deliveryMode === 'TO_SELLER' ? 'Remise à toi' : 'Remise au client',
            reached: 'HANDED_OVER',
          },
          { label: 'Client a pris', reached: 'SOLD' },
        ];
  const idx = ORDER_PATH.indexOf(o.status);
  const off = idx === -1;
  return steps.map((st, i) => {
    const done = !off && idx >= ORDER_PATH.indexOf(st.reached);
    const nextUndone =
      !off && !done && (i === 0 || idx >= ORDER_PATH.indexOf(steps[i - 1]!.reached));
    return { label: st.label, done, current: nextUndone };
  });
}

/** Net du vendeur sur une commande (instantanés figés à la création). */
export function sellerNet(o: OrderView): number {
  return o.items.reduce((s, i) => s + ((i.sellerShare ?? 0) - i.sellerTax) * i.quantity, 0);
}
