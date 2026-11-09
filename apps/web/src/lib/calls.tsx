'use client';

import {
  callReducer,
  initialCallState,
  type CallSignalInput,
  type CallState,
  type CallView,
  type IceServer,
  type StartCallResponse,
} from '@digecom/shared';
import { useQueryClient } from '@tanstack/react-query';
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
import { apiFetch, ApiRequestError } from './api';
import { onCallEvent } from './live';

/**
 * Appels Dig'eCom dans le navigateur (WebRTC natif) : même machine d'état que l'application
 * mobile (`@digecom/shared`), mêmes routes d'API, relais TURN commun.
 */

class BrowserSession {
  private pc: RTCPeerConnection | null = null;
  private local: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];
  private remoteSet = false;
  private connected = false;
  private closed = false;

  constructor(
    private readonly iceServers: IceServer[],
    private readonly handlers: {
      sendSignal: (s: CallSignalInput) => void;
      onConnected: () => void;
      onFailed: () => void;
    },
  ) {}

  async open(isCaller: boolean) {
    this.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pc = pc;
    this.local.getTracks().forEach((t) => pc.addTrack(t, this.local!));
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.handlers.sendSignal({
          type: 'ice',
          payload: e.candidate.toJSON() as unknown as Record<string, unknown>,
        });
      }
    };
    pc.ontrack = (e) => {
      if (!this.audio) {
        this.audio = new Audio();
        this.audio.autoplay = true;
      }
      this.audio.srcObject = e.streams[0] ?? new MediaStream([e.track]);
      void this.audio.play().catch(() => undefined);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected' && !this.connected) {
        this.connected = true;
        this.handlers.onConnected();
      }
      if (pc.connectionState === 'failed' && !this.closed) this.handlers.onFailed();
    };
    if (isCaller) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.handlers.sendSignal({
        type: 'offer',
        payload: { type: offer.type, sdp: offer.sdp } as Record<string, unknown>,
      });
    }
  }

  async receive(signal: CallSignalInput) {
    const pc = this.pc;
    if (!pc || this.closed) return;
    if (signal.type === 'ice') {
      const c = signal.payload as RTCIceCandidateInit;
      if (!this.remoteSet) this.pendingIce.push(c);
      else await pc.addIceCandidate(c).catch(() => undefined);
      return;
    }
    await pc.setRemoteDescription(signal.payload as unknown as RTCSessionDescriptionInit);
    this.remoteSet = true;
    for (const c of this.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => undefined);
    if (signal.type === 'offer') {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.handlers.sendSignal({
        type: 'answer',
        payload: { type: answer.type, sdp: answer.sdp } as Record<string, unknown>,
      });
    }
  }

  setMuted(muted: boolean) {
    this.local?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  close() {
    this.closed = true;
    this.local?.getTracks().forEach((t) => t.stop());
    this.pc?.close();
    if (this.audio) this.audio.srcObject = null;
    this.pc = null;
    this.local = null;
  }
}

/** Sonnerie et tonalité générées (pas de fichier audio) ; muettes si le navigateur bloque le son. */
class Tones {
  private ctx: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  private beep(freq: number, ms: number) {
    try {
      this.ctx ??= new AudioContext();
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.value = 0.08;
      osc.connect(gain).connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + ms / 1000);
    } catch {
      // Son bloqué (aucune interaction avec la page) : l'écran d'appel reste visible.
    }
  }

  ring() {
    this.stop();
    const play = () => {
      this.beep(880, 350);
      setTimeout(() => this.beep(660, 350), 450);
    };
    play();
    this.timer = setInterval(play, 2500);
  }

  dial() {
    this.stop();
    this.beep(440, 900);
    this.timer = setInterval(() => this.beep(440, 900), 3500);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

interface WebCallContext {
  state: CallState;
  available: boolean;
  /** Appeler un contact de l'annuaire, ou l'autre participant d'une commande. */
  call: (target: { userId?: string; orderId?: string }) => Promise<void>;
  accept: () => Promise<void>;
  hangup: () => Promise<void>;
  toggleMute: () => void;
}

const Ctx = createContext<WebCallContext | null>(null);

function errorText(err: unknown): string {
  if (err instanceof ApiRequestError) return err.message;
  if (err instanceof DOMException && err.name === 'NotAllowedError') {
    return 'Autorise le micro dans le navigateur pour appeler';
  }
  return 'Appel impossible';
}

export function WebCallProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(callReducer, initialCallState);
  const ref = useRef(state);
  ref.current = state;
  const session = useRef<BrowserSession | null>(null);
  const pending = useRef<CallSignalInput[]>([]);
  const tones = useRef<Tones | null>(null);
  const available =
    typeof window !== 'undefined' &&
    typeof RTCPeerConnection !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia;

  const closeSession = useCallback(() => {
    session.current?.close();
    session.current = null;
    pending.current = [];
  }, []);

  const end = useCallback(
    async (reason: 'hangup' | 'failed', text: string) => {
      const c = ref.current.call;
      dispatch({ type: 'local-end', text });
      closeSession();
      if (c) {
        await apiFetch(`/calls/${c.id}/end`, {
          method: 'POST',
          body: JSON.stringify({ reason }),
        }).catch(() => undefined);
      }
    },
    [closeSession],
  );

  const openSession = useCallback(
    async (c: CallView, ice: IceServer[], isCaller: boolean) => {
      const s = new BrowserSession(ice, {
        sendSignal: (signal) =>
          void apiFetch(`/calls/${c.id}/signal`, {
            method: 'POST',
            body: JSON.stringify(signal),
          }).catch(() => undefined),
        onConnected: () => dispatch({ type: 'media-connected', at: Date.now() }),
        onFailed: () => void end('failed', 'Connexion perdue'),
      });
      session.current = s;
      try {
        await s.open(isCaller);
        for (const sig of pending.current.splice(0)) await s.receive(sig);
      } catch (err) {
        await end('failed', errorText(err));
      }
    },
    [end],
  );

  useEffect(
    () =>
      onCallEvent((e) => {
        const cur = ref.current;
        if (e.type === 'signal') {
          if (cur.call?.id !== e.callId) return;
          if (session.current) void session.current.receive(e.signal);
          else pending.current.push(e.signal);
          return;
        }
        dispatch({ type: 'server', event: e, myId: userId });
        if (e.type === 'accepted' && cur.call?.id === e.call.id && cur.outgoing) {
          void openSession(e.call, cur.iceServers, true);
        }
        if (e.type === 'ended' && cur.call?.id === e.call.id) closeSession();
        if (e.type === 'ended' || e.type === 'incoming') {
          void queryClient.invalidateQueries({ queryKey: ['calls'] });
        }
      }),
    [userId, openSession, closeSession, queryClient],
  );

  useEffect(() => {
    tones.current ??= new Tones();
    const t = tones.current;
    if (state.phase === 'ringing-in') t.ring();
    else if (state.phase === 'ringing-out') t.dial();
    else t.stop();
    if (state.phase === 'ended') {
      const timer = setTimeout(() => dispatch({ type: 'reset' }), 3000);
      return () => clearTimeout(timer);
    }
  }, [state.phase]);

  useEffect(() => session.current?.setMuted(state.muted), [state.muted]);
  useEffect(() => () => closeSession(), [closeSession]);

  const call = useCallback(
    async (target: { userId?: string; orderId?: string }) => {
      if (ref.current.phase !== 'idle' && ref.current.phase !== 'ended') return;
      dispatch({ type: 'dial', orderNumber: '', peerName: '' });
      try {
        // Autorisation du micro demandée tout de suite (geste de l'utilisateur).
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
        probe.getTracks().forEach((t) => t.stop());
        const res = await apiFetch<StartCallResponse>('/calls', {
          method: 'POST',
          body: JSON.stringify(target),
        });
        dispatch({ type: 'dialed', call: res.call, iceServers: res.iceServers });
        void queryClient.invalidateQueries({ queryKey: ['calls'] });
      } catch (err) {
        dispatch({ type: 'dial-failed', message: errorText(err) });
      }
    },
    [queryClient],
  );

  const accept = useCallback(async () => {
    const { call: c, phase } = ref.current;
    if (!c || phase !== 'ringing-in') return;
    dispatch({ type: 'answer' });
    try {
      const res = await apiFetch<StartCallResponse>(`/calls/${c.id}/accept`, { method: 'POST' });
      dispatch({ type: 'answered', iceServers: res.iceServers });
      await openSession(res.call, res.iceServers, false);
    } catch (err) {
      closeSession();
      dispatch({ type: 'local-end', text: errorText(err) });
    }
  }, [openSession, closeSession]);

  const value = useMemo<WebCallContext>(
    () => ({
      state,
      available,
      call,
      accept,
      hangup: () => end('hangup', 'Appel terminé'),
      toggleMute: () => dispatch({ type: 'toggle-mute' }),
    }),
    [state, available, call, accept, end],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWebCalls(): WebCallContext {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWebCalls hors de WebCallProvider');
  return v;
}
