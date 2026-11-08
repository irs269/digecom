import { HttpStatus, Injectable } from '@nestjs/common';
import {
  availableActions,
  BEFORE_EXIT,
  checkTransition,
  DELIVERY_MODE_LABELS,
  endOfBusinessDay,
  formatKmf,
  ORDER_RULES,
  ORDER_STATUS_LABELS,
  ROLE_SCOPE,
  sellerShareAmount,
  startOfBusinessDay,
  statusAfterConfirmations,
  taxAmount,
  type CreateOrderInput,
  type HandoverKind,
  type OrderAction,
  type OrderActionInput,
  type OrderListQuery,
  type OrderStatus,
  type OrderView,
  type Paginated,
} from '@digecom/shared';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { NotificationService } from '../notifications/notification.service';
import { LiveService } from '../notifications/live.service';
import { SalesTargets } from '../reports/insights.module';
import { PrismaService } from '../prisma/prisma.service';
import { notFound } from '../scope/scope.service';
import { SettingsService } from '../settings/settings.service';
import { CounterService } from '../stock/counter.service';
import { StockService } from '../stock/stock.service';
import { BUCKETS, StorageService } from '../storage/storage.service';
import { DeliveryJobs } from './delivery-jobs';
import { LedgerService } from '../finance/ledger.service';

type Tx = Prisma.TransactionClient;

export const ORDER_INCLUDE = {
  seller: { select: { id: true, fullName: true, phone: true, role: true } },
  leader: { select: { id: true, fullName: true } },
  island: { select: { id: true, code: true, name: true } },
  site: { select: { id: true, name: true } },
  courier: { select: { id: true, fullName: true, phone: true } },
  createdOnBehalf: { select: { id: true, fullName: true } },
  items: { include: { product: { select: { id: true, sku: true, name: true, quality: true } } } },
  confirmations: { select: { kind: true } },
  events: {
    orderBy: { at: 'asc' },
    include: { by: { select: { id: true, fullName: true, role: true } } },
  },
} satisfies Prisma.OrderInclude;

export type OrderRow = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

const STATUS_TIMESTAMP: Partial<Record<OrderStatus, keyof Prisma.OrderUncheckedUpdateInput>> = {
  CONFIRMED: 'confirmedAt',
  PREPARING: 'preparingAt',
  READY: 'readyAt',
  ASSIGNED: 'assignedAt',
  OUT_FOR_DELIVERY: 'outForDeliveryAt',
  HANDED_OVER: 'handedOverAt',
  SOLD: 'soldAt',
  DELIVERY_FAILED: 'failedAt',
  REFUSED: 'refusedAt',
  RETURN_IN_PROGRESS: 'returnStartedAt',
  RETURNED_TO_STOCK: 'returnClosedAt',
  DAMAGED: 'returnClosedAt',
  CANCELLED: 'cancelledAt',
};

const invalid = (path: string, message: string) =>
  new AppException('VALIDATION_ERROR', message, HttpStatus.UNPROCESSABLE_ENTITY, [
    { path, message },
  ]);
const conflict = (message: string) =>
  new AppException('INVALID_TRANSITION', message, HttpStatus.CONFLICT);
const forbidden = (message = 'Ton profil ne peut pas faire avancer cette commande') =>
  new AppException('FORBIDDEN', message, HttpStatus.FORBIDDEN);

interface AfterCommit {
  notify: { users: string[]; type: string; title: string; body: string }[];
  scheduleNoCourier?: boolean;
  extraLiveUsers?: string[];
  /** Leader dont l'objectif hebdomadaire est à recontrôler (vente conclue). */
  salesTarget?: string;
}

/** Circuit des commandes : création (snapshots, réservation) et transitions de la machine à états. */
@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly counters: CounterService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationService,
    private readonly live: LiveService,
    private readonly storage: StorageService,
    private readonly jobs: DeliveryJobs,
    private readonly ledger: LedgerService,
    private readonly targets: SalesTargets,
  ) {}

  // --- Périmètre -------------------------------------------------------------------------

  scope(actor: AuthUser, islandFilter?: string): Prisma.OrderWhereInput {
    switch (ROLE_SCOPE[actor.role]) {
      case 'GLOBAL':
        return islandFilter ? { islandId: islandFilter } : {};
      case 'ISLAND':
        if (actor.role === 'COURIER') return { courierId: actor.id };
        return { islandId: actor.islandId ?? '-' };
      case 'LEADER':
        return { leaderId: actor.id };
      case 'OWNER':
        return { sellerId: actor.id };
    }
  }

  // --- Lecture -----------------------------------------------------------------------------

  async list(q: OrderListQuery, actor: AuthUser): Promise<Paginated<OrderView>> {
    const statuses = q.statuses?.split(',').filter(Boolean) as OrderStatus[] | undefined;
    const where: Prisma.OrderWhereInput = {
      AND: [
        this.scope(actor, q.islandId),
        {
          status: q.status ?? (statuses?.length ? { in: statuses } : undefined),
          siteId: q.siteId,
          leaderId: q.leaderId,
          sellerId: q.sellerId,
          deliveryMode: q.deliveryMode,
          createdAt:
            q.from || q.to
              ? {
                  gte: q.from ? startOfBusinessDay(q.from) : undefined,
                  lte: q.to ? endOfBusinessDay(q.to) : undefined,
                }
              : undefined,
        },
        q.q
          ? {
              OR: [
                { number: { contains: q.q, mode: 'insensitive' } },
                { customerName: { contains: q.q, mode: 'insensitive' } },
                { customerPhone: { contains: q.q.replace(/[\s.-]/g, '') } },
              ],
            }
          : {},
      ],
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: ORDER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);
    const items = await Promise.all(rows.map((r) => this.toView(r, actor)));
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async get(id: string, actor: AuthUser): Promise<OrderView> {
    const row = await this.prisma.order.findFirst({
      where: { AND: [{ id }, this.scope(actor)] },
      include: ORDER_INCLUDE,
    });
    if (!row) throw notFound('Commande');
    return this.toView(row, actor);
  }

  // --- Création ----------------------------------------------------------------------------

  async create(
    input: CreateOrderInput,
    actor: AuthUser,
    extra: {
      campaignId?: string;
      prospectId?: string;
      /** Exécuté dans la transaction de création (ex. prospect passé à « confirmé »). */
      afterCreate?: (tx: Tx, orderId: string) => Promise<void>;
    } = {},
  ): Promise<OrderView> {
    const selfSeller = actor.role === 'SELLER' || actor.role === 'TELECONSULTANT';
    if (!selfSeller && !['ADMIN', 'LOGISTICS_ASSISTANT'].includes(actor.role)) throw forbidden();
    const sellerId = selfSeller ? actor.id : input.sellerId;
    if (!sellerId) throw invalid('sellerId', 'Vendeur requis');

    const seller = await this.prisma.user.findUnique({ where: { id: sellerId } });
    if (
      !seller ||
      !seller.isActive ||
      (seller.role !== 'SELLER' && seller.role !== 'TELECONSULTANT')
    ) {
      throw invalid('sellerId', 'Le vendeur doit être un e-commerçant ou un téléconseiller actif');
    }
    if (!seller.leaderId || !seller.islandId)
      throw invalid('sellerId', 'Ce vendeur n’a pas de leader ou d’île');
    if (actor.role === 'LOGISTICS_ASSISTANT' && seller.islandId !== actor.islandId) {
      throw invalid('sellerId', 'Ce vendeur n’est pas de ton île');
    }

    const productIds = input.items.map((i) => i.productId);
    if (new Set(productIds).size !== productIds.length) throw invalid('items', 'Produit en double');
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { leader: { select: { role: true } } },
    });
    for (const item of input.items) {
      const p = products.find((x) => x.id === item.productId);
      // Cloisonnement : uniquement le catalogue publié du leader du vendeur.
      if (!p || p.leaderId !== seller.leaderId || !p.isPublished) {
        throw invalid('items', 'Produit indisponible dans le catalogue de ton leader');
      }
    }

    const site = input.siteId
      ? await this.prisma.site.findFirst({
          where: { id: input.siteId, islandId: seller.islandId, isActive: true },
        })
      : await this.defaultSite(seller.islandId, input.items);
    if (!site) throw invalid('siteId', 'Aucun site de l’île du vendeur n’a ce stock');

    const [taxSeller, taxDigecom] = await Promise.all([
      this.settings.get('tax.seller'),
      this.settings.get('tax.digecom'),
    ]);

    const order = await this.prisma.$transaction(
      async (tx) => {
        const number = await this.counters.formatted('ORDER', 'CMD-', 6, tx);
        const created = await tx.order.create({
          data: {
            number,
            sellerId: seller.id,
            sellerType: seller.role === 'TELECONSULTANT' ? 'TELECONSULTANT' : 'SELLER',
            leaderId: seller.leaderId!,
            islandId: seller.islandId!,
            siteId: site.id,
            customerName: input.customerName,
            customerPhone: input.customerPhone,
            customerAddress: input.customerAddress,
            zone: input.zone,
            deliveryMode: input.deliveryMode,
            note: input.note,
            createdOnBehalfById: selfSeller ? null : actor.id,
            campaignId: extra.campaignId,
            prospectId: extra.prospectId,
            // Instantanés (règle 3) : prix, part, prime et taxes en vigueur à la création.
            items: {
              create: input.items.map((item) => {
                const p = products.find((x) => x.id === item.productId)!;
                const share =
                  p.leader.role === 'LEADER_SENIOR' &&
                  p.sellerShareType &&
                  p.sellerShareValue !== null
                    ? sellerShareAmount(p.salePrice, p.sellerShareType, p.sellerShareValue)
                    : null;
                return {
                  productId: p.id,
                  quantity: item.quantity,
                  unitPrice: p.salePrice,
                  sellerShare: share,
                  sellerTax: share !== null ? taxAmount(taxSeller, share) : 0,
                  digecomTax: taxAmount(taxDigecom, p.salePrice - (share ?? 0)),
                  tciBonus: p.leader.role === 'LEADER_JUNIOR' ? p.tciBonus : null,
                };
              }),
            },
            events: {
              create: { toStatus: 'NEW', action: 'create', byId: actor.id, role: actor.role },
            },
          },
        });
        for (const item of input.items) {
          await this.stock.reserve(
            {
              productId: item.productId,
              siteId: site.id,
              byId: actor.id,
              quantity: item.quantity,
              orderId: created.id,
            },
            tx,
          );
        }
        if (extra.afterCreate) await extra.afterCreate(tx, created.id);
        return created;
      },
      { timeout: 30_000, maxWait: 30_000 },
    );

    const logistics = await this.notifications.usersWithRoles(
      ['LOGISTICS_ASSISTANT'],
      order.islandId,
    );
    await this.notifications.send([...logistics, order.leaderId], {
      type: 'ORDER_NEW',
      title: `Nouvelle commande ${order.number}`,
      body: `${seller.fullName} · ${input.customerName} · ${DELIVERY_MODE_LABELS[input.deliveryMode]}`,
      link: `/commandes?id=${order.id}`,
    });
    await this.lowStockAlerts(
      input.items.map((i) => i.productId),
      site.id,
    );
    await this.broadcast(order.id);
    return this.get(order.id, actor);
  }

  // --- Transitions -------------------------------------------------------------------------

  async act(
    id: string,
    action: OrderAction,
    input: OrderActionInput,
    actor: AuthUser,
  ): Promise<OrderView> {
    const order = await this.prisma.order.findFirst({
      where: { AND: [{ id }, this.visibleForAction(actor, id)] },
      include: {
        ...ORDER_INCLUDE,
        offers: { where: { response: 'PENDING' }, select: { courierId: true } },
      },
    });
    if (!order) throw notFound('Commande');

    const confirmations = order.confirmations.map((c) => c.kind);
    const check = checkTransition(
      action,
      { status: order.status, deliveryMode: order.deliveryMode, confirmations },
      {
        role: actor.role,
        isSeller: order.sellerId === actor.id,
        isCourier: order.courierId === actor.id,
        hasPendingOffer: order.offers.some((o) => o.courierId === actor.id),
      },
    );
    if (!check.allowed) {
      // Livreur arrivé trop tard : l'offre vient d'être prise par un autre.
      if (action === 'accept' && actor.role === 'COURIER') {
        throw new AppException(
          'OFFER_TAKEN',
          'Course déjà prise par un autre livreur',
          HttpStatus.CONFLICT,
        );
      }
      if (check.reason === 'FORBIDDEN') throw forbidden();
      throw conflict(
        `Action « ${ORDER_RULES[action].label} » impossible depuis l’état « ${ORDER_STATUS_LABELS[order.status]} »`,
      );
    }
    if (ORDER_RULES[action].needsReason && !input.reason)
      throw invalid('reason', 'Motif obligatoire');

    const after: AfterCommit = { notify: [] };
    await this.prisma.$transaction(
      (tx) => this.apply(tx, order, action, input, actor, confirmations, after),
      { timeout: 30_000, maxWait: 30_000 },
    );

    for (const n of after.notify) {
      await this.notifications.send(n.users, {
        type: n.type,
        title: n.title,
        body: n.body,
        link: `/commandes?id=${order.id}`,
      });
    }
    if (after.scheduleNoCourier) await this.jobs.scheduleNoCourierCheck(order.id);
    if (after.salesTarget) await this.targets.check(after.salesTarget);
    await this.broadcast(order.id, after.extraLiveUsers);
    return this.get(order.id, actor);
  }

  /** Un livreur peut agir sur une commande proposée (offre en attente) ou qui lui est affectée. */
  private visibleForAction(actor: AuthUser, orderId: string): Prisma.OrderWhereInput {
    if (actor.role === 'COURIER') {
      return {
        OR: [
          { courierId: actor.id },
          { offers: { some: { courierId: actor.id, response: 'PENDING', orderId } } },
        ],
      };
    }
    return this.scope(actor);
  }

  private async apply(
    tx: Tx,
    order: OrderRow & { offers: { courierId: string }[] },
    action: OrderAction,
    input: OrderActionInput,
    actor: AuthUser,
    confirmations: HandoverKind[],
    after: AfterCommit,
  ): Promise<void> {
    const ref = (productId: string) => ({ productId, siteId: order.siteId, byId: actor.id });
    const logistics = () =>
      this.notifications.usersWithRoles(['LOGISTICS_ASSISTANT'], order.islandId);
    const admins = () => this.notifications.usersWithRoles(['ADMIN']);

    switch (action) {
      case 'confirm':
      case 'prepare':
        await this.move(tx, order, ORDER_RULES[action].to!, action, actor, input.note);
        return;

      case 'ready': {
        await this.move(tx, order, 'READY', action, actor, input.note);
        if (order.deliveryMode === 'PICKUP') {
          after.notify.push({
            users: [order.sellerId],
            type: 'ORDER_READY_PICKUP',
            title: `${order.number} prête au retrait`,
            body: `À retirer au site ${order.site.name}`,
          });
        } else {
          await this.offerToCouriers(tx, order, after);
        }
        return;
      }

      case 'changeMode': {
        const mode = input.deliveryMode;
        if (!mode || mode === order.deliveryMode)
          throw invalid('deliveryMode', 'Choisis un autre mode de remise');
        await tx.order.update({ where: { id: order.id }, data: { deliveryMode: mode } });
        await this.event(
          tx,
          order.id,
          order.status,
          order.status,
          action,
          actor,
          `${DELIVERY_MODE_LABELS[order.deliveryMode]} → ${DELIVERY_MODE_LABELS[mode]}`,
        );
        if (order.status === 'READY') {
          if (mode === 'PICKUP') {
            await this.expireOffers(tx, order.id, after);
          } else if (order.deliveryMode === 'PICKUP') {
            await this.offerToCouriers(tx, { ...order, deliveryMode: mode }, after);
          }
        }
        return;
      }

      case 'assign': {
        if (!input.courierId) throw invalid('courierId', 'Choisis un livreur');
        const courier = await tx.user.findUnique({ where: { id: input.courierId } });
        if (!courier || courier.role !== 'COURIER' || !courier.isActive)
          throw invalid('courierId', 'Livreur inconnu ou inactif');
        if (courier.islandId !== order.islandId)
          throw invalid('courierId', 'Le livreur doit être de l’île du site');
        await this.move(tx, order, 'ASSIGNED', action, actor, `Affectée à ${courier.fullName}`, {
          courierId: courier.id,
        });
        await this.closeOffers(tx, order.id, courier.id, after);
        after.notify.push(
          {
            users: [courier.id],
            type: 'DELIVERY_ASSIGNED',
            title: `Course ${order.number} affectée`,
            body: `Récupération au site ${order.site.name}`,
          },
          {
            users: [order.sellerId, ...(await logistics())],
            type: 'ORDER_ASSIGNED',
            title: `${order.number} : livreur affecté`,
            body: courier.fullName,
          },
        );
        return;
      }

      case 'accept': {
        // Premier qui accepte : mise à jour conditionnelle sur le statut READY.
        const { count } = await tx.order.updateMany({
          where: { id: order.id, status: 'READY', courierId: null },
          data: { status: 'ASSIGNED', courierId: actor.id, assignedAt: new Date() },
        });
        if (count === 0)
          throw new AppException(
            'OFFER_TAKEN',
            'Course déjà prise par un autre livreur',
            HttpStatus.CONFLICT,
          );
        await this.event(tx, order.id, 'READY', 'ASSIGNED', action, actor);
        await this.closeOffers(tx, order.id, actor.id, after);
        const me = await tx.user.findUniqueOrThrow({
          where: { id: actor.id },
          select: { fullName: true },
        });
        after.notify.push({
          users: [order.sellerId, ...(await logistics())],
          type: 'ORDER_ASSIGNED',
          title: `${order.number} : course acceptée`,
          body: me.fullName,
        });
        return;
      }

      case 'pickup': {
        await this.exitStock(tx, order, ref);
        await tx.handoverConfirmation.create({
          data: { orderId: order.id, kind: 'PICKUP_FROM_SITE', byId: actor.id },
        });
        await this.move(tx, order, 'OUT_FOR_DELIVERY', action, actor);
        return;
      }

      case 'siteHandover': {
        await this.exitStock(tx, order, ref);
        await this.confirm(tx, order, 'SITE_HANDOVER', confirmations, action, actor, after, {});
        return;
      }

      case 'handover': {
        const direct = order.deliveryMode === 'TO_CUSTOMER';
        if (direct && input.amountCollected === undefined) {
          throw invalid('amountCollected', 'Indique le montant encaissé');
        }
        let proofKey: string | undefined;
        if (input.proofKey) {
          proofKey = await this.storage.finalizeImage(
            BUCKETS.proofs,
            input.proofKey,
            `orders/${order.id}`,
          );
        }
        await this.confirm(
          tx,
          order,
          direct ? 'TO_CUSTOMER' : 'TO_SELLER',
          confirmations,
          action,
          actor,
          after,
          {
            amountCollected: direct ? input.amountCollected : undefined,
            proofKey,
          },
        );
        return;
      }

      case 'sellerConfirm':
        await this.confirm(tx, order, 'SELLER_RECEIVED', confirmations, action, actor, after, {});
        return;

      case 'markSold': {
        await this.move(tx, order, 'SOLD', action, actor, input.note);
        // Écritures financières dans la même transaction (règle 5 : définitives en SOLD).
        await this.ledger.recordSale(tx, order.id, actor.id);
        const cashiers = await this.notifications.usersWithRoles(['CASHIER'], order.islandId);
        after.notify.push({
          users: [...(await admins()), ...cashiers, ...(await logistics())],
          type: 'ORDER_SOLD',
          title: `${order.number} vendue`,
          body: `${order.customerName} a pris · ${formatKmf(this.total(order))}`,
        });
        if (order.sellerType === 'TELECONSULTANT') {
          const bonus = order.items.reduce((s, i) => s + (i.tciBonus ?? 0) * i.quantity, 0);
          after.notify.push({
            users: [order.sellerId, order.leaderId],
            type: 'TCI_SALE_CLOSED',
            title: `${order.number} clôturée : prime ajoutée`,
            body: `+${formatKmf(bonus)} pour la vente à ${order.customerName}`,
          });
        }
        after.salesTarget = order.leaderId;
        return;
      }

      case 'markRefused':
      case 'fail': {
        const failed = action === 'fail';
        await this.move(
          tx,
          order,
          failed ? 'DELIVERY_FAILED' : 'REFUSED',
          action,
          actor,
          input.reason,
          failed ? { failReason: input.reason } : { refuseReason: input.reason },
        );
        // Retour au site immédiat : la marchandise doit être contrôlée par le stock.
        await this.move(
          tx,
          { ...order, status: failed ? 'DELIVERY_FAILED' : 'REFUSED' },
          'RETURN_IN_PROGRESS',
          'return',
          actor,
        );
        const stockManagers = await this.notifications.usersWithRoles(
          ['STOCK_MANAGER'],
          order.islandId,
        );
        after.notify.push({
          users: failed
            ? [order.sellerId, ...(await logistics()), ...stockManagers]
            : [
                ...(await admins()),
                ...(await this.notifications.usersWithRoles(['CASHIER'], order.islandId)),
                ...(await logistics()),
                ...stockManagers,
              ],
          type: failed ? 'DELIVERY_FAILED' : 'ORDER_REFUSED',
          title: failed
            ? `${order.number} : livraison échouée`
            : `${order.number} refusée par le client`,
          body: `${input.reason} · retour au site à contrôler`,
        });
        return;
      }

      case 'restock':
      case 'damaged': {
        for (const item of order.items) {
          await this.stock.returnToStock(
            {
              ...ref(item.productId),
              quantity: item.quantity,
              orderId: order.id,
              reason: input.reason ?? 'Retour contrôlé',
            },
            tx,
          );
          if (action === 'damaged') {
            await this.stock.remove(
              {
                ...ref(item.productId),
                quantity: item.quantity,
                type: 'DAMAGED',
                reason: input.reason!,
                orderId: order.id,
              },
              tx,
            );
          }
        }
        await this.move(
          tx,
          order,
          action === 'restock' ? 'RETURNED_TO_STOCK' : 'DAMAGED',
          action,
          actor,
          input.reason,
        );
        return;
      }

      case 'cancel': {
        if (BEFORE_EXIT.includes(order.status)) {
          for (const item of order.items) {
            await this.stock.release(
              { ...ref(item.productId), quantity: item.quantity, orderId: order.id },
              tx,
            );
          }
        }
        await this.expireOffers(tx, order.id, after);
        await this.move(tx, order, 'CANCELLED', action, actor, input.reason, {
          cancelReason: input.reason,
        });
        after.notify.push({
          users: [order.sellerId, order.leaderId, ...(await logistics())].filter(
            (u) => u !== actor.id,
          ),
          type: 'ORDER_CANCELLED',
          title: `${order.number} annulée`,
          body: input.reason ?? '',
        });
        return;
      }

      case 'returnAfterSale':
        await this.move(tx, order, 'RETURN_IN_PROGRESS', action, actor, input.reason);
        // Corrections liées et justifiées : jamais de suppression des écritures de vente.
        await this.ledger.reverseOrder(
          tx,
          order.id,
          actor.id,
          `Retour après vente : ${input.reason}`,
        );
        return;
    }
  }

  // --- Mécanique ---------------------------------------------------------------------------

  /** Change le statut (mise à jour conditionnelle) et écrit l'événement de frise. */
  private async move(
    tx: Tx,
    order: { id: string; status: OrderStatus },
    to: OrderStatus,
    action: string,
    actor: AuthUser,
    note?: string | null,
    data: Prisma.OrderUncheckedUpdateManyInput = {},
  ) {
    const stamp = STATUS_TIMESTAMP[to];
    const { count } = await tx.order.updateMany({
      where: { id: order.id, status: order.status },
      data: { ...data, status: to, ...(stamp ? { [stamp]: new Date() } : {}) },
    });
    if (count === 0) throw conflict('La commande vient de changer d’état : recharge la page');
    await this.event(tx, order.id, order.status, to, action, actor, note);
  }

  private event(
    tx: Tx,
    orderId: string,
    from: OrderStatus | null,
    to: OrderStatus,
    action: string,
    actor: AuthUser,
    note?: string | null,
  ) {
    return tx.orderEvent.create({
      data: {
        orderId,
        fromStatus: from,
        toStatus: to,
        action,
        byId: actor.id,
        role: actor.role,
        note: note ?? null,
      },
    });
  }

  /** Enregistre une confirmation de remise et passe à HANDED_OVER quand elles sont toutes là. */
  private async confirm(
    tx: Tx,
    order: OrderRow,
    kind: HandoverKind,
    confirmations: HandoverKind[],
    action: OrderAction,
    actor: AuthUser,
    after: AfterCommit,
    extra: { amountCollected?: number; proofKey?: string },
  ) {
    await tx.handoverConfirmation.create({
      data: { orderId: order.id, kind, byId: actor.id, ...extra },
    });
    const next = statusAfterConfirmations(order.deliveryMode, order.status, [
      ...confirmations,
      kind,
    ]);
    if (next === order.status) {
      await this.event(tx, order.id, order.status, order.status, action, actor);
      if (kind === 'TO_SELLER' || kind === 'SITE_HANDOVER') {
        after.notify.push({
          users: [order.sellerId],
          type: 'HANDOVER_TO_CONFIRM',
          title: `${order.number} : confirme la réception`,
          body:
            kind === 'TO_SELLER' ? 'Le livreur a remis le produit' : 'Le site a remis le produit',
        });
      }
      return;
    }
    const fee = order.courierId ? await this.settings.get('delivery.feePerRun') : null;
    await this.move(tx, order, next, action, actor, null, {
      amountCollected: extra.amountCollected,
      proofKey: extra.proofKey,
      courierFee: order.courierId ? fee : null,
    });
    after.notify.push({
      users: [order.sellerId, ...(await this.notifications.usersWithRoles(['ADMIN']))],
      type: 'ORDER_HANDED_OVER',
      title: `${order.number} : remise effectuée`,
      body:
        order.deliveryMode === 'TO_CUSTOMER'
          ? `Encaissé ${formatKmf(extra.amountCollected ?? 0)} · déclarer si le client a pris`
          : 'Déclarer si le client a pris ou refusé',
    });
  }

  /** Sortie du site : consomme les lots FIFO et fige le coût unitaire sur chaque ligne. */
  private async exitStock(
    tx: Tx,
    order: OrderRow,
    ref: (productId: string) => { productId: string; siteId: string; byId: string },
  ) {
    for (const item of order.items) {
      const out = await this.stock.out(
        { ...ref(item.productId), quantity: item.quantity, orderId: order.id },
        tx,
      );
      await tx.orderItem.update({ where: { id: item.id }, data: { unitCost: out.unitCost } });
    }
  }

  /** Offre la course aux livreurs actifs, disponibles, de l'île du site (et seulement eux). */
  private async offerToCouriers(tx: Tx, order: OrderRow, after: AfterCommit) {
    const couriers = await tx.user.findMany({
      where: { role: 'COURIER', isActive: true, isAvailable: true, islandId: order.islandId },
      select: { id: true },
    });
    if (couriers.length) {
      await tx.deliveryOffer.createMany({
        data: couriers.map((c) => ({ orderId: order.id, courierId: c.id })),
        skipDuplicates: true,
      });
      after.notify.push({
        users: couriers.map((c) => c.id),
        type: 'DELIVERY_OFFER',
        title: `Course disponible ${order.number}`,
        body: `${order.site.name} → ${order.zone ?? order.customerAddress ?? 'adresse du client'}`,
      });
    }
    after.scheduleNoCourier = true;
  }

  private async closeOffers(tx: Tx, orderId: string, winnerId: string, after: AfterCommit) {
    const pending = await tx.deliveryOffer.findMany({ where: { orderId, response: 'PENDING' } });
    const now = new Date();
    await tx.deliveryOffer.updateMany({
      where: { orderId, response: 'PENDING', courierId: { not: winnerId } },
      data: { response: 'TAKEN_BY_OTHER', respondedAt: now },
    });
    await tx.deliveryOffer.updateMany({
      where: { orderId, courierId: winnerId, response: 'PENDING' },
      data: { response: 'ACCEPTED', respondedAt: now },
    });
    // Les autres livreurs voient l'offre disparaître en temps réel.
    after.extraLiveUsers = [...(after.extraLiveUsers ?? []), ...pending.map((o) => o.courierId)];
  }

  private async expireOffers(tx: Tx, orderId: string, after: AfterCommit) {
    const pending = await tx.deliveryOffer.findMany({ where: { orderId, response: 'PENDING' } });
    await tx.deliveryOffer.updateMany({
      where: { orderId, response: 'PENDING' },
      data: { response: 'EXPIRED', respondedAt: new Date() },
    });
    after.extraLiveUsers = [...(after.extraLiveUsers ?? []), ...pending.map((o) => o.courierId)];
  }

  private async defaultSite(islandId: string, items: { productId: string; quantity: number }[]) {
    const sites = await this.prisma.site.findMany({
      where: { islandId, isActive: true },
      include: { stockLevels: { where: { productId: { in: items.map((i) => i.productId) } } } },
      orderBy: [{ type: 'desc' }, { name: 'asc' }],
    });
    return (
      sites.find((s) =>
        items.every(
          (i) =>
            (s.stockLevels.find((l) => l.productId === i.productId)?.available ?? 0) >= i.quantity,
        ),
      ) ??
      sites[0] ??
      null
    );
  }

  /** Alerte stock faible / rupture après une réservation (§7 : stock, leader, direction). */
  private async lowStockAlerts(productIds: string[], siteId: string) {
    const [levels, threshold] = await Promise.all([
      this.prisma.stockLevel.findMany({
        where: { siteId, productId: { in: productIds } },
        include: {
          product: { select: { name: true, leaderId: true, lowStockThreshold: true } },
          site: { select: { islandId: true, name: true } },
        },
      }),
      this.settings.get('stock.lowThresholdDefault'),
    ]);
    for (const l of levels) {
      const limit = l.product.lowStockThreshold ?? threshold;
      if (l.available > limit) continue;
      const users = [
        ...(await this.notifications.usersWithRoles(['STOCK_MANAGER'], l.site.islandId)),
        ...(await this.notifications.usersWithRoles(['ADMIN'])),
        l.product.leaderId,
      ];
      await this.notifications.send(users, {
        type: l.available === 0 ? 'STOCK_OUT' : 'STOCK_LOW',
        title:
          l.available === 0 ? `Rupture : ${l.product.name}` : `Stock faible : ${l.product.name}`,
        body: `${l.available} disponible(s) à ${l.site.name}`,
        link: '/stock',
      });
    }
  }

  /** Diffuse le changement d'une commande aux personnes qui la suivent (tableaux temps réel). */
  async broadcast(orderId: string, extraUsers: string[] = []) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return;
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          { role: { in: ['ADMIN', 'FINANCE_MANAGER', 'ACCOUNTANT'] } },
          { role: { in: ['LOGISTICS_ASSISTANT', 'STOCK_MANAGER'] }, islandId: order.islandId },
          { role: 'COURIER', islandId: order.islandId },
          {
            id: {
              in: [order.sellerId, order.leaderId, ...(order.courierId ? [order.courierId] : [])],
            },
          },
        ],
      },
      select: { id: true },
    });
    await this.live.publish([...users.map((u) => u.id), ...extraUsers], {
      kind: 'order',
      orderId,
      status: order.status,
      islandId: order.islandId,
    });
  }

  private total(order: { items: { unitPrice: number; quantity: number }[] }) {
    return order.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  }

  async toView(r: OrderRow, actor: AuthUser): Promise<OrderView> {
    const confirmations = r.confirmations.map((c) => c.kind);
    return {
      id: r.id,
      number: r.number,
      status: r.status,
      deliveryMode: r.deliveryMode,
      seller: r.seller,
      sellerType: r.sellerType,
      leader: r.leader,
      island: r.island,
      site: r.site,
      customerName: r.customerName,
      customerPhone: r.customerPhone,
      customerAddress: r.customerAddress,
      zone: r.zone,
      courier: r.courier,
      items: r.items.map((i) => ({
        id: i.id,
        product: i.product,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        sellerShare: i.sellerShare,
        sellerTax: i.sellerTax,
        digecomTax: i.digecomTax,
        tciBonus: i.tciBonus,
        unitCost: i.unitCost,
      })),
      total: this.total(r),
      failReason: r.failReason,
      refuseReason: r.refuseReason,
      cancelReason: r.cancelReason,
      amountCollected: r.amountCollected,
      proofUrl: r.proofKey ? await this.storage.presignGet(BUCKETS.proofs, r.proofKey) : null,
      courierFee: r.courierFee,
      confirmations,
      createdOnBehalfBy: r.createdOnBehalf,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      events: r.events.map((e) => ({
        id: e.id,
        at: e.at.toISOString(),
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        action: e.action,
        note: e.note,
        by: e.by,
      })),
      actions: availableActions(
        { status: r.status, deliveryMode: r.deliveryMode, confirmations },
        {
          role: actor.role,
          isSeller: r.sellerId === actor.id,
          isCourier: r.courierId === actor.id,
        },
      ),
    };
  }
}
