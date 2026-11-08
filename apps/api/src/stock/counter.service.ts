import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

/** Numéros lisibles uniques (LOT-018, PRD-000124…) : compteur incrémenté atomiquement en base. */
@Injectable()
export class CounterService {
  constructor(private readonly prisma: PrismaService) {}

  async next(key: string, db: Db = this.prisma): Promise<number> {
    const rows = await db.$queryRaw<{ value: number }[]>`
      INSERT INTO "Counter" ("key", "value") VALUES (${key}, 1)
      ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1
      RETURNING "value"`;
    return rows[0]!.value;
  }

  /** Garantit que le compteur vaut au moins `min` (après un seed ou un import). */
  async ensureAtLeast(key: string, min: number, db: Db = this.prisma): Promise<void> {
    await db.$executeRaw`
      INSERT INTO "Counter" ("key", "value") VALUES (${key}, ${min})
      ON CONFLICT ("key") DO UPDATE SET "value" = GREATEST("Counter"."value", ${min})`;
  }

  async formatted(key: string, prefix: string, width: number, db?: Db): Promise<string> {
    const n = await this.next(key, db);
    return `${prefix}${String(n).padStart(width, '0')}`;
  }
}
