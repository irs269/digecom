import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PURCHASE_STATUSES,
  purchaseOrderSchema,
  receivePurchaseSchema,
  supplierSchema,
  updatePurchaseOrderSchema,
  type PurchaseOrderInput,
  type PurchaseOrderView,
  type ReceivePurchaseInput,
  type SupplierInput,
  type SupplierView,
} from '@digecom/shared';
import { z } from 'zod';
import type { AuthenticatedRequest, AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PurchasesService } from './purchases.service';

const listQuerySchema = z.object({ status: z.enum(PURCHASE_STATUSES).optional() });
const updateSupplierSchema = supplierSchema.partial().extend({ isActive: z.boolean().optional() });

@ApiTags('purchases')
@ApiBearerAuth()
@Controller()
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get('suppliers')
  @RequirePermission('purchases:read')
  suppliers(): Promise<SupplierView[]> {
    return this.purchases.suppliers();
  }

  @Post('suppliers')
  @RequirePermission('purchases:create')
  async createSupplier(
    @Body(new ZodValidationPipe(supplierSchema)) body: SupplierInput,
    @Req() req: AuthenticatedRequest,
  ): Promise<SupplierView> {
    const s = await this.purchases.createSupplier(body);
    req.audit = { action: 'SUPPLIER_CREATE', entity: 'Supplier', entityId: s.id, after: s };
    return s;
  }

  @Patch('suppliers/:id')
  @RequirePermission('purchases:create')
  async updateSupplier(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSupplierSchema)) body: z.infer<typeof updateSupplierSchema>,
    @Req() req: AuthenticatedRequest,
  ): Promise<SupplierView> {
    const s = await this.purchases.updateSupplier(id, body);
    req.audit = { action: 'SUPPLIER_UPDATE', entity: 'Supplier', entityId: id, after: s };
    return s;
  }

  @Get('purchase-orders')
  @RequirePermission('purchases:read')
  @ApiOperation({ summary: 'Commandes fournisseurs (lots) avec coût unitaire calculé' })
  list(
    @Query(new ZodValidationPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>,
    @CurrentUser() actor: AuthUser,
  ): Promise<PurchaseOrderView[]> {
    return this.purchases.list(actor, q.status);
  }

  @Get('purchase-orders/:id')
  @RequirePermission('purchases:read')
  get(@Param('id') id: string, @CurrentUser() actor: AuthUser): Promise<PurchaseOrderView> {
    return this.purchases.get(id, actor);
  }

  @Post('purchase-orders')
  @RequirePermission('purchases:create')
  @ApiOperation({ summary: 'Nouvelle commande fournisseur (en préparation)' })
  async create(
    @Body(new ZodValidationPipe(purchaseOrderSchema)) body: PurchaseOrderInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<PurchaseOrderView> {
    const po = await this.purchases.create(body, actor);
    req.audit = { action: 'PURCHASE_CREATE', entity: 'PurchaseOrder', entityId: po.id, after: po };
    return po;
  }

  @Patch('purchase-orders/:id')
  @RequirePermission('purchases:create')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePurchaseOrderSchema)) body: Partial<PurchaseOrderInput>,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<PurchaseOrderView> {
    const { before, after } = await this.purchases.update(id, body, actor);
    req.audit = { action: 'PURCHASE_UPDATE', entity: 'PurchaseOrder', entityId: id, before, after };
    return after;
  }

  @Post('purchase-orders/:id/advance')
  @HttpCode(200)
  @RequirePermission('purchases:advance')
  @ApiOperation({
    summary: 'Étape suivante (passée, en transport, arrivée, dédouanement, clôture)',
  })
  async advance(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<PurchaseOrderView> {
    const { before, after } = await this.purchases.advance(id, actor);
    req.audit = {
      action: 'PURCHASE_ADVANCE',
      entity: 'PurchaseOrder',
      entityId: id,
      before: { status: before.status },
      after: { status: after.status },
    };
    return after;
  }

  @Post('purchase-orders/:id/receive')
  @HttpCode(200)
  @RequirePermission('purchases:receive')
  @ApiOperation({ summary: 'Réception : création du lot et entrée en stock' })
  async receive(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(receivePurchaseSchema)) body: ReceivePurchaseInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<PurchaseOrderView> {
    const { before, after } = await this.purchases.receive(id, body, actor);
    req.audit = {
      action: 'PURCHASE_RECEIVE',
      entity: 'PurchaseOrder',
      entityId: id,
      before: { status: before.status },
      after: {
        status: after.status,
        receivedQuantity: after.receivedQuantity,
        unitCost: after.unitCost,
      },
    };
    return after;
  }
}
