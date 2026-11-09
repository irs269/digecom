import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  allocationSchema,
  businessToday,
  notificationPreferencesSchema,
  REPORT_ASYNC_THRESHOLD,
  REPORT_TYPES,
  REPORTS,
  reportQuerySchema,
  reportsForRole,
  salesTargetSchema,
  type AllocationInput,
  type NotificationPreferences,
  type ReportJobAccepted,
  type ReportQuery,
  type ReportType,
  type ReportView,
} from '@digecom/shared';
import { Queue, type Worker } from 'bullmq';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuthenticatedRequest, AuthUser } from '../auth/auth.types';
import { AnyAuthenticated, CurrentUser, RequirePermission } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { createWorker, redisConnection, usesQueues } from '../common/jobs';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { notFound } from '../scope/scope.service';
import { StockModule } from '../stock/stock.module';
import { BUCKETS, StorageService } from '../storage/storage.service';
import { TciModule } from '../tci/tci.controller';
import { DashboardService } from './dashboard.service';
import { NetworkService } from './network.service';
import { renderReportPdf, renderReportXlsx } from './report-export';
import { ReportService } from './report.service';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dashboardQuery = z.object({ islandId: z.string().optional() });
const networkQuery = z.object({
  from: day.optional(),
  to: day.optional(),
  islandId: z.string().optional(),
});
const reportType = z.enum(REPORT_TYPES);

const MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
} as const;

interface ExportJob {
  type: ReportType;
  query: ReportQuery;
  actor: AuthUser;
}

/** Exports volumineux (> 5 000 lignes) : générés hors requête, déposés dans MinIO, lien notifié. */
@Injectable()
export class ReportJobs implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReportJobs.name);
  private queue?: Queue<ExportJob>;
  private worker?: Worker<ExportJob>;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly reports: ReportService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!usesQueues(this.env)) return;
    const connection = redisConnection(this.env);
    this.queue = new Queue<ExportJob>('reports', { connection });
    this.worker = createWorker<ExportJob>(this.env, 'reports', (job) => this.run(job.data));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  async enqueue(job: ExportJob): Promise<void> {
    if (this.queue) await this.queue.add('export', job, { removeOnComplete: 50, removeOnFail: 50 });
    // Tests : exécution immédiate, hors requête.
    else setImmediate(() => void this.run(job));
  }

  async run({ type, query, actor }: ExportJob): Promise<string | null> {
    try {
      const view = await this.reports.build(type, query, actor);
      const format = query.format === 'pdf' ? 'pdf' : 'xlsx';
      const body = format === 'pdf' ? await renderReportPdf(view) : await renderReportXlsx(view);
      const name = `${randomUUID()}.${format}`;
      await this.storage.put(BUCKETS.documents, `reports/${actor.id}/${name}`, body, MIME[format]);
      await this.notifications.send([actor.id], {
        type: 'REPORT_READY',
        title: `Export prêt : ${REPORTS[type].label}`,
        body: `${view.rows.length} lignes, ${format.toUpperCase()}`,
        link: `/api/reports/files/${name}`,
      });
      return name;
    } catch (err) {
      this.logger.error({ err, type }, 'Export de rapport en échec');
      return null;
    }
  }
}

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @RequirePermission('dashboard:read')
  @ApiOperation({ summary: 'Blocs du tableau de bord du rôle connecté (cache 60 s)' })
  get(
    @Query(new ZodValidationPipe(dashboardQuery)) q: z.infer<typeof dashboardQuery>,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.dashboard.get(actor, q.islandId);
  }
}

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportService,
    private readonly jobs: ReportJobs,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @RequirePermission('reports:read')
  @ApiOperation({ summary: 'Rapports disponibles pour le profil' })
  list(@CurrentUser() actor: AuthUser) {
    return reportsForRole(actor.role).map((type) => ({ type, ...REPORTS[type] }));
  }

  @Get('meta/leaders')
  @RequirePermission('reports:read')
  @ApiOperation({ summary: 'Leaders proposés dans le filtre des rapports' })
  async leaders(@CurrentUser() actor: AuthUser) {
    return this.prisma.user.findMany({
      where: {
        role: { in: ['LEADER_SENIOR', 'LEADER_JUNIOR'] },
        ...(actor.role.startsWith('LEADER') ? { id: actor.id } : {}),
      },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    });
  }

  @Get('files/:name')
  @RequirePermission('reports:read')
  @ApiOperation({ summary: 'Télécharge un export généré en tâche de fond (le sien uniquement)' })
  async file(@Param('name') name: string, @CurrentUser() actor: AuthUser) {
    if (!/^[0-9a-f-]{36}\.(xlsx|pdf)$/.test(name)) throw notFound('Export');
    return { url: await this.storage.presignGet(BUCKETS.documents, `reports/${actor.id}/${name}`) };
  }

  @Get(':type')
  @RequirePermission('reports:read')
  @ApiOperation({ summary: 'Rapport (JSON) ou export XLSX / PDF ; > 5 000 lignes : tâche de fond' })
  async get(
    @Param('type', new ZodValidationPipe(reportType)) type: ReportType,
    @Query(new ZodValidationPipe(reportQuerySchema)) q: ReportQuery,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReportView | ReportJobAccepted | StreamableFile> {
    const view = await this.reports.build(type, q, actor);
    if (q.format === 'json') {
      req.audit = { skip: true };
      return view;
    }
    req.audit = { action: 'REPORT_EXPORT', entity: 'Report', entityId: type, after: q };
    if (view.rows.length > REPORT_ASYNC_THRESHOLD) {
      await this.jobs.enqueue({ type, query: q, actor });
      res.status(HttpStatus.ACCEPTED);
      return {
        queued: true,
        rows: view.rows.length,
        message: 'Export volumineux en préparation : le lien arrivera dans tes notifications.',
      };
    }
    const body = q.format === 'pdf' ? await renderReportPdf(view) : await renderReportXlsx(view);
    res.setHeader('Content-Type', MIME[q.format]);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="rapport-${type}-${q.from}-${q.to}.${q.format}"`,
    );
    return new StreamableFile(body);
  }
}

@ApiTags('network')
@ApiBearerAuth()
@Controller('network')
export class NetworkController {
  constructor(
    private readonly network: NetworkService,
    private readonly dashboard: DashboardService,
  ) {}

  @Get()
  @RequirePermission('network:read')
  @ApiOperation({
    summary: 'Équipes, performances et quantités attribuées (cycle en cours par défaut)',
  })
  async list(
    @Query(new ZodValidationPipe(networkQuery)) q: z.infer<typeof networkQuery>,
    @CurrentUser() actor: AuthUser,
  ) {
    const cycle = await this.dashboard.currentCycle(businessToday());
    return this.network.list(
      actor,
      { start: q.from ?? cycle.start, end: q.to ?? cycle.end },
      q.islandId,
    );
  }

  @Post('allocations')
  @RequirePermission('network:allocate')
  @ApiOperation({ summary: 'Attribuer (ou retirer) des quantités à un e-commerçant de son équipe' })
  async allocate(
    @Body(new ZodValidationPipe(allocationSchema)) body: AllocationInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    const a = await this.network.allocate(body, actor);
    req.audit = {
      action: 'NETWORK_ALLOCATE',
      entity: 'SellerAllocation',
      entityId: a.id,
      after: body,
    };
    return a;
  }

  @Put('targets/:leaderId')
  @RequirePermission('network:write')
  @ApiOperation({ summary: 'Objectif hebdomadaire de chiffre d’affaires d’une équipe' })
  async target(
    @Param('leaderId') leaderId: string,
    @Body(new ZodValidationPipe(salesTargetSchema)) body: { weeklyRevenue: number },
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    const t = await this.network.setTarget(leaderId, body.weeklyRevenue, actor);
    req.audit = { action: 'NETWORK_TARGET', entity: 'SalesTarget', entityId: t.id, after: body };
    return t;
  }
}

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications/preferences')
export class NotificationPreferencesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @AnyAuthenticated()
  async get(@CurrentUser() actor: AuthUser): Promise<NotificationPreferences> {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: { notificationPrefs: true },
    });
    return (u.notificationPrefs ?? {}) as NotificationPreferences;
  }

  @Put()
  @AnyAuthenticated()
  @ApiOperation({ summary: 'Préférences par type et canal (in-app toujours actif)' })
  async put(
    @Body(new ZodValidationPipe(notificationPreferencesSchema)) body: NotificationPreferences,
    @CurrentUser() actor: AuthUser,
  ): Promise<NotificationPreferences> {
    const u = await this.prisma.user.update({
      where: { id: actor.id },
      data: { notificationPrefs: body },
      select: { notificationPrefs: true },
    });
    return u.notificationPrefs as NotificationPreferences;
  }
}

/** Phase 6 : tableaux de bord, réseau commercial, rapports et exports. */
@Module({
  imports: [StockModule, TciModule],
  controllers: [
    DashboardController,
    ReportsController,
    NetworkController,
    NotificationPreferencesController,
  ],
  providers: [DashboardService, ReportService, NetworkService, ReportJobs],
  exports: [ReportService, DashboardService],
})
export class ReportsModule {}
