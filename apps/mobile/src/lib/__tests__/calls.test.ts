import type { CallView } from '@digecom/shared';
import { callReducer, endTextFor, formatDuration, initialCallState } from '../calls/machine';

const ME = 'fatima';
const call = (patch: Partial<CallView> = {}): CallView => ({
  id: 'c1',
  orderId: 'o1',
  orderNumber: 'CMD-000001',
  status: 'RINGING',
  caller: { id: ME, fullName: 'Fatima Said', role: 'SELLER' },
  callee: { id: 'karim', fullName: 'Karim Bacar', role: 'COURIER' },
  createdAt: '2026-11-09T10:00:00.000Z',
  answeredAt: null,
  endedAt: null,
  durationSeconds: null,
  ...patch,
});
const ice = [{ urls: 'stun:stun.l.google.com:19302' }];

test('appel sortant : numérotation → sonnerie → décroché → conversation → fin', () => {
  let s = callReducer(initialCallState, { type: 'dial', orderNumber: '', peerName: '' });
  expect(s.phase).toBe('dialing');
  s = callReducer(s, { type: 'dialed', call: call(), iceServers: ice });
  expect(s).toMatchObject({ phase: 'ringing-out', outgoing: true });
  s = callReducer(s, {
    type: 'server',
    event: { type: 'accepted', call: call({ status: 'ACCEPTED' }) },
    myId: ME,
  });
  expect(s.phase).toBe('connecting');
  s = callReducer(s, { type: 'media-connected', at: 1000 });
  expect(s).toMatchObject({ phase: 'active', connectedAt: 1000 });
  s = callReducer(s, {
    type: 'server',
    event: { type: 'ended', call: call({ status: 'ENDED' }) },
    myId: ME,
  });
  expect(s).toMatchObject({ phase: 'ended', endText: 'Appel terminé' });
  expect(callReducer(s, { type: 'reset' })).toEqual(initialCallState);
});

test('appel entrant : sonne seulement chez le destinataire, puis décroché', () => {
  const incoming = {
    type: 'server' as const,
    event: { type: 'incoming' as const, call: call(), iceServers: ice },
  };
  // Je suis l'appelant : l'événement ne me concerne pas.
  expect(callReducer(initialCallState, { ...incoming, myId: ME }).phase).toBe('idle');
  let s = callReducer(initialCallState, { ...incoming, myId: 'karim' });
  expect(s).toMatchObject({ phase: 'ringing-in', outgoing: false, iceServers: ice });
  s = callReducer(s, { type: 'answer' });
  expect(s.phase).toBe('connecting');
});

test('déjà en ligne : un second appel entrant est ignoré', () => {
  const s = callReducer(
    { ...initialCallState, phase: 'active', call: call({ id: 'c0' }) },
    { type: 'server', event: { type: 'incoming', call: call(), iceServers: ice }, myId: 'karim' },
  );
  expect(s.call?.id).toBe('c0');
});

test('les événements d’un autre appel sont ignorés', () => {
  const s = { ...initialCallState, phase: 'ringing-out' as const, call: call(), outgoing: true };
  const other = callReducer(s, {
    type: 'server',
    event: { type: 'ended', call: call({ id: 'autre', status: 'ENDED' }) },
    myId: ME,
  });
  expect(other.phase).toBe('ringing-out');
});

test('textes de fin selon le côté de l’appel', () => {
  expect(endTextFor(call({ status: 'MISSED' }), true)).toBe('Pas de réponse');
  expect(endTextFor(call({ status: 'MISSED' }), false)).toBe('Appel manqué');
  expect(endTextFor(call({ status: 'CANCELLED' }), false)).toBe('Appel manqué');
  expect(endTextFor(call({ status: 'DECLINED' }), true)).toBe('Appel refusé');
  expect(endTextFor(call({ status: 'FAILED' }), true)).toBe('Connexion perdue');
});

test('échec au départ : message affiché ; micro et haut-parleur basculent', () => {
  const s = callReducer(initialCallState, { type: 'dial-failed', message: 'Pas de réseau' });
  expect(s).toMatchObject({ phase: 'ended', endText: 'Pas de réseau' });
  const m = callReducer(initialCallState, { type: 'toggle-mute' });
  expect(m.muted).toBe(true);
  expect(callReducer(m, { type: 'toggle-speaker' }).speaker).toBe(true);
});

test('chrono', () => {
  expect(formatDuration(0)).toBe('0:00');
  expect(formatDuration(127.6)).toBe('2:07');
});
