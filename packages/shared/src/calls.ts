import { z } from 'zod';
import type { OrderStatus } from './orders';

/**
 * Appels audio dans l'application (VoIP, WebRTC) entre l'e-commerçant et le livreur d'une même
 * commande. L'API met en relation et journalise ; le son passe de téléphone à téléphone (ou par
 * le relais TURN) et n'est jamais enregistré.
 */

export const CALL_STATUSES = [
  'RINGING',
  'ACCEPTED',
  'ENDED',
  'DECLINED',
  'MISSED',
  'CANCELLED',
  'FAILED',
] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  RINGING: 'Sonne',
  ACCEPTED: 'En cours',
  ENDED: 'Terminé',
  DECLINED: 'Refusé',
  MISSED: 'Manqué',
  CANCELLED: 'Annulé',
  FAILED: 'Échec',
};

/** Statuts de commande pendant lesquels l'e-commerçant et le livreur peuvent s'appeler. */
export const CALLABLE_ORDER_STATUSES: readonly OrderStatus[] = [
  'ASSIGNED',
  'OUT_FOR_DELIVERY',
  'HANDED_OVER',
  'DELIVERY_FAILED',
];

/** Durée maximale de sonnerie avant « manqué ». */
export const CALL_RING_SECONDS = 45;

export const startCallSchema = z.object({ orderId: z.string().min(1) });
export type StartCallInput = z.infer<typeof startCallSchema>;

/** Message WebRTC relayé à l'autre participant (offre, réponse, candidat ICE). */
export const callSignalSchema = z.object({
  type: z.enum(['offer', 'answer', 'ice']),
  /** SDP (offer / answer) ou candidat ICE sérialisé : relayé tel quel, jamais interprété. */
  payload: z.record(z.unknown()).refine((v) => JSON.stringify(v).length <= 20_000, 'Trop long'),
});
export type CallSignalInput = z.infer<typeof callSignalSchema>;

export const endCallSchema = z.object({
  reason: z.enum(['hangup', 'failed']).default('hangup'),
});
export type EndCallInput = z.infer<typeof endCallSchema>;

export interface CallParty {
  id: string;
  fullName: string;
  role: 'SELLER' | 'COURIER';
}

export interface CallView {
  id: string;
  orderId: string;
  orderNumber: string;
  status: CallStatus;
  caller: CallParty;
  callee: CallParty;
  createdAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  /** Durée de conversation en secondes (après décroché). */
  durationSeconds: number | null;
}

/** Serveurs ICE (STUN / TURN) avec identifiants TURN temporaires. */
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface StartCallResponse {
  call: CallView;
  iceServers: IceServer[];
}

/** Événements temps réel d'un appel, remis au seul autre participant. */
export type CallEvent =
  | { type: 'incoming'; call: CallView; iceServers: IceServer[] }
  | { type: 'accepted'; call: CallView }
  | { type: 'ended'; call: CallView }
  | { type: 'signal'; callId: string; signal: CallSignalInput };
