import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  allowedModules,
  hasPermission,
  MODULE_KEYS,
  PERMISSIONS,
  type ActionKey,
  type ModuleKey,
} from '../src/permissions';
import { ROLES, type Role } from '../src/roles';

/**
 * Ces tests lisent docs/PERMISSIONS.md et vérifient que le code est identique au document.
 * Si l'un échoue : le document et `permissions.ts` ont divergé, il faut les réaligner.
 */
const doc = readFileSync(resolve(__dirname, '../../../docs/PERMISSIONS.md'), 'utf8');

const ROLE_ALIASES: Record<string, Role> = {
  ADMIN: 'ADMIN',
  FINANCE: 'FINANCE_MANAGER',
  FINANCE_MANAGER: 'FINANCE_MANAGER',
  ACCOUNTANT: 'ACCOUNTANT',
  ACC_ASSIST: 'ACCOUNTANT_ASSISTANT',
  ACCOUNTANT_ASSISTANT: 'ACCOUNTANT_ASSISTANT',
  CASHIER: 'CASHIER',
  STOCK: 'STOCK_MANAGER',
  STOCK_MANAGER: 'STOCK_MANAGER',
  LOGISTICS: 'LOGISTICS_ASSISTANT',
  LOGISTICS_ASSISTANT: 'LOGISTICS_ASSISTANT',
  LEADER_S: 'LEADER_SENIOR',
  LEADER_SENIOR: 'LEADER_SENIOR',
  LEADER_J: 'LEADER_JUNIOR',
  LEADER_JUNIOR: 'LEADER_JUNIOR',
  TCI: 'TELECONSULTANT',
  TELECONSULTANT: 'TELECONSULTANT',
  SELLER: 'SELLER',
  COURIER: 'COURIER',
};

function section(title: string): string[] {
  const start = doc.indexOf(title);
  if (start < 0) throw new Error(`Section introuvable : ${title}`);
  const rest = doc.slice(start + title.length);
  const end = rest.search(/\n## /);
  return (end < 0 ? rest : rest.slice(0, end)).split('\n').filter((l) => l.startsWith('|'));
}

function cells(line: string): string[] {
  return line
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim());
}

function parseMatrix(): Record<Role, Partial<Record<ModuleKey, 'C' | 'L'>>> {
  const [header, , ...rows] = section('## Matrice des modules');
  const roles = cells(header!)
    .slice(1)
    .map((h) => {
      const role = ROLE_ALIASES[h];
      if (!role) throw new Error(`Rôle inconnu dans la matrice : ${h}`);
      return role;
    });
  const result = Object.fromEntries(ROLES.map((r) => [r, {}])) as Record<
    Role,
    Partial<Record<ModuleKey, 'C' | 'L'>>
  >;
  for (const row of rows) {
    const [label, ...values] = cells(row);
    const key = /`([a-z_]+)`/.exec(label!)?.[1] as ModuleKey | undefined;
    if (!key) throw new Error(`Clé de module introuvable : ${label}`);
    values.forEach((v, i) => {
      const level = v.charAt(0);
      if (level === 'C' || level === 'L') result[roles[i]!][key] = level;
    });
  }
  return result;
}

function parseActions(): Record<string, Role[]> {
  const [, , ...rows] = section('## Actions fines');
  const result: Record<string, Role[]> = {};
  for (const row of rows) {
    const [perm, rolesCell] = cells(row);
    const names = [...perm!.matchAll(/`([a-z_:*]+)`/g)].map((m) => m[1]!);
    if (names[0] === 'users:*') continue; // couvert par le module `users` (C uniquement pour ADMIN)
    const module = names[0]!.split(':')[0]!;
    const roles = [
      ...new Set(
        [...rolesCell!.replace(/\([^)]*\)/g, '').matchAll(/\b[A-Z][A-Z_]+\b/g)].map((m) => {
          const role = ROLE_ALIASES[m[0]];
          if (!role) throw new Error(`Rôle inconnu dans les actions : ${m[0]}`);
          return role;
        }),
      ),
    ];
    for (const name of names) {
      result[name.includes(':') ? name : `${module}:${name}`] = roles;
    }
  }
  return result;
}

describe('PERMISSIONS ↔ docs/PERMISSIONS.md', () => {
  it('la matrice des modules est identique au document', () => {
    expect(PERMISSIONS).toEqual(parseMatrix());
  });

  it('les actions fines sont identiques au document', () => {
    const expected = parseActions();
    const actual = Object.fromEntries(Object.entries(ACTIONS).map(([k, v]) => [k, [...v].sort()]));
    expect(actual).toEqual(
      Object.fromEntries(Object.entries(expected).map(([k, v]) => [k, [...v].sort()])),
    );
  });

  it('chaque rôle du document existe dans le code', () => {
    const documented = [...doc.matchAll(/^\| `([A-Z_]+)` \|/gm)].map((m) => m[1]);
    expect(documented.sort()).toEqual([...ROLES].sort());
  });
});

describe('allowedModules', () => {
  it("l'administrateur voit les 16 modules en accès complet", () => {
    const mods = allowedModules('ADMIN');
    expect(mods).toHaveLength(16);
    expect(mods.every((m) => m.access === 'C')).toBe(true);
    expect(mods.map((m) => m.key)).toEqual([...MODULE_KEYS]);
  });

  it('le caissier voit 3 modules', () => {
    expect(allowedModules('CASHIER').map((m) => [m.key, m.access])).toEqual([
      ['dashboard', 'L'],
      ['settlements', 'C'],
      ['cash', 'C'],
    ]);
  });

  it("l'e-commerçant et le livreur n'ont aucun module du back-office", () => {
    expect(allowedModules('SELLER')).toEqual([]);
    expect(allowedModules('COURIER')).toEqual([]);
  });

  it('adapte les libellés selon le rôle', () => {
    const label = (role: Role, key: ModuleKey) =>
      allowedModules(role).find((m) => m.key === key)?.label;
    expect(label('LEADER_SENIOR', 'catalog')).toBe('Mon catalogue');
    expect(label('TELECONSULTANT', 'tci_sales')).toBe('Mes ventes et gains');
    expect(label('LEADER_JUNIOR', 'tci_sales')).toBe("Ventes de l'équipe");
    expect(label('ADMIN', 'catalog')).toBe('Catalogues leaders');
  });
});

describe('hasPermission', () => {
  it('distingue lecture et écriture', () => {
    expect(hasPermission('FINANCE_MANAGER', 'orders:read')).toBe(true);
    expect(hasPermission('FINANCE_MANAGER', 'orders:write')).toBe(false);
    expect(hasPermission('CASHIER', 'users:read')).toBe(false);
    expect(hasPermission('ADMIN', 'users:write')).toBe(true);
  });

  it('applique les actions fines', () => {
    const check = (role: Role, action: ActionKey) => hasPermission(role, action);
    expect(check('ACCOUNTANT', 'settlements:verify')).toBe(true);
    expect(check('FINANCE_MANAGER', 'settlements:verify')).toBe(false);
    expect(check('CASHIER', 'settlements:pay')).toBe(true);
    expect(check('COURIER', 'deliveries:accept')).toBe(true);
    expect(check('ADMIN', 'deliveries:accept')).toBe(false);
  });
});
