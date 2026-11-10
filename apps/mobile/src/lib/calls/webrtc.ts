import type { CallSignalInput, IceServer } from '@digecom/shared';
import { Platform } from 'react-native';

/**
 * Session audio WebRTC. Le module natif n'existe pas dans Expo Go : il est chargé à la demande
 * et `voipAvailable()` permet de retomber sur l'appel téléphonique classique.
 */

type WebRTC = typeof import('react-native-webrtc');
type PC = InstanceType<WebRTC['RTCPeerConnection']>;
type Stream = InstanceType<WebRTC['MediaStream']>;

let mod: WebRTC | null | undefined;

function load(): WebRTC | null {
  if (mod !== undefined) return mod;
  if (Platform.OS === 'web') {
    // PWA (iPhone, navigateur) : WebRTC natif du navigateur, même API.
    const g = globalThis as unknown as Record<string, unknown> & { navigator?: Navigator };
    mod =
      g.RTCPeerConnection && g.navigator?.mediaDevices
        ? ({
            RTCPeerConnection: g.RTCPeerConnection,
            RTCIceCandidate: g.RTCIceCandidate,
            RTCSessionDescription: g.RTCSessionDescription,
            MediaStream: g.MediaStream,
            mediaDevices: g.navigator.mediaDevices,
          } as unknown as WebRTC)
        : null;
    return mod;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('react-native-webrtc') as WebRTC;
    // Module présent mais natif absent (Expo Go) : l'API n'est pas utilisable.
    if (!mod?.RTCPeerConnection || !mod.mediaDevices) mod = null;
  } catch {
    mod = null;
  }
  return mod;
}

/** Appels dans l'application possibles sur ce téléphone (build natif, pas Expo Go). */
export function voipAvailable(): boolean {
  return load() !== null;
}

export interface SessionHandlers {
  /** Message à relayer à l'autre participant par l'API. */
  sendSignal: (signal: CallSignalInput) => void;
  /** Audio connecté dans les deux sens. */
  onConnected: () => void;
  /** Connexion perdue (réseau coupé, relais injoignable). */
  onFailed: () => void;
}

export class AudioSession {
  private pc: PC | null = null;
  private local: Stream | null = null;
  /** Candidats reçus avant la description distante : appliqués ensuite. */
  private pendingIce: unknown[] = [];
  private remoteSet = false;
  private connected = false;
  private closed = false;
  private audioEl: HTMLAudioElement | null = null;

  constructor(
    private readonly iceServers: IceServer[],
    private readonly handlers: SessionHandlers,
  ) {}

  /** Micro + connexion. L'appelant crée l'offre ; l'appelé attend l'offre. */
  async open(isCaller: boolean): Promise<void> {
    const rtc = load();
    if (!rtc) throw new Error('Appels dans l’application indisponibles sur ce téléphone');
    this.local = (await rtc.mediaDevices.getUserMedia({ audio: true, video: false })) as Stream;
    const pc = new rtc.RTCPeerConnection({ iceServers: this.iceServers });
    this.pc = pc;
    this.local.getTracks().forEach((t) => pc.addTrack(t, this.local!));

    // Les événements de react-native-webrtc suivent l'API du navigateur.
    const events = pc as unknown as {
      addEventListener: (type: string, fn: (e: { candidate?: unknown }) => void) => void;
    };
    events.addEventListener('icecandidate', (e) => {
      if (e.candidate) {
        this.handlers.sendSignal({
          type: 'ice',
          payload: JSON.parse(JSON.stringify(e.candidate)) as Record<string, unknown>,
        });
      }
    });
    if (Platform.OS === 'web') {
      // Navigateur : le son distant doit passer par un élément <audio>.
      (
        pc as unknown as {
          addEventListener: (t: string, fn: (e: { streams: MediaStream[] }) => void) => void;
        }
      ).addEventListener('track', (e) => {
        if (!this.audioEl) {
          this.audioEl = document.createElement('audio');
          this.audioEl.autoplay = true;
          this.audioEl.setAttribute('playsinline', '');
          document.body.appendChild(this.audioEl);
        }
        this.audioEl.srcObject = e.streams[0] ?? null;
        void this.audioEl.play().catch(() => undefined);
      });
    }
    events.addEventListener('connectionstatechange', () => {
      const state = pc.connectionState;
      if (state === 'connected' && !this.connected) {
        this.connected = true;
        this.handlers.onConnected();
      }
      if ((state === 'failed' || state === 'closed') && !this.closed) this.handlers.onFailed();
    });

    if (isCaller) {
      const offer = await pc.createOffer({});
      await pc.setLocalDescription(offer);
      this.handlers.sendSignal({
        type: 'offer',
        payload: { type: offer.type, sdp: offer.sdp } as Record<string, unknown>,
      });
    }
  }

  /** Message reçu de l'autre participant. */
  async receive(signal: CallSignalInput): Promise<void> {
    const rtc = load();
    const pc = this.pc;
    if (!rtc || !pc || this.closed) return;
    if (signal.type === 'ice') {
      if (!this.remoteSet) {
        this.pendingIce.push(signal.payload);
        return;
      }
      await pc
        .addIceCandidate(new rtc.RTCIceCandidate(signal.payload as never))
        .catch(() => undefined);
      return;
    }
    await pc.setRemoteDescription(new rtc.RTCSessionDescription(signal.payload as never));
    this.remoteSet = true;
    for (const c of this.pendingIce.splice(0)) {
      await pc.addIceCandidate(new rtc.RTCIceCandidate(c as never)).catch(() => undefined);
    }
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
    this.local = null;
    this.pc?.close();
    this.pc = null;
    this.audioEl?.remove();
    this.audioEl = null;
  }
}
