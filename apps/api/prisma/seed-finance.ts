/**
 * Démonstration financière (phase 4) : 10 ventes de Fatima Said (écouteurs à 12 500, part 7 500,
 * taxes 500 + 500) au cours du dernier cycle de règlement terminé, ses 2 abonnements de la
 * période et la génération des relevés → relevé de 50 000 KMF « à vérifier ».
 * Passe par StockService, LedgerService et SettlementService (mêmes règles que l'application).
 */
import { addDays, businessToday, startOfBusinessDay, weekStart } from '@digecom/shared';
import type { PrismaClient } from '@prisma/client';
import { LedgerService } from '../src/finance/ledger.service';
import { SettlementService } from '../src/finance/settlement.service';
import type { CashService } from '../src/finance/cash.service';
import type { NotificationService } from '../src/notifications/notification.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/settings/settings.service';
import { CounterService } from '../src/stock/counter.service';
import { StockService } from '../src/stock/stock.service';

export const DEMO_SALES = 10;
const DEMO_NOTE = 'Démo finance (seed)';

export async function seedFinance(prisma: PrismaClient, adminId: string): Promise<string> {
  const db = prisma as unknown as PrismaService;
  const fatima = await prisma.user.findUnique({ where: { phone: '+2693300011' } });
  if (!fatima) return 'démo finance ignorée';
  if (await prisma.order.findFirst({ where: { sellerId: fatima.id, note: DEMO_NOTE } }))
    return 'démo finance déjà présente';

  const product = await prisma.product.findFirstOrThrow({
    where: { name: 'Écouteurs sans fil', leaderId: fatima.leaderId! },
  });
  const site = await prisma.site.findUniqueOrThrow({
    where: { name: 'Moroni – Entrepôt central' },
  });
  const counters = new CounterService(db);
  const stock = new StockService(db, counters);
  const ledger = new LedgerService(db);
  const settings = new SettingsService(db);
  const silent = {
    send: async () => undefined,
    usersWithRoles: async () => [],
  } as unknown as NotificationService;
  const settlements = new SettlementService(db, settings, counters, {} as CashService, silent);

  // Base existante dont le stock de reprise est déjà ajusté : on complète au coût du lot (750).
  const level = await prisma.stockLevel.findUnique({
    where: { productId_siteId: { productId: product.id, siteId: site.id } },
  });
  const missing = DEMO_SALES - (level?.available ?? 0);
  if (missing > 0) {
    await stock.entry({
      productId: product.id,
      siteId: site.id,
      byId: adminId,
      quantity: missing,
      unitCost: 750,
      reason: 'Reprise de données : ventes de démonstration',
    });
  }

  const cycle = await settlements.lastClosedCycle(businessToday());
  for (let i = 0; i < DEMO_SALES; i++) {
    const day = addDays(cycle.start, 1 + (i % 12));
    const soldAt = new Date(startOfBusinessDay(day).getTime() + 10 * 3_600_000 + i * 60_000);
    await prisma.$transaction(
      async (tx) => {
        const order = await tx.order.create({
          data: {
            number: await counters.formatted('ORDER', 'CMD-', 6, tx),
            sellerId: fatima.id,
            sellerType: 'SELLER',
            leaderId: fatima.leaderId!,
            islandId: fatima.islandId!,
            siteId: site.id,
            customerName: `Client démo ${i + 1}`,
            customerPhone: `+26933210${String(i).padStart(2, '0')}`,
            deliveryMode: 'PICKUP',
            status: 'SOLD',
            note: DEMO_NOTE,
            createdAt: new Date(soldAt.getTime() - 3_600_000),
            confirmedAt: soldAt,
            preparingAt: soldAt,
            readyAt: soldAt,
            handedOverAt: soldAt,
            soldAt,
            items: {
              create: {
                productId: product.id,
                quantity: 1,
                unitPrice: 12500,
                sellerShare: 7500,
                sellerTax: 500,
                digecomTax: 500,
              },
            },
            events: {
              create: [
                { toStatus: 'NEW', action: 'create', byId: adminId, at: soldAt },
                {
                  fromStatus: 'HANDED_OVER',
                  toStatus: 'SOLD',
                  action: 'markSold',
                  byId: adminId,
                  note: DEMO_NOTE,
                  at: soldAt,
                },
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
        await ledger.recordSale(tx, order.id, adminId, soldAt);
      },
      { timeout: 30_000 },
    );
  }

  // Deux abonnements hebdomadaires de la période (lundis du cycle).
  const amount = await settings.get('subscription.weekly');
  await prisma.ledgerEntry.createMany({
    data: [0, 7].map((d) => ({
      type: 'SUBSCRIPTION' as const,
      amount,
      beneficiaryId: fatima.id,
      islandId: fatima.islandId!,
      leaderId: fatima.leaderId,
      periodDate: startOfBusinessDay(weekStart(addDays(cycle.start, d))),
    })),
    skipDuplicates: true,
  });

  const result = await settlements.generateForCycle(cycle.start, cycle.end);
  return `${DEMO_SALES} ventes de démonstration, ${result.created} relevé(s) du ${cycle.start}`;
}
