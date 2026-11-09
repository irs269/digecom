import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, type Worker } from 'bullmq';
import { createWorker, redisConnection, usesQueues } from '../common/jobs';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

const QUEUE = 'delivery-alerts';

/**
 * Alerte « aucun livreur » : un job BullMQ différé de `delivery.noCourierAlertMinutes` vérifie si
 * la commande est toujours prête sans livreur et prévient l'assistant logistique de l'île.
 * La vérification est une méthode testable avec une horloge simulée (`check(orderId, now)`).
 */
@Injectable()
export class DeliveryJobs implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryJobs.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    @Inject(forwardRef(() => NotificationService))
    private readonly notifications: NotificationService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!usesQueues(this.env)) return;
    const connection = redisConnection(this.env);
    this.queue = new Queue(QUEUE, { connection });
    this.worker = createWorker(this.env, QUEUE, async (job) =>
      this.check((job.data as { orderId: string }).orderId),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  async scheduleNoCourierCheck(orderId: string): Promise<void> {
    if (!this.queue) return;
    const minutes = await this.settings.get('delivery.noCourierAlertMinutes');
    await this.queue.add(
      'no-courier',
      { orderId },
      {
        delay: minutes * 60_000,
        jobId: `no-courier-${orderId}-${Date.now()}`,
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
  }

  /** Renvoie `true` si l'alerte a été envoyée. */
  async check(orderId: string, now: Date = new Date()): Promise<boolean> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (
      !order ||
      order.status !== 'READY' ||
      order.deliveryMode === 'PICKUP' ||
      order.courierId ||
      !order.readyAt
    ) {
      return false;
    }
    const minutes = await this.settings.get('delivery.noCourierAlertMinutes', order.readyAt);
    if (now.getTime() - order.readyAt.getTime() < minutes * 60_000) return false;
    const logistics = await this.notifications.usersWithRoles(
      ['LOGISTICS_ASSISTANT'],
      order.islandId,
    );
    await this.notifications.send(logistics, {
      type: 'NO_COURIER',
      title: `${order.number} : aucun livreur après ${minutes} min`,
      body: 'Affecte manuellement un livreur de l’île',
      link: `/livraisons?id=${order.id}`,
    });
    this.logger.log(`Alerte sans livreur envoyée pour ${order.number}`);
    return true;
  }
}
