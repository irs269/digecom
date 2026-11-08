/**
 * Réseau commercial (phase 6) : quantités attribuées par Ali Mohamed à ses e-commerçants et
 * objectifs hebdomadaires des équipes. Idempotent : rien n'est ajouté si des attributions existent.
 */
import type { PrismaClient } from '@prisma/client';

const ALI = '+2693300008';
/** Quantités du prototype (Fatima 10, Mouhidine 7, Hassane 5, Nadia 4) + 5 de marge chacun. */
const QUOTAS: Record<string, number> = {
  'Fatima Said': 15,
  'Mouhidine Youssouf': 12,
  'Hassane Daoud': 10,
  'Nadia Mze': 9,
};

export async function seedNetwork(prisma: PrismaClient, adminId: string): Promise<string> {
  const ali = await prisma.user.findUnique({ where: { phone: ALI } });
  if (!ali) return 'réseau ignoré';
  const targets = [
    { phone: ALI, weeklyRevenue: 150_000 },
    { phone: '+2693300009', weeklyRevenue: 250_000 },
  ];
  for (const t of targets) {
    const leader = await prisma.user.findUnique({ where: { phone: t.phone } });
    if (!leader) continue;
    await prisma.salesTarget.upsert({
      where: { leaderId: leader.id },
      update: {},
      create: { leaderId: leader.id, weeklyRevenue: t.weeklyRevenue },
    });
  }
  if (await prisma.sellerAllocation.count({ where: { leaderId: ali.id } }))
    return 'réseau déjà présent';
  const product = await prisma.product.findFirst({
    where: { leaderId: ali.id, isPublished: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!product) return 'réseau sans produit';
  const sellers = await prisma.user.findMany({
    where: { leaderId: ali.id, role: 'SELLER', fullName: { in: Object.keys(QUOTAS) } },
  });
  await prisma.sellerAllocation.createMany({
    data: sellers.map((s) => ({
      leaderId: ali.id,
      sellerId: s.id,
      productId: product.id,
      quantity: QUOTAS[s.fullName]!,
      byId: adminId,
    })),
  });
  return `${sellers.length} attribution(s) de ${product.name}`;
}
