import { Body, Controller, Module, Post, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import request from 'supertest';
import { seedDatabase } from '../prisma/seed-data';
import { AppModule } from '../src/app.module';
import { RequirePermission } from '../src/auth/decorators';
import { configureApp } from '../src/bootstrap';

export const PASSWORD = 'Mot-de-passe-test-1';

/** Contrôleur réservé aux tests : vérifie l'audit des mutations et les gardes. */
@Controller('__test')
class TestOnlyController {
  @Post('echo')
  @RequirePermission('settings:edit')
  echo(@Body() body: Record<string, unknown>) {
    return { id: 'echo-1', ...body };
  }

  @Post('undeclared')
  undeclared() {
    return { ok: true };
  }
}

@Module({ controllers: [TestOnlyController] })
class TestOnlyModule {}

export interface TestContext {
  app: INestApplication;
  prisma: PrismaClient;
  close: () => Promise<void>;
}

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "StockAlert", "InventoryLine", "Inventory", "StockMovement", "Lot", "PurchaseOrder", "Supplier", "StockLevel", "Product", "Counter", "AuditLog", "TeamAssignmentHistory", "RefreshToken", "Setting", "User", "Site", "Island" RESTART IDENTITY CASCADE',
  );
  await seedDatabase(prisma, PASSWORD, false);
  const redis = new Redis(process.env.REDIS_URL!);
  await redis.flushdb();
  await redis.quit();
}

export async function createTestApp(): Promise<TestContext> {
  const prisma = new PrismaClient();
  await resetDatabase(prisma);

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, TestOnlyModule],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();

  return {
    app,
    prisma,
    close: async () => {
      await app.close();
      await prisma.$disconnect();
    },
  };
}

let ipCounter = 0;
/** Une IP différente par appel : isole les tests de la limitation par IP + téléphone. */
export function freshIp(): string {
  ipCounter += 1;
  return `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

export function login(app: INestApplication, phone: string, password = PASSWORD, ip = freshIp()) {
  return request(app.getHttpServer())
    .post('/auth/login')
    .set('X-Forwarded-For', ip)
    .send({ phone, password });
}

export function refreshCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith('dc_rt='));
  if (!cookie) throw new Error('Cookie dc_rt absent');
  return cookie.split(';')[0]!;
}
