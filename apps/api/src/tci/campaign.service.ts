import { HttpStatus, Injectable } from '@nestjs/common';
import {
  businessToday,
  parseCsv,
  prepareImport,
  roundRobin,
  startOfBusinessDay,
  toBusinessDay,
  type CampaignInput,
  type CampaignView,
  type ImportReport,
  type OrderView,
  type ProspectConfirmInput,
  type ProspectStatus,
  type ProspectView,
} from '@digecom/shared';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import type { AuthUser } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { NotificationService } from '../notifications/notification.service';
import { OrderService } from '../orders/order.service';
import { PrismaService } from '../prisma/prisma.service';
import { notFound } from '../scope/scope.service';
import { CounterService } from '../stock/counter.service';
import { BUCKETS, StorageService } from '../storage/storage.service';

const CAMPAIGN_INCLUDE = {
  leader: { select: { id: true, fullName: true, islandId: true } },
  product: { select: { id: true, name: true, salePrice: true, tciBonus: true } },
  expense: { select: { id: true, status: true } },
} satisfies Prisma.CampaignInclude;
type CampaignRow = Prisma.CampaignGetPayload<{ include: typeof CAMPAIGN_INCLUDE }>;

const PROSPECT_INCLUDE = {
  campaign: { select: { id: true, number: true, name: true, leaderId: true, productId: true } },
  assignedTci: { select: { id: true, fullName: true } },
  order: { select: { id: true, number: true, status: true } },
} satisfies Prisma.ProspectInclude;
type ProspectRow = Prisma.ProspectGetPayload<{ include: typeof PROSPECT_INCLUDE }>;

const invalid = (path: string, message: string) =>
  new AppException('VALIDATION_ERROR', message, HttpStatus.UNPROCESSABLE_ENTITY, [
    { path, message },
  ]);
const conflict = (message: string) => new AppException('CONFLICT', message, HttpStatus.CONFLICT);

const toProspectView = (p: ProspectRow): ProspectView => ({
  id: p.id,
  fullName: p.fullName,
  phone: p.phone,
  note: p.note,
  status: p.status,
  attempts: p.attempts,
  lastCallAt: p.lastCallAt?.toISOString() ?? null,
  createdAt: p.createdAt.toISOString(),
  campaign: { id: p.campaign.id, number: p.campaign.number, name: p.campaign.name },
  tci: p.assignedTci,
  order: p.order,
});

/** Campagnes du Leader Junior et prospects (import, répartition, appels, confirmation). */
@Injectable()
export class CampaignService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CounterService,
    private readonly orders: OrderService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationService,
  ) {}

  // --- Campagnes --------------------------------------------------------------------------

  private campaignScope(actor: AuthUser): Prisma.CampaignWhereInput {
    if (actor.role === 'LEADER_JUNIOR') return { leaderId: actor.id };
    if (actor.role === 'TELECONSULTANT') return { leaderId: actor.leaderId ?? '-' };
    return {};
  }

  private async ownCampaign(id: string, actor: AuthUser): Promise<CampaignRow> {
    const where: Prisma.CampaignWhereInput =
      actor.role === 'ADMIN' ? { id } : { id, leaderId: actor.id };
    const row = await this.prisma.campaign.findFirst({ where, include: CAMPAIGN_INCLUDE });
    if (!row) throw notFound('Campagne');
    return row;
  }

  /** Les campagnes dont la date de fin est passée sont terminées (job quotidien et lecture). */
  async endExpired(today = businessToday()): Promise<number> {
    const { count } = await this.prisma.campaign.updateMany({
      where: { status: { not: 'ENDED' }, endDate: { lt: startOfBusinessDay(today) } },
      data: { status: 'ENDED' },
    });
    return count;
  }

  async list(actor: AuthUser): Promise<CampaignView[]> {
    await this.endExpired();
    const rows = await this.prisma.campaign.findMany({
      where: this.campaignScope(actor),
      include: CAMPAIGN_INCLUDE,
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
    });
    return this.toViews(rows);
  }

  async create(input: CampaignInput, actor: AuthUser): Promise<CampaignView> {
    const leaderId = actor.role === 'ADMIN' ? input.leaderId : actor.id;
    if (!leaderId) throw invalid('leaderId', 'Leader Junior requis');
    const leader = await this.prisma.user.findUnique({ where: { id: leaderId } });
    if (!leader || leader.role !== 'LEADER_JUNIOR' || !leader.islandId)
      throw invalid('leaderId', 'Le propriétaire doit être un Leader Junior');
    const product = await this.prisma.product.findUnique({ where: { id: input.productId } });
    if (!product || product.leaderId !== leaderId)
      throw invalid('productId', 'Le produit doit appartenir au catalogue du Leader Junior');

    const row = await this.prisma.$transaction(async (tx) => {
      const number = await this.counters.formatted('CAMPAIGN', 'CP-', 2, tx);
      // Le budget est une dépense publicitaire rattachée à la campagne et au leader (validation finance).
      const expense =
        input.budget > 0
          ? await tx.expense.create({
              data: {
                category: 'ADVERTISING',
                label: `Campagne ${number} – ${input.name}`,
                amount: input.budget,
                islandId: leader.islandId!,
                periodDate: startOfBusinessDay(input.startDate),
                leaderId,
                createdById: actor.id,
              },
            })
          : null;
      const campaign = await tx.campaign.create({
        data: {
          number,
          leaderId,
          productId: product.id,
          name: input.name,
          channel: input.channel,
          budget: input.budget,
          startDate: startOfBusinessDay(input.startDate),
          endDate: startOfBusinessDay(input.endDate),
          status: input.endDate < businessToday() ? 'ENDED' : 'ACTIVE',
          expenseId: expense?.id,
          createdById: actor.id,
        },
        include: CAMPAIGN_INCLUDE,
      });
      if (expense)
        await tx.expense.update({ where: { id: expense.id }, data: { campaignId: campaign.id } });
      return campaign;
    });
    const approvers = await this.notifications.usersWithRoles(['FINANCE_MANAGER']);
    if (row.expenseId) {
      await this.notifications.send(approvers, {
        type: 'EXPENSE_PENDING',
        title: `Budget de campagne à valider : ${row.number}`,
        body: `${row.name} · ${row.budget.toLocaleString('fr-FR')} KMF`,
        link: '/depenses',
      });
    }
    return (await this.toViews([row]))[0]!;
  }

  async update(id: string, input: Partial<CampaignInput>, actor: AuthUser): Promise<CampaignView> {
    const c = await this.ownCampaign(id, actor);
    if (input.productId && input.productId !== c.productId) {
      const product = await this.prisma.product.findUnique({ where: { id: input.productId } });
      if (!product || product.leaderId !== c.leaderId)
        throw invalid('productId', 'Produit hors du catalogue du leader');
    }
    if (input.budget !== undefined && input.budget !== c.budget) {
      if (c.expense && c.expense.status !== 'PENDING') {
        throw conflict(
          'Budget déjà validé par la finance : la correction passe par une nouvelle dépense',
        );
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.campaign.update({
        where: { id },
        data: {
          name: input.name,
          productId: input.productId,
          channel: input.channel,
          budget: input.budget,
          startDate: input.startDate ? startOfBusinessDay(input.startDate) : undefined,
          endDate: input.endDate ? startOfBusinessDay(input.endDate) : undefined,
        },
      });
      if (input.budget !== undefined && c.expense?.status === 'PENDING') {
        await tx.expense.update({ where: { id: c.expense.id }, data: { amount: input.budget } });
      }
    });
    return (await this.toViews([await this.ownCampaign(id, actor)]))[0]!;
  }

  async setStatus(id: string, status: 'ACTIVE' | 'PAUSED', actor: AuthUser): Promise<CampaignView> {
    const c = await this.ownCampaign(id, actor);
    if (c.status === 'ENDED') throw conflict('Cette campagne est terminée');
    if (toBusinessDay(c.endDate) < businessToday()) throw conflict('La date de fin est passée');
    await this.prisma.campaign.update({ where: { id }, data: { status } });
    return (await this.toViews([await this.ownCampaign(id, actor)]))[0]!;
  }

  private async toViews(rows: CampaignRow[]): Promise<CampaignView[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [contacts, confirmed, sold] = await Promise.all([
      this.prisma.prospect.groupBy({
        by: ['campaignId'],
        where: { campaignId: { in: ids } },
        _count: true,
      }),
      this.prisma.prospect.groupBy({
        by: ['campaignId'],
        where: { campaignId: { in: ids }, status: 'CONFIRMED' },
        _count: true,
      }),
      this.prisma.order.groupBy({
        by: ['campaignId'],
        where: { campaignId: { in: ids }, status: 'SOLD' },
        _count: true,
      }),
    ]);
    const count = (list: { campaignId: string | null; _count: number }[], id: string) =>
      list.find((x) => x.campaignId === id)?._count ?? 0;
    return rows.map((r) => {
      const c = count(contacts, r.id);
      const conf = count(confirmed, r.id);
      const s = count(sold, r.id);
      return {
        id: r.id,
        number: r.number,
        name: r.name,
        channel: r.channel,
        budget: r.budget,
        startDate: toBusinessDay(r.startDate),
        endDate: toBusinessDay(r.endDate),
        status: r.status,
        leader: { id: r.leader.id, fullName: r.leader.fullName },
        product: r.product,
        contacts: c,
        confirmed: conf,
        sold: s,
        confirmationRate: c ? Math.round((conf / c) * 1000) / 10 : null,
        costPerSale: s ? Math.round(r.budget / s) : null,
        expense: r.expense,
      };
    });
  }

  // --- Prospects --------------------------------------------------------------------------

  private prospectScope(actor: AuthUser): Prisma.ProspectWhereInput {
    if (actor.role === 'TELECONSULTANT') return { assignedTciId: actor.id };
    if (actor.role === 'LEADER_JUNIOR') return { campaign: { leaderId: actor.id } };
    if (actor.role === 'ADMIN') return {};
    return { id: '__hors_perimetre__' };
  }

  async prospects(
    actor: AuthUser,
    q: { status?: ProspectStatus; campaignId?: string },
  ): Promise<ProspectView[]> {
    const rows = await this.prisma.prospect.findMany({
      where: {
        AND: [this.prospectScope(actor), { campaignId: q.campaignId, status: q.status }],
      },
      include: PROSPECT_INCLUDE,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 500,
    });
    return rows.map(toProspectView);
  }

  async addProspect(
    campaignId: string,
    input: { fullName: string; phone: string; note: string | null },
    actor: AuthUser,
  ): Promise<ProspectView> {
    const c = await this.ownCampaign(campaignId, actor);
    try {
      const row = await this.prisma.prospect.create({
        data: { campaignId: c.id, fullName: input.fullName, phone: input.phone, note: input.note },
        include: PROSPECT_INCLUDE,
      });
      return toProspectView(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw conflict('Ce numéro est déjà dans la campagne');
      }
      throw err;
    }
  }

  /** Import CSV / XLSX : aperçu (dryRun) puis enregistrement, avec rapport conservé. */
  async importProspects(
    campaignId: string,
    input: { fileName: string; contentBase64: string; dryRun: boolean },
    actor: AuthUser,
  ): Promise<ImportReport & { batchId?: string }> {
    const c = await this.ownCampaign(campaignId, actor);
    const buffer = Buffer.from(input.contentBase64, 'base64');
    if (buffer.length > 5 * 1024 * 1024) throw invalid('file', 'Fichier trop lourd (5 Mo maximum)');
    const rows = await this.readRows(input.fileName, buffer);
    const existing = await this.prisma.prospect.findMany({
      where: { campaignId: c.id },
      select: { phone: true },
    });
    const report = prepareImport(
      rows,
      existing.map((e) => e.phone),
    );
    if (input.dryRun) return report;

    const fileKey = `imports/${c.id}/${Date.now()}-${input.fileName.replace(/[^\w.-]/g, '_')}`;
    await this.storage
      .put(BUCKETS.documents, fileKey, buffer, 'application/octet-stream')
      .catch(() => undefined);
    const batch = await this.prisma.$transaction(async (tx) => {
      const b = await tx.prospectImportBatch.create({
        data: {
          campaignId: c.id,
          fileName: input.fileName,
          fileKey,
          rows: report.rows,
          imported: report.imported,
          duplicates: report.duplicates,
          errors: report.lines
            .filter((l) => l.status !== 'OK')
            .map((l) => ({ line: l.line, error: l.error ?? '' })),
          byId: actor.id,
        },
      });
      await tx.prospect.createMany({
        data: report.lines
          .filter((l) => l.status === 'OK')
          .map((l) => ({
            campaignId: c.id,
            fullName: l.fullName,
            phone: l.phone!,
            note: l.note,
            importBatchId: b.id,
          })),
        skipDuplicates: true,
      });
      return b;
    });
    return { ...report, batchId: batch.id };
  }

  private async readRows(fileName: string, buffer: Buffer): Promise<string[][]> {
    if (/\.xlsx$/i.test(fileName)) {
      const wb = new ExcelJS.Workbook();
      try {
        await wb.xlsx.load(buffer as unknown as ArrayBuffer);
      } catch {
        throw invalid('file', 'Fichier Excel illisible');
      }
      const sheet = wb.worksheets[0];
      if (!sheet) return [];
      const rows: string[][] = [];
      sheet.eachRow((row) => {
        const values = (row.values as unknown[])
          .slice(1)
          .map((v) =>
            v === null || v === undefined
              ? ''
              : typeof v === 'object' && v && 'text' in v
                ? String((v as { text: unknown }).text)
                : String(v),
          );
        rows.push(values);
      });
      return rows;
    }
    if (/\.(csv|txt)$/i.test(fileName)) return parseCsv(buffer.toString('utf8'));
    throw invalid('file', 'Format accepté : CSV ou XLSX');
  }

  /** Répartition des prospects à appeler entre les TCI actifs de l'équipe. */
  async assign(
    campaignId: string,
    input: { mode: 'auto' | 'manual'; prospectIds?: string[]; tciId?: string },
    actor: AuthUser,
  ) {
    const c = await this.ownCampaign(campaignId, actor);
    const tcis = await this.prisma.user.findMany({
      where: { role: 'TELECONSULTANT', leaderId: c.leaderId, isActive: true },
      select: { id: true, fullName: true },
    });
    if (!tcis.length) throw conflict('Aucun téléconseiller actif dans l’équipe');
    const assignments = new Map<string, string[]>();

    if (input.mode === 'manual') {
      if (!input.tciId || !tcis.some((t) => t.id === input.tciId))
        throw invalid('tciId', 'Téléconseiller hors de l’équipe');
      if (!input.prospectIds?.length) throw invalid('prospectIds', 'Choisis les prospects');
      const valid = await this.prisma.prospect.findMany({
        where: {
          id: { in: input.prospectIds },
          campaignId: c.id,
          status: { in: ['TO_CALL', 'UNREACHABLE'] },
        },
        select: { id: true },
      });
      assignments.set(
        input.tciId,
        valid.map((p) => p.id),
      );
    } else {
      const pending = await this.prisma.prospect.findMany({
        where: { campaignId: c.id, assignedTciId: null, status: 'TO_CALL' },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      const loads = await this.prisma.prospect.groupBy({
        by: ['assignedTciId'],
        where: {
          assignedTciId: { in: tcis.map((t) => t.id) },
          status: { in: ['TO_CALL', 'UNREACHABLE'] },
        },
        _count: true,
      });
      const split = roundRobin(
        pending.map((p) => p.id),
        tcis.map((t) => ({
          id: t.id,
          load: loads.find((l) => l.assignedTciId === t.id)?._count ?? 0,
        })),
      );
      for (const [tciId, ids] of split) assignments.set(tciId, ids);
    }

    const result: { tci: string; count: number }[] = [];
    for (const [tciId, ids] of assignments) {
      if (!ids.length) continue;
      await this.prisma.prospect.updateMany({
        where: { id: { in: ids } },
        data: { assignedTciId: tciId },
      });
      await this.notifications.send([tciId], {
        type: 'PROSPECTS_ASSIGNED',
        title: `${ids.length} nouveau(x) prospect(s) à appeler`,
        body: `Campagne ${c.number} – ${c.name}`,
        link: '/prospects',
      });
      result.push({ tci: tcis.find((t) => t.id === tciId)!.fullName, count: ids.length });
    }
    return { assigned: result.reduce((s, r) => s + r.count, 0), byTci: result };
  }

  private async ownProspect(id: string, actor: AuthUser): Promise<ProspectRow> {
    const row = await this.prisma.prospect.findFirst({
      where: { AND: [{ id }, this.prospectScope(actor)] },
      include: PROSPECT_INCLUDE,
    });
    if (!row) throw notFound('Prospect');
    return row;
  }

  /** Résultat d'appel (TCI) : injoignable (tentative +1, à rappeler) ou pas intéressé. */
  async callOutcome(
    id: string,
    outcome: 'UNREACHABLE' | 'NOT_INTERESTED',
    note: string | undefined,
    actor: AuthUser,
  ): Promise<ProspectView> {
    const p = await this.ownProspect(id, actor);
    if (p.status === 'CONFIRMED' || p.status === 'NOT_INTERESTED')
      throw conflict('Ce prospect est déjà traité');
    const row = await this.prisma.prospect.update({
      where: { id },
      data: {
        status: outcome,
        attempts: { increment: 1 },
        lastCallAt: new Date(),
        note: note
          ? [p.note, `${toBusinessDay(new Date())} : ${note}`].filter(Boolean).join('\n')
          : undefined,
      },
      include: PROSPECT_INCLUDE,
    });
    return toProspectView(row);
  }

  /** « Commande confirmée » : crée la commande TCI (circuit normal) et marque le prospect. */
  async confirm(
    id: string,
    input: ProspectConfirmInput,
    actor: AuthUser,
  ): Promise<{ prospect: ProspectView; order: OrderView }> {
    const p = await this.ownProspect(id, actor);
    if (actor.role !== 'TELECONSULTANT')
      throw new AppException(
        'FORBIDDEN',
        'Seul le téléconseiller du prospect confirme la commande',
        HttpStatus.FORBIDDEN,
      );
    if (p.status === 'CONFIRMED' || p.status === 'NOT_INTERESTED')
      throw conflict('Ce prospect est déjà traité');
    const order = await this.orders.create(
      {
        items: [{ productId: p.campaign.productId, quantity: input.quantity }],
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        customerAddress: input.customerAddress,
        zone: input.zone,
        deliveryMode: input.deliveryMode,
        note: input.note ?? null,
      },
      actor,
      {
        campaignId: p.campaign.id,
        prospectId: p.id,
        afterCreate: async (tx, orderId) => {
          const { count } = await tx.prospect.updateMany({
            where: { id, status: { in: ['TO_CALL', 'UNREACHABLE'] } },
            data: {
              status: 'CONFIRMED',
              orderId,
              attempts: { increment: 1 },
              lastCallAt: new Date(),
            },
          });
          if (count === 0) throw conflict('Ce prospect vient d’être traité');
        },
      },
    );
    return { prospect: toProspectView(await this.ownProspect(id, actor)), order };
  }
}
