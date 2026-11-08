import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
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
    if (this.env.NODE_ENV === 'test') return;
    const url = new URL(this.env.REDIS_URL);
    const connection = {
      host: url.hostname,
      port: Number(url.port || 6379),
      db: Number(url.pathname.slice(1) || 0),
      password: url.password || undefined,
      maxRetriesPerRequest: null,
    };
    this.queue = new Queue(QUEUE, { connection });
    await this.queue.upsertJobScheduler(
      'daily-unsold',
      { pattern: '0 3 * * *', tz: 'UTC' },
      { name: 'refresh-unsold', opts: { removeOnComplete: 30, removeOnFail: 30 } },
    );
    this.worker = new Worker(
      QUEUE,
      async () => {
        const result = await this.query.refreshUnsoldAlerts();
        this.logger.log(
          `Alertes invendus : ${result.opened} ouverte(s), ${result.resolved} close(s)`,
        );
        return result;
      },
      { connection },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
