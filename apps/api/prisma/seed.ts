import { PrismaClient } from '@prisma/client';
import { seedDatabase } from './seed-data';

/** `make seed` : données de démonstration (voir seed-data.ts et README). */
// Jamais en production, sauf drapeau explicite (préproduction de recette uniquement).
if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'oui-je-confirme') {
  console.error(
    'Seed de démonstration refusé en production (NODE_ENV=production).\n' +
      'Premier administrateur : pnpm --filter api create-admin (voir docs/DEPLOY.md).\n' +
      'Préproduction uniquement : ALLOW_DEMO_SEED=oui-je-confirme.',
  );
  process.exit(1);
}
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
