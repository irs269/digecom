import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Stockage du jeton de session : trousseau du téléphone (Android),
 * stockage local du navigateur pour la PWA (expo-secure-store n'existe pas sur le web).
 */
const web = Platform.OS === 'web';
const ls = () => (globalThis as { localStorage?: Storage }).localStorage;

export const secure = {
  get: async (k: string): Promise<string | null> =>
    web ? (ls()?.getItem(k) ?? null) : SecureStore.getItemAsync(k),
  set: async (k: string, v: string): Promise<void> =>
    web ? void ls()?.setItem(k, v) : SecureStore.setItemAsync(k, v),
  remove: async (k: string): Promise<void> =>
    web ? void ls()?.removeItem(k) : SecureStore.deleteItemAsync(k),
};
