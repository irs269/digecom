'use client';

import type { IslandView, SiteView } from '@digecom/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch, ApiRequestError } from './api';

/** Construit une query string en ignorant les valeurs vides. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function useIslands() {
  return useQuery({
    queryKey: ['islands'],
    queryFn: () => apiFetch<IslandView[]>('/islands'),
    staleTime: 10 * 60_000,
  });
}

export function useSites(includeInactive = false) {
  return useQuery({
    queryKey: ['sites', includeInactive],
    queryFn: () =>
      apiFetch<SiteView[]>(
        `/sites${qs({ includeInactive: includeInactive ? 'true' : undefined })}`,
      ),
  });
}

/** Message d'erreur lisible pour un toast. */
export function errorMessage(err: unknown): string {
  return err instanceof ApiRequestError ? err.message : 'Une erreur est survenue. Réessaie.';
}

/** Erreurs de champ renvoyées par l'API (422) indexées par chemin. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiRequestError) || !Array.isArray(err.details)) return {};
  return Object.fromEntries(
    (err.details as { path?: string; message?: string }[])
      .filter((d) => d.path && d.message)
      .map((d) => [d.path!, d.message!]),
  );
}
