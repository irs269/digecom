import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { businessToday, weekStart } from '@digecom/shared';
import { Queue, Worker } from 'bullmq';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { SettingsService } from '../settings/settings.service';
import { LedgerService } from './ledger.service';
import { SettlementService } from './settlement.service';

const QUEUE = 'finance';

/**
 * Jobs financiers (BullMQ, idempotents) :
 * - abonnements : lundi 00:00 heure des Comores (dimanche 21:00 UTC) ;
 * - relevés : chaque jour à 00:30 heure des Comores, génère le dernier cycle terminé.
 */
@Injectable()
export class FinanceJobs implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FinanceJobs.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly ledger: LedgerService,
    private readonly settlements: SettlementService,
    private readonly settings: SettingsService,
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
      'weekly-subscriptions',
      { pattern: '0 21 * * 0', tz: 'UTC' },
      { name: 'subscriptions' },
    );
    await this.queue.upsertJobScheduler(
      'daily-settlements',
      { pattern: '30 21 * * *', tz: 'UTC' },
      { name: 'settlements' },
    );
    this.worker = new Worker(
      QUEUE,
      async (job) => {
        if (job.name === 'subscriptions') return this.runSubscriptions();
        if (job.name === 'settlements') return this.runSettlements();
        return null;
      },
      { connection },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  /** Abonnements de la semaine contenant `day` (relançable sans doublon). */
  async runSubscriptions(day = businessToday()): Promise<number> {
    const week = weekStart(day);
    const amount = await this.settings.get('subscription.weekly');
    const count = await this.ledger.chargeSubscriptions(week, amount);
    this.logger.log(`Abonnements semaine du ${week} : ${count} écriture(s)`);
    return count;
  }

  async runSettlements(day = businessToday()) {
    const result = await this.settlements.generateDue(day);
    this.logger.log(`Relevés : ${result.created} créé(s), ${result.skipped} déjà présent(s)`);
    return result;
  }
}
