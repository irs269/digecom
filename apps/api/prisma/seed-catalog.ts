/**
 * Catalogues, fournisseurs et lots du prototype (phase 2). Idempotent : un produit déjà présent
 * (même leader, même nom) n'est ni modifié ni réapprovisionné.
 * Le stock passe exclusivement par StockService (règle : aucun autre chemin ne modifie StockLevel).
 */
import { Prisma, type PrismaClient, type PurchaseOrderStatus } from '@prisma/client';
import { lotUnitCost } from '@digecom/shared';
import type { PrismaService } from '../src/prisma/prisma.service';
import { CounterService } from '../src/stock/counter.service';
import { StockService } from '../src/stock/stock.service';

interface SeedProduct {
  leaderPhone: string;
  site: string;
  name: string;
  quality: string;
  category: string;
  salePrice: number;
  /** Leader Senior : part e-commerçant fixe (KMF). Leader Junior : prime TCI. */
  share: number;
  stock: number;
  unitCost: number;
  isPublished: boolean;
  /** Lot d'origine (commande fournisseur réceptionnée), sinon entrée de reprise. */
  lot?: string;
}

const MORONI = 'Moroni – Entrepôt central';
const MUTSAMUDU = 'Mutsamudu – Boutique';
const FOMBONI = 'Fomboni – Boutique';

export const SEED_PRODUCTS: SeedProduct[] = [
  {
    leaderPhone: '+2693300008',
    site: MORONI,
    name: 'Écouteurs sans fil',
    quality: 'Standard',
    category: 'Audio',
    salePrice: 12500,
    share: 7500,
    stock: 3,
    unitCost: 750,
    isPublished: true,
    lot: 'LOT-014',
  },
  {
    leaderPhone: '+2693300008',
    site: MORONI,
    name: 'Sac à main',
    quality: 'Cuir synthétique',
    category: 'Mode',
    salePrice: 14000,
    share: 8400,
    stock: 12,
    unitCost: 2800,
    isPublished: true,
  },
  {
    leaderPhone: '+2693300008',
    site: MORONI,
    name: 'Ventilateur rechargeable',
    quality: 'Standard',
    category: 'Maison',
    salePrice: 15000,
    share: 9000,
    stock: 0,
    unitCost: 1800,
    isPublished: true,
  },
  {
    leaderPhone: '+2693300013',
    site: MUTSAMUDU,
    name: 'Écouteurs sans fil',
    quality: 'Premium',
    category: 'Audio',
    salePrice: 15000,
    share: 9000,
    stock: 5,
    unitCost: 900,
    isPublished: true,
  },
  {
    leaderPhone: '+2693300013',
    site: MUTSAMUDU,
    name: 'Montre connectée',
    quality: 'Standard',
    category: 'Montres',
    salePrice: 18000,
    share: 10800,
    stock: 9,
    unitCost: 2100,
    isPublished: true,
  },
  {
    leaderPhone: '+2693300014',
    site: FOMBONI,
    name: 'Lampe solaire',
    quality: 'Standard',
    category: 'Maison',
    salePrice: 9500,
    share: 5700,
    stock: 14,
    unitCost: 900,
    isPublished: true,
  },
  {
    leaderPhone: '+2693300014',
    site: FOMBONI,
    name: 'Écouteurs sans fil',
    quality: 'Standard',
    category: 'Audio',
    salePrice: 12500,
    share: 7500,
    stock: 2,
    unitCost: 750,
    isPublished: false,
  },
  {
    leaderPhone: '+2693300009',
    site: MORONI,
    name: 'Montre connectée Sport',
    quality: 'Sport',
    category: 'Montres',
    salePrice: 17000,
    share: 3000,
    stock: 18,
    unitCost: 3200,
    isPublished: true,
  },
  {
    leaderPhone: '+2693300009',
    site: MORONI,
    name: 'Blender portable',
    quality: 'Standard',
    category: 'Maison',
    salePrice: 13500,
    share: 2500,
    stock: 6,
    unitCost: 2600,
    isPublished: true,
  },
  {
    leaderPhone: '+2693300015',
    site: MUTSAMUDU,
    name: 'Lisseur à cheveux',
    quality: 'Standard',
    category: 'Beauté',
    salePrice: 11000,
    share: 2000,
    stock: 10,
    unitCost: 2200,
    isPublished: true,
  },
];

const SUPPLIERS = [
  { name: 'Shenzhen Audio Co.', platform: 'Alibaba', contact: 'sales@shenzhen-audio.example' },
  { name: 'Guangzhou Smart Watch', platform: 'Alibaba', contact: 'export@gz-smartwatch.example' },
  { name: 'Yiwu Solar Light', platform: 'Alibaba', contact: 'contact@yiwu-solar.example' },
  { name: 'Ningbo Home Fan', platform: 'Alibaba', contact: 'trade@ningbo-fan.example' },
];

/** Lots LOT-014 à LOT-017 (prototype, onglet Achats Chine). Montants en KMF, taux 1. */
const SEED_LOTS: {
  number: string;
  supplier: string;
  product: { leaderPhone: string; name: string };
  site: string;
  quantity: number;
  purchase: number;
  shipping: number;
  customs: number;
  status: PurchaseOrderStatus;
}[] = [
  {
    number: 'LOT-014',
    supplier: 'Shenzhen Audio Co.',
    product: { leaderPhone: '+2693300008', name: 'Écouteurs sans fil' },
    site: MORONI,
    quantity: 500,
    purchase: 125000,
    shipping: 250000,
    customs: 0,
    status: 'CLOSED',
  },
  {
    number: 'LOT-015',
    supplier: 'Guangzhou Smart Watch',
    product: { leaderPhone: '+2693300013', name: 'Montre connectée' },
    site: MUTSAMUDU,
    quantity: 200,
    purchase: 240000,
    shipping: 150000,
    customs: 30000,
    status: 'IN_CUSTOMS',
  },
  {
    number: 'LOT-016',
    supplier: 'Yiwu Solar Light',
    product: { leaderPhone: '+2693300014', name: 'Lampe solaire' },
    site: FOMBONI,
    quantity: 300,
    purchase: 120000,
    shipping: 120000,
    customs: 30000,
    status: 'IN_TRANSIT',
  },
  {
    number: 'LOT-017',
    supplier: 'Ningbo Home Fan',
    product: { leaderPhone: '+2693300008', name: 'Ventilateur rechargeable' },
    site: MORONI,
    quantity: 150,
    purchase: 180000,
    shipping: 75000,
    customs: 15000,
    status: 'ORDERED',
  },
];

const STATUS_ORDER: PurchaseOrderStatus[] = [
  'DRAFT',
  'ORDERED',
  'IN_TRANSIT',
  'ARRIVED',
  'IN_CUSTOMS',
  'RECEIVED',
  'CLOSED',
];
const DATE_FIELDS: Partial<Record<PurchaseOrderStatus, string>> = {
  ORDERED: 'orderedAt',
  IN_TRANSIT: 'inTransitAt',
  ARRIVED: 'arrivedAt',
  IN_CUSTOMS: 'inCustomsAt',
  RECEIVED: 'receivedAt',
  CLOSED: 'closedAt',
};

export async function seedCatalog(prisma: PrismaClient, adminId: string): Promise<string> {
  const db = prisma as unknown as PrismaService;
  const counters = new CounterService(db);
  const stock = new StockService(db, counters);

  for (const s of SUPPLIERS) {
    await prisma.supplier.upsert({ where: { name: s.name }, update: {}, create: s });
  }

  const sites = new Map((await prisma.site.findMany()).map((s) => [s.name, s.id]));
  const leaders = new Map(
    (
      await prisma.user.findMany({ where: { role: { in: ['LEADER_SENIOR', 'LEADER_JUNIOR'] } } })
    ).map((u) => [u.phone, u]),
  );

  let created = 0;
  const productIds = new Map<string, string>();
  for (const p of SEED_PRODUCTS) {
    const leader = leaders.get(p.leaderPhone);
    if (!leader) continue;
    const existing = await prisma.product.findFirst({
      where: { leaderId: leader.id, name: p.name },
    });
    productIds.set(`${p.leaderPhone}|${p.name}`, existing?.id ?? '');
    if (existing) continue;

    const junior = leader.role === 'LEADER_JUNIOR';
    const product = await prisma.product.create({
      data: {
        leaderId: leader.id,
        sku: await counters.formatted('PRODUCT', 'PRD-', 6),
        name: p.name,
        quality: p.quality,
        category: p.category,
        salePrice: p.salePrice,
        sellerShareType: junior ? null : 'FIXED',
        sellerShareValue: junior ? null : p.share,
        tciBonus: junior ? p.share : null,
        isPublished: p.isPublished,
        createdById: adminId,
      },
    });
    productIds.set(`${p.leaderPhone}|${p.name}`, product.id);
    created += 1;

    if (p.stock > 0 && !p.lot) {
      await stock.entry({
        productId: product.id,
        siteId: sites.get(p.site)!,
        byId: adminId,
        quantity: p.stock,
        unitCost: p.unitCost,
        reason: 'Reprise du stock existant',
      });
    }
  }

  let lots = 0;
  for (const l of SEED_LOTS) {
    if (await prisma.purchaseOrder.findUnique({ where: { number: l.number } })) continue;
    const productId = productIds.get(`${l.product.leaderPhone}|${l.product.name}`);
    if (!productId) continue;
    const supplier = await prisma.supplier.findUniqueOrThrow({ where: { name: l.supplier } });
    const siteId = sites.get(l.site)!;
    const reached = STATUS_ORDER.indexOf(l.status);
    const dates = Object.fromEntries(
      STATUS_ORDER.slice(1, reached + 1).map((s, i) => [
        DATE_FIELDS[s]!,
        new Date(Date.UTC(2026, 9, 1 + i * 5)),
      ]),
    );
    const received = reached >= STATUS_ORDER.indexOf('RECEIVED');
    const po = await prisma.purchaseOrder.create({
      data: {
        number: l.number,
        supplierId: supplier.id,
        productId,
        destinationSiteId: siteId,
        quantity: l.quantity,
        currency: 'KMF',
        exchangeRate: new Prisma.Decimal(1),
        purchaseAmountForeign: new Prisma.Decimal(l.purchase),
        purchaseAmountKmf: l.purchase,
        shippingKmf: l.shipping,
        customsKmf: l.customs,
        status: l.status,
        receivedQuantity: received ? l.quantity : null,
        paidAmountKmf: received ? l.purchase : null,
        paidAt: received ? dates.orderedAt : null,
        createdById: adminId,
        ...dates,
      },
    });
    lots += 1;
    if (received) {
      const unitCost = lotUnitCost(
        {
          purchaseKmf: l.purchase,
          shippingKmf: l.shipping,
          customsKmf: l.customs,
          otherFeesKmf: 0,
        },
        l.quantity,
      );
      await stock.entry({
        productId,
        siteId,
        byId: adminId,
        quantity: l.quantity,
        unitCost,
        lotNumber: l.number,
        purchaseOrderId: po.id,
        receivedAt: dates.receivedAt as Date,
        reason: `Réception ${l.number}`,
      });
      // Les ventes de ce lot ont eu lieu avant la plateforme : stock restant du prototype.
      const target = SEED_PRODUCTS.find(
        (p) => p.leaderPhone === l.product.leaderPhone && p.name === l.product.name,
      )!.stock;
      if (l.quantity > target) {
        await stock.adjust({
          productId,
          siteId,
          byId: adminId,
          delta: target - l.quantity,
          reason: 'Reprise de données : ventes antérieures à la plateforme',
        });
      }
    }
  }
  await counters.ensureAtLeast('LOT', 17);
  return `${created} produits, ${lots} lots`;
}
