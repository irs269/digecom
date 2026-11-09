/**
 * Premier administrateur en production, SANS données de démonstration :
 *   docker compose -f compose.prod.yml --env-file .env run --rm migrate pnpm --filter api create-admin
 *
 * Demande le nom, le téléphone et le mot de passe (saisie masquée, mêmes règles que
 * l'application), puis crée, s'ils n'existent pas encore, les données de référence minimales
 * (îles, sites, paramètres par défaut) et le compte « Administrateur général ». Aucun compte
 * fictif. Relançable : rien n'est dupliqué, un téléphone déjà utilisé est refusé.
 */
import { passwordPolicySchema, phoneSchema, SETTING_KEYS, SETTINGS } from '@digecom/shared';
import { PrismaClient, type IslandCode, type Prisma, type SiteType } from '@prisma/client';
import { createInterface } from 'node:readline';
import { hashPassword } from '../auth/auth.service';

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
/** Date d'effet des paramètres par défaut (identique au seed : relance sans doublon). */
const EFFECTIVE_FROM = new Date('2026-01-01T00:00:00Z');

/** Données de référence minimales : îles, sites, paramètres par défaut. Idempotent. */
export async function ensureReferenceData(prisma: PrismaClient) {
  const islands = new Map<IslandCode, string>();
  for (const i of ISLANDS) {
    const row = await prisma.island.upsert({ where: { code: i.code }, update: {}, create: i });
    islands.set(i.code, row.id);
  }
  for (const s of SITES) {
    await prisma.site.upsert({
      where: { name: s.name },
      update: {},
      create: { name: s.name, type: s.type, address: s.address, islandId: islands.get(s.island)! },
    });
  }
  for (const key of SETTING_KEYS) {
    await prisma.setting.upsert({
      where: { key_effectiveFrom: { key, effectiveFrom: EFFECTIVE_FROM } },
      update: {},
      create: {
        key,
        value: SETTINGS[key].defaultValue as Prisma.InputJsonValue,
        effectiveFrom: EFFECTIVE_FROM,
      },
    });
  }
  return { islands: ISLANDS.length, sites: SITES.length, settings: SETTING_KEYS.length };
}

export async function createAdmin(
  prisma: PrismaClient,
  input: { fullName: string; phone: string; password: string },
) {
  const fullName = input.fullName.trim();
  if (fullName.length < 2) throw new Error('Nom : 2 caractères minimum');
  const phone = phoneSchema.safeParse(input.phone);
  if (!phone.success) throw new Error(`Téléphone : ${phone.error.issues[0]?.message}`);
  const password = passwordPolicySchema.safeParse(input.password);
  if (!password.success) throw new Error(`Mot de passe : ${password.error.issues[0]?.message}`);
  if (await prisma.user.findUnique({ where: { phone: phone.data } }))
    throw new Error(`Le téléphone ${phone.data} est déjà utilisé`);
  const reference = await ensureReferenceData(prisma);
  const user = await prisma.user.create({
    data: {
      fullName,
      phone: phone.data,
      role: 'ADMIN',
      passwordHash: await hashPassword(password.data),
      mustChangePassword: false,
    },
  });
  return { user, reference };
}

/** Question simple, ou saisie masquée (« * ») pour un mot de passe. */
function ask(question: string, hidden = false): Promise<string> {
  const stdin = process.stdin;
  if (!hidden || !stdin.isTTY) {
    const rl = createInterface({ input: stdin, output: process.stdout });
    return new Promise((resolve) =>
      rl.question(question, (a) => {
        rl.close();
        resolve(a);
      }),
    );
  }
  return new Promise((resolve, reject) => {
    process.stdout.write(question);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(value);
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false);
          process.stdout.write('\n');
          return reject(new Error('Annulé'));
        }
        if (ch === '\u007f' || ch === '\b') {
          if (value) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else {
          value += ch;
          process.stdout.write('*');
        }
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log("Création de l'administrateur général Dig'eCom (aucune donnée de démonstration).");
    const fullName = await ask('Nom complet : ');
    const phone = await ask('Téléphone (+269…) : ');
    let password = '';
    for (;;) {
      password = await ask('Mot de passe (10 caractères min., une lettre et un chiffre) : ', true);
      const check = passwordPolicySchema.safeParse(password);
      if (!check.success) {
        console.log(`  ${check.error.issues[0]?.message}`);
        continue;
      }
      if ((await ask('Confirmer le mot de passe : ', true)) === password) break;
      console.log('  Les deux saisies diffèrent.');
    }
    const { user, reference } = await createAdmin(prisma, { fullName, phone, password });
    console.log(
      `Compte créé : ${user.fullName} (${user.phone}), rôle Administrateur général.\n` +
        `Données de référence : ${reference.islands} îles, ${reference.sites} sites, ` +
        `${reference.settings} paramètres par défaut.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(`Échec : ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
