import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { PushProvider, type NotificationInput } from './notification.service';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Le service Expo accepte au plus 100 messages par requête. */
const BATCH = 100;

/** Types qui demandent l'attention immédiate du livreur : canal « courses » (son + vibration). */
export const URGENT_TYPES = new Set(['DELIVERY_OFFER', 'DELIVERY_ASSIGNED']);

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  priority: 'high' | 'default';
  channelId: 'courses' | 'default';
  data: Record<string, unknown>;
}

export function buildMessages(tokens: string[], n: NotificationInput): ExpoMessage[] {
  const urgent = URGENT_TYPES.has(n.type);
  return tokens.map((to) => ({
    to,
    title: n.title,
    body: n.body,
    sound: 'default',
    priority: urgent ? 'high' : 'default',
    channelId: urgent ? 'courses' : 'default',
    data: { type: n.type, link: n.link ?? null, payload: n.payload ?? null },
  }));
}

/**
 * Push mobile par le service Expo, qui relaie vers FCM (Android). Un échec n'interrompt jamais
 * l'action métier : la notification reste visible dans l'application (in-app).
 */
@Injectable()
export class ExpoPushProvider extends PushProvider {
  private readonly logger = new Logger(ExpoPushProvider.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {
    super();
  }

  async send(userIds: string[], notification: NotificationInput): Promise<void> {
    if (!this.env.PUSH_ENABLED || !userIds.length) return;
    const devices = await this.prisma.device.findMany({
      where: { userId: { in: userIds } },
      select: { token: true },
    });
    const messages = buildMessages(
      devices.map((d) => d.token),
      notification,
    );
    for (let i = 0; i < messages.length; i += BATCH) {
      const chunk = messages.slice(i, i + BATCH);
      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(this.env.EXPO_ACCESS_TOKEN
              ? { Authorization: `Bearer ${this.env.EXPO_ACCESS_TOKEN}` }
              : {}),
          },
          body: JSON.stringify(chunk),
          signal: AbortSignal.timeout(8000),
        });
        const json = (await res.json().catch(() => null)) as {
          data?: { status: string; details?: { error?: string } }[];
        } | null;
        // Jetons périmés (application désinstallée) : on les oublie.
        const dead = (json?.data ?? [])
          .map((r, k) => (r.details?.error === 'DeviceNotRegistered' ? chunk[k]!.to : null))
          .filter((t): t is string => !!t);
        if (dead.length) await this.prisma.device.deleteMany({ where: { token: { in: dead } } });
        if (!res.ok) this.logger.warn(`Push Expo : HTTP ${res.status}`);
      } catch (err) {
        this.logger.warn(`Push Expo indisponible : ${(err as Error).message}`);
      }
    }
  }
}
