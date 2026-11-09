import * as Location from 'expo-location';
import { api } from './api';

/**
 * Position du téléphone (livreur, e-commerçant), envoyée à l'API pendant que l'application est
 * ouverte : la logistique classe les livreurs par distance au site, et le livreur obtient
 * l'itinéraire jusqu'à l'e-commerçant. Aucun suivi en arrière-plan.
 */

let lastSent = 0;
let lastPoint: { latitude: number; longitude: number } | null = null;

/** Demande l'autorisation (une seule fois) ; faux si refusée. */
export async function ensureLocationPermission(): Promise<boolean> {
  try {
    const current = await Location.getForegroundPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    return (await Location.requestForegroundPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Position actuelle, ou null (refus, GPS coupé, délai). */
export async function currentPosition(): Promise<{ latitude: number; longitude: number } | null> {
  if (!(await ensureLocationPermission())) return null;
  try {
    const pos =
      (await Location.getLastKnownPositionAsync({ maxAge: 2 * 60_000 })) ??
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    lastPoint = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
    return lastPoint;
  } catch {
    return null;
  }
}

/**
 * Envoie la position si la dernière a plus de `minIntervalMs` (2 min par défaut).
 * Silencieux en cas d'échec : la position n'est qu'une aide à l'affectation.
 */
export async function reportLocation(minIntervalMs = 2 * 60_000): Promise<void> {
  if (Date.now() - lastSent < minIntervalMs) return;
  const point = await currentPosition();
  if (!point) return;
  try {
    await api('/me/location', { method: 'POST', body: point });
    lastSent = Date.now();
  } catch {
    // Réseau absent : nouvel essai au prochain passage.
  }
}

export function lastKnownPoint() {
  return lastPoint;
}
