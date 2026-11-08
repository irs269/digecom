import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  inventoryCountSchema,
  inventoryStartSchema,
  stockAdjustSchema,
  stockEntrySchema,
  stockListQuerySchema,
  stockTransferSchema,
  type InventoryCountInput,
  type InventoryView,
  type LotView,
  type StockAdjustInput,
  type StockEntryInput,
  type StockListQuery,
  type StockMovementView,
  type StockRow,
  type StockSummary,
  type StockTransferInput,
} from '@digecom/shared';
import { z } from 'zod';
import type { AuthenticatedRequest, AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { AppException } from '../common/app-exception';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { notFound } from '../scope/scope.service';
import { InventoryService } from './inventory.service';
import { StockQueryService } from './stock-query.service';
import { StockService } from './stock.service';

const historyQuerySchema = z.object({
  productId: z.string().min(1),
  siteId: z.string().optional(),
});

/** Module Stock : lecture par site, opérations tracées (entrée, ajustement, transfert, inventaire). */
@ApiTags('stock')
@ApiBearerAuth()
@Controller()
export class StockController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly query: StockQueryService,
    private readonly inventories: InventoryService,
  ) {}

  @Get('stock')
  @RequirePermission('stock:read')
  @ApiOperation({ summary: 'Stock par site (disponible, réservé, coût rendu, alertes)' })
  rows(
    @Query(new ZodValidationPipe(stockListQuerySchema)) q: StockListQuery,
    @CurrentUser() actor: AuthUser,
  ): Promise<StockRow[]> {
    return this.query.rows(q, actor);
  }

  @Get('stock/summary')
  @RequirePermission('stock:read')
  @ApiOperation({ summary: 'KPI : valeur au coût rendu, unités, alertes' })
  summary(
    @Query(new ZodValidationPipe(stockListQuerySchema)) q: StockListQuery,
    @CurrentUser() actor: AuthUser,
  ): Promise<StockSummary> {
    return this.query.summary(q, actor);
  }

  @Get('stock/movements')
  @RequirePermission('catalog:read')
  @ApiOperation({ summary: 'Historique des mouvements d’un produit' })
  movements(
    @Query(new ZodValidationPipe(historyQuerySchema)) q: z.infer<typeof historyQuerySchema>,
    @CurrentUser() actor: AuthUser,
  ): Promise<StockMovementView[]> {
    return this.query.movements(q.productId, actor, q.siteId);
  }

  @Get('stock/lots')
  @RequirePermission('stock:read')
  @ApiOperation({ summary: 'Lots d’un produit (FIFO, coût unitaire, restant)' })
  lots(
    @Query(new ZodValidationPipe(historyQuerySchema)) q: z.infer<typeof historyQuerySchema>,
    @CurrentUser() actor: AuthUser,
  ): Promise<LotView[]> {
    return this.query.lots(q.productId, actor);
  }

  @Post('stock/entry')
  @RequirePermission('stock:entry')
  @ApiOperation({ summary: 'Entrée manuelle (achat local…) avec coût unitaire et motif' })
  async entry(
    @Body(new ZodValidationPipe(stockEntrySchema)) body: StockEntryInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.query.ensureSite(actor, body.siteId, { active: true });
    await this.ensureProduct(body.productId);
    const { lot } = await this.stock.entry({ ...body, byId: actor.id });
    req.audit = {
      action: 'STOCK_ENTRY',
      entity: 'Lot',
      entityId: lot.id,
      after: { ...body, lot: lot.number },
    };
    return { lotId: lot.id, lotNumber: lot.number };
  }

  @Post('stock/adjust')
  @RequirePermission('stock:adjust')
  @ApiOperation({ summary: 'Ajustement, casse ou perte (motif obligatoire)' })
  async adjust(
    @Body(new ZodValidationPipe(stockAdjustSchema)) body: StockAdjustInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.query.ensureSite(actor, body.siteId);
    await this.ensureProduct(body.productId);
    const ref = { productId: body.productId, siteId: body.siteId, byId: actor.id };
    if (body.kind === 'ADJUST') {
      await this.stock.adjust({
        ...ref,
        delta: body.delta,
        reason: body.reason,
        unitCost: body.unitCost,
      });
    } else {
      if (body.delta < 0) {
        throw new AppException(
          'VALIDATION_ERROR',
          'Indique la quantité cassée ou perdue (nombre positif)',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      await this.stock.remove({
        ...ref,
        quantity: body.delta,
        type: body.kind,
        reason: body.reason,
      });
    }
    req.audit = {
      action: `STOCK_${body.kind}`,
      entity: 'Product',
      entityId: body.productId,
      after: body,
    };
    return { ok: true };
  }

  @Post('stock/transfer')
  @RequirePermission('stock:transfer')
  @ApiOperation({ summary: 'Transfert entre sites (deux mouvements liés)' })
  async transfer(
    @Body(new ZodValidationPipe(stockTransferSchema)) body: StockTransferInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    // Le site de départ doit être dans le périmètre ; l'arrivée peut être sur une autre île.
    await this.query.ensureSite(actor, body.fromSiteId);
    const to = await this.prisma.site.findUnique({ where: { id: body.toSiteId } });
    if (!to || !to.isActive) throw notFound('Site d’arrivée');
    await this.ensureProduct(body.productId);
    const result = await this.stock.transfer({ ...body, byId: actor.id });
    req.audit = {
      action: 'STOCK_TRANSFER',
      entity: 'Product',
      entityId: body.productId,
      after: { ...body, ...result },
    };
    return result;
  }

  @Post('stock/alerts/refresh')
  @HttpCode(200)
  @RequirePermission('stock:write')
  @ApiOperation({ summary: 'Recalculer les alertes « invendu » (aussi fait chaque nuit)' })
  async refreshAlerts(@Req() req: AuthenticatedRequest) {
    req.audit = { action: 'STOCK_ALERTS_REFRESH', entity: 'StockAlert' };
    return this.query.refreshUnsoldAlerts();
  }

  // --- Inventaires ------------------------------------------------------------------------

  @Get('inventories')
  @RequirePermission('stock:read')
  listInventories(@CurrentUser() actor: AuthUser): Promise<InventoryView[]> {
    return this.inventories.list(actor);
  }

  @Get('inventories/:id')
  @RequirePermission('stock:read')
  getInventory(@Param('id') id: string, @CurrentUser() actor: AuthUser): Promise<InventoryView> {
    return this.inventories.get(id, actor);
  }

  @Post('inventories')
  @RequirePermission('stock:inventory')
  @ApiOperation({ summary: 'Ouvrir un inventaire (photo du stock théorique du site)' })
  async startInventory(
    @Body(new ZodValidationPipe(inventoryStartSchema)) body: z.infer<typeof inventoryStartSchema>,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<InventoryView> {
    const inv = await this.inventories.start(body.siteId, actor);
    req.audit = { action: 'INVENTORY_START', entity: 'Inventory', entityId: inv.id };
    return inv;
  }

  @Patch('inventories/:id/count')
  @RequirePermission('stock:inventory')
  @ApiOperation({ summary: 'Saisir les quantités comptées' })
  async count(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(inventoryCountSchema)) body: InventoryCountInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<InventoryView> {
    const inv = await this.inventories.count(id, body, actor);
    req.audit = { action: 'INVENTORY_COUNT', entity: 'Inventory', entityId: id, after: body };
    return inv;
  }

  @Post('inventories/:id/close')
  @HttpCode(200)
  @RequirePermission('stock:inventory')
  @ApiOperation({ summary: 'Clôturer : écarts appliqués au stock (INVENTORY_DIFF)' })
  async close(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<InventoryView> {
    const inv = await this.inventories.close(id, actor);
    req.audit = {
      action: 'INVENTORY_CLOSE',
      entity: 'Inventory',
      entityId: id,
      after: {
        differences: inv.lines.filter((l) => l.difference).map((l) => [l.sku, l.difference]),
      },
    };
    return inv;
  }

  @Post('inventories/:id/cancel')
  @HttpCode(200)
  @RequirePermission('stock:inventory')
  async cancel(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    const inv = await this.inventories.cancel(id, actor);
    req.audit = { action: 'INVENTORY_CANCEL', entity: 'Inventory', entityId: id };
    return inv;
  }

  private async ensureProduct(productId: string) {
    if (!(await this.prisma.product.findUnique({ where: { id: productId } })))
      throw notFound('Produit');
  }
}
