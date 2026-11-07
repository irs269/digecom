/** Bascule l'API sur la base et le Redis de test avant tout import de l'application. */
export function useTestEnv(): void {
  if (process.env.DIGECOM_TEST_ENV === '1') return; // déjà basculé (setupFiles + globalSetup)
  process.env.DIGECOM_TEST_ENV = '1';
  if (!process.env.DATABASE_URL_TEST || !process.env.REDIS_URL_TEST) {
    throw new Error('DATABASE_URL_TEST et REDIS_URL_TEST sont requis (fournis par compose.yml).');
  }
  if (process.env.DATABASE_URL_TEST === process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL_TEST doit être différente de DATABASE_URL.');
  }
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  process.env.REDIS_URL = process.env.REDIS_URL_TEST;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  process.env.COOKIE_SECURE = 'true';
  process.env.JWT_ACCESS_SECRET ??= 'secret-de-test-uniquement-pour-les-tests-e2e-0123456789';
  process.env.WEB_ORIGIN ??= 'http://localhost:3000';
}

useTestEnv();
