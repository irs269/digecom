import { CallsModule } from './calls/calls.module';
import { MobileModule } from './mobile/mobile.module';
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { ConfigModule } from './config/config.module';
import { FinanceModule } from './finance/finance.controller';
import { LedgerModule } from './finance/ledger.service';
import { HealthModule } from './health/health.controller';
import { OpsModule } from './health/ops.module';
import { NotificationsModule } from './notifications/notifications.controller';
import { OrdersModule } from './orders/orders.module';
import { OrganizationModule } from './organization/organization.controller';
import { PrismaModule } from './prisma/prisma.service';
import { InsightsModule } from './reports/insights.module';
import { ReportsModule } from './reports/reports.controller';
import { RedisModule } from './redis/redis.module';
import { ScopeModule } from './scope/scope.service';
import { SettingsModule } from './settings/settings.controller';
import { StockModule } from './stock/stock.module';
import { StorageModule } from './storage/storage.service';
import { TciModule } from './tci/tci.controller';
import { UsersModule } from './users/users.controller';

const isDev = process.env.NODE_ENV === 'development';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        // Identifiant de requête : repris de l'en-tête X-Request-Id ou généré.
        genReqId: (req: IncomingMessage, res) => {
          const header = req.headers['x-request-id'];
          const id = typeof header === 'string' && header.length <= 100 ? header : randomUUID();
          res.setHeader('X-Request-Id', id);
          return id;
        },
        redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
        autoLogging: { ignore: (req) => req.url === '/health' },
        transport: isDev ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
      },
    }),
    PrismaModule,
    RedisModule,
    ScopeModule,
    SettingsModule,
    StorageModule,
    NotificationsModule,
    MobileModule,
    CallsModule,
    LedgerModule,
    InsightsModule,
    AuditModule,
    AuthModule,
    UsersModule,
    OrganizationModule,
    StockModule,
    OrdersModule,
    FinanceModule,
    TciModule,
    ReportsModule,
    HealthModule,
    OpsModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
})
export class AppModule {}
