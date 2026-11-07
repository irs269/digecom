import { PrismaClient } from '@prisma/client';
import { seedDatabase } from './seed-data';

/** `make seed` : données de démonstration (voir seed-data.ts et README). */
const prisma = new PrismaClient();

seedDatabase(
  prisma,
  process.env.SEED_DEFAULT_PASSWORD ?? '',
  process.env.SEED_FORCE_PASSWORD_CHANGE === 'true',
)
  .then((summary) => console.log(summary))
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
