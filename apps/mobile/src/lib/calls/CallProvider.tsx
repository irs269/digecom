import type { CallSignalInput, CallView, StartCallResponse } from '@digecom/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import { api, ApiError } from '../api';
import { onLive } from '../live';
import { queryClient } from '../query';
import { useSession } from '../session';
import { callAudio } from './audio';
import { callReducer, initialCallState, type CallState } from './machine';
import { AudioSession, voipAvailable } from './webrtc';

interface CallContextValue {
  state: CallState;
  /** Appels dans l'application possibles sur ce téléphone (sinon : appel téléphonique). */
  available: boolean;
  start: (orderId: string) => Promise<void>;
  accept: () => Promise<void>;
  hangup: () => Promise<void>;
  toggleMute: () => void;
  toggleSpeaker: () => void;
  /** Vérifie s'il reste un appel qui sonne pour moi (ouverture depuis la notification). */
  checkRinging: () => Promise<void>;
}

const CallContext = createContext<CallContextValue | null>(null);

/** Message d'erreur lisible pour un appel qui n'a pas pu partir. */
function dialError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.isNetwork) return 'Pas de réseau : appel impossible';
    return err.message;
  }
  return 'Appel impossible';
}

export function CallProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [state, dispatch] = useReducer(callReducer, initialCallState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const session = useRef<AudioSession | null>(null);
  /** Messages WebRTC arrivés avant l'ouverture de la session (offre envoyée très vite). */
  const pendingSignals = useRef<CallSignalInput[]>([]);
  const available = useMemo(() => voipAvailable(), []);

  const sendSignal = useCallback((callId: string, signal: CallSignalInput) => {
    void api(`/calls/${callId}/signal`, { method: 'POST', body: signal }).catch(() => undefined);
  }, []);

  const closeSession = useCallback(() => {
    session.current?.close();
    session.current = null;
    pendingSignals.current = [];
  }, []);

  const end = useCallback(
    async (reason: 'hangup' | 'failed', text: string) => {
      const call = stateRef.current.call;
      dispatch({ type: 'local-end', text });
      closeSession();
      if (call) {
        await api(`/calls/${call.id}/end`, { method: 'POST', body: { reason } }).catch(
          () => undefined,
        );
      }
    },
    [closeSession],
  );

  const openSession = useCallback(
    async (call: CallView, iceServers: StartCallResponse['iceServers'], isCaller: boolean) => {
      const s = new AudioSession(iceServers, {
        sendSignal: (signal) => sendSignal(call.id, signal),
        onConnected: () => dispatch({ type: 'media-connected', at: Date.now() }),
        onFailed: () => void end('failed', 'Connexion perdue'),
      });
      session.current = s;
      try {
        await s.open(isCaller);
        for (const sig of pendingSignals.current.splice(0)) await s.receive(sig);
      } catch {
        await end('failed', 'Micro ou connexion indisponible');
      }
    },
    [end, sendSignal],
  );

  // Événements du serveur : appel entrant, décroché, fin, messages WebRTC.
  useEffect(() => {
    if (!user) return;
    return onLive((live) => {
      if (live.kind === 'order' || live.kind === 'notification') {
        void queryClient.invalidateQueries();
        return;
      }
      if (live.kind !== 'call') return;
      const e = live.event;
      const current = stateRef.current;
      if (e.type === 'signal') {
        if (current.call?.id !== e.callId) return;
        if (session.current) void session.current.receive(e.signal);
        else pendingSignals.current.push(e.signal);
        return;
      }
      dispatch({ type: 'server', event: e, myId: user.id });
      if (e.type === 'accepted' && current.call?.id === e.call.id && current.outgoing) {
        void openSession(e.call, current.iceServers, true);
      }
      if (e.type === 'ended' && current.call?.id === e.call.id) {
        closeSession();
        void queryClient.invalidateQueries({ queryKey: ['calls', e.call.orderId] });
      }
    });
  }, [user, openSession, closeSession]);

  // Son selon la phase ; écran de fin effacé après 3 s.
  useEffect(() => {
    switch (state.phase) {
      case 'ringing-in':
        callAudio.ring();
        break;
      case 'ringing-out':
        callAudio.dialTone();
        break;
      case 'connecting':
      case 'active':
        callAudio.connect();
        break;
      case 'ended': {
        callAudio.stop();
        const t = setTimeout(() => dispatch({ type: 'reset' }), 3000);
        return () => clearTimeout(t);
      }
      case 'idle':
        callAudio.stop();
        break;
    }
  }, [state.phase]);

  useEffect(() => {
    session.current?.setMuted(state.muted);
  }, [state.muted]);
  useEffect(() => {
    if (state.phase === 'active' || state.phase === 'connecting') callAudio.speaker(state.speaker);
  }, [state.speaker, state.phase]);

  // Déconnexion pendant un appel : on raccroche.
  useEffect(() => {
    if (!user && stateRef.current.phase !== 'idle') {
      closeSession();
      dispatch({ type: 'reset' });
    }
  }, [user, closeSession]);

  const start = useCallback(async (orderId: string) => {
    if (stateRef.current.phase !== 'idle' && stateRef.current.phase !== 'ended') return;
    dispatch({ type: 'dial', orderNumber: '', peerName: '' });
    try {
      const res = await api<StartCallResponse>('/calls', { method: 'POST', body: { orderId } });
      dispatch({ type: 'dialed', call: res.call, iceServers: res.iceServers });
      void queryClient.invalidateQueries({ queryKey: ['calls', orderId] });
    } catch (err) {
      dispatch({ type: 'dial-failed', message: dialError(err) });
    }
  }, []);

  const accept = useCallback(async () => {
    const { call, phase } = stateRef.current;
    if (!call || phase !== 'ringing-in') return;
    dispatch({ type: 'answer' });
    try {
      const res = await api<StartCallResponse>(`/calls/${call.id}/accept`, { method: 'POST' });
      dispatch({ type: 'answered', iceServers: res.iceServers });
      await openSession(res.call, res.iceServers, false);
    } catch (err) {
      closeSession();
      dispatch({
        type: 'local-end',
        text: err instanceof ApiError && err.status === 409 ? 'Appel terminé' : dialError(err),
      });
    }
  }, [openSession, closeSession]);

  const hangup = useCallback(() => end('hangup', 'Appel terminé'), [end]);

  const checkRinging = useCallback(async () => {
    if (!user || stateRef.current.phase !== 'idle') return;
    const res = await api<StartCallResponse | Record<string, never>>('/calls/ringing').catch(
      () => null,
    );
    if (res && 'call' in res) {
      dispatch({
        type: 'server',
        event: { type: 'incoming', call: res.call, iceServers: res.iceServers },
        myId: user.id,
      });
    }
  }, [user]);

  const value = useMemo<CallContextValue>(
    () => ({
      state,
      available,
      start,
      accept,
      hangup,
      toggleMute: () => dispatch({ type: 'toggle-mute' }),
      toggleSpeaker: () => dispatch({ type: 'toggle-speaker' }),
      checkRinging,
    }),
    [state, available, start, accept, hangup, checkRinging],
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCalls(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCalls hors de CallProvider');
  return ctx;
}
