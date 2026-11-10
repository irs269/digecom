import { Inject, Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { PushProvider, type NotificationInput } from './notification.service';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Le service Expo accepte au plus 100 messages par requête. */
const BATCH = 100;

/** Types qui demandent l'attention immédiate du livreur : canal « courses » (son + vibration). */
export const URGENT_TYPES = new Set(['DELIVERY_OFFER', 'DELIVERY_ASSIGNED']);
/** Appel entrant : canal « appels » (sonnerie), priorité haute, non enregistré en base. */
export const CALL_TYPES = new Set(['CALL_INCOMING']);

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  priority: 'high' | 'default';
  channelId: 'appels' | 'courses' | 'default';
  /** Durée de vie : un appel entrant périmé ne doit pas sonner plus tard. */
  ttl?: number;
  data: Record<string, unknown>;
}

export function buildMessages(tokens: string[], n: NotificationInput): ExpoMessage[] {
  const call = CALL_TYPES.has(n.type);
  const urgent = call || URGENT_TYPES.has(n.type);
  return tokens.map((to) => ({
    to,
    title: n.title,
    body: n.body,
    sound: 'default',
    priority: urgent ? 'high' : 'default',
    channelId: call ? 'appels' : urgent ? 'courses' : 'default',
    ...(call ? { ttl: 45 } : {}),
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
    if (!userIds.length) return;
    const devices = await this.prisma.device.findMany({
      where: { userId: { in: userIds } },
      select: { token: true, platform: true },
    });
    await this.sendWeb(
      devices.filter((d) => d.platform === 'web').map((d) => d.token),
      notification,
    );
    if (!this.env.PUSH_ENABLED) return;
    const messages = buildMessages(
      devices.filter((d) => d.platform !== 'web').map((d) => d.token),
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

  /** Web Push (PWA) : abonnements du navigateur, signés avec les clés VAPID. */
  private async sendWeb(subscriptions: string[], n: NotificationInput): Promise<void> {
    const { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: subject } = this.env;
    if (!pub || !priv || !subscriptions.length) return;
    const payload = JSON.stringify({
      title: n.title,
      body: n.body,
      data: { type: n.type, link: n.link ?? null, payload: n.payload ?? null },
    });
    const ttl = CALL_TYPES.has(n.type) ? 45 : 24 * 3600;
    const urgent = CALL_TYPES.has(n.type) || URGENT_TYPES.has(n.type);
    await Promise.all(
      subscriptions.map(async (token) => {
        try {
          await webpush.sendNotification(JSON.parse(token) as webpush.PushSubscription, payload, {
            vapidDetails: { subject, publicKey: pub, privateKey: priv },
            TTL: ttl,
            urgency: urgent ? 'high' : 'normal',
            timeout: 8000,
          });
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          // Abonnement expiré ou révoqué (application supprimée de l'écran d'accueil) : on l'oublie.
          if (status === 404 || status === 410) {
            await this.prisma.device.deleteMany({ where: { token } });
          } else {
            this.logger.warn(`Push web indisponible : ${(err as Error).message}`);
          }
        }
      }),
    );
  }
}
