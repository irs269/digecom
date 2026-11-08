import { HttpStatus, Injectable } from '@nestjs/common';
import {
  computeSale,
  endOfBusinessDay,
  startOfBusinessDay,
  toBusinessDay,
  type ExpenseInput,
  type ExpenseView,
  type NetResult,
} from '@digecom/shared';
import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { notFound } from '../scope/scope.service';
import { BUCKETS, StorageService } from '../storage/storage.service';
import { LedgerService } from './ledger.service';

const INCLUDE = {
  island: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } },
  leader: { select: { id: true, fullName: true } },
} satisfies Prisma.ExpenseInclude;
type Row = Prisma.ExpenseGetPayload<{ include: typeof INCLUDE }>;

const forbidden = (m: string) => new AppException('FORBIDDEN', m, HttpStatus.FORBIDDEN);
const conflict = (m: string) => new AppException('CONFLICT', m, HttpStatus.CONFLICT);

/**
 * Dépenses : saisie → validation par le responsable financier (jamais sa propre saisie) →
 * écriture EXPENSE. Une dépense validée ne se modifie plus : elle s'annule par écriture inverse.
 */
@Injectable()
export class ExpenseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationService,
  ) {}

  async list(
    actor: AuthUser,
    q: { status?: string; islandId?: string; from?: string; to?: string },
  ): Promise<ExpenseView[]> {
    const rows = await this.prisma.expense.findMany({
      where: {
        status: q.status as Row['status'] | undefined,
        islandId: q.islandId,
        periodDate:
          q.from || q.to
            ? {
                gte: q.from ? startOfBusinessDay(q.from) : undefined,
                lte: q.to ? endOfBusinessDay(q.to) : undefined,
              }
            : undefined,
      },
      include: INCLUDE,
      orderBy: [{ periodDate: 'desc' }, { createdAt: 'desc' }],
      take: 300,
    });
    const reversed = new Set(
      (
        await this.prisma.ledgerEntry.findMany({
          where: {
            type: 'EXPENSE',
            reversalOfId: { not: null },
            expenseId: { in: rows.map((r) => r.id) },
          },
          select: { expenseId: true },
        })
      ).map((e) => e.expenseId),
    );
    return Promise.all(rows.map((r) => this.toView(r, actor, reversed.has(r.id))));
  }

  async create(input: ExpenseInput, actor: AuthUser): Promise<ExpenseView> {
    if (!(await this.prisma.island.findUnique({ where: { id: input.islandId } }))) {
      throw new AppException('VALIDATION_ERROR', 'Île inconnue', HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const proofKey = input.proofKey
      ? await this.storage.finalizeImage(BUCKETS.documents, input.proofKey, 'expenses')
      : undefined;
    const row = await this.prisma.expense.create({
      data: {
        category: input.category,
        label: input.label,
        amount: input.amount,
        islandId: input.islandId,
        periodDate: startOfBusinessDay(input.periodDate),
        campaignId: input.campaignId,
        leaderId: input.leaderId,
        proofKey,
        createdById: actor.id,
      },
      include: INCLUDE,
    });
    const approvers = await this.notifications.usersWithRoles(['FINANCE_MANAGER']);
    await this.notifications.send(
      approvers.filter((u) => u !== actor.id),
      {
        type: 'EXPENSE_PENDING',
        title: `Dépense à valider : ${row.label}`,
        body: `${row.amount.toLocaleString('fr-FR')} KMF · ${row.island.name}`,
        link: '/depenses',
      },
    );
    return this.toView(row, actor, false);
  }

  async approve(id: string, actor: AuthUser): Promise<ExpenseView> {
    const e = await this.load(id);
    if (e.status !== 'PENDING') throw conflict('Cette dépense a déjà été traitée');
    if (e.createdById === actor.id) throw forbidden('Tu ne peux pas valider ta propre saisie');
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.expense.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'APPROVED', approvedById: actor.id, approvedAt: new Date() },
      });
      if (count === 0) throw conflict('Cette dépense vient d’être traitée');
      await tx.ledgerEntry.create({
        data: {
          type: 'EXPENSE',
          amount: e.amount,
          expenseId: id,
          islandId: e.islandId,
          leaderId: e.leaderId,
          campaignId: e.campaignId,
          periodDate: e.periodDate,
          byId: actor.id,
        },
      });
    });
    return this.toView(await this.load(id), actor, false);
  }

  async reject(id: string, reason: string, actor: AuthUser): Promise<ExpenseView> {
    const e = await this.load(id);
    if (e.status !== 'PENDING') throw conflict('Cette dépense a déjà été traitée');
    if (e.createdById === actor.id) throw forbidden('Tu ne peux pas traiter ta propre saisie');
    await this.prisma.expense.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectReason: reason,
        approvedById: actor.id,
        approvedAt: new Date(),
      },
    });
    return this.toView(await this.load(id), actor, false);
  }

  /** Annulation d'une dépense validée : écriture inverse justifiée (jamais de modification). */
  async reverse(id: string, justification: string, actor: AuthUser): Promise<ExpenseView> {
    const e = await this.load(id);
    if (e.status !== 'APPROVED')
      throw conflict('Seule une dépense validée se corrige par écriture inverse');
    const entry = await this.prisma.ledgerEntry.findFirst({
      where: { type: 'EXPENSE', expenseId: id, reversalOfId: null },
      include: { reversedBy: true },
    });
    if (!entry || entry.reversedBy) throw conflict('Cette dépense est déjà annulée');
    await this.prisma.$transaction((tx) => this.ledger.reverse(tx, entry, actor.id, justification));
    return this.toView(await this.load(id), actor, true);
  }

  /** Résultat net (SPEC 4.4 §8) : marge après coût et taxes − frais de course − charges validées. */
  async result(from: string, to: string, islandId?: string): Promise<NetResult> {
    const where = {
      periodDate: { gte: startOfBusinessDay(from), lte: endOfBusinessDay(to) },
      islandId,
    };
    const sums = await this.prisma.ledgerEntry.groupBy({
      by: ['type'],
      where,
      _sum: { amount: true },
    });
    const get = (t: string) => sums.find((s) => s.type === t)?._sum.amount ?? 0;
    const revenue = get('SALE_REVENUE');
    const sellerPart = get('SELLER_COMMISSION') + get('TCI_BONUS');
    const sale = computeSale({
      price: revenue,
      sellerShare: sellerPart,
      unitCost: get('COGS'),
      digecomTax: get('DIGECOM_TAX'),
      sellerTax: get('SELLER_TAX'),
    });
    const pendingExpenses = await this.prisma.expense.aggregate({
      where: {
        status: 'PENDING',
        islandId,
        periodDate: { gte: startOfBusinessDay(from), lte: endOfBusinessDay(to) },
      },
      _sum: { amount: true },
    });
    const courierFees = get('COURIER_FEE');
    const expenses = get('EXPENSE');
    return {
      from,
      to,
      islandId: islandId ?? null,
      revenue,
      digecomShare: sale.digecomShare,
      cost: sale.cost,
      digecomTax: sale.digecomTax,
      marginAfterTax: sale.marginAfterTax,
      courierFees,
      expenses,
      netResult: sale.marginAfterTax - courierFees - expenses,
      pendingExpenses: pendingExpenses._sum.amount ?? 0,
    };
  }

  private async load(id: string) {
    const row = await this.prisma.expense.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw notFound('Dépense');
    return row;
  }

  private async toView(r: Row, actor: AuthUser, reversed: boolean): Promise<ExpenseView> {
    return {
      id: r.id,
      category: r.category as ExpenseView['category'],
      label: r.label,
      amount: r.amount,
      island: r.island,
      periodDate: toBusinessDay(r.periodDate),
      status: r.status,
      reversed,
      createdBy: r.createdBy,
      approvedBy: r.approvedBy,
      approvedAt: r.approvedAt?.toISOString() ?? null,
      rejectReason: r.rejectReason,
      leader: r.leader,
      proofUrl: r.proofKey ? await this.storage.presignGet(BUCKETS.documents, r.proofKey) : null,
      createdAt: r.createdAt.toISOString(),
      canApprove:
        r.status === 'PENDING' &&
        r.createdById !== actor.id &&
        ['FINANCE_MANAGER', 'ADMIN'].includes(actor.role),
    };
  }
}
