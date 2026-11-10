import { z } from 'zod';
import { ROLES, type Role } from './roles';
import { paginationSchema, phoneSchema, type ISLAND_CODES } from './schemas';

/** Rôles qui doivent avoir une île (rôles d'île, terrain, réseau commercial). */
export const ROLES_REQUIRING_ISLAND: readonly Role[] = [
  'CASHIER',
  'STOCK_MANAGER',
  'LOGISTICS_ASSISTANT',
  'COURIER',
  'LEADER_SENIOR',
  'LEADER_JUNIOR',
  'SELLER',
  'TELECONSULTANT',
];

/** Rôles globaux : pas d'île ni de site. */
export const GLOBAL_ROLES: readonly Role[] = [
  'ADMIN',
  'FINANCE_MANAGER',
  'ACCOUNTANT',
  'ACCOUNTANT_ASSISTANT',
];

/** Rôles rattachés à un site (facultatif mais autorisé). */
export const ROLES_WITH_SITE: readonly Role[] = ['CASHIER', 'STOCK_MANAGER', 'LOGISTICS_ASSISTANT'];

/** Vendeur → rôle de leader exigé. */
export const REQUIRED_LEADER_ROLE: Partial<Record<Role, Role>> = {
  SELLER: 'LEADER_SENIOR',
  TELECONSULTANT: 'LEADER_JUNIOR',
};

export const LEADER_ROLES: readonly Role[] = ['LEADER_SENIOR', 'LEADER_JUNIOR'];

const optionalId = z
  .string()
  .trim()
  .min(1)
  .nullish()
  .transform((v) => v ?? null);

const fullName = z.string().trim().min(2, 'Nom trop court').max(120, 'Nom trop long');
const email = z
  .string()
  .trim()
  .email('Adresse e-mail invalide')
  .max(200)
  .nullish()
  .or(z.literal('').transform(() => null))
  .transform((v) => v ?? null);

export const createUserSchema = z.object({
  fullName,
  phone: phoneSchema,
  email,
  role: z.enum(ROLES),
  islandId: optionalId,
  siteId: optionalId,
  leaderId: optionalId,
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

/** Modification : le rattachement à un leader passe par la réaffectation (historisée). */
export const updateUserSchema = createUserSchema.omit({ leaderId: true }).partial();
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const reassignSchema = z.object({
  leaderId: z.string().trim().min(1, 'Nouveau leader requis'),
  reason: z.string().trim().min(3, 'Motif requis (3 caractères minimum)').max(500),
});
export type ReassignInput = z.infer<typeof reassignSchema>;

export const userListQuerySchema = paginationSchema.extend({
  role: z.enum(ROLES).optional(),
  islandId: z.string().optional(),
  siteId: z.string().optional(),
  leaderId: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  q: z.string().trim().max(100).optional(),
  sort: z
    .enum(['fullName', '-fullName', 'lastLoginAt', '-lastLoginAt', 'createdAt', '-createdAt'])
    .optional(),
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

/** Politique de mot de passe : 10 caractères minimum, au moins une lettre et un chiffre. */
export const passwordPolicySchema = z
  .string()
  .min(10, '10 caractères minimum')
  .max(200)
  .regex(/[A-Za-zÀ-ÿ]/, 'Au moins une lettre')
  .regex(/\d/, 'Au moins un chiffre');

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Mot de passe actuel requis'),
    newPassword: passwordPolicySchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'Le nouveau mot de passe doit être différent de l’actuel',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const siteSchema = z.object({
  name: z.string().trim().min(2, 'Nom trop court').max(120),
  type: z.enum(['SHOP', 'WAREHOUSE']),
  islandId: z.string().min(1, 'Île requise'),
  address: z
    .string()
    .trim()
    .max(300)
    .nullish()
    .transform((v) => v || null),
  /** Position GPS du site (degrés décimaux), utilisée pour la distance des livreurs. */
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
});
export type SiteInput = z.infer<typeof siteSchema>;
export const updateSiteSchema = siteSchema.partial();

export const SITE_TYPE_LABELS = { SHOP: 'Boutique', WAREHOUSE: 'Entrepôt' } as const;

export const auditQuerySchema = paginationSchema.extend({
  actorId: z.string().optional(),
  entity: z.string().optional(),
  entityId: z.string().optional(),
  action: z.string().max(100).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

// --- Vues renvoyées par l'API -------------------------------------------------

export interface IslandView {
  id: string;
  code: (typeof ISLAND_CODES)[number];
  name: string;
}

export interface SiteView {
  id: string;
  name: string;
  type: 'SHOP' | 'WAREHOUSE';
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  isActive: boolean;
  island: IslandView;
}

export interface UserView {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  role: Role;
  isActive: boolean;
  isAvailable: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
  island: IslandView | null;
  site: { id: string; name: string } | null;
  leader: { id: string; fullName: string; role: Role } | null;
  teamSize: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreatedUserResponse {
  user: UserView;
  /** Affiché une seule fois à l'administrateur. */
  temporaryPassword: string;
}

export interface TeamAssignmentView {
  id: string;
  at: string;
  reason: string;
  user: { id: string; fullName: string };
  fromLeader: { id: string; fullName: string } | null;
  toLeader: { id: string; fullName: string };
  by: { id: string; fullName: string };
}

export interface LeaderTeamView {
  leader: UserView;
  members: UserView[];
}

export interface AuditEntryView {
  id: string;
  at: string;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  actor: { id: string; fullName: string; role: Role } | null;
}

/** Libellés lisibles des actions d'audit fréquentes. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: 'Connexion',
  LOGIN_FAILED: 'Connexion échouée',
  LOGOUT: 'Déconnexion',
  REFRESH_TOKEN_REUSE: 'Réutilisation de session suspecte',
  USER_CREATE: 'Création de compte',
  USER_UPDATE: 'Modification de compte',
  USER_DEACTIVATE: 'Désactivation de compte',
  USER_REACTIVATE: 'Réactivation de compte',
  USER_RESET_PASSWORD: 'Réinitialisation du mot de passe',
  USER_REASSIGN: 'Réaffectation à un leader',
  PASSWORD_CHANGE: 'Changement de mot de passe',
  SITE_CREATE: 'Création de site',
  SITE_UPDATE: 'Modification de site',
  SITE_DEACTIVATE: 'Désactivation de site',
  SITE_REACTIVATE: 'Réactivation de site',
  SETTING_VERSION: 'Nouvelle version de paramètre',
};
