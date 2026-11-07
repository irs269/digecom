import { z } from 'zod';
import { NBSP } from './money';

/**
 * Registre des paramètres versionnés (docs/DATA-MODEL.md, Setting ; SPEC §6.16).
 * Chaque clé a un schéma de validation, un groupe d'affichage et une valeur par défaut.
 * Toute lecture côté API passe par SettingsService.get(key, date).
 */
const kmf = z.number().int('Montant entier en KMF').min(0, 'Le montant doit être positif ou nul');

export const amountRuleSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('FIXED'), value: kmf }),
  z.object({
    mode: z.literal('PERCENT'),
    value: z.number().min(0, 'Pourcentage ≥ 0').max(100, 'Pourcentage ≤ 100'),
  }),
]);
export type AmountRule = z.infer<typeof amountRuleSchema>;

export const PAYMENT_METHODS = ['CASH', 'HURI_MONEY', 'MVOLA', 'BANK_TRANSFER'] as const;
export const PAYMENT_METHOD_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = {
  CASH: 'Espèces',
  HURI_MONEY: 'Huri Money',
  MVOLA: 'MVola',
  BANK_TRANSFER: 'Virement',
};

export const SETTING_GROUPS = [
  'Taxes',
  'Abonnement',
  'Règlements',
  'Primes TCI',
  'Livraisons',
  'Stock',
  'Catalogue et réseau',
] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

export type SettingInput = 'amountRule' | 'kmf' | 'integer' | 'date' | 'boolean' | 'paymentMethods';

interface SettingDefinition<S extends z.ZodTypeAny> {
  label: string;
  help: string;
  group: SettingGroup;
  input: SettingInput;
  unit?: string;
  schema: S;
  defaultValue: z.infer<S>;
}

const def = <S extends z.ZodTypeAny>(d: SettingDefinition<S>) => d;

export const SETTINGS = {
  'tax.digecom': def({
    label: "Taxe Dig'eCom par vente",
    help: 'Montant fixe ou pourcentage, prélevé sur la part Dig’eCom',
    group: 'Taxes',
    input: 'amountRule',
    schema: amountRuleSchema,
    defaultValue: { mode: 'FIXED', value: 500 },
  }),
  'tax.seller': def({
    label: 'Taxe e-commerçant par vente',
    help: 'Déduite de la part brute de l’e-commerçant',
    group: 'Taxes',
    input: 'amountRule',
    schema: amountRuleSchema,
    defaultValue: { mode: 'FIXED', value: 500 },
  }),
  'subscription.weekly': def({
    label: 'Abonnement e-commerçant',
    help: 'Par semaine, déduit à chaque règlement',
    group: 'Abonnement',
    input: 'kmf',
    unit: 'KMF / semaine',
    schema: kmf,
    defaultValue: 10000,
  }),
  'settlement.cycleDays': def({
    label: 'Cycle de règlement',
    help: 'Durée d’un cycle de règlement des e-commerçants',
    group: 'Règlements',
    input: 'integer',
    unit: 'jours',
    schema: z.number().int().min(1, 'Au moins 1 jour').max(90, '90 jours maximum'),
    defaultValue: 14,
  }),
  'settlement.anchorDate': def({
    label: 'Date d’ancrage des cycles',
    help: 'Premier jour du premier cycle (un lundi)',
    group: 'Règlements',
    input: 'date',
    schema: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date au format AAAA-MM-JJ'),
    defaultValue: '2026-01-05',
  }),
  'tci.bonusMin': def({
    label: 'Prime TCI minimale',
    help: 'Borne basse de la prime fixée par le Leader Junior',
    group: 'Primes TCI',
    input: 'kmf',
    unit: 'KMF / produit',
    schema: kmf,
    defaultValue: 2000,
  }),
  'tci.bonusMax': def({
    label: 'Prime TCI maximale',
    help: 'Borne haute de la prime fixée par le Leader Junior',
    group: 'Primes TCI',
    input: 'kmf',
    unit: 'KMF / produit',
    schema: kmf,
    defaultValue: 3500,
  }),
  'delivery.noCourierAlertMinutes': def({
    label: 'Délai avant alerte « sans livreur »',
    help: 'L’assistant logistique est alerté passé ce délai',
    group: 'Livraisons',
    input: 'integer',
    unit: 'minutes',
    schema: z.number().int().min(1).max(240),
    defaultValue: 10,
  }),
  'delivery.feePerRun': def({
    label: 'Frais par course livrée',
    help: 'Rémunération du livreur par course',
    group: 'Livraisons',
    input: 'kmf',
    unit: 'KMF / course',
    schema: kmf,
    defaultValue: 1000,
  }),
  'stock.lowThresholdDefault': def({
    label: 'Seuil de stock faible',
    help: 'Alerte quand le stock disponible passe sous ce seuil',
    group: 'Stock',
    input: 'integer',
    unit: 'unités',
    schema: z.number().int().min(0),
    defaultValue: 3,
  }),
  'stock.unsoldDaysAlert': def({
    label: 'Alerte invendu',
    help: 'Produit sans vente depuis ce nombre de jours',
    group: 'Stock',
    input: 'integer',
    unit: 'jours',
    schema: z.number().int().min(1).max(365),
    defaultValue: 30,
  }),
  'catalog.defaultSellerShare': def({
    label: 'Part e-commerçant par défaut',
    help: 'Proposée à la création d’un produit (fixe ou % du prix)',
    group: 'Catalogue et réseau',
    input: 'amountRule',
    schema: amountRuleSchema,
    defaultValue: { mode: 'PERCENT', value: 60 },
  }),
  'catalog.requireApproval': def({
    label: 'Validation des produits avant publication',
    help: 'Question ouverte n° 3 : non par défaut',
    group: 'Catalogue et réseau',
    input: 'boolean',
    schema: z.boolean(),
    defaultValue: false,
  }),
  'leader.share': def({
    label: 'Part du leader',
    help: 'Question ouverte n° 2 : à définir (non calculée)',
    group: 'Catalogue et réseau',
    input: 'kmf',
    unit: 'KMF / vente',
    schema: kmf,
    defaultValue: 0,
  }),
  'leader.teamCommission': def({
    label: 'Commission leader sur son équipe',
    help: 'Question ouverte n° 13 : non calculée',
    group: 'Catalogue et réseau',
    input: 'kmf',
    unit: 'KMF / vente',
    schema: kmf,
    defaultValue: 0,
  }),
  'payment.methods': def({
    label: 'Moyens de paiement acceptés',
    help: 'Liste simple, sans intégration (question ouverte n° 14)',
    group: 'Règlements',
    input: 'paymentMethods',
    schema: z
      .array(z.enum(PAYMENT_METHODS))
      .min(1, 'Au moins un moyen de paiement')
      .refine((l) => new Set(l).size === l.length, 'Doublon'),
    defaultValue: ['CASH', 'HURI_MONEY', 'MVOLA', 'BANK_TRANSFER'],
  }),
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS, key);
}

export const settingUpdateSchema = z.object({
  value: z.unknown(),
  /** Date d'effet AAAA-MM-JJ (fuseau Indian/Comoro), aujourd'hui ou plus tard. */
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date au format AAAA-MM-JJ'),
});
export type SettingUpdateInput = z.infer<typeof settingUpdateSchema>;

export interface SettingVersion {
  id: string;
  value: unknown;
  effectiveFrom: string;
  createdAt: string;
  by: { id: string; fullName: string } | null;
}

export interface SettingView {
  key: SettingKey;
  label: string;
  help: string;
  group: SettingGroup;
  input: SettingInput;
  unit?: string;
  current: unknown;
  currentEffectiveFrom: string | null;
  upcoming: SettingVersion[];
  history: SettingVersion[];
}

/** Formatage lisible d'une valeur de paramètre (écran, journal). */
export function formatSettingValue(key: SettingKey, value: unknown): string {
  const d = SETTINGS[key];
  const nf = (n: number) => n.toLocaleString('fr-FR').replace(/\s/g, NBSP);
  switch (d.input) {
    case 'amountRule': {
      const r = value as AmountRule;
      return r.mode === 'FIXED' ? `${nf(r.value)}${NBSP}KMF` : `${r.value}${NBSP}%`;
    }
    case 'kmf':
    case 'integer':
      return `${nf(value as number)}${d.unit ? `${NBSP}${d.unit}` : ''}`;
    case 'boolean':
      return value ? 'Oui' : 'Non';
    case 'date': {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
      return m ? `${m[3]}/${m[2]}/${m[1]}` : String(value);
    }
    case 'paymentMethods':
      return (value as (typeof PAYMENT_METHODS)[number][])
        .map((m) => PAYMENT_METHOD_LABELS[m])
        .join(', ');
    default:
      return String(value);
  }
}
