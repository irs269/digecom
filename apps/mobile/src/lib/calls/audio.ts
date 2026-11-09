/**
 * Son de l'appel : sonnerie, tonalité d'attente, haut-parleur, capteur de proximité.
 * Le module natif peut manquer (Expo Go) : chaque appel est protégé et devient sans effet.
 */
type InCall = {
  start: (o?: { media?: 'audio' | 'video'; ringback?: string; auto?: boolean }) => void;
  stop: (o?: { busytone?: string }) => void;
  startRingtone: (tone: string, vibrate: number | number[], cat: string, seconds: number) => void;
  stopRingtone: () => void;
  stopRingback: () => void;
  setForceSpeakerphoneOn: (on: boolean) => void;
  setMicrophoneMute: (on: boolean) => void;
  setKeepScreenOn: (on: boolean) => void;
};

let mgr: InCall | null | undefined;
function inCall(): InCall | null {
  if (mgr !== undefined) return mgr;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mgr = (require('react-native-incall-manager') as { default: InCall }).default ?? null;
  } catch {
    mgr = null;
  }
  return mgr;
}
const safe = (fn: (m: InCall) => void) => {
  const m = inCall();
  if (!m) return;
  try {
    fn(m);
  } catch {
    // Module natif absent ou indisponible : pas de son système, l'appel continue.
  }
};

export const callAudio = {
  /** Appel entrant : sonnerie et vibration du téléphone. */
  ring: () => safe((m) => m.startRingtone('_DEFAULT_', [0, 800, 600], 'playback', 45)),
  /** J'appelle : tonalité « ça sonne » dans l'écouteur. */
  dialTone: () => safe((m) => m.start({ media: 'audio', ringback: '_DTMF_' })),
  /** Conversation : écouteur, écran éteint contre l'oreille. */
  connect: () =>
    safe((m) => {
      m.stopRingtone();
      m.stopRingback();
      m.start({ media: 'audio', auto: true });
      m.setKeepScreenOn(true);
    }),
  speaker: (on: boolean) => safe((m) => m.setForceSpeakerphoneOn(on)),
  stop: () =>
    safe((m) => {
      m.stopRingtone();
      m.stopRingback();
      m.setKeepScreenOn(false);
      m.stop();
    }),
};
