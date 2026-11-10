import { createElement, type ReactNode } from 'react';

/** PWA (iPhone, navigateur) : carte Google Maps dans une iframe, sans clé d'API. */
export function MapFrame({ src }: { html: string; src: string }): ReactNode {
  return createElement('iframe', {
    src,
    title: 'Carte',
    loading: 'lazy',
    referrerPolicy: 'no-referrer-when-downgrade',
    allowFullScreen: true,
    style: { border: 0, width: '100%', height: '100%' },
  });
}
