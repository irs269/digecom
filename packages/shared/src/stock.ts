import { z } from 'zod';
import type { Role } from './roles';
import type { IslandView } from './organization';

// --- Calculs (règles 1 et 4 de CLAUDE.md : entiers KMF, coût rattaché au lot) ---------------

export type ShareType = 'FIXED' | 'PERCENT';

/** Part e-commerçant en KMF pour un prix donné (pourcentage arrondi à l'unité). */
export function sellerShareAmount(salePrice: number, type: ShareType, value: number): number {
  return type === 'FIXED' ? value : Math.round((salePrice * value) / 100);
}

export interface LotCostInput {
  purchaseKmf: number;
  shippingKmf: number;
  customsKmf: number;
  otherFeesKmf: number;
}

/** Coût total d'un lot (achat + expédition + douane + autres frais), en KMF. */
export function lotTotalCost(c: LotCostInput): number {
  return c.purchaseKmf + c.shippingKmf + c.customsKmf + c.otherFeesKmf;
}

/** Coût unitaire d'un lot : `round(total / quantité)` (DATA-MODEL.md). */
export function lotUnitCost(c: LotCostInput, quantity: number): number {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new RangeError('Quantité du lot invalide');
  }
  return Math.round(lotTotalCost(c) / quantity);
}

/** Conversion devise → KMF, arrondie à l'unité. */
export function toKmf(amountForeign: number, exchangeRate: number): number {
  return Math.round(amountForeign * exchangeRate);
}

// --- Statuts et libellés --------------------------------------------------------------------

export const PURCHASE_STATUSES = [
  'DRAFT',
  'ORDERED',
  'IN_TRANSIT',
  'ARRIVED',
  'IN_CUSTOMS',
  'RECEIVED',
  'CLOSED',
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_STATUSES)[number];

export const PURCHASE_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'En préparation',
  ORDERED: 'Passée',
  IN_TRANSIT: 'En transport',
  ARRIVED: 'Arrivée aux Comores',
  IN_CUSTOMS: 'En dédouanement',
  RECEIVED: 'Réceptionnée',
  CLOSED: 'Clôturée',
};

/** Étape suivante (la réception passe par l'action dédiée `receive`). */
export const NEXT_PURCHASE_STATUS: Partial<Record<PurchaseOrderStatus, PurchaseOrderStatus>> = {
  DRAFT: 'ORDERED',
  ORDERED: 'IN_TRANSIT',
  IN_TRANSIT: 'ARRIVED',
  ARRIVED: 'IN_CUSTOMS',
  IN_CUSTOMS: 'RECEIVED',
  RECEIVED: 'CLOSED',
};

export const STOCK_MOVEMENT_TYPES = [
  'ENTRY',
  'RESERVE',
  'RELEASE',
  'OUT',
  'RETURN',
  'DAMAGED',
  'LOSS',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'ADJUST',
  'INVENTORY_DIFF',
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const STOCK_MOVEMENT_LABELS: Record<StockMovementType, string> = {
  ENTRY: 'Entrée',
  RESERVE: 'Réservation',
  RELEASE: 'Libération',
  OUT: 'Sortie (vente)',
  RETURN: 'Retour',
  DAMAGED: 'Casse',
  LOSS: 'Perte',
  TRANSFER_OUT: 'Transfert sortant',
  TRANSFER_IN: 'Transfert entrant',
  ADJUST: 'Ajustement',
  INVENTORY_DIFF: 'Écart d’inventaire',
};

export type ProductState = 'PUBLISHED' | 'OUT_OF_STOCK' | 'UNPUBLISHED';
export const PRODUCT_STATE_LABELS: Record<ProductState, string> = {
  PUBLISHED: 'Publié',
  OUT_OF_STOCK: 'Rupture',
  UNPUBLISHED: 'Retiré',
};

export type StockAlertKind = 'LOW' | 'OUT' | 'UNSOLD' | 'INVENTORY_DIFF';
export const STOCK_ALERT_LABELS: Record<StockAlertKind, string> = {
  LOW: 'Stock faible',
  OUT: 'Rupture',
  UNSOLD: 'Invendu',
  INVENTORY_DIFF: 'Écart d’inventaire',
};

export const MAX_PRODUCT_PHOTOS = 5;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

// --- Schémas d'entrée -----------------------------------------------------------------------

const kmf = z.number().int('Montant entier en KMF').min(0, 'Montant positif ou nul');
const positiveInt = z.number().int('Nombre entier').positive('Doit être supérieur à 0');
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);
const reason = z.string().trim().min(3, 'Motif requis (3 caractères minimum)').max(500);

export const productSchema = z.object({
  /** Administrateur uniquement : leader propriétaire. Un leader crée toujours pour lui-même. */
  leaderId: z.string().optional(),
  name: z.string().trim().min(2, 'Nom trop court').max(160),
  category: optionalText(80),
  description: optionalText(2000),
  quality: optionalText(80),
  salePrice: positiveInt,
  sellerShareType: z.enum(['FIXED', 'PERCENT']).nullish(),
  sellerShareValue: kmf.nullish(),
  tciBonus: kmf.nullish(),
  lowStockThreshold: z.number().int().min(0).nullish(),
  isPublished: z.boolean().optional(),
});
export type ProductInput = z.infer<typeof productSchema>;

export const updateProductSchema = productSchema.omit({ leaderId: true }).partial();
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const productListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  leaderId: z.string().optional(),
  islandId: z.string().optional(),
  state: z.enum(['PUBLISHED', 'OUT_OF_STOCK', 'UNPUBLISHED']).optional(),
  q: z.string().trim().max(100).optional(),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

/** Stock +/− d'un leader sur son catalogue (motif obligatoire). */
export const catalogStockSchema = z.object({
  siteId: z.string().optional(),
  delta: z
    .number()
    .int()
    .refine((v) => v !== 0, 'La variation ne peut pas être nulle'),
  reason,
  /** Coût unitaire pour une entrée (+) sans lot ; par défaut : coût moyen des lots en stock. */
  unitCost: kmf.optional(),
});
export type CatalogStockInput = z.infer<typeof catalogStockSchema>;

export const stockEntrySchema = z.object({
  productId: z.string().min(1),
  siteId: z.string().min(1),
  quantity: positiveInt,
  unitCost: kmf,
  reason,
});
export type StockEntryInput = z.infer<typeof stockEntrySchema>;

export const stockAdjustSchema = z.object({
  productId: z.string().min(1),
  siteId: z.string().min(1),
  kind: z.enum(['ADJUST', 'DAMAGED', 'LOSS']),
  /** ADJUST : positif ou négatif ; DAMAGED / LOSS : quantité sortie (positive). */
  delta: z
    .number()
    .int()
    .refine((v) => v !== 0, 'La variation ne peut pas être nulle'),
  reason,
  unitCost: kmf.optional(),
});
export type StockAdjustInput = z.infer<typeof stockAdjustSchema>;

export const stockTransferSchema = z
  .object({
    productId: z.string().min(1),
    fromSiteId: z.string().min(1),
    toSiteId: z.string().min(1),
    quantity: positiveInt,
    reason,
  })
  .refine((v) => v.fromSiteId !== v.toSiteId, {
    message: 'Les sites de départ et d’arrivée doivent être différents',
    path: ['toSiteId'],
  });
export type StockTransferInput = z.infer<typeof stockTransferSchema>;

export const stockListQuerySchema = z.object({
  islandId: z.string().optional(),
  siteId: z.string().optional(),
  leaderId: z.string().optional(),
  alert: z.enum(['LOW', 'OUT', 'UNSOLD', 'any']).optional(),
  q: z.string().trim().max(100).optional(),
});
export type StockListQuery = z.infer<typeof stockListQuerySchema>;

export const inventoryStartSchema = z.object({ siteId: z.string().min(1) });
export const inventoryCountSchema = z.object({
  lines: z
    .array(z.object({ productId: z.string().min(1), counted: z.number().int().min(0) }))
    .min(1),
});
export type InventoryCountInput = z.infer<typeof inventoryCountSchema>;

export const supplierSchema = z.object({
  name: z.string().trim().min(2).max(160),
  platform: optionalText(80),
  contact: optionalText(300),
});
export type SupplierInput = z.infer<typeof supplierSchema>;

export const purchaseOrderSchema = z.object({
  supplierId: z.string().min(1, 'Fournisseur requis'),
  productId: z.string().min(1, 'Produit requis'),
  destinationSiteId: z.string().min(1, 'Site de destination requis'),
  quantity: positiveInt,
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Code devise sur 3 lettres (USD, CNY, EUR, KMF)'),
  exchangeRate: z.number().positive('Taux de change > 0').max(1_000_000),
  purchaseAmountForeign: z.number().min(0).max(1_000_000_000),
  shippingKmf: kmf.default(0),
  customsKmf: kmf.default(0),
  otherFeesKmf: kmf.default(0),
  notes: optionalText(1000),
});
export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;

export const updatePurchaseOrderSchema = purchaseOrderSchema.partial();

export const receivePurchaseSchema = z.object({
  siteId: z.string().optional(),
  receivedQuantity: positiveInt,
  paidAmountKmf: kmf.optional(),
  paidAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type ReceivePurchaseInput = z.infer<typeof receivePurchaseSchema>;

// --- Vues renvoyées par l'API --------------------------------------------------------------

export interface LeaderRef {
  id: string;
  fullName: string;
  role: Role;
  island: IslandView | null;
}

export interface ProductView {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  description: string | null;
  quality: string | null;
  photos: { key: string; url: string }[];
  salePrice: number;
  sellerShareType: ShareType | null;
  sellerShareValue: number | null;
  /** Part e-commerçant (KMF) pour un Leader Senior, prime TCI pour un Leader Junior. */
  sellerAmount: number | null;
  tciBonus: number | null;
  isPublished: boolean;
  lowStockThreshold: number | null;
  state: ProductState;
  leader: LeaderRef;
  stock: { available: number; reserved: number };
  sold: number;
  updatedAt: string;
}

export interface VisibleProduct {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  description: string | null;
  quality: string | null;
  photos: { key: string; url: string }[];
  salePrice: number;
  sellerAmount: number | null;
  tciBonus: number | null;
  sites: { siteId: string; siteName: string; available: number }[];
  available: number;
}

export interface VisibleCatalog {
  leader: LeaderRef;
  products: VisibleProduct[];
  /** Produits du leader non visibles (retirés ou sans stock sur l'île). */
  hiddenCount: number;
}

export interface StockRow {
  productId: string;
  sku: string;
  productName: string;
  leader: { id: string; fullName: string };
  site: { id: string; name: string; island: IslandView };
  available: number;
  reserved: number;
  /** Coût rendu moyen des lots restants (KMF / unité). */
  unitCost: number | null;
  /** Valeur au coût rendu des unités physiques (disponible + réservé). */
  value: number;
  salePrice: number;
  alerts: StockAlertKind[];
}

export interface StockSummary {
  value: number;
  units: number;
  reserved: number;
  alerts: { LOW: number; OUT: number; UNSOLD: number; INVENTORY_DIFF: number };
}

export interface StockMovementView {
  id: string;
  at: string;
  type: StockMovementType;
  quantity: number;
  unitCost: number | null;
  reason: string | null;
  orderId: string | null;
  transferId: string | null;
  lot: { id: string; number: string } | null;
  site: { id: string; name: string };
  by: { id: string; fullName: string };
}

export interface LotView {
  id: string;
  number: string;
  quantity: number;
  remaining: number;
  unitCost: number;
  receivedAt: string;
  site: { id: string; name: string };
  product: { id: string; name: string; sku: string };
}

export interface SupplierView {
  id: string;
  name: string;
  platform: string | null;
  contact: string | null;
  isActive: boolean;
}

export interface PurchaseOrderView {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  supplier: { id: string; name: string };
  product: { id: string; name: string; sku: string; leader: { id: string; fullName: string } };
  destinationSite: { id: string; name: string; island: IslandView };
  quantity: number;
  receivedQuantity: number | null;
  currency: string;
  exchangeRate: number;
  purchaseAmountForeign: number;
  purchaseAmountKmf: number;
  shippingKmf: number;
  customsKmf: number;
  otherFeesKmf: number;
  totalCostKmf: number;
  /** Coût unitaire calculé sur la quantité reçue (ou commandée tant que non reçue). */
  unitCost: number;
  paidAmountKmf: number | null;
  paidAt: string | null;
  notes: string | null;
  dates: Partial<Record<PurchaseOrderStatus, string>>;
  createdAt: string;
}

export interface InventoryView {
  id: string;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
  site: { id: string; name: string; island: IslandView };
  startedAt: string;
  closedAt: string | null;
  startedBy: { id: string; fullName: string };
  lines: {
    productId: string;
    sku: string;
    productName: string;
    expected: number;
    counted: number | null;
    difference: number | null;
  }[];
}
