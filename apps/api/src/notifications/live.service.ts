import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { LiveEvent } from '@digecom/shared';
import Redis from 'ioredis';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

const CHANNEL = 'digecom:live';

type Listener = (event: LiveEvent) => void;

/**
 * Diffusion temps réel : les événements sont publiés sur Redis (plusieurs instances d'API) et
 * remis aux connexions SSE ouvertes des utilisateurs concernés.
 */
@Injectable()
export class LiveService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiveService.name);
  private readonly listeners = new Map<string, Set<Listener>>();
  private pub?: Redis;
  private sub?: Redis;

  constructor(@Inject(ENV) private readonly env: Env) {}

  async onModuleInit(): Promise<void> {
    this.pub = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: 2 });
    this.sub = new Redis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    await this.sub.subscribe(CHANNEL);
    this.sub.on('message', (_channel, raw: string) => {
      try {
        const { userIds, event } = JSON.parse(raw) as { userIds: string[]; event: LiveEvent };
        for (const id of userIds) this.listeners.get(id)?.forEach((l) => l(event));
      } catch (err) {
        this.logger.warn({ err }, 'Message temps réel illisible');
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.sub?.quit().catch(() => undefined);
    await this.pub?.quit().catch(() => undefined);
  }

  async publish(userIds: string[], event: LiveEvent): Promise<void> {
    const unique = [...new Set(userIds)];
    if (!unique.length || !this.pub) return;
    await this.pub.publish(CHANNEL, JSON.stringify({ userIds: unique, event }));
  }

  subscribe(userId: string, listener: Listener): () => void {
    const set = this.listeners.get(userId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(userId, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(userId);
    };
  }

  connectedCount(userId: string): number {
    return this.listeners.get(userId)?.size ?? 0;
  }
}
