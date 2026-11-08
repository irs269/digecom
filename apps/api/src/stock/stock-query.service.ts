import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ROLE_SCOPE,
  type StockAlertKind,
  type StockListQuery,
  type StockMovementView,
  type StockRow,
  type StockSummary,
  type LotView,
} from '@digecom/shared';
import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { notFound } from '../scope/scope.service';
import { SettingsService } from '../settings/settings.service';

const DAY = 86_400_000;

/** Lectures du stock (vues, KPI, alertes, historique). Aucune écriture ici. */
@Injectable()
export class StockQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Sites accessibles : tous pour les rôles globaux, ceux de son île sinon. */
  siteScope(actor: AuthUser, islandId?: string): Prisma.SiteWhereInput {
    if (ROLE_SCOPE[actor.role] === 'GLOBAL') return islandId ? { islandId } : {};
    return { islandId: actor.islandId ?? '-' };
  }

  /** Vérifie qu'un site est dans le périmètre (404 sinon). */
  async ensureSite(actor: AuthUser, siteId: string, opts: { active?: boolean } = {}) {
    const site = await this.prisma.site.findFirst({
      where: { AND: [{ id: siteId }, this.siteScope(actor)] },
    });
    if (!site) throw notFound('Site');
    if (opts.active && !site.isActive) {
      throw new AppException(
        'VALIDATION_ERROR',
        'Ce site est désactivé',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return site;
  }

  async rows(q: StockListQuery, actor: AuthUser): Promise<StockRow[]> {
    const levels = await this.prisma.stockLevel.findMany({
      where: {
        site: { AND: [this.siteScope(actor, q.islandId), q.siteId ? { id: q.siteId } : {}] },
        product: {
          leaderId: q.leaderId,
          ...(q.q
            ? {
                OR: [
                  { name: { contains: q.q, mode: 'insensitive' } },
                  { sku: { contains: q.q, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
      },
      include: {
        site: {
          select: {
            id: true,
            name: true,
            island: { select: { id: true, code: true, name: true } },
          },
        },
        product: {
          select: {
            id: true,
            sku: true,
            name: true,
            salePrice: true,
            isPublished: true,
            lowStockThreshold: true,
            leader: { select: { id: true, fullName: true } },
          },
        },
      },
    });
    // Produits publiés sans aucune ligne de stock (jamais approvisionnés) : rupture sur le
    // premier site actif de l'île de leur leader.
    const neverStocked = await this.prisma.product.findMany({
      where: {
        isPublished: true,
        stockLevels: { none: {} },
        leaderId: q.leaderId,
        ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}),
      },
      select: {
        id: true,
        sku: true,
        name: true,
        salePrice: true,
        isPublished: true,
        lowStockThreshold: true,
        leader: { select: { id: true, fullName: true, islandId: true } },
      },
    });
    const sites = await this.prisma.site.findMany({
      where: {
        AND: [
          this.siteScope(actor, q.islandId),
          q.siteId ? { id: q.siteId } : {},
          { isActive: true },
        ],
      },
      select: {
        id: true,
        name: true,
        islandId: true,
        island: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ type: 'desc' }, { name: 'asc' }],
    });
    for (const p of neverStocked) {
      const site = sites.find((s) => s.islandId === p.leader.islandId);
      if (!site) continue;
      levels.push({
        id: `virtual-${p.id}`,
        productId: p.id,
        siteId: site.id,
        available: 0,
        reserved: 0,
        updatedAt: new Date(),
        site: { id: site.id, name: site.name, island: site.island },
        product: { ...p, leader: { id: p.leader.id, fullName: p.leader.fullName } },
      });
    }
    if (!levels.length) return [];

    const [lots, unsold, defaultThreshold] = await Promise.all([
      this.prisma.lot.findMany({
        where: {
          remaining: { gt: 0 },
          OR: levels.map((l) => ({ productId: l.productId, siteId: l.siteId })),
        },
        select: { productId: true, siteId: true, remaining: true, unitCost: true },
      }),
      this.prisma.stockAlert.findMany({
        where: { type: 'UNSOLD', resolvedAt: null },
        select: { productId: true, siteId: true },
      }),
      this.settings.get('stock.lowThresholdDefault'),
    ]);
    const key = (p: string, s: string) => `${p}|${s}`;
    const cost = new Map<string, { units: number; value: number }>();
    for (const lot of lots) {
      const k = key(lot.productId, lot.siteId);
      const c = cost.get(k) ?? { units: 0, value: 0 };
      c.units += lot.remaining;
      c.value += lot.remaining * lot.unitCost;
      cost.set(k, c);
    }
    const unsoldSet = new Set(unsold.map((u) => key(u.productId, u.siteId)));

    const rows = levels.map((l): StockRow => {
      const c = cost.get(key(l.productId, l.siteId));
      const threshold = l.product.lowStockThreshold ?? defaultThreshold;
      const alerts: StockAlertKind[] = [];
      if (l.available === 0 && l.product.isPublished) alerts.push('OUT');
      else if (l.available > 0 && l.available <= threshold) alerts.push('LOW');
      if (unsoldSet.has(key(l.productId, l.siteId))) alerts.push('UNSOLD');
      return {
        productId: l.productId,
        sku: l.product.sku,
        productName: l.product.name,
        leader: l.product.leader,
        site: l.site,
        available: l.available,
        reserved: l.reserved,
        unitCost: c && c.units ? Math.round(c.value / c.units) : null,
        value: c?.value ?? 0,
        salePrice: l.product.salePrice,
        alerts,
      };
    });
    const filtered =
      q.alert === 'any'
        ? rows.filter((r) => r.alerts.length > 0)
        : q.alert
          ? rows.filter((r) => r.alerts.includes(q.alert as StockAlertKind))
          : rows;
    return filtered.sort(
      (a, b) =>
        a.site.name.localeCompare(b.site.name) || a.productName.localeCompare(b.productName),
    );
  }

  async summary(q: StockListQuery, actor: AuthUser): Promise<StockSummary> {
    const rows = await this.rows({ ...q, alert: undefined }, actor);
    const inventoryDiffs = await this.prisma.stockAlert.count({
      where: {
        type: 'INVENTORY_DIFF',
        resolvedAt: null,
        site: this.siteScope(actor, q.islandId),
      },
    });
    const count = (k: StockAlertKind) => rows.filter((r) => r.alerts.includes(k)).length;
    return {
      value: rows.reduce((s, r) => s + r.value, 0),
      units: rows.reduce((s, r) => s + r.available + r.reserved, 0),
      reserved: rows.reduce((s, r) => s + r.reserved, 0),
      alerts: {
        LOW: count('LOW'),
        OUT: count('OUT'),
        UNSOLD: count('UNSOLD'),
        INVENTORY_DIFF: inventoryDiffs,
      },
    };
  }

  async movements(
    productId: string,
    actor: AuthUser,
    siteId?: string,
  ): Promise<StockMovementView[]> {
    const rows = await this.prisma.stockMovement.findMany({
      where: {
        productId,
        siteId,
        site: this.siteScope(actor),
        ...(actor.role === 'LEADER_SENIOR' || actor.role === 'LEADER_JUNIOR'
          ? { product: { leaderId: actor.id } }
          : {}),
      },
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      take: 300,
      include: {
        lot: { select: { id: true, number: true } },
        site: { select: { id: true, name: true } },
        by: { select: { id: true, fullName: true } },
      },
    });
    return rows.map((m) => ({
      id: m.id,
      at: m.at.toISOString(),
      type: m.type,
      quantity: m.quantity,
      unitCost: m.unitCost,
      reason: m.reason,
      orderId: m.orderId,
      transferId: m.transferId,
      lot: m.lot,
      site: m.site,
      by: m.by,
    }));
  }

  async lots(productId: string, actor: AuthUser): Promise<LotView[]> {
    const rows = await this.prisma.lot.findMany({
      where: { productId, site: this.siteScope(actor) },
      orderBy: { receivedAt: 'asc' },
      include: {
        site: { select: { id: true, name: true } },
        product: { select: { id: true, name: true, sku: true } },
      },
    });
    return rows.map((l) => ({
      id: l.id,
      number: l.number,
      quantity: l.quantity,
      remaining: l.remaining,
      unitCost: l.unitCost,
      receivedAt: l.receivedAt.toISOString(),
      site: l.site,
      product: l.product,
    }));
  }

  /**
   * Alertes « invendu » (job quotidien) : stock disponible sans vente depuis N jours.
   * Crée les alertes manquantes et clôt celles qui ne s'appliquent plus.
   */
  async refreshUnsoldAlerts(now = new Date()): Promise<{ opened: number; resolved: number }> {
    const days = await this.settings.get('stock.unsoldDaysAlert');
    const limit = new Date(now.getTime() - days * DAY);
    const levels = await this.prisma.stockLevel.findMany({ where: { available: { gt: 0 } } });
    const open = await this.prisma.stockAlert.findMany({
      where: { type: 'UNSOLD', resolvedAt: null },
    });
    const openKey = new Map(open.map((a) => [`${a.productId}|${a.siteId}`, a]));
    const shouldAlert = new Set<string>();

    for (const l of levels) {
      const lastSale = await this.prisma.stockMovement.findFirst({
        where: { productId: l.productId, siteId: l.siteId, type: 'OUT' },
        orderBy: { at: 'desc' },
        select: { at: true },
      });
      const oldestLot = await this.prisma.lot.findFirst({
        where: { productId: l.productId, siteId: l.siteId, remaining: { gt: 0 } },
        orderBy: { receivedAt: 'asc' },
        select: { receivedAt: true },
      });
      const reference = lastSale?.at ?? oldestLot?.receivedAt;
      if (reference && reference < limit) shouldAlert.add(`${l.productId}|${l.siteId}`);
    }

    let opened = 0;
    for (const k of shouldAlert) {
      if (openKey.has(k)) continue;
      const [productId, siteId] = k.split('|') as [string, string];
      await this.prisma.stockAlert.create({
        data: { type: 'UNSOLD', productId, siteId, value: days },
      });
      opened += 1;
    }
    const toResolve = open.filter((a) => !shouldAlert.has(`${a.productId}|${a.siteId}`));
    if (toResolve.length) {
      await this.prisma.stockAlert.updateMany({
        where: { id: { in: toResolve.map((a) => a.id) } },
        data: { resolvedAt: now },
      });
    }
    return { opened, resolved: toResolve.length };
  }
}
