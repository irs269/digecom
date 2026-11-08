import { Injectable } from '@nestjs/common';
import {
  addDays,
  businessToday,
  isoWeekOf,
  isoWeekRange,
  ROLE_SCOPE,
  settlementCycle,
  startOfBusinessDay,
  type DashboardKpi,
  type DashboardOrderRow,
  type DashboardRankRow,
  type DashboardTodo,
  type DashboardView,
} from '@digecom/shared';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { StockQueryService } from '../stock/stock-query.service';
import { CampaignService } from '../tci/campaign.service';
import { TciService } from '../tci/tci.service';
import { DashboardCache } from './insights.module';
import { NetworkService } from './network.service';
import { salesBy, salesTotals, type SalesFilter } from './sales-query';

const IN_PROGRESS = [
  'NEW',
  'CONFIRMED',
  'PREPARING',
  'READY',
  'ASSIGNED',
  'OUT_FOR_DELIVERY',
  'HANDED_OVER',
] as const;
const INCIDENTS = ['DELIVERY_FAILED', 'REFUSED', 'RETURN_IN_PROGRESS'] as const;
const IN_TRANSIT_PO = ['ORDERED', 'IN_TRANSIT', 'ARRIVED', 'IN_CUSTOMS'] as const;

const kpi = (k: DashboardKpi) => k;

/** Tableau de bord de chaque rôle : « que dois-je faire maintenant et comment ça va ? ». */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly cache: DashboardCache,
    private readonly stock: StockQueryService,
    private readonly campaigns: CampaignService,
    private readonly tci: TciService,
    private readonly network: NetworkService,
  ) {}

  async get(
    actor: AuthUser,
    islandFilter?: string,
    today = businessToday(),
  ): Promise<DashboardView> {
    const island = ROLE_SCOPE[actor.role] === 'GLOBAL' ? islandFilter : undefined;
    return this.cache.wrap(`${actor.id}:${island ?? 'all'}:${today}`, () =>
      this.compute(actor, island, today),
    );
  }

  /** Cycle de règlement en cours (bornes incluses). */
  async currentCycle(today = businessToday()) {
    const [anchor, days] = await Promise.all([
      this.settings.get('settlement.anchorDate'),
      this.settings.get('settlement.cycleDays'),
    ]);
    const c = settlementCycle(anchor, days, today);
    return { start: c.start, end: addDays(c.end, -1) };
  }

  async compute(
    actor: AuthUser,
    island: string | undefined,
    today: string,
  ): Promise<DashboardView> {
    const base = { role: actor.role, generatedAt: new Date().toISOString() };
    switch (actor.role) {
      case 'ADMIN':
      case 'FINANCE_MANAGER':
      case 'ACCOUNTANT':
      case 'ACCOUNTANT_ASSISTANT':
        return { ...base, ...(await this.direction(actor, island, today)) };
      case 'CASHIER':
        return { ...base, ...(await this.cashier(actor, today)) };
      case 'STOCK_MANAGER':
        return { ...base, ...(await this.stockManager(actor, today)) };
      case 'LOGISTICS_ASSISTANT':
        return { ...base, ...(await this.logistics(actor, today)) };
      case 'LEADER_SENIOR':
        return { ...base, ...(await this.leaderSenior(actor, today)) };
      case 'LEADER_JUNIOR':
        return { ...base, ...(await this.leaderJunior(actor, today)) };
      case 'TELECONSULTANT':
        return { ...base, ...(await this.teleconsultant(actor, today)) };
      default:
        return {
          ...base,
          period: { label: 'Aujourd’hui', start: today, end: today },
          kpis: [],
          todo: [],
        };
    }
  }

  // --- Direction, finance, comptabilité -------------------------------------------------------

  private async direction(actor: AuthUser, island: string | undefined, today: string) {
    const cycle = await this.currentCycle(today);
    const f: SalesFilter = { from: cycle.start, to: cycle.end, islandId: island };
    const start = startOfBusinessDay(cycle.start);
    const end = startOfBusinessDay(addDays(cycle.end, 1));
    const orderIsland = island ? { islandId: island } : {};

    const [
      totals,
      refused,
      noCourier,
      dues,
      toVerify,
      toApprove,
      expenses,
      incidents,
      recent,
      top,
      islands,
    ] = await Promise.all([
      salesTotals(this.prisma, f),
      this.prisma.order.count({ where: { ...orderIsland, refusedAt: { gte: start, lt: end } } }),
      this.prisma.order.count({
        where: {
          ...orderIsland,
          status: 'READY',
          courierId: null,
          deliveryMode: { not: 'PICKUP' },
        },
      }),
      this.sellerDues(island),
      this.prisma.settlement.count({ where: { ...orderIsland, status: 'GENERATED' } }),
      this.prisma.settlement.count({ where: { ...orderIsland, status: 'VERIFIED' } }),
      this.prisma.expense.count({ where: { ...orderIsland, status: 'PENDING' } }),
      this.prisma.order.count({ where: { ...orderIsland, status: { in: [...INCIDENTS] } } }),
      this.recentOrders({ ...orderIsland }),
      this.topSellers(f),
      salesBy(this.prisma, { from: cycle.start, to: cycle.end }, Prisma.sql`o."islandId"`),
    ]);
    const islandRows = await this.prisma.island.findMany({ orderBy: { code: 'asc' } });
    const decided = totals.orders + refused;
    const kpis: DashboardKpi[] = [
      kpi({
        key: 'revenue',
        label: 'Chiffre d’affaires du cycle',
        value: totals.revenue,
        format: 'kmf',
        hint: `${totals.quantity} produit(s) vendu(s)`,
        tone: 'blue',
        link: `/rapports?type=daily&from=${cycle.start}&to=${cycle.end}`,
      }),
      kpi({
        key: 'sales',
        label: 'Ventes',
        value: totals.orders,
        format: 'int',
        hint: 'Commandes vendues sur le cycle',
        tone: 'white',
        link: '/commandes?status=SOLD',
      }),
      kpi({
        key: 'margin',
        label: 'Marge après coût et taxe',
        value: totals.marginAfterTax,
        format: 'kmf',
        hint: 'Part Dig’eCom − coût − taxe',
        tone: 'white',
        link: `/rapports?type=margins&from=${cycle.start}&to=${cycle.end}`,
      }),
      kpi({
        key: 'dues',
        label: 'Sommes dues aux vendeurs',
        value: dues,
        format: 'kmf',
        hint: 'Relevés non payés + cycle en cours',
        tone: 'white',
        link: '/reglements',
      }),
      kpi({
        key: 'refusalRate',
        label: 'Taux de refus',
        value: decided ? Math.round((refused / decided) * 1000) / 10 : null,
        format: 'pct',
        hint: `${refused} refus sur le cycle`,
        tone: 'white',
        link: '/commandes?status=REFUSED',
      }),
      kpi({
        key: 'noCourier',
        label: 'Livraisons sans livreur',
        value: noCourier,
        format: 'int',
        hint: 'Prêtes, aucun livreur',
        tone: 'orange',
        link: '/livraisons',
      }),
    ];
    const todo: DashboardTodo[] = [
      {
        key: 'toVerify',
        label: 'Relevés à vérifier',
        count: toVerify,
        link: '/reglements?status=GENERATED',
      },
      {
        key: 'toApprove',
        label: 'Règlements à valider',
        count: toApprove,
        link: '/reglements?status=VERIFIED',
      },
      {
        key: 'expenses',
        label: 'Dépenses à valider',
        count: expenses,
        link: '/depenses?status=PENDING',
      },
      {
        key: 'incidents',
        label: 'Refus et échecs',
        count: incidents,
        alert: true,
        link: '/livraisons',
      },
    ];
    return {
      period: { label: 'Cycle en cours', ...cycle },
      kpis,
      todo,
      recentOrders: recent,
      ranking: { title: 'Meilleurs vendeurs du cycle', rows: top },
      islands: islandRows.map((i) => ({
        code: i.code,
        name: i.name,
        revenue: islands.get(i.id)?.revenue ?? 0,
      })),
    };
  }

  /** Relevés non payés + commissions nettes pas encore réglées (e-commerçants). */
  private async sellerDues(island?: string): Promise<number> {
    const [unpaid, open] = await Promise.all([
      this.prisma.settlement.aggregate({
        where: { status: { not: 'PAID' }, ...(island ? { islandId: island } : {}) },
        _sum: { netToPay: true },
      }),
      this.prisma.ledgerEntry.groupBy({
        by: ['type'],
        where: {
          type: { in: ['SELLER_COMMISSION', 'SELLER_TAX', 'SUBSCRIPTION'] },
          lines: { none: {} },
          ...(island ? { islandId: island } : {}),
        },
        _sum: { amount: true },
      }),
    ]);
    const sum = (t: string) => open.find((o) => o.type === t)?._sum.amount ?? 0;
    const pending = sum('SELLER_COMMISSION') - sum('SELLER_TAX') - sum('SUBSCRIPTION');
    return (unpaid._sum.netToPay ?? 0) + Math.max(pending, 0);
  }

  private async recentOrders(where: Prisma.OrderWhereInput): Promise<DashboardOrderRow[]> {
    const rows = await this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        seller: { select: { fullName: true } },
        island: { select: { name: true } },
        items: { select: { quantity: true, unitPrice: true } },
      },
    });
    return rows.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      customerName: o.customerName,
      seller: o.seller.fullName,
      island: o.island.name,
      amount: o.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0),
      createdAt: o.createdAt.toISOString(),
    }));
  }

  private async topSellers(f: SalesFilter, take = 5): Promise<DashboardRankRow[]> {
    const by = await salesBy(this.prisma, f, Prisma.sql`o."sellerId"`);
    const ids = [...by.entries()]
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, take)
      .map(([id]) => id);
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true },
    });
    return ids.map((id) => ({
      id,
      fullName: users.find((u) => u.id === id)?.fullName ?? '—',
      sold: by.get(id)!.quantity,
      revenue: by.get(id)!.revenue,
    }));
  }

  // --- Caissier -------------------------------------------------------------------------------

  private async cashier(actor: AuthUser, today: string) {
    const islandId = actor.islandId ?? '__none__';
    const dayStart = startOfBusinessDay(today);
    const sessions = await this.prisma.cashSession.findMany({
      where: { status: 'OPEN', register: { site: { islandId } } },
      include: {
        operations: { select: { direction: true, amount: true } },
        register: { include: { site: true } },
      },
    });
    const balance = sessions.reduce(
      (s, x) =>
        s +
        x.openingAmount +
        x.operations.reduce((a, o) => a + (o.direction === 'IN' ? o.amount : -o.amount), 0),
      0,
    );
    const [collected, toPay] = await Promise.all([
      this.prisma.cashOperation.aggregate({
        where: {
          direction: 'IN',
          at: { gte: dayStart, lt: startOfBusinessDay(addDays(today, 1)) },
          session: { register: { site: { islandId } } },
        },
        _sum: { amount: true },
      }),
      this.prisma.settlement.count({ where: { islandId, status: 'APPROVED' } }),
    ]);
    const kpis: DashboardKpi[] = [
      kpi({
        key: 'cashBalance',
        label:
          sessions.length === 1
            ? `Solde caisse ${sessions[0]!.register.site.name}`
            : 'Solde des caisses',
        value: sessions.length ? balance : null,
        format: 'kmf',
        hint: sessions.length ? `${sessions.length} caisse(s) ouverte(s)` : 'Aucune caisse ouverte',
        tone: 'blue',
        link: '/caisse',
      }),
      kpi({
        key: 'collectedToday',
        label: 'Encaissé aujourd’hui',
        value: collected._sum.amount ?? 0,
        format: 'kmf',
        hint: 'Ventes livrées et comptoir',
        tone: 'white',
        link: '/caisse',
      }),
      kpi({
        key: 'toPay',
        label: 'Règlements validés à payer',
        value: toPay,
        format: 'int',
        tone: 'white',
        link: '/reglements?status=APPROVED',
      }),
      kpi({
        key: 'toClose',
        label: 'Caisse à clôturer',
        value: sessions.length,
        format: 'int',
        hint: 'Clôture avec écart théorique / réel',
        tone: 'orange',
        link: '/caisse',
      }),
    ];
    return {
      period: { label: 'Aujourd’hui', start: today, end: today },
      kpis,
      todo: [
        {
          key: 'toPay',
          label: 'Règlements validés à payer',
          count: toPay,
          link: '/reglements?status=APPROVED',
        },
        {
          key: 'toClose',
          label: 'Caisse à clôturer ce soir',
          count: sessions.length,
          link: '/caisse',
        },
      ],
    };
  }

  // --- Stock ----------------------------------------------------------------------------------

  private async stockManager(actor: AuthUser, today: string) {
    const islandId = actor.islandId ?? '__none__';
    const [summary, inTransit, toReceive, returns] = await Promise.all([
      this.stock.summary({}, actor),
      this.prisma.purchaseOrder.count({
        where: { status: { in: [...IN_TRANSIT_PO] }, destinationSite: { islandId } },
      }),
      this.prisma.purchaseOrder.count({
        where: { status: { in: ['ARRIVED', 'IN_CUSTOMS'] }, destinationSite: { islandId } },
      }),
      this.prisma.order.count({ where: { islandId, status: 'RETURN_IN_PROGRESS' } }),
    ]);
    const alerts = summary.alerts.LOW + summary.alerts.OUT;
    return {
      period: { label: 'Aujourd’hui', start: today, end: today },
      kpis: [
        kpi({
          key: 'stockValue',
          label: 'Valeur du stock',
          value: summary.value,
          format: 'kmf',
          hint: 'Au coût rendu',
          tone: 'blue',
          link: '/stock',
        }),
        kpi({
          key: 'units',
          label: 'Unités en stock',
          value: summary.units,
          format: 'int',
          hint: `${summary.reserved} réservée(s)`,
          tone: 'white',
          link: '/stock',
        }),
        kpi({
          key: 'alerts',
          label: 'Alertes',
          value: alerts,
          format: 'int',
          hint: `${summary.alerts.OUT} rupture(s), ${summary.alerts.UNSOLD} invendu(s)`,
          tone: 'orange',
          link: '/stock?alert=any',
        }),
        kpi({
          key: 'inTransit',
          label: 'Lots en route',
          value: inTransit,
          format: 'int',
          hint: 'Commandés, en transport ou en douane',
          tone: 'white',
          link: '/achats',
        }),
      ],
      todo: [
        { key: 'toReceive', label: 'Lots à réceptionner', count: toReceive, link: '/achats' },
        {
          key: 'returns',
          label: 'Retours à contrôler',
          count: returns,
          alert: true,
          link: '/commandes?status=RETURN_IN_PROGRESS',
        },
        {
          key: 'inventoryDiffs',
          label: 'Écarts d’inventaire',
          count: summary.alerts.INVENTORY_DIFF,
          link: '/stock?alert=INVENTORY_DIFF',
        },
      ],
    };
  }

  // --- Logistique -----------------------------------------------------------------------------

  private async logistics(actor: AuthUser, today: string) {
    const islandId = actor.islandId ?? '__none__';
    const count = (where: Prisma.OrderWhereInput) =>
      this.prisma.order.count({ where: { islandId, ...where } });
    const [fresh, toPrepare, noCourier, delivering, pickup, incidents] = await Promise.all([
      count({ status: 'NEW' }),
      count({ status: { in: ['NEW', 'CONFIRMED', 'PREPARING'] } }),
      count({ status: 'READY', courierId: null, deliveryMode: { not: 'PICKUP' } }),
      count({ status: { in: ['ASSIGNED', 'OUT_FOR_DELIVERY'] } }),
      count({ status: 'READY', deliveryMode: 'PICKUP' }),
      count({ status: { in: [...INCIDENTS] } }),
    ]);
    return {
      period: { label: 'Aujourd’hui', start: today, end: today },
      kpis: [
        kpi({
          key: 'new',
          label: 'Nouvelles commandes',
          value: fresh,
          format: 'int',
          hint: 'À confirmer et préparer',
          tone: 'blue',
          link: '/commandes?status=NEW',
        }),
        kpi({
          key: 'noCourier',
          label: 'Sans livreur',
          value: noCourier,
          format: 'int',
          hint: 'Notifiées, pas encore acceptées',
          tone: 'orange',
          link: '/livraisons',
        }),
        kpi({
          key: 'delivering',
          label: 'En livraison',
          value: delivering,
          format: 'int',
          tone: 'white',
          link: '/livraisons',
        }),
        kpi({
          key: 'incidents',
          label: 'Incidents',
          value: incidents,
          format: 'int',
          hint: 'Refus, échecs, retours',
          tone: 'white',
          link: '/livraisons',
        }),
      ],
      todo: [
        {
          key: 'toPrepare',
          label: 'Commandes à préparer',
          count: toPrepare,
          link: '/commandes?status=CONFIRMED',
        },
        { key: 'manual', label: 'À affecter manuellement', count: noCourier, link: '/livraisons' },
        { key: 'pickup', label: 'Prêtes au retrait', count: pickup, link: '/livraisons' },
        {
          key: 'incidents',
          label: 'Refus et échecs',
          count: incidents,
          alert: true,
          link: '/livraisons',
        },
      ],
      recentOrders: await this.recentOrders({ islandId }),
    };
  }

  // --- Leader Senior --------------------------------------------------------------------------

  private async leaderSenior(actor: AuthUser, today: string) {
    const cycle = await this.currentCycle(today);
    const [team, totals, inProgress, refused] = await Promise.all([
      this.network.team(actor.id, cycle),
      salesTotals(this.prisma, { from: cycle.start, to: cycle.end, leaderId: actor.id }),
      this.prisma.order.count({ where: { leaderId: actor.id, status: { in: [...IN_PROGRESS] } } }),
      this.prisma.order.count({ where: { leaderId: actor.id, status: { in: [...INCIDENTS] } } }),
    ]);
    const remaining = team.members.reduce((s, m) => s + m.remaining, 0);
    return {
      period: { label: 'Cycle en cours', ...cycle },
      kpis: [
        kpi({
          key: 'teamSales',
          label: 'Ventes de l’équipe',
          value: totals.quantity,
          format: 'int',
          hint: 'Produits vendus, cycle en cours',
          tone: 'blue',
          link: '/commandes?status=SOLD',
        }),
        kpi({
          key: 'teamRevenue',
          label: 'CA généré par l’équipe',
          value: totals.revenue,
          format: 'kmf',
          hint: 'Prix de vente final',
          tone: 'white',
          link: `/rapports?type=seller&from=${cycle.start}&to=${cycle.end}`,
        }),
        kpi({
          key: 'activeSellers',
          label: 'E-commerçants actifs',
          value: team.activeMembers,
          format: 'int',
          hint: `${team.members.length} dans l’équipe`,
          tone: 'white',
          link: '/reseau',
        }),
        kpi({
          key: 'remaining',
          label: 'Quantités restantes',
          value: remaining,
          format: 'int',
          hint: 'Attribuées, pas encore vendues',
          tone: 'orange',
          link: '/reseau',
        }),
      ],
      todo: [
        {
          key: 'inProgress',
          label: 'Commandes de l’équipe en cours',
          count: inProgress,
          link: '/commandes',
        },
        {
          key: 'refused',
          label: 'Refus dans l’équipe',
          count: refused,
          alert: true,
          link: '/commandes?status=REFUSED',
        },
      ],
      ranking: {
        title: 'Classement de l’équipe',
        rows: [...team.members]
          .sort((a, b) => b.revenue - a.revenue)
          .map((m) => ({
            id: m.id,
            fullName: m.fullName,
            sold: m.sold,
            revenue: m.revenue,
            remaining: m.remaining,
          })),
      },
      recentOrders: await this.recentOrders({ leaderId: actor.id }),
    };
  }

  // --- Leader Junior --------------------------------------------------------------------------

  private async leaderJunior(actor: AuthUser, today: string) {
    const week = isoWeekOf(today);
    const range = isoWeekRange(week);
    const [campaigns, prospects, inProgress, earnings] = await Promise.all([
      this.campaigns.list(actor),
      this.prisma.prospect.groupBy({
        by: ['status'],
        where: { campaign: { leaderId: actor.id } },
        _count: { _all: true },
      }),
      this.prisma.order.count({ where: { leaderId: actor.id, status: { in: [...IN_PROGRESS] } } }),
      this.tci.teamEarnings(actor, week),
    ]);
    const active = campaigns.filter((c) => c.status === 'ACTIVE');
    const budget = campaigns.reduce((s, c) => s + c.budget, 0);
    const contacts = campaigns.reduce((s, c) => s + c.contacts, 0);
    const confirmed = campaigns.reduce((s, c) => s + c.confirmed, 0);
    const sold = campaigns.reduce((s, c) => s + c.sold, 0);
    const n = (s: string) => prospects.find((p) => p.status === s)?._count._all ?? 0;
    return {
      period: { label: `Semaine ${week.slice(-2)}`, ...range },
      kpis: [
        kpi({
          key: 'budget',
          label: 'Budget publicitaire',
          value: budget,
          format: 'kmf',
          hint: `${active.length} campagne(s) active(s)`,
          tone: 'blue',
          link: '/campagnes',
        }),
        kpi({
          key: 'contacts',
          label: 'Contacts reçus',
          value: contacts,
          format: 'int',
          hint: contacts
            ? `Taux de confirmation ${Math.round((confirmed / contacts) * 100)} %`
            : 'Aucun contact',
          tone: 'white',
          link: '/prospects',
        }),
        kpi({
          key: 'sold',
          label: 'Ventes validées',
          value: sold,
          format: 'int',
          hint: `${earnings.soldCount} cette semaine`,
          tone: 'white',
          link: '/ventes-tci',
        }),
        kpi({
          key: 'costPerSale',
          label: 'Coût par vente',
          value: sold ? Math.round(budget / sold) : null,
          format: 'kmf',
          hint: 'Budget ÷ ventes',
          tone: 'orange',
          link: '/campagnes',
        }),
      ],
      todo: [
        {
          key: 'toCall',
          label: 'Prospects à appeler par l’équipe',
          count: n('TO_CALL'),
          link: '/prospects',
        },
        {
          key: 'recall',
          label: 'À rappeler (injoignables)',
          count: n('UNREACHABLE'),
          link: '/prospects',
        },
        {
          key: 'inProgress',
          label: 'Commandes de l’équipe en cours',
          count: inProgress,
          link: '/commandes',
        },
      ],
      ranking: {
        title: 'Téléconseillers de la semaine',
        rows: (earnings.byTci ?? []).map((t) => ({
          id: t.tci.id,
          fullName: t.tci.fullName,
          sold: t.soldCount,
          revenue: t.soldAmount,
        })),
      },
    };
  }

  // --- Téléconseiller -------------------------------------------------------------------------

  private async teleconsultant(actor: AuthUser, today: string) {
    const week = isoWeekOf(today);
    const [earnings, prospects] = await Promise.all([
      this.tci.myEarnings(actor, week),
      this.prisma.prospect.groupBy({
        by: ['status'],
        where: { assignedTciId: actor.id },
        _count: { _all: true },
      }),
    ]);
    const n = (s: string) => prospects.find((p) => p.status === s)?._count._all ?? 0;
    return {
      period: { label: `Semaine ${week.slice(-2)}`, ...earnings.week },
      kpis: [
        kpi({
          key: 'toCall',
          label: 'Prospects à appeler',
          value: n('TO_CALL') + n('UNREACHABLE'),
          format: 'int',
          hint: `${n('UNREACHABLE')} à rappeler`,
          tone: 'blue',
          link: '/prospects',
        }),
        kpi({
          key: 'soldWeek',
          label: 'Vendu cette semaine',
          value: earnings.soldAmount,
          format: 'kmf',
          hint: `${earnings.soldCount} produit(s) vendu(s)`,
          tone: 'white',
          link: '/ventes-tci',
        }),
        kpi({
          key: 'weekEarnings',
          label: 'Mes gains de la semaine',
          value: earnings.weekEarnings,
          format: 'kmf',
          hint: 'Primes des ventes clôturées',
          tone: 'orange',
          link: '/ventes-tci',
        }),
        kpi({
          key: 'totalEarnings',
          label: 'Mes gains globaux',
          value: earnings.totalEarnings,
          format: 'kmf',
          hint: 'Depuis le début',
          tone: 'white',
          link: '/ventes-tci',
        }),
      ],
      todo: [
        { key: 'toCall', label: 'Prospects à appeler', count: n('TO_CALL'), link: '/prospects' },
        { key: 'recall', label: 'À rappeler', count: n('UNREACHABLE'), link: '/prospects' },
        {
          key: 'toClose',
          label: 'Ventes livrées à clôturer',
          count: earnings.toClose.length,
          alert: earnings.toClose.length > 0,
          link: '/ventes-tci',
        },
      ],
    };
  }
}
