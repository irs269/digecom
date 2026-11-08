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
  createOrderSchema,
  isActionKey,
  ORDER_ACTIONS,
  orderActionSchema,
  orderListQuerySchema,
  type CourierView,
  type CreateOrderInput,
  type DeliveryOfferView,
  type OrderAction,
  type OrderActionInput,
  type OrderListQuery,
  type OrderView,
  type Paginated,
} from '@digecom/shared';
import { z } from 'zod';
import type { AuthenticatedRequest, AuthUser } from '../auth/auth.types';
import { AnyAuthenticated, CurrentUser, RequirePermission } from '../auth/decorators';
import { AppException } from '../common/app-exception';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { BUCKETS, StorageService } from '../storage/storage.service';
import { DeliveriesService } from './deliveries.service';
import { OrderService } from './order.service';

const actionParam = z.enum(ORDER_ACTIONS);
const islandQuery = z.object({ islandId: z.string().optional() });
const availabilitySchema = z.object({ isAvailable: z.boolean() });
const proofSchema = z.object({ contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']) });

function audit(req: AuthenticatedRequest, action: string, order: OrderView, body?: unknown) {
  req.audit = {
    action: `ORDER_${action.toUpperCase()}`,
    entity: 'Order',
    entityId: order.id,
    after: { number: order.number, status: order.status, input: body },
  };
}

function parseAction(raw: string): OrderAction {
  const parsed = actionParam.safeParse(raw);
  if (!parsed.success) throw new AppException('NOT_FOUND', 'Action inconnue', HttpStatus.NOT_FOUND);
  return parsed.data;
}

/** Back-office : commandes (création pour le compte de, liste, détail, actions). */
@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrderService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @RequirePermission('orders:read')
  @ApiOperation({
    summary: 'Commandes (filtres statut, île, site, leader, vendeur, mode, période, recherche)',
  })
  list(
    @Query(new ZodValidationPipe(orderListQuerySchema)) q: OrderListQuery,
    @CurrentUser() actor: AuthUser,
  ): Promise<Paginated<OrderView>> {
    return this.orders.list(q, actor);
  }

  @Get('sellers')
  @RequirePermission('orders:create_on_behalf')
  @ApiOperation({ summary: 'Vendeurs pour qui créer une commande (île de la logistique)' })
  async sellers(@CurrentUser() actor: AuthUser) {
    const rows = await this.prisma.user.findMany({
      where: {
        role: { in: ['SELLER', 'TELECONSULTANT'] },
        isActive: true,
        leaderId: { not: null },
        ...(actor.role === 'ADMIN' ? {} : { islandId: actor.islandId ?? '-' }),
      },
      select: {
        id: true,
        fullName: true,
        role: true,
        island: { select: { id: true, code: true, name: true } },
        leader: { select: { id: true, fullName: true } },
      },
      orderBy: { fullName: 'asc' },
    });
    return rows;
  }

  @Get(':id')
  @RequirePermission('orders:read')
  get(@Param('id') id: string, @CurrentUser() actor: AuthUser): Promise<OrderView> {
    return this.orders.get(id, actor);
  }

  @Post()
  @RequirePermission('orders:create_on_behalf')
  @ApiOperation({ summary: 'Nouvelle commande pour le compte d’un vendeur (stock réservé)' })
  async create(
    @Body(new ZodValidationPipe(createOrderSchema)) body: CreateOrderInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<OrderView> {
    const order = await this.orders.create(body, actor);
    audit(req, 'create', order, {
      sellerId: body.sellerId,
      items: body.items,
      deliveryMode: body.deliveryMode,
    });
    return order;
  }

  /** Toutes les transitions passent par la machine à états (403 / 409 sinon). */
  @Post(':id/actions/:action')
  @HttpCode(200)
  @AnyAuthenticated()
  @ApiOperation({
    summary: 'Faire avancer une commande (confirm, prepare, ready, assign, cancel…)',
  })
  async act(
    @Param('id') id: string,
    @Param('action') action: string,
    @Body(new ZodValidationPipe(orderActionSchema)) body: OrderActionInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<OrderView> {
    const order = await this.orders.act(id, parseAction(action), body, actor);
    audit(req, action, order, body);
    return order;
  }
}

/** Back-office : tableau des livraisons et livreurs de l'île. */
@ApiTags('deliveries')
@ApiBearerAuth()
@Controller('deliveries')
export class DeliveriesController {
  constructor(
    private readonly deliveries: DeliveriesService,
    private readonly orders: OrderService,
  ) {}

  @Get('board')
  @RequirePermission('deliveries:read')
  @ApiOperation({ summary: 'Colonnes : en attente, en cours, prêtes au retrait, refus et échecs' })
  board(
    @Query(new ZodValidationPipe(islandQuery)) q: z.infer<typeof islandQuery>,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.deliveries.board(actor, q.islandId);
  }

  @Get('couriers')
  @RequirePermission('deliveries:read')
  @ApiOperation({ summary: 'Livreurs (disponible / en course, courses du jour)' })
  couriers(
    @Query(new ZodValidationPipe(islandQuery)) q: z.infer<typeof islandQuery>,
    @CurrentUser() actor: AuthUser,
  ): Promise<CourierView[]> {
    return this.deliveries.couriers(actor, q.islandId);
  }

  @Post(':orderId/assign')
  @HttpCode(200)
  @RequirePermission('deliveries:assign_manual')
  @ApiOperation({ summary: 'Affectation manuelle (livreur de la même île uniquement)' })
  async assign(
    @Param('orderId') orderId: string,
    @Body(new ZodValidationPipe(z.object({ courierId: z.string().min(1) })))
    body: { courierId: string },
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<OrderView> {
    const order = await this.orders.act(orderId, 'assign', body, actor);
    audit(req, 'assign', order, body);
    return order;
  }
}

/** API livreur (consommée par l'application mobile en phase 8 et par le simulateur). */
@ApiTags('courier')
@ApiBearerAuth()
@Controller('courier')
export class CourierController {
  constructor(
    private readonly deliveries: DeliveriesService,
    private readonly orders: OrderService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private ensureCourier(actor: AuthUser) {
    if (actor.role !== 'COURIER')
      throw new AppException('FORBIDDEN', 'Réservé aux livreurs', HttpStatus.FORBIDDEN);
  }

  @Patch('availability')
  @AnyAuthenticated()
  @ApiOperation({ summary: 'Je suis disponible / indisponible' })
  async availability(
    @Body(new ZodValidationPipe(availabilitySchema)) body: z.infer<typeof availabilitySchema>,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    this.ensureCourier(actor);
    await this.prisma.user.update({
      where: { id: actor.id },
      data: { isAvailable: body.isAvailable },
    });
    req.audit = { action: 'COURIER_AVAILABILITY', entity: 'User', entityId: actor.id, after: body };
    return body;
  }

  @Get('offers')
  @AnyAuthenticated()
  @ApiOperation({ summary: 'Courses proposées (île du livreur uniquement)' })
  offers(@CurrentUser() actor: AuthUser): Promise<DeliveryOfferView[]> {
    this.ensureCourier(actor);
    return this.deliveries.offersFor(actor.id);
  }

  @Get('runs')
  @AnyAuthenticated()
  @ApiOperation({ summary: 'Mes courses en cours' })
  runs(@CurrentUser() actor: AuthUser): Promise<OrderView[]> {
    this.ensureCourier(actor);
    return this.deliveries.runsFor(actor, ['ASSIGNED', 'OUT_FOR_DELIVERY', 'HANDED_OVER']);
  }

  @Get('history')
  @AnyAuthenticated()
  @ApiOperation({ summary: 'Historique et frais de course' })
  history(@CurrentUser() actor: AuthUser) {
    this.ensureCourier(actor);
    return this.deliveries.history(actor);
  }

  @Post('proof-upload-url')
  @HttpCode(200)
  @AnyAuthenticated()
  @ApiOperation({ summary: 'URL pré-signée pour la photo de preuve de remise' })
  proofUrl(
    @Body(new ZodValidationPipe(proofSchema)) body: z.infer<typeof proofSchema>,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    this.ensureCourier(actor);
    req.audit = { skip: true };
    return this.storage.presignUpload(BUCKETS.proofs, actor.id, body.contentType);
  }

  @Post('offers/:orderId/accept')
  @HttpCode(200)
  @AnyAuthenticated()
  @ApiOperation({ summary: 'Accepter une course (le premier gagne)' })
  async accept(
    @Param('orderId') orderId: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    this.ensureCourier(actor);
    const order = await this.orders.act(orderId, 'accept', {}, actor);
    audit(req, 'accept', order);
    return order;
  }

  @Post('runs/:orderId/:action')
  @HttpCode(200)
  @AnyAuthenticated()
  @ApiOperation({
    summary: 'pickup, handover (montant + preuve), fail (motif), markSold, markRefused',
  })
  async runAction(
    @Param('orderId') orderId: string,
    @Param('action') raw: string,
    @Body(new ZodValidationPipe(orderActionSchema)) body: OrderActionInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    this.ensureCourier(actor);
    const action = parseAction(raw);
    if (!['pickup', 'handover', 'fail', 'markSold', 'markRefused'].includes(action)) {
      throw new AppException('NOT_FOUND', 'Action inconnue', HttpStatus.NOT_FOUND);
    }
    if (body.proofKey && !body.proofKey.startsWith(`tmp/${actor.id}/`)) {
      throw new AppException(
        'VALIDATION_ERROR',
        'Preuve invalide',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const order = await this.orders.act(orderId, action, body, actor);
    audit(req, action, order, { ...body, proofKey: body.proofKey ? '[photo]' : undefined });
    return order;
  }
}

/** API vendeur (e-commerçant : mobile en phase 8 ; TCI : phase 5). */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me/orders')
export class SellerOrdersController {
  constructor(private readonly orders: OrderService) {}

  private ensureSeller(actor: AuthUser) {
    if (actor.role !== 'SELLER' && actor.role !== 'TELECONSULTANT') {
      throw new AppException('FORBIDDEN', 'Réservé aux vendeurs', HttpStatus.FORBIDDEN);
    }
  }

  @Get()
  @AnyAuthenticated()
  @ApiOperation({ summary: 'Mes commandes' })
  list(
    @Query(new ZodValidationPipe(orderListQuerySchema)) q: OrderListQuery,
    @CurrentUser() actor: AuthUser,
  ) {
    this.ensureSeller(actor);
    return this.orders.list(q, actor);
  }

  @Post()
  @AnyAuthenticated()
  @ApiOperation({ summary: 'Créer une commande (catalogue de mon leader, stock réservé)' })
  async create(
    @Body(new ZodValidationPipe(createOrderSchema)) body: CreateOrderInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    this.ensureSeller(actor);
    const order = await this.orders.create({ ...body, sellerId: undefined }, actor);
    audit(req, 'create', order, { items: body.items, deliveryMode: body.deliveryMode });
    return order;
  }

  @Post(':id/:action')
  @HttpCode(200)
  @AnyAuthenticated()
  @ApiOperation({ summary: 'sellerConfirm (réception), markSold, markRefused (motif), cancel' })
  async act(
    @Param('id') id: string,
    @Param('action') raw: string,
    @Body(new ZodValidationPipe(orderActionSchema)) body: OrderActionInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    this.ensureSeller(actor);
    const action = parseAction(raw);
    if (!['sellerConfirm', 'markSold', 'markRefused', 'cancel'].includes(action)) {
      throw new AppException('NOT_FOUND', 'Action inconnue', HttpStatus.NOT_FOUND);
    }
    const order = await this.orders.act(id, action, body, actor);
    audit(req, action, order, body);
    return order;
  }
}

// Garde-fou de compilation : chaque action utilisée par la machine a un nom valide.
void isActionKey;
