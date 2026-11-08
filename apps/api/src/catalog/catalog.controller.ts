import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  catalogStockSchema,
  PHOTO_MIME_TYPES,
  productListQuerySchema,
  productSchema,
  updateProductSchema,
  type CatalogStockInput,
  type Paginated,
  type ProductInput,
  type ProductListQuery,
  type ProductView,
  type UpdateProductInput,
  type VisibleCatalog,
} from '@digecom/shared';
import { z } from 'zod';
import type { AuthenticatedRequest, AuthUser } from '../auth/auth.types';
import { AnyAuthenticated, CurrentUser, RequirePermission } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ProductsService } from './products.service';

const uploadSchema = z.object({ contentType: z.enum(PHOTO_MIME_TYPES) });
const photoSchema = z.object({ key: z.string().min(1) });
const visibleQuerySchema = z.object({ asLeader: z.string().optional() });

/** Catalogues des leaders (« Mon catalogue » pour un leader). */
@ApiTags('catalog')
@ApiBearerAuth()
@Controller()
export class CatalogController {
  constructor(private readonly products: ProductsService) {}

  @Get('products')
  @RequirePermission('catalog:read')
  @ApiOperation({ summary: 'Produits du catalogue (un leader : les siens)' })
  list(
    @Query(new ZodValidationPipe(productListQuerySchema)) q: ProductListQuery,
    @CurrentUser() actor: AuthUser,
  ): Promise<Paginated<ProductView>> {
    return this.products.list(q, actor);
  }

  @Get('products/:id')
  @RequirePermission('catalog:read')
  get(@Param('id') id: string, @CurrentUser() actor: AuthUser): Promise<ProductView> {
    return this.products.get(id, actor);
  }

  @Post('products')
  @RequirePermission('catalog:write')
  @ApiOperation({ summary: 'Créer un produit dans un catalogue' })
  async create(
    @Body(new ZodValidationPipe(productSchema)) body: ProductInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<ProductView> {
    const p = await this.products.create(body, actor);
    req.audit = { action: 'PRODUCT_CREATE', entity: 'Product', entityId: p.id, after: p };
    return p;
  }

  @Patch('products/:id')
  @RequirePermission('catalog:write')
  @ApiOperation({ summary: 'Modifier un produit (prix, part, prime : ventes futures uniquement)' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProductSchema)) body: UpdateProductInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<ProductView> {
    const { before, after } = await this.products.update(id, body, actor);
    req.audit = { action: 'PRODUCT_UPDATE', entity: 'Product', entityId: id, before, after };
    return after;
  }

  @Post('products/:id/publish')
  @HttpCode(200)
  @RequirePermission('catalog:publish')
  async publish(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    const { before, after } = await this.products.setPublished(id, true, actor);
    req.audit = { action: 'PRODUCT_PUBLISH', entity: 'Product', entityId: id, before, after };
    return after;
  }

  @Post('products/:id/unpublish')
  @HttpCode(200)
  @RequirePermission('catalog:unpublish')
  async unpublish(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    const { before, after } = await this.products.setPublished(id, false, actor);
    req.audit = { action: 'PRODUCT_UNPUBLISH', entity: 'Product', entityId: id, before, after };
    return after;
  }

  @Post('products/:id/tci-bonus/:direction')
  @HttpCode(200)
  @RequirePermission('catalog:edit_tci_bonus')
  @ApiOperation({ summary: 'Prime TCI −500 / +500 (bornée par les paramètres)' })
  async stepBonus(
    @Param('id') id: string,
    @Param('direction') direction: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    const step = direction === 'up' ? 500 : direction === 'down' ? -500 : 0;
    const { before, after } = await this.products.stepBonus(id, step, actor);
    req.audit = {
      action: 'PRODUCT_TCI_BONUS',
      entity: 'Product',
      entityId: id,
      before: { tciBonus: before.tciBonus },
      after: { tciBonus: after.tciBonus },
    };
    return after;
  }

  @Post('products/:id/stock')
  @HttpCode(200)
  @RequirePermission('catalog:adjust_stock')
  @ApiOperation({ summary: 'Stock +/− d’un produit du catalogue (motif obligatoire)' })
  async adjustStock(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(catalogStockSchema)) body: CatalogStockInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<ProductView> {
    const after = await this.products.adjustStock(id, body, actor);
    req.audit = {
      action: 'PRODUCT_STOCK_ADJUST',
      entity: 'Product',
      entityId: id,
      after: { delta: body.delta, reason: body.reason, stock: after.stock },
    };
    return after;
  }

  @Post('products/:id/photos/upload-url')
  @HttpCode(200)
  @RequirePermission('catalog:write')
  @ApiOperation({ summary: 'URL pré-signée pour envoyer une photo directement à MinIO' })
  async uploadUrl(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(uploadSchema)) body: z.infer<typeof uploadSchema>,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    req.audit = { skip: true };
    return this.products.photoUploadUrl(id, body.contentType, actor);
  }

  @Post('products/:id/photos')
  @HttpCode(200)
  @RequirePermission('catalog:write')
  @ApiOperation({ summary: 'Valider une photo envoyée (conversion WebP, 5 maximum)' })
  async addPhoto(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(photoSchema)) body: z.infer<typeof photoSchema>,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<ProductView> {
    const p = await this.products.addPhoto(id, body.key, actor);
    req.audit = {
      action: 'PRODUCT_PHOTO_ADD',
      entity: 'Product',
      entityId: id,
      after: { photos: p.photos.map((x) => x.key) },
    };
    return p;
  }

  @Delete('products/:id/photos')
  @RequirePermission('catalog:write')
  async removePhoto(
    @Param('id') id: string,
    @Query(new ZodValidationPipe(photoSchema)) q: z.infer<typeof photoSchema>,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<ProductView> {
    const p = await this.products.removePhoto(id, q.key, actor);
    req.audit = {
      action: 'PRODUCT_PHOTO_REMOVE',
      entity: 'Product',
      entityId: id,
      after: { removed: q.key },
    };
    return p;
  }

  /**
   * Ce que voit un vendeur : produits publiés de SON leader avec du stock sur son île.
   * Administrateur et lecteurs du catalogue : `?asLeader=` (aperçu « ce que voit chaque équipe »).
   */
  @Get('catalog/visible')
  @AnyAuthenticated()
  @ApiOperation({ summary: 'Catalogue visible par un vendeur (ou aperçu d’une équipe)' })
  visible(
    @Query(new ZodValidationPipe(visibleQuerySchema)) q: z.infer<typeof visibleQuerySchema>,
    @CurrentUser() actor: AuthUser,
  ): Promise<VisibleCatalog> {
    return this.products.visible(actor, q.asLeader);
  }
}
