'use client';

import {
  formatKmf,
  hasPermission,
  PRODUCT_STATE_LABELS,
  type Paginated,
  type ProductState,
  type ProductView,
  type UserView,
  type VisibleCatalog,
} from '@digecom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { Forbidden } from '@/components/forbidden';
import { StockHistory } from '@/components/stock-history';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorMessage, qs } from '@/lib/queries';
import { ProductForm } from './product-form';

const STATE_TONE: Record<ProductState, 'green' | 'orange' | 'red'> = {
  PUBLISHED: 'green',
  OUT_OF_STOCK: 'orange',
  UNPUBLISHED: 'red',
};

type Panel =
  | { mode: 'create' }
  | { mode: 'edit'; product: ProductView }
  | { mode: 'history'; product: ProductView }
  | null;

function StockDialog({
  product,
  direction,
  onClose,
}: {
  product: ProductView | null;
  direction: 1 | -1;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const save = useMutation({
    mutationFn: () =>
      apiFetch<ProductView>(`/products/${product!.id}/stock`, {
        method: 'POST',
        body: JSON.stringify({
          delta: direction * Number(quantity),
          reason,
          unitCost: unitCost ? Number(unitCost) : undefined,
        }),
      }),
    onSuccess: (p) => {
      toast(`${p.name} : ${p.stock.available} en stock`, 'success');
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['catalog-visible'] });
      setReason('');
      setQuantity('1');
      setUnitCost('');
      onClose();
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  return (
    <Dialog open={!!product} onOpenChange={(o) => !o && onClose()}>
      {product ? (
        <DialogContent
          title={`${direction > 0 ? 'Ajouter du stock' : 'Retirer du stock'} – ${product.name}`}
          description={`Stock actuel : ${product.stock.available}. Le mouvement est tracé avec son motif.`}
        >
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <Field
              label="Quantité"
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            <Field
              label="Motif"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="ex. Retour client, casse…"
            />
            {direction > 0 ? (
              <Field
                label="Coût unitaire (KMF)"
                type="number"
                min={0}
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                hint="Obligatoire pour un premier stock ; sinon, coût moyen des lots en stock"
              />
            ) : null}
            <Button
              type="submit"
              disabled={save.isPending || reason.trim().length < 3 || Number(quantity) < 1}
            >
              Valider
            </Button>
          </form>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function TeamPreview({ canChoose, selfId }: { canChoose: boolean; selfId: string | null }) {
  const leaders = useQuery({
    queryKey: ['users', 'leaders-preview'],
    enabled: canChoose,
    queryFn: async () => {
      const [s, j] = await Promise.all(
        (['LEADER_SENIOR', 'LEADER_JUNIOR'] as const).map((role) =>
          apiFetch<Paginated<UserView>>(
            `/users${qs({ role, status: 'active', pageSize: 200 })}`,
          ).catch(() => ({ items: [] as UserView[] })),
        ),
      );
      return [...s!.items, ...j!.items];
    },
  });
  const [chosen, setChosen] = useState('');
  const leaderId = canChoose ? chosen : selfId;
  const visible = useQuery({
    queryKey: ['catalog-visible', leaderId],
    enabled: !!leaderId,
    queryFn: () =>
      apiFetch<VisibleCatalog>(`/catalog/visible${canChoose ? qs({ asLeader: leaderId }) : ''}`),
  });

  return (
    <Card className="flex flex-col gap-3" data-testid="team-preview">
      <div>
        <h2 className="text-lg font-bold text-ink">Ce que voit chaque équipe</h2>
        <p className="text-sm text-ink-muted">
          Un vendeur ne voit que les produits publiés de son leader, avec le stock de son île.
        </p>
      </div>
      {canChoose ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Choisir une équipe">
          {(leaders.data ?? []).map((l) => (
            <Button
              key={l.id}
              size="sm"
              variant={chosen === l.id ? 'primary' : 'outline'}
              aria-pressed={chosen === l.id}
              onClick={() => setChosen(l.id)}
            >
              Équipe {l.fullName}
            </Button>
          ))}
        </div>
      ) : null}
      {visible.data ? (
        <>
          <p className="text-sm text-ink">
            <strong>{visible.data.products.length}</strong> produit(s) visibles par l’équipe de{' '}
            {visible.data.leader.fullName} · {visible.data.hiddenCount} masqué(s) (retirés ou sans
            stock)
          </p>
          <ul
            className="flex flex-col divide-y divide-surface-border"
            aria-label="Produits visibles"
          >
            {visible.data.products.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span className="font-semibold">
                  {p.name}{' '}
                  {p.quality ? (
                    <span className="font-normal text-ink-muted">· {p.quality}</span>
                  ) : null}
                </span>
                <span className="text-ink-muted">
                  {formatKmf(p.salePrice)} · {p.available} dispo
                  {p.sellerAmount !== null ? ` · vendeur ${formatKmf(p.sellerAmount)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : canChoose && !chosen ? (
        <p className="text-sm text-ink-muted">Choisis une équipe pour voir son catalogue.</p>
      ) : (
        <p className="text-sm text-ink-muted">Chargement…</p>
      )}
    </Card>
  );
}

export default function CataloguePage() {
  const { state } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<Panel>(null);
  const [stockDialog, setStockDialog] = useState<{
    product: ProductView;
    direction: 1 | -1;
  } | null>(null);
  const products = useQuery({
    queryKey: ['products'],
    queryFn: () => apiFetch<Paginated<ProductView>>('/products?pageSize=200'),
  });
  const act = useMutation({
    mutationFn: ({ id, path }: { id: string; path: string }) =>
      apiFetch<ProductView>(`/products/${id}/${path}`, { method: 'POST' }),
    onSuccess: (p) => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['catalog-visible'] });
      toast(
        `${p.name} : ${PRODUCT_STATE_LABELS[p.state]}${p.tciBonus !== null ? ` · prime ${formatKmf(p.tciBonus)}` : ''}`,
        'success',
      );
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });

  if (state.status !== 'authenticated') return null;
  const user = state.user;
  const mod = user.modules.find((m) => m.key === 'catalog');
  if (!mod) return <Forbidden />;
  const isLeader = user.role === 'LEADER_SENIOR' || user.role === 'LEADER_JUNIOR';
  const canWrite = mod.access === 'C';
  const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(user.role, p);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title={mod.label}
          subtitle={
            isLeader
              ? 'Tes produits, ton stock et ce que voit ton équipe'
              : 'Catalogues publiés par les leaders, cloisonnés par équipe'
          }
        />
        {canWrite ? (
          <Button variant="accent" onClick={() => setPanel({ mode: 'create' })}>
            + Publier un produit
          </Button>
        ) : null}
      </div>

      <Table aria-label="Produits publiés">
        <THead>
          <TR>
            <TH>Leader</TH>
            <TH>Produit</TH>
            <TH>Qualité</TH>
            <TH>Prix</TH>
            <TH>Part vendeur / prime</TH>
            <TH>Stock</TH>
            <TH>Vendus</TH>
            <TH>État</TH>
            <TH>
              <span className="sr-only">Actions</span>
            </TH>
          </TR>
        </THead>
        <TBody>
          {products.data?.items.map((p) => {
            const junior = p.leader.role === 'LEADER_JUNIOR';
            return (
              <TR key={p.id} data-product={p.name}>
                <TD>
                  <div className="font-semibold">{p.leader.fullName}</div>
                  <div className="text-xs text-ink-muted">
                    {p.leader.island?.name ?? '—'} · {junior ? 'Junior' : 'Senior'}
                  </div>
                </TD>
                <TD>
                  <button
                    type="button"
                    className="text-left font-semibold text-brand-blue hover:underline"
                    onClick={() => setPanel({ mode: 'history', product: p })}
                  >
                    {p.name}
                  </button>
                  <div className="text-xs text-ink-muted">{p.sku}</div>
                </TD>
                <TD className="text-ink-muted">{p.quality ?? '—'}</TD>
                <TD className="whitespace-nowrap">{formatKmf(p.salePrice)}</TD>
                <TD className="whitespace-nowrap">
                  {p.sellerAmount !== null ? formatKmf(p.sellerAmount) : '—'}
                  <div className="text-xs text-ink-muted">
                    {junior ? 'prime TCI' : 'part e-commerçant'}
                  </div>
                </TD>
                <TD className="font-semibold">{p.stock.available}</TD>
                <TD>{p.sold}</TD>
                <TD>
                  <Badge tone={STATE_TONE[p.state]}>{PRODUCT_STATE_LABELS[p.state]}</Badge>
                </TD>
                <TD>
                  {canWrite ? (
                    <div className="flex flex-wrap justify-end gap-1">
                      {can('catalog:adjust_stock') ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Ajouter du stock à ${p.name}`}
                            onClick={() => setStockDialog({ product: p, direction: 1 })}
                          >
                            Stock +
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Retirer du stock de ${p.name}`}
                            onClick={() => setStockDialog({ product: p, direction: -1 })}
                          >
                            Stock −
                          </Button>
                        </>
                      ) : null}
                      {junior && can('catalog:edit_tci_bonus') ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Baisser la prime de ${p.name} de 500 KMF`}
                            onClick={() => act.mutate({ id: p.id, path: 'tci-bonus/down' })}
                          >
                            Prime −500
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Augmenter la prime de ${p.name} de 500 KMF`}
                            onClick={() => act.mutate({ id: p.id, path: 'tci-bonus/up' })}
                          >
                            Prime +500
                          </Button>
                        </>
                      ) : null}
                      <Button
                        size="sm"
                        variant={p.isPublished ? 'ghost' : 'primary'}
                        onClick={() =>
                          act.mutate({ id: p.id, path: p.isPublished ? 'unpublish' : 'publish' })
                        }
                      >
                        {p.isPublished ? 'Retirer' : 'Publier'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setPanel({ mode: 'edit', product: p })}
                      >
                        Modifier
                      </Button>
                    </div>
                  ) : null}
                </TD>
              </TR>
            );
          })}
          {products.data && !products.data.items.length ? (
            <TR>
              <TD colSpan={9} className="py-8 text-center text-ink-muted">
                Aucun produit pour l’instant.
              </TD>
            </TR>
          ) : null}
        </TBody>
      </Table>
      <p className="text-xs text-ink-muted">
        Un même produit peut être publié par plusieurs leaders, avec un prix ou une qualité
        différents. Chacun vend uniquement son propre stock. Part vendeur : part e-commerçant pour
        un Leader Senior, prime téléconseiller pour un Leader Junior.
      </p>

      <TeamPreview canChoose={!isLeader} selfId={isLeader ? user.id : null} />

      <Sheet
        open={panel?.mode === 'create' || panel?.mode === 'edit'}
        onOpenChange={(o) => !o && setPanel(null)}
        title={panel?.mode === 'edit' ? `Modifier ${panel.product.name}` : 'Publier un produit'}
        description="Nom, qualité, prix, part vendeur ou prime, photos."
      >
        {panel?.mode === 'create' ? <ProductForm onSaved={() => setPanel(null)} /> : null}
        {panel?.mode === 'edit' ? (
          <ProductForm product={panel.product} onSaved={() => setPanel(null)} />
        ) : null}
      </Sheet>
      <Sheet
        open={panel?.mode === 'history'}
        onOpenChange={(o) => !o && setPanel(null)}
        title={panel?.mode === 'history' ? panel.product.name : 'Produit'}
        description="Photos et historique des mouvements de stock"
      >
        {panel?.mode === 'history' ? (
          <div className="flex flex-col gap-4">
            {panel.product.photos.length ? (
              <div className="grid grid-cols-3 gap-2">
                {panel.product.photos.map((ph) => (
                  <img
                    key={ph.key}
                    src={ph.url}
                    alt={panel.product.name}
                    className="aspect-square rounded-md object-cover"
                  />
                ))}
              </div>
            ) : null}
            <StockHistory productId={panel.product.id} />
          </div>
        ) : null}
      </Sheet>
      <StockDialog
        product={stockDialog?.product ?? null}
        direction={stockDialog?.direction ?? 1}
        onClose={() => setStockDialog(null)}
      />
    </>
  );
}
