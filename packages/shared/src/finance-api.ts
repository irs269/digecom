import { z } from 'zod';
import type { LedgerType } from './finance';
import type { IslandView } from './organization';
import type { Role } from './roles';
import { PAYMENT_METHODS } from './settings';

// --- Règlements -----------------------------------------------------------------------------

export const SETTLEMENT_STATUSES = ['GENERATED', 'VERIFIED', 'APPROVED', 'PAID'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];
export const SETTLEMENT_STATUS_LABELS: Record<SettlementStatus, string> = {
  GENERATED: 'À vérifier',
  VERIFIED: 'Vérifié',
  APPROVED: 'Validé',
  PAID: 'Payé',
};
/** Étape attendue après chaque statut, et rôle qui la fait. */
export const SETTLEMENT_NEXT_STEP: Record<
  Exclude<SettlementStatus, 'PAID'>,
  { action: 'verify' | 'approve' | 'pay'; label: string; role: Role }
> = {
  GENERATED: { action: 'verify', label: 'Vérifier', role: 'ACCOUNTANT' },
  VERIFIED: { action: 'approve', label: 'Valider', role: 'FINANCE_MANAGER' },
  APPROVED: { action: 'pay', label: 'Payer', role: 'CASHIER' },
};

export const settlementPaySchema = z.object({
  paymentMethod: z.enum(PAYMENT_METHODS),
  paymentRef: z
    .string()
    .trim()
    .max(120)
    .nullish()
    .transform((v) => v || null),
  proofKey: z.string().optional(),
});
export type SettlementPayInput = z.infer<typeof settlementPaySchema>;

export const settlementListQuerySchema = z.object({
  status: z.enum(SETTLEMENT_STATUSES).optional(),
  islandId: z.string().optional(),
  periodStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  sellerId: z.string().optional(),
});
export type SettlementListQuery = z.infer<typeof settlementListQuerySchema>;

export interface SettlementLineView {
  id: string;
  type: LedgerType;
  amount: number;
  periodDate: string;
  orderNumber: string | null;
  label: string;
}

export interface SettlementView {
  id: string;
  number: string;
  seller: { id: string; fullName: string; phone: string };
  island: IslandView;
  periodStart: string;
  periodEnd: string;
  salesCount: number;
  grossCommission: number;
  taxes: number;
  subscriptions: number;
  otherDeductions: number;
  carriedOver: number;
  balance: number;
  netToPay: number;
  status: SettlementStatus;
  verifiedBy: { id: string; fullName: string } | null;
  verifiedAt: string | null;
  approvedBy: { id: string; fullName: string } | null;
  approvedAt: string | null;
  paidBy: { id: string; fullName: string } | null;
  paidAt: string | null;
  paymentMethod: string | null;
  paymentRef: string | null;
  lines?: SettlementLineView[];
  /** Action possible pour l'utilisateur courant, sinon message d'attente. */
  nextAction: 'verify' | 'approve' | 'pay' | null;
  waitingFor: string | null;
}

// --- Caisse ---------------------------------------------------------------------------------

export const CASH_CATEGORIES = [
  'COUNTER_SALE',
  'COURIER_REMITTANCE',
  'SUBSCRIPTION_CASH',
  'SETTLEMENT_PAYMENT',
  'EXPENSE_PAYMENT',
  'OTHER',
] as const;
export type CashCategory = (typeof CASH_CATEGORIES)[number];
export const CASH_CATEGORY_LABELS: Record<CashCategory, string> = {
  COUNTER_SALE: 'Vente au comptoir',
  COURIER_REMITTANCE: 'Remise d’argent d’un livreur',
  SUBSCRIPTION_CASH: 'Abonnement payé en espèces',
  SETTLEMENT_PAYMENT: 'Règlement e-commerçant',
  EXPENSE_PAYMENT: 'Dépense payée',
  OTHER: 'Autre',
};

const kmf = z.number().int('Montant entier en KMF').min(0);

export const cashOpenSchema = z.object({ siteId: z.string().min(1), openingAmount: kmf });
export const cashOperationSchema = z.object({
  direction: z.enum(['IN', 'OUT']),
  category: z.enum(CASH_CATEGORIES),
  amount: z.number().int().positive('Montant > 0'),
  label: z.string().trim().max(200).optional(),
  orderIds: z.array(z.string()).optional(),
  courierId: z.string().optional(),
  expenseId: z.string().optional(),
  sellerId: z.string().optional(),
});
export type CashOperationInput = z.infer<typeof cashOperationSchema>;
export const cashCloseSchema = z.object({
  countedAmount: kmf,
  note: z.string().trim().max(500).optional(),
});
export const bankBalanceSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().int(),
  source: z.string().trim().min(2).max(200),
});

export interface CashOperationView {
  id: string;
  at: string;
  direction: 'IN' | 'OUT';
  category: CashCategory;
  amount: number;
  label: string | null;
  by: { id: string; fullName: string };
}

export interface CashSessionView {
  id: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  openedBy: { id: string; fullName: string };
  openingAmount: number;
  totalIn: number;
  totalOut: number;
  expectedAmount: number;
  countedAmount: number | null;
  difference: number | null;
  closedAt: string | null;
  closedBy: { id: string; fullName: string } | null;
  operations: CashOperationView[];
}

export interface CashRegisterView {
  site: { id: string; name: string; island: IslandView };
  current: CashSessionView | null;
  last: CashSessionView | null;
}

export interface PendingRemittance {
  courier: { id: string; fullName: string };
  orders: { id: string; number: string; amountCollected: number; handedOverAt: string }[];
  total: number;
}

// --- Dépenses -------------------------------------------------------------------------------

export const EXPENSE_CATEGORIES = [
  'SALARIES',
  'RENT',
  'ADVERTISING',
  'DELIVERY',
  'COMMUNICATION',
  'ADMIN',
  'BANK_FEES',
  'OTHER',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  SALARIES: 'Salaires',
  RENT: 'Loyer',
  ADVERTISING: 'Publicité',
  DELIVERY: 'Livraison',
  COMMUNICATION: 'Communication',
  ADMIN: 'Frais administratifs',
  BANK_FEES: 'Frais bancaires',
  OTHER: 'Autres',
};

export const expenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  label: z.string().trim().min(3).max(200),
  amount: z.number().int().positive('Montant > 0'),
  islandId: z.string().min(1, 'Île requise'),
  periodDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  campaignId: z.string().optional(),
  leaderId: z.string().optional(),
  proofKey: z.string().optional(),
});
export type ExpenseInput = z.infer<typeof expenseSchema>;

export interface ExpenseView {
  id: string;
  category: ExpenseCategory;
  label: string;
  amount: number;
  island: IslandView;
  periodDate: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reversed: boolean;
  createdBy: { id: string; fullName: string };
  approvedBy: { id: string; fullName: string } | null;
  approvedAt: string | null;
  rejectReason: string | null;
  leader: { id: string; fullName: string } | null;
  proofUrl: string | null;
  createdAt: string;
  canApprove: boolean;
}

export interface NetResult {
  from: string;
  to: string;
  islandId: string | null;
  revenue: number;
  digecomShare: number;
  cost: number;
  digecomTax: number;
  marginAfterTax: number;
  courierFees: number;
  expenses: number;
  netResult: number;
  pendingExpenses: number;
}

/** Solde de l'e-commerçant (application mobile, `GET /me/balance`). */
export interface SellerBalanceView {
  cycle: { start: string; end: string };
  current: {
    salesCount: number;
    commission: number;
    taxes: number;
    subscriptions: number;
    estimatedNet: number;
  };
  statements: SettlementView[];
}
