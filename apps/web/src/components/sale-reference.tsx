'use client';

import { formatKmf, type SaleBreakdown, type TciSaleBreakdown } from '@digecom/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';
import { qs } from '@/lib/queries';

interface Breakdown {
  recent: { id: string; number: string; label: string }[];
  order: {
    id: string;
    number: string;
    product: string;
    quantity: number;
    sellerType: string;
    sale: SaleBreakdown | null;
    tci: TciSaleBreakdown | null;
  } | null;
}

/** Encart du tableau de bord : calcul réel d'une vente sélectionnée (SPEC 4.1 / 4.3). */
export function SaleReference() {
  const [orderId, setOrderId] = useState('');
  const data = useQuery({
    queryKey: ['finance', 'sale-breakdown', orderId],
    queryFn: () => apiFetch<Breakdown>(`/finance/sale-breakdown${qs({ orderId })}`),
  });
  const o = data.data?.order;
  const rows: [string, number, boolean?][] = o?.sale
    ? [
        ['Prix de vente final', o.sale.revenue],
        ['Coût d’approvisionnement (lot, FIFO)', -o.sale.cost],
        ['Part brute e-commerçant', o.sale.sellerGross],
        ['Part commerciale Dig’eCom', o.sale.digecomShare],
        ['Marge brute Dig’eCom', o.sale.grossMargin],
        ['Taxe Dig’eCom', -o.sale.digecomTax],
        ['Marge Dig’eCom après coût et taxe', o.sale.marginAfterTax, true],
        ['Taxe e-commerçant', -o.sale.sellerTax],
        ['Net e-commerçant avant abonnement', o.sale.sellerNet, true],
      ]
    : o?.tci
      ? [
          ['Chiffre d’affaires', o.tci.revenue],
          ['Prime téléconseiller', -o.tci.tciBonus],
          ['Coût d’approvisionnement', -o.tci.cost],
          ['Marge avant partage Leader Junior (à définir)', o.tci.marginBeforeLeaderShare, true],
        ]
      : [];
  return (
    <Card className="flex flex-col gap-3" data-testid="sale-reference">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink">Calcul d’une vente de référence</h2>
          <p className="text-xs text-ink-muted">
            Valeurs réelles figées sur la commande (instantanés et coût FIFO)
          </p>
        </div>
        {data.data?.recent.length ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="ref-sale" className="text-xs font-semibold text-ink-muted">
              Vente
            </label>
            <select
              id="ref-sale"
              value={orderId || o?.id || ''}
              onChange={(e) => setOrderId(e.target.value)}
              className="min-h-touch max-w-xs rounded-md border border-surface-border bg-white px-3 text-sm"
            >
              {data.data.recent.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      {o ? (
        <dl className="divide-y divide-surface-border text-sm">
          {rows.map(([label, value, strong]) => (
            <div
              key={label}
              className={`flex justify-between gap-3 py-1.5 ${strong ? 'font-bold' : ''}`}
            >
              <dt className={strong ? 'text-ink' : 'text-ink-muted'}>{label}</dt>
              <dd className="whitespace-nowrap">{formatKmf(value)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-ink-muted">Aucune vente encore.</p>
      )}
    </Card>
  );
}
