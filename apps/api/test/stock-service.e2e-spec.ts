import { lotUnitCost } from '@digecom/shared';
import { PrismaClient } from '@prisma/client';
import { AppException } from '../src/common/app-exception';
import { PrismaService } from '../src/prisma/prisma.service';
import { CounterService } from '../src/stock/counter.service';
import { StockService } from '../src/stock/stock.service';
import { resetDatabase } from './helpers';

/**
 * Tests du StockService contre une vraie base PostgreSQL (verrous de ligne, transactions).
 */
describe('StockService', () => {
  const prisma = new PrismaClient() as PrismaService;
  const stock = new StockService(prisma, new CounterService(prisma));
  let byId: string;
  let siteA: string;
  let siteB: string;
  let n = 0;

  /** Produit vierge (sans stock) pour isoler chaque test. */
  async function freshProduct(): Promise<string> {
    n += 1;
    const leader = await prisma.user.findUniqueOrThrow({ where: { phone: '+2693300008' } });
    const p = await prisma.product.create({
      data: {
        leaderId: leader.id,
        createdById: byId,
        sku: `TEST-${Date.now()}-${n}`,
        name: `Produit test ${n}`,
        salePrice: 12500,
        sellerShareType: 'FIXED',
        sellerShareValue: 7500,
      },
    });
    return p.id;
  }

  const level = (productId: string, siteId: string) =>
    prisma.stockLevel.findUniqueOrThrow({ where: { productId_siteId: { productId, siteId } } });

  const lotsSum = async (productId: string, siteId: string) =>
    (await prisma.lot.aggregate({ where: { productId, siteId }, _sum: { remaining: true } }))._sum
      .remaining ?? 0;

  /** Invariant : somme des lots restants = disponible + réservé. */
  async function expectConsistent(productId: string, siteId: string) {
    const l = await level(productId, siteId);
    expect(await lotsSum(productId, siteId)).toBe(l.available + l.reserved);
  }

  beforeAll(async () => {
    await resetDatabase(prisma);
    byId = (await prisma.user.findUniqueOrThrow({ where: { phone: '+2693300001' } })).id;
    const sites = await prisma.site.findMany({ orderBy: { name: 'asc' } });
    siteA = sites[0]!.id;
    siteB = sites[1]!.id;
    // StockMovement.orderId référence Order (clé étrangère) : commandes minimales pour les tests.
    const seller = await prisma.user.findUniqueOrThrow({ where: { phone: '+2693300011' } });
    const site = sites[0]!;
    const ids = ['CMD-1', 'CMD-2', 'x', 'CMD-FIFO', 'CMD-DIRECT', 'CMD-RET'];
    for (let i = 0; i < 20; i++) ids.push(`CMD-C${i}`);
    await prisma.order.createMany({
      data: ids.map((id) => ({
        id,
        number: `TEST-${id}`,
        sellerId: seller.id,
        sellerType: 'SELLER' as const,
        leaderId: seller.leaderId!,
        islandId: site.islandId,
        siteId: site.id,
        customerName: 'Test stock',
        customerPhone: '+2693999999',
        deliveryMode: 'PICKUP' as const,
      })),
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('coût de lot', () => {
    it('250 + 500 de frais pour 1 unité → 750', () => {
      expect(
        lotUnitCost({ purchaseKmf: 250, shippingKmf: 500, customsKmf: 0, otherFeesKmf: 0 }, 1),
      ).toBe(750);
    });
    it('125 000 + 250 000 pour 500 unités → 750', () => {
      expect(
        lotUnitCost(
          { purchaseKmf: 125000, shippingKmf: 250000, customsKmf: 0, otherFeesKmf: 0 },
          500,
        ),
      ).toBe(750);
    });
    it('arrondi au KMF', () => {
      expect(
        lotUnitCost({ purchaseKmf: 1000, shippingKmf: 0, customsKmf: 0, otherFeesKmf: 0 }, 3),
      ).toBe(333);
    });
  });

  describe('entrée, réservation, libération', () => {
    it('entrée : crée le lot et le mouvement, augmente le disponible', async () => {
      const productId = await freshProduct();
      const { lot } = await stock.entry({
        productId,
        siteId: siteA,
        byId,
        quantity: 10,
        unitCost: 750,
      });
      expect(lot.remaining).toBe(10);
      expect((await level(productId, siteA)).available).toBe(10);
      const m = await prisma.stockMovement.findFirstOrThrow({
        where: { productId, type: 'ENTRY' },
      });
      expect(m).toMatchObject({ quantity: 10, unitCost: 750, byId, lotId: lot.id });
      await expectConsistent(productId, siteA);
    });

    it('réservation puis libération', async () => {
      const productId = await freshProduct();
      await stock.entry({ productId, siteId: siteA, byId, quantity: 5, unitCost: 700 });
      await stock.reserve({ productId, siteId: siteA, byId, quantity: 2, orderId: 'CMD-1' });
      expect(await level(productId, siteA)).toMatchObject({ available: 3, reserved: 2 });
      await stock.release({ productId, siteId: siteA, byId, quantity: 2, orderId: 'CMD-1' });
      expect(await level(productId, siteA)).toMatchObject({ available: 5, reserved: 0 });
      await expectConsistent(productId, siteA);
    });

    it('refuse de rendre le disponible ou le réservé négatif (409)', async () => {
      const productId = await freshProduct();
      await stock.entry({ productId, siteId: siteA, byId, quantity: 1, unitCost: 700 });
      await expect(
        stock.reserve({ productId, siteId: siteA, byId, quantity: 2, orderId: 'CMD-2' }),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
      await expect(
        stock.release({ productId, siteId: siteA, byId, quantity: 1, orderId: 'CMD-2' }),
      ).rejects.toBeInstanceOf(AppException);
      await expect(
        stock.remove({
          productId,
          siteId: siteA,
          byId,
          quantity: 2,
          type: 'LOSS',
          reason: 'Perte',
        }),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
      expect(await level(productId, siteA)).toMatchObject({ available: 1, reserved: 0 });
      // Aucun mouvement orphelin après un refus.
      expect(await prisma.stockMovement.count({ where: { productId } })).toBe(1);
    });

    it('refuse une quantité nulle ou décimale', async () => {
      const productId = await freshProduct();
      await expect(
        stock.entry({ productId, siteId: siteA, byId, quantity: 0, unitCost: 1 }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(
        stock.reserve({ productId, siteId: siteA, byId, quantity: 1.5, orderId: 'x' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });

  describe('sortie FIFO', () => {
    it('lots à 700 (2 u.) et 800 (5 u.), sortie de 3 → 2×700 + 1×800', async () => {
      const productId = await freshProduct();
      await stock.entry({
        productId,
        siteId: siteA,
        byId,
        quantity: 2,
        unitCost: 700,
        receivedAt: new Date('2026-01-01'),
      });
      await stock.entry({
        productId,
        siteId: siteA,
        byId,
        quantity: 5,
        unitCost: 800,
        receivedAt: new Date('2026-02-01'),
      });
      await stock.reserve({ productId, siteId: siteA, byId, quantity: 3, orderId: 'CMD-FIFO' });
      const out = await stock.out({
        productId,
        siteId: siteA,
        byId,
        quantity: 3,
        orderId: 'CMD-FIFO',
      });
      expect(out.totalCost).toBe(2 * 700 + 1 * 800);
      expect(out.unitCost).toBe(Math.round(2200 / 3));
      expect(out.consumed.map((c) => [c.quantity, c.unitCost])).toEqual([
        [2, 700],
        [1, 800],
      ]);
      expect(await level(productId, siteA)).toMatchObject({ available: 4, reserved: 0 });
      const lots = await prisma.lot.findMany({
        where: { productId },
        orderBy: { receivedAt: 'asc' },
      });
      expect(lots.map((l) => l.remaining)).toEqual([0, 4]);
      await expectConsistent(productId, siteA);
    });

    it('sortie directe sur le disponible (sans réservation)', async () => {
      const productId = await freshProduct();
      await stock.entry({ productId, siteId: siteA, byId, quantity: 3, unitCost: 900 });
      const out = await stock.out({
        productId,
        siteId: siteA,
        byId,
        quantity: 1,
        orderId: 'CMD-DIRECT',
        fromReserved: false,
      });
      expect(out.totalCost).toBe(900);
      expect((await level(productId, siteA)).available).toBe(2);
    });

    it('retour en stock : les unités reviennent dans leur lot d’origine', async () => {
      const productId = await freshProduct();
      await stock.entry({
        productId,
        siteId: siteA,
        byId,
        quantity: 1,
        unitCost: 600,
        receivedAt: new Date('2026-01-01'),
      });
      await stock.entry({
        productId,
        siteId: siteA,
        byId,
        quantity: 2,
        unitCost: 900,
        receivedAt: new Date('2026-02-01'),
      });
      await stock.reserve({ productId, siteId: siteA, byId, quantity: 2, orderId: 'CMD-RET' });
      await stock.out({ productId, siteId: siteA, byId, quantity: 2, orderId: 'CMD-RET' });
      const back = await stock.returnToStock({
        productId,
        siteId: siteA,
        byId,
        quantity: 2,
        orderId: 'CMD-RET',
        reason: 'Refusée',
      });
      expect(back.totalCost).toBe(600 + 900);
      expect((await level(productId, siteA)).available).toBe(3);
      await expect(
        stock.returnToStock({ productId, siteId: siteA, byId, quantity: 1, orderId: 'CMD-RET' }),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
      await expectConsistent(productId, siteA);
    });
  });

  describe('casse, perte, ajustement, transfert, inventaire', () => {
    it('casse et perte : FIFO sur le disponible, motif tracé', async () => {
      const productId = await freshProduct();
      await stock.entry({ productId, siteId: siteA, byId, quantity: 4, unitCost: 500 });
      await stock.remove({
        productId,
        siteId: siteA,
        byId,
        quantity: 1,
        type: 'DAMAGED',
        reason: 'Écran cassé',
      });
      await stock.remove({
        productId,
        siteId: siteA,
        byId,
        quantity: 1,
        type: 'LOSS',
        reason: 'Introuvable',
      });
      expect((await level(productId, siteA)).available).toBe(2);
      const reasons = (
        await prisma.stockMovement.findMany({
          where: { productId, type: { in: ['DAMAGED', 'LOSS'] } },
        })
      ).map((m) => m.reason);
      expect(reasons.sort()).toEqual(['Introuvable', 'Écran cassé']);
      await expectConsistent(productId, siteA);
    });

    it('ajustement positif au coût moyen, négatif en FIFO', async () => {
      const productId = await freshProduct();
      await stock.entry({ productId, siteId: siteA, byId, quantity: 1, unitCost: 600 });
      await stock.entry({ productId, siteId: siteA, byId, quantity: 1, unitCost: 1000 });
      await stock.adjust({ productId, siteId: siteA, byId, delta: 2, reason: 'Recomptage' });
      const adj = await prisma.lot.findFirstOrThrow({
        where: { productId, number: { startsWith: 'ADJ-' } },
      });
      expect(adj.unitCost).toBe(800);
      await stock.adjust({ productId, siteId: siteA, byId, delta: -3, reason: 'Erreur de saisie' });
      expect((await level(productId, siteA)).available).toBe(1);
      await expectConsistent(productId, siteA);
    });

    it('premier stock sans coût connu → 422 (jamais de lot à coût nul)', async () => {
      const productId = await freshProduct();
      await expect(
        stock.adjust({ productId, siteId: siteA, byId, delta: 2, reason: 'Arrivage' }),
      ).rejects.toMatchObject({ code: 'UNIT_COST_REQUIRED' });
      await stock.adjust({
        productId,
        siteId: siteA,
        byId,
        delta: 2,
        reason: 'Arrivage',
        unitCost: 1200,
      });
      expect((await level(productId, siteA)).available).toBe(2);
    });

    it('transfert : deux mouvements liés, coût conservé à l’arrivée', async () => {
      const productId = await freshProduct();
      await stock.entry({ productId, siteId: siteA, byId, quantity: 5, unitCost: 750 });
      const { transferId } = await stock.transfer({
        productId,
        fromSiteId: siteA,
        toSiteId: siteB,
        quantity: 3,
        reason: 'Réassort',
        byId,
      });
      const linked = await prisma.stockMovement.findMany({ where: { transferId } });
      expect(linked.map((m) => [m.type, m.quantity, m.unitCost]).sort()).toEqual([
        ['TRANSFER_IN', 3, 750],
        ['TRANSFER_OUT', 3, 750],
      ]);
      expect((await level(productId, siteA)).available).toBe(2);
      expect((await level(productId, siteB)).available).toBe(3);
      await expectConsistent(productId, siteA);
      await expectConsistent(productId, siteB);
      await expect(
        stock.transfer({
          productId,
          fromSiteId: siteA,
          toSiteId: siteB,
          quantity: 9,
          reason: 'Trop',
          byId,
        }),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    });

    it('écarts d’inventaire positifs et négatifs', async () => {
      const productId = await freshProduct();
      await stock.entry({ productId, siteId: siteA, byId, quantity: 5, unitCost: 700 });
      await stock.inventoryDiff({
        productId,
        siteId: siteA,
        byId,
        difference: 2,
        inventoryId: 'INV-1',
      });
      expect((await level(productId, siteA)).available).toBe(7);
      await stock.inventoryDiff({
        productId,
        siteId: siteA,
        byId,
        difference: -4,
        inventoryId: 'INV-1',
      });
      expect((await level(productId, siteA)).available).toBe(3);
      expect(
        await prisma.stockMovement.count({ where: { productId, type: 'INVENTORY_DIFF' } }),
      ).toBe(2);
      await expectConsistent(productId, siteA);
    });

    it('les mouvements sont append-only en base', async () => {
      const m = await prisma.stockMovement.findFirstOrThrow();
      await expect(
        prisma.stockMovement.update({ where: { id: m.id }, data: { quantity: 99 } }),
      ).rejects.toThrow(/append-only/);
      await expect(prisma.stockMovement.delete({ where: { id: m.id } })).rejects.toThrow(
        /append-only/,
      );
    });
  });

  describe('concurrence', () => {
    it('20 réservations simultanées sur un stock de 3 → exactement 3 réussissent', async () => {
      const productId = await freshProduct();
      await stock.entry({ productId, siteId: siteA, byId, quantity: 3, unitCost: 750 });
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, (_, i) =>
          stock.reserve({ productId, siteId: siteA, byId, quantity: 1, orderId: `CMD-C${i}` }),
        ),
      );
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const refused = results.filter(
        (r) => r.status === 'rejected' && (r.reason as AppException).code === 'INSUFFICIENT_STOCK',
      ).length;
      expect(ok).toBe(3);
      expect(refused).toBe(17);
      expect(await level(productId, siteA)).toMatchObject({ available: 0, reserved: 3 });
      expect(await prisma.stockMovement.count({ where: { productId, type: 'RESERVE' } })).toBe(3);
    });

    it('sorties et transferts concurrents ne créent jamais de stock négatif', async () => {
      const productId = await freshProduct();
      await stock.entry({ productId, siteId: siteA, byId, quantity: 10, unitCost: 500 });
      const ops = Array.from({ length: 15 }, (_, i) =>
        i % 2
          ? stock.remove({
              productId,
              siteId: siteA,
              byId,
              quantity: 1,
              type: 'LOSS',
              reason: `Perte ${i}`,
            })
          : stock.transfer({
              productId,
              fromSiteId: siteA,
              toSiteId: siteB,
              quantity: 1,
              reason: `T${i}`,
              byId,
            }),
      );
      const results = await Promise.allSettled(ops);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
      expect((await level(productId, siteA)).available).toBe(0);
      await expectConsistent(productId, siteA);
      await expectConsistent(productId, siteB);
    });
  });
});
