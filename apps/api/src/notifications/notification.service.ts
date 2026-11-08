import { Injectable, Logger } from '@nestjs/common';
import {
  channelEnabled,
  type NotificationPreferences,
  type NotificationView,
  type Role,
} from '@digecom/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LiveService } from './live.service';

export interface NotificationInput {
  type: string;
  title: string;
  body: string;
  link?: string;
  payload?: Prisma.InputJsonValue;
}

/** Envoi vers un canal mobile (FCM en phase 8). Implémentation par défaut : aucun envoi. */
export abstract class PushProvider {
  abstract send(userIds: string[], notification: NotificationInput): Promise<void>;
}

export class NoopPushProvider extends PushProvider {
  async send(): Promise<void> {
    // Le push mobile (FCM) arrive en phase 8.
  }
}

export function toNotificationView(n: {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}): NotificationView {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

/** Notifications in-app : enregistrées en base, poussées en temps réel (SSE), puis push mobile. */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly live: LiveService,
    private readonly push: PushProvider,
  ) {}

  async send(userIds: string[], input: NotificationInput): Promise<void> {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (!unique.length) return;
    try {
      const rows = await this.prisma.$transaction(
        unique.map((userId) =>
          this.prisma.notification.create({
            data: {
              userId,
              type: input.type,
              title: input.title,
              body: input.body,
              link: input.link,
              payload: input.payload,
            },
          }),
        ),
      );
      await Promise.all(
        rows.map((row) =>
          this.live.publish([row.userId], {
            kind: 'notification',
            notification: toNotificationView(row),
          }),
        ),
      );
      // Préférences : l'in-app est toujours actif, le push peut être coupé par type.
      const prefs = await this.prisma.user.findMany({
        where: { id: { in: unique } },
        select: { id: true, notificationPrefs: true },
      });
      const pushTo = prefs
        .filter((u) =>
          channelEnabled(u.notificationPrefs as NotificationPreferences, input.type, 'push'),
        )
        .map((u) => u.id);
      if (pushTo.length) await this.push.send(pushTo, input);
    } catch (err) {
      // Une notification ratée ne doit jamais annuler l'action métier déjà validée.
      this.logger.error({ err, type: input.type }, 'Échec d’envoi de notification');
    }
  }

  /** Utilisateurs actifs d'une liste de rôles, éventuellement limités à une île. */
  async usersWithRoles(roles: Role[], islandId?: string | null): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: { role: { in: roles }, isActive: true, ...(islandId ? { islandId } : {}) },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}
