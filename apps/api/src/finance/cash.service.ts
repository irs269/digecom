import { HttpStatus, Injectable } from '@nestjs/common';
import {
  businessToday,
  ROLE_SCOPE,
  startOfBusinessDay,
  type CashOperationInput,
  type CashRegisterView,
  type CashSessionView,
  type PendingRemittance,
} from '@digecom/shared';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { notFound } from '../scope/scope.service';

type Tx = Prisma.TransactionClient;

const SESSION_INCLUDE = {
  openedBy: { select: { id: true, fullName: true } },
  closedBy: { select: { id: true, fullName: true } },
  operations: {
    include: { by: { select: { id: true, fullName: true } } },
    orderBy: { at: 'desc' },
  },
} satisfies Prisma.CashSessionInclude;
type SessionRow = Prisma.CashSessionGetPayload<{ include: typeof SESSION_INCLUDE }>;

const invalid = (message: string) =>
  new AppException('VALIDATION_ERROR', message, HttpStatus.UNPROCESSABLE_ENTITY);
const conflict = (message: string) => new AppException('CONFLICT', message, HttpStatus.CONFLICT);

export function toSessionView(s: SessionRow): CashSessionView {
  const totalIn = s.operations
    .filter((o) => o.direction === 'IN')
    .reduce((a, o) => a + o.amount, 0);
  const totalOut = s.operations
    .filter((o) => o.direction === 'OUT')
    .reduce((a, o) => a + o.amount, 0);
  return {
    id: s.id,
    status: s.status,
    openedAt: s.openedAt.toISOString(),
    openedBy: s.openedBy,
    openingAmount: s.openingAmount,
    totalIn,
    totalOut,
    expectedAmount: s.expectedAmount ?? s.openingAmount + totalIn - totalOut,
    countedAmount: s.countedAmount,
    difference: s.difference,
    closedAt: s.closedAt?.toISOString() ?? null,
    closedBy: s.closedBy,
    operations: s.operations.map((o) => ({
      id: o.id,
      at: o.at.toISOString(),
      direction: o.direction,
      category: o.category as CashSessionView['operations'][number]['category'],
      amount: o.amount,
      label: o.label,
      by: o.by,
    })),
  };
}

/**
 * Caisse : une par site ; sessions ouvertes / clôturées avec écart théorique / compté.
 * Chaque opération écrit aussi CASH_IN / CASH_OUT au grand livre.
 */
@Injectable()
export class CashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  /** Sites accessibles : le site du caissier (ou son île), tous pour les rôles globaux. */
  private siteScope(actor: AuthUser): Prisma.SiteWhereInput {
    if (ROLE_SCOPE[actor.role] === 'GLOBAL') return {};
    if (actor.siteId) return { id: actor.siteId };
    return { islandId: actor.islandId ?? '-' };
  }

  private async site(actor: AuthUser, siteId: string) {
    const site = await this.prisma.site.findFirst({
      where: { AND: [{ id: siteId, isActive: true }, this.siteScope(actor)] },
    });
    if (!site) throw notFound('Site');
    return site;
  }

  private async register(db: Tx | PrismaService, siteId: string) {
    return db.cashRegister.upsert({ where: { siteId }, update: {}, create: { siteId } });
  }

  async registers(actor: AuthUser): Promise<CashRegisterView[]> {
    const sites = await this.prisma.site.findMany({
      where: { AND: [{ isActive: true }, this.siteScope(actor)] },
      include: { island: { select: { id: true, code: true, name: true } } },
      orderBy: { name: 'asc' },
    });
    return Promise.all(
      sites.map(async (site) => {
        const reg = await this.prisma.cashRegister.findUnique({ where: { siteId: site.id } });
        const [current, last] = reg
          ? await Promise.all([
              this.prisma.cashSession.findFirst({
                where: { registerId: reg.id, status: 'OPEN' },
                include: SESSION_INCLUDE,
              }),
              this.prisma.cashSession.findFirst({
                where: { registerId: reg.id, status: 'CLOSED' },
                include: SESSION_INCLUDE,
                orderBy: { closedAt: 'desc' },
              }),
            ])
          : [null, null];
        return {
          site: { id: site.id, name: site.name, island: site.island },
          current: current ? toSessionView(current) : null,
          last: last ? toSessionView(last) : null,
        };
      }),
    );
  }

  async open(siteId: string, openingAmount: number, actor: AuthUser): Promise<CashSessionView> {
    await this.site(actor, siteId);
    const reg = await this.register(this.prisma, siteId);
    const open = await this.prisma.cashSession.findFirst({
      where: { registerId: reg.id, status: 'OPEN' },
    });
    if (open) throw conflict('La caisse de ce site est déjà ouverte');
    const session = await this.prisma.cashSession.create({
      data: { registerId: reg.id, openedById: actor.id, openingAmount },
      include: SESSION_INCLUDE,
    });
    return toSessionView(session);
  }

  /** Enregistre une opération dans la session ouverte du site (et l'écriture CASH_IN / CASH_OUT). */
  async operation(
    siteId: string,
    input: CashOperationInput,
    actor: AuthUser,
  ): Promise<CashSessionView> {
    const site = await this.site(actor, siteId);
    const sessionId = await this.prisma.$transaction(async (tx) => {
      if (input.category === 'COURIER_REMITTANCE') return this.remittance(tx, site, input, actor);
      if (input.category === 'EXPENSE_PAYMENT') {
        if (!input.expenseId) throw invalid('Choisis la dépense payée');
        const expense = await tx.expense.findUnique({ where: { id: input.expenseId } });
        if (!expense || expense.status !== 'APPROVED')
          throw invalid('Seule une dépense validée peut être payée');
      }
      return this.recordInTx(tx, actor, { ...input, siteId: site.id, islandId: site.islandId });
    });
    return this.session(sessionId);
  }

  /** Remise d'argent par un livreur : commandes choisies, montant = somme encaissée. */
  private async remittance(
    tx: Tx,
    site: { id: string; islandId: string },
    input: CashOperationInput,
    actor: AuthUser,
  ) {
    if (!input.courierId || !input.orderIds?.length)
      throw invalid('Choisis le livreur et les commandes concernées');
    const orders = await tx.order.findMany({
      where: {
        id: { in: input.orderIds },
        courierId: input.courierId,
        islandId: site.islandId,
        amountCollected: { not: null },
        remittedAt: null,
      },
    });
    if (orders.length !== input.orderIds.length)
      throw invalid('Commande inconnue, déjà remise ou d’un autre livreur');
    const total = orders.reduce((s, o) => s + (o.amountCollected ?? 0), 0);
    if (total !== input.amount)
      throw invalid(`Le montant doit correspondre aux commandes choisies (${total} KMF)`);
    const courier = await tx.user.findUniqueOrThrow({ where: { id: input.courierId } });
    const sessionId = await this.recordInTx(tx, actor, {
      ...input,
      direction: 'IN',
      label:
        input.label ?? `Remise ${courier.fullName} : ${orders.map((o) => o.number).join(', ')}`,
      siteId: site.id,
      islandId: site.islandId,
    });
    const op = await tx.cashOperation.findFirstOrThrow({
      where: { sessionId },
      orderBy: { at: 'desc' },
    });
    const { count } = await tx.order.updateMany({
      where: { id: { in: input.orderIds }, remittedAt: null },
      data: { remittedAt: new Date(), remittanceOperationId: op.id },
    });
    if (count !== orders.length) throw conflict('Ces commandes viennent d’être remises');
    return sessionId;
  }

  /**
   * Opération dans une transaction existante (paiement de règlement, dépense, remise).
   * Sans `siteId`, prend la session ouverte du site de l'agent ou d'un site de l'île.
   */
  async recordInTx(
    tx: Tx,
    actor: AuthUser,
    input: CashOperationInput & { siteId?: string; islandId: string; settlementId?: string },
  ): Promise<string> {
    const siteFilter: Prisma.SiteWhereInput = input.siteId
      ? { id: input.siteId }
      : actor.siteId
        ? { id: actor.siteId }
        : { islandId: input.islandId };
    const session = await tx.cashSession.findFirst({
      where: { status: 'OPEN', register: { site: siteFilter } },
      include: { operations: true, register: { include: { site: true } } },
      orderBy: { openedAt: 'asc' },
    });
    if (!session)
      throw conflict('Aucune caisse ouverte sur ce site : ouvre la caisse avant l’opération');
    if (input.direction === 'OUT') {
      const balance =
        session.openingAmount +
        session.operations.reduce((s, o) => s + (o.direction === 'IN' ? o.amount : -o.amount), 0);
      if (balance < input.amount) throw conflict(`Fonds insuffisants en caisse (${balance} KMF)`);
    }
    const op = await tx.cashOperation.create({
      data: {
        sessionId: session.id,
        direction: input.direction,
        category: input.category,
        amount: input.amount,
        label: input.label,
        orderIds: input.orderIds ?? [],
        courierId: input.courierId,
        expenseId: input.expenseId,
        sellerId: input.sellerId,
        settlementId: input.settlementId,
        byId: actor.id,
      },
    });
    await tx.ledgerEntry.create({
      data: {
        type: input.direction === 'IN' ? 'CASH_IN' : 'CASH_OUT',
        amount: input.amount,
        islandId: session.register.site.islandId,
        cashOperationId: op.id,
        expenseId: input.expenseId,
        settlementId: input.settlementId,
        beneficiaryId: input.sellerId ?? input.courierId,
        periodDate: startOfBusinessDay(businessToday()),
        byId: actor.id,
      },
    });
    return session.id;
  }

  async close(
    siteId: string,
    countedAmount: number,
    note: string | undefined,
    actor: AuthUser,
  ): Promise<CashSessionView> {
    const site = await this.site(actor, siteId);
    const reg = await this.register(this.prisma, siteId);
    const session = await this.prisma.cashSession.findFirst({
      where: { registerId: reg.id, status: 'OPEN' },
      include: SESSION_INCLUDE,
    });
    if (!session) throw conflict('Aucune caisse ouverte sur ce site');
    const view = toSessionView(session);
    const difference = countedAmount - view.expectedAmount;
    const { count } = await this.prisma.cashSession.updateMany({
      where: { id: session.id, status: 'OPEN' },
      data: {
        status: 'CLOSED',
        expectedAmount: view.expectedAmount,
        countedAmount,
        difference,
        closingNote: note,
        closedById: actor.id,
        closedAt: new Date(),
      },
    });
    if (count === 0) throw conflict('Cette caisse vient d’être clôturée');
    if (difference !== 0) {
      const users = await this.notifications.usersWithRoles([
        'FINANCE_MANAGER',
        'ADMIN',
        'ACCOUNTANT',
      ]);
      await this.notifications.send(users, {
        type: 'CASH_DIFFERENCE',
        title: `Écart de caisse ${site.name} : ${difference > 0 ? '+' : ''}${difference} KMF`,
        body: `Attendu ${view.expectedAmount} KMF, compté ${countedAmount} KMF`,
        link: '/caisse',
      });
    }
    return this.session(session.id);
  }

  async pendingRemittances(siteId: string, actor: AuthUser): Promise<PendingRemittance[]> {
    const site = await this.site(actor, siteId);
    const orders = await this.prisma.order.findMany({
      where: {
        islandId: site.islandId,
        amountCollected: { gt: 0 },
        remittedAt: null,
        courierId: { not: null },
      },
      include: { courier: { select: { id: true, fullName: true } } },
      orderBy: { handedOverAt: 'asc' },
    });
    const map = new Map<string, PendingRemittance>();
    for (const o of orders) {
      const c = map.get(o.courierId!) ?? { courier: o.courier!, orders: [], total: 0 };
      c.orders.push({
        id: o.id,
        number: o.number,
        amountCollected: o.amountCollected!,
        handedOverAt: (o.handedOverAt ?? o.updatedAt).toISOString(),
      });
      c.total += o.amountCollected!;
      map.set(o.courierId!, c);
    }
    return [...map.values()];
  }

  private async session(id: string) {
    return toSessionView(
      await this.prisma.cashSession.findUniqueOrThrow({ where: { id }, include: SESSION_INCLUDE }),
    );
  }
}
