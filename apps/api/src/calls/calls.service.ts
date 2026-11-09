import { HttpStatus, Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  CALL_RING_SECONDS,
  hasPermission,
  CALLABLE_ORDER_STATUSES,
  type CallEvent,
  type CallSignalInput,
  type CallView,
  type IceServer,
  type StartCallResponse,
} from '@digecom/shared';
import type { Prisma } from '@prisma/client';
import { createHmac } from 'node:crypto';
import type { AuthUser } from '../auth/auth.types';
import { AppException } from '../common/app-exception';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { LiveService } from '../notifications/live.service';
import { NotificationService, PushProvider } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';

const INCLUDE = {
  order: { select: { number: true } },
  caller: { select: { id: true, fullName: true, role: true } },
  callee: { select: { id: true, fullName: true, role: true } },
} satisfies Prisma.CallInclude;
type Row = Prisma.CallGetPayload<{ include: typeof INCLUDE }>;

const STUN = 'stun:stun.l.google.com:19302';

const notFound = () => new AppException('NOT_FOUND', 'Appel introuvable', HttpStatus.NOT_FOUND);
const conflict = (m: string) => new AppException('CONFLICT', m, HttpStatus.CONFLICT);
const forbidden = (m: string) => new AppException('FORBIDDEN', m, HttpStatus.FORBIDDEN);

export function toCallView(c: Row): CallView {
  const answered = c.answeredAt?.getTime();
  return {
    id: c.id,
    orderId: c.orderId,
    orderNumber: c.order.number,
    status: c.status,
    caller: c.caller as CallView['caller'],
    callee: c.callee as CallView['callee'],
    createdAt: c.createdAt.toISOString(),
    answeredAt: c.answeredAt?.toISOString() ?? null,
    endedAt: c.endedAt?.toISOString() ?? null,
    durationSeconds:
      answered && c.endedAt ? Math.round((c.endedAt.getTime() - answered) / 1000) : null,
  };
}

/**
 * Identifiants TURN temporaires (« TURN REST API » de coturn, `use-auth-secret`) :
 * nom = `<expiration unix>:<utilisateur>`, mot de passe = base64(HMAC-SHA1(secret, nom)).
 */
export function turnCredentials(secret: string, userId: string, ttl: number, now = Date.now()) {
  const username = `${Math.floor(now / 1000) + ttl}:${userId}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential };
}

/**
 * Mise en relation des appels : l'API vérifie les droits, journalise et relaie les messages
 * WebRTC (offre, réponse, candidats) à l'autre participant par le flux temps réel.
 */
@Injectable()
export class CallsService implements OnModuleDestroy {
  private readonly logger = new Logger(CallsService.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly live: LiveService,
    private readonly notifications: NotificationService,
    private readonly push: PushProvider,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleDestroy() {
    this.timers.forEach((t) => clearTimeout(t));
  }

  iceServers(userId: string): IceServer[] {
    const servers: IceServer[] = [{ urls: STUN }];
    const urls = (this.env.TURN_URLS ?? '')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    if (urls.length && this.env.TURN_SECRET) {
      servers.push({
        urls,
        ...turnCredentials(this.env.TURN_SECRET, userId, this.env.TURN_TTL_SECONDS),
      });
    }
    return servers;
  }

  private emit(userIds: string[], event: CallEvent) {
    return this.live.publish(userIds, { kind: 'call', event });
  }

  private async load(id: string): Promise<Row> {
    const row = await this.prisma.call.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw notFound();
    return row;
  }

  private ensureParty(call: Row, actor: AuthUser) {
    if (call.callerId !== actor.id && call.calleeId !== actor.id) throw notFound();
  }

  private other(call: { callerId: string; calleeId: string }, actorId: string) {
    return call.callerId === actorId ? call.calleeId : call.callerId;
  }

  /** Sonneries trop anciennes (redémarrage de l'API pendant un appel) : passées en « manqué ». */
  private async expireStale(orderId?: string) {
    await this.prisma.call.updateMany({
      where: {
        status: 'RINGING',
        createdAt: { lt: new Date(Date.now() - CALL_RING_SECONDS * 1000) },
        ...(orderId ? { orderId } : {}),
      },
      data: { status: 'MISSED', endedAt: new Date() },
    });
  }

  async start(orderId: string, actor: AuthUser): Promise<StartCallResponse> {
    if (actor.role !== 'SELLER' && actor.role !== 'COURIER') {
      throw forbidden('Les appels sont réservés aux e-commerçants et aux livreurs');
    }
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, number: true, status: true, sellerId: true, courierId: true },
    });
    // Seuls l'e-commerçant et le livreur de la commande la voient ici : sinon 404.
    if (!order || (order.sellerId !== actor.id && order.courierId !== actor.id)) {
      throw new AppException('NOT_FOUND', 'Commande introuvable', HttpStatus.NOT_FOUND);
    }
    if (!order.courierId || !CALLABLE_ORDER_STATUSES.includes(order.status)) {
      throw conflict('Appel possible seulement quand un livreur a la commande');
    }
    const calleeId = actor.id === order.sellerId ? order.courierId : order.sellerId;
    const callee = await this.prisma.user.findUnique({
      where: { id: calleeId },
      select: { isActive: true },
    });
    if (!callee?.isActive) throw conflict('Ce compte n’est plus actif');

    await this.expireStale(order.id);
    const busy = await this.prisma.call.findFirst({
      where: {
        status: { in: ['RINGING', 'ACCEPTED'] },
        OR: [{ callerId: calleeId }, { calleeId }],
      },
      select: { id: true },
    });
    if (busy) throw conflict('Ton correspondant est déjà en ligne');

    const row = await this.prisma.call.create({
      data: { orderId: order.id, callerId: actor.id, calleeId },
      include: INCLUDE,
    });
    const call = toCallView(row);

    await this.emit([calleeId], {
      type: 'incoming',
      call,
      iceServers: this.iceServers(calleeId),
    });
    // Application fermée : le push fait sonner le téléphone (canal « appels »).
    await this.push.send([calleeId], {
      type: 'CALL_INCOMING',
      title: `Appel de ${call.caller.fullName}`,
      body: `Commande #${call.orderNumber}`,
      payload: { callId: call.id, orderId: order.id },
    });
    this.timers.set(
      row.id,
      setTimeout(() => void this.timeout(row.id), CALL_RING_SECONDS * 1000),
    );
    return { call, iceServers: this.iceServers(actor.id) };
  }

  /** Pas de réponse : appel manqué, notifié au destinataire (visible dans l'application). */
  private async timeout(id: string) {
    this.timers.delete(id);
    try {
      const { count } = await this.prisma.call.updateMany({
        where: { id, status: 'RINGING' },
        data: { status: 'MISSED', endedAt: new Date() },
      });
      if (!count) return;
      const row = await this.load(id);
      const call = toCallView(row);
      await this.emit([row.callerId, row.calleeId], { type: 'ended', call });
      await this.notifyMissed(row);
    } catch (err) {
      this.logger.warn(`Fin de sonnerie impossible : ${(err as Error).message}`);
    }
  }

  private notifyMissed(row: Row) {
    return this.notifications.send([row.calleeId], {
      type: 'CALL_MISSED',
      title: 'Appel manqué',
      body: `${row.caller.fullName} a essayé de t’appeler (commande #${row.order.number}).`,
      payload: { orderId: row.orderId, callId: row.id },
    });
  }

  private clearTimer(id: string) {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
  }

  async accept(id: string, actor: AuthUser): Promise<StartCallResponse> {
    await this.expireStale();
    const row = await this.load(id);
    if (row.calleeId !== actor.id) throw notFound();
    const { count } = await this.prisma.call.updateMany({
      where: { id, status: 'RINGING' },
      data: { status: 'ACCEPTED', answeredAt: new Date() },
    });
    if (!count) throw conflict('Cet appel est terminé');
    this.clearTimer(id);
    const call = toCallView(await this.load(id));
    await this.emit([row.callerId], { type: 'accepted', call });
    return { call, iceServers: this.iceServers(actor.id) };
  }

  /**
   * Fin d'appel : refus (destinataire qui ne décroche pas), annulation (appelant avant
   * décroché), fin normale, ou échec de connexion.
   */
  async end(id: string, actor: AuthUser, reason: 'hangup' | 'failed'): Promise<CallView> {
    const row = await this.load(id);
    this.ensureParty(row, actor);
    if (!['RINGING', 'ACCEPTED'].includes(row.status)) return toCallView(row);
    const status =
      reason === 'failed'
        ? 'FAILED'
        : row.status === 'ACCEPTED'
          ? 'ENDED'
          : actor.id === row.calleeId
            ? 'DECLINED'
            : 'CANCELLED';
    const { count } = await this.prisma.call.updateMany({
      where: { id, status: row.status },
      data: { status, endedAt: new Date() },
    });
    this.clearTimer(id);
    const updated = await this.load(id);
    const call = toCallView(updated);
    if (count) {
      await this.emit([this.other(row, actor.id)], { type: 'ended', call });
      // L'appelant a raccroché avant que l'autre décroche : c'est un appel manqué pour lui.
      if (status === 'CANCELLED') await this.notifyMissed(updated);
    }
    return call;
  }

  /** Relais d'un message WebRTC vers l'autre participant, pendant la sonnerie ou l'appel. */
  async signal(id: string, actor: AuthUser, signal: CallSignalInput): Promise<void> {
    const row = await this.prisma.call.findUnique({
      where: { id },
      select: { callerId: true, calleeId: true, status: true },
    });
    if (!row || (row.callerId !== actor.id && row.calleeId !== actor.id)) throw notFound();
    if (!['RINGING', 'ACCEPTED'].includes(row.status)) throw conflict('Cet appel est terminé');
    await this.emit([this.other(row, actor.id)], { type: 'signal', callId: id, signal });
  }

  /** Journal des appels d'une commande (participants seulement, ou back-office). */
  async forOrder(orderId: string, actor: AuthUser): Promise<CallView[]> {
    await this.expireStale(orderId);
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { sellerId: true, courierId: true, islandId: true },
    });
    const party = order && (order.sellerId === actor.id || order.courierId === actor.id);
    // Back-office : droit de lire les commandes, et cloisonnement par île pour les rôles d'île.
    const backOffice =
      !!order &&
      hasPermission(actor.role, 'orders:read') &&
      (!actor.islandId || actor.islandId === order.islandId);
    if (!order || (!party && !backOffice)) {
      throw new AppException('NOT_FOUND', 'Commande introuvable', HttpStatus.NOT_FOUND);
    }
    const rows = await this.prisma.call.findMany({
      where: { orderId },
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map(toCallView);
  }

  /** Appel qui sonne encore pour moi (application rouverte depuis la notification). */
  async ringing(actor: AuthUser): Promise<StartCallResponse | null> {
    await this.expireStale();
    const row = await this.prisma.call.findFirst({
      where: { calleeId: actor.id, status: 'RINGING' },
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return row ? { call: toCallView(row), iceServers: this.iceServers(actor.id) } : null;
  }
}
