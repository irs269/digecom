import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ACTIONS,
  ISLAND_CODES,
  MODULE_KEYS,
  MODULE_LABELS,
  PERMISSIONS,
  ROLE_LABELS,
  ROLE_SCOPE,
  ROLES,
  siteSchema,
  updateSiteSchema,
  type IslandView,
  type SiteInput,
  type SiteView,
} from '@digecom/shared';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { AuthenticatedRequest, AuthUser } from '../auth/auth.types';
import { AnyAuthenticated, CurrentUser, RequirePermission } from '../auth/decorators';
import { AppException } from '../common/app-exception';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { notFound, ScopeService } from '../scope/scope.service';

const SITE_INCLUDE = { island: { select: { id: true, code: true, name: true } } } as const;
type SiteRow = Prisma.SiteGetPayload<{ include: typeof SITE_INCLUDE }>;
const toSiteView = (s: SiteRow): SiteView => ({
  id: s.id,
  name: s.name,
  type: s.type,
  address: s.address,
  latitude: s.latitude,
  longitude: s.longitude,
  isActive: s.isActive,
  island: s.island,
});

const siteQuerySchema = z.object({
  islandId: z.string().optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
});

@ApiTags('organisation')
@ApiBearerAuth()
@Controller()
export class OrganizationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  @Get('islands')
  @AnyAuthenticated()
  @ApiOperation({ summary: 'Les trois îles' })
  async islands(): Promise<IslandView[]> {
    const rows = await this.prisma.island.findMany({
      select: { id: true, code: true, name: true },
    });
    return rows.sort((a, b) => ISLAND_CODES.indexOf(a.code) - ISLAND_CODES.indexOf(b.code));
  }

  @Get('sites')
  @AnyAuthenticated()
  @ApiOperation({ summary: 'Sites visibles (toutes les îles ou la sienne)' })
  async sites(
    @Query(new ZodValidationPipe(siteQuerySchema)) q: z.infer<typeof siteQuerySchema>,
    @CurrentUser() actor: AuthUser,
  ): Promise<SiteView[]> {
    const rows = await this.prisma.site.findMany({
      where: {
        AND: [
          this.scope.sites(actor, q.islandId),
          q.includeInactive === 'true' ? {} : { isActive: true },
        ],
      },
      include: SITE_INCLUDE,
      orderBy: { name: 'asc' },
    });
    return rows
      .map(toSiteView)
      .sort((a, b) => ISLAND_CODES.indexOf(a.island.code) - ISLAND_CODES.indexOf(b.island.code));
  }

  @Post('sites')
  @RequirePermission('users:write')
  @ApiOperation({ summary: 'Créer un site (administrateur)' })
  async createSite(
    @Body(new ZodValidationPipe(siteSchema)) body: SiteInput,
    @Req() req: AuthenticatedRequest,
  ): Promise<SiteView> {
    await this.ensureIsland(body.islandId);
    const site = await this.save(() =>
      this.prisma.site.create({ data: body, include: SITE_INCLUDE }),
    );
    req.audit = { action: 'SITE_CREATE', entity: 'Site', entityId: site.id, after: site };
    return site;
  }

  @Patch('sites/:id')
  @RequirePermission('users:write')
  @ApiOperation({ summary: 'Modifier un site' })
  async updateSite(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSiteSchema)) body: Partial<SiteInput>,
    @Req() req: AuthenticatedRequest,
  ): Promise<SiteView> {
    const before = await this.findSite(id);
    if (body.islandId && body.islandId !== before.island.id) {
      await this.ensureIsland(body.islandId);
      const attached = await this.prisma.user.count({ where: { siteId: id } });
      if (attached > 0) {
        throw new AppException(
          'SITE_IN_USE',
          'Des comptes sont rattachés à ce site : impossible de changer son île',
          HttpStatus.CONFLICT,
        );
      }
    }
    const after = await this.save(() =>
      this.prisma.site.update({ where: { id }, data: body, include: SITE_INCLUDE }),
    );
    req.audit = { action: 'SITE_UPDATE', entity: 'Site', entityId: id, before, after };
    return after;
  }

  @Post('sites/:id/deactivate')
  @HttpCode(200)
  @RequirePermission('users:write')
  @ApiOperation({ summary: 'Désactiver un site (jamais supprimé)' })
  deactivate(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<SiteView> {
    return this.setActive(id, false, req);
  }

  @Post('sites/:id/reactivate')
  @HttpCode(200)
  @RequirePermission('users:write')
  @ApiOperation({ summary: 'Réactiver un site' })
  reactivate(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<SiteView> {
    return this.setActive(id, true, req);
  }

  @Get('permissions/matrix')
  @RequirePermission('users:read')
  @ApiOperation({ summary: 'Matrice des droits (générée depuis packages/shared)' })
  matrix() {
    return {
      modules: MODULE_KEYS.map((key) => ({ key, label: MODULE_LABELS[key] })),
      roles: ROLES.map((role) => ({ role, label: ROLE_LABELS[role], scope: ROLE_SCOPE[role] })),
      permissions: PERMISSIONS,
      actions: ACTIONS,
    };
  }

  private async setActive(id: string, isActive: boolean, req: AuthenticatedRequest) {
    const before = await this.findSite(id);
    const after = toSiteView(
      await this.prisma.site.update({ where: { id }, data: { isActive }, include: SITE_INCLUDE }),
    );
    req.audit = {
      action: isActive ? 'SITE_REACTIVATE' : 'SITE_DEACTIVATE',
      entity: 'Site',
      entityId: id,
      before,
      after,
    };
    return after;
  }

  private async findSite(id: string): Promise<SiteView> {
    const site = await this.prisma.site.findUnique({ where: { id }, include: SITE_INCLUDE });
    if (!site) throw notFound('Site');
    return toSiteView(site);
  }

  private async ensureIsland(id: string) {
    if (!(await this.prisma.island.findUnique({ where: { id } }))) {
      throw new AppException('VALIDATION_ERROR', 'Île inconnue', HttpStatus.UNPROCESSABLE_ENTITY, [
        { path: 'islandId', message: 'Île inconnue' },
      ]);
    }
  }

  private async save(op: () => Promise<SiteRow>): Promise<SiteView> {
    try {
      return toSiteView(await op());
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppException('SITE_NAME_TAKEN', 'Un site porte déjà ce nom', HttpStatus.CONFLICT);
      }
      throw err;
    }
  }
}

@Module({ controllers: [OrganizationController] })
export class OrganizationModule {}
