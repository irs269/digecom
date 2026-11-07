import { validateEnv } from './env';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  WEB_ORIGIN: 'http://localhost:3000',
};

describe('validateEnv', () => {
  it('applique les valeurs par défaut', () => {
    const env = validateEnv(valid);
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(env.LOGIN_MAX_ATTEMPTS).toBe(5);
    expect(env.COOKIE_SECURE).toBe(true);
  });

  it('refuse un secret JWT trop court', () => {
    expect(() => validateEnv({ ...valid, JWT_ACCESS_SECRET: 'court' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('refuse une configuration incomplète', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });
});
