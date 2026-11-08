import { Injectable } from '@nestjs/common';
import {
  ROLE_SCOPE,
  startOfBusinessDay,
  businessToday,
  type CourierView,
  type DeliveryOfferView,
  type OrderStatus,
  type OrderView,
} from '@digecom/shared';
import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { ORDER_INCLUDE, OrderService } from './order.service';

/** Lectures des livraisons : tableau par colonnes, livreurs, offres et courses d'un livreur. */
@Injectable()
export class DeliveriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderService,
  ) {}

  private islandScope(actor: AuthUser, islandId?: string): Prisma.OrderWhereInput {
    if (ROLE_SCOPE[actor.role] === 'GLOBAL') return islandId ? { islandId } : {};
    return { islandId: actor.islandId ?? '-' };
  }

  async board(actor: AuthUser, islandId?: string) {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const rows = await this.prisma.order.findMany({
      where: {
        AND: [
          this.islandScope(actor, islandId),
          {
            OR: [
              { status: { in: ['READY', 'ASSIGNED', 'OUT_FOR_DELIVERY'] } },
              { status: { in: ['DELIVERY_FAILED', 'REFUSED', 'RETURN_IN_PROGRESS'] } },
              { status: { in: ['DAMAGED', 'RETURNED_TO_STOCK'] }, returnClosedAt: { gte: since } },
            ],
          },
        ],
      },
      include: ORDER_INCLUDE,
      orderBy: { updatedAt: 'desc' },
      take: 300,
    });
    const views = await Promise.all(rows.map((r) => this.orders.toView(r, actor)));
    const inStatus = (statuses: OrderStatus[]) => views.filter((v) => statuses.includes(v.status));
    return {
      waiting: inStatus(['READY']).filter((v) => v.deliveryMode !== 'PICKUP'),
      inProgress: inStatus(['ASSIGNED', 'OUT_FOR_DELIVERY']),
      pickupReady: inStatus(['READY']).filter((v) => v.deliveryMode === 'PICKUP'),
      issues: inStatus([
        'DELIVERY_FAILED',
        'REFUSED',
        'RETURN_IN_PROGRESS',
        'DAMAGED',
        'RETURNED_TO_STOCK',
      ]),
    };
  }

  async couriers(actor: AuthUser, islandId?: string): Promise<CourierView[]> {
    const island = ROLE_SCOPE[actor.role] === 'GLOBAL' ? islandId : (actor.islandId ?? '-');
    const today = startOfBusinessDay(businessToday());
    const rows = await this.prisma.user.findMany({
      where: { role: 'COURIER', isActive: true, ...(island ? { islandId: island } : {}) },
      include: {
        island: { select: { id: true, code: true, name: true } },
        ordersAsCourier: {
          where: {
            OR: [
              { status: { in: ['ASSIGNED', 'OUT_FOR_DELIVERY'] } },
              { handedOverAt: { gte: today } },
            ],
          },
          select: { status: true, handedOverAt: true },
        },
      },
      orderBy: { fullName: 'asc' },
    });
    return rows.map((c) => ({
      id: c.id,
      fullName: c.fullName,
      phone: c.phone,
      island: c.island,
      isAvailable: c.isAvailable,
      activeRuns: c.ordersAsCourier.filter(
        (o) => o.status === 'ASSIGNED' || o.status === 'OUT_FOR_DELIVERY',
      ).length,
      deliveredToday: c.ordersAsCourier.filter((o) => o.handedOverAt && o.handedOverAt >= today)
        .length,
    }));
  }

  async offersFor(courierId: string): Promise<DeliveryOfferView[]> {
    const offers = await this.prisma.deliveryOffer.findMany({
      where: { courierId, response: 'PENDING', order: { status: 'READY', courierId: null } },
      include: {
        order: {
          include: {
            site: { select: { id: true, name: true, address: true } },
            items: { include: { product: { select: { name: true } } } },
          },
        },
      },
      orderBy: { sentAt: 'desc' },
    });
    return offers.map((o) => ({
      orderId: o.orderId,
      number: o.order.number,
      sentAt: o.sentAt.toISOString(),
      site: o.order.site,
      zone: o.order.zone,
      customerAddress: o.order.customerAddress,
      deliveryMode: o.order.deliveryMode,
      items: o.order.items.map((i) => ({ name: i.product.name, quantity: i.quantity })),
      total: o.order.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0),
    }));
  }

  async runsFor(actor: AuthUser, statuses: OrderStatus[]): Promise<OrderView[]> {
    const rows = await this.prisma.order.findMany({
      where: { courierId: actor.id, status: { in: statuses } },
      include: ORDER_INCLUDE,
      orderBy: { assignedAt: 'desc' },
    });
    return Promise.all(rows.map((r) => this.orders.toView(r, actor)));
  }

  async history(actor: AuthUser) {
    const rows = await this.prisma.order.findMany({
      where: { courierId: actor.id, handedOverAt: { not: null } },
      select: {
        id: true,
        number: true,
        status: true,
        handedOverAt: true,
        courierFee: true,
        amountCollected: true,
        deliveryMode: true,
      },
      orderBy: { handedOverAt: 'desc' },
      take: 100,
    });
    return {
      runs: rows.map((r) => ({ ...r, handedOverAt: r.handedOverAt!.toISOString() })),
      totalFees: rows.reduce((s, r) => s + (r.courierFee ?? 0), 0),
      totalCollected: rows.reduce((s, r) => s + (r.amountCollected ?? 0), 0),
    };
  }
}
