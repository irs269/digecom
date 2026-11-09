import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  callOutcomeSchema,
  campaignSchema,
  isoWeekSchema,
  PROSPECT_STATUSES,
  prospectAssignSchema,
  prospectConfirmSchema,
  prospectImportSchema,
  prospectManualSchema,
  tciCloseSchema,
  type CampaignInput,
  type ProspectConfirmInput,
  type ProspectStatus,
} from '@digecom/shared';
import { Queue, type Worker } from 'bullmq';
import { z } from 'zod';
import type { AuthenticatedRequest, AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { createWorker, redisConnection, usesQueues } from '../common/jobs';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { OrdersModule } from '../orders/orders.module';
import { CampaignService } from './campaign.service';
import { TciService } from './tci.service';

const updateCampaignSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  productId: z.string().optional(),
  channel: z.enum(['FACEBOOK', 'TIKTOK', 'WHATSAPP', 'INSTAGRAM', 'OTHER']).optional(),
  budget: z.number().int().min(0).optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
const prospectQuery = z.object({
  status: z.enum(PROSPECT_STATUSES).optional(),
  campaignId: z.string().optional(),
});
const weekQuery = z.object({ week: isoWeekSchema.optional(), leaderId: z.string().optional() });

@ApiTags('campaigns')
@ApiBearerAuth()
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignService) {}

  @Get()
  @RequirePermission('campaigns:read')
  @ApiOperation({
    summary: 'Campagnes et indicateurs (contacts, confirmées, vendues, coût par vente)',
  })
  list(@CurrentUser() actor: AuthUser) {
    return this.campaigns.list(actor);
  }

  @Post()
  @RequirePermission('campaigns:create')
  @ApiOperation({ summary: 'Nouvelle campagne (le budget devient une dépense à valider)' })
  async create(
    @Body(new ZodValidationPipe(campaignSchema)) body: CampaignInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    const c = await this.campaigns.create(body, actor);
    req.audit = { action: 'CAMPAIGN_CREATE', entity: 'Campaign', entityId: c.id, after: body };
    return c;
  }

  @Patch(':id')
  @RequirePermission('campaigns:edit')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCampaignSchema)) body: Partial<CampaignInput>,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    const c = await this.campaigns.update(id, body, actor);
    req.audit = { action: 'CAMPAIGN_UPDATE', entity: 'Campaign', entityId: id, after: body };
    return c;
  }

  @Post(':id/pause')
  @HttpCode(200)
  @RequirePermission('campaigns:pause')
  async pause(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    req.audit = { action: 'CAMPAIGN_PAUSE', entity: 'Campaign', entityId: id };
    return this.campaigns.setStatus(id, 'PAUSED', actor);
  }

  @Post(':id/resume')
  @HttpCode(200)
  @RequirePermission('campaigns:resume')
  async resume(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    req.audit = { action: 'CAMPAIGN_RESUME', entity: 'Campaign', entityId: id };
    return this.campaigns.setStatus(id, 'ACTIVE', actor);
  }

  @Post(':id/prospects')
  @RequirePermission('prospects:import')
  @ApiOperation({ summary: 'Saisie manuelle d’un prospect' })
  async add(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(prospectManualSchema)) body: z.infer<typeof prospectManualSchema>,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    const p = await this.campaigns.addProspect(id, body, actor);
    req.audit = { action: 'PROSPECT_CREATE', entity: 'Prospect', entityId: p.id };
    return p;
  }

  @Post(':id/prospects/import')
  @HttpCode(200)
  @RequirePermission('prospects:import')
  @ApiOperation({ summary: 'Import CSV / XLSX (aperçu avec dryRun, puis enregistrement)' })
  async import(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(prospectImportSchema)) body: z.infer<typeof prospectImportSchema>,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    const r = await this.campaigns.importProspects(id, body, actor);
    req.audit = body.dryRun
      ? { skip: true }
      : {
          action: 'PROSPECT_IMPORT',
          entity: 'Campaign',
          entityId: id,
          after: {
            file: body.fileName,
            rows: r.rows,
            imported: r.imported,
            duplicates: r.duplicates,
            invalid: r.invalid,
          },
        };
    return r;
  }

  @Post(':id/prospects/assign')
  @HttpCode(200)
  @RequirePermission('prospects:assign')
  @ApiOperation({ summary: 'Répartition entre les TCI (manuelle ou équitable)' })
  async assign(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(prospectAssignSchema)) body: z.infer<typeof prospectAssignSchema>,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    const r = await this.campaigns.assign(id, body, actor);
    req.audit = { action: 'PROSPECT_ASSIGN', entity: 'Campaign', entityId: id, after: r };
    return r;
  }
}

@ApiTags('prospects')
@ApiBearerAuth()
@Controller('prospects')
export class ProspectsController {
  constructor(private readonly campaigns: CampaignService) {}

  @Get()
  @RequirePermission('prospects:read')
  @ApiOperation({ summary: 'Prospects (TCI : les siens ; Leader Junior : son équipe)' })
  list(
    @Query(new ZodValidationPipe(prospectQuery))
    q: { status?: ProspectStatus; campaignId?: string },
    @CurrentUser() actor: AuthUser,
  ) {
    return this.campaigns.prospects(actor, q);
  }

  @Post(':id/call')
  @HttpCode(200)
  @RequirePermission('prospects:call_outcome')
  @ApiOperation({ summary: 'Résultat d’appel : injoignable ou pas intéressé' })
  async call(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(callOutcomeSchema)) body: z.infer<typeof callOutcomeSchema>,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    const p = await this.campaigns.callOutcome(id, body.outcome, body.note, actor);
    req.audit = {
      action: `PROSPECT_${body.outcome}`,
      entity: 'Prospect',
      entityId: id,
      after: body,
    };
    return p;
  }

  @Post(':id/confirm')
  @RequirePermission('prospects:call_outcome')
  @ApiOperation({ summary: 'Commande confirmée : crée la commande (circuit normal)' })
  async confirm(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(prospectConfirmSchema)) body: ProspectConfirmInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    const r = await this.campaigns.confirm(id, body, actor);
    req.audit = {
      action: 'PROSPECT_CONFIRM',
      entity: 'Prospect',
      entityId: id,
      after: { order: r.order.number },
    };
    return r;
  }
}

@ApiTags('tci')
@ApiBearerAuth()
@Controller('tci')
export class TciController {
  constructor(private readonly tci: TciService) {}

  @Get('me/earnings')
  @RequirePermission('tci_sales:read')
  @ApiOperation({ summary: 'Mes ventes et gains (semaine ISO, gains globaux, à clôturer)' })
  mine(
    @Query(new ZodValidationPipe(weekQuery)) q: z.infer<typeof weekQuery>,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.tci.myEarnings(actor, q.week);
  }

  @Get('team/earnings')
  @RequirePermission('tci_sales:read')
  @ApiOperation({ summary: 'Ventes de l’équipe (Leader Junior) ou d’une équipe (direction)' })
  team(
    @Query(new ZodValidationPipe(weekQuery)) q: z.infer<typeof weekQuery>,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.tci.teamEarnings(actor, q.week, q.leaderId);
  }

  @Post('sales/:orderId/close')
  @HttpCode(200)
  @RequirePermission('tci_sales:close')
  @ApiOperation({ summary: 'Clôturer une vente livrée : Vendu ou Client a refusé' })
  async close(
    @Param('orderId') orderId: string,
    @Body(new ZodValidationPipe(tciCloseSchema)) body: z.infer<typeof tciCloseSchema>,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    const o = await this.tci.close(orderId, body.result, body.reason, actor);
    req.audit = {
      action: `TCI_CLOSE_${body.result}`,
      entity: 'Order',
      entityId: orderId,
      after: { number: o.number, status: o.status },
    };
    return o;
  }
}

/** Fin automatique des campagnes à leur date de fin (chaque jour à 00:05 heure des Comores). */
@Injectable()
export class CampaignJobs implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CampaignJobs.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly campaigns: CampaignService,
  ) {}

  async onModuleInit() {
    if (!usesQueues(this.env)) return;
    const connection = redisConnection(this.env);
    this.queue = new Queue('campaigns', { connection });
    await this.queue.upsertJobScheduler(
      'end-campaigns',
      { pattern: '5 21 * * *', tz: 'UTC' },
      { name: 'end' },
    );
    this.worker = createWorker(this.env, 'campaigns', async () => {
      const n = await this.campaigns.endExpired();
      this.logger.log(`${n} campagne(s) terminée(s)`);
      return n;
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }
}

@Module({
  imports: [OrdersModule],
  controllers: [CampaignsController, ProspectsController, TciController],
  providers: [CampaignService, TciService, CampaignJobs],
  exports: [CampaignService, TciService],
})
export class TciModule {}
