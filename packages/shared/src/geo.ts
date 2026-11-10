import { z } from 'zod';

/**
 * Positions et itinéraires, sans clé d'API : distances calculées localement (haversine) et
 * itinéraires ouverts dans Google Maps par ses URL publiques (« Maps URLs »).
 */

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** Position envoyée par l'application mobile (`POST /me/location`). */
export const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  /** Précision annoncée par le téléphone, en mètres. */
  accuracy: z.number().min(0).max(100_000).optional(),
});
export type LocationInput = z.infer<typeof locationSchema>;

/** Au-delà de ce délai, une position n'est plus considérée comme fraîche. */
export const LOCATION_FRESH_MINUTES = 30;

const R = 6371; // rayon moyen de la Terre, km

/** Distance à vol d'oiseau entre deux points, en kilomètres (formule de haversine). */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** « 850 m », « 3,2 km », « 27 km ». */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}

const coord = (p: GeoPoint) => `${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`;

/**
 * Itinéraire Google Maps (application sur téléphone, site sur ordinateur). Sans origine, Google
 * part de la position actuelle de l'appareil.
 */
export function directionsUrl(destination: GeoPoint, origin?: GeoPoint | null): string {
  const params = new URLSearchParams({ api: '1', destination: coord(destination) });
  if (origin) params.set('origin', coord(origin));
  params.set('travelmode', 'driving');
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** Point sur la carte Google Maps. */
export function mapPointUrl(p: GeoPoint): string {
  return `https://www.google.com/maps/search/?api=1&query=${coord(p)}`;
}

/** Carte intégrable (iframe) sans clé d'API. */
export function mapEmbedUrl(p: GeoPoint, zoom = 15): string {
  return `https://maps.google.com/maps?q=${coord(p)}&z=${zoom}&hl=fr&output=embed`;
}

/** Livreur proposé à l'affectation, trié par disponibilité puis distance au site. */
export interface CourierCandidate {
  id: string;
  fullName: string;
  phone: string;
  isAvailable: boolean;
  activeRuns: number;
  /** Distance au site de la commande ; null si position ou site inconnus. */
  distanceKm: number | null;
  /** Date de la dernière position connue. */
  locationAt: string | null;
  /** Position récente (moins de LOCATION_FRESH_MINUTES). */
  locationFresh: boolean;
}

/**
 * Ordre de proposition (les deux critères demandés) : les livreurs **disponibles** d'abord, puis
 * du **plus proche au plus loin du site** (position récente avant position ancienne, position
 * inconnue en dernier). À distance égale, celui qui a le moins de courses en cours.
 */
export function rankCouriers(list: CourierCandidate[]): CourierCandidate[] {
  const score = (c: CourierCandidate) => [
    c.isAvailable ? 0 : 1,
    c.distanceKm === null ? 2 : c.locationFresh ? 0 : 1,
    c.distanceKm ?? Number.MAX_SAFE_INTEGER,
    c.activeRuns,
  ];
  return [...list].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i]! - sb[i]!;
    return a.fullName.localeCompare(b.fullName, 'fr');
  });
}
