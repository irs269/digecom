'use client';

import { mapEmbedUrl, mapPointUrl, type SiteView } from '@digecom/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api';
import { errorMessage, useSites } from '@/lib/queries';

/**
 * « 12.345, 43.21 » ou « -11.70221, 43.25510 » (copié depuis Google Maps : clic droit sur la carte,
 * puis clic sur les coordonnées) → { latitude, longitude }.
 */
export function parseCoordinates(text: string): { latitude: number; longitude: number } | null {
  const m = text.trim().match(/^(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)$/);
  if (!m) return null;
  const latitude = Number(m[1]!.replace(',', '.'));
  const longitude = Number(m[2]!.replace(',', '.'));
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

function SiteCard({ site }: { site: SiteView }) {
  const qc = useQueryClient();
  const toast = useToast();
  const initial =
    site.latitude !== null && site.longitude !== null ? `${site.latitude}, ${site.longitude}` : '';
  const [text, setText] = useState(initial);
  const point = parseCoordinates(text);
  const saved =
    site.latitude !== null && site.longitude !== null
      ? { latitude: site.latitude, longitude: site.longitude }
      : null;

  const save = useMutation({
    mutationFn: (p: { latitude: number; longitude: number } | null) =>
      apiFetch<SiteView>(`/sites/${site.id}`, {
        method: 'PATCH',
        body: JSON.stringify(p ?? { latitude: null, longitude: null }),
      }),
    onSuccess: () => {
      toast(`Position du site ${site.name} enregistrée`, 'success');
      void qc.invalidateQueries({ queryKey: ['sites'] });
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  const takeMyPosition = () => {
    if (!navigator.geolocation) {
      toast('Géolocalisation indisponible dans ce navigateur', 'error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setText(`${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`),
      () => toast('Position refusée ou indisponible', 'error'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const shown = point ?? saved;
  return (
    <Card className="flex flex-col gap-3 p-4" data-site={site.name}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-bold text-ink">{site.name}</p>
          <p className="text-sm text-ink-muted">
            {site.island.name}
            {site.address ? ` · ${site.address}` : ''}
          </p>
        </div>
        {saved ? (
          <Badge tone="green">Position GPS renseignée</Badge>
        ) : (
          <Badge tone="orange">Sans position</Badge>
        )}
      </div>
      {shown ? (
        <iframe
          title={`Carte du site ${site.name}`}
          src={mapEmbedUrl(shown)}
          className="h-56 w-full rounded-md border border-surface-border"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      ) : (
        <div className="flex h-24 items-center justify-center rounded-md bg-surface text-sm text-ink-muted">
          Aucune position : colle les coordonnées ou utilise ta position actuelle sur place.
        </div>
      )}
      <Field
        label="Coordonnées GPS (latitude, longitude)"
        placeholder="-11.702200, 43.255100"
        value={text}
        onChange={(e) => setText(e.target.value)}
        error={text && !point ? 'Format attendu : latitude, longitude' : undefined}
        hint="Dans Google Maps : clic droit sur le site, puis clic sur les coordonnées pour les copier."
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={takeMyPosition}>
          Ma position actuelle
        </Button>
        {shown ? (
          <Button asChild variant="ghost" size="sm">
            <a href={mapPointUrl(shown)} target="_blank" rel="noreferrer">
              Ouvrir dans Google Maps
            </a>
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          disabled={!point || save.isPending}
          onClick={() => point && save.mutate(point)}
        >
          Enregistrer la position
        </Button>
        {saved ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={save.isPending}
            onClick={() => {
              setText('');
              save.mutate(null);
            }}
          >
            Effacer
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

/** Sites : position GPS du point de retrait, utilisée pour classer les livreurs par distance. */
export function SitesTab() {
  const sites = useSites();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">
        La position de chaque site sert à proposer, au moment de l’affectation, les livreurs
        disponibles <strong>du plus proche au plus loin</strong>, et à guider le livreur jusqu’au
        point de retrait.
      </p>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {(sites.data ?? []).map((s) => (
          <SiteCard key={s.id} site={s} />
        ))}
      </div>
    </div>
  );
}
