import type { CallEvent } from './calls';
import { z } from 'zod';
import { hasPermission, type Permission } from './permissions';
import type { Role } from './roles';
import type { IslandView } from './organization';
import { phoneSchema } from './schemas';
import type { AmountRule } from './settings';

// --- Statuts et modes (docs/DATA-MODEL.md) ---------------------------------------------------

export const ORDER_STATUSES = [
  'NEW',
  'CONFIRMED',
  'PREPARING',
  'READY',
  'ASSIGNED',
  'OUT_FOR_DELIVERY',
  'HANDED_OVER',
  'SOLD',
  'DELIVERY_FAILED',
  'REFUSED',
  'RETURN_IN_PROGRESS',
  'RETURNED_TO_STOCK',
  'DAMAGED',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  NEW: 'Nouvelle',
  CONFIRMED: 'Confirmée',
  PREPARING: 'En préparation',
  READY: 'Prête',
  ASSIGNED: 'Livreur affecté',
  OUT_FOR_DELIVERY: 'En livraison',
  HANDED_OVER: 'Remise effectuée',
  SOLD: 'Vendue',
  DELIVERY_FAILED: 'Livraison échouée',
  REFUSED: 'Refusée par le client',
  RETURN_IN_PROGRESS: 'Retour à contrôler',
  RETURNED_TO_STOCK: 'Remise en stock',
  DAMAGED: 'Endommagée',
  CANCELLED: 'Annulée',
};

export const ORDER_STATUS_TONE: Record<OrderStatus, 'green' | 'orange' | 'blue' | 'red'> = {
  NEW: 'blue',
  CONFIRMED: 'blue',
  PREPARING: 'blue',
  READY: 'orange',
  ASSIGNED: 'orange',
  OUT_FOR_DELIVERY: 'orange',
  HANDED_OVER: 'orange',
  SOLD: 'green',
  DELIVERY_FAILED: 'red',
  REFUSED: 'red',
  RETURN_IN_PROGRESS: 'red',
  RETURNED_TO_STOCK: 'blue',
  DAMAGED: 'red',
  CANCELLED: 'red',
};

/** Statuts où la marchandise est encore au site (réservée, pas sortie). */
export const BEFORE_EXIT: readonly OrderStatus[] = [
  'NEW',
  'CONFIRMED',
  'PREPARING',
  'READY',
  'ASSIGNED',
];

export const DELIVERY_MODES = ['TO_SELLER', 'TO_CUSTOMER', 'PICKUP'] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];
export const DELIVERY_MODE_LABELS: Record<DeliveryMode, string> = {
  TO_SELLER: 'Livraison à l’e-commerçant',
  TO_CUSTOMER: 'Livraison directe au client',
  PICKUP: 'Retrait au site',
};
export const DELIVERY_MODE_SHORT: Record<DeliveryMode, string> = {
  TO_SELLER: 'À l’e-commerçant',
  TO_CUSTOMER: 'Au client',
  PICKUP: 'Retrait site',
};

export const HANDOVER_KINDS = [
  'PICKUP_FROM_SITE',
  'TO_SELLER',
  'TO_CUSTOMER',
  'SELLER_RECEIVED',
  'SITE_HANDOVER',
] as const;
export type HandoverKind = (typeof HANDOVER_KINDS)[number];

export const FAIL_REASONS = [
  'Client injoignable',
  'Adresse introuvable',
  'Client a refusé',
  'Client absent',
  'Autre',
] as const;

// --- Machine à états --------------------------------------------------------------------------

export const ORDER_ACTIONS = [
  'confirm',
  'prepare',
  'ready',
  'assign',
  'accept',
  'pickup',
  'handover',
  'sellerConfirm',
  'siteHandover',
  'markSold',
  'markRefused',
  'fail',
  'restock',
  'damaged',
  'cancel',
  'changeMode',
  'returnAfterSale',
] as const;
export type OrderAction = (typeof ORDER_ACTIONS)[number];

export interface OrderContext {
  status: OrderStatus;
  deliveryMode: DeliveryMode;
  /** Confirmations déjà enregistrées (remise double). */
  confirmations: HandoverKind[];
}

export interface ActorContext {
  role: Role;
  /** L'acteur est le vendeur de la commande. */
  isSeller: boolean;
  /** L'acteur est le livreur affecté. */
  isCourier: boolean;
  /** L'acteur a reçu une offre en attente pour cette commande. */
  hasPendingOffer?: boolean;
}

interface ActionRule {
  label: string;
  from: readonly OrderStatus[];
  /** Statut d'arrivée ; `null` = dépend de la situation (remises doubles, retours). */
  to: OrderStatus | null;
  modes?: readonly DeliveryMode[];
  /** Permission requise (back-office), ou rôle propriétaire (vendeur / livreur). */
  permission?: Permission;
  allowSeller?: boolean;
  allowCourier?: boolean;
  /** Condition supplémentaire sur la commande. */
  when?: (o: OrderContext) => boolean;
  /** Motif obligatoire. */
  needsReason?: boolean;
}

const DELIVERY: readonly DeliveryMode[] = ['TO_SELLER', 'TO_CUSTOMER'];

export const ORDER_RULES: Record<OrderAction, ActionRule> = {
  confirm: { label: 'Confirmer', from: ['NEW'], to: 'CONFIRMED', permission: 'orders:advance' },
  prepare: {
    label: 'Préparer',
    from: ['CONFIRMED'],
    to: 'PREPARING',
    permission: 'orders:advance',
  },
  ready: { label: 'Marquer prête', from: ['PREPARING'], to: 'READY', permission: 'orders:advance' },
  assign: {
    label: 'Affecter un livreur de l’île',
    from: ['READY', 'ASSIGNED'],
    to: 'ASSIGNED',
    modes: DELIVERY,
    permission: 'deliveries:assign_manual',
  },
  accept: {
    label: 'Accepter la course',
    from: ['READY'],
    to: 'ASSIGNED',
    modes: DELIVERY,
    permission: 'deliveries:accept',
  },
  pickup: {
    label: 'Récupérer au site',
    from: ['ASSIGNED'],
    to: 'OUT_FOR_DELIVERY',
    modes: DELIVERY,
    permission: 'deliveries:pickup',
    allowCourier: true,
  },
  handover: {
    label: 'Confirmer la remise',
    from: ['OUT_FOR_DELIVERY'],
    to: null,
    modes: DELIVERY,
    permission: 'deliveries:handover',
    allowCourier: true,
    when: (o) =>
      !o.confirmations.includes(o.deliveryMode === 'TO_SELLER' ? 'TO_SELLER' : 'TO_CUSTOMER'),
  },
  sellerConfirm: {
    label: 'Confirmer la réception',
    from: ['OUT_FOR_DELIVERY', 'READY'],
    to: null,
    modes: ['TO_SELLER', 'PICKUP'],
    allowSeller: true,
    when: (o) => !o.confirmations.includes('SELLER_RECEIVED'),
  },
  siteHandover: {
    label: 'Confirmer le retrait au site',
    from: ['READY'],
    to: null,
    modes: ['PICKUP'],
    permission: 'orders:advance',
    when: (o) => !o.confirmations.includes('SITE_HANDOVER'),
  },
  markSold: {
    label: 'Client a pris',
    from: ['HANDED_OVER'],
    to: 'SOLD',
    permission: 'orders:mark_sold',
    allowSeller: true,
    allowCourier: true,
  },
  markRefused: {
    label: 'Client a refusé',
    from: ['HANDED_OVER'],
    to: 'REFUSED',
    permission: 'orders:mark_refused',
    allowSeller: true,
    allowCourier: true,
    needsReason: true,
  },
  fail: {
    label: 'Livraison échouée',
    from: ['OUT_FOR_DELIVERY'],
    to: 'DELIVERY_FAILED',
    modes: DELIVERY,
    permission: 'deliveries:fail',
    allowCourier: true,
    needsReason: true,
  },
  restock: {
    label: 'Contrôler et remettre en stock',
    from: ['RETURN_IN_PROGRESS'],
    to: 'RETURNED_TO_STOCK',
    permission: 'orders:restock_return',
  },
  damaged: {
    label: 'Déclarer endommagée',
    from: ['RETURN_IN_PROGRESS'],
    to: 'DAMAGED',
    permission: 'orders:restock_return',
    needsReason: true,
  },
  cancel: {
    label: 'Annuler',
    from: ['NEW', 'CONFIRMED', 'PREPARING', 'READY'],
    to: 'CANCELLED',
    permission: 'orders:advance',
    allowSeller: true,
    needsReason: true,
  },
  changeMode: {
    label: 'Changer le mode de remise',
    from: ['NEW', 'CONFIRMED', 'PREPARING', 'READY'],
    to: null,
    permission: 'orders:change_mode',
  },
  returnAfterSale: {
    label: 'Retour après vente',
    from: ['SOLD'],
    to: 'RETURN_IN_PROGRESS',
    needsReason: true,
  },
};

/** Rôles « propriétaires » limités à leur propre périmètre. */
function ownerAllowed(rule: ActionRule, actor: ActorContext, action: OrderAction): boolean {
  if (actor.role === 'SELLER' || actor.role === 'TELECONSULTANT') {
    return !!rule.allowSeller && actor.isSeller;
  }
  if (actor.role === 'COURIER') {
    if (action === 'accept') return !!actor.hasPendingOffer;
    return !!rule.allowCourier && actor.isCourier;
  }
  return false;
}

export interface TransitionCheck {
  allowed: boolean;
  /** `CONFLICT` : transition non prévue depuis ce statut ; `FORBIDDEN` : rôle non autorisé. */
  reason?: 'CONFLICT' | 'FORBIDDEN';
}

/** Une action est-elle possible pour cette commande et cet acteur ? */
export function checkTransition(
  action: OrderAction,
  order: OrderContext,
  actor: ActorContext,
): TransitionCheck {
  const rule = ORDER_RULES[action];
  if (!rule.from.includes(order.status)) return { allowed: false, reason: 'CONFLICT' };
  if (rule.modes && !rule.modes.includes(order.deliveryMode))
    return { allowed: false, reason: 'CONFLICT' };
  if (
    action === 'cancel' &&
    (actor.role === 'SELLER' || actor.role === 'TELECONSULTANT') &&
    order.status !== 'NEW'
  ) {
    return { allowed: false, reason: 'FORBIDDEN' };
  }
  if (rule.when && !rule.when(order)) return { allowed: false, reason: 'CONFLICT' };

  const ownerRole =
    actor.role === 'SELLER' || actor.role === 'TELECONSULTANT' || actor.role === 'COURIER';
  let permitted: boolean;
  if (action === 'returnAfterSale') permitted = actor.role === 'ADMIN';
  else if (ownerRole) permitted = ownerAllowed(rule, actor, action);
  else if (action === 'sellerConfirm') permitted = false;
  else permitted = !!rule.permission && hasPermission(actor.role, rule.permission);
  return permitted ? { allowed: true } : { allowed: false, reason: 'FORBIDDEN' };
}

/** Actions proposées à l'écran pour cet acteur (boutons). */
export function availableActions(order: OrderContext, actor: ActorContext): OrderAction[] {
  return ORDER_ACTIONS.filter((a) => checkTransition(a, order, actor).allowed);
}

/**
 * Statut atteint après une confirmation de remise (remises doubles) :
 * - TO_SELLER : livreur (TO_SELLER) + vendeur (SELLER_RECEIVED) → HANDED_OVER ;
 * - TO_CUSTOMER : livreur (TO_CUSTOMER) → HANDED_OVER ;
 * - PICKUP : site (SITE_HANDOVER) + vendeur (SELLER_RECEIVED) → HANDED_OVER.
 */
export function statusAfterConfirmations(
  mode: DeliveryMode,
  current: OrderStatus,
  confirmations: HandoverKind[],
): OrderStatus {
  const has = (k: HandoverKind) => confirmations.includes(k);
  if (mode === 'TO_CUSTOMER') return has('TO_CUSTOMER') ? 'HANDED_OVER' : current;
  if (mode === 'TO_SELLER')
    return has('TO_SELLER') && has('SELLER_RECEIVED') ? 'HANDED_OVER' : current;
  return has('SITE_HANDOVER') && has('SELLER_RECEIVED') ? 'HANDED_OVER' : current;
}

/** Étapes de la frise selon le mode. */
export function timelineSteps(mode: DeliveryMode): OrderStatus[] {
  return mode === 'PICKUP'
    ? ['NEW', 'CONFIRMED', 'PREPARING', 'READY', 'HANDED_OVER', 'SOLD']
    : [
        'NEW',
        'CONFIRMED',
        'PREPARING',
        'READY',
        'ASSIGNED',
        'OUT_FOR_DELIVERY',
        'HANDED_OVER',
        'SOLD',
      ];
}

// --- Calcul des snapshots ---------------------------------------------------------------------

/**
 * Taxe à partir d'une règle (fixe ou %). Base des pourcentages : part brute vendeur pour la taxe
 * e-commerçant, part commerciale Dig'eCom (prix − part vendeur) pour la taxe Dig'eCom.
 */
export function taxAmount(rule: AmountRule, base: number): number {
  return rule.mode === 'FIXED' ? rule.value : Math.round((base * rule.value) / 100);
}

// --- Schémas d'entrée -------------------------------------------------------------------------

const reason = z.string().trim().min(3, 'Motif requis (3 caractères minimum)').max(500);

export const orderItemInputSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(100),
});

export const createOrderSchema = z.object({
  /** Pour le compte de (logistique, admin) ; ignoré pour un vendeur (lui-même). */
  sellerId: z.string().optional(),
  siteId: z.string().optional(),
  items: z.array(orderItemInputSchema).min(1, 'Au moins un produit').max(10),
  customerName: z.string().trim().min(2, 'Nom du client requis').max(120),
  customerPhone: phoneSchema,
  customerAddress: z
    .string()
    .trim()
    .max(300)
    .nullish()
    .transform((v) => v || null),
  zone: z
    .string()
    .trim()
    .max(120)
    .nullish()
    .transform((v) => v || null),
  deliveryMode: z.enum(DELIVERY_MODES),
  note: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => v || null),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const orderActionSchema = z.object({
  reason: reason.optional(),
  note: z.string().trim().max(500).optional(),
  courierId: z.string().optional(),
  deliveryMode: z.enum(DELIVERY_MODES).optional(),
  amountCollected: z.number().int().min(0).optional(),
  proofKey: z.string().optional(),
});
export type OrderActionInput = z.infer<typeof orderActionSchema>;

export const orderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  status: z.enum(ORDER_STATUSES).optional(),
  statuses: z.string().optional(),
  islandId: z.string().optional(),
  siteId: z.string().optional(),
  leaderId: z.string().optional(),
  sellerId: z.string().optional(),
  deliveryMode: z.enum(DELIVERY_MODES).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  q: z.string().trim().max(100).optional(),
});
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

// --- Vues -----------------------------------------------------------------------------------

export interface OrderItemView {
  id: string;
  product: { id: string; sku: string; name: string; quality: string | null };
  quantity: number;
  unitPrice: number;
  sellerShare: number | null;
  sellerTax: number;
  digecomTax: number;
  tciBonus: number | null;
  unitCost: number | null;
}

export interface OrderEventView {
  id: string;
  at: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  action: string;
  note: string | null;
  by: { id: string; fullName: string; role: Role } | null;
}

export interface OrderView {
  id: string;
  number: string;
  status: OrderStatus;
  deliveryMode: DeliveryMode;
  seller: { id: string; fullName: string; phone: string; role: Role };
  sellerType: 'SELLER' | 'TELECONSULTANT';
  leader: { id: string; fullName: string };
  island: IslandView;
  site: { id: string; name: string };
  customerName: string;
  customerPhone: string;
  customerAddress: string | null;
  zone: string | null;
  courier: { id: string; fullName: string; phone: string } | null;
  items: OrderItemView[];
  total: number;
  failReason: string | null;
  refuseReason: string | null;
  cancelReason: string | null;
  amountCollected: number | null;
  proofUrl: string | null;
  courierFee: number | null;
  confirmations: HandoverKind[];
  createdOnBehalfBy: { id: string; fullName: string } | null;
  createdAt: string;
  updatedAt: string;
  events: OrderEventView[];
  /** Actions possibles pour l'utilisateur courant (calculées par la machine à états). */
  actions: OrderAction[];
}

export interface DeliveryOfferView {
  orderId: string;
  number: string;
  sentAt: string;
  site: { id: string; name: string; address: string | null };
  zone: string | null;
  customerAddress: string | null;
  deliveryMode: DeliveryMode;
  items: { name: string; quantity: number }[];
  total: number;
}

export interface CourierView {
  id: string;
  fullName: string;
  phone: string;
  island: IslandView | null;
  isAvailable: boolean;
  activeRuns: number;
  deliveredToday: number;
}

export interface NotificationView {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/** Événements envoyés sur le flux SSE. */
export type LiveEvent =
  | { kind: 'notification'; notification: NotificationView }
  | { kind: 'order'; orderId: string; status: OrderStatus; islandId: string }
  | { kind: 'call'; event: CallEvent };
