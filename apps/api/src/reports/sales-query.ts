import { addDays, startOfBusinessDay } from '@digecom/shared';
import { Prisma } from '@prisma/client';

/** Filtre commun des agrégats de ventes (commandes `SOLD`, jour métier de `soldAt`). */
export interface SalesFilter {
  /** Premier jour métier inclus (AAAA-MM-JJ). */
  from: string;
  /** Dernier jour métier inclus. */
  to: string;
  islandId?: string;
  siteId?: string;
  leaderId?: string;
  sellerId?: string;
  campaignId?: string;
  sellerType?: 'SELLER' | 'TELECONSULTANT';
}

/** Ligne brute d'agrégat : montants en KMF (calculés depuis les instantanés `OrderItem`). */
export interface SalesTotals {
  orders: number;
  quantity: number;
  revenue: number;
  cost: number;
  sellerGross: number;
  tciBonus: number;
  digecomShare: number;
  grossMargin: number;
  digecomTax: number;
  marginAfterTax: number;
  sellerTax: number;
  sellerNet: number;
}

export const ZERO_TOTALS: SalesTotals = {
  orders: 0,
  quantity: 0,
  revenue: 0,
  cost: 0,
  sellerGross: 0,
  tciBonus: 0,
  digecomShare: 0,
  grossMargin: 0,
  digecomTax: 0,
  marginAfterTax: 0,
  sellerTax: 0,
  sellerNet: 0,
};

/** Jour métier (heure des Comores) d'une colonne timestamp UTC. */
export const businessDaySql = (column: Prisma.Sql) =>
  Prisma.sql`to_char((${column} AT TIME ZONE 'UTC') AT TIME ZONE 'Indian/Comoro', 'YYYY-MM-DD')`;

/** Bornes UTC [début, fin[ d'une période de jours métier. */
export function periodBounds(from: string, to: string): { start: Date; end: Date } {
  return { start: startOfBusinessDay(from), end: startOfBusinessDay(addDays(to, 1)) };
}

/** Clause WHERE sur `o` (Order) pour les ventes conclues de la période. */
export function soldWhere(f: SalesFilter): Prisma.Sql {
  const { start, end } = periodBounds(f.from, f.to);
  const parts: Prisma.Sql[] = [
    Prisma.sql`o.status = 'SOLD'`,
    Prisma.sql`o."soldAt" >= ${start}`,
    Prisma.sql`o."soldAt" < ${end}`,
  ];
  if (f.islandId) parts.push(Prisma.sql`o."islandId" = ${f.islandId}`);
  if (f.siteId) parts.push(Prisma.sql`o."siteId" = ${f.siteId}`);
  if (f.leaderId) parts.push(Prisma.sql`o."leaderId" = ${f.leaderId}`);
  if (f.sellerId) parts.push(Prisma.sql`o."sellerId" = ${f.sellerId}`);
  if (f.campaignId) parts.push(Prisma.sql`o."campaignId" = ${f.campaignId}`);
  if (f.sellerType) parts.push(Prisma.sql`o."sellerType"::text = ${f.sellerType}`);
  return Prisma.join(parts, ' AND ');
}

/** Colonnes d'agrégat : sommes des instantanés × quantité (entiers KMF). */
export const SALES_COLUMNS = Prisma.sql`
  COUNT(DISTINCT o.id)::int AS orders,
  COALESCE(SUM(oi.quantity), 0)::int AS quantity,
  COALESCE(SUM(oi.quantity * oi."unitPrice"), 0)::bigint AS revenue,
  COALESCE(SUM(oi.quantity * COALESCE(oi."unitCost", 0)), 0)::bigint AS cost,
  COALESCE(SUM(oi.quantity * COALESCE(oi."sellerShare", 0)), 0)::bigint AS "sellerGross",
  COALESCE(SUM(oi.quantity * COALESCE(oi."tciBonus", 0)), 0)::bigint AS "tciBonus",
  COALESCE(SUM(oi.quantity * oi."digecomTax"), 0)::bigint AS "digecomTax",
  COALESCE(SUM(oi.quantity * oi."sellerTax"), 0)::bigint AS "sellerTax"`;

type RawTotals = Record<
  | 'orders'
  | 'quantity'
  | 'revenue'
  | 'cost'
  | 'sellerGross'
  | 'tciBonus'
  | 'digecomTax'
  | 'sellerTax',
  number | bigint | null
>;

/**
 * Indicateurs dérivés (SPEC §4.1 et §4.3) :
 * part Dig'eCom = CA − part e-commerçant − prime TCI ; marge brute = part − coût ;
 * marge après taxe = marge brute − taxe Dig'eCom ; net vendeur = part − taxe e-commerçant.
 */
export function toTotals(raw: RawTotals): SalesTotals {
  const n = (v: number | bigint | null | undefined) => Number(v ?? 0);
  const revenue = n(raw.revenue);
  const cost = n(raw.cost);
  const sellerGross = n(raw.sellerGross);
  const tciBonus = n(raw.tciBonus);
  const digecomTax = n(raw.digecomTax);
  const sellerTax = n(raw.sellerTax);
  const digecomShare = revenue - sellerGross - tciBonus;
  const grossMargin = digecomShare - cost;
  return {
    orders: n(raw.orders),
    quantity: n(raw.quantity),
    revenue,
    cost,
    sellerGross,
    tciBonus,
    digecomShare,
    grossMargin,
    digecomTax,
    marginAfterTax: grossMargin - digecomTax,
    sellerTax,
    sellerNet: sellerGross - sellerTax,
  };
}

/** Totaux des ventes conclues d'une période. */
export async function salesTotals(
  prisma: Prisma.TransactionClient | { $queryRaw: Prisma.TransactionClient['$queryRaw'] },
  f: SalesFilter,
): Promise<SalesTotals> {
  const rows = await prisma.$queryRaw<RawTotals[]>`
    SELECT ${SALES_COLUMNS}
    FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
    WHERE ${soldWhere(f)}`;
  return rows[0] ? toTotals(rows[0]) : { ...ZERO_TOTALS };
}

/** Totaux groupés par une expression SQL (clé texte). */
export async function salesBy(
  prisma: { $queryRaw: Prisma.TransactionClient['$queryRaw'] },
  f: SalesFilter,
  key: Prisma.Sql,
): Promise<Map<string, SalesTotals>> {
  const rows = await prisma.$queryRaw<(RawTotals & { key: string | null })[]>`
    SELECT ${key} AS key, ${SALES_COLUMNS}
    FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
    WHERE ${soldWhere(f)}
    GROUP BY 1`;
  return new Map(rows.map((r) => [r.key ?? '', toTotals(r)]));
}
