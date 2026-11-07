import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { useTestEnv } from './setup-env';

/** Applique les migrations sur la base de test (jamais `db push`). */
export default function globalSetup(): void {
  useTestEnv();
  execSync('pnpm exec prisma migrate deploy', {
    cwd: resolve(__dirname, '..'),
    env: process.env,
    stdio: 'inherit',
  });
}
