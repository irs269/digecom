import { z } from 'zod';
import { computeSale, type SaleBreakdown } from './finance';
import type { Role } from './roles';

// --- Tableau de bord ---------------------------------------------------------------------------

export type DashboardFormat = 'kmf' | 'int' | 'pct';
export type DashboardTone = 'blue' | 'white' | 'orange';

export interface DashboardKpi {
  key: string;
  label: string;
  value: number | null;
  format: DashboardFormat;
  hint?: string;
  tone: DashboardTone;
  /** Liste filtrée correspondante (chiffre cliquable). */
  link?: string;
}

export interface DashboardTodo {
  key: string;
  label: string;
  count: number;
  alert?: boolean;
  link?: string;
}

export interface DashboardOrderRow {
  id: string;
  number: string;
  status: string;
  customerName: string;
  seller: string;
  island: string;
  amount: number;
  createdAt: string;
}

export interface DashboardRankRow {
  id: string;
  fullName: string;
  sold: number;
  revenue: number;
  /** Leader Senior : quantités attribuées restantes. */
  remaining?: number;
}

export interface DashboardView {
  role: Role;
  /** Bornes de la période des chiffres « cycle » / « semaine ». */
  period: { label: string; start: string; end: string };
  kpis: DashboardKpi[];
  todo: DashboardTodo[];
  recentOrders?: DashboardOrderRow[];
  ranking?: { title: string; rows: DashboardRankRow[] };
  islands?: { code: string; name: string; revenue: number }[];
  generatedAt: string;
}

// --- Rapports ----------------------------------------------------------------------------------

export const REPORT_TYPES = [
  'daily',
  'weekly',
  'monthly',
  'product',
  'lot',
  'seller',
  'leader',
  'island',
  'expenses',
  'margins',
  'settlements',
  'stock',
  'campaigns',
  'tci',
  'couriers',
  'simulation',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export interface ReportDefinition {
  label: string;
  description: string;
  /** Rôles leaders autorisés (rapport limité à leur équipe). */
  leaders: ('LEADER_SENIOR' | 'LEADER_JUNIOR')[];
}

export const REPORTS: Record<ReportType, ReportDefinition> = {
  daily: {
    label: 'Rapport journalier',
    description: 'Commandes, ventes, refus et marge, jour par jour',
    leaders: ['LEADER_SENIOR', 'LEADER_JUNIOR'],
  },
  weekly: {
    label: 'Rapport hebdomadaire',
    description: 'Synthèse par semaine (lundi → dimanche)',
    leaders: ['LEADER_SENIOR', 'LEADER_JUNIOR'],
  },
  monthly: {
    label: 'Rapport mensuel',
    description: 'Résultat du mois : marge, dépenses validées, résultat net',
    leaders: [],
  },
  product: {
    label: 'Par produit',
    description: 'Quantités, chiffre d’affaires et marge de chaque produit',
    leaders: ['LEADER_SENIOR', 'LEADER_JUNIOR'],
  },
  lot: {
    label: 'Par lot',
    description: 'Coût de revient, quantités reçues, vendues et restantes',
    leaders: [],
  },
  seller: {
    label: 'Par vendeur',
    description: 'Classement des e-commerçants et téléconseillers',
    leaders: ['LEADER_SENIOR', 'LEADER_JUNIOR'],
  },
  leader: {
    label: 'Par leader',
    description: 'Performances de chaque équipe',
    leaders: [],
  },
  island: {
    label: 'Par île',
    description: 'Commandes, ventes, refus et marge par île',
    leaders: [],
  },
  expenses: {
    label: 'Dépenses',
    description: 'Dépenses de la période et leur statut',
    leaders: [],
  },
  margins: {
    label: 'Marges',
    description: 'Calcul de la SPEC §4.1 sur les ventes réelles de la période',
    leaders: [],
  },
  settlements: {
    label: 'Règlements',
    description: 'Relevés des e-commerçants : montants et statut',
    leaders: [],
  },
  stock: {
    label: 'Stocks',
    description: 'Stock par site et produit, valorisé au coût rendu',
    leaders: [],
  },
  campaigns: {
    label: 'Campagnes',
    description: 'Budget, contacts, ventes et coût par vente',
    leaders: ['LEADER_JUNIOR'],
  },
  tci: {
    label: 'Gains TCI',
    description: 'Ventes et primes de chaque téléconseiller',
    leaders: ['LEADER_JUNIOR'],
  },
  couriers: {
    label: 'Livreurs',
    description: 'Courses livrées, échouées et frais de course',
    leaders: [],
  },
  simulation: {
    label: 'Simulation 100 produits',
    description: 'Le tableau de référence de la SPEC §4.1 pour 100 produits',
    leaders: [],
  },
};

/** Rapports qu'un rôle peut consulter (le module `reports` reste requis). */
export function reportsForRole(role: Role): ReportType[] {
  if (role === 'LEADER_SENIOR' || role === 'LEADER_JUNIOR')
    return REPORT_TYPES.filter((t) => REPORTS[t].leaders.includes(role));
  return [...REPORT_TYPES];
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date AAAA-MM-JJ');

export const reportQuerySchema = z
  .object({
    from: day,
    to: day,
    islandId: z.string().optional(),
    siteId: z.string().optional(),
    leaderId: z.string().optional(),
    format: z.enum(['json', 'xlsx', 'pdf']).default('json'),
  })
  .refine((v) => v.to >= v.from, { message: 'La fin doit suivre le début', path: ['to'] });
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export type ReportColumnKind = 'text' | 'int' | 'kmf' | 'pct' | 'date';

export interface ReportColumn {
  key: string;
  label: string;
  kind: ReportColumnKind;
  /** Colonne totalisée (somme) en pied de tableau. */
  total?: boolean;
}

export type ReportCell = string | number | null;

export interface ReportView {
  type: ReportType;
  title: string;
  params: { label: string; value: string }[];
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  totals: Record<string, number>;
  generatedAt: string;
}

/** Export volumineux : généré en tâche de fond, lien notifié. */
export interface ReportJobAccepted {
  queued: true;
  rows: number;
  message: string;
}

/** Au-delà, l'export passe par une tâche BullMQ. */
export const REPORT_ASYNC_THRESHOLD = 5_000;

/** Somme des colonnes totalisées (même calcul pour l'écran, Excel et PDF). */
export function reportTotals(
  columns: ReportColumn[],
  rows: Record<string, ReportCell>[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const c of columns) {
    if (!c.total) continue;
    totals[c.key] = rows.reduce(
      (s, r) => s + (typeof r[c.key] === 'number' ? (r[c.key] as number) : 0),
      0,
    );
  }
  return totals;
}

/** Valeurs de référence de la SPEC §4.1. */
export const SPEC_REFERENCE = {
  price: 12_500,
  purchase: 250,
  shipping: 500,
  sellerShare: 7_500,
  digecomTax: 500,
  sellerTax: 500,
} as const;

/** Simulation de la SPEC §4.1 pour `quantity` produits (rapport « Simulation 100 produits »). */
export function simulation(
  quantity = 100,
  ref: {
    price: number;
    purchase: number;
    shipping: number;
    sellerShare: number;
    digecomTax: number;
    sellerTax: number;
  } = SPEC_REFERENCE,
): { purchases: number; shipping: number; sale: SaleBreakdown } {
  const sale = computeSale({
    price: ref.price,
    sellerShare: ref.sellerShare,
    unitCost: ref.purchase + ref.shipping,
    digecomTax: ref.digecomTax,
    sellerTax: ref.sellerTax,
    quantity,
  });
  return { purchases: ref.purchase * quantity, shipping: ref.shipping * quantity, sale };
}

// --- Réseau commercial -------------------------------------------------------------------------

export const allocationSchema = z.object({
  sellerId: z.string().min(1),
  productId: z.string().min(1),
  /** Quantité ajoutée (positive) ou retirée (négative), jamais sous les quantités déjà vendues. */
  quantity: z
    .number()
    .int()
    .min(-1000)
    .max(1000)
    .refine((v) => v !== 0, 'Quantité non nulle'),
});
export type AllocationInput = z.infer<typeof allocationSchema>;

export const salesTargetSchema = z.object({
  /** Objectif hebdomadaire de chiffre d'affaires de l'équipe (KMF), 0 = aucun. */
  weeklyRevenue: z.number().int().min(0).max(1_000_000_000),
});

export interface NetworkMember {
  id: string;
  fullName: string;
  phone: string;
  role: 'SELLER' | 'TELECONSULTANT';
  isActive: boolean;
  sold: number;
  revenue: number;
  allocated: number;
  remaining: number;
  allocations: {
    productId: string;
    product: string;
    allocated: number;
    sold: number;
    remaining: number;
  }[];
}

export interface NetworkTeam {
  leader: {
    id: string;
    fullName: string;
    role: 'LEADER_SENIOR' | 'LEADER_JUNIOR';
    island: string | null;
  };
  members: NetworkMember[];
  sold: number;
  revenue: number;
  marginAfterTax: number;
  activeMembers: number;
  weeklyTarget: number | null;
  weekRevenue: number;
}

export interface NetworkView {
  period: { start: string; end: string };
  teams: NetworkTeam[];
}

// --- Notifications ----------------------------------------------------------------------------

export const NOTIFICATION_TYPES = {
  ORDER_NEW: 'Nouvelle commande',
  ORDER_TO_ASSIGN: 'Commande prête : livreur à choisir',
  ORDER_READY_PICKUP: 'Commande prête au retrait',
  DELIVERY_ASSIGNED: 'Course acceptée / affectée',
  NO_COURIER: 'Aucun livreur après délai',
  ORDER_HANDED_OVER: 'Remise effectuée',
  DELIVERY_FAILED: 'Livraison échouée',
  ORDER_SOLD: 'Client a pris',
  ORDER_REFUSED: 'Client a refusé',
  PEER_SALE: 'Vente conclue par un autre e-commerçant de l’île',
  STOCK_LOW: 'Stock faible',
  STOCK_OUT: 'Rupture de stock',
  SETTLEMENT_AVAILABLE: 'Relevé disponible',
  SETTLEMENT_APPROVED: 'Règlement validé',
  SETTLEMENT_PAID: 'Règlement payé',
  SUBSCRIPTION_DUE: 'Abonnement à payer',
  PROSPECTS_ASSIGNED: 'Nouveau prospect attribué',
  TCI_SALE_CLOSED: 'Vente clôturée (prime ajoutée)',
  TARGET_REACHED: 'Objectif atteint',
  EXPENSE_PENDING: 'Dépense à valider',
  REPORT_READY: 'Export prêt',
} as const;
export type NotificationTypeKey = keyof typeof NOTIFICATION_TYPES;

/** Canaux réglables (l'in-app est toujours actif). */
export const NOTIFICATION_CHANNELS = ['push', 'sms', 'whatsapp'] as const;
export type NotificationChannelKey = (typeof NOTIFICATION_CHANNELS)[number];

export type NotificationPreferences = Partial<
  Record<string, Partial<Record<NotificationChannelKey, boolean>>>
>;

export const notificationPreferencesSchema = z.record(
  z.string().regex(/^[A-Z_]+$/),
  z.object({
    push: z.boolean().optional(),
    sms: z.boolean().optional(),
    whatsapp: z.boolean().optional(),
  }),
);

/** Canal actif ? Push actif par défaut ; SMS et WhatsApp désactivés par défaut. */
export function channelEnabled(
  prefs: NotificationPreferences | null | undefined,
  type: string,
  channel: NotificationChannelKey,
): boolean {
  const v = prefs?.[type]?.[channel];
  return v ?? channel === 'push';
}
