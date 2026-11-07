import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppException } from '../common/app-exception';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { RedisService } from '../redis/redis.module';

/**
 * Limitation de débit de la connexion : N essais par fenêtre, par couple IP + téléphone.
 * Compteurs dans Redis (partagés entre instances de l'API).
 */
@Injectable()
export class LoginRateLimiter {
  constructor(
    private readonly redis: RedisService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private key(ip: string, phone: string): string {
    const digest = createHash('sha256').update(`${ip}|${phone}`).digest('hex').slice(0, 32);
    return `login:attempts:${digest}`;
  }

  /** Compte un essai ; lève 429 au-delà du maximum. */
  async hit(ip: string, phone: string): Promise<void> {
    const key = this.key(ip, phone);
    const windowSeconds = this.env.LOGIN_WINDOW_MINUTES * 60;
    const [[, count]] = (await this.redis
      .multi()
      .incr(key)
      .expire(key, windowSeconds, 'NX')
      .exec()) as [[Error | null, number], [Error | null, number]];
    if (count > this.env.LOGIN_MAX_ATTEMPTS) {
      const ttl = await this.redis.ttl(key);
      throw new AppException(
        'TOO_MANY_REQUESTS',
        `Trop de tentatives de connexion. Réessaie dans ${Math.ceil(Math.max(ttl, 60) / 60)} min.`,
        HttpStatus.TOO_MANY_REQUESTS,
        { retryAfterSeconds: ttl },
      );
    }
  }
}
