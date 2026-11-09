import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { businessToday, weekStart } from '@digecom/shared';
import { Queue, type Worker } from 'bullmq';
import { createWorker, redisConnection, usesQueues } from '../common/jobs';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { NotificationService } from '../notifications/notification.service';
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
    private readonly notifications: NotificationService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!usesQueues(this.env)) return;
    const connection = redisConnection(this.env);
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
    this.worker = createWorker(this.env, QUEUE, async (job) => {
      if (job.name === 'subscriptions') return this.runSubscriptions();
      if (job.name === 'settlements') return this.runSettlements();
      return null;
    });
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
    if (count > 0) {
      const charged = await this.ledger.subscribersOf(week);
      await this.notifications.send(charged, {
        type: 'SUBSCRIPTION_DUE',
        title: 'Abonnement de la semaine',
        body: `${amount.toLocaleString('fr-FR')} KMF déduits de ton prochain règlement`,
        link: '/reglements',
      });
    }
    this.logger.log(`Abonnements semaine du ${week} : ${count} écriture(s)`);
    return count;
  }

  async runSettlements(day = businessToday()) {
    const result = await this.settlements.generateDue(day);
    this.logger.log(`Relevés : ${result.created} créé(s), ${result.skipped} déjà présent(s)`);
    return result;
  }
}
