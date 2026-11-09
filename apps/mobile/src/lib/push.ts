import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

let currentToken: string | null = null;

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
