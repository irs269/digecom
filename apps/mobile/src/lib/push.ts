import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

let currentToken: string | null = null;

if (Platform.OS !== 'web')
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

/** Canaux Android : « courses » (offres, son + vibration, priorité max) et « default ». */
async function ensureChannels() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('courses', {
    name: 'Offres de course',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 400, 200, 400, 200, 400],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  // Appels entrants : sonnerie longue et vibration, visibles sur l'écran verrouillé.
  await Notifications.setNotificationChannelAsync('appels', {
    name: 'Appels Dig’eCom',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 800, 600, 800, 600, 800],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: false,
  });
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Notifications',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/**
 * Demande l'autorisation, récupère le jeton Expo (relayé par FCM) et l'enregistre côté API.
 * Silencieux en cas d'échec : l'application reste utilisable, sans push.
 */
export async function registerForPush(): Promise<void> {
  if (Platform.OS === 'web') {
    await registerWebPush();
    return;
  }
  try {
    await ensureChannels();
    if (!Device.isDevice) return;
    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    currentToken = data;
    await api('/me/devices', {
      method: 'POST',
      body: { token: data, platform: Platform.OS === 'ios' ? 'ios' : 'android' },
    });
  } catch {
    // Pas de push (émulateur sans Google Play, réseau…) : la liste se met à jour à l'ouverture.
  }
}

export async function unregisterPush(): Promise<void> {
  if (!currentToken) return;
  await api(`/me/devices/${encodeURIComponent(currentToken)}`, { method: 'DELETE' }).catch(
    () => undefined,
  );
  currentToken = null;
}

/** Base64 URL → octets (clé VAPID). */
function keyBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** PWA installée sur l'écran d'accueil (iPhone : seul cas où Safari autorise le push). */
export function isStandalone(): boolean {
  if (Platform.OS !== 'web') return true;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
}

/** Push web possible ici (navigateur compatible, application installée sur iPhone). */
export function webPushSupported(): boolean {
  return (
    Platform.OS === 'web' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * PWA : service worker + abonnement Web Push enregistré côté API (plateforme « web »).
 * Sur iPhone, la demande d'autorisation doit suivre un geste (bouton « Activer les notifications »).
 */
export async function registerWebPush(ask = false): Promise<boolean> {
  try {
    if (!webPushSupported()) return false;
    const reg = await navigator.serviceWorker.register('/pwa/sw.js', { scope: '/pwa/' });
    if (Notification.permission !== 'granted') {
      if (!ask || (await Notification.requestPermission()) !== 'granted') return false;
    }
    const { publicKey } = await api<{ publicKey: string | null }>('/me/push/web-key');
    if (!publicKey) return false;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(publicKey) as BufferSource,
      }));
    const token = JSON.stringify(sub);
    currentToken = token;
    await api('/me/devices', { method: 'POST', body: { token, platform: 'web' } });
    return true;
  } catch {
    return false;
  }
}
