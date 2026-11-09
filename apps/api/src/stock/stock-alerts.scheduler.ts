import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, type Worker } from 'bullmq';
import { createWorker, redisConnection, usesQueues } from '../common/jobs';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { StockQueryService } from './stock-query.service';

const QUEUE = 'stock-alerts';

/**
 * Job quotidien BullMQ : alertes « invendu depuis N jours » (06:00 heure des Comores = 03:00 UTC).
 * Désactivé dans les tests (déclenchement manuel via POST /stock/alerts/refresh).
 */
@Injectable()
export class StockAlertsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StockAlertsScheduler.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly query: StockQueryService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!usesQueues(this.env)) return;
    const connection = redisConnection(this.env);
    this.queue = new Queue(QUEUE, { connection });
    await this.queue.upsertJobScheduler(
      'daily-unsold',
      { pattern: '0 3 * * *', tz: 'UTC' },
      { name: 'refresh-unsold', opts: { removeOnComplete: 30, removeOnFail: 30 } },
    );
    this.worker = createWorker(this.env, QUEUE, async () => {
      const result = await this.query.refreshUnsoldAlerts();
      this.logger.log(
        `Alertes invendus : ${result.opened} ouverte(s), ${result.resolved} close(s)`,
      );
      return result;
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
