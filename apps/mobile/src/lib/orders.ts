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

/** Ce qui se passe maintenant, en une phrase, pour l'e-commerçant. */
export function statusHint(o: OrderView): string {
  const courier = o.courier?.fullName ?? 'Le livreur';
  switch (o.status) {
    case 'NEW':
      return `Commande reçue par le site de ${o.site.name}, en attente de confirmation.`;
    case 'CONFIRMED':
    case 'PREPARING':
      return `Le site de ${o.site.name} prépare ta commande.`;
    case 'READY':
      return o.deliveryMode === 'PICKUP'
        ? `Ta commande est prête : viens la récupérer au site de ${o.site.name}.`
        : 'Ta commande est prête, on cherche un livreur.';
    case 'ASSIGNED':
      return `${courier} va récupérer ta commande au site.`;
    case 'OUT_FOR_DELIVERY':
      return o.deliveryMode === 'TO_CUSTOMER'
        ? `${courier} est en route vers ton client.`
        : `${courier} est en route vers toi.`;
    case 'HANDED_OVER':
      return o.actions.includes('sellerConfirm')
        ? 'Le produit t’a été remis : confirme la réception.'
        : 'Produit remis. Indique si le client l’a pris.';
    case 'SOLD':
      return 'Vente validée : ta commission est ajoutée à ton solde.';
    case 'DELIVERY_FAILED':
      return 'La livraison a échoué. Le produit retourne au site.';
    case 'REFUSED':
      return 'Le client a refusé. Aucune commission sur cette vente.';
    case 'RETURN_IN_PROGRESS':
      return 'Le produit est en cours de retour au site.';
    case 'RETURNED_TO_STOCK':
      return 'Le produit est revenu en stock.';
    case 'DAMAGED':
      return 'Le produit a été déclaré endommagé au retour.';
    case 'CANCELLED':
      return 'Commande annulée.';
  }
}
