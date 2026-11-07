/**
 * Données de démonstration (mêmes noms que le prototype), réutilisées par le seed et les tests e2e. Idempotent : relançable sans doublons.
 * Mot de passe commun : SEED_DEFAULT_PASSWORD (voir README). En production, les comptes seedés
 * doivent changer leur mot de passe à la première connexion (SEED_FORCE_PASSWORD_CHANGE=true).
 */
import type { IslandCode, Prisma, PrismaClient, Role, SiteType } from '@prisma/client';
import * as argon2 from 'argon2';

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
];

/** Paramètres par défaut (docs/DATA-MODEL.md, Setting ; hypothèses de OPEN-QUESTIONS.md). */
export const DEFAULT_SETTINGS: Record<string, Prisma.InputJsonValue> = {
  'tax.digecom': { mode: 'FIXED', value: 500 },
  'tax.seller': { mode: 'FIXED', value: 500 },
  'subscription.weekly': 10000,
  'settlement.cycleDays': 14,
  'settlement.anchorDate': '2026-01-05',
  'tci.bonusMin': 2000,
  'tci.bonusMax': 3500,
  'delivery.noCourierAlertMinutes': 10,
  'delivery.feePerRun': 1000,
  'stock.lowThresholdDefault': 3,
  'stock.unsoldDaysAlert': 30,
  'leader.share': 0,
  'leader.teamCommission': 0,
  'catalog.requireApproval': false,
  'payment.methods': ['CASH', 'HURI_MONEY', 'MVOLA', 'BANK_TRANSFER'],
};

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
    await prisma.user.upsert({
      where: { phone: u.phone },
      // Ne réinitialise pas un mot de passe déjà changé.
      update: data,
      create: { ...data, phone: u.phone, passwordHash, mustChangePassword: forceChange },
    });
  }

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({
      where: { key_effectiveFrom: { key, effectiveFrom: SEED_EFFECTIVE_FROM } },
      update: {},
      create: { key, value, effectiveFrom: SEED_EFFECTIVE_FROM },
    });
  }

  return `Seed terminé : ${ISLANDS.length} îles, ${SITES.length} sites, ${SEED_USERS.length} comptes, ${Object.keys(DEFAULT_SETTINGS).length} paramètres.`;
}
