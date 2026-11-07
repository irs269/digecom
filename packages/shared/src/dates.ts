/**
 * Fuseau métier : Indian/Comoro (UTC+3, sans heure d'été). Les dates sont stockées en UTC ;
 * les « jours » métier (date d'effet, semaine lundi → dimanche) sont calculés à UTC+3.
 */
export const BUSINESS_TIMEZONE = 'Indian/Comoro';
const OFFSET_MS = 3 * 60 * 60 * 1000;

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Jour métier (AAAA-MM-JJ) d'un instant. */
export function toBusinessDay(date: Date): string {
  return new Date(date.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** Jour métier courant. */
export function businessToday(now: Date = new Date()): string {
  return toBusinessDay(now);
}

/** Instant UTC correspondant à 00:00 heure des Comores pour un jour AAAA-MM-JJ. */
export function startOfBusinessDay(day: string): Date {
  const m = ISO_DAY.exec(day);
  if (!m) throw new RangeError(`Date invalide (AAAA-MM-JJ attendu) : ${day}`);
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const result = new Date(utc - OFFSET_MS);
  if (toBusinessDay(result) !== day) throw new RangeError(`Date inexistante : ${day}`);
  return result;
}

/** Instant UTC de 23:59:59.999 heure des Comores pour un jour AAAA-MM-JJ. */
export function endOfBusinessDay(day: string): Date {
  return new Date(startOfBusinessDay(day).getTime() + 86_400_000 - 1);
}

/** Affichage français : `07/11/2026 14:05` en heure des Comores. */
export function formatBusinessDateTime(value: Date | string): string {
  return new Date(value).toLocaleString('fr-FR', {
    timeZone: BUSINESS_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Affichage français d'un jour : `07/11/2026`. */
export function formatBusinessDate(value: Date | string): string {
  const date =
    typeof value === 'string' && ISO_DAY.test(value) ? startOfBusinessDay(value) : new Date(value);
  return date.toLocaleDateString('fr-FR', {
    timeZone: BUSINESS_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
