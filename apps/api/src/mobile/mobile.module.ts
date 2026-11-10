import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  businessToday,
  locationSchema,
  registerDeviceSchema,
  type LocationInput,
  settlementCycle,
  type RegisterDeviceInput,
  type SellerBalanceView,
} from '@digecom/shared';
import type { AuthenticatedRequest, AuthUser } from '../auth/auth.types';
import { AnyAuthenticated, CurrentUser } from '../auth/decorators';
import { AppException } from '../common/app-exception';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { FinanceModule } from '../finance/finance.controller';
import { SettlementService } from '../finance/settlement.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

/** API propre à l'application mobile : appareils (push) et solde de l'e-commerçant. */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MobileController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly settlements: SettlementService,
  ) {}

  @Post('devices')
  @HttpCode(204)
  @AnyAuthenticated()
  @ApiOperation({ summary: 'Enregistrer ce téléphone pour les notifications push' })
  async register(
    @Body(new ZodValidationPipe(registerDeviceSchema)) body: RegisterDeviceInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    req.audit = { skip: true };
    // Un jeton appartient au dernier compte connecté sur ce téléphone.
    await this.prisma.device.upsert({
      where: { token: body.token },
      create: { token: body.token, platform: body.platform, userId: actor.id },
      update: { userId: actor.id, platform: body.platform, lastSeenAt: new Date() },
    });
  }

  @Delete('devices/:token')
  @HttpCode(204)
  @AnyAuthenticated()
  @ApiOperation({ summary: 'Ne plus recevoir de push sur ce téléphone (déconnexion)' })
  async unregister(
    @Param('token') token: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    req.audit = { skip: true };
    await this.prisma.device.deleteMany({ where: { token, userId: actor.id } });
  }

  @Post('location')
  @HttpCode(204)
  @AnyAuthenticated()
  @ApiOperation({
    summary: 'Ma position GPS (livreur, e-commerçant) : distance au site, itinéraires',
  })
  async location(
    @Body(new ZodValidationPipe(locationSchema)) body: LocationInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    if (actor.role !== 'COURIER' && actor.role !== 'SELLER') {
      throw new AppException(
        'FORBIDDEN',
        'Réservé aux livreurs et e-commerçants',
        HttpStatus.FORBIDDEN,
      );
    }
    // Position fréquente : pas d'entrée au journal d'activité.
    req.audit = { skip: true };
    await this.prisma.user.update({
      where: { id: actor.id },
      data: {
        lastLatitude: body.latitude,
        lastLongitude: body.longitude,
        lastLocationAt: new Date(),
      },
    });
  }

  @Get('balance')
  @AnyAuthenticated()
  @ApiOperation({ summary: 'Mon solde : cycle en cours et relevés (e-commerçant)' })
  async balance(@CurrentUser() actor: AuthUser): Promise<SellerBalanceView> {
    if (actor.role !== 'SELLER') {
      throw new AppException('FORBIDDEN', 'Réservé aux e-commerçants', HttpStatus.FORBIDDEN);
    }
    const [anchor, days] = await Promise.all([
      this.settings.get('settlement.anchorDate'),
      this.settings.get('settlement.cycleDays'),
    ]);
    const cycle = settlementCycle(anchor, days, businessToday());
    // Écritures pas encore reprises dans un relevé : c'est le cycle en cours.
    const open = await this.prisma.ledgerEntry.groupBy({
      by: ['type'],
      where: {
        beneficiaryId: actor.id,
        type: { in: ['SELLER_COMMISSION', 'SELLER_TAX', 'SUBSCRIPTION'] },
        lines: { none: {} },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const sum = (t: string) => open.find((o) => o.type === t)?._sum.amount ?? 0;
    const salesCount = await this.prisma.ledgerEntry.count({
      where: {
        beneficiaryId: actor.id,
        type: 'SELLER_COMMISSION',
        amount: { gt: 0 },
        lines: { none: {} },
      },
    });
    const commission = sum('SELLER_COMMISSION');
    const taxes = sum('SELLER_TAX');
    const subscriptions = sum('SUBSCRIPTION');
    const statements = await this.settlements.list({}, actor);
    return {
      cycle: { start: cycle.start, end: cycle.end },
      current: {
        salesCount,
        commission,
        taxes,
        subscriptions,
        estimatedNet: commission - taxes - subscriptions,
      },
      statements: statements.slice(0, 12),
    };
  }
}

@Module({
  imports: [FinanceModule],
  controllers: [MobileController],
  providers: [{ provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
})
export class MobileModule {}
