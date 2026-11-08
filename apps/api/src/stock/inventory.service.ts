import { HttpStatus, Injectable } from '@nestjs/common';
import type { InventoryCountInput, InventoryView } from '@digecom/shared';
import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { notFound } from '../scope/scope.service';
import { StockQueryService } from './stock-query.service';
import { StockService } from './stock.service';

const INCLUDE = {
  site: {
    select: { id: true, name: true, island: { select: { id: true, code: true, name: true } } },
  },
  startedBy: { select: { id: true, fullName: true } },
  lines: {
    include: { product: { select: { sku: true, name: true } } },
    orderBy: { product: { name: 'asc' } },
  },
} satisfies Prisma.InventoryInclude;

type Row = Prisma.InventoryGetPayload<{ include: typeof INCLUDE }>;

const conflict = (message: string) => new AppException('CONFLICT', message, HttpStatus.CONFLICT);

function toView(i: Row): InventoryView {
  return {
    id: i.id,
    status: i.status,
    site: i.site,
    startedAt: i.startedAt.toISOString(),
    closedAt: i.closedAt?.toISOString() ?? null,
    startedBy: i.startedBy,
    lines: i.lines.map((l) => ({
      productId: l.productId,
      sku: l.product.sku,
      productName: l.product.name,
      expected: l.expected,
      counted: l.counted,
      difference: l.difference,
    })),
  };
}

/** Inventaires : photo du stock théorique, comptage, clôture avec écarts via StockService. */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly query: StockQueryService,
  ) {}

  async list(actor: AuthUser): Promise<InventoryView[]> {
    const rows = await this.prisma.inventory.findMany({
      where: { site: this.query.siteScope(actor) },
      include: INCLUDE,
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
    return rows.map(toView);
  }

  async get(id: string, actor: AuthUser): Promise<InventoryView> {
    const row = await this.prisma.inventory.findFirst({
      where: { id, site: this.query.siteScope(actor) },
      include: INCLUDE,
    });
    if (!row) throw notFound('Inventaire');
    return toView(row);
  }

  async start(siteId: string, actor: AuthUser): Promise<InventoryView> {
    await this.query.ensureSite(actor, siteId, { active: true });
    const open = await this.prisma.inventory.findFirst({ where: { siteId, status: 'OPEN' } });
    if (open) throw conflict('Un inventaire est déjà en cours sur ce site');
    const levels = await this.prisma.stockLevel.findMany({ where: { siteId } });
    const inv = await this.prisma.inventory.create({
      data: {
        siteId,
        startedById: actor.id,
        lines: {
          create: levels.map((l) => ({
            productId: l.productId,
            expected: l.available + l.reserved,
          })),
        },
      },
      include: INCLUDE,
    });
    return toView(inv);
  }

  async count(id: string, input: InventoryCountInput, actor: AuthUser): Promise<InventoryView> {
    const inv = await this.get(id, actor);
    if (inv.status !== 'OPEN') throw conflict('Cet inventaire est clôturé');
    const known = new Map(inv.lines.map((l) => [l.productId, l]));
    await this.prisma.$transaction(
      input.lines.map((line) => {
        const existing = known.get(line.productId);
        return existing
          ? this.prisma.inventoryLine.update({
              where: { inventoryId_productId: { inventoryId: id, productId: line.productId } },
              data: { counted: line.counted, difference: line.counted - existing.expected },
            })
          : // Produit trouvé sur place mais absent du stock théorique.
            this.prisma.inventoryLine.create({
              data: {
                inventoryId: id,
                productId: line.productId,
                expected: 0,
                counted: line.counted,
                difference: line.counted,
              },
            });
      }),
    );
    return this.get(id, actor);
  }

  async close(id: string, actor: AuthUser): Promise<InventoryView> {
    const inv = await this.get(id, actor);
    if (inv.status !== 'OPEN') throw conflict('Cet inventaire est déjà clôturé');
    const missing = inv.lines.filter((l) => l.counted === null);
    if (missing.length) {
      throw new AppException(
        'VALIDATION_ERROR',
        `${missing.length} produit(s) non compté(s)`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        missing.map((l) => ({ path: l.productId, message: `${l.productName} non compté` })),
      );
    }
    await this.prisma.$transaction(
      async (tx) => {
        for (const line of inv.lines) {
          if (!line.difference) continue;
          await this.stock.inventoryDiff(
            {
              productId: line.productId,
              siteId: inv.site.id,
              byId: actor.id,
              difference: line.difference,
              inventoryId: id,
            },
            tx,
          );
          await tx.stockAlert.create({
            data: {
              type: 'INVENTORY_DIFF',
              productId: line.productId,
              siteId: inv.site.id,
              value: line.difference,
            },
          });
        }
        await tx.inventory.update({
          where: { id },
          data: { status: 'CLOSED', closedAt: new Date(), closedById: actor.id },
        });
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
    return this.get(id, actor);
  }

  async cancel(id: string, actor: AuthUser): Promise<InventoryView> {
    const inv = await this.get(id, actor);
    if (inv.status !== 'OPEN') throw conflict('Cet inventaire est déjà clôturé');
    await this.prisma.inventory.update({
      where: { id },
      data: { status: 'CANCELLED', closedAt: new Date(), closedById: actor.id },
    });
    return this.get(id, actor);
  }
}
