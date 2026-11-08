/**
 * Données de charge (phase 6) : génère N commandes vendues (50 000 par défaut) réparties sur les
 * 90 derniers jours, puis mesure GET /dashboard (cache vidé avant chaque appel) pour plusieurs rôles.
 *
 *   pnpm --filter api load-test            # génère 50 000 commandes puis mesure
 *   pnpm --filter api load-test -- 20000   # autre volume
 *   pnpm --filter api load-test -- --measure  # mesure seulement
 *   pnpm --filter api load-test -- --cleanup  # supprime les commandes générées
 *
 * Les commandes générées portent le préfixe LT- et la note « LOAD-TEST » : elles ne passent ni par
 * le stock ni par le grand livre (jamais en production).
 */
import { addDays, businessToday, startOfBusinessDay } from '@digecom/shared';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const prisma = new PrismaClient();
const API = process.env.LOAD_TEST_API ?? `http://localhost:${process.env.API_PORT ?? 4000}`;
const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Digecom2026!';
const BUDGET_MS = 800;

async function generate(n: number) {
  if (process.env.NODE_ENV === 'production') throw new Error('Interdit en production');
  const sellers = await prisma.user.findMany({
    where: {
      role: { in: ['SELLER', 'TELECONSULTANT'] },
      leaderId: { not: null },
      islandId: { not: null },
    },
    include: { leader: { include: { products: { where: { isPublished: true } } } } },
  });
  const sites = await prisma.site.findMany({ where: { isActive: true } });
  const usable = sellers.filter((s) => s.leader && s.leader.products.length);
  if (!usable.length) throw new Error('Aucun vendeur avec catalogue : lance le seed d’abord');
  const today = businessToday();
  const batch = 2_000;
  let created = 0;
  while (created < n) {
    const size = Math.min(batch, n - created);
    const orders = [];
    const items = [];
    for (let i = 0; i < size; i++) {
      const k = created + i;
      const s = usable[k % usable.length]!;
      const p = s.leader!.products[k % s.leader!.products.length]!;
      const site = sites.find((x) => x.islandId === s.islandId) ?? sites[0]!;
      const soldAt = new Date(
        startOfBusinessDay(addDays(today, -(k % 90))).getTime() + ((k * 7919) % 86_000) * 1000,
      );
      const id = `lt${String(k).padStart(10, '0')}`;
      const tci = s.role === 'TELECONSULTANT';
      orders.push({
        id,
        number: `LT-${String(k).padStart(7, '0')}`,
        sellerId: s.id,
        sellerType: tci ? ('TELECONSULTANT' as const) : ('SELLER' as const),
        leaderId: s.leaderId!,
        islandId: s.islandId!,
        siteId: site.id,
        customerName: 'Client test',
        customerPhone: '+2693999999',
        deliveryMode: 'TO_CUSTOMER' as const,
        status: k % 25 === 0 ? ('REFUSED' as const) : ('SOLD' as const),
        note: 'LOAD-TEST',
        soldAt: k % 25 === 0 ? null : soldAt,
        refusedAt: k % 25 === 0 ? soldAt : null,
        createdAt: soldAt,
      });
      items.push({
        orderId: id,
        productId: p.id,
        quantity: 1 + (k % 3),
        unitPrice: p.salePrice,
        sellerShare: tci ? null : Math.round(p.salePrice * 0.6),
        sellerTax: tci ? 0 : 500,
        digecomTax: 500,
        tciBonus: tci ? (p.tciBonus ?? 3000) : null,
        unitCost: Math.round(p.salePrice * 0.06),
      });
    }
    await prisma.order.createMany({ data: orders, skipDuplicates: true });
    await prisma.orderItem.createMany({ data: items });
    created += size;
    process.stdout.write(`\r${created} / ${n} commandes`);
  }
  process.stdout.write('\n');
}

async function measure() {
  const redis = new Redis(process.env.REDIS_URL!);
  const roles = [
    ['Direction', '+2693300001'],
    ['Leader Senior', '+2693300008'],
    ['Leader Junior', '+2693300009'],
    ['Téléconseiller', '+2693300010'],
    ['Logistique', '+2693300007'],
  ] as const;
  const total = await prisma.order.count();
  console.log(`${total} commandes en base`);
  let worst = 0;
  for (const [label, phone] of roles) {
    await redis.del(...(await redis.keys('login:attempts:*')), 'noop');
    const login = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password: PASSWORD }),
    });
    if (!login.ok) throw new Error(`Connexion ${label} : ${login.status}`);
    const { accessToken } = (await login.json()) as { accessToken: string };
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      await redis.incr('dashboard:version'); // cache vidé : calcul complet
      const t = performance.now();
      const res = await fetch(`${API}/dashboard`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`Tableau de bord ${label} : ${res.status}`);
      await res.json();
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    const median = times[2]!;
    worst = Math.max(worst, median);
    console.log(
      `${label.padEnd(16)} médiane ${median.toFixed(0)} ms (min ${times[0]!.toFixed(0)}, max ${times[4]!.toFixed(0)})`,
    );
  }
  await redis.quit();
  console.log(
    worst < BUDGET_MS
      ? `OK : < ${BUDGET_MS} ms`
      : `TROP LENT : ${worst.toFixed(0)} ms ≥ ${BUDGET_MS} ms`,
  );
  return worst < BUDGET_MS;
}

async function cleanup() {
  const ids = { startsWith: 'lt' };
  const items = await prisma.orderItem.deleteMany({
    where: { orderId: ids, order: { note: 'LOAD-TEST' } },
  });
  const orders = await prisma.order.deleteMany({ where: { id: ids, note: 'LOAD-TEST' } });
  console.log(`${orders.count} commandes et ${items.count} lignes supprimées`);
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  if (args.includes('--cleanup')) return cleanup();
  if (!args.includes('--measure'))
    await generate(Number(args.find((a) => /^\d+$/.test(a)) ?? 50_000));
  const ok = await measure();
  if (!ok) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
