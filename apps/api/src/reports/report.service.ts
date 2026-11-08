import { HttpStatus, Injectable } from '@nestjs/common';
import {
  addDays,
  CAMPAIGN_CHANNEL_LABELS,
  formatBusinessDate,
  isoWeekOf,
  REPORTS,
  reportsForRole,
  reportTotals,
  ROLE_LABELS,
  ROLE_SCOPE,
  SETTLEMENT_STATUS_LABELS,
  simulation,
  startOfBusinessDay,
  toBusinessDay,
  type ReportCell,
  type ReportColumn,
  type ReportQuery,
  type ReportType,
  type ReportView,
} from '@digecom/shared';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { notFound } from '../scope/scope.service';
import { StockQueryService } from '../stock/stock-query.service';
import { CampaignService } from '../tci/campaign.service';
import {
  businessDaySql,
  periodBounds,
  salesBy,
  salesTotals,
  ZERO_TOTALS,
  type SalesFilter,
  type SalesTotals,
} from './sales-query';

type Row = Record<string, ReportCell>;
interface Built {
  columns: ReportColumn[];
  rows: Row[];
}

const col = (
  key: string,
  label: string,
  kind: ReportColumn['kind'],
  total = false,
): ReportColumn => ({
  key,
  label,
  kind,
  ...(total ? { total: true } : {}),
});

const EXPENSE_STATUS: Record<string, string> = {
  PENDING: 'À valider',
  APPROVED: 'Validée',
  REJECTED: 'Refusée',
};

/** Rapports de la SPEC §6 module 14 : mêmes chiffres à l'écran, en Excel et en PDF. */
@Injectable()
export class ReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockQueryService,
    private readonly campaigns: CampaignService,
  ) {}

  /** Filtre effectif : un leader ne voit que son équipe (autre équipe → 404). */
  scoped(type: ReportType, q: ReportQuery, actor: AuthUser): ReportQuery {
    if (!reportsForRole(actor.role).includes(type))
      throw new AppException(
        'FORBIDDEN',
        'Rapport non accessible à ton profil',
        HttpStatus.FORBIDDEN,
      );
    if (ROLE_SCOPE[actor.role] === 'LEADER') {
      if (q.leaderId && q.leaderId !== actor.id) throw notFound('Équipe');
      return { ...q, leaderId: actor.id, islandId: undefined, siteId: undefined };
    }
    if (ROLE_SCOPE[actor.role] !== 'GLOBAL') throw notFound('Rapport');
    return q;
  }

  async build(type: ReportType, query: ReportQuery, actor: AuthUser): Promise<ReportView> {
    const q = this.scoped(type, query, actor);
    const f: SalesFilter = {
      from: q.from,
      to: q.to,
      islandId: q.islandId,
      siteId: q.siteId,
      leaderId: q.leaderId,
    };
    const built = await this.dispatch(type, q, f, actor);
    return {
      type,
      title: REPORTS[type].label,
      params: await this.params(type, q),
      columns: built.columns,
      rows: built.rows,
      totals: reportTotals(built.columns, built.rows),
      generatedAt: new Date().toISOString(),
    };
  }

  private async params(type: ReportType, q: ReportQuery) {
    const [island, site, leader] = await Promise.all([
      q.islandId ? this.prisma.island.findUnique({ where: { id: q.islandId } }) : null,
      q.siteId ? this.prisma.site.findUnique({ where: { id: q.siteId } }) : null,
      q.leaderId ? this.prisma.user.findUnique({ where: { id: q.leaderId } }) : null,
    ]);
    const out = [{ label: 'Rapport', value: REPORTS[type].label }];
    if (type !== 'simulation' && type !== 'stock')
      out.push({
        label: 'Période',
        value: `du ${formatBusinessDate(q.from)} au ${formatBusinessDate(q.to)}`,
      });
    out.push({ label: 'Île', value: island?.name ?? 'Toutes les îles' });
    if (site) out.push({ label: 'Site', value: site.name });
    out.push({ label: 'Leader', value: leader?.fullName ?? 'Tous les leaders' });
    return out;
  }

  private dispatch(
    type: ReportType,
    q: ReportQuery,
    f: SalesFilter,
    actor: AuthUser,
  ): Promise<Built> {
    switch (type) {
      case 'daily':
        return this.byPeriod(f, 'day');
      case 'weekly':
        return this.byPeriod(f, 'week');
      case 'monthly':
        return this.monthly(f);
      case 'product':
        return this.product(f);
      case 'lot':
        return this.lot(q);
      case 'seller':
        return this.seller(f);
      case 'leader':
        return this.leader(f);
      case 'island':
        return this.island(f);
      case 'expenses':
        return this.expenses(q);
      case 'margins':
        return this.margins(f, q);
      case 'settlements':
        return this.settlements(q);
      case 'stock':
        return this.stockReport(q, actor);
      case 'campaigns':
        return this.campaignReport(q, actor);
      case 'tci':
        return this.tci(f);
      case 'couriers':
        return this.couriers(q);
      case 'simulation':
        return Promise.resolve(this.simulationReport());
    }
  }

  // --- Ventes par période ----------------------------------------------------------------------

  /** Refus (date de refus) groupés par jour métier. */
  private async refusedByDay(f: SalesFilter): Promise<Map<string, number>> {
    const { start, end } = periodBounds(f.from, f.to);
    const parts: Prisma.Sql[] = [
      Prisma.sql`o."refusedAt" >= ${start}`,
      Prisma.sql`o."refusedAt" < ${end}`,
    ];
    if (f.islandId) parts.push(Prisma.sql`o."islandId" = ${f.islandId}`);
    if (f.siteId) parts.push(Prisma.sql`o."siteId" = ${f.siteId}`);
    if (f.leaderId) parts.push(Prisma.sql`o."leaderId" = ${f.leaderId}`);
    const rows = await this.prisma.$queryRaw<{ day: string; n: number }[]>`
      SELECT ${businessDaySql(Prisma.sql`o."refusedAt"`)} AS day, COUNT(*)::int AS n
      FROM "Order" o WHERE ${Prisma.join(parts, ' AND ')} GROUP BY 1`;
    return new Map(rows.map((r) => [r.day, r.n]));
  }

  private async byPeriod(f: SalesFilter, unit: 'day' | 'week'): Promise<Built> {
    const [sales, refused] = await Promise.all([
      salesBy(this.prisma, f, businessDaySql(Prisma.sql`o."soldAt"`)),
      this.refusedByDay(f),
    ]);
    const keyOf = (d: string) => (unit === 'day' ? d : isoWeekOf(d));
    const acc = new Map<string, SalesTotals & { refused: number }>();
    for (let d = f.from; d <= f.to; d = addDays(d, 1)) {
      const k = keyOf(d);
      const cur = acc.get(k) ?? { ...ZERO_TOTALS, refused: 0 };
      const s = sales.get(d);
      if (s) for (const m of Object.keys(ZERO_TOTALS) as (keyof SalesTotals)[]) cur[m] += s[m];
      cur.refused += refused.get(d) ?? 0;
      acc.set(k, cur);
    }
    return {
      columns: [
        col('period', unit === 'day' ? 'Jour' : 'Semaine', unit === 'day' ? 'date' : 'text'),
        col('orders', 'Ventes', 'int', true),
        col('quantity', 'Produits', 'int', true),
        col('revenue', 'Chiffre d’affaires', 'kmf', true),
        col('cost', 'Coût', 'kmf', true),
        col('marginAfterTax', 'Marge après coût et taxe', 'kmf', true),
        col('refused', 'Refus', 'int', true),
      ],
      rows: [...acc.entries()].map(([period, t]) => ({
        period,
        orders: t.orders,
        quantity: t.quantity,
        revenue: t.revenue,
        cost: t.cost,
        marginAfterTax: t.marginAfterTax,
        refused: t.refused,
      })),
    };
  }

  private async monthly(f: SalesFilter): Promise<Built> {
    const { start, end } = periodBounds(f.from, f.to);
    const [sales, expenses] = await Promise.all([
      salesBy(this.prisma, f, Prisma.sql`substr(${businessDaySql(Prisma.sql`o."soldAt"`)}, 1, 7)`),
      this.prisma.expense.findMany({
        where: {
          status: 'APPROVED',
          periodDate: { gte: start, lt: end },
          ...(f.islandId ? { islandId: f.islandId } : {}),
        },
        select: { amount: true, periodDate: true },
      }),
    ]);
    const months = new Set<string>();
    for (let d = f.from; d <= f.to; d = addDays(d, 1)) months.add(d.slice(0, 7));
    const exp = new Map<string, number>();
    for (const e of expenses) {
      const m = toBusinessDay(e.periodDate).slice(0, 7);
      exp.set(m, (exp.get(m) ?? 0) + e.amount);
    }
    return {
      columns: [
        col('month', 'Mois', 'text'),
        col('quantity', 'Produits', 'int', true),
        col('revenue', 'Chiffre d’affaires', 'kmf', true),
        col('marginAfterTax', 'Marge après coût et taxe', 'kmf', true),
        col('expenses', 'Dépenses validées', 'kmf', true),
        col('net', 'Résultat net', 'kmf', true),
      ],
      rows: [...months].map((month) => {
        const s = sales.get(month) ?? ZERO_TOTALS;
        const e = exp.get(month) ?? 0;
        return {
          month,
          quantity: s.quantity,
          revenue: s.revenue,
          marginAfterTax: s.marginAfterTax,
          expenses: e,
          net: s.marginAfterTax - e,
        };
      }),
    };
  }

  // --- Par entité ------------------------------------------------------------------------------

  private async userNames(ids: string[]) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        fullName: true,
        role: true,
        leader: { select: { fullName: true } },
        island: { select: { name: true } },
      },
    });
    return new Map(users.map((u) => [u.id, u]));
  }

  private sortByRevenue(m: Map<string, SalesTotals>) {
    return [...m.entries()].sort((a, b) => b[1].revenue - a[1].revenue);
  }

  private async product(f: SalesFilter): Promise<Built> {
    const by = await salesBy(this.prisma, f, Prisma.sql`oi."productId"`);
    const products = await this.prisma.product.findMany({
      where: { id: { in: [...by.keys()] } },
      select: { id: true, sku: true, name: true, leader: { select: { fullName: true } } },
    });
    const p = new Map(products.map((x) => [x.id, x]));
    return {
      columns: [
        col('sku', 'Référence', 'text'),
        col('product', 'Produit', 'text'),
        col('leader', 'Leader', 'text'),
        col('quantity', 'Quantité', 'int', true),
        col('revenue', 'Chiffre d’affaires', 'kmf', true),
        col('cost', 'Coût', 'kmf', true),
        col('sellerGross', 'Part vendeurs', 'kmf', true),
        col('tciBonus', 'Primes TCI', 'kmf', true),
        col('digecomTax', 'Taxe Dig’eCom', 'kmf', true),
        col('marginAfterTax', 'Marge après coût et taxe', 'kmf', true),
      ],
      rows: this.sortByRevenue(by).map(([id, t]) => ({
        sku: p.get(id)?.sku ?? '—',
        product: p.get(id)?.name ?? '—',
        leader: p.get(id)?.leader.fullName ?? '—',
        quantity: t.quantity,
        revenue: t.revenue,
        cost: t.cost,
        sellerGross: t.sellerGross,
        tciBonus: t.tciBonus,
        digecomTax: t.digecomTax,
        marginAfterTax: t.marginAfterTax,
      })),
    };
  }

  private async seller(f: SalesFilter): Promise<Built> {
    const by = await salesBy(this.prisma, f, Prisma.sql`o."sellerId"`);
    const u = await this.userNames([...by.keys()]);
    return {
      columns: [
        col('seller', 'Vendeur', 'text'),
        col('role', 'Profil', 'text'),
        col('leader', 'Leader', 'text'),
        col('island', 'Île', 'text'),
        col('orders', 'Ventes', 'int', true),
        col('quantity', 'Produits', 'int', true),
        col('revenue', 'Chiffre d’affaires', 'kmf', true),
        col('sellerNet', 'Net e-commerçant', 'kmf', true),
        col('tciBonus', 'Primes TCI', 'kmf', true),
      ],
      rows: this.sortByRevenue(by).map(([id, t]) => {
        const x = u.get(id);
        return {
          seller: x?.fullName ?? '—',
          role: x ? ROLE_LABELS[x.role] : '—',
          leader: x?.leader?.fullName ?? '—',
          island: x?.island?.name ?? '—',
          orders: t.orders,
          quantity: t.quantity,
          revenue: t.revenue,
          sellerNet: t.sellerNet,
          tciBonus: t.tciBonus,
        };
      }),
    };
  }

  private async leader(f: SalesFilter): Promise<Built> {
    const by = await salesBy(this.prisma, f, Prisma.sql`o."leaderId"`);
    const leaders = await this.prisma.user.findMany({
      where: {
        role: { in: ['LEADER_SENIOR', 'LEADER_JUNIOR'] },
        ...(f.islandId ? { islandId: f.islandId } : {}),
      },
      select: {
        id: true,
        fullName: true,
        role: true,
        island: { select: { name: true } },
        _count: { select: { team: true } },
      },
      orderBy: { fullName: 'asc' },
    });
    return {
      columns: [
        col('leader', 'Leader', 'text'),
        col('role', 'Profil', 'text'),
        col('island', 'Île', 'text'),
        col('members', 'Membres', 'int', true),
        col('quantity', 'Produits vendus', 'int', true),
        col('revenue', 'Chiffre d’affaires', 'kmf', true),
        col('marginAfterTax', 'Marge après coût et taxe', 'kmf', true),
      ],
      rows: leaders
        .map((l) => {
          const t = by.get(l.id) ?? ZERO_TOTALS;
          return {
            leader: l.fullName,
            role: ROLE_LABELS[l.role],
            island: l.island?.name ?? '—',
            members: l._count.team,
            quantity: t.quantity,
            revenue: t.revenue,
            marginAfterTax: t.marginAfterTax,
          };
        })
        .sort((a, b) => b.revenue - a.revenue),
    };
  }

  private async island(f: SalesFilter): Promise<Built> {
    const [by, islands] = await Promise.all([
      salesBy(this.prisma, f, Prisma.sql`o."islandId"`),
      this.prisma.island.findMany({
        orderBy: { code: 'asc' },
        ...(f.islandId ? { where: { id: f.islandId } } : {}),
      }),
    ]);
    const { start, end } = periodBounds(f.from, f.to);
    const refused = await this.prisma.order.groupBy({
      by: ['islandId'],
      where: {
        refusedAt: { gte: start, lt: end },
        ...(f.leaderId ? { leaderId: f.leaderId } : {}),
      },
      _count: true,
    });
    return {
      columns: [
        col('island', 'Île', 'text'),
        col('orders', 'Ventes', 'int', true),
        col('quantity', 'Produits', 'int', true),
        col('revenue', 'Chiffre d’affaires', 'kmf', true),
        col('marginAfterTax', 'Marge après coût et taxe', 'kmf', true),
        col('refused', 'Refus', 'int', true),
        col('refusalRate', 'Taux de refus', 'pct'),
      ],
      rows: islands.map((i) => {
        const t = by.get(i.id) ?? ZERO_TOTALS;
        const r = refused.find((x) => x.islandId === i.id)?._count ?? 0;
        return {
          island: i.name,
          orders: t.orders,
          quantity: t.quantity,
          revenue: t.revenue,
          marginAfterTax: t.marginAfterTax,
          refused: r,
          refusalRate: t.orders + r ? Math.round((r / (t.orders + r)) * 1000) / 10 : null,
        };
      }),
    };
  }

  private async tci(f: SalesFilter): Promise<Built> {
    const by = await salesBy(
      this.prisma,
      { ...f, sellerType: 'TELECONSULTANT' },
      Prisma.sql`o."sellerId"`,
    );
    const u = await this.userNames([...by.keys()]);
    return {
      columns: [
        col('tci', 'Téléconseiller', 'text'),
        col('leader', 'Leader Junior', 'text'),
        col('quantity', 'Produits vendus', 'int', true),
        col('revenue', 'Montant vendu', 'kmf', true),
        col('tciBonus', 'Gains (primes)', 'kmf', true),
      ],
      rows: this.sortByRevenue(by).map(([id, t]) => ({
        tci: u.get(id)?.fullName ?? '—',
        leader: u.get(id)?.leader?.fullName ?? '—',
        quantity: t.quantity,
        revenue: t.revenue,
        tciBonus: t.tciBonus,
      })),
    };
  }

  // --- Finance ---------------------------------------------------------------------------------

  private async margins(f: SalesFilter, q: ReportQuery): Promise<Built> {
    const t = await salesTotals(this.prisma, f);
    const { start, end } = periodBounds(q.from, q.to);
    const exp = await this.prisma.expense.aggregate({
      where: {
        status: 'APPROVED',
        periodDate: { gte: start, lt: end },
        ...(q.islandId ? { islandId: q.islandId } : {}),
      },
      _sum: { amount: true },
    });
    const expenses = exp._sum.amount ?? 0;
    const lines: [string, number][] = [
      [`Chiffre d’affaires (${t.quantity} produit(s) vendu(s))`, t.revenue],
      ['Coût d’approvisionnement (lots, FIFO)', t.cost],
      ['Part brute e-commerçants', t.sellerGross],
      ['Primes téléconseillers', t.tciBonus],
      ['Part commerciale Dig’eCom', t.digecomShare],
      ['Marge brute Dig’eCom', t.grossMargin],
      ['Taxes Dig’eCom', t.digecomTax],
      ['Marge Dig’eCom après coût et taxe', t.marginAfterTax],
      ['Taxes e-commerçants', t.sellerTax],
      ['Net e-commerçants avant abonnement', t.sellerNet],
      ['Dépenses validées', expenses],
      ['Résultat net (marge − dépenses)', t.marginAfterTax - expenses],
    ];
    return {
      columns: [col('indicator', 'Indicateur', 'text'), col('amount', 'Montant', 'kmf')],
      rows: lines.map(([indicator, amount]) => ({ indicator, amount })),
    };
  }

  private simulationReport(): Built {
    const s = simulation(100);
    const lines: [string, number][] = [
      ['Achats', s.purchases],
      ['Expédition', s.shipping],
      ['Coût total', s.sale.cost],
      ['Chiffre d’affaires', s.sale.revenue],
      ['Part Dig’eCom', s.sale.digecomShare],
      ['Part brute e-commerçants', s.sale.sellerGross],
      ['Marge brute', s.sale.grossMargin],
      ['Taxes Dig’eCom', s.sale.digecomTax],
      ['Taxes e-commerçants', s.sale.sellerTax],
      ['Net e-commerçants', s.sale.sellerNet],
      ['Marge après coût et taxe', s.sale.marginAfterTax],
    ];
    return {
      columns: [col('indicator', 'Indicateur (100 produits)', 'text'), col('amount', 'KMF', 'kmf')],
      rows: lines.map(([indicator, amount]) => ({ indicator, amount })),
    };
  }

  private async expenses(q: ReportQuery): Promise<Built> {
    const { start, end } = periodBounds(q.from, q.to);
    const rows = await this.prisma.expense.findMany({
      where: {
        periodDate: { gte: start, lt: end },
        ...(q.islandId ? { islandId: q.islandId } : {}),
        ...(q.leaderId ? { leaderId: q.leaderId } : {}),
      },
      include: { island: { select: { name: true } } },
      orderBy: { periodDate: 'asc' },
    });
    return {
      columns: [
        col('date', 'Date', 'date'),
        col('category', 'Catégorie', 'text'),
        col('label', 'Libellé', 'text'),
        col('island', 'Île', 'text'),
        col('status', 'Statut', 'text'),
        col('amount', 'Montant', 'kmf', true),
      ],
      rows: rows.map((e) => ({
        date: toBusinessDay(e.periodDate),
        category: e.category,
        label: e.label,
        island: e.island.name,
        status: EXPENSE_STATUS[e.status] ?? e.status,
        amount: e.amount,
      })),
    };
  }

  private async settlements(q: ReportQuery): Promise<Built> {
    const { start, end } = periodBounds(q.from, q.to);
    const rows = await this.prisma.settlement.findMany({
      where: {
        periodStart: { gte: start, lt: end },
        ...(q.islandId ? { islandId: q.islandId } : {}),
        ...(q.leaderId ? { seller: { leaderId: q.leaderId } } : {}),
      },
      include: { seller: { select: { fullName: true } }, island: { select: { name: true } } },
      orderBy: [{ periodStart: 'asc' }, { number: 'asc' }],
    });
    return {
      columns: [
        col('number', 'Relevé', 'text'),
        col('seller', 'E-commerçant', 'text'),
        col('island', 'Île', 'text'),
        col('periodStart', 'Début du cycle', 'date'),
        col('sales', 'Ventes', 'int', true),
        col('gross', 'Commissions', 'kmf', true),
        col('taxes', 'Taxes', 'kmf', true),
        col('subscriptions', 'Abonnements', 'kmf', true),
        col('netToPay', 'Net à payer', 'kmf', true),
        col('status', 'Statut', 'text'),
      ],
      rows: rows.map((s) => ({
        number: s.number,
        seller: s.seller.fullName,
        island: s.island.name,
        periodStart: toBusinessDay(s.periodStart),
        sales: s.salesCount,
        gross: s.grossCommission,
        taxes: s.taxes,
        subscriptions: s.subscriptions,
        netToPay: s.netToPay,
        status: SETTLEMENT_STATUS_LABELS[s.status],
      })),
    };
  }

  // --- Stock et lots ---------------------------------------------------------------------------

  private async stockReport(q: ReportQuery, actor: AuthUser): Promise<Built> {
    const rows = await this.stock.rows(
      { islandId: q.islandId, siteId: q.siteId, leaderId: q.leaderId },
      actor,
    );
    return {
      columns: [
        col('site', 'Site', 'text'),
        col('sku', 'Référence', 'text'),
        col('product', 'Produit', 'text'),
        col('leader', 'Leader', 'text'),
        col('available', 'Disponible', 'int', true),
        col('reserved', 'Réservé', 'int', true),
        col('unitCost', 'Coût unitaire', 'kmf'),
        col('value', 'Valeur (coût rendu)', 'kmf', true),
      ],
      rows: rows.map((r) => ({
        site: r.site.name,
        sku: r.sku,
        product: r.productName,
        leader: r.leader.fullName,
        available: r.available,
        reserved: r.reserved,
        unitCost: r.unitCost,
        value: r.value,
      })),
    };
  }

  private async lot(q: ReportQuery): Promise<Built> {
    const lots = await this.prisma.lot.findMany({
      where: {
        receivedAt: { lt: startOfBusinessDay(addDays(q.to, 1)) },
        ...(q.siteId ? { siteId: q.siteId } : {}),
        ...(q.islandId ? { site: { islandId: q.islandId } } : {}),
        ...(q.leaderId ? { product: { leaderId: q.leaderId } } : {}),
      },
      include: { product: { select: { name: true } }, site: { select: { name: true } } },
      orderBy: { receivedAt: 'asc' },
    });
    const sold = await this.prisma.stockMovement.groupBy({
      by: ['lotId'],
      where: { type: 'OUT', lotId: { in: lots.map((l) => l.id) } },
      _sum: { quantity: true },
    });
    const soldOf = new Map(sold.map((s) => [s.lotId, s._sum.quantity ?? 0]));
    return {
      columns: [
        col('number', 'Lot', 'text'),
        col('product', 'Produit', 'text'),
        col('site', 'Site', 'text'),
        col('receivedAt', 'Réception', 'date'),
        col('quantity', 'Reçu', 'int', true),
        col('sold', 'Vendu', 'int', true),
        col('remaining', 'Restant', 'int', true),
        col('unitCost', 'Coût unitaire', 'kmf'),
        col('value', 'Valeur restante', 'kmf', true),
      ],
      rows: lots.map((l) => ({
        number: l.number,
        product: l.product.name,
        site: l.site.name,
        receivedAt: toBusinessDay(l.receivedAt),
        quantity: l.quantity,
        sold: soldOf.get(l.id) ?? 0,
        remaining: l.remaining,
        unitCost: l.unitCost,
        value: l.remaining * l.unitCost,
      })),
    };
  }

  // --- Campagnes, livreurs ---------------------------------------------------------------------

  private async campaignReport(q: ReportQuery, actor: AuthUser): Promise<Built> {
    const list = (await this.campaigns.list(actor)).filter(
      (c) =>
        c.startDate <= q.to && c.endDate >= q.from && (!q.leaderId || c.leader.id === q.leaderId),
    );
    return {
      columns: [
        col('number', 'Campagne', 'text'),
        col('name', 'Nom', 'text'),
        col('leader', 'Leader Junior', 'text'),
        col('product', 'Produit', 'text'),
        col('channel', 'Canal', 'text'),
        col('budget', 'Budget', 'kmf', true),
        col('contacts', 'Contacts', 'int', true),
        col('confirmed', 'Confirmées', 'int', true),
        col('sold', 'Vendues', 'int', true),
        col('costPerSale', 'Coût par vente', 'kmf'),
      ],
      rows: list.map((c) => ({
        number: c.number,
        name: c.name,
        leader: c.leader.fullName,
        product: c.product.name,
        channel: CAMPAIGN_CHANNEL_LABELS[c.channel],
        budget: c.budget,
        contacts: c.contacts,
        confirmed: c.confirmed,
        sold: c.sold,
        costPerSale: c.costPerSale,
      })),
    };
  }

  private async couriers(q: ReportQuery): Promise<Built> {
    const { start, end } = periodBounds(q.from, q.to);
    const island = q.islandId ? Prisma.sql`AND o."islandId" = ${q.islandId}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      { courierId: string; delivered: number; failed: number; fees: bigint }[]
    >`
      SELECT o."courierId",
        COUNT(*) FILTER (WHERE o."handedOverAt" >= ${start} AND o."handedOverAt" < ${end})::int AS delivered,
        COUNT(*) FILTER (WHERE o."failedAt" >= ${start} AND o."failedAt" < ${end})::int AS failed,
        COALESCE(SUM(o."courierFee") FILTER (WHERE o."handedOverAt" >= ${start} AND o."handedOverAt" < ${end}), 0)::bigint AS fees
      FROM "Order" o
      WHERE o."courierId" IS NOT NULL ${island}
      GROUP BY 1`;
    const u = await this.userNames(rows.map((r) => r.courierId));
    return {
      columns: [
        col('courier', 'Livreur', 'text'),
        col('island', 'Île', 'text'),
        col('delivered', 'Courses livrées', 'int', true),
        col('failed', 'Échecs', 'int', true),
        col('fees', 'Frais de course', 'kmf', true),
      ],
      rows: rows
        .filter((r) => r.delivered || r.failed)
        .map((r) => ({
          courier: u.get(r.courierId)?.fullName ?? '—',
          island: u.get(r.courierId)?.island?.name ?? '—',
          delivered: r.delivered,
          failed: r.failed,
          fees: Number(r.fees),
        }))
        .sort((a, b) => b.delivered - a.delivered),
    };
  }
}
