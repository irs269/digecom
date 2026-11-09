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

  it('production : refuse outils de dev, Swagger, cookie non sécurisé et http', () => {
    const prod = {
      ...valid,
      NODE_ENV: 'production',
      WEB_ORIGIN: 'https://app.digecom.km',
      S3_ACCESS_KEY: 'k'.repeat(20),
      S3_SECRET_KEY: 's'.repeat(40),
    };
    expect(validateEnv(prod).PROCESS_ROLE).toBe('all');
    expect(() => validateEnv({ ...prod, DEV_TOOLS_ENABLED: 'true' })).toThrow(/DEV_TOOLS_ENABLED/);
    expect(() => validateEnv({ ...prod, SWAGGER_ENABLED: 'true' })).toThrow(/SWAGGER_ENABLED/);
    expect(() => validateEnv({ ...prod, COOKIE_SECURE: 'false' })).toThrow(/COOKIE_SECURE/);
    expect(() => validateEnv({ ...prod, WEB_ORIGIN: 'http://app.digecom.km' })).toThrow(/https/);
  });

  it('production : refuse un secret resté à sa valeur d’exemple', () => {
    const prod = {
      ...valid,
      NODE_ENV: 'production',
      WEB_ORIGIN: 'https://app.digecom.km',
      S3_ACCESS_KEY: 'k'.repeat(20),
      S3_SECRET_KEY: 's'.repeat(40),
    };
    expect(() =>
      validateEnv({ ...prod, JWT_ACCESS_SECRET: 'A-GENERER-openssl-rand-base64-48-xxxxxxxx' }),
    ).toThrow(/JWT_ACCESS_SECRET : valeur d’exemple/);
    expect(() =>
      validateEnv({ ...prod, DATABASE_URL: 'postgresql://app:A-GENERER@postgres:5432/digecom' }),
    ).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ ...prod, S3_SECRET_KEY: 'a-generer' })).toThrow(/S3_SECRET_KEY/);
    expect(validateEnv({ ...prod, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
  });
});
