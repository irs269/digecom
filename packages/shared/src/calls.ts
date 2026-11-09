import { z } from 'zod';
import type { OrderStatus } from './orders';
import type { Role } from './roles';

/**
 * Appels audio dans l'application et le back-office (VoIP, WebRTC) : e-commerçant ↔ livreur
 * d'une même commande, et annuaire (logistique, leaders, administration). L'API met en relation et journalise ; le son passe de téléphone à téléphone (ou par
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

// --- Qui peut appeler qui -----------------------------------------------------------------------

/** Ce que la règle d'appel connaît d'un utilisateur. */
export interface CallPeer {
  id: string;
  role: Role;
  islandId: string | null;
  leaderId: string | null;
}

/**
 * Appels hors commande (annuaire) :
 * - administrateur ↔ tout utilisateur ;
 * - assistant logistique ↔ livreurs et e-commerçants de son île ;
 * - Leader Senior ↔ ses e-commerçants ; Leader Junior ↔ ses téléconseillers.
 * Les deux sens sont autorisés (l'e-commerçant peut appeler la logistique de son île, etc.).
 * L'e-commerçant et le livreur d'une même commande s'appellent via la commande (voir l'API).
 */
export function canCallDirectly(a: CallPeer, b: CallPeer): boolean {
  if (a.id === b.id) return false;
  const pair = (x: CallPeer, y: CallPeer): boolean => {
    if (x.role === 'ADMIN') return true;
    if (x.role === 'LOGISTICS_ASSISTANT') {
      return (
        (y.role === 'COURIER' || y.role === 'SELLER') && !!x.islandId && x.islandId === y.islandId
      );
    }
    if (x.role === 'LEADER_SENIOR') return y.role === 'SELLER' && y.leaderId === x.id;
    if (x.role === 'LEADER_JUNIOR') return y.role === 'TELECONSULTANT' && y.leaderId === x.id;
    return false;
  };
  return pair(a, b) || pair(b, a);
}

/** Rôles qui peuvent passer ou recevoir des appels Dig'eCom. */
export const CALL_ROLES: readonly Role[] = [
  'ADMIN',
  'LOGISTICS_ASSISTANT',
  'LEADER_SENIOR',
  'LEADER_JUNIOR',
  'SELLER',
  'COURIER',
  'TELECONSULTANT',
];

/** Contact de l'annuaire d'appel (`GET /calls/contacts`). */
export interface CallContact {
  id: string;
  fullName: string;
  role: Role;
  roleLabel: string;
  island: string | null;
}

/** Appeler : depuis une commande (e-commerçant ↔ livreur) ou directement un contact. */
export const startCallSchema = z
  .object({ orderId: z.string().min(1).optional(), userId: z.string().min(1).optional() })
  .refine((v) => !!v.orderId !== !!v.userId, 'Indique la commande ou le contact à appeler');
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
  role: Role;
}

export interface CallView {
  id: string;
  /** Commande concernée, ou null pour un appel direct (annuaire). */
  orderId: string | null;
  orderNumber: string | null;
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
