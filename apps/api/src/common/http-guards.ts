import type { NextFunction, Request, Response } from 'express';
import type Redis from 'ioredis';

/** Routes sensibles : connexion, rafraîchissement, imports, exports de fichiers. */
export function isSensitive(req: Pick<Request, 'path' | 'query' | 'method'>): boolean {
  if (/^\/auth\/(login|refresh|change-password)/.test(req.path)) return true;
  if (req.method === 'POST' && /\/import$/.test(req.path)) return true;
  const format = typeof req.query?.format === 'string' ? req.query.format : '';
  return /^\/reports\//.test(req.path) && (format === 'xlsx' || format === 'pdf');
}

const SKIP = /^\/(health|ready)(\/|$)/;

/**
 * Limitation de débit par IP (fenêtre d'une minute, compteurs Redis partagés entre instances) :
 * une limite globale et une limite plus basse pour les routes sensibles. Redis indisponible :
 * la requête passe (la connexion garde sa propre limite par téléphone).
 */
export function rateLimiter(
  redis: Pick<Redis, 'multi'>,
  opts: { global: number; sensitive: number; now?: () => number },
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (SKIP.test(req.path)) return next();
    const minute = Math.floor((opts.now?.() ?? Date.now()) / 60_000);
    const ip = req.ip ?? 'unknown';
    const sensitive = isSensitive(req);
    const checks: [string, number][] = [];
    if (opts.global > 0) checks.push([`rl:g:${ip}:${minute}`, opts.global]);
    if (sensitive && opts.sensitive > 0) checks.push([`rl:s:${ip}:${minute}`, opts.sensitive]);
    if (!checks.length) return next();
    try {
      const multi = redis.multi();
      for (const [key] of checks) multi.incr(key).expire(key, 120);
      const out = (await multi.exec()) ?? [];
      const counts = checks.map((_, i) => Number(out[i * 2]?.[1] ?? 0));
      const blocked = checks.findIndex(([, limit], i) => counts[i]! > limit);
      if (blocked >= 0) {
        res.setHeader(
          'Retry-After',
          String(60 - Math.floor(((opts.now?.() ?? Date.now()) / 1000) % 60)),
        );
        res.status(429).json({
          code: 'RATE_LIMITED',
          message: 'Trop de requêtes : réessaie dans une minute.',
        });
        return;
      }
    } catch {
      // Redis indisponible : pas de blocage.
    }
    next();
  };
}

/** Bornes (ms) de l'histogramme de latence. */
export const LATENCY_BUCKETS = [100, 300, 800, 2000] as const;

/** Mesures par minute (requêtes, erreurs 5xx, latence) pour GET /ops/metrics. */
export function requestMetrics(redis: Pick<Redis, 'multi'>) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (SKIP.test(req.path)) return next();
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const minute = Math.floor(Date.now() / 60_000);
      const bucket = LATENCY_BUCKETS.find((b) => ms <= b) ?? 'inf';
      const key = `ops:m:${minute}`;
      const multi = redis.multi().hincrby(key, 'requests', 1).hincrby(key, `lat:${bucket}`, 1);
      if (res.statusCode >= 500) multi.hincrby(key, 'errors5xx', 1);
      multi.expire(key, 2 * 3600);
      multi.exec().catch(() => undefined);
    });
    next();
  };
}
