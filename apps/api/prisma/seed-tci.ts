/**
 * Leaders Junior et téléconseillers (phase 5) : campagnes CP-06 / CP-07, prospects du prototype,
 * commandes TCI datées par rapport à la semaine en cours et historique des primes.
 * Anlia Hassani : semaine en cours 47 500 vendus / 8 500 de gains / 68 000 globaux ; une vente
 * livrée à clôturer (+3 000). Passe par StockService et LedgerService.
 */
import { addDays, businessToday, startOfBusinessDay, weekStart } from '@digecom/shared';
import type { OrderStatus, PrismaClient } from '@prisma/client';
import { LedgerService } from '../src/finance/ledger.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { CounterService } from '../src/stock/counter.service';
import { StockService } from '../src/stock/stock.service';

const H = 3_600_000;
const NOTE = 'Démo TCI (seed)';

interface DemoSale {
  tci: string;
  product: 'montre' | 'blender' | 'lisseur';
  customer: string;
  phone: string;
  status: OrderStatus;
  /** Semaine relative (0 = en cours, −1 = précédente…) et décalage en heures depuis le lundi. */
  week: number;
  hours: number;
  campaign?: 'CP-07' | 'CP-06';
  failReason?: string;
}

const ANLIA = '+2693300010';
const FAIZA = '+2693300021';
const BACAR = '+2693300022';

/** Commandes TCI du prototype (montants et primes identiques). */
const PROTOTYPE: DemoSale[] = [
  {
    tci: ANLIA,
    product: 'montre',
    customer: 'Hamidou Said',
    phone: '+2693450377',
    status: 'OUT_FOR_DELIVERY',
    week: 0,
    hours: 65,
    campaign: 'CP-07',
  },
  {
    tci: ANLIA,
    product: 'montre',
    customer: 'Moina Ali',
    phone: '+2693327041',
    status: 'SOLD',
    week: 0,
    hours: 88,
    campaign: 'CP-07',
  },
  {
    tci: ANLIA,
    product: 'blender',
    customer: 'Saïd Youssouf',
    phone: '+2693431892',
    status: 'SOLD',
    week: 0,
    hours: 83,
    campaign: 'CP-06',
  },
  {
    tci: ANLIA,
    product: 'montre',
    customer: 'Fatouma Hamada',
    phone: '+2693365207',
    status: 'HANDED_OVER',
    week: 0,
    hours: 63,
    campaign: 'CP-07',
  },
  {
    tci: ANLIA,
    product: 'montre',
    customer: 'Ali Saïd',
    phone: '+2693314785',
    status: 'SOLD',
    week: 0,
    hours: 58,
    campaign: 'CP-07',
  },
  {
    tci: ANLIA,
    product: 'blender',
    customer: 'Naïma Ahmed',
    phone: '+2693476630',
    status: 'RETURN_IN_PROGRESS',
    week: 0,
    hours: 57,
    campaign: 'CP-06',
    failReason: 'Refusée par le client',
  },
  {
    tci: ANLIA,
    product: 'montre',
    customer: 'Daoud Ali',
    phone: '+2693348012',
    status: 'SOLD',
    week: -1,
    hours: 113,
    campaign: 'CP-07',
  },
  {
    tci: ANLIA,
    product: 'blender',
    customer: 'Hadidja Said',
    phone: '+2693423759',
    status: 'SOLD',
    week: -1,
    hours: 84,
    campaign: 'CP-06',
  },
  {
    tci: FAIZA,
    product: 'blender',
    customer: 'Mze Abdou',
    phone: '+2693402561',
    status: 'SOLD',
    week: 0,
    hours: 38,
    campaign: 'CP-06',
  },
  {
    tci: BACAR,
    product: 'lisseur',
    customer: 'Amina Djae',
    phone: '+2693391148',
    status: 'SOLD',
    week: 0,
    hours: 58,
  },
];

/** Historique antérieur : Anlia 18 × 3 000 = 54 000 ; Faïza 10 × 2 500 + 2 × 3 000 = 31 000 ; Bacar 9 × 2 000 = 18 000. */
function history(): DemoSale[] {
  const list: DemoSale[] = [];
  const add = (tci: string, product: DemoSale['product'], n: number) => {
    for (let i = 0; i < n; i++) {
      list.push({
        tci,
        product,
        customer: `Client historique ${list.length + 1}`,
        phone: `+26934${String(10000 + list.length).slice(-5)}`,
        status: 'SOLD',
        week: -3 - (i % 6),
        hours: 10 + (i % 5) * 20,
      });
    }
  };
  add(ANLIA, 'montre', 18);
  add(FAIZA, 'blender', 10);
  add(FAIZA, 'montre', 2);
  add(BACAR, 'lisseur', 9);
  return list;
}

const PROSPECTS = [
  {
    name: 'Mariam Abdou',
    phone: '+2693312045',
    campaign: 'CP-07',
    status: 'TO_CALL' as const,
    tci: ANLIA,
  },
  {
    name: 'Youssouf Mmadi',
    phone: '+2693428810',
    campaign: 'CP-07',
    status: 'TO_CALL' as const,
    tci: ANLIA,
  },
  {
    name: 'Zalifa Ahmed',
    phone: '+2693376192',
    campaign: 'CP-07',
    status: 'UNREACHABLE' as const,
    tci: ANLIA,
  },
  {
    name: 'Hamidou Said',
    phone: '+2693450377',
    campaign: 'CP-06',
    status: 'CONFIRMED' as const,
    tci: ANLIA,
  },
  {
    name: 'Echati Ali',
    phone: '+2693482966',
    campaign: 'CP-07',
    status: 'NOT_INTERESTED' as const,
    tci: ANLIA,
  },
  {
    name: 'Mohamed Bacar',
    phone: '+2693356412',
    campaign: 'CP-07',
    status: 'TO_CALL' as const,
    tci: null,
  },
];

export async function seedTci(prisma: PrismaClient, adminId: string): Promise<string> {
  const db = prisma as unknown as PrismaService;
  if (await prisma.campaign.findUnique({ where: { number: 'CP-07' } }))
    return 'démo TCI déjà présente';
  const rachad = await prisma.user.findUnique({ where: { phone: '+2693300009' } });
  const kamaria = await prisma.user.findUnique({ where: { phone: '+2693300015' } });
  if (!rachad || !kamaria) return 'démo TCI ignorée';

  const counters = new CounterService(db);
  const stock = new StockService(db, counters);
  const ledger = new LedgerService(db);
  const products = {
    montre: await prisma.product.findFirstOrThrow({
      where: { leaderId: rachad.id, name: 'Montre connectée Sport' },
    }),
    blender: await prisma.product.findFirstOrThrow({
      where: { leaderId: rachad.id, name: 'Blender portable' },
    }),
    lisseur: await prisma.product.findFirstOrThrow({
      where: { leaderId: kamaria.id, name: 'Lisseur à cheveux' },
    }),
  };
  const sites = {
    GC: await prisma.site.findUniqueOrThrow({ where: { name: 'Moroni – Entrepôt central' } }),
    AN: await prisma.site.findUniqueOrThrow({ where: { name: 'Mutsamudu – Boutique' } }),
  };
  const courier = await prisma.user.findUniqueOrThrow({ where: { phone: '+2693300023' } });
  const courierAn = await prisma.user.findUniqueOrThrow({ where: { phone: '+2693300012' } });

  const today = businessToday();
  const monday = weekStart(today);
  const now = Date.now();

  // Campagnes du prototype.
  const campaigns: Record<string, string> = {};
  for (const c of [
    {
      number: 'CP-06',
      name: 'Blender – Octobre',
      product: products.blender,
      channel: 'TIKTOK' as const,
      budget: 40000,
      start: addDays(monday, -14),
      end: addDays(monday, -3),
    },
    {
      number: 'CP-07',
      name: 'Montre Sport – Novembre',
      product: products.montre,
      channel: 'FACEBOOK' as const,
      budget: 75000,
      start: addDays(monday, -1),
      end: addDays(monday, 13),
    },
  ]) {
    const expense = await prisma.expense.create({
      data: {
        category: 'ADVERTISING',
        label: `Campagne ${c.number} – ${c.name}`,
        amount: c.budget,
        islandId: rachad.islandId!,
        periodDate: startOfBusinessDay(c.start),
        leaderId: rachad.id,
        createdById: rachad.id,
      },
    });
    const row = await prisma.campaign.create({
      data: {
        number: c.number,
        leaderId: rachad.id,
        productId: c.product.id,
        name: c.name,
        channel: c.channel,
        budget: c.budget,
        startDate: startOfBusinessDay(c.start),
        endDate: startOfBusinessDay(c.end),
        status: c.end < today ? 'ENDED' : 'ACTIVE',
        expenseId: expense.id,
        createdById: rachad.id,
      },
    });
    await prisma.expense.update({ where: { id: expense.id }, data: { campaignId: row.id } });
    campaigns[c.number] = row.id;
  }
  await counters.ensureAtLeast('CAMPAIGN', 7);

  // Stock de reprise pour les ventes de démonstration (le stock affiché reste celui du prototype).
  const sales = [...history(), ...PROTOTYPE];
  for (const [key, product] of Object.entries(products)) {
    const n = sales.filter((s) => s.product === key).length;
    const site = key === 'lisseur' ? sites.AN : sites.GC;
    await stock.entry({
      productId: product.id,
      siteId: site.id,
      byId: adminId,
      quantity: n,
      unitCost:
        (
          await prisma.lot.findFirst({
            where: { productId: product.id },
            orderBy: { receivedAt: 'asc' },
          })
        )?.unitCost ?? 2500,
      reason: 'Reprise de données : ventes TCI de démonstration',
    });
  }

  const orderOfCustomer = new Map<string, string>();
  for (const s of sales) {
    const tci = await prisma.user.findUniqueOrThrow({ where: { phone: s.tci } });
    const product = products[s.product];
    const site = s.product === 'lisseur' ? sites.AN : sites.GC;
    const at = new Date(
      Math.min(
        startOfBusinessDay(addDays(monday, s.week * 7)).getTime() + s.hours * H,
        now - 60_000,
      ),
    );
    const delivered = ['HANDED_OVER', 'SOLD', 'RETURN_IN_PROGRESS'].includes(s.status);
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          number: await counters.formatted('ORDER', 'CMD-', 6, tx),
          sellerId: tci.id,
          sellerType: 'TELECONSULTANT',
          leaderId: product.leaderId,
          campaignId: s.campaign ? campaigns[s.campaign] : null,
          islandId: site.islandId,
          siteId: site.id,
          customerName: s.customer,
          customerPhone: s.phone,
          zone: 'Moroni',
          deliveryMode: 'TO_CUSTOMER',
          status: s.status,
          courierId: s.product === 'lisseur' ? courierAn.id : courier.id,
          note: NOTE,
          createdAt: new Date(at.getTime() - 4 * H),
          confirmedAt: new Date(at.getTime() - 3 * H),
          readyAt: new Date(at.getTime() - 2 * H),
          assignedAt: new Date(at.getTime() - 2 * H),
          outForDeliveryAt: new Date(at.getTime() - H),
          handedOverAt: delivered ? at : null,
          soldAt: s.status === 'SOLD' ? at : null,
          refusedAt: s.failReason ? at : null,
          returnStartedAt: s.failReason ? at : null,
          refuseReason: s.failReason ?? null,
          amountCollected: s.status === 'SOLD' ? product.salePrice : null,
          remittedAt: s.status === 'SOLD' ? at : null,
          courierFee: delivered ? 1000 : null,
          items: {
            create: {
              productId: product.id,
              quantity: 1,
              unitPrice: product.salePrice,
              sellerTax: 0,
              digecomTax: 500,
              tciBonus: product.tciBonus,
            },
          },
          events: {
            create: [
              {
                toStatus: 'NEW',
                action: 'create',
                byId: tci.id,
                role: 'TELECONSULTANT',
                at: new Date(at.getTime() - 4 * H),
              },
              { toStatus: s.status, action: 'seed', byId: adminId, note: NOTE, at },
            ],
          },
        },
        include: { items: true },
      });
      const ref = {
        productId: product.id,
        siteId: site.id,
        byId: adminId,
        quantity: 1,
        orderId: order.id,
      };
      await stock.reserve(ref, tx);
      const out = await stock.out(ref, tx);
      await tx.orderItem.update({
        where: { id: order.items[0]!.id },
        data: { unitCost: out.unitCost },
      });
      if (s.status === 'SOLD') await ledger.recordSale(tx, order.id, adminId, at);
      orderOfCustomer.set(s.customer, order.id);
    });
  }

  for (const p of PROSPECTS) {
    const tci = p.tci ? await prisma.user.findUniqueOrThrow({ where: { phone: p.tci } }) : null;
    await prisma.prospect.create({
      data: {
        campaignId: campaigns[p.campaign]!,
        fullName: p.name,
        phone: p.phone,
        status: p.status,
        assignedTciId: tci?.id,
        attempts: p.status === 'TO_CALL' ? 0 : 1,
        lastCallAt: p.status === 'TO_CALL' ? null : new Date(now - 2 * H),
        orderId: p.status === 'CONFIRMED' ? orderOfCustomer.get(p.name) : null,
      },
    });
  }
  return `${sales.length} ventes TCI de démonstration, 2 campagnes, ${PROSPECTS.length} prospects`;
}
