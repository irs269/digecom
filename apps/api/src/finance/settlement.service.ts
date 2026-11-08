import { HttpStatus, Injectable } from '@nestjs/common';
import {
  addDays,
  businessToday,
  computeSettlement,
  LEDGER_TYPE_LABELS,
  ROLE_SCOPE,
  SETTLEMENT_NEXT_STEP,
  settlementCycle,
  startOfBusinessDay,
  toBusinessDay,
  type SettlementListQuery,
  type SettlementPayInput,
  type SettlementView,
} from '@digecom/shared';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { notFound } from '../scope/scope.service';
import { SettingsService } from '../settings/settings.service';
import { CounterService } from '../stock/counter.service';
import { CashService } from './cash.service';

const INCLUDE = {
  seller: { select: { id: true, fullName: true, phone: true } },
  island: { select: { id: true, code: true, name: true } },
  verifiedBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } },
  paidBy: { select: { id: true, fullName: true } },
} satisfies Prisma.SettlementInclude;

type Row = Prisma.SettlementGetPayload<{ include: typeof INCLUDE }>;

const SETTLED_TYPES = ['SELLER_COMMISSION', 'SELLER_TAX', 'SUBSCRIPTION'] as const;

const forbidden = (message: string) => new AppException('FORBIDDEN', message, HttpStatus.FORBIDDEN);
const conflict = (message: string) =>
  new AppException('INVALID_TRANSITION', message, HttpStatus.CONFLICT);

/**
 * Règlements des e-commerçants (SPEC 4.2) : génération idempotente par cycle de 14 jours, puis
 * vérifier (comptable) → valider (responsable financier, jamais le vérificateur) → payer
 * (caissier de l'île du vendeur). Chaque étape est tracée séparément (règle 10).
 */
@Injectable()
export class SettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly counters: CounterService,
    private readonly cash: CashService,
    private readonly notifications: NotificationService,
  ) {}

  // --- Génération -------------------------------------------------------------------------

  /** Cycle terminé le plus récent à la date `today` (jour métier). */
  async lastClosedCycle(today = businessToday()) {
    const [anchor, days] = await Promise.all([
      this.settings.get('settlement.anchorDate'),
      this.settings.get('settlement.cycleDays'),
    ]);
    const current = settlementCycle(anchor, days, today);
    return { start: addDays(current.start, -days), end: current.start };
  }

  /** Génère les relevés manquants du dernier cycle terminé (job quotidien). */
  async generateDue(today = businessToday()) {
    const cycle = await this.lastClosedCycle(today);
    return this.generateForCycle(cycle.start, cycle.end);
  }

  /**
   * Un relevé par e-commerçant pour le cycle [start, end[ : écritures non encore réglées
   * (commissions, taxes, abonnements, corrections) jusqu'à la fin du cycle + report négatif.
   * Idempotent : un vendeur déjà réglé pour ce cycle est ignoré (unique vendeur + début).
   */
  async generateForCycle(
    start: string,
    end: string,
  ): Promise<{ created: number; skipped: number }> {
    const periodStart = startOfBusinessDay(start);
    const periodEnd = startOfBusinessDay(end);
    const entries = await this.prisma.ledgerEntry.findMany({
      where: {
        type: { in: [...SETTLED_TYPES] },
        beneficiaryId: { not: null },
        periodDate: { lt: periodEnd },
        lines: { none: {} },
        beneficiary: { role: 'SELLER' },
      },
      orderBy: { periodDate: 'asc' },
    });
    const bySeller = new Map<string, typeof entries>();
    for (const e of entries)
      bySeller.set(e.beneficiaryId!, [...(bySeller.get(e.beneficiaryId!) ?? []), e]);

    let created = 0;
    let skipped = 0;
    for (const [sellerId, list] of bySeller) {
      const exists = await this.prisma.settlement.findUnique({
        where: { sellerId_periodStart: { sellerId, periodStart } },
      });
      if (exists) {
        skipped += 1;
        continue;
      }
      const seller = await this.prisma.user.findUniqueOrThrow({ where: { id: sellerId } });
      const previous = await this.prisma.settlement.findFirst({
        where: { sellerId, periodStart: { lt: periodStart } },
        orderBy: { periodStart: 'desc' },
      });
      const taxes = new Map<string, number>();
      for (const t of list.filter((e) => e.type === 'SELLER_TAX')) {
        const key = `${t.orderId}|${Math.sign(t.amount)}`;
        taxes.set(key, (taxes.get(key) ?? 0) + t.amount);
      }
      const breakdown = computeSettlement({
        sales: list
          .filter((e) => e.type === 'SELLER_COMMISSION')
          .map((c) => ({
            commission: c.amount,
            sellerTax: taxes.get(`${c.orderId}|${Math.sign(c.amount)}`) ?? 0,
          })),
        subscriptions: list.filter((e) => e.type === 'SUBSCRIPTION').map((s) => s.amount),
        otherDeductions: 0,
        carriedOver: previous && previous.balance < 0 ? previous.balance : 0,
      });
      // Taxes sans commission (cas marginal) : comptées quand même.
      const allTaxes = list
        .filter((e) => e.type === 'SELLER_TAX')
        .reduce((s, e) => s + e.amount, 0);
      const balance = breakdown.balance - (allTaxes - breakdown.taxes);
      try {
        await this.prisma.$transaction(async (tx) => {
          const number = await this.counters.formatted('SETTLEMENT', 'REL-', 6, tx);
          await tx.settlement.create({
            data: {
              number,
              sellerId,
              islandId: seller.islandId!,
              periodStart,
              periodEnd,
              salesCount: breakdown.salesCount,
              grossCommission: breakdown.grossCommission,
              taxes: allTaxes,
              subscriptions: breakdown.subscriptions,
              otherDeductions: 0,
              carriedOver: breakdown.carriedOver,
              balance,
              netToPay: Math.max(balance, 0),
              lines: { create: list.map((e) => ({ ledgerEntryId: e.id })) },
            },
          });
        });
        created += 1;
        await this.notifications.send([sellerId], {
          type: 'SETTLEMENT_AVAILABLE',
          title: 'Relevé disponible',
          body: `Cycle du ${start} : ${Math.max(balance, 0).toLocaleString('fr-FR')} KMF à recevoir`,
          link: '/reglements',
        });
      } catch (err) {
        // Génération concurrente : l'autre instance a déjà créé le relevé.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
          skipped += 1;
        else throw err;
      }
    }
    if (created) {
      const accountants = await this.notifications.usersWithRoles([
        'ACCOUNTANT',
        'FINANCE_MANAGER',
      ]);
      await this.notifications.send(accountants, {
        type: 'SETTLEMENTS_GENERATED',
        title: `${created} relevé(s) du ${start} au ${addDays(end, -1)}`,
        body: 'À vérifier',
        link: '/reglements',
      });
    }
    return { created, skipped };
  }

  // --- Lecture ---------------------------------------------------------------------------

  private scope(actor: AuthUser): Prisma.SettlementWhereInput {
    if (actor.role === 'SELLER') return { sellerId: actor.id };
    if (ROLE_SCOPE[actor.role] === 'GLOBAL') return {};
    return { islandId: actor.islandId ?? '-' };
  }

  async list(q: SettlementListQuery, actor: AuthUser): Promise<SettlementView[]> {
    const rows = await this.prisma.settlement.findMany({
      where: {
        AND: [
          this.scope(actor),
          {
            status: q.status,
            islandId: q.islandId,
            sellerId: q.sellerId,
            periodStart: q.periodStart ? startOfBusinessDay(q.periodStart) : undefined,
          },
        ],
      },
      include: INCLUDE,
      orderBy: [{ periodStart: 'desc' }, { seller: { fullName: 'asc' } }],
      take: 300,
    });
    return rows.map((r) => this.toView(r, actor));
  }

  async get(id: string, actor: AuthUser): Promise<SettlementView> {
    const row = await this.prisma.settlement.findFirst({
      where: { AND: [{ id }, this.scope(actor)] },
      include: INCLUDE,
    });
    if (!row) throw notFound('Relevé');
    const lines = await this.prisma.settlementLine.findMany({
      where: { settlementId: id },
      include: { ledgerEntry: { include: { order: { select: { number: true } } } } },
      orderBy: { ledgerEntry: { periodDate: 'asc' } },
    });
    return {
      ...this.toView(row, actor),
      lines: lines.map((l) => ({
        id: l.ledgerEntry.id,
        type: l.ledgerEntry.type,
        amount: l.ledgerEntry.amount,
        periodDate: toBusinessDay(l.ledgerEntry.periodDate),
        orderNumber: l.ledgerEntry.order?.number ?? null,
        label: `${LEDGER_TYPE_LABELS[l.ledgerEntry.type]}${l.ledgerEntry.reversalOfId ? ' (correction)' : ''}`,
      })),
    };
  }

  // --- Circuit ----------------------------------------------------------------------------

  async verify(id: string, actor: AuthUser) {
    const s = await this.load(id, actor);
    if (s.status !== 'GENERATED') throw conflict('Ce relevé n’est pas à vérifier');
    return this.step(
      s,
      'GENERATED',
      { status: 'VERIFIED', verifiedById: actor.id, verifiedAt: new Date() },
      actor,
      'SETTLEMENT_VERIFIED',
      ['FINANCE_MANAGER'],
    );
  }

  async approve(id: string, actor: AuthUser) {
    const s = await this.load(id, actor);
    if (s.status !== 'VERIFIED') throw conflict('Ce relevé n’est pas vérifié');
    // Séparation des tâches : celui qui a vérifié ne valide pas (y compris l'administrateur).
    if (s.verifiedById === actor.id)
      throw forbidden('Tu as vérifié ce relevé : un autre responsable doit le valider');
    return this.step(
      s,
      'VERIFIED',
      { status: 'APPROVED', approvedById: actor.id, approvedAt: new Date() },
      actor,
      'SETTLEMENT_APPROVED',
      ['CASHIER'],
      s.sellerId,
    );
  }

  async pay(id: string, input: SettlementPayInput, actor: AuthUser) {
    const s = await this.load(id, actor);
    if (s.status !== 'APPROVED') throw conflict('Ce relevé n’est pas validé');
    if (actor.role !== 'ADMIN' && (s.verifiedById === actor.id || s.approvedById === actor.id)) {
      throw forbidden('Tu as déjà fait une étape de ce relevé : un autre agent doit payer');
    }
    if (actor.role === 'CASHIER' && actor.islandId !== s.islandId) throw notFound('Relevé');
    const methods = await this.settings.get('payment.methods');
    if (!methods.includes(input.paymentMethod)) {
      throw new AppException(
        'VALIDATION_ERROR',
        'Moyen de paiement non accepté',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.settlement.updateMany({
        where: { id, status: 'APPROVED' },
        data: {
          status: 'PAID',
          paidById: actor.id,
          paidAt: now,
          paymentMethod: input.paymentMethod,
          paymentRef: input.paymentRef,
          proofKey: input.proofKey,
        },
      });
      if (count === 0) throw conflict('Ce relevé vient d’être payé');
      if (s.netToPay > 0) {
        await tx.ledgerEntry.create({
          data: {
            type: 'SETTLEMENT_PAYMENT',
            amount: s.netToPay,
            beneficiaryId: s.sellerId,
            islandId: s.islandId,
            settlementId: id,
            periodDate: startOfBusinessDay(businessToday()),
            byId: actor.id,
          },
        });
        if (input.paymentMethod === 'CASH') {
          await this.cash.recordInTx(tx, actor, {
            direction: 'OUT',
            category: 'SETTLEMENT_PAYMENT',
            amount: s.netToPay,
            label: `Règlement ${s.number} – ${s.seller.fullName}`,
            sellerId: s.sellerId,
            settlementId: id,
            islandId: s.islandId,
          });
        }
      }
    });
    await this.notifications.send(
      [s.sellerId, ...(await this.notifications.usersWithRoles(['FINANCE_MANAGER']))],
      {
        type: 'SETTLEMENT_PAID',
        title: `Règlement ${s.number} payé`,
        body: `${s.netToPay.toLocaleString('fr-FR')} KMF`,
        link: '/reglements',
      },
    );
    return this.get(id, actor);
  }

  private async load(id: string, actor: AuthUser): Promise<Row> {
    const row = await this.prisma.settlement.findFirst({
      where: { AND: [{ id }, this.scope(actor)] },
      include: INCLUDE,
    });
    if (!row) throw notFound('Relevé');
    return row;
  }

  private async step(
    s: Row,
    from: 'GENERATED' | 'VERIFIED',
    data: Prisma.SettlementUpdateManyMutationInput & {
      verifiedById?: string;
      approvedById?: string;
    },
    actor: AuthUser,
    type: string,
    notifyRoles: ('FINANCE_MANAGER' | 'CASHIER')[],
    sellerId?: string,
  ) {
    const { count } = await this.prisma.settlement.updateMany({
      where: { id: s.id, status: from },
      data,
    });
    if (count === 0) throw conflict('Ce relevé vient de changer d’état');
    const users = await this.notifications.usersWithRoles(
      notifyRoles,
      notifyRoles.includes('CASHIER') ? s.islandId : undefined,
    );
    await this.notifications.send([...users, ...(sellerId ? [sellerId] : [])], {
      type,
      title: `Relevé ${s.number} ${type === 'SETTLEMENT_VERIFIED' ? 'vérifié' : 'validé'}`,
      body: `${s.seller.fullName} · ${s.netToPay.toLocaleString('fr-FR')} KMF`,
      link: '/reglements',
    });
    return this.get(s.id, actor);
  }

  private toView(r: Row, actor: AuthUser): SettlementView {
    let nextAction: SettlementView['nextAction'] = null;
    let waitingFor: string | null = null;
    if (r.status !== 'PAID') {
      const step = SETTLEMENT_NEXT_STEP[r.status];
      const allowed =
        actor.role === 'ADMIN' ||
        (step.role === actor.role && (step.action !== 'pay' || actor.islandId === r.islandId));
      const sameAsVerifier = step.action === 'approve' && r.verifiedById === actor.id;
      if (allowed && !sameAsVerifier) nextAction = step.action;
      else
        waitingFor = {
          verify: 'le comptable',
          approve: 'le responsable financier',
          pay: 'le caissier de l’île',
        }[step.action];
    }
    return {
      id: r.id,
      number: r.number,
      seller: r.seller,
      island: r.island,
      periodStart: toBusinessDay(r.periodStart),
      periodEnd: addDays(toBusinessDay(r.periodEnd), -1),
      salesCount: r.salesCount,
      grossCommission: r.grossCommission,
      taxes: r.taxes,
      subscriptions: r.subscriptions,
      otherDeductions: r.otherDeductions,
      carriedOver: r.carriedOver,
      balance: r.balance,
      netToPay: r.netToPay,
      status: r.status,
      verifiedBy: r.verifiedBy,
      verifiedAt: r.verifiedAt?.toISOString() ?? null,
      approvedBy: r.approvedBy,
      approvedAt: r.approvedAt?.toISOString() ?? null,
      paidBy: r.paidBy,
      paidAt: r.paidAt?.toISOString() ?? null,
      paymentMethod: r.paymentMethod,
      paymentRef: r.paymentRef,
      nextAction,
      waitingFor,
    };
  }
}
