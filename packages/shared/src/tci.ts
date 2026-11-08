import { z } from 'zod';
import { addDays, weekStart } from './finance';
import { DELIVERY_MODES, type DeliveryMode, type OrderStatus } from './orders';
import { phoneSchema } from './schemas';

// --- Semaines ISO (lundi → dimanche, jours métier Indian/Comoro) ----------------------------

/** Semaine ISO d'un jour : `2026-11-04` → `2026-W45`. */
export function isoWeekOf(day: string): string {
  const monday = weekStart(day);
  const thursday = addDays(monday, 3);
  const year = Number(thursday.slice(0, 4));
  const jan4 = `${year}-01-04`;
  const week1 = weekStart(jan4);
  const n =
    Math.round(
      (Date.parse(`${monday}T00:00:00Z`) - Date.parse(`${week1}T00:00:00Z`)) / (7 * 86_400_000),
    ) + 1;
  return `${year}-W${String(n).padStart(2, '0')}`;
}

/** Lundi et dimanche (inclus) d'une semaine ISO `YYYY-Www`. */
export function isoWeekRange(week: string): { start: string; end: string } {
  const m = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!m) throw new RangeError(`Semaine invalide (AAAA-Snn attendu) : ${week}`);
  const week1 = weekStart(`${m[1]}-01-04`);
  const start = addDays(week1, (Number(m[2]) - 1) * 7);
  return { start, end: addDays(start, 6) };
}

export const isoWeekSchema = z.string().regex(/^\d{4}-W\d{2}$/, 'Semaine au format AAAA-Wnn');

// --- Import de contacts (CSV) ----------------------------------------------------------------

/** Analyse un CSV simple (séparateur `,` ou `;`, guillemets, en-tête facultatif). */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(new RegExp('^' + String.fromCharCode(0xfeff)), '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const sep =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]!;
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell.trim());
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some((x) => x)) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x)) rows.push(row);
  return rows;
}

export interface ImportRowResult {
  line: number;
  fullName: string;
  phone: string | null;
  note: string | null;
  status: 'OK' | 'DUPLICATE' | 'INVALID';
  error?: string;
}

export interface ImportReport {
  rows: number;
  imported: number;
  duplicates: number;
  invalid: number;
  lines: ImportRowResult[];
}

const HEADER = /^(nom|name|full ?name|client)$/i;

/**
 * Prépare un import : colonnes nom, téléphone, note (en-tête détecté), téléphone normalisé +269,
 * doublons dans le fichier et avec les téléphones déjà présents dans la campagne.
 */
export function prepareImport(rows: string[][], existingPhones: Iterable<string>): ImportReport {
  const data = rows.length && HEADER.test(rows[0]![0] ?? '') ? rows.slice(1) : rows;
  const offset = data === rows ? 1 : 2;
  const seen = new Set(existingPhones);
  const lines: ImportRowResult[] = data.map((cols, i) => {
    const fullName = (cols[0] ?? '').trim();
    const note = (cols[2] ?? '').trim() || null;
    const parsed = phoneSchema.safeParse(cols[1] ?? '');
    if (fullName.length < 2)
      return {
        line: i + offset,
        fullName,
        phone: null,
        note,
        status: 'INVALID',
        error: 'Nom manquant',
      };
    if (!parsed.success)
      return {
        line: i + offset,
        fullName,
        phone: null,
        note,
        status: 'INVALID',
        error: 'Téléphone invalide',
      };
    if (seen.has(parsed.data))
      return {
        line: i + offset,
        fullName,
        phone: parsed.data,
        note,
        status: 'DUPLICATE',
        error: 'Déjà présent dans la campagne',
      };
    seen.add(parsed.data);
    return { line: i + offset, fullName, phone: parsed.data, note, status: 'OK' };
  });
  return {
    rows: lines.length,
    imported: lines.filter((l) => l.status === 'OK').length,
    duplicates: lines.filter((l) => l.status === 'DUPLICATE').length,
    invalid: lines.filter((l) => l.status === 'INVALID').length,
    lines,
  };
}

/** Répartition équitable (round-robin) en commençant par les TCI les moins chargés. */
export function roundRobin<T>(items: T[], tcis: { id: string; load: number }[]): Map<string, T[]> {
  const order = [...tcis].sort((a, b) => a.load - b.load || a.id.localeCompare(b.id));
  const result = new Map<string, T[]>(order.map((t) => [t.id, []]));
  items.forEach((item, i) => result.get(order[i % order.length]!.id)!.push(item));
  return result;
}

// --- Statuts, schémas ------------------------------------------------------------------------

export const CAMPAIGN_CHANNELS = ['FACEBOOK', 'TIKTOK', 'WHATSAPP', 'INSTAGRAM', 'OTHER'] as const;
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];
export const CAMPAIGN_CHANNEL_LABELS: Record<CampaignChannel, string> = {
  FACEBOOK: 'Facebook',
  TIKTOK: 'TikTok',
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'Instagram',
  OTHER: 'Autre',
};
export type CampaignStatus = 'ACTIVE' | 'PAUSED' | 'ENDED';
export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  ACTIVE: 'Active',
  PAUSED: 'En pause',
  ENDED: 'Terminée',
};

export const PROSPECT_STATUSES = ['TO_CALL', 'UNREACHABLE', 'CONFIRMED', 'NOT_INTERESTED'] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];
export const PROSPECT_STATUS_LABELS: Record<ProspectStatus, string> = {
  TO_CALL: 'À appeler',
  UNREACHABLE: 'Injoignable – à rappeler',
  CONFIRMED: 'Commande confirmée',
  NOT_INTERESTED: 'Pas intéressé',
};

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date AAAA-MM-JJ');

export const campaignSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    productId: z.string().min(1, 'Produit requis'),
    channel: z.enum(CAMPAIGN_CHANNELS),
    budget: z.number().int().min(0),
    startDate: day,
    endDate: day,
    /** Administrateur : Leader Junior propriétaire. */
    leaderId: z.string().optional(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'La fin doit suivre le début',
    path: ['endDate'],
  });
export type CampaignInput = z.infer<typeof campaignSchema>;

export const prospectManualSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: phoneSchema,
  note: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => v || null),
});

export const prospectImportSchema = z.object({
  fileName: z.string().max(200),
  /** Contenu du fichier en base64 (CSV ou XLSX, 5 Mo max). */
  contentBase64: z.string().max(7_000_000),
  dryRun: z.boolean().default(true),
});

export const prospectAssignSchema = z.object({
  mode: z.enum(['auto', 'manual']),
  prospectIds: z.array(z.string()).optional(),
  tciId: z.string().optional(),
});

export const callOutcomeSchema = z.object({
  outcome: z.enum(['UNREACHABLE', 'NOT_INTERESTED']),
  note: z.string().trim().max(500).optional(),
});

export const prospectConfirmSchema = z.object({
  customerName: z.string().trim().min(2).max(120),
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
  quantity: z.number().int().min(1).max(20).default(1),
  deliveryMode: z.enum(DELIVERY_MODES).default('TO_CUSTOMER'),
  note: z.string().trim().max(500).optional(),
});
export type ProspectConfirmInput = z.infer<typeof prospectConfirmSchema>;

export const tciCloseSchema = z.object({
  result: z.enum(['SOLD', 'REFUSED']),
  reason: z.string().trim().min(3).max(500).optional(),
});

// --- Vues ------------------------------------------------------------------------------------

export interface CampaignView {
  id: string;
  number: string;
  name: string;
  channel: CampaignChannel;
  budget: number;
  startDate: string;
  endDate: string;
  status: CampaignStatus;
  leader: { id: string; fullName: string };
  product: { id: string; name: string; salePrice: number; tciBonus: number | null };
  contacts: number;
  confirmed: number;
  sold: number;
  confirmationRate: number | null;
  costPerSale: number | null;
  expense: { id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' } | null;
}

export interface ProspectView {
  id: string;
  fullName: string;
  phone: string;
  note: string | null;
  status: ProspectStatus;
  attempts: number;
  lastCallAt: string | null;
  createdAt: string;
  campaign: { id: string; number: string; name: string };
  tci: { id: string; fullName: string } | null;
  order: { id: string; number: string; status: OrderStatus } | null;
}

export interface EarningsOrder {
  id: string;
  number: string;
  status: OrderStatus;
  createdAt: string;
  soldAt: string | null;
  customerName: string;
  product: string;
  amount: number;
  bonus: number;
  tci: { id: string; fullName: string };
  deliveryMode: DeliveryMode;
}

export interface TciEarnings {
  week: { id: string; start: string; end: string };
  soldAmount: number;
  soldCount: number;
  weekEarnings: number;
  totalEarnings: number;
  toClose: EarningsOrder[];
  weekOrders: EarningsOrder[];
  byProduct: { product: string; leader: string; bonus: number; count: number; total: number }[];
  byTci?: {
    tci: { id: string; fullName: string };
    soldCount: number;
    soldAmount: number;
    weekEarnings: number;
    totalEarnings: number;
    toClose: number;
  }[];
}
