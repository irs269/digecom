'use client';

import {
  formatKmf,
  STOCK_ALERT_LABELS,
  type ScopeKind,
  type StockAlertKind,
  type StockRow,
  type StockSummary,
} from '@digecom/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader, useIslandFilter } from '@/components/app-shell';
import { Forbidden } from '@/components/forbidden';
import { StockHistory } from '@/components/stock-history';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { KpiCard } from '@/components/ui/card';
import { Sheet } from '@/components/ui/sheet';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { qs, useIslands, useSites } from '@/lib/queries';
import {
  AdjustForm,
  EntryForm,
  InventoryPanel,
  TransferForm,
  type StockAction,
} from './stock-actions';

const ALERT_TONE: Record<StockAlertKind, 'orange' | 'red' | 'blue'> = {
  LOW: 'orange',
  OUT: 'red',
  UNSOLD: 'blue',
  INVENTORY_DIFF: 'orange',
};

const ACTION_TITLES: Record<StockAction, string> = {
  entry: 'Entrée de marchandises',
  transfer: 'Transfert entre sites',
  adjust: 'Ajustement, casse ou perte',
  inventory: 'Inventaire',
};

export default function StockPage() {
  const { state } = useAuth();
  const island = useIslandFilter();
  const islands = useIslands();
  const allSites = useSites();
  const [siteId, setSiteId] = useState('');
  const [alert, setAlert] = useState('');
  const [q, setQ] = useState('');
  const [action, setAction] = useState<StockAction | null>(null);
  const [history, setHistory] = useState<StockRow | null>(null);

  const islandId = island === 'all' ? undefined : islands.data?.find((i) => i.code === island)?.id;
  const params = qs({ islandId, siteId, alert, q });
  const rows = useQuery({
    queryKey: ['stock', 'rows', params],
    queryFn: () => apiFetch<StockRow[]>(`/stock${params}`),
  });
  const summary = useQuery({
    queryKey: ['stock', 'summary', islandId, siteId],
    queryFn: () => apiFetch<StockSummary>(`/stock/summary${qs({ islandId, siteId })}`),
  });

  if (state.status !== 'authenticated') return null;
  const mod = state.user.modules.find((m) => m.key === 'stock');
  if (!mod) return <Forbidden />;
  const canWrite = mod.access === 'C';
  const scope: ScopeKind = state.user.scope;
  const sites = (allSites.data ?? []).filter((s) => !islandId || s.island.id === islandId);
  const mySites = scope === 'GLOBAL' ? sites : (allSites.data ?? []);
  const s = summary.data;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title="Stock"
          subtitle="Par site : disponible, réservé, coût rendu et alertes"
        />
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="accent" onClick={() => setAction('entry')}>
              Entrée
            </Button>
            <Button variant="outline" onClick={() => setAction('transfer')}>
              Transfert
            </Button>
            <Button variant="outline" onClick={() => setAction('inventory')}>
              Inventaire
            </Button>
            <Button variant="outline" onClick={() => setAction('adjust')}>
              Ajustement
            </Button>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Valeur au coût rendu"
          value={s ? formatKmf(s.value) : '—'}
          hint="Unités physiques × coût des lots"
        />
        <KpiCard
          label="Unités en stock"
          value={s ? s.units : '—'}
          hint={s ? `dont ${s.reserved} réservée(s)` : undefined}
        />
        <KpiCard
          label="Ruptures"
          value={s ? s.alerts.OUT : '—'}
          hint={s ? `${s.alerts.LOW} stock faible` : undefined}
          accent
        />
        <KpiCard
          label="Invendus / écarts"
          value={s ? s.alerts.UNSOLD + s.alerts.INVENTORY_DIFF : '—'}
          hint={
            s ? `${s.alerts.UNSOLD} invendu(s) · ${s.alerts.INVENTORY_DIFF} écart(s)` : undefined
          }
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
          <label htmlFor="stock-q" className="text-sm font-semibold text-ink">
            Recherche
          </label>
          <input
            id="stock-q"
            type="search"
            placeholder="Produit ou SKU"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="min-h-touch rounded-md border border-surface-border bg-white px-3 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="stock-site" className="text-sm font-semibold text-ink">
            Site
          </label>
          <select
            id="stock-site"
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            className="min-h-touch rounded-md border border-surface-border bg-white px-3 text-sm"
          >
            <option value="">Tous les sites</option>
            {sites.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="stock-alert" className="text-sm font-semibold text-ink">
            Alerte
          </label>
          <select
            id="stock-alert"
            value={alert}
            onChange={(e) => setAlert(e.target.value)}
            className="min-h-touch rounded-md border border-surface-border bg-white px-3 text-sm"
          >
            <option value="">Toutes les lignes</option>
            <option value="any">Avec alerte</option>
            <option value="OUT">Rupture</option>
            <option value="LOW">Stock faible</option>
            <option value="UNSOLD">Invendu</option>
          </select>
        </div>
      </div>

      <Table aria-label="Stock par site">
        <THead>
          <TR>
            <TH>SKU</TH>
            <TH>Produit</TH>
            <TH>Leader</TH>
            <TH>Site</TH>
            <TH>Disponible</TH>
            <TH>Réservé</TH>
            <TH>Coût rendu</TH>
            <TH>Prix</TH>
            <TH>Alerte</TH>
          </TR>
        </THead>
        <TBody>
          {rows.data?.map((r) => (
            <TR key={`${r.productId}-${r.site.id}`}>
              <TD className="text-xs text-ink-muted">{r.sku}</TD>
              <TD>
                <button
                  type="button"
                  className="text-left font-semibold text-brand-blue hover:underline"
                  onClick={() => setHistory(r)}
                >
                  {r.productName}
                </button>
              </TD>
              <TD>{r.leader.fullName}</TD>
              <TD className="text-ink-muted">{r.site.name}</TD>
              <TD className="font-semibold">{r.available}</TD>
              <TD>{r.reserved}</TD>
              <TD className="whitespace-nowrap">
                {r.unitCost !== null ? formatKmf(r.unitCost) : '—'}
              </TD>
              <TD className="whitespace-nowrap">{formatKmf(r.salePrice)}</TD>
              <TD>
                <div className="flex flex-wrap gap-1">
                  {r.alerts.map((a) => (
                    <Badge key={a} tone={ALERT_TONE[a]}>
                      {STOCK_ALERT_LABELS[a]}
                    </Badge>
                  ))}
                </div>
              </TD>
            </TR>
          ))}
          {rows.data && !rows.data.length ? (
            <TR>
              <TD colSpan={9} className="py-8 text-center text-ink-muted">
                Aucune ligne de stock.
              </TD>
            </TR>
          ) : null}
        </TBody>
      </Table>

      <Sheet
        open={!!action}
        onOpenChange={(o) => !o && setAction(null)}
        title={action ? ACTION_TITLES[action] : ''}
        description="Chaque mouvement est tracé : qui, quand, pourquoi."
      >
        {action === 'entry' ? (
          <EntryForm
            sites={mySites}
            allSites={allSites.data ?? []}
            onDone={() => setAction(null)}
          />
        ) : null}
        {action === 'transfer' ? (
          <TransferForm
            sites={mySites}
            allSites={allSites.data ?? []}
            onDone={() => setAction(null)}
          />
        ) : null}
        {action === 'adjust' ? (
          <AdjustForm
            sites={mySites}
            allSites={allSites.data ?? []}
            onDone={() => setAction(null)}
          />
        ) : null}
        {action === 'inventory' ? (
          <InventoryPanel
            sites={mySites}
            allSites={allSites.data ?? []}
            onDone={() => setAction(null)}
          />
        ) : null}
      </Sheet>
      <Sheet
        open={!!history}
        onOpenChange={(o) => !o && setHistory(null)}
        title={history?.productName ?? ''}
        description={history ? `${history.leader.fullName} · historique des mouvements` : undefined}
      >
        {history ? <StockHistory productId={history.productId} /> : null}
      </Sheet>
    </>
  );
}
