/**
 * Données de démonstration (mêmes noms que le prototype), réutilisées par le seed et les tests e2e. Idempotent : relançable sans doublons.
 * Mot de passe commun : SEED_DEFAULT_PASSWORD (voir README). En production, les comptes seedés
 * doivent changer leur mot de passe à la première connexion (SEED_FORCE_PASSWORD_CHANGE=true).
 */
import type { IslandCode, Prisma, PrismaClient, Role, SiteType } from '@prisma/client';
import { SETTING_KEYS, SETTINGS } from '@digecom/shared';
import * as argon2 from 'argon2';
import { seedCatalog } from './seed-catalog';

const ISLANDS: { code: IslandCode; name: string }[] = [
  { code: 'GC', name: 'Grande Comore' },
  { code: 'AN', name: 'Anjouan' },
  { code: 'MO', name: 'Mohéli' },
];

const SITES: { name: string; type: SiteType; island: IslandCode; address: string }[] = [
  { name: 'Moroni – Entrepôt central', type: 'WAREHOUSE', island: 'GC', address: 'Moroni' },
  { name: 'Mutsamudu – Boutique', type: 'SHOP', island: 'AN', address: 'Mutsamudu' },
  { name: 'Fomboni – Boutique', type: 'SHOP', island: 'MO', address: 'Fomboni' },
];

interface SeedUser {
  fullName: string;
  phone: string;
  role: Role;
  island?: IslandCode;
  site?: string;
  leaderPhone?: string;
  isAvailable?: boolean;
}

/** Un compte par rôle. Téléphones fictifs +269 330 00 XX. */
export const SEED_USERS: SeedUser[] = [
  { fullName: "Direction Dig'eCom", phone: '+2693300001', role: 'ADMIN' },
  { fullName: 'Soifia Mohamed', phone: '+2693300002', role: 'FINANCE_MANAGER' },
  { fullName: 'Abdallah Saïd', phone: '+2693300003', role: 'ACCOUNTANT' },
  { fullName: 'Hadidja Ahmed', phone: '+2693300004', role: 'ACCOUNTANT_ASSISTANT' },
  {
    fullName: 'Mariama Combo',
    phone: '+2693300005',
    role: 'CASHIER',
    island: 'MO',
    site: 'Fomboni – Boutique',
  },
  {
    fullName: 'Nourdine Assoumani',
    phone: '+2693300006',
    role: 'STOCK_MANAGER',
    island: 'AN',
    site: 'Mutsamudu – Boutique',
  },
  {
    fullName: 'Toiwilou Hamada',
    phone: '+2693300007',
    role: 'LOGISTICS_ASSISTANT',
    island: 'GC',
    site: 'Moroni – Entrepôt central',
  },
  { fullName: 'Ali Mohamed', phone: '+2693300008', role: 'LEADER_SENIOR', island: 'GC' },
  { fullName: 'Rachad Ibrahim', phone: '+2693300009', role: 'LEADER_JUNIOR', island: 'GC' },
  {
    fullName: 'Anlia Hassani',
    phone: '+2693300010',
    role: 'TELECONSULTANT',
    island: 'GC',
    leaderPhone: '+2693300009',
  },
  {
    fullName: 'Fatima Said',
    phone: '+2693300011',
    role: 'SELLER',
    island: 'GC',
    leaderPhone: '+2693300008',
  },
  {
    fullName: 'Djamal Said',
    phone: '+2693300012',
    role: 'COURIER',
    island: 'AN',
    isAvailable: true,
  },
  // Réseau complémentaire du prototype (autres îles, autres équipes).
  { fullName: 'Nassur Ahmed', phone: '+2693300013', role: 'LEADER_SENIOR', island: 'AN' },
  { fullName: 'Moinaecha Ali', phone: '+2693300014', role: 'LEADER_SENIOR', island: 'MO' },
  { fullName: 'Kamaria Said', phone: '+2693300015', role: 'LEADER_JUNIOR', island: 'AN' },
  {
    fullName: 'Mouhidine Youssouf',
    phone: '+2693300016',
    role: 'SELLER',
    island: 'GC',
    leaderPhone: '+2693300008',
  },
  {
    fullName: 'Hassane Daoud',
    phone: '+2693300017',
    role: 'SELLER',
    island: 'GC',
    leaderPhone: '+2693300008',
  },
  {
    fullName: 'Anrifa Soilihi',
    phone: '+2693300018',
    role: 'SELLER',
    island: 'AN',
    leaderPhone: '+2693300013',
  },
  {
    fullName: 'Ibrahim Houmadi',
    phone: '+2693300019',
    role: 'SELLER',
    island: 'AN',
    leaderPhone: '+2693300013',
  },
  {
    fullName: 'Zainaba Ibrahim',
    phone: '+2693300020',
    role: 'SELLER',
    island: 'MO',
    leaderPhone: '+2693300014',
  },
  {
    fullName: 'Faïza Mohamed',
    phone: '+2693300021',
    role: 'TELECONSULTANT',
    island: 'GC',
    leaderPhone: '+2693300009',
  },
  {
    fullName: 'Bacar Toybou',
    phone: '+2693300022',
    role: 'TELECONSULTANT',
    island: 'AN',
    leaderPhone: '+2693300015',
  },
  {
    fullName: 'Karim Bacar',
    phone: '+2693300023',
    role: 'COURIER',
    island: 'GC',
    isAvailable: true,
  },
  {
    fullName: 'Youssouf Ali',
    phone: '+2693300024',
    role: 'COURIER',
    island: 'GC',
    isAvailable: true,
  },
];

/** Paramètres par défaut : valeurs du registre partagé (packages/shared/src/settings.ts). */
export const DEFAULT_SETTINGS: Record<string, Prisma.InputJsonValue> = Object.fromEntries(
  SETTING_KEYS.map((k) => [k, SETTINGS[k].defaultValue as Prisma.InputJsonValue]),
);

/** Date d'effet des paramètres seedés : fixe, pour que le seed reste idempotent. */
const SEED_EFFECTIVE_FROM = new Date('2026-01-01T00:00:00Z');

export async function seedDatabase(
  prisma: PrismaClient,
  password: string,
  forceChange: boolean,
): Promise<string> {
  if (password.length < 8) {
    throw new Error('Mot de passe de seed trop court (8 caractères minimum).');
  }
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const islands = new Map<IslandCode, string>();
  for (const island of ISLANDS) {
    const row = await prisma.island.upsert({
      where: { code: island.code },
      update: { name: island.name },
      create: island,
    });
    islands.set(island.code, row.id);
  }

  const sites = new Map<string, string>();
  for (const site of SITES) {
    const data = {
      name: site.name,
      type: site.type,
      address: site.address,
      islandId: islands.get(site.island)!,
    };
    const row = await prisma.site.upsert({
      where: { name: site.name },
      update: data,
      create: data,
    });
    sites.set(site.name, row.id);
  }

  // Les leaders d'abord, pour rattacher ensuite leurs vendeurs.
  const ordered = [...SEED_USERS].sort((a, b) => Number(!!a.leaderPhone) - Number(!!b.leaderPhone));
  let adminId: string | null = null;
  for (const u of ordered) {
    const leader = u.leaderPhone
      ? await prisma.user.findUniqueOrThrow({ where: { phone: u.leaderPhone } })
      : null;
    const data = {
      fullName: u.fullName,
      role: u.role,
      islandId: u.island ? islands.get(u.island)! : null,
      siteId: u.site ? sites.get(u.site)! : null,
      leaderId: leader?.id ?? null,
      isAvailable: u.isAvailable ?? false,
      isActive: true,
    };
    // Compte existant : jamais modifié (mot de passe, réaffectations faites depuis l'écran…).
    const existing = await prisma.user.findUnique({ where: { phone: u.phone } });
    const saved =
      existing ??
      (await prisma.user.create({
        data: { ...data, phone: u.phone, passwordHash, mustChangePassword: forceChange },
      }));
    if (u.role === 'ADMIN') adminId ??= saved.id;
    // Historique du rattachement initial, une seule fois.
    if (!existing && leader && adminId) {
      await prisma.teamAssignmentHistory.create({
        data: {
          userId: saved.id,
          toLeaderId: leader.id,
          reason: 'Données initiales',
          byId: adminId,
        },
      });
    }
  }

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({
      where: { key_effectiveFrom: { key, effectiveFrom: SEED_EFFECTIVE_FROM } },
      update: {},
      create: { key, value, effectiveFrom: SEED_EFFECTIVE_FROM },
    });
  }

  const catalog = adminId ? await seedCatalog(prisma, adminId) : 'catalogues ignorés';

  return `Seed terminé : ${ISLANDS.length} îles, ${SITES.length} sites, ${SEED_USERS.length} comptes, ${Object.keys(DEFAULT_SETTINGS).length} paramètres, ${catalog}.`;
}
