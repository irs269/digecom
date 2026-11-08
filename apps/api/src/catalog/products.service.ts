import { HttpStatus, Injectable } from '@nestjs/common';
import {
  hasPermission,
  MAX_PRODUCT_PHOTOS,
  ROLE_SCOPE,
  sellerShareAmount,
  type CatalogStockInput,
  type Paginated,
  type ProductInput,
  type ProductListQuery,
  type ProductState,
  type ProductView,
  type UpdateProductInput,
  type VisibleCatalog,
} from '@digecom/shared';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { notFound } from '../scope/scope.service';
import { SettingsService } from '../settings/settings.service';
import { CounterService } from '../stock/counter.service';
import { StockService } from '../stock/stock.service';
import { BUCKETS, StorageService } from '../storage/storage.service';

const PRODUCT_INCLUDE = {
  leader: {
    select: {
      id: true,
      fullName: true,
      role: true,
      island: { select: { id: true, code: true, name: true } },
    },
  },
  stockLevels: { select: { available: true, reserved: true } },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;

const invalid = (path: string, message: string) =>
  new AppException('VALIDATION_ERROR', message, HttpStatus.UNPROCESSABLE_ENTITY, [
    { path, message },
  ]);
const forbidden = (message = "Cette action n'est pas autorisée pour ton profil") =>
  new AppException('FORBIDDEN', message, HttpStatus.FORBIDDEN);

export function productState(isPublished: boolean, available: number): ProductState {
  if (!isPublished) return 'UNPUBLISHED';
  return available > 0 ? 'PUBLISHED' : 'OUT_OF_STOCK';
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly counters: CounterService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
  ) {}

  // --- Périmètre ---------------------------------------------------------------------------

  /** Produits visibles dans le module catalogue (lecture). */
  scopeWhere(actor: AuthUser): Prisma.ProductWhereInput {
    if (actor.role === 'LEADER_SENIOR' || actor.role === 'LEADER_JUNIOR')
      return { leaderId: actor.id };
    if (ROLE_SCOPE[actor.role] === 'ISLAND') return { leader: { islandId: actor.islandId ?? '-' } };
    if (ROLE_SCOPE[actor.role] === 'GLOBAL') return {};
    return { id: '__hors_perimetre__' };
  }

  /** Produit modifiable par l'acteur : le sien (leader) ou n'importe lequel (admin). Sinon 404. */
  private async ownProduct(id: string, actor: AuthUser) {
    const where: Prisma.ProductWhereInput =
      actor.role === 'ADMIN' ? { id } : { id, leaderId: actor.id };
    const product = await this.prisma.product.findFirst({ where, include: PRODUCT_INCLUDE });
    if (!product) throw notFound('Produit');
    return product;
  }

  // --- Lecture ------------------------------------------------------------------------------

  async list(q: ProductListQuery, actor: AuthUser): Promise<Paginated<ProductView>> {
    const where: Prisma.ProductWhereInput = {
      AND: [
        this.scopeWhere(actor),
        {
          leaderId: q.leaderId,
          leader: q.islandId ? { islandId: q.islandId } : undefined,
          isPublished: q.state === 'UNPUBLISHED' ? false : q.state ? true : undefined,
        },
        q.q
          ? {
              OR: [
                { name: { contains: q.q, mode: 'insensitive' } },
                { sku: { contains: q.q, mode: 'insensitive' } },
              ],
            }
          : {},
      ],
    };
    const rows = await this.prisma.product.findMany({
      where,
      include: PRODUCT_INCLUDE,
      orderBy: [{ leader: { fullName: 'asc' } }, { name: 'asc' }],
    });
    let views = await this.toViews(rows);
    if (q.state) views = views.filter((v) => v.state === q.state);
    const total = views.length;
    const items = views.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async get(id: string, actor: AuthUser): Promise<ProductView> {
    const row = await this.prisma.product.findFirst({
      where: { AND: [{ id }, this.scopeWhere(actor)] },
      include: PRODUCT_INCLUDE,
    });
    if (!row) throw notFound('Produit');
    return (await this.toViews([row]))[0]!;
  }

  // --- Écriture -----------------------------------------------------------------------------

  async create(input: ProductInput, actor: AuthUser): Promise<ProductView> {
    const leaderId = actor.role === 'ADMIN' ? input.leaderId : actor.id;
    if (!leaderId) throw invalid('leaderId', 'Leader requis');
    if (actor.role !== 'ADMIN' && input.leaderId && input.leaderId !== actor.id) {
      throw forbidden('Un leader ne publie que dans son propre catalogue');
    }
    const leader = await this.prisma.user.findUnique({ where: { id: leaderId } });
    if (!leader || (leader.role !== 'LEADER_SENIOR' && leader.role !== 'LEADER_JUNIOR')) {
      throw invalid('leaderId', 'Le propriétaire doit être un Leader Senior ou Junior');
    }
    if (input.isPublished && !hasPermission(actor.role, 'catalog:publish')) throw forbidden();
    const fields = await this.validateEconomics(leader.role, {
      salePrice: input.salePrice,
      sellerShareType: input.sellerShareType ?? null,
      sellerShareValue: input.sellerShareValue ?? null,
      tciBonus: input.tciBonus ?? null,
    });
    const sku = await this.counters.formatted('PRODUCT', 'PRD-', 6);
    const row = await this.prisma.product.create({
      data: {
        leaderId,
        sku,
        name: input.name,
        category: input.category,
        description: input.description,
        quality: input.quality,
        lowStockThreshold: input.lowStockThreshold ?? null,
        isPublished: input.isPublished ?? false,
        createdById: actor.id,
        ...fields,
      },
      include: PRODUCT_INCLUDE,
    });
    return (await this.toViews([row]))[0]!;
  }

  /** Modification : prix / part / prime valent pour les ventes futures (instantanés en phase 3). */
  async update(
    id: string,
    input: UpdateProductInput,
    actor: AuthUser,
  ): Promise<{ before: ProductView; after: ProductView }> {
    const existing = await this.ownProduct(id, actor);
    const before = (await this.toViews([existing]))[0]!;

    const priceChanged = input.salePrice !== undefined && input.salePrice !== existing.salePrice;
    const shareChanged =
      (input.sellerShareType !== undefined && input.sellerShareType !== existing.sellerShareType) ||
      (input.sellerShareValue !== undefined &&
        input.sellerShareValue !== existing.sellerShareValue);
    const bonusChanged = input.tciBonus !== undefined && input.tciBonus !== existing.tciBonus;
    const publishChanged =
      input.isPublished !== undefined && input.isPublished !== existing.isPublished;
    if (priceChanged && !hasPermission(actor.role, 'catalog:edit_price')) throw forbidden();
    if (shareChanged && !hasPermission(actor.role, 'catalog:edit_share')) throw forbidden();
    if (bonusChanged && !hasPermission(actor.role, 'catalog:edit_tci_bonus')) throw forbidden();
    if (publishChanged && !hasPermission(actor.role, 'catalog:publish')) throw forbidden();

    const fields = await this.validateEconomics(existing.leader.role, {
      salePrice: input.salePrice ?? existing.salePrice,
      sellerShareType:
        input.sellerShareType !== undefined ? input.sellerShareType : existing.sellerShareType,
      sellerShareValue:
        input.sellerShareValue !== undefined ? input.sellerShareValue : existing.sellerShareValue,
      tciBonus: input.tciBonus !== undefined ? input.tciBonus : existing.tciBonus,
    });
    const row = await this.prisma.product.update({
      where: { id },
      data: {
        name: input.name,
        category: input.category,
        description: input.description,
        quality: input.quality,
        lowStockThreshold: input.lowStockThreshold,
        isPublished: input.isPublished,
        ...fields,
      },
      include: PRODUCT_INCLUDE,
    });
    return { before, after: (await this.toViews([row]))[0]! };
  }

  async setPublished(id: string, published: boolean, actor: AuthUser) {
    return this.update(id, { isPublished: published }, actor);
  }

  /** Prime TCI ± pas (boutons −500 / +500), bornée par les paramètres. */
  async stepBonus(id: string, step: number, actor: AuthUser) {
    const existing = await this.ownProduct(id, actor);
    if (existing.leader.role !== 'LEADER_JUNIOR') {
      throw invalid('tciBonus', 'La prime TCI ne concerne que les produits d’un Leader Junior');
    }
    return this.update(id, { tciBonus: (existing.tciBonus ?? 0) + step }, actor);
  }

  /** Stock +/− sur un produit du catalogue (motif obligatoire), sur un site de l'île du leader. */
  async adjustStock(id: string, input: CatalogStockInput, actor: AuthUser) {
    const product = await this.ownProduct(id, actor);
    const islandId = product.leader.island?.id;
    const site = input.siteId
      ? await this.prisma.site.findFirst({ where: { id: input.siteId, isActive: true } })
      : await this.prisma.site.findFirst({
          where: { islandId, isActive: true },
          orderBy: [{ type: 'desc' }, { name: 'asc' }],
        });
    if (!site) throw invalid('siteId', 'Aucun site actif sur l’île du leader');
    if (site.islandId !== islandId) {
      throw invalid('siteId', 'Le stock d’un leader est gardé dans un site de son île');
    }
    await this.stock.adjust({
      productId: id,
      siteId: site.id,
      byId: actor.id,
      delta: input.delta,
      reason: input.reason,
      unitCost: input.unitCost,
    });
    return this.get(id, actor);
  }

  // --- Photos -------------------------------------------------------------------------------

  async photoUploadUrl(id: string, contentType: string, actor: AuthUser) {
    const product = await this.ownProduct(id, actor);
    if (product.photos.length >= MAX_PRODUCT_PHOTOS) {
      throw invalid('photos', `${MAX_PRODUCT_PHOTOS} photos maximum`);
    }
    return this.storage.presignUpload(BUCKETS.products, id, contentType);
  }

  async addPhoto(id: string, tmpKey: string, actor: AuthUser) {
    const product = await this.ownProduct(id, actor);
    if (product.photos.length >= MAX_PRODUCT_PHOTOS) {
      throw invalid('photos', `${MAX_PRODUCT_PHOTOS} photos maximum`);
    }
    if (!tmpKey.startsWith(`tmp/${id}/`)) throw invalid('key', 'Clé de fichier invalide');
    const key = await this.storage.finalizeImage(BUCKETS.products, tmpKey, id);
    await this.prisma.product.update({ where: { id }, data: { photos: { push: key } } });
    return this.get(id, actor);
  }

  async removePhoto(id: string, key: string, actor: AuthUser) {
    const product = await this.ownProduct(id, actor);
    if (!product.photos.includes(key)) throw notFound('Photo');
    await this.prisma.product.update({
      where: { id },
      data: { photos: product.photos.filter((p) => p !== key) },
    });
    await this.storage.delete(BUCKETS.products, key);
    return this.get(id, actor);
  }

  // --- Catalogue visible (vendeurs, aperçu des équipes) ------------------------------------

  async visible(actor: AuthUser, asLeader?: string): Promise<VisibleCatalog> {
    let leaderId: string | null;
    if (actor.role === 'SELLER' || actor.role === 'TELECONSULTANT') {
      leaderId = actor.leaderId;
    } else if (actor.role === 'LEADER_SENIOR' || actor.role === 'LEADER_JUNIOR') {
      if (asLeader && asLeader !== actor.id) throw notFound('Leader');
      leaderId = actor.id;
    } else if (hasPermission(actor.role, 'catalog:read')) {
      if (!asLeader) throw invalid('asLeader', 'Choisis l’équipe à prévisualiser');
      leaderId = asLeader;
    } else {
      throw forbidden("Ce module n'est pas accessible à ton profil");
    }
    if (!leaderId) throw notFound('Leader');

    const leader = await this.prisma.user.findFirst({
      where: {
        id: leaderId,
        role: { in: ['LEADER_SENIOR', 'LEADER_JUNIOR'] },
        // Rôles d'île : uniquement les leaders de leur île.
        ...(ROLE_SCOPE[actor.role] === 'ISLAND' ? { islandId: actor.islandId ?? '-' } : {}),
      },
      select: {
        id: true,
        fullName: true,
        role: true,
        islandId: true,
        island: { select: { id: true, code: true, name: true } },
      },
    });
    if (!leader) throw notFound('Leader');

    const all = await this.prisma.product.findMany({
      where: { leaderId: leader.id },
      include: {
        stockLevels: {
          where: {
            site: { islandId: leader.islandId ?? '-', isActive: true },
            available: { gt: 0 },
          },
          include: { site: { select: { id: true, name: true } } },
        },
      },
      orderBy: { name: 'asc' },
    });
    const visibleRows = all.filter((p) => p.isPublished && p.stockLevels.length > 0);
    const products = await Promise.all(
      visibleRows.map(async (p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category,
        description: p.description,
        quality: p.quality,
        photos: await this.photoUrls(p.photos),
        salePrice: p.salePrice,
        sellerAmount: sellerAmountOf(leader.role, p),
        tciBonus: p.tciBonus,
        sites: p.stockLevels.map((l) => ({
          siteId: l.site.id,
          siteName: l.site.name,
          available: l.available,
        })),
        available: p.stockLevels.reduce((s, l) => s + l.available, 0),
      })),
    );
    return {
      leader: {
        id: leader.id,
        fullName: leader.fullName,
        role: leader.role,
        island: leader.island,
      },
      products,
      hiddenCount: all.length - visibleRows.length,
    };
  }

  // --- Interne ------------------------------------------------------------------------------

  private async validateEconomics(
    leaderRole: string,
    v: {
      salePrice: number;
      sellerShareType: 'FIXED' | 'PERCENT' | null;
      sellerShareValue: number | null;
      tciBonus: number | null;
    },
  ) {
    if (leaderRole === 'LEADER_SENIOR') {
      if (!v.sellerShareType || v.sellerShareValue === null) {
        throw invalid('sellerShareValue', 'Part e-commerçant requise pour un Leader Senior');
      }
      if (v.tciBonus !== null) throw invalid('tciBonus', 'Pas de prime TCI pour un Leader Senior');
      if (v.sellerShareType === 'PERCENT' && v.sellerShareValue > 100) {
        throw invalid('sellerShareValue', 'Pourcentage entre 0 et 100');
      }
      if (sellerShareAmount(v.salePrice, v.sellerShareType, v.sellerShareValue) > v.salePrice) {
        throw invalid('sellerShareValue', 'La part e-commerçant dépasse le prix de vente');
      }
      return {
        salePrice: v.salePrice,
        sellerShareType: v.sellerShareType,
        sellerShareValue: v.sellerShareValue,
        tciBonus: null,
      };
    }
    // Leader Junior : prime TCI bornée par les paramètres en vigueur.
    if (v.tciBonus === null) throw invalid('tciBonus', 'Prime TCI requise pour un Leader Junior');
    const [min, max] = await Promise.all([
      this.settings.get('tci.bonusMin'),
      this.settings.get('tci.bonusMax'),
    ]);
    if (v.tciBonus < min || v.tciBonus > max) {
      throw invalid('tciBonus', `La prime TCI doit être comprise entre ${min} et ${max} KMF`);
    }
    if (v.tciBonus > v.salePrice) throw invalid('tciBonus', 'La prime dépasse le prix de vente');
    return {
      salePrice: v.salePrice,
      sellerShareType: null,
      sellerShareValue: null,
      tciBonus: v.tciBonus,
    };
  }

  private photoUrls(keys: string[]) {
    return Promise.all(
      keys.map(async (key) => ({ key, url: await this.storage.presignGet(BUCKETS.products, key) })),
    );
  }

  async toViews(rows: ProductRow[]): Promise<ProductView[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const sales = await this.prisma.stockMovement.groupBy({
      by: ['productId', 'type'],
      where: { productId: { in: ids }, type: { in: ['OUT', 'RETURN'] }, orderId: { not: null } },
      _sum: { quantity: true },
    });
    const sold = new Map<string, number>();
    for (const s of sales) {
      const q = s._sum.quantity ?? 0;
      sold.set(s.productId, (sold.get(s.productId) ?? 0) + (s.type === 'OUT' ? q : -q));
    }
    return Promise.all(
      rows.map(async (r) => {
        const available = r.stockLevels.reduce((s, l) => s + l.available, 0);
        const reserved = r.stockLevels.reduce((s, l) => s + l.reserved, 0);
        return {
          id: r.id,
          sku: r.sku,
          name: r.name,
          category: r.category,
          description: r.description,
          quality: r.quality,
          photos: await this.photoUrls(r.photos),
          salePrice: r.salePrice,
          sellerShareType: r.sellerShareType,
          sellerShareValue: r.sellerShareValue,
          sellerAmount: sellerAmountOf(r.leader.role, r),
          tciBonus: r.tciBonus,
          isPublished: r.isPublished,
          lowStockThreshold: r.lowStockThreshold,
          state: productState(r.isPublished, available),
          leader: r.leader,
          stock: { available, reserved },
          sold: sold.get(r.id) ?? 0,
          updatedAt: r.updatedAt.toISOString(),
        };
      }),
    );
  }
}

function sellerAmountOf(
  leaderRole: string,
  p: {
    salePrice: number;
    sellerShareType: 'FIXED' | 'PERCENT' | null;
    sellerShareValue: number | null;
    tciBonus: number | null;
  },
): number | null {
  if (leaderRole === 'LEADER_JUNIOR') return p.tciBonus;
  if (!p.sellerShareType || p.sellerShareValue === null) return null;
  return sellerShareAmount(p.salePrice, p.sellerShareType, p.sellerShareValue);
}
