'use client';

import {
  formatKmf,
  MAX_PRODUCT_PHOTOS,
  sellerShareAmount,
  type Paginated,
  type ProductView,
  type UserView,
} from '@digecom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import { SelectField } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorMessage, fieldErrors, qs } from '@/lib/queries';

interface Props {
  product?: ProductView;
  onSaved: (p: ProductView) => void;
}

const num = (v: string) => (v === '' ? null : Number(v));

/** Formulaire « Publier un produit » / modification, champs selon le type de leader. */
export function ProductForm({ product, onSaved }: Props) {
  const { state } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = state.status === 'authenticated' ? state.user : null;
  const isAdmin = me?.role === 'ADMIN';

  const leaders = useQuery({
    queryKey: ['users', 'leaders-all'],
    enabled: isAdmin && !product,
    queryFn: async () => {
      const [s, j] = await Promise.all(
        (['LEADER_SENIOR', 'LEADER_JUNIOR'] as const).map((role) =>
          apiFetch<Paginated<UserView>>(`/users${qs({ role, status: 'active', pageSize: 200 })}`),
        ),
      );
      return [...s!.items, ...j!.items];
    },
  });

  const [leaderId, setLeaderId] = useState(product?.leader.id ?? '');
  const [form, setForm] = useState({
    name: product?.name ?? '',
    quality: product?.quality ?? '',
    category: product?.category ?? '',
    description: product?.description ?? '',
    salePrice: product ? String(product.salePrice) : '',
    shareType: product?.sellerShareType ?? 'FIXED',
    shareValue: product?.sellerShareValue != null ? String(product.sellerShareValue) : '',
    tciBonus: product?.tciBonus != null ? String(product.tciBonus) : '',
    lowStockThreshold: product?.lowStockThreshold != null ? String(product.lowStockThreshold) : '',
    isPublished: product?.isPublished ?? true,
  });
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const leaderRole = product
    ? product.leader.role
    : isAdmin
      ? leaders.data?.find((l) => l.id === leaderId)?.role
      : me?.role;
  const junior = leaderRole === 'LEADER_JUNIOR';
  const price = Number(form.salePrice) || 0;
  const preview =
    !junior && form.shareValue !== ''
      ? sellerShareAmount(price, form.shareType as 'FIXED' | 'PERCENT', Number(form.shareValue))
      : null;

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name,
        quality: form.quality || null,
        category: form.category || null,
        description: form.description || null,
        salePrice: Number(form.salePrice),
        lowStockThreshold: num(form.lowStockThreshold),
        isPublished: form.isPublished,
        ...(junior
          ? { tciBonus: num(form.tciBonus) }
          : { sellerShareType: form.shareType, sellerShareValue: num(form.shareValue) }),
      };
      let saved = product
        ? await apiFetch<ProductView>(`/products/${product.id}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
          })
        : await apiFetch<ProductView>('/products', {
            method: 'POST',
            body: JSON.stringify({ ...body, leaderId: isAdmin ? leaderId : undefined }),
          });
      // Photos : envoi direct vers MinIO (URL pré-signée) puis conversion WebP par l'API.
      for (const file of files) {
        const { key, uploadUrl } = await apiFetch<{ key: string; uploadUrl: string }>(
          `/products/${saved.id}/photos/upload-url`,
          { method: 'POST', body: JSON.stringify({ contentType: file.type }) },
        );
        const put = await fetch(uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type },
        });
        if (!put.ok) throw new Error(`Envoi de ${file.name} impossible`);
        saved = await apiFetch<ProductView>(`/products/${saved.id}/photos`, {
          method: 'POST',
          body: JSON.stringify({ key }),
        });
      }
      return saved;
    },
    onSuccess: (p) => {
      setErrors({});
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['catalog-visible'] });
      toast(product ? 'Produit mis à jour' : `${p.name} ajouté au catalogue`, 'success');
      onSaved(p);
    },
    onError: (err) => {
      setErrors(fieldErrors(err));
      toast(err instanceof Error && !('code' in err) ? err.message : errorMessage(err), 'error');
    },
  });

  const remainingPhotos = MAX_PRODUCT_PHOTOS - (product?.photos.length ?? 0);

  return (
    <form
      noValidate
      aria-label={product ? 'Modifier le produit' : 'Publier un produit'}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      {isAdmin && !product ? (
        <SelectField
          label="Leader"
          value={leaderId}
          onChange={(e) => setLeaderId(e.target.value)}
          placeholder="Choisir le leader propriétaire"
          options={(leaders.data ?? []).map((l) => ({
            value: l.id,
            label: `${l.fullName} · ${l.role === 'LEADER_SENIOR' ? 'Senior' : 'Junior'} · ${l.island?.name ?? ''}`,
          }))}
          error={errors.leaderId}
        />
      ) : null}
      <Field
        label="Nom du produit"
        value={form.name}
        onChange={(e) => set('name', e.target.value)}
        error={errors.name}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Qualité"
          value={form.quality}
          onChange={(e) => set('quality', e.target.value)}
        />
        <Field
          label="Catégorie"
          value={form.category}
          onChange={(e) => set('category', e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="product-description" className="text-sm font-semibold text-ink">
          Description
        </label>
        <textarea
          id="product-description"
          rows={3}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          className="rounded-md border border-surface-border px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
        />
      </div>
      <Field
        label="Prix de vente (KMF)"
        type="number"
        inputMode="numeric"
        min={1}
        value={form.salePrice}
        onChange={(e) => set('salePrice', e.target.value)}
        error={errors.salePrice}
      />
      {leaderRole ? (
        junior ? (
          <Field
            label="Prime téléconseiller (KMF / produit vendu)"
            type="number"
            inputMode="numeric"
            step={500}
            value={form.tciBonus}
            onChange={(e) => set('tciBonus', e.target.value)}
            error={errors.tciBonus}
            hint="Entre les bornes fixées dans les paramètres (2 000 à 3 500 KMF par défaut)"
          />
        ) : (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-3">
              <SelectField
                label="Part e-commerçant"
                value={form.shareType}
                onChange={(e) => set('shareType', e.target.value)}
                options={[
                  { value: 'FIXED', label: 'Montant fixe' },
                  { value: 'PERCENT', label: 'Pourcentage' },
                ]}
              />
              <Field
                label={form.shareType === 'FIXED' ? 'Montant (KMF)' : 'Pourcentage (%)'}
                type="number"
                inputMode="numeric"
                value={form.shareValue}
                onChange={(e) => set('shareValue', e.target.value)}
                error={errors.sellerShareValue}
              />
            </div>
            {preview !== null && price > 0 ? (
              <p className="text-xs text-ink-muted">
                L’e-commerçant touche {formatKmf(preview)} brut par vente ; part Dig’eCom{' '}
                {formatKmf(Math.max(price - preview, 0))}.
              </p>
            ) : null}
          </div>
        )
      ) : null}
      <Field
        label="Seuil d’alerte stock faible (facultatif)"
        type="number"
        inputMode="numeric"
        min={0}
        value={form.lowStockThreshold}
        onChange={(e) => set('lowStockThreshold', e.target.value)}
        hint="Par défaut : le seuil des paramètres"
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="product-photos" className="text-sm font-semibold text-ink">
          Photos ({remainingPhotos} restante{remainingPhotos > 1 ? 's' : ''}, 5 Mo max chacune)
        </label>
        <input
          id="product-photos"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={remainingPhotos <= 0}
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            const tooBig = picked.find((f) => f.size > 5 * 1024 * 1024);
            if (tooBig) toast(`${tooBig.name} dépasse 5 Mo`, 'error');
            setFiles(picked.filter((f) => f.size <= 5 * 1024 * 1024).slice(0, remainingPhotos));
          }}
          className="min-h-touch text-sm file:mr-3 file:min-h-[40px] file:rounded-md file:border-0 file:bg-surface file:px-3 file:font-semibold file:text-ink"
        />
        {files.length ? (
          <span className="text-xs text-ink-muted">{files.length} photo(s) à envoyer</span>
        ) : null}
      </div>
      <label className="flex min-h-touch items-center gap-2 text-sm font-semibold text-ink">
        <input
          type="checkbox"
          className="h-5 w-5 accent-brand-blue"
          checked={form.isPublished}
          onChange={(e) => set('isPublished', e.target.checked)}
        />
        Publié (visible par l’équipe du leader)
      </label>
      <Button type="submit" disabled={save.isPending}>
        {save.isPending ? 'Enregistrement…' : product ? 'Enregistrer' : 'Publier le produit'}
      </Button>
      {product ? (
        <p className="text-xs text-ink-muted">
          Un changement de prix, de part ou de prime ne s’applique qu’aux ventes futures.
        </p>
      ) : null}
    </form>
  );
}
