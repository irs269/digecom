import type { Request, Response } from 'express';
import { isSensitive, rateLimiter } from './http-guards';

/** Redis factice : compteurs en mémoire, interface `multi().incr().expire().exec()`. */
function fakeRedis() {
  const counts = new Map<string, number>();
  return {
    multi() {
      const ops: string[] = [];
      const chain = {
        incr(k: string) {
          ops.push(k);
          return chain;
        },
        expire() {
          ops.push('');
          return chain;
        },
        async exec() {
          return ops.map((k) => {
            if (!k) return [null, 1];
            counts.set(k, (counts.get(k) ?? 0) + 1);
            return [null, counts.get(k)];
          });
        },
      };
      return chain;
    },
  };
}

function call(
  mw: ReturnType<typeof rateLimiter>,
  path: string,
  query: Record<string, string> = {},
  method = 'GET',
) {
  return new Promise<number>((resolve) => {
    const res = {
      setHeader: () => undefined,
      status(code: number) {
        return { json: () => resolve(code) };
      },
    } as unknown as Response;
    void mw({ path, query, method, ip: '1.2.3.4' } as unknown as Request, res, () => resolve(200));
  });
}

describe('limitation de débit', () => {
  it('routes sensibles', () => {
    expect(isSensitive({ path: '/auth/login', query: {}, method: 'POST' })).toBe(true);
    expect(isSensitive({ path: '/campaigns/x/prospects/import', query: {}, method: 'POST' })).toBe(
      true,
    );
    expect(isSensitive({ path: '/reports/daily', query: { format: 'xlsx' }, method: 'GET' })).toBe(
      true,
    );
    expect(isSensitive({ path: '/reports/daily', query: {}, method: 'GET' })).toBe(false);
    expect(isSensitive({ path: '/orders', query: {}, method: 'GET' })).toBe(false);
  });

  it('bloque au-delà des limites (429), jamais /health', async () => {
    const mw = rateLimiter(fakeRedis() as never, { global: 5, sensitive: 2, now: () => 0 });
    expect(await call(mw, '/auth/login', {}, 'POST')).toBe(200);
    expect(await call(mw, '/auth/login', {}, 'POST')).toBe(200);
    expect(await call(mw, '/auth/login', {}, 'POST')).toBe(429);
    expect(await call(mw, '/orders')).toBe(200);
    expect(await call(mw, '/orders')).toBe(200);
    expect(await call(mw, '/orders')).toBe(429);
    expect(await call(mw, '/health')).toBe(200);
  });
});
