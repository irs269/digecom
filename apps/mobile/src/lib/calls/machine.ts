import type { CallEvent, CallView, IceServer } from '@digecom/shared';

/**
 * État de l'écran d'appel. Fonction pure (testée) : le fournisseur d'appel y applique les
 * actions de l'utilisateur et les événements du serveur, puis pilote WebRTC en conséquence.
 */
export type CallPhase =
  | 'idle'
  /** J'appelle : la demande part au serveur. */
  | 'dialing'
  /** J'appelle : ça sonne chez l'autre. */
  | 'ringing-out'
  /** On m'appelle : ça sonne chez moi. */
  | 'ringing-in'
  /** Décroché : négociation audio en cours. */
  | 'connecting'
  | 'active'
  /** Terminé : message affiché quelques secondes. */
  | 'ended';

export interface CallState {
  phase: CallPhase;
  call: CallView | null;
  /** Je suis l'appelant (c'est moi qui crée l'offre WebRTC). */
  outgoing: boolean;
  iceServers: IceServer[];
  muted: boolean;
  speaker: boolean;
  /** Début de la conversation (horloge locale), pour le chrono. */
  connectedAt: number | null;
  /** Texte de fin (« Appel refusé », « Pas de réponse »…). */
  endText: string | null;
}

export const initialCallState: CallState = {
  phase: 'idle',
  call: null,
  outgoing: false,
  iceServers: [],
  muted: false,
  speaker: false,
  connectedAt: null,
  endText: null,
};

export type CallAction =
  | { type: 'dial'; orderNumber: string; peerName: string }
  | { type: 'dialed'; call: CallView; iceServers: IceServer[] }
  | { type: 'dial-failed'; message: string }
  | { type: 'server'; event: CallEvent; myId: string }
  | { type: 'answer' }
  | { type: 'answered'; iceServers: IceServer[] }
  | { type: 'media-connected'; at: number }
  | { type: 'local-end'; text: string }
  | { type: 'toggle-mute' }
  | { type: 'toggle-speaker' }
  | { type: 'reset' };

const busy = (s: CallState) => s.phase !== 'idle' && s.phase !== 'ended';

/** Texte de fin vu par l'utilisateur, selon le statut final et son rôle dans l'appel. */
export function endTextFor(call: CallView, outgoing: boolean): string {
  switch (call.status) {
    case 'DECLINED':
      return outgoing ? 'Appel refusé' : 'Appel refusé';
    case 'MISSED':
      return outgoing ? 'Pas de réponse' : 'Appel manqué';
    case 'CANCELLED':
      return outgoing ? 'Appel annulé' : 'Appel manqué';
    case 'FAILED':
      return 'Connexion perdue';
    default:
      return 'Appel terminé';
  }
}

export function callReducer(state: CallState, action: CallAction): CallState {
  switch (action.type) {
    case 'dial':
      if (busy(state)) return state;
      return { ...initialCallState, phase: 'dialing', outgoing: true };
    case 'dialed':
      if (state.phase !== 'dialing') return state;
      return { ...state, phase: 'ringing-out', call: action.call, iceServers: action.iceServers };
    case 'dial-failed':
      return { ...initialCallState, phase: 'ended', endText: action.message };
    case 'answer':
      return state.phase === 'ringing-in' ? { ...state, phase: 'connecting' } : state;
    case 'answered':
      return {
        ...state,
        iceServers: action.iceServers.length ? action.iceServers : state.iceServers,
      };
    case 'media-connected':
      if (state.phase !== 'connecting') return state;
      return { ...state, phase: 'active', connectedAt: action.at };
    case 'local-end':
      if (!busy(state)) return state;
      return { ...state, phase: 'ended', endText: action.text };
    case 'toggle-mute':
      return { ...state, muted: !state.muted };
    case 'toggle-speaker':
      return { ...state, speaker: !state.speaker };
    case 'reset':
      return initialCallState;
    case 'server': {
      const e = action.event;
      if (e.type === 'incoming') {
        // Déjà en ligne : le serveur refuse normalement un second appel ; on l'ignore ici.
        if (busy(state) || e.call.callee.id !== action.myId) return state;
        return {
          ...initialCallState,
          phase: 'ringing-in',
          call: e.call,
          iceServers: e.iceServers,
        };
      }
      if (!state.call || ('call' in e ? e.call.id : e.callId) !== state.call.id) return state;
      if (e.type === 'accepted') {
        return state.phase === 'ringing-out'
          ? { ...state, phase: 'connecting', call: e.call }
          : state;
      }
      if (e.type === 'ended') {
        if (!busy(state)) return state;
        return {
          ...state,
          phase: 'ended',
          call: e.call,
          endText: endTextFor(e.call, state.outgoing),
        };
      }
      return state; // 'signal' : traité par la couche WebRTC.
    }
  }
}

/** Chrono « 2:07 ». */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
