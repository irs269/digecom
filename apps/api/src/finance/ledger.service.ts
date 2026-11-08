import { Global, HttpStatus, Injectable, Module } from '@nestjs/common';
import { businessToday, startOfBusinessDay, toBusinessDay, type LedgerType } from '@digecom/shared';
import { Prisma } from '@prisma/client';
import { AppException } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

/** Types d'écritures produites par une vente (et corrigées par un retour après vente). */
export const SALE_TYPES: LedgerType[] = [
  'SALE_REVENUE',
  'COGS',
  'DIGECOM_TAX',
  'SELLER_TAX',
  'SELLER_COMMISSION',
  'TCI_BONUS',
  'COURIER_FEE',
];

/** Jour métier (00:00 heure des Comores) d'un instant. */
export const businessDayOf = (at: Date) => startOfBusinessDay(toBusinessDay(at));

/**
 * Grand livre (append-only, trigger en base). Une écriture ne se modifie jamais : une erreur se
 * corrige par une écriture inverse liée (`reversalOfId`) avec justification (règle 2).
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Écritures d'une vente au passage en SOLD, dans la transaction de la transition (règle 5) :
   * CA, coût FIFO figé, taxes, commission e-commerçant ou prime TCI, frais de course.
   */
  async recordSale(tx: Tx, orderId: string, byId: string, at: Date = new Date()): Promise<void> {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });
    const sum = (f: (i: (typeof order.items)[number]) => number) =>
      order.items.reduce((s, i) => s + f(i), 0);
    const missingCost = order.items.find((i) => i.unitCost === null);
    if (missingCost) {
      throw new AppException(
        'COST_MISSING',
        'Coût d’approvisionnement absent : la commande n’est pas sortie du stock',
        HttpStatus.CONFLICT,
      );
    }
    const base = {
      orderId,
      islandId: order.islandId,
      leaderId: order.leaderId,
      campaignId: order.campaignId,
      periodDate: businessDayOf(at),
      byId,
    };
    const tci = order.sellerType === 'TELECONSULTANT';
    const rows: Prisma.LedgerEntryCreateManyInput[] = [
      { ...base, type: 'SALE_REVENUE', amount: sum((i) => i.unitPrice * i.quantity) },
      { ...base, type: 'COGS', amount: sum((i) => i.unitCost! * i.quantity) },
      { ...base, type: 'DIGECOM_TAX', amount: sum((i) => i.digecomTax * i.quantity) },
    ];
    if (tci) {
      rows.push({
        ...base,
        type: 'TCI_BONUS',
        amount: sum((i) => (i.tciBonus ?? 0) * i.quantity),
        beneficiaryId: order.sellerId,
      });
    } else {
      rows.push(
        {
          ...base,
          type: 'SELLER_COMMISSION',
          amount: sum((i) => (i.sellerShare ?? 0) * i.quantity),
          beneficiaryId: order.sellerId,
        },
        {
          ...base,
          type: 'SELLER_TAX',
          amount: sum((i) => i.sellerTax * i.quantity),
          beneficiaryId: order.sellerId,
        },
      );
    }
    if (order.courierId && order.courierFee) {
      rows.push({
        ...base,
        type: 'COURIER_FEE',
        amount: order.courierFee,
        beneficiaryId: order.courierId,
      });
    }
    await tx.ledgerEntry.createMany({ data: rows });
  }

  /** Retour après vente : écritures inverses liées et justifiées pour chaque écriture de la vente. */
  async reverseOrder(
    tx: Tx,
    orderId: string,
    byId: string,
    justification: string,
  ): Promise<number> {
    const entries = await tx.ledgerEntry.findMany({
      where: { orderId, type: { in: SALE_TYPES }, reversalOfId: null, reversedBy: null },
    });
    for (const e of entries) await this.reverse(tx, e, byId, justification);
    return entries.length;
  }

  async reverse(
    tx: Tx,
    entry: {
      id: string;
      type: LedgerType;
      amount: number;
      orderId: string | null;
      beneficiaryId: string | null;
      islandId: string;
      leaderId: string | null;
      campaignId: string | null;
      expenseId?: string | null;
    },
    byId: string,
    justification: string,
  ) {
    if (justification.trim().length < 3) {
      throw new AppException(
        'VALIDATION_ERROR',
        'Justification obligatoire',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return tx.ledgerEntry.create({
      data: {
        type: entry.type,
        amount: -entry.amount,
        orderId: entry.orderId,
        beneficiaryId: entry.beneficiaryId,
        islandId: entry.islandId,
        leaderId: entry.leaderId,
        campaignId: entry.campaignId,
        expenseId: entry.expenseId ?? null,
        periodDate: startOfBusinessDay(businessToday()),
        reversalOfId: entry.id,
        justification,
        byId,
      },
    });
  }

  /** Paiement fournisseur enregistré à la réception du lot (une seule fois, index unique). */
  async supplierPayment(
    tx: Tx,
    input: { purchaseOrderId: string; amount: number; islandId: string; at: Date; byId: string },
  ) {
    await tx.ledgerEntry.create({
      data: {
        type: 'SUPPLIER_PAYMENT',
        amount: input.amount,
        purchaseOrderId: input.purchaseOrderId,
        islandId: input.islandId,
        periodDate: businessDayOf(input.at),
        byId: input.byId,
      },
    });
  }

  /**
   * Abonnements d'une semaine (lundi) pour tous les e-commerçants actifs. Idempotent : l'index
   * unique (bénéficiaire, semaine) fait ignorer les écritures déjà présentes.
   */
  async chargeSubscriptions(week: string, amount: number): Promise<number> {
    const sellers = await this.prisma.user.findMany({
      where: {
        role: 'SELLER',
        isActive: true,
        islandId: { not: null },
        createdAt: { lt: startOfBusinessDay(week) },
      },
      select: { id: true, islandId: true, leaderId: true },
    });
    if (!sellers.length || amount <= 0) return 0;
    const { count } = await this.prisma.ledgerEntry.createMany({
      data: sellers.map((s) => ({
        type: 'SUBSCRIPTION' as const,
        amount,
        beneficiaryId: s.id,
        islandId: s.islandId!,
        leaderId: s.leaderId,
        periodDate: startOfBusinessDay(week),
      })),
      skipDuplicates: true,
    });
    return count;
  }

  /** E-commerçants débités de l'abonnement d'une semaine (lundi). */
  async subscribersOf(week: string): Promise<string[]> {
    const rows = await this.prisma.ledgerEntry.findMany({
      where: { type: 'SUBSCRIPTION', periodDate: startOfBusinessDay(week), amount: { gt: 0 } },
      select: { beneficiaryId: true },
    });
    return rows.map((r) => r.beneficiaryId!).filter(Boolean);
  }
}

@Global()
@Module({ providers: [LedgerService], exports: [LedgerService] })
export class LedgerModule {}
