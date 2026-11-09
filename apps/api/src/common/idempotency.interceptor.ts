import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { from, of, type Observable } from 'rxjs';
import { catchError, mergeMap, tap } from 'rxjs/operators';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { RedisService } from '../redis/redis.module';
import { AppException } from './app-exception';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
/** Une action rejouée par le mobile après une coupure réseau est reconnue pendant 24 h. */
const TTL_SECONDS = 24 * 3600;
const KEY_RE = /^[A-Za-z0-9_-]{8,100}$/;

interface Stored {
  state: 'pending' | 'done';
  status?: number;
  body?: unknown;
}

/**
 * `Idempotency-Key` sur POST / PATCH authentifiés : la première requête s'exécute, les suivantes
 * avec la même clé (même utilisateur) reçoivent la même réponse sans rejouer l'action.
 * Une requête en échec (4xx / 5xx) libère la clé : le mobile peut corriger et réessayer.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly redis: RedisService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const raw = req.headers[IDEMPOTENCY_HEADER];
    if (typeof raw !== 'string' || !['POST', 'PATCH'].includes(req.method) || !req.user) {
      return next.handle();
    }
    if (!KEY_RE.test(raw)) {
      throw new AppException(
        'VALIDATION_ERROR',
        'Idempotency-Key invalide',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const key = `idem:${req.user.id}:${req.method}:${req.path}:${raw}`;

    return from(
      this.redis.set(key, JSON.stringify({ state: 'pending' }), 'EX', TTL_SECONDS, 'NX'),
    ).pipe(
      mergeMap((acquired) => {
        if (acquired) {
          return next.handle().pipe(
            tap((body) => {
              const stored: Stored = { state: 'done', status: res.statusCode, body };
              void this.redis.set(key, JSON.stringify(stored), 'EX', TTL_SECONDS);
            }),
            catchError((err: unknown) =>
              from(this.redis.del(key)).pipe(
                mergeMap(() => {
                  throw err;
                }),
              ),
            ),
          );
        }
        return from(this.redis.get(key)).pipe(
          mergeMap((value) => {
            const stored = value ? (JSON.parse(value) as Stored) : null;
            if (!stored || stored.state === 'pending') {
              throw new AppException(
                'CONFLICT',
                'Action déjà en cours de traitement',
                HttpStatus.CONFLICT,
              );
            }
            res.status(stored.status ?? 200);
            res.setHeader('Idempotent-Replayed', 'true');
            (req as AuthenticatedRequest).audit = { skip: true };
            return of(stored.body);
          }),
        );
      }),
    );
  }
}
