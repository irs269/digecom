import type { Role } from './roles';

/**
 * Source de vérité des droits. Doit rester identique à docs/PERMISSIONS.md
 * (vérifié automatiquement par test/permissions.test.ts).
 */
export const MODULE_KEYS = [
  'dashboard',
  'orders',
  'deliveries',
  'stock',
  'purchases',
  'network',
  'catalog',
  'campaigns',
  'prospects',
  'tci_sales',
  'settlements',
  'cash',
  'expenses',
  'reports',
  'users',
  'settings',
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

/** `C` = complet, `L` = lecture seule. Absent = module invisible et endpoints refusés (403). */
export type AccessLevel = 'C' | 'L';

export const MODULE_LABELS: Record<ModuleKey, string> = {
  dashboard: 'Tableau de bord',
  orders: 'Commandes',
  deliveries: 'Livraisons',
  stock: 'Stock',
  purchases: 'Achats Chine',
  network: 'Réseau commercial',
  catalog: 'Catalogues leaders',
  campaigns: 'Campagnes',
  prospects: 'Prospects',
  tci_sales: 'Ventes et gains TCI',
  settlements: 'Règlements',
  cash: 'Caisse',
  expenses: 'Dépenses',
  reports: 'Rapports',
  users: 'Utilisateurs et droits',
  settings: 'Paramètres',
};

/** Chemins des pages du back-office (URL en français). */
export const MODULE_PATHS: Record<ModuleKey, string> = {
  dashboard: '/tableau-de-bord',
  orders: '/commandes',
  deliveries: '/livraisons',
  stock: '/stock',
  purchases: '/achats',
  network: '/reseau',
  catalog: '/catalogues',
  campaigns: '/campagnes',
  prospects: '/prospects',
  tci_sales: '/ventes-tci',
  settlements: '/reglements',
  cash: '/caisse',
  expenses: '/depenses',
  reports: '/rapports',
  users: '/utilisateurs',
  settings: '/parametres',
};

export type ModuleMatrix = Partial<Record<ModuleKey, AccessLevel>>;

const ALL_COMPLETE: ModuleMatrix = Object.fromEntries(MODULE_KEYS.map((m) => [m, 'C']));

/** Matrice des modules du back-office, par rôle. */
export const PERMISSIONS: Record<Role, ModuleMatrix> = {
  ADMIN: ALL_COMPLETE,
  FINANCE_MANAGER: {
    dashboard: 'L',
    orders: 'L',
    deliveries: 'L',
    stock: 'L',
    purchases: 'L',
    network: 'L',
    catalog: 'L',
    campaigns: 'L',
    tci_sales: 'L',
    settlements: 'C',
    cash: 'L',
    expenses: 'C',
    reports: 'C',
    settings: 'L',
  },
  ACCOUNTANT: {
    dashboard: 'L',
    orders: 'L',
    stock: 'L',
    purchases: 'L',
    catalog: 'L',
    campaigns: 'L',
    tci_sales: 'L',
    settlements: 'C',
    cash: 'L',
    expenses: 'C',
    reports: 'C',
  },
  ACCOUNTANT_ASSISTANT: { dashboard: 'L', settlements: 'L', cash: 'C', expenses: 'C' },
  CASHIER: { dashboard: 'L', settlements: 'C', cash: 'C' },
  STOCK_MANAGER: {
    dashboard: 'L',
    orders: 'L',
    deliveries: 'L',
    stock: 'C',
    purchases: 'C',
    catalog: 'L',
  },
  LOGISTICS_ASSISTANT: {
    dashboard: 'L',
    orders: 'C',
    deliveries: 'C',
    stock: 'L',
    catalog: 'L',
  },
  LEADER_SENIOR: { dashboard: 'L', orders: 'L', network: 'C', catalog: 'C', reports: 'L' },
  LEADER_JUNIOR: {
    dashboard: 'L',
    orders: 'L',
    catalog: 'C',
    campaigns: 'C',
    prospects: 'L',
    tci_sales: 'L',
    reports: 'L',
  },
  TELECONSULTANT: { dashboard: 'L', prospects: 'C', tci_sales: 'C' },
  // E-commerçants et livreurs : application mobile uniquement (phase 8).
  SELLER: {},
  COURIER: {},
};

/** Actions fines `module:action` et rôles autorisés (le périmètre est vérifié par le ScopeService). */
export const ACTIONS = {
  'orders:create_on_behalf': ['ADMIN', 'LOGISTICS_ASSISTANT'],
  'orders:advance': ['ADMIN', 'LOGISTICS_ASSISTANT'],
  'orders:change_mode': ['ADMIN', 'LOGISTICS_ASSISTANT'],
  'orders:mark_sold': ['ADMIN', 'LOGISTICS_ASSISTANT', 'SELLER', 'COURIER', 'TELECONSULTANT'],
  'orders:mark_refused': ['ADMIN', 'LOGISTICS_ASSISTANT', 'SELLER', 'COURIER', 'TELECONSULTANT'],
  'orders:restock_return': ['ADMIN', 'STOCK_MANAGER'],
  'deliveries:assign_manual': ['ADMIN', 'LOGISTICS_ASSISTANT'],
  'deliveries:accept': ['COURIER'],
  'deliveries:pickup': ['COURIER'],
  'deliveries:handover': ['COURIER'],
  'deliveries:fail': ['COURIER'],
  'stock:entry': ['ADMIN', 'STOCK_MANAGER'],
  'stock:transfer': ['ADMIN', 'STOCK_MANAGER'],
  'stock:inventory': ['ADMIN', 'STOCK_MANAGER'],
  'stock:adjust': ['ADMIN', 'STOCK_MANAGER'],
  'purchases:create': ['ADMIN', 'STOCK_MANAGER'],
  'purchases:advance': ['ADMIN', 'STOCK_MANAGER'],
  'purchases:receive': ['ADMIN', 'STOCK_MANAGER'],
  'catalog:publish': ['ADMIN', 'LEADER_SENIOR', 'LEADER_JUNIOR'],
  'catalog:unpublish': ['ADMIN', 'LEADER_SENIOR', 'LEADER_JUNIOR'],
  'catalog:edit_price': ['ADMIN', 'LEADER_SENIOR', 'LEADER_JUNIOR'],
  'catalog:edit_share': ['ADMIN', 'LEADER_SENIOR', 'LEADER_JUNIOR'],
  'catalog:adjust_stock': ['ADMIN', 'LEADER_SENIOR', 'LEADER_JUNIOR'],
  'catalog:edit_tci_bonus': ['ADMIN', 'LEADER_JUNIOR'],
  'network:assign_seller': ['ADMIN'],
  'network:reassign': ['ADMIN'],
  'network:allocate': ['ADMIN', 'LEADER_SENIOR'],
  'campaigns:create': ['ADMIN', 'LEADER_JUNIOR'],
  'campaigns:pause': ['ADMIN', 'LEADER_JUNIOR'],
  'campaigns:resume': ['ADMIN', 'LEADER_JUNIOR'],
  'campaigns:edit': ['ADMIN', 'LEADER_JUNIOR'],
  'prospects:import': ['ADMIN', 'LEADER_JUNIOR'],
  'prospects:assign': ['ADMIN', 'LEADER_JUNIOR'],
  'prospects:call_outcome': ['TELECONSULTANT'],
  'tci_sales:close': ['TELECONSULTANT', 'ADMIN'],
  'settlements:verify': ['ACCOUNTANT', 'ADMIN'],
  'settlements:approve': ['FINANCE_MANAGER', 'ADMIN'],
  'settlements:pay': ['CASHIER', 'ADMIN'],
  'cash:collect': ['CASHIER', 'ACCOUNTANT_ASSISTANT', 'ADMIN'],
  'cash:open': ['CASHIER', 'ACCOUNTANT_ASSISTANT', 'ADMIN'],
  'cash:close': ['CASHIER', 'ACCOUNTANT_ASSISTANT', 'ADMIN'],
  'expenses:create': ['ACCOUNTANT', 'ACCOUNTANT_ASSISTANT', 'ADMIN'],
  'expenses:approve': ['FINANCE_MANAGER', 'ADMIN'],
  'reports:export': ['ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'],
  'settings:edit': ['ADMIN'],
} as const satisfies Record<string, readonly Role[]>;

export type ActionKey = keyof typeof ACTIONS;

/**
 * Permission vérifiable par l'API :
 * - `module:read`  → module visible (C ou L)
 * - `module:write` → module en accès complet (C) ; `users:*` = `users:write`
 * - une action fine de ACTIONS
 */
export type Permission = `${ModuleKey}:read` | `${ModuleKey}:write` | ActionKey;

export function isActionKey(permission: string): permission is ActionKey {
  return Object.prototype.hasOwnProperty.call(ACTIONS, permission);
}

export function moduleAccess(role: Role, module: ModuleKey): AccessLevel | null {
  return PERMISSIONS[role][module] ?? null;
}

export function hasPermission(role: Role, permission: Permission): boolean {
  if (isActionKey(permission)) {
    return (ACTIONS[permission] as readonly Role[]).includes(role);
  }
  const [module, verb] = permission.split(':') as [ModuleKey, 'read' | 'write'];
  const level = moduleAccess(role, module);
  if (verb === 'read') return level !== null;
  return level === 'C';
}

export interface AllowedModule {
  key: ModuleKey;
  label: string;
  path: string;
  access: AccessLevel;
}

/** Libellé du menu selon le rôle (voir PERMISSIONS.md). */
export function moduleLabelFor(role: Role, module: ModuleKey): string {
  if (module === 'catalog' && (role === 'LEADER_SENIOR' || role === 'LEADER_JUNIOR')) {
    return 'Mon catalogue';
  }
  if (module === 'tci_sales') {
    if (role === 'TELECONSULTANT') return 'Mes ventes et gains';
    if (role === 'LEADER_JUNIOR') return "Ventes de l'équipe";
  }
  return MODULE_LABELS[module];
}

/** Modules visibles par un rôle, dans l'ordre du menu. */
export function allowedModules(role: Role): AllowedModule[] {
  return MODULE_KEYS.flatMap((key) => {
    const access = moduleAccess(role, key);
    return access
      ? [{ key, label: moduleLabelFor(role, key), path: MODULE_PATHS[key], access }]
      : [];
  });
}
