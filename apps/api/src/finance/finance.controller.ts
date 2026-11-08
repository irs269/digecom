import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  bankBalanceSchema,
  businessToday,
  cashCloseSchema,
  cashOpenSchema,
  cashOperationSchema,
  computeSale,
  computeTciSale,
  EXPENSE_CATEGORIES,
  expenseSchema,
  hasPermission,
  ROLE_SCOPE,
  settlementListQuerySchema,
  settlementPaySchema,
  startOfBusinessDay,
  toBusinessDay,
  type CashOperationInput,
  type ExpenseInput,
  type SettlementListQuery,
  type SettlementPayInput,
} from '@digecom/shared';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthenticatedRequest, AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { AppException } from '../common/app-exception';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { notFound } from '../scope/scope.service';
import { CashService } from './cash.service';
import { ExpenseService } from './expense.service';
import { FinanceJobs } from './finance-jobs';
import { SettlementService } from './settlement.service';
import { renderStatementPdf } from './statement-pdf';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const generateSchema = z.object({
  start: day.optional(),
  end: day.optional(),
  today: day.optional(),
});
const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
const expenseQuery = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  islandId: z.string().optional(),
  from: day.optional(),
  to: day.optional(),
});
const resultQuery = z.object({ from: day, to: day, islandId: z.string().optional() });

@ApiTags('settlements')
@ApiBearerAuth()
@Controller('settlements')
export class SettlementsController {
  constructor(
    private readonly settlements: SettlementService,
    private readonly jobs: FinanceJobs,
  ) {}

  @Get()
  @RequirePermission('settlements:read')
  @ApiOperation({ summary: 'Relevés (filtres statut, île, cycle, vendeur)' })
  list(
    @Query(new ZodValidationPipe(settlementListQuerySchema)) q: SettlementListQuery,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.settlements.list(q, actor);
  }

  @Get('current-cycle')
  @RequirePermission('settlements:read')
  async cycle() {
    return this.settlements.lastClosedCycle();
  }

  @Get(':id')
  @RequirePermission('settlements:read')
  get(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.settlements.get(id, actor);
  }

  @Get(':id/pdf')
  @RequirePermission('settlements:read')
  @ApiOperation({ summary: 'Relevé PDF' })
  async pdf(@Param('id') id: string, @CurrentUser() actor: AuthUser, @Res() res: Response) {
    const s = await this.settlements.get(id, actor);
    const pdf = await renderStatementPdf(s);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="releve-${s.number}.pdf"`);
    res.send(pdf);
  }

  @Post('generate')
  @HttpCode(200)
  @RequirePermission('settings:edit')
  @ApiOperation({ summary: 'Générer les relevés d’un cycle (idempotent ; aussi fait chaque nuit)' })
  async generate(
    @Body(new ZodValidationPipe(generateSchema)) body: z.infer<typeof generateSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    req.audit = { action: 'SETTLEMENTS_GENERATE', entity: 'Settlement', after: body };
    if (body.start && body.end) return this.settlements.generateForCycle(body.start, body.end);
    return this.jobs.runSettlements(body.today);
  }

  @Post('subscriptions/run')
  @HttpCode(200)
  @RequirePermission('settings:edit')
  @ApiOperation({
    summary: 'Prélever les abonnements de la semaine (idempotent ; aussi fait chaque lundi)',
  })
  async subscriptions(
    @Body(new ZodValidationPipe(z.object({ day: day.optional() }))) body: { day?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    req.audit = { action: 'SUBSCRIPTIONS_RUN', entity: 'LedgerEntry', after: body };
    return { created: await this.jobs.runSubscriptions(body.day) };
  }

  @Post(':id/verify')
  @HttpCode(200)
  @RequirePermission('settlements:verify')
  async verify(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    const s = await this.settlements.verify(id, actor);
    req.audit = {
      action: 'SETTLEMENT_VERIFY',
      entity: 'Settlement',
      entityId: id,
      after: { status: s.status, netToPay: s.netToPay },
    };
    return s;
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('settlements:approve')
  async approve(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    const s = await this.settlements.approve(id, actor);
    req.audit = {
      action: 'SETTLEMENT_APPROVE',
      entity: 'Settlement',
      entityId: id,
      after: { status: s.status, netToPay: s.netToPay },
    };
    return s;
  }

  @Post(':id/pay')
  @HttpCode(200)
  @RequirePermission('settlements:pay')
  async pay(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(settlementPaySchema)) body: SettlementPayInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    const s = await this.settlements.pay(id, body, actor);
    req.audit = {
      action: 'SETTLEMENT_PAY',
      entity: 'Settlement',
      entityId: id,
      after: {
        status: s.status,
        netToPay: s.netToPay,
        method: body.paymentMethod,
        ref: body.paymentRef,
      },
    };
    return s;
  }
}

@ApiTags('cash')
@ApiBearerAuth()
@Controller('cash')
export class CashController {
  constructor(
    private readonly cash: CashService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('registers')
  @RequirePermission('cash:read')
  @ApiOperation({ summary: 'Caisses par site (session en cours, dernière clôture)' })
  registers(@CurrentUser() actor: AuthUser) {
    return this.cash.registers(actor);
  }

  @Get('remittances/:siteId')
  @RequirePermission('cash:read')
  @ApiOperation({ summary: 'Argent encaissé par les livreurs, pas encore remis à la caisse' })
  remittances(@Param('siteId') siteId: string, @CurrentUser() actor: AuthUser) {
    return this.cash.pendingRemittances(siteId, actor);
  }

  @Post('open')
  @RequirePermission('cash:open')
  async open(
    @Body(new ZodValidationPipe(cashOpenSchema)) body: z.infer<typeof cashOpenSchema>,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    const s = await this.cash.open(body.siteId, body.openingAmount, actor);
    req.audit = { action: 'CASH_OPEN', entity: 'CashSession', entityId: s.id, after: body };
    return s;
  }

  @Post(':siteId/operations')
  @RequirePermission('cash:collect')
  @ApiOperation({
    summary: 'Encaissement / décaissement (remise livreur, vente comptoir, dépense…)',
  })
  async operation(
    @Param('siteId') siteId: string,
    @Body(new ZodValidationPipe(cashOperationSchema)) body: CashOperationInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    const s = await this.cash.operation(siteId, body, actor);
    req.audit = {
      action: `CASH_${body.direction}`,
      entity: 'CashSession',
      entityId: s.id,
      after: body,
    };
    return s;
  }

  @Post(':siteId/close')
  @HttpCode(200)
  @RequirePermission('cash:close')
  @ApiOperation({ summary: 'Clôture : montant compté, écart calculé (alerte si ≠ 0)' })
  async close(
    @Param('siteId') siteId: string,
    @Body(new ZodValidationPipe(cashCloseSchema)) body: z.infer<typeof cashCloseSchema>,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    const s = await this.cash.close(siteId, body.countedAmount, body.note, actor);
    req.audit = {
      action: 'CASH_CLOSE',
      entity: 'CashSession',
      entityId: s.id,
      after: { counted: s.countedAmount, expected: s.expectedAmount, difference: s.difference },
    };
    return s;
  }

  @Get('bank-balance')
  @RequirePermission('cash:read')
  async bank() {
    const last = await this.prisma.bankBalance.findFirst({
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: { by: { select: { fullName: true } } },
    });
    return last
      ? {
          date: toBusinessDay(last.date),
          amount: last.amount,
          source: last.source,
          by: last.by.fullName,
        }
      : null;
  }

  @Post('bank-balance')
  @RequirePermission('cash:write')
  async setBank(
    @Body(new ZodValidationPipe(bankBalanceSchema)) body: z.infer<typeof bankBalanceSchema>,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    if (actor.role === 'CASHIER')
      throw new AppException(
        'FORBIDDEN',
        'Saisie réservée à la comptabilité',
        HttpStatus.FORBIDDEN,
      );
    const row = await this.prisma.bankBalance.create({
      data: {
        date: startOfBusinessDay(body.date),
        amount: body.amount,
        source: body.source,
        byId: actor.id,
      },
    });
    req.audit = { action: 'BANK_BALANCE', entity: 'BankBalance', entityId: row.id, after: body };
    return { date: body.date, amount: body.amount, source: body.source };
  }
}

@ApiTags('expenses')
@ApiBearerAuth()
@Controller()
export class ExpensesController {
  constructor(
    private readonly expenses: ExpenseService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('expenses')
  @RequirePermission('expenses:read')
  list(
    @Query(new ZodValidationPipe(expenseQuery)) q: z.infer<typeof expenseQuery>,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.expenses.list(actor, q);
  }

  @Get('expenses/categories')
  @RequirePermission('expenses:read')
  categories() {
    return EXPENSE_CATEGORIES;
  }

  @Post('expenses')
  @RequirePermission('expenses:create')
  async create(
    @Body(new ZodValidationPipe(expenseSchema)) body: ExpenseInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    const e = await this.expenses.create(body, actor);
    req.audit = { action: 'EXPENSE_CREATE', entity: 'Expense', entityId: e.id, after: body };
    return e;
  }

  @Post('expenses/:id/approve')
  @HttpCode(200)
  @RequirePermission('expenses:approve')
  async approve(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    const e = await this.expenses.approve(id, actor);
    req.audit = {
      action: 'EXPENSE_APPROVE',
      entity: 'Expense',
      entityId: id,
      after: { amount: e.amount },
    };
    return e;
  }

  @Post('expenses/:id/reject')
  @HttpCode(200)
  @RequirePermission('expenses:approve')
  async reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reasonSchema)) body: { reason: string },
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    const e = await this.expenses.reject(id, body.reason, actor);
    req.audit = { action: 'EXPENSE_REJECT', entity: 'Expense', entityId: id, after: body };
    return e;
  }

  @Post('expenses/:id/reverse')
  @HttpCode(200)
  @RequirePermission('expenses:approve')
  @ApiOperation({ summary: 'Annuler une dépense validée (écriture inverse justifiée)' })
  async reverse(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reasonSchema)) body: { reason: string },
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    const e = await this.expenses.reverse(id, body.reason, actor);
    req.audit = { action: 'EXPENSE_REVERSE', entity: 'Expense', entityId: id, after: body };
    return e;
  }

  @Get('finance/result')
  @RequirePermission('expenses:read')
  @ApiOperation({ summary: 'Résultat net par période et par île' })
  result(@Query(new ZodValidationPipe(resultQuery)) q: z.infer<typeof resultQuery>) {
    return this.expenses.result(q.from, q.to, q.islandId);
  }

  /** Calcul détaillé d'une vente réelle (encart « vente de référence » du tableau de bord). */
  @Get('finance/sale-breakdown')
  @RequirePermission('dashboard:read')
  async saleBreakdown(
    @Query(new ZodValidationPipe(z.object({ orderId: z.string().optional() })))
    q: { orderId?: string },
    @CurrentUser() actor: AuthUser,
  ) {
    if (ROLE_SCOPE[actor.role] !== 'GLOBAL' || !hasPermission(actor.role, 'reports:read')) {
      throw new AppException(
        'FORBIDDEN',
        'Réservé à la direction et à la finance',
        HttpStatus.FORBIDDEN,
      );
    }
    const sold = await this.prisma.order.findMany({
      where: { status: 'SOLD' },
      orderBy: { soldAt: 'desc' },
      take: 20,
      include: {
        items: { include: { product: { select: { name: true } } } },
        seller: { select: { fullName: true } },
      },
    });
    const order = q.orderId
      ? (sold.find((o) => o.id === q.orderId) ??
        (await this.prisma.order.findFirst({
          where: { id: q.orderId, status: 'SOLD' },
          include: {
            items: { include: { product: { select: { name: true } } } },
            seller: { select: { fullName: true } },
          },
        })))
      : sold[0];
    if (q.orderId && !order) throw notFound('Vente');
    const item = order?.items[0];
    return {
      recent: sold.map((o) => ({
        id: o.id,
        number: o.number,
        label: `${o.number} · ${o.items[0]?.product.name ?? ''} · ${o.seller.fullName}`,
      })),
      order:
        order && item
          ? {
              id: order.id,
              number: order.number,
              product: item.product.name,
              quantity: item.quantity,
              sellerType: order.sellerType,
              sale:
                order.sellerType === 'SELLER'
                  ? computeSale({
                      price: item.unitPrice,
                      sellerShare: item.sellerShare ?? 0,
                      unitCost: item.unitCost ?? 0,
                      digecomTax: item.digecomTax,
                      sellerTax: item.sellerTax,
                      quantity: item.quantity,
                    })
                  : null,
              tci:
                order.sellerType === 'TELECONSULTANT'
                  ? computeTciSale({
                      price: item.unitPrice,
                      tciBonus: item.tciBonus ?? 0,
                      unitCost: item.unitCost ?? 0,
                      quantity: item.quantity,
                    })
                  : null,
            }
          : null,
      today: businessToday(),
    };
  }
}

@Module({
  controllers: [SettlementsController, CashController, ExpensesController],
  providers: [SettlementService, CashService, ExpenseService, FinanceJobs],
  exports: [SettlementService, CashService, FinanceJobs],
})
export class FinanceModule {}
