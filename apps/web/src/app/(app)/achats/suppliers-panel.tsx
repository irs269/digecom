'use client';

import type { SupplierView } from '@digecom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api';
import { errorMessage, fieldErrors } from '@/lib/queries';

const EMPTY = { name: '', platform: '', contact: '' };

/** Fournisseurs : création, modification, désactivation (droit `purchases:create`). */
export function SuppliersPanel() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => apiFetch<SupplierView[]>('/suppliers'),
  });
  const [editing, setEditing] = useState<SupplierView | null>(null);
  const [f, setF] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const reset = () => {
    setEditing(null);
    setF(EMPTY);
    setErrors({});
  };
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['suppliers'] });

  const save = useMutation({
    mutationFn: () => {
      const body = JSON.stringify({
        name: f.name,
        platform: f.platform || undefined,
        contact: f.contact || undefined,
      });
      return editing
        ? apiFetch<SupplierView>(`/suppliers/${editing.id}`, { method: 'PATCH', body })
        : apiFetch<SupplierView>('/suppliers', { method: 'POST', body });
    },
    onSuccess: (s) => {
      toast(editing ? `${s.name} modifié` : `${s.name} ajouté`, 'success');
      reset();
      void refresh();
    },
    onError: (err) => {
      setErrors(fieldErrors(err));
      toast(errorMessage(err), 'error');
    },
  });

  const toggle = useMutation({
    mutationFn: (s: SupplierView) =>
      apiFetch<SupplierView>(`/suppliers/${s.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !s.isActive }),
      }),
    onSuccess: (s) => {
      toast(s.isActive ? `${s.name} réactivé` : `${s.name} désactivé`, 'success');
      void refresh();
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="flex flex-col gap-5">
      <form
        aria-label={editing ? 'Modifier le fournisseur' : 'Nouveau fournisseur'}
        className="flex flex-col gap-3 rounded-md border border-surface-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <h3 className="text-sm font-bold">
          {editing ? `Modifier ${editing.name}` : 'Nouveau fournisseur'}
        </h3>
        <Field label="Nom" value={f.name} onChange={set('name')} error={errors.name} required />
        <Field
          label="Plateforme"
          hint="Alibaba, 1688, Taobao…"
          value={f.platform}
          onChange={set('platform')}
          error={errors.platform}
        />
        <Field
          label="Contact"
          hint="Nom, téléphone, WeChat, lien de la boutique"
          value={f.contact}
          onChange={set('contact')}
          error={errors.contact}
        />
        <div className="flex gap-2">
          <Button type="submit" variant="accent" disabled={save.isPending}>
            {editing ? 'Enregistrer' : 'Ajouter le fournisseur'}
          </Button>
          {editing ? (
            <Button type="button" variant="ghost" onClick={reset}>
              Annuler
            </Button>
          ) : null}
        </div>
      </form>

      <ul className="flex flex-col divide-y divide-surface-border" aria-label="Fournisseurs">
        {(suppliers.data ?? []).map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="font-semibold">
                {s.name} {s.isActive ? null : <Badge tone="red">Inactif</Badge>}
              </div>
              <div className="truncate text-xs text-ink-muted">
                {[s.platform, s.contact].filter(Boolean).join(' · ') || '—'}
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Modifier ${s.name}`}
                onClick={() => {
                  setEditing(s);
                  setErrors({});
                  setF({ name: s.name, platform: s.platform ?? '', contact: s.contact ?? '' });
                }}
              >
                Modifier
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={toggle.isPending}
                aria-label={`${s.isActive ? 'Désactiver' : 'Réactiver'} ${s.name}`}
                onClick={() => toggle.mutate(s)}
              >
                {s.isActive ? 'Désactiver' : 'Réactiver'}
              </Button>
            </div>
          </li>
        ))}
        {suppliers.data?.length === 0 ? (
          <li className="py-2 text-sm text-ink-muted">Aucun fournisseur pour l’instant.</li>
        ) : null}
      </ul>
    </div>
  );
}
