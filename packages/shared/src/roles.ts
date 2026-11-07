/** Rôles de la plateforme (voir docs/PERMISSIONS.md). */
export const ROLES = [
  'ADMIN',
  'FINANCE_MANAGER',
  'ACCOUNTANT',
  'ACCOUNTANT_ASSISTANT',
  'CASHIER',
  'STOCK_MANAGER',
  'LOGISTICS_ASSISTANT',
  'LEADER_SENIOR',
  'LEADER_JUNIOR',
  'TELECONSULTANT',
  'SELLER',
  'COURIER',
] as const;

export type Role = (typeof ROLES)[number];

export const Role = Object.fromEntries(ROLES.map((r) => [r, r])) as { [K in Role]: K };

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrateur général',
  FINANCE_MANAGER: 'Responsable financier',
  ACCOUNTANT: 'Comptable',
  ACCOUNTANT_ASSISTANT: 'Assistant comptable',
  CASHIER: 'Caissier',
  STOCK_MANAGER: 'Gestionnaire de stock',
  LOGISTICS_ASSISTANT: 'Assistant logistique',
  LEADER_SENIOR: 'Leader Senior',
  LEADER_JUNIOR: 'Leader Junior',
  TELECONSULTANT: 'Téléconseiller',
  SELLER: 'E-commerçant',
  COURIER: 'Livreur',
};

export type ScopeKind = 'GLOBAL' | 'ISLAND' | 'LEADER' | 'OWNER';

/** Périmètre par défaut de chaque rôle (appliqué par le ScopeService côté API). */
export const ROLE_SCOPE: Record<Role, ScopeKind> = {
  ADMIN: 'GLOBAL',
  FINANCE_MANAGER: 'GLOBAL',
  ACCOUNTANT: 'GLOBAL',
  ACCOUNTANT_ASSISTANT: 'GLOBAL',
  CASHIER: 'ISLAND',
  STOCK_MANAGER: 'ISLAND',
  LOGISTICS_ASSISTANT: 'ISLAND',
  LEADER_SENIOR: 'LEADER',
  LEADER_JUNIOR: 'LEADER',
  TELECONSULTANT: 'OWNER',
  SELLER: 'OWNER',
  COURIER: 'ISLAND',
};

/** Rôles qui doivent obligatoirement avoir une île. */
export const ISLAND_BOUND_ROLES: readonly Role[] = [
  'CASHIER',
  'STOCK_MANAGER',
  'LOGISTICS_ASSISTANT',
  'COURIER',
];
