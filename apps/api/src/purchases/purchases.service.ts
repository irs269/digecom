import { HttpStatus, Injectable } from '@nestjs/common';
import {
  lotTotalCost,
  lotUnitCost,
  NEXT_PURCHASE_STATUS,
  PURCHASE_STATUS_LABELS,
  startOfBusinessDay,
  toKmf,
  type PurchaseOrderInput,
  type PurchaseOrderStatus,
  type PurchaseOrderView,
  type ReceivePurchaseInput,
  type SupplierInput,
  type SupplierView,
} from '@digecom/shared';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { notFound } from '../scope/scope.service';
import { CounterService } from '../stock/counter.service';
import { StockQueryService } from '../stock/stock-query.service';
import { StockService } from '../stock/stock.service';
import { LedgerService } from '../finance/ledger.service';

const INCLUDE = {
  supplier: { select: { id: true, name: true } },
  product: {
    select: { id: true, name: true, sku: true, leader: { select: { id: true, fullName: true } } },
  },
  destinationSite: {
    select: { id: true, name: true, island: { select: { id: true, code: true, name: true } } },
  },
} satisfies Prisma.PurchaseOrderInclude;

type Row = Prisma.PurchaseOrderGetPayload<{ include: typeof INCLUDE }>;

const DATE_FIELD: Record<Exclude<PurchaseOrderStatus, 'DRAFT'>, keyof Row> = {
  ORDERED: 'orderedAt',
  IN_TRANSIT: 'inTransitAt',
  ARRIVED: 'arrivedAt',
  IN_CUSTOMS: 'inCustomsAt',
  RECEIVED: 'receivedAt',
  CLOSED: 'closedAt',
};

const invalid = (path: string, message: string) =>
  new AppException('VALIDATION_ERROR', message, HttpStatus.UNPROCESSABLE_ENTITY, [
    { path, message },
  ]);
const badTransition = (message: string) =>
  new AppException('INVALID_TRANSITION', message, HttpStatus.CONFLICT);

export function toPurchaseView(r: Row): PurchaseOrderView {
  const costs = {
    purchaseKmf: r.purchaseAmountKmf,
    shippingKmf: r.shippingKmf,
    customsKmf: r.customsKmf,
    otherFeesKmf: r.otherFeesKmf,
  };
  const dates: PurchaseOrderView['dates'] = { DRAFT: r.createdAt.toISOString() };
  for (const [status, field] of Object.entries(DATE_FIELD)) {
    const v = r[field];
    if (v instanceof Date) dates[status as PurchaseOrderStatus] = v.toISOString();
  }
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    supplier: r.supplier,
    product: r.product,
    destinationSite: r.destinationSite,
    quantity: r.quantity,
    receivedQuantity: r.receivedQuantity,
    currency: r.currency,
    exchangeRate: Number(r.exchangeRate),
    purchaseAmountForeign: Number(r.purchaseAmountForeign),
    purchaseAmountKmf: r.purchaseAmountKmf,
    shippingKmf: r.shippingKmf,
    customsKmf: r.customsKmf,
    otherFeesKmf: r.otherFeesKmf,
    totalCostKmf: lotTotalCost(costs),
    unitCost: lotUnitCost(costs, r.receivedQuantity ?? r.quantity),
    paidAmountKmf: r.paidAmountKmf,
    paidAt: r.paidAt?.toISOString() ?? null,
    notes: r.notes,
    dates,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Achats en Chine : fournisseurs, commandes fournisseurs (= futurs lots), avancement des statuts,
 * réception → création du lot au coût réel et entrée en stock (StockService).
 */
@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly counters: CounterService,
    private readonly query: StockQueryService,
    private readonly ledger: LedgerService,
  ) {}

  // --- Fournisseurs ------------------------------------------------------------------------

  async suppliers(): Promise<SupplierView[]> {
    return this.prisma.supplier.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, platform: true, contact: true, isActive: true },
    });
  }

  async createSupplier(input: SupplierInput): Promise<SupplierView> {
    try {
      return await this.prisma.supplier.create({
        data: input,
        select: { id: true, name: true, platform: true, contact: true, isActive: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppException(
          'SUPPLIER_EXISTS',
          'Ce fournisseur existe déjà',
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }

  async updateSupplier(id: string, input: Partial<SupplierInput> & { isActive?: boolean }) {
    if (!(await this.prisma.supplier.findUnique({ where: { id } }))) throw notFound('Fournisseur');
    try {
      return await this.prisma.supplier.update({
        where: { id },
        data: input,
        select: { id: true, name: true, platform: true, contact: true, isActive: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppException(
          'SUPPLIER_EXISTS',
          'Ce fournisseur existe déjà',
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }

  // --- Commandes fournisseurs ---------------------------------------------------------------

  private scope(actor: AuthUser): Prisma.PurchaseOrderWhereInput {
    return { destinationSite: this.query.siteScope(actor) };
  }

  async list(actor: AuthUser, status?: PurchaseOrderStatus): Promise<PurchaseOrderView[]> {
    const rows = await this.prisma.purchaseOrder.findMany({
      where: { AND: [this.scope(actor), { status }] },
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toPurchaseView);
  }

  async get(id: string, actor: AuthUser): Promise<PurchaseOrderView> {
    return toPurchaseView(await this.row(id, actor));
  }

  private async row(id: string, actor: AuthUser): Promise<Row> {
    const row = await this.prisma.purchaseOrder.findFirst({
      where: { AND: [{ id }, this.scope(actor)] },
      include: INCLUDE,
    });
    if (!row) throw notFound('Commande fournisseur');
    return row;
  }

  async create(input: PurchaseOrderInput, actor: AuthUser): Promise<PurchaseOrderView> {
    await this.query.ensureSite(actor, input.destinationSiteId, { active: true });
    await this.checkRefs(input.supplierId, input.productId);
    const number = await this.counters.formatted('LOT', 'LOT-', 3);
    const row = await this.prisma.purchaseOrder.create({
      data: {
        number,
        supplierId: input.supplierId,
        productId: input.productId,
        destinationSiteId: input.destinationSiteId,
        quantity: input.quantity,
        currency: input.currency,
        exchangeRate: new Prisma.Decimal(input.exchangeRate),
        purchaseAmountForeign: new Prisma.Decimal(input.purchaseAmountForeign),
        purchaseAmountKmf: toKmf(input.purchaseAmountForeign, input.exchangeRate),
        shippingKmf: input.shippingKmf,
        customsKmf: input.customsKmf,
        otherFeesKmf: input.otherFeesKmf,
        notes: input.notes,
        createdById: actor.id,
      },
      include: INCLUDE,
    });
    return toPurchaseView(row);
  }

  /** Modification des montants et frais tant que le lot n'est pas réceptionné. */
  async update(
    id: string,
    input: Partial<PurchaseOrderInput>,
    actor: AuthUser,
  ): Promise<{ before: PurchaseOrderView; after: PurchaseOrderView }> {
    const existing = await this.row(id, actor);
    if (existing.status === 'RECEIVED' || existing.status === 'CLOSED') {
      throw badTransition('Un lot réceptionné ne se modifie plus (son coût est figé)');
    }
    if (input.destinationSiteId)
      await this.query.ensureSite(actor, input.destinationSiteId, { active: true });
    if (input.supplierId || input.productId) {
      await this.checkRefs(
        input.supplierId ?? existing.supplierId,
        input.productId ?? existing.productId,
      );
    }
    const rate = input.exchangeRate ?? Number(existing.exchangeRate);
    const foreign = input.purchaseAmountForeign ?? Number(existing.purchaseAmountForeign);
    const row = await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        supplierId: input.supplierId,
        productId: input.productId,
        destinationSiteId: input.destinationSiteId,
        quantity: input.quantity,
        currency: input.currency,
        exchangeRate: new Prisma.Decimal(rate),
        purchaseAmountForeign: new Prisma.Decimal(foreign),
        purchaseAmountKmf: toKmf(foreign, rate),
        shippingKmf: input.shippingKmf,
        customsKmf: input.customsKmf,
        otherFeesKmf: input.otherFeesKmf,
        notes: input.notes,
      },
      include: INCLUDE,
    });
    return { before: toPurchaseView(existing), after: toPurchaseView(row) };
  }

  /** Étape suivante (la réception passe obligatoirement par `receive`). */
  async advance(
    id: string,
    actor: AuthUser,
  ): Promise<{ before: PurchaseOrderView; after: PurchaseOrderView }> {
    const existing = await this.row(id, actor);
    const next = NEXT_PURCHASE_STATUS[existing.status];
    if (!next) throw badTransition('Ce lot est déjà clôturé');
    if (next === 'RECEIVED') {
      throw badTransition('La réception se fait avec le site et la quantité réellement reçue');
    }
    const row = await this.prisma.purchaseOrder.update({
      where: { id, status: existing.status },
      data: {
        status: next,
        [DATE_FIELD[next as Exclude<PurchaseOrderStatus, 'DRAFT'>]]: new Date(),
      },
      include: INCLUDE,
    });
    return { before: toPurchaseView(existing), after: toPurchaseView(row) };
  }

  /**
   * Réception : crée le lot (numéro de la commande) au coût réel / quantité reçue et l'entre en
   * stock sur le site choisi (île de destination), dans une seule transaction.
   */
  async receive(
    id: string,
    input: ReceivePurchaseInput,
    actor: AuthUser,
  ): Promise<{ before: PurchaseOrderView; after: PurchaseOrderView }> {
    const existing = await this.row(id, actor);
    if (existing.status !== 'ARRIVED' && existing.status !== 'IN_CUSTOMS') {
      throw badTransition(
        `Réception impossible depuis l’état « ${PURCHASE_STATUS_LABELS[existing.status]} » (lot arrivé ou en dédouanement attendu)`,
      );
    }
    const siteId = input.siteId ?? existing.destinationSiteId;
    const site = await this.query.ensureSite(actor, siteId, { active: true });
    if (site.islandId !== existing.destinationSite.island.id) {
      throw invalid('siteId', 'Le site de réception doit être sur l’île de destination');
    }
    const unitCost = lotUnitCost(
      {
        purchaseKmf: existing.purchaseAmountKmf,
        shippingKmf: existing.shippingKmf,
        customsKmf: existing.customsKmf,
        otherFeesKmf: existing.otherFeesKmf,
      },
      input.receivedQuantity,
    );
    const receivedAt = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      // Mise à jour conditionnelle : deux réceptions simultanées ne créent pas deux lots.
      const { count } = await tx.purchaseOrder.updateMany({
        where: { id, status: existing.status },
        data: {
          status: 'RECEIVED',
          receivedAt,
          receivedQuantity: input.receivedQuantity,
          destinationSiteId: siteId,
          paidAmountKmf: input.paidAmountKmf,
          paidAt: input.paidAt ? startOfBusinessDay(input.paidAt) : undefined,
        },
      });
      if (count === 0) throw badTransition('Ce lot vient d’être réceptionné');
      await this.stock.entry(
        {
          productId: existing.productId,
          siteId,
          byId: actor.id,
          quantity: input.receivedQuantity,
          unitCost,
          lotNumber: existing.number,
          purchaseOrderId: id,
          receivedAt,
          reason: `Réception ${existing.number}`,
        },
        tx,
      );
      // Paiement fournisseur enregistré une seule fois, à la réception (SPEC 4.4 §1).
      await this.ledger.supplierPayment(tx, {
        purchaseOrderId: id,
        amount: input.paidAmountKmf ?? existing.purchaseAmountKmf,
        islandId: site.islandId,
        at: input.paidAt ? startOfBusinessDay(input.paidAt) : receivedAt,
        byId: actor.id,
      });
      return tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    });
    return { before: toPurchaseView(existing), after: toPurchaseView(row) };
  }

  private async checkRefs(supplierId: string, productId: string) {
    const [supplier, product] = await Promise.all([
      this.prisma.supplier.findUnique({ where: { id: supplierId } }),
      this.prisma.product.findUnique({ where: { id: productId } }),
    ]);
    if (!supplier || !supplier.isActive)
      throw invalid('supplierId', 'Fournisseur inconnu ou inactif');
    if (!product) throw invalid('productId', 'Produit inconnu');
  }
}
