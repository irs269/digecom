import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  Injectable,
  Module,
  OnModuleDestroy,
  OnModuleInit,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Queue } from 'bullmq';
import type { Response } from 'express';
import { Public, RequirePermission } from '../auth/decorators';
import { LATENCY_BUCKETS } from '../common/http-guards';
import { redisConnection, setJobFailureHandler, usesQueues } from '../common/jobs';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.module';
import { StorageService } from '../storage/storage.service';

/** Files BullMQ de l'application (supervision des jobs en échec). */
export const QUEUES = [
  'finance',
  'delivery-alerts',
  'stock-alerts',
  'campaigns',
  'reports',
] as const;

/** Échec d'un job : alerte in-app des administrateurs (une par file et par heure au plus). */
@Injectable()
export class JobAlerts implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly notifications: NotificationService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    setJobFailureHandler(async (queue, job, err) => {
      await this.redis.hincrby('ops:jobs:failed', queue, 1);
      const first = await this.redis.set(`ops:alert:${queue}`, '1', 'EX', 3600, 'NX');
      if (!first) return;
      const users = await this.notifications.usersWithRoles(
        queue === 'finance' ? ['ADMIN', 'FINANCE_MANAGER'] : ['ADMIN'],
      );
      await this.notifications.send(users, {
        type: 'JOB_FAILED',
        title: `Tâche automatique en échec : ${queue}/${job?.name ?? '?'}`,
        body: err.message.slice(0, 200),
        link: '/parametres',
      });
    });
  }

  onModuleDestroy(): void {
    setJobFailureHandler(null);
  }
}

@ApiTags('health')
@Controller()
export class OpsController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  /** Prêt à servir : base (migrations appliquées), Redis et stockage S3 joignables. */
  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Disponibilité des dépendances (base, migrations, Redis, S3)' })
  async ready(@Res({ passthrough: true }) res: Response) {
    const [db, migrations, redis, storage] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => 'up').catch(() => 'down'),
      this.prisma.$queryRaw<{ n: number }[]>`
          SELECT COUNT(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NULL`
        .then((r) => (r[0]?.n ? 'pending' : 'up'))
        .catch(() => 'down'),
      this.redis
        .ping()
        .then((r) => (r === 'PONG' ? 'up' : 'down'))
        .catch(() => 'down'),
      this.storage.ping().then((ok) => (ok ? 'up' : 'down')),
    ]);
    const checks = { db, migrations, redis, storage };
    const ok = Object.values(checks).every((v) => v === 'up');
    res.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ok ? 'ok' : 'error', role: this.env.PROCESS_ROLE, checks };
  }

  /** Tableau de bord d'exploitation : 60 dernières minutes et jobs en échec. */
  @Get('ops/metrics')
  @ApiBearerAuth()
  @RequirePermission('settings:edit')
  @ApiOperation({ summary: 'Requêtes, erreurs 5xx, latence (60 min) et jobs en échec' })
  async metrics() {
    const now = Math.floor(Date.now() / 60_000);
    const minutes = Array.from({ length: 60 }, (_, i) => now - i);
    const multi = this.redis.multi();
    for (const m of minutes) multi.hgetall(`ops:m:${m}`);
    const rows = ((await multi.exec()) ?? []).map((r) => (r[1] ?? {}) as Record<string, string>);
    const sum = (k: string) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
    const requests = sum('requests');
    const histogram = [...LATENCY_BUCKETS, 'inf' as const].map((b) => ({
      le: b,
      count: sum(`lat:${b}`),
    }));
    let acc = 0;
    const p95 =
      requests > 0
        ? (histogram.find((h) => (acc += h.count) >= requests * 0.95)?.le ?? 'inf')
        : null;
    const failedJobs: Record<string, number> = {};
    if (usesQueues(this.env)) {
      const connection = redisConnection(this.env);
      for (const name of QUEUES) {
        const q = new Queue(name, { connection });
        failedJobs[name] = (await q.getJobCounts('failed')).failed ?? 0;
        await q.close();
      }
    }
    return {
      window: '60 min',
      requests,
      errors5xx: sum('errors5xx'),
      errorRate: requests ? Math.round((sum('errors5xx') / requests) * 10_000) / 100 : 0,
      latencyP95Ms: p95,
      histogram,
      perMinute: minutes
        .map((m, i) => ({
          at: new Date(m * 60_000).toISOString(),
          requests: Number(rows[i]!.requests ?? 0),
          errors5xx: Number(rows[i]!.errors5xx ?? 0),
        }))
        .reverse(),
      failedJobs,
      failedJobsSinceStart: await this.redis.hgetall('ops:jobs:failed'),
    };
  }
}

@Module({ controllers: [OpsController], providers: [JobAlerts] })
export class OpsModule {}
