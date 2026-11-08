/**
 * Calculs financiers (fonctions pures, entiers KMF). SPEC §4.
 *
 * Arrondi : seuls les pourcentages produisent des fractions ; elles sont arrondies à l'unité
 * la plus proche, demi vers le haut (`Math.round`), une fois par produit, avant toute somme.
 */

function assertKmf(label: string, value: number) {
  if (!Number.isSafeInteger(value))
    throw new RangeError(`${label} : entier KMF attendu (${value})`);
}

export interface SaleInput {
  /** Prix de vente unitaire. */
  price: number;
  /** Part brute e-commerçant unitaire (déjà arrondie si pourcentage). */
  sellerShare: number;
  /** Coût d'approvisionnement unitaire (lot, FIFO). */
  unitCost: number;
  digecomTax: number;
  sellerTax: number;
  quantity?: number;
}

export interface SaleBreakdown {
  quantity: number;
  revenue: number;
  cost: number;
  sellerGross: number;
  digecomShare: number;
  grossMargin: number;
  digecomTax: number;
  marginAfterTax: number;
  sellerTax: number;
  sellerNet: number;
}

/** Vente d'un e-commerçant (SPEC 4.1). */
export function computeSale(input: SaleInput): SaleBreakdown {
  const q = input.quantity ?? 1;
  for (const [k, v] of Object.entries({ ...input, quantity: q })) assertKmf(k, v);
  const revenue = input.price * q;
  const sellerGross = input.sellerShare * q;
  const cost = input.unitCost * q;
  const digecomShare = revenue - sellerGross;
  const grossMargin = digecomShare - cost;
  const digecomTax = input.digecomTax * q;
  const sellerTax = input.sellerTax * q;
  return {
    quantity: q,
    revenue,
    cost,
    sellerGross,
    digecomShare,
    grossMargin,
    digecomTax,
    marginAfterTax: grossMargin - digecomTax,
    sellerTax,
    sellerNet: sellerGross - sellerTax,
  };
}

/** Somme de plusieurs ventes (rapports). */
export function sumSales(list: SaleBreakdown[]): SaleBreakdown {
  const zero: SaleBreakdown = {
    quantity: 0,
    revenue: 0,
    cost: 0,
    sellerGross: 0,
    digecomShare: 0,
    grossMargin: 0,
    digecomTax: 0,
    marginAfterTax: 0,
    sellerTax: 0,
    sellerNet: 0,
  };
  return list.reduce(
    (acc, s) =>
      Object.fromEntries(
        Object.keys(zero).map((k) => [
          k,
          acc[k as keyof SaleBreakdown] + s[k as keyof SaleBreakdown],
        ]),
      ) as unknown as SaleBreakdown,
    zero,
  );
}

export interface TciSaleBreakdown {
  quantity: number;
  revenue: number;
  tciBonus: number;
  cost: number;
  /** CA − prime − coût, avant le partage Dig'eCom / Leader Junior. */
  marginBeforeLeaderShare: number;
  /** Partage non défini (questions ouvertes n° 2 et 7) : jamais calculé. */
  leaderShare: null;
}

/** Vente d'un téléconseiller (SPEC 4.3). */
export function computeTciSale(input: {
  price: number;
  tciBonus: number;
  unitCost: number;
  quantity?: number;
}): TciSaleBreakdown {
  const q = input.quantity ?? 1;
  for (const [k, v] of Object.entries({ ...input, quantity: q })) assertKmf(k, v);
  const revenue = input.price * q;
  const tciBonus = input.tciBonus * q;
  const cost = input.unitCost * q;
  return {
    quantity: q,
    revenue,
    tciBonus,
    cost,
    marginBeforeLeaderShare: revenue - tciBonus - cost,
    leaderShare: null,
  };
}

export interface SettlementInput {
  /** Une ligne par produit vendu ; les corrections (retours) ont des montants négatifs. */
  sales: { commission: number; sellerTax: number }[];
  subscriptions: number[];
  otherDeductions: number;
  /** Solde négatif reporté du cycle précédent (≤ 0). */
  carriedOver: number;
}

export interface SettlementBreakdown {
  salesCount: number;
  grossCommission: number;
  taxes: number;
  subscriptions: number;
  otherDeductions: number;
  carriedOver: number;
  /** Solde du cycle (peut être négatif). */
  balance: number;
  netToPay: number;
  /** Report au cycle suivant (≤ 0). */
  carryForward: number;
}

/** Relevé d'un e-commerçant (SPEC 4.2) : ventes SOLD − taxes − abonnements − retenues + report. */
export function computeSettlement(input: SettlementInput): SettlementBreakdown {
  const grossCommission = input.sales.reduce((s, x) => s + x.commission, 0);
  const taxes = input.sales.reduce((s, x) => s + x.sellerTax, 0);
  const subscriptions = input.subscriptions.reduce((s, x) => s + x, 0);
  const salesCount =
    input.sales.filter((x) => x.commission > 0).length -
    input.sales.filter((x) => x.commission < 0).length;
  for (const [k, v] of Object.entries({
    grossCommission,
    taxes,
    subscriptions,
    other: input.otherDeductions,
    carried: input.carriedOver,
  })) {
    assertKmf(k, v);
  }
  const balance =
    grossCommission - taxes - subscriptions - input.otherDeductions + input.carriedOver;
  return {
    salesCount,
    grossCommission,
    taxes,
    subscriptions,
    otherDeductions: input.otherDeductions,
    carriedOver: input.carriedOver,
    balance,
    netToPay: Math.max(balance, 0),
    carryForward: Math.min(balance, 0),
  };
}

// --- Calendrier métier ----------------------------------------------------------------------

const DAY = 86_400_000;
const toUtc = (day: string) => Date.parse(`${day}T00:00:00Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Ajoute `n` jours à un jour AAAA-MM-JJ. */
export function addDays(day: string, n: number): string {
  return fromUtc(toUtc(day) + n * DAY);
}

/** Cycle de règlement contenant `day` : [start, end[ (jours métier). */
export function settlementCycle(
  anchor: string,
  cycleDays: number,
  day: string,
): { index: number; start: string; end: string } {
  const index = Math.floor((toUtc(day) - toUtc(anchor)) / (cycleDays * DAY));
  const start = addDays(anchor, index * cycleDays);
  return { index, start, end: addDays(start, cycleDays) };
}

/** Lundi de la semaine (lundi → dimanche) contenant `day`. */
export function weekStart(day: string): string {
  const dow = new Date(toUtc(day)).getUTCDay(); // 0 = dimanche
  return addDays(day, -((dow + 6) % 7));
}

// --- Libellés --------------------------------------------------------------------------------

export const LEDGER_TYPES = [
  'SALE_REVENUE',
  'COGS',
  'DIGECOM_TAX',
  'SELLER_TAX',
  'SELLER_COMMISSION',
  'TCI_BONUS',
  'SUBSCRIPTION',
  'COURIER_FEE',
  'EXPENSE',
  'SUPPLIER_PAYMENT',
  'SETTLEMENT_PAYMENT',
  'CASH_IN',
  'CASH_OUT',
  'CORRECTION',
] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

export const LEDGER_TYPE_LABELS: Record<LedgerType, string> = {
  SALE_REVENUE: 'Chiffre d’affaires',
  COGS: 'Coût d’approvisionnement',
  DIGECOM_TAX: 'Taxe Dig’eCom',
  SELLER_TAX: 'Taxe e-commerçant',
  SELLER_COMMISSION: 'Commission e-commerçant',
  TCI_BONUS: 'Prime téléconseiller',
  SUBSCRIPTION: 'Abonnement',
  COURIER_FEE: 'Frais de course',
  EXPENSE: 'Dépense',
  SUPPLIER_PAYMENT: 'Paiement fournisseur',
  SETTLEMENT_PAYMENT: 'Règlement versé',
  CASH_IN: 'Encaissement',
  CASH_OUT: 'Décaissement',
  CORRECTION: 'Correction',
};
