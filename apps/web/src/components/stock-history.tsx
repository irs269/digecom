'use client';

import {
  formatBusinessDateTime,
  formatKmf,
  STOCK_MOVEMENT_LABELS,
  type StockMovementType,
  type StockMovementView,
} from '@digecom/shared';
import { useQuery } from '@tanstack/react-query';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { apiFetch } from '@/lib/api';

const SIGN: Partial<Record<StockMovementType, '+' | '−'>> = {
  ENTRY: '+',
  RETURN: '+',
  TRANSFER_IN: '+',
  RELEASE: '+',
  OUT: '−',
  DAMAGED: '−',
  LOSS: '−',
  TRANSFER_OUT: '−',
  RESERVE: '−',
};

/** Historique des mouvements d'un produit (qui, quand, pourquoi). */
export function StockHistory({ productId }: { productId: string }) {
  const history = useQuery({
    queryKey: ['stock-movements', productId],
    queryFn: () => apiFetch<StockMovementView[]>(`/stock/movements?productId=${productId}`),
  });
  if (!history.data) return <p className="text-sm text-ink-muted">Chargement…</p>;
  if (!history.data.length) return <p className="text-sm text-ink-muted">Aucun mouvement.</p>;
  return (
    <Table aria-label="Historique des mouvements">
      <THead>
        <TR>
          <TH>Date</TH>
          <TH>Mouvement</TH>
          <TH>Qté</TH>
          <TH>Site / lot</TH>
          <TH>Par</TH>
        </TR>
      </THead>
      <TBody>
        {history.data.map((m) => (
          <TR key={m.id}>
            <TD className="whitespace-nowrap text-xs text-ink-muted">
              {formatBusinessDateTime(m.at)}
            </TD>
            <TD>
              <div className="font-semibold">{STOCK_MOVEMENT_LABELS[m.type]}</div>
              {m.reason ? <div className="text-xs text-ink-muted">{m.reason}</div> : null}
            </TD>
            <TD className="whitespace-nowrap font-semibold">
              {m.type === 'ADJUST' || m.type === 'INVENTORY_DIFF' ? '±' : (SIGN[m.type] ?? '')}
              {m.quantity}
            </TD>
            <TD className="text-xs text-ink-muted">
              {m.site.name}
              {m.lot ? ` · ${m.lot.number}` : ''}
              {m.unitCost !== null ? ` · ${formatKmf(m.unitCost)}` : ''}
            </TD>
            <TD className="text-xs text-ink-muted">{m.by.fullName}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
