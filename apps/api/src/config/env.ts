import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

/** Variables d'environnement de l'API, validées au démarrage (l'API refuse de démarrer sinon). */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET : 32 caractères minimum'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  /** Cookie `Secure` : obligatoire en prod (HTTPS), désactivable en dev sur http://localhost. */
  COOKIE_SECURE: bool.default('true'),
  WEB_ORIGIN: z.string().url(),
  /** Origines CORS supplémentaires (virgules), ex. https://app.exemple.km. */
  CORS_EXTRA_ORIGINS: z.string().optional(),
  /**
   * Proxys de confiance devant l'API (X-Forwarded-For) : 1 = Next.js seul (dev), 2 = Nginx de
   * l'hôte puis Next.js (production). Trop haut : un visiteur pourrait usurper son IP.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),
  /** api : HTTP seul ; worker : jobs BullMQ seuls ; all : les deux (développement). */
  PROCESS_ROLE: z.enum(['all', 'api', 'worker']).default('all'),
  /** Limite globale de requêtes par IP et par minute (0 = désactivée). */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(0).default(600),
  /** Limite des routes sensibles (connexion, imports, exports) par IP et par minute. */
  RATE_LIMIT_SENSITIVE_PER_MINUTE: z.coerce.number().int().min(0).default(30),
  SWAGGER_ENABLED: bool.optional(),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  /** Outils de dev (simulateur livreur / vendeur). Jamais en production. */
  DEV_TOOLS_ENABLED: bool.default('false'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  S3_ENDPOINT: z.string().url().optional(),
  /** Adresse de MinIO vue par le navigateur (URL pré-signées). */
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  /** Préfixe des buckets (S3 externe : noms uniques), ex. « digecom-prod- ». */
  S3_BUCKET_PREFIX: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function safePassword(url: string): string | undefined {
  try {
    return decodeURIComponent(new URL(url).password);
  } catch {
    return undefined;
  }
}

/** Règles propres à la production : l'API refuse de démarrer si elles ne sont pas respectées. */
function productionIssues(env: Env): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const issues: string[] = [];
  if (env.DEV_TOOLS_ENABLED) issues.push('DEV_TOOLS_ENABLED doit être false en production');
  if (env.SWAGGER_ENABLED) issues.push('SWAGGER_ENABLED doit être false en production');
  if (!env.COOKIE_SECURE) issues.push('COOKIE_SECURE doit être true en production');
  if (!env.WEB_ORIGIN.startsWith('https://')) issues.push('WEB_ORIGIN doit être en https://');
  // Secrets laissés à leur valeur d'exemple (.env.example, .env.production.example).
  const placeholder = /a-generer|à-générer|remplace-moi|change-moi|changeme|exemple/i;
  const secrets: [string, string | undefined][] = [
    ['JWT_ACCESS_SECRET', env.JWT_ACCESS_SECRET],
    ['DATABASE_URL (mot de passe)', safePassword(env.DATABASE_URL)],
    ['REDIS_URL (mot de passe)', safePassword(env.REDIS_URL)],
    ['S3_ACCESS_KEY', env.S3_ACCESS_KEY],
    ['S3_SECRET_KEY', env.S3_SECRET_KEY],
  ];
  for (const [name, value] of secrets) {
    if (value && placeholder.test(value)) issues.push(`${name} : valeur d’exemple, à générer`);
  }
  if (!env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) issues.push('S3_ACCESS_KEY / S3_SECRET_KEY requis');
  return issues;
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Configuration invalide :\n${issues.join('\n')}`);
  }
  const issues = productionIssues(parsed.data);
  if (issues.length)
    throw new Error(
      `Configuration de production invalide :\n${issues.map((i) => `  - ${i}`).join('\n')}`,
    );
  return parsed.data;
}

/** Origines autorisées par le CORS. */
export function corsOrigins(env: Env): string[] {
  return [
    env.WEB_ORIGIN,
    ...(env.CORS_EXTRA_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  ];
}
