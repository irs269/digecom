import { HttpStatus, Injectable } from '@nestjs/common';
import {
  businessToday,
  endOfBusinessDay,
  isoWeekOf,
  isoWeekRange,
  ROLE_SCOPE,
  startOfBusinessDay,
  type EarningsOrder,
  type OrderView,
  type TciEarnings,
} from '@digecom/shared';
import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { OrderService } from '../orders/order.service';
import { PrismaService } from '../prisma/prisma.service';
import { notFound } from '../scope/scope.service';

const ORDER_SELECT = {
  id: true,
  number: true,
  status: true,
  createdAt: true,
  soldAt: true,
  customerName: true,
  deliveryMode: true,
  seller: { select: { id: true, fullName: true } },
  leader: { select: { fullName: true } },
  items: {
    select: {
      quantity: true,
      unitPrice: true,
      tciBonus: true,
      product: { select: { name: true } },
    },
  },
} satisfies Prisma.OrderSelect;
type Row = Prisma.OrderGetPayload<{ select: typeof ORDER_SELECT }>;

const amount = (o: Row) => o.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
const bonus = (o: Row) => o.items.reduce((s, i) => s + (i.tciBonus ?? 0) * i.quantity, 0);

function toEarningsOrder(o: Row): EarningsOrder {
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    createdAt: o.createdAt.toISOString(),
    soldAt: o.soldAt?.toISOString() ?? null,
    customerName: o.customerName,
    product: o.items.map((i) => i.product.name).join(', '),
    amount: amount(o),
    bonus: bonus(o),
    tci: o.seller,
    deliveryMode: o.deliveryMode,
  };
}

/**
 * Ventes et gains des téléconseillers. Calcul exclusivement à partir des instantanés
 * (`OrderItem.tciBonus`) des commandes SOLD : aucune table de solde modifiable (DATA-MODEL.md).
 */
@Injectable()
export class TciService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
  ) {}

  async myEarnings(actor: AuthUser, week?: string): Promise<TciEarnings> {
    if (actor.role !== 'TELECONSULTANT')
      throw new AppException('FORBIDDEN', 'Réservé aux téléconseillers', HttpStatus.FORBIDDEN);
    return this.compute([{ id: actor.id, fullName: '' }], week, false);
  }

  async teamEarnings(actor: AuthUser, week?: string, leaderId?: string): Promise<TciEarnings> {
    let leader = actor.role === 'LEADER_JUNIOR' ? actor.id : leaderId;
    if (actor.role === 'LEADER_JUNIOR' && leaderId && leaderId !== actor.id)
      throw notFound('Équipe');
    if (!leader && ROLE_SCOPE[actor.role] === 'GLOBAL') leader = undefined;
    const tcis = await this.prisma.user.findMany({
      where: { role: 'TELECONSULTANT', ...(leader ? { leaderId: leader } : {}) },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    });
    return this.compute(tcis, week, true);
  }

  private async compute(
    tcis: { id: string; fullName: string }[],
    week: string | undefined,
    withTeam: boolean,
  ): Promise<TciEarnings> {
    const weekId = week ?? isoWeekOf(businessToday());
    let range: { start: string; end: string };
    try {
      range = isoWeekRange(weekId);
    } catch {
      throw new AppException(
        'VALIDATION_ERROR',
        'Semaine invalide',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const from = startOfBusinessDay(range.start);
    const to = endOfBusinessDay(range.end);
    const ids = tcis.map((t) => t.id);
    const base: Prisma.OrderWhereInput = { sellerType: 'TELECONSULTANT', sellerId: { in: ids } };

    const [sold, allSold, toClose, created] = await Promise.all([
      this.prisma.order.findMany({
        where: { ...base, status: 'SOLD', soldAt: { gte: from, lte: to } },
        select: ORDER_SELECT,
        orderBy: { soldAt: 'asc' },
      }),
      this.prisma.order.findMany({
        where: { ...base, status: 'SOLD' },
        select: { sellerId: true, items: { select: { tciBonus: true, quantity: true } } },
      }),
      this.prisma.order.findMany({
        where: { ...base, status: 'HANDED_OVER' },
        select: ORDER_SELECT,
        orderBy: { handedOverAt: 'asc' },
      }),
      this.prisma.order.findMany({
        where: { ...base, createdAt: { gte: from, lte: to } },
        select: ORDER_SELECT,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const weekOrders = [
      ...new Map([...created, ...sold, ...toClose].map((o) => [o.id, o])).values(),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const totalBy = new Map<string, number>();
    for (const o of allSold) {
      totalBy.set(
        o.sellerId,
        (totalBy.get(o.sellerId) ?? 0) +
          o.items.reduce((s, i) => s + (i.tciBonus ?? 0) * i.quantity, 0),
      );
    }

    const byProductMap = new Map<
      string,
      { product: string; leader: string; bonus: number; count: number; total: number }
    >();
    for (const o of sold) {
      for (const i of o.items) {
        const key = `${i.product.name}|${i.tciBonus}|${o.leader.fullName}`;
        const cur = byProductMap.get(key) ?? {
          product: i.product.name,
          leader: o.leader.fullName,
          bonus: i.tciBonus ?? 0,
          count: 0,
          total: 0,
        };
        cur.count += i.quantity;
        cur.total += (i.tciBonus ?? 0) * i.quantity;
        byProductMap.set(key, cur);
      }
    }

    const result: TciEarnings = {
      week: { id: weekId, ...range },
      soldAmount: sold.reduce((s, o) => s + amount(o), 0),
      soldCount: sold.reduce((s, o) => s + o.items.reduce((q, i) => q + i.quantity, 0), 0),
      weekEarnings: sold.reduce((s, o) => s + bonus(o), 0),
      totalEarnings: [...totalBy.values()].reduce((s, v) => s + v, 0),
      toClose: toClose.map(toEarningsOrder),
      weekOrders: weekOrders.map(toEarningsOrder),
      byProduct: [...byProductMap.values()].sort((a, b) => b.total - a.total),
    };
    if (withTeam) {
      result.byTci = tcis.map((t) => {
        const mine = sold.filter((o) => o.seller.id === t.id);
        return {
          tci: t,
          soldCount: mine.reduce((s, o) => s + o.items.reduce((q, i) => q + i.quantity, 0), 0),
          soldAmount: mine.reduce((s, o) => s + amount(o), 0),
          weekEarnings: mine.reduce((s, o) => s + bonus(o), 0),
          totalEarnings: totalBy.get(t.id) ?? 0,
          toClose: toClose.filter((o) => o.seller.id === t.id).length,
        };
      });
    }
    return result;
  }

  /** Clôture après remise : « Vendu » (prime définitive, écritures) ou « Client a refusé ». */
  async close(
    orderId: string,
    result: 'SOLD' | 'REFUSED',
    reason: string | undefined,
    actor: AuthUser,
  ): Promise<OrderView> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.sellerType !== 'TELECONSULTANT') throw notFound('Vente');
    if (actor.role === 'TELECONSULTANT' && order.sellerId !== actor.id) throw notFound('Vente');
    if (result === 'REFUSED' && !reason) {
      throw new AppException(
        'VALIDATION_ERROR',
        'Motif du refus obligatoire',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return this.orders.act(
      orderId,
      result === 'SOLD' ? 'markSold' : 'markRefused',
      { reason },
      actor,
    );
  }
}
