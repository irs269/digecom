import { describe, expect, it } from 'vitest';
import {
  directionsUrl,
  distanceKm,
  formatDistance,
  rankCouriers,
  type CourierCandidate,
} from './geo';

const moroni = { latitude: -11.7022, longitude: 43.2551 };
const mitsamiouli = { latitude: -11.3847, longitude: 43.2844 };

describe('distances', () => {
  it('Moroni → Mitsamiouli ≈ 35 km à vol d’oiseau', () => {
    expect(distanceKm(moroni, mitsamiouli)).toBeGreaterThan(34);
    expect(distanceKm(moroni, mitsamiouli)).toBeLessThan(37);
    expect(distanceKm(moroni, moroni)).toBe(0);
  });

  it('affichage en mètres ou kilomètres', () => {
    expect(formatDistance(0.43)).toBe('430 m');
    expect(formatDistance(3.24)).toBe('3,2 km');
    expect(formatDistance(27.4)).toBe('27 km');
  });

  it('itinéraire Google Maps sans clé d’API', () => {
    expect(directionsUrl(moroni)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=-11.702200%2C43.255100&travelmode=driving',
    );
    expect(directionsUrl(moroni, mitsamiouli)).toContain('origin=-11.384700%2C43.284400');
  });
});

describe('classement des livreurs', () => {
  const c = (p: Partial<CourierCandidate>): CourierCandidate => ({
    id: p.fullName ?? 'x',
    fullName: 'x',
    phone: '',
    isAvailable: true,
    activeRuns: 0,
    distanceKm: null,
    locationAt: null,
    locationFresh: false,
    ...p,
  });

  it('disponibles d’abord, puis du plus proche au plus loin du site', () => {
    const ranked = rankCouriers([
      c({
        fullName: 'Indisponible proche',
        isAvailable: false,
        distanceKm: 0.5,
        locationFresh: true,
      }),
      c({ fullName: 'Loin', distanceKm: 8, locationFresh: true }),
      c({ fullName: 'Sans position' }),
      c({ fullName: 'Proche', distanceKm: 1.2, locationFresh: true }),
      c({ fullName: 'Proche mais position ancienne', distanceKm: 0.3, locationFresh: false }),
    ]);
    expect(ranked.map((r) => r.fullName)).toEqual([
      'Proche',
      'Loin',
      'Proche mais position ancienne',
      'Sans position',
      'Indisponible proche',
    ]);
  });
});
