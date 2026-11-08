import { Global, Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { businessToday, formatKmf, isoWeekOf, isoWeekRange } from '@digecom/shared';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.module';
import { salesTotals } from './sales-query';

/** Modèles dont une écriture change un chiffre de tableau de bord. */
const WATCHED = new Set([
  'Order',
  'OrderItem',
  'LedgerEntry',
  'Settlement',
  'CashSession',
  'CashOperation',
  'Expense',
  'StockLevel',
  'Lot',
  'PurchaseOrder',
  'Campaign',
  'Prospect',
  'SellerAllocation',
  'User',
]);
const WRITES = new Set([
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);
const VERSION_KEY = 'dashboard:version';

/**
 * Cache Redis des tableaux de bord (60 s), invalidé par événement : toute écriture sur un modèle
 * suivi incrémente une version, ce qui rend caduques toutes les entrées en cache.
 */
@Injectable()
export class DashboardCache implements OnModuleInit {
  static readonly TTL_SECONDS = 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    this.prisma.$use(async (params, next) => {
      const result = await next(params);
      if (params.model && WATCHED.has(params.model) && WRITES.has(params.action)) await this.bump();
      return result;
    });
  }

  async bump(): Promise<void> {
    await this.redis.incr(VERSION_KEY).catch(() => undefined);
  }

  async wrap<T>(key: string, compute: () => Promise<T>): Promise<T> {
    let version = '0';
    try {
      version = (await this.redis.get(VERSION_KEY)) ?? '0';
      const hit = await this.redis.get(`dashboard:${version}:${key}`);
      if (hit) return JSON.parse(hit) as T;
    } catch {
      // Redis indisponible : calcul direct.
    }
    const value = await compute();
    this.redis
      .set(`dashboard:${version}:${key}`, JSON.stringify(value), 'EX', DashboardCache.TTL_SECONDS)
      .catch(() => undefined);
    return value;
  }
}

/** Objectifs hebdomadaires des équipes : notification « objectif atteint » une fois par semaine. */
@Injectable()
export class SalesTargets {
  private readonly logger = new Logger(SalesTargets.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  async check(leaderId: string, today = businessToday()): Promise<boolean> {
    try {
      const target = await this.prisma.salesTarget.findUnique({ where: { leaderId } });
      if (!target || target.weeklyRevenue <= 0) return false;
      const week = isoWeekOf(today);
      if (target.lastReachedWeek === week) return false;
      const range = isoWeekRange(week);
      const totals = await salesTotals(this.prisma, { from: range.start, to: range.end, leaderId });
      if (totals.revenue < target.weeklyRevenue) return false;
      // Une seule notification par semaine, même en cas d'appels concurrents.
      const { count } = await this.prisma.salesTarget.updateMany({
        where: {
          id: target.id,
          OR: [{ lastReachedWeek: null }, { lastReachedWeek: { not: week } }],
        },
        data: { lastReachedWeek: week },
      });
      if (!count) return false;
      const admins = await this.notifications.usersWithRoles(['ADMIN']);
      await this.notifications.send([leaderId, ...admins], {
        type: 'TARGET_REACHED',
        title: 'Objectif de la semaine atteint',
        body: `${formatKmf(totals.revenue)} vendus sur un objectif de ${formatKmf(target.weeklyRevenue)}`,
        link: '/reseau',
      });
      return true;
    } catch (err) {
      this.logger.error({ err, leaderId }, 'Contrôle d’objectif impossible');
      return false;
    }
  }
}

@Global()
@Module({ providers: [DashboardCache, SalesTargets], exports: [DashboardCache, SalesTargets] })
export class InsightsModule {}
