import { HttpStatus, Injectable } from '@nestjs/common';
import {
  businessToday,
  isoWeekOf,
  isoWeekRange,
  ROLE_SCOPE,
  type AllocationInput,
  type NetworkMember,
  type NetworkTeam,
  type NetworkView,
} from '@digecom/shared';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { notFound } from '../scope/scope.service';
import { salesBy, salesTotals } from './sales-query';

/** Statuts qui consomment une quantité attribuée (en cours ou vendue). */
const CONSUMING = [
  'NEW',
  'CONFIRMED',
  'PREPARING',
  'READY',
  'ASSIGNED',
  'OUT_FOR_DELIVERY',
  'HANDED_OVER',
  'SOLD',
] as const;

/** Réseau commercial : équipes, performances, quotas attribués, objectifs. */
@Injectable()
export class NetworkService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    actor: AuthUser,
    period: { start: string; end: string },
    islandId?: string,
  ): Promise<NetworkView> {
    const isLeader = ROLE_SCOPE[actor.role] === 'LEADER';
    const leaders = await this.prisma.user.findMany({
      where: {
        role: { in: ['LEADER_SENIOR', 'LEADER_JUNIOR'] },
        ...(isLeader ? { id: actor.id } : {}),
        ...(islandId && !isLeader ? { islandId } : {}),
      },
      orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
      select: { id: true },
    });
    const teams = await Promise.all(leaders.map((l) => this.team(l.id, period)));
    return { period, teams };
  }

  async team(leaderId: string, period: { start: string; end: string }): Promise<NetworkTeam> {
    const leader = await this.prisma.user.findUnique({
      where: { id: leaderId },
      include: { island: { select: { name: true } }, salesTarget: true },
    });
    if (!leader || (leader.role !== 'LEADER_SENIOR' && leader.role !== 'LEADER_JUNIOR'))
      throw notFound('Équipe');
    const week = isoWeekRange(isoWeekOf(businessToday()));
    const f = { from: period.start, to: period.end, leaderId };
    const [members, bySeller, totals, weekTotals, allocations, used, products] = await Promise.all([
      this.prisma.user.findMany({
        where: { leaderId, role: { in: ['SELLER', 'TELECONSULTANT'] } },
        orderBy: { fullName: 'asc' },
        select: { id: true, fullName: true, phone: true, role: true, isActive: true },
      }),
      salesBy(this.prisma, f, Prisma.sql`o."sellerId"`),
      salesTotals(this.prisma, f),
      salesTotals(this.prisma, { from: week.start, to: week.end, leaderId }),
      this.prisma.sellerAllocation.groupBy({
        by: ['sellerId', 'productId'],
        where: { leaderId },
        _sum: { quantity: true },
      }),
      this.usedBySeller(leaderId),
      this.prisma.product.findMany({ where: { leaderId }, select: { id: true, name: true } }),
    ]);
    const productName = new Map(products.map((p) => [p.id, p.name]));
    const rows: NetworkMember[] = members.map((m) => {
      const allocs = allocations
        .filter((a) => a.sellerId === m.id)
        .map((a) => {
          const allocated = a._sum.quantity ?? 0;
          const sold = used.get(`${m.id}|${a.productId}`) ?? 0;
          return {
            productId: a.productId,
            product: productName.get(a.productId) ?? '—',
            allocated,
            sold,
            remaining: Math.max(allocated - sold, 0),
          };
        });
      const s = bySeller.get(m.id);
      return {
        id: m.id,
        fullName: m.fullName,
        phone: m.phone,
        role: m.role as 'SELLER' | 'TELECONSULTANT',
        isActive: m.isActive,
        sold: s?.quantity ?? 0,
        revenue: s?.revenue ?? 0,
        allocated: allocs.reduce((a, x) => a + x.allocated, 0),
        remaining: allocs.reduce((a, x) => a + x.remaining, 0),
        allocations: allocs,
      };
    });
    return {
      leader: {
        id: leader.id,
        fullName: leader.fullName,
        role: leader.role,
        island: leader.island?.name ?? null,
      },
      members: rows,
      sold: totals.quantity,
      revenue: totals.revenue,
      marginAfterTax: totals.marginAfterTax,
      activeMembers: rows.filter((m) => m.isActive).length,
      weeklyTarget: leader.salesTarget?.weeklyRevenue ?? null,
      weekRevenue: weekTotals.revenue,
    };
  }

  /** Unités commandées (en cours ou vendues) par vendeur et produit de l'équipe. */
  private async usedBySeller(leaderId: string): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<
      { sellerId: string; productId: string; qty: number }[]
    >`
      SELECT o."sellerId", oi."productId", SUM(oi.quantity)::int AS qty
      FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
      WHERE o."leaderId" = ${leaderId}
        AND o.status::text IN (${Prisma.join([...CONSUMING])})
      GROUP BY 1, 2`;
    return new Map(rows.map((r) => [`${r.sellerId}|${r.productId}`, r.qty]));
  }

  async allocate(input: AllocationInput, actor: AuthUser) {
    const seller = await this.prisma.user.findFirst({
      where: {
        id: input.sellerId,
        role: 'SELLER',
        ...(actor.role === 'ADMIN' ? {} : { leaderId: actor.id }),
      },
    });
    if (!seller || !seller.leaderId) throw notFound('E-commerçant');
    const product = await this.prisma.product.findFirst({
      where: { id: input.productId, leaderId: seller.leaderId },
    });
    if (!product) throw notFound('Produit');
    if (input.quantity < 0) {
      const current = await this.prisma.sellerAllocation.aggregate({
        where: { sellerId: seller.id, productId: product.id },
        _sum: { quantity: true },
      });
      const used =
        (await this.usedBySeller(seller.leaderId)).get(`${seller.id}|${product.id}`) ?? 0;
      if ((current._sum.quantity ?? 0) + input.quantity < used)
        throw new AppException(
          'VALIDATION_ERROR',
          `Impossible de descendre sous les ${used} unité(s) déjà commandées`,
          HttpStatus.UNPROCESSABLE_ENTITY,
          { quantity: 'Quantité trop faible' },
        );
    }
    return this.prisma.sellerAllocation.create({
      data: {
        leaderId: seller.leaderId,
        sellerId: seller.id,
        productId: product.id,
        quantity: input.quantity,
        byId: actor.id,
      },
    });
  }

  async setTarget(leaderId: string, weeklyRevenue: number, actor: AuthUser) {
    if (actor.role !== 'ADMIN' && leaderId !== actor.id) throw notFound('Équipe');
    const leader = await this.prisma.user.findFirst({
      where: { id: leaderId, role: { in: ['LEADER_SENIOR', 'LEADER_JUNIOR'] } },
    });
    if (!leader) throw notFound('Équipe');
    return this.prisma.salesTarget.upsert({
      where: { leaderId },
      create: { leaderId, weeklyRevenue },
      update: { weeklyRevenue, lastReachedWeek: null },
    });
  }
}
