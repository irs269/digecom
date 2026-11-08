import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type Lot, type StockMovementType } from '@prisma/client';
import { createId } from './ids';
import { AppException } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { CounterService } from './counter.service';

/**
 * SEULE porte d'entrée pour modifier `StockLevel` (critère d'acceptation phase 2).
 *
 * Chaque opération :
 * - s'exécute dans une transaction (celle de l'appelant si fournie) ;
 * - verrouille la ligne `StockLevel (produit, site)` avec `SELECT … FOR UPDATE` ;
 * - écrit ses `StockMovement` (append-only) et met à jour `StockLevel` et les lots ;
 * - refuse tout résultat négatif (409).
 *
 * Invariant : somme des `Lot.remaining` d'un produit sur un site = disponible + réservé.
 */

type Tx = Prisma.TransactionClient;

export interface StockRef {
  productId: string;
  siteId: string;
  byId: string;
}

export interface ConsumedLot {
  lotId: string;
  lotNumber: string;
  quantity: number;
  unitCost: number;
}

export interface OutResult {
  consumed: ConsumedLot[];
  totalCost: number;
  /** Coût unitaire moyen pondéré de la sortie, arrondi au KMF. */
  unitCost: number;
}

interface LockedLevel {
  id: string;
  available: number;
  reserved: number;
}

const insufficient = (message: string, details?: unknown) =>
  new AppException('INSUFFICIENT_STOCK', message, HttpStatus.CONFLICT, details);

const invalidQuantity = () =>
  new AppException(
    'VALIDATION_ERROR',
    'La quantité doit être un entier strictement positif',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );

function assertQuantity(q: number) {
  if (!Number.isInteger(q) || q <= 0) throw invalidQuantity();
}

@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly counters: CounterService,
  ) {}

  // --- Opérations publiques -------------------------------------------------------------------

  /** Entrée d'un lot (réception d'achat, entrée manuelle) : crée le lot et augmente le disponible. */
  async entry(
    input: StockRef & {
      quantity: number;
      unitCost: number;
      lotNumber?: string;
      purchaseOrderId?: string;
      receivedAt?: Date;
      reason?: string;
    },
    tx?: Tx,
  ): Promise<{ lot: Lot }> {
    assertQuantity(input.quantity);
    return this.run(tx, async (db) => {
      const level = await this.lock(db, input);
      const number = input.lotNumber ?? (await this.counters.formatted('ENTRY', 'ENT-', 6, db));
      const lot = await db.lot.create({
        data: {
          number,
          productId: input.productId,
          siteId: input.siteId,
          purchaseOrderId: input.purchaseOrderId,
          quantity: input.quantity,
          remaining: input.quantity,
          unitCost: input.unitCost,
          receivedAt: input.receivedAt ?? new Date(),
        },
      });
      await this.move(db, input, 'ENTRY', input.quantity, {
        lotId: lot.id,
        unitCost: lot.unitCost,
        reason: input.reason,
      });
      await this.setLevel(db, level, level.available + input.quantity, level.reserved);
      return { lot };
    });
  }

  /** Réservation pour une commande : disponible → réservé. */
  async reserve(input: StockRef & { quantity: number; orderId: string }, tx?: Tx): Promise<void> {
    assertQuantity(input.quantity);
    return this.run(tx, async (db) => {
      const level = await this.lock(db, input);
      if (level.available < input.quantity) {
        throw insufficient(`Stock insuffisant : ${level.available} disponible(s)`, {
          available: level.available,
          requested: input.quantity,
        });
      }
      await this.move(db, input, 'RESERVE', input.quantity, { orderId: input.orderId });
      await this.setLevel(
        db,
        level,
        level.available - input.quantity,
        level.reserved + input.quantity,
      );
    });
  }

  /** Libération d'une réservation (annulation, refus avant sortie) : réservé → disponible. */
  async release(input: StockRef & { quantity: number; orderId: string }, tx?: Tx): Promise<void> {
    assertQuantity(input.quantity);
    return this.run(tx, async (db) => {
      const level = await this.lock(db, input);
      if (level.reserved < input.quantity) {
        throw insufficient(`Réservation insuffisante : ${level.reserved} réservé(s)`);
      }
      await this.move(db, input, 'RELEASE', input.quantity, { orderId: input.orderId });
      await this.setLevel(
        db,
        level,
        level.available + input.quantity,
        level.reserved - input.quantity,
      );
    });
  }

  /**
   * Sortie pour une vente : consomme les lots en FIFO et renvoie le coût (moyenne pondérée).
   * Par défaut, la sortie porte sur des unités réservées par la commande.
   */
  async out(
    input: StockRef & { quantity: number; orderId: string; fromReserved?: boolean },
    tx?: Tx,
  ): Promise<OutResult> {
    assertQuantity(input.quantity);
    const fromReserved = input.fromReserved ?? true;
    return this.run(tx, async (db) => {
      const level = await this.lock(db, input);
      const pool = fromReserved ? level.reserved : level.available;
      if (pool < input.quantity) {
        throw insufficient(
          fromReserved
            ? `Réservation insuffisante : ${level.reserved} réservé(s)`
            : `Stock insuffisant : ${level.available} disponible(s)`,
        );
      }
      const consumed = await this.consumeFifo(db, input, input.quantity, 'OUT', {
        orderId: input.orderId,
      });
      await this.setLevel(
        db,
        level,
        fromReserved ? level.available : level.available - input.quantity,
        fromReserved ? level.reserved - input.quantity : level.reserved,
      );
      return summarize(consumed);
    });
  }

  /**
   * Retour en stock d'unités sorties pour une commande (refus après sortie, retour client) :
   * les unités retournent dans les lots d'où elles sont sorties (coût conservé).
   */
  async returnToStock(
    input: StockRef & { quantity: number; orderId: string; reason?: string },
    tx?: Tx,
  ): Promise<OutResult> {
    assertQuantity(input.quantity);
    return this.run(tx, async (db) => {
      const level = await this.lock(db, input);
      const movements = await db.stockMovement.findMany({
        where: {
          orderId: input.orderId,
          productId: input.productId,
          siteId: input.siteId,
          type: { in: ['OUT', 'RETURN'] },
        },
        include: { lot: true },
        orderBy: { at: 'desc' },
      });
      // Unités encore « dehors » par lot = sorties − retours déjà faits.
      const outstanding = new Map<string, { lot: Lot; quantity: number }>();
      for (const m of [...movements].reverse()) {
        if (!m.lot) continue;
        const cur = outstanding.get(m.lot.id) ?? { lot: m.lot, quantity: 0 };
        cur.quantity += m.type === 'OUT' ? m.quantity : -m.quantity;
        outstanding.set(m.lot.id, cur);
      }
      const total = [...outstanding.values()].reduce((s, o) => s + o.quantity, 0);
      if (total < input.quantity) {
        throw insufficient(
          `Seulement ${total} unité(s) de cette commande peuvent revenir en stock`,
        );
      }
      // Les dernières unités sorties reviennent en premier.
      let left = input.quantity;
      const restored: ConsumedLot[] = [];
      for (const { lot, quantity } of [...outstanding.values()].reverse()) {
        if (left === 0) break;
        const q = Math.min(quantity, left);
        if (q <= 0) continue;
        await db.lot.update({ where: { id: lot.id }, data: { remaining: { increment: q } } });
        await this.move(db, input, 'RETURN', q, {
          lotId: lot.id,
          unitCost: lot.unitCost,
          orderId: input.orderId,
          reason: input.reason,
        });
        restored.push({
          lotId: lot.id,
          lotNumber: lot.number,
          quantity: q,
          unitCost: lot.unitCost,
        });
        left -= q;
      }
      await this.setLevel(db, level, level.available + input.quantity, level.reserved);
      return summarize(restored);
    });
  }

  /** Sortie hors vente (casse, perte, ajustement négatif) : FIFO sur le disponible. */
  async remove(
    input: StockRef & {
      quantity: number;
      type: 'DAMAGED' | 'LOSS' | 'ADJUST';
      reason: string;
      /** Commande concernée (casse constatée au retour d'une commande). */
      orderId?: string;
    },
    tx?: Tx,
  ): Promise<OutResult> {
    assertQuantity(input.quantity);
    return this.run(tx, async (db) => {
      const level = await this.lock(db, input);
      if (level.available < input.quantity) {
        throw insufficient(`Stock insuffisant : ${level.available} disponible(s)`);
      }
      const consumed = await this.consumeFifo(db, input, input.quantity, input.type, {
        reason: input.reason,
        orderId: input.orderId,
      });
      await this.setLevel(db, level, level.available - input.quantity, level.reserved);
      return summarize(consumed);
    });
  }

  /**
   * Ajustement avec motif : positif → nouveau lot (coût fourni ou coût moyen des lots en stock) ;
   * négatif → sortie FIFO.
   */
  async adjust(
    input: StockRef & { delta: number; reason: string; unitCost?: number },
    tx?: Tx,
  ): Promise<void> {
    if (!Number.isInteger(input.delta) || input.delta === 0) throw invalidQuantity();
    return this.run(tx, async (db) => {
      if (input.delta < 0) {
        await this.remove({ ...input, quantity: -input.delta, type: 'ADJUST' }, db);
        return;
      }
      await this.addAdjustmentLot(db, input, input.delta, 'ADJUST', input.reason, input.unitCost);
    });
  }

  /**
   * Transfert entre deux sites : sortie FIFO au départ, lots enfants (même coût) à l'arrivée,
   * deux mouvements liés par `transferId`.
   */
  async transfer(
    input: {
      productId: string;
      fromSiteId: string;
      toSiteId: string;
      quantity: number;
      reason: string;
      byId: string;
    },
    tx?: Tx,
  ): Promise<{ transferId: string }> {
    assertQuantity(input.quantity);
    if (input.fromSiteId === input.toSiteId) {
      throw new AppException(
        'VALIDATION_ERROR',
        'Les sites de départ et d’arrivée doivent être différents',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return this.run(tx, async (db) => {
      const from = { productId: input.productId, siteId: input.fromSiteId, byId: input.byId };
      const to = { productId: input.productId, siteId: input.toSiteId, byId: input.byId };
      // Verrous toujours pris dans le même ordre (évite les interblocages entre transferts croisés).
      const [first, second] = [from, to].sort((a, b) => a.siteId.localeCompare(b.siteId));
      const locked = new Map<string, LockedLevel>();
      locked.set(first!.siteId, await this.lock(db, first!));
      locked.set(second!.siteId, await this.lock(db, second!));
      const src = locked.get(from.siteId)!;
      const dst = locked.get(to.siteId)!;
      if (src.available < input.quantity) {
        throw insufficient(`Stock insuffisant au départ : ${src.available} disponible(s)`);
      }

      const transferId = createId();
      const consumed = await this.consumeFifo(db, from, input.quantity, 'TRANSFER_OUT', {
        transferId,
        reason: input.reason,
      });
      for (const c of consumed) {
        const number = await this.counters.formatted('TRANSFER', 'TRF-', 6, db);
        const child = await db.lot.create({
          data: {
            number,
            productId: input.productId,
            siteId: input.toSiteId,
            parentLotId: c.lotId,
            quantity: c.quantity,
            remaining: c.quantity,
            unitCost: c.unitCost,
          },
        });
        await this.move(db, to, 'TRANSFER_IN', c.quantity, {
          lotId: child.id,
          unitCost: c.unitCost,
          transferId,
          reason: input.reason,
        });
      }
      await this.setLevel(db, src, src.available - input.quantity, src.reserved);
      await this.setLevel(db, dst, dst.available + input.quantity, dst.reserved);
      return { transferId };
    });
  }

  /**
   * Écart d'inventaire (compté − théorique physique) : positif → lot d'écart ; négatif → sortie
   * FIFO sur le disponible (les unités réservées ne peuvent pas disparaître).
   */
  async inventoryDiff(
    input: StockRef & { difference: number; inventoryId: string },
    tx?: Tx,
  ): Promise<void> {
    if (!Number.isInteger(input.difference) || input.difference === 0) return;
    return this.run(tx, async (db) => {
      const reason = 'Écart d’inventaire';
      if (input.difference > 0) {
        await this.addAdjustmentLot(
          db,
          input,
          input.difference,
          'INVENTORY_DIFF',
          reason,
          undefined,
          {
            inventoryId: input.inventoryId,
          },
        );
        return;
      }
      const level = await this.lock(db, input);
      const q = -input.difference;
      if (level.available < q) {
        throw insufficient(
          `Écart de ${q} supérieur au disponible (${level.available}) : libère d’abord les réservations`,
        );
      }
      await this.consumeFifo(db, input, q, 'INVENTORY_DIFF', {
        reason,
        inventoryId: input.inventoryId,
      });
      await this.setLevel(db, level, level.available - q, level.reserved);
    });
  }

  // --- Mécanique interne ----------------------------------------------------------------------

  private run<T>(tx: Tx | undefined, fn: (db: Tx) => Promise<T>): Promise<T> {
    if (tx) return fn(tx);
    return this.prisma.$transaction(fn, { timeout: 30_000, maxWait: 30_000 });
  }

  /** Crée la ligne si besoin puis la verrouille (`SELECT … FOR UPDATE`). */
  private async lock(db: Tx, ref: { productId: string; siteId: string }): Promise<LockedLevel> {
    await db.$executeRaw`
      INSERT INTO "StockLevel" ("id", "productId", "siteId", "available", "reserved", "updatedAt")
      VALUES (${createId()}, ${ref.productId}, ${ref.siteId}, 0, 0, NOW())
      ON CONFLICT ("productId", "siteId") DO NOTHING`;
    const rows = await db.$queryRaw<LockedLevel[]>`
      SELECT "id", "available", "reserved" FROM "StockLevel"
      WHERE "productId" = ${ref.productId} AND "siteId" = ${ref.siteId}
      FOR UPDATE`;
    return rows[0]!;
  }

  private async setLevel(db: Tx, level: LockedLevel, available: number, reserved: number) {
    if (available < 0 || reserved < 0) {
      throw insufficient('Opération refusée : le stock deviendrait négatif');
    }
    await db.stockLevel.update({ where: { id: level.id }, data: { available, reserved } });
    level.available = available;
    level.reserved = reserved;
  }

  private move(
    db: Tx,
    ref: StockRef,
    type: StockMovementType,
    quantity: number,
    extra: {
      lotId?: string;
      unitCost?: number;
      orderId?: string;
      transferId?: string;
      inventoryId?: string;
      reason?: string;
    } = {},
  ) {
    return db.stockMovement.create({
      data: {
        productId: ref.productId,
        siteId: ref.siteId,
        type,
        quantity,
        byId: ref.byId,
        lotId: extra.lotId,
        unitCost: extra.unitCost,
        orderId: extra.orderId,
        transferId: extra.transferId,
        inventoryId: extra.inventoryId,
        reason: extra.reason,
      },
    });
  }

  /** Consomme `quantity` unités des lots du site en FIFO (plus ancien d'abord). */
  private async consumeFifo(
    db: Tx,
    ref: StockRef,
    quantity: number,
    type: StockMovementType,
    extra: { orderId?: string; transferId?: string; inventoryId?: string; reason?: string },
  ): Promise<ConsumedLot[]> {
    const lots = await db.$queryRaw<
      { id: string; number: string; remaining: number; unitCost: number }[]
    >`
      SELECT "id", "number", "remaining", "unitCost" FROM "Lot"
      WHERE "productId" = ${ref.productId} AND "siteId" = ${ref.siteId} AND "remaining" > 0
      ORDER BY "receivedAt" ASC, "createdAt" ASC, "id" ASC
      FOR UPDATE`;
    let left = quantity;
    const consumed: ConsumedLot[] = [];
    for (const lot of lots) {
      if (left === 0) break;
      const q = Math.min(lot.remaining, left);
      await db.lot.update({ where: { id: lot.id }, data: { remaining: { decrement: q } } });
      await this.move(db, ref, type, q, { lotId: lot.id, unitCost: lot.unitCost, ...extra });
      consumed.push({ lotId: lot.id, lotNumber: lot.number, quantity: q, unitCost: lot.unitCost });
      left -= q;
    }
    if (left > 0) {
      // Incohérence lots / niveau : on annule toute la transaction.
      throw insufficient('Lots insuffisants pour cette sortie (incohérence de stock)', {
        missing: left,
      });
    }
    return consumed;
  }

  private async addAdjustmentLot(
    db: Tx,
    ref: StockRef,
    quantity: number,
    type: 'ADJUST' | 'INVENTORY_DIFF',
    reason: string,
    unitCost?: number,
    extra: { inventoryId?: string } = {},
  ) {
    const level = await this.lock(db, ref);
    const cost = unitCost ?? (await this.averageCost(db, ref)) ?? (await this.lastCost(db, ref));
    if (cost === null) {
      // Jamais de stock à coût nul : la marge serait fausse (règle 4, coût rattaché au lot).
      throw new AppException(
        'UNIT_COST_REQUIRED',
        'Premier stock de ce produit : indique son coût unitaire',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'unitCost', message: 'Coût unitaire requis' }],
      );
    }
    const number = await this.counters.formatted('ADJUST', 'ADJ-', 6, db);
    const lot = await db.lot.create({
      data: {
        number,
        productId: ref.productId,
        siteId: ref.siteId,
        quantity,
        remaining: quantity,
        unitCost: cost,
      },
    });
    await this.move(db, ref, type, quantity, { lotId: lot.id, unitCost: cost, reason, ...extra });
    await this.setLevel(db, level, level.available + quantity, level.reserved);
  }

  /** Coût moyen pondéré des lots restants d'un produit sur un site. */
  private async averageCost(db: Tx, ref: { productId: string; siteId: string }) {
    const lots = await db.lot.findMany({
      where: { productId: ref.productId, siteId: ref.siteId, remaining: { gt: 0 } },
      select: { remaining: true, unitCost: true },
    });
    const units = lots.reduce((s, l) => s + l.remaining, 0);
    if (!units) return null;
    return Math.round(lots.reduce((s, l) => s + l.remaining * l.unitCost, 0) / units);
  }

  private async lastCost(db: Tx, ref: { productId: string }) {
    const lot = await db.lot.findFirst({
      where: { productId: ref.productId },
      orderBy: { receivedAt: 'desc' },
      select: { unitCost: true },
    });
    return lot?.unitCost ?? null;
  }
}

function summarize(consumed: ConsumedLot[]): OutResult {
  const quantity = consumed.reduce((s, c) => s + c.quantity, 0);
  const totalCost = consumed.reduce((s, c) => s + c.quantity * c.unitCost, 0);
  return { consumed, totalCost, unitCost: quantity ? Math.round(totalCost / quantity) : 0 };
}
