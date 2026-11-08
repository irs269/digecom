import { Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import type { AccessTokenPayload, AuthenticatedRequest, AuthUser } from '../auth/auth.types';
import { AnyAuthenticated, CurrentUser } from '../auth/decorators';
import { AppException } from '../common/app-exception';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Outils de développement : jeton d'accès « au nom de » un livreur ou un vendeur pour le
 * simulateur web (avant l'application mobile de la phase 8). Désactivés sauf si
 * DEV_TOOLS_ENABLED=true, jamais en production, réservés à l'administrateur, journalisés.
 */
@ApiTags('dev')
@ApiBearerAuth()
@Controller('dev')
export class DevToolsController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  private enabled() {
    return this.env.DEV_TOOLS_ENABLED && this.env.NODE_ENV !== 'production';
  }

  @Get('status')
  @AnyAuthenticated()
  status(@CurrentUser() actor: AuthUser) {
    return { enabled: this.enabled() && actor.role === 'ADMIN' };
  }

  @Post('impersonate/:userId')
  @HttpCode(200)
  @AnyAuthenticated()
  @ApiOperation({ summary: 'Jeton d’accès 15 min au nom d’un livreur ou d’un vendeur (dev)' })
  async impersonate(
    @Param('userId') userId: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!this.enabled()) throw new AppException('NOT_FOUND', 'Introuvable', HttpStatus.NOT_FOUND);
    if (actor.role !== 'ADMIN')
      throw new AppException('FORBIDDEN', 'Réservé à l’administrateur', HttpStatus.FORBIDDEN);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !['COURIER', 'SELLER', 'TELECONSULTANT'].includes(user.role) || !user.isActive) {
      throw new AppException(
        'VALIDATION_ERROR',
        'Seuls les livreurs et vendeurs actifs sont simulables',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const payload: AccessTokenPayload = { sub: user.id, role: user.role };
    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: this.env.JWT_ACCESS_TTL_SECONDS,
    });
    req.audit = {
      action: 'DEV_IMPERSONATE',
      entity: 'User',
      entityId: user.id,
      after: { fullName: user.fullName, role: user.role },
    };
    return { accessToken, user: { id: user.id, fullName: user.fullName, role: user.role } };
  }
}
