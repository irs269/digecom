import { z } from 'zod';
import type { AllowedModule } from './permissions';
import type { Role, ScopeKind } from './roles';

/**
 * Téléphone comorien normalisé `+269XXXXXXX` (7 chiffres).
 * Accepte les espaces, points, tirets, le préfixe `00269` ou l'absence d'indicatif.
 */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s.-]/g, ''))
  .transform((v) => {
    if (v.startsWith('+269')) return v;
    if (v.startsWith('00269')) return `+${v.slice(2)}`;
    return `+269${v}`;
  })
  .pipe(z.string().regex(/^\+269\d{7}$/, 'Numéro de téléphone invalide (format +269 XXX XX XX)'));

/** Affichage d'un téléphone normalisé : `+2693300003` → `+269 330 00 03`. */
export function formatPhone(phone: string): string {
  const m = /^\+269(\d{3})(\d{2})(\d{2})$/.exec(phone);
  return m ? `+269 ${m[1]} ${m[2]} ${m[3]}` : phone;
}

export const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, 'Mot de passe requis').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const kmfAmountSchema = z.number().int('Montant entier en KMF attendu');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sort: z.string().optional(),
});
export type PaginationInput = z.infer<typeof paginationSchema>;

/** Ordre d'affichage des îles : Grande Comore, Anjouan, Mohéli. */
export const ISLAND_CODES = ['GC', 'AN', 'MO'] as const;
export type IslandCode = (typeof ISLAND_CODES)[number];
export const ISLAND_LABELS: Record<IslandCode, string> = {
  GC: 'Grande Comore',
  AN: 'Anjouan',
  MO: 'Mohéli',
};

/** Format d'erreur unique de l'API. */
export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface MeResponse {
  id: string;
  fullName: string;
  phone: string;
  role: Role;
  roleLabel: string;
  scope: ScopeKind;
  island: { id: string; code: IslandCode; name: string } | null;
  site: { id: string; name: string } | null;
  mustChangePassword: boolean;
  modules: AllowedModule[];
}

export interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: MeResponse;
}
