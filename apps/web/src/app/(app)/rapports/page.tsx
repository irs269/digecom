'use client';

import {
  addDays,
  businessToday,
  formatBusinessDate,
  formatKmf,
  ROLE_SCOPE,
  type ReportColumn,
  type ReportDefinition,
  type ReportJobAccepted,
  type ReportType,
  type ReportView,
} from '@digecom/shared';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { PageHeader, useIslandFilter } from '@/components/app-shell';
import { Forbidden } from '@/components/forbidden';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/input';
import { SelectField } from '@/components/ui/select';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { apiDownload, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorMessage, qs, useIslands, useSites } from '@/lib/queries';
import { cn } from '@/lib/utils';

type Listed = ReportDefinition & { type: ReportType };

const numeric = (c: ReportColumn) => c.kind !== 'text' && c.kind !== 'date';

function cell(c: ReportColumn, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (c.kind === 'kmf') return formatKmf(Number(v));
  if (c.kind === 'int') return Number(v).toLocaleString('fr-FR');
  if (c.kind === 'pct') return `${String(v).replace('.', ',')} %`;
  if (c.kind === 'date' && typeof v === 'string') return formatBusinessDate(v);
  return String(v);
}

function ReportsInner() {
  const { state } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const island = useIslandFilter();
  const islands = useIslands();
  const sites = useSites();
  const today = businessToday();
  const type = (params.get('type') as ReportType | null) ?? null;
  const [from, setFrom] = useState(params.get('from') ?? addDays(today, -29));
  const [to, setTo] = useState(params.get('to') ?? today);
  const [siteId, setSiteId] = useState('');
  const [leaderId, setLeaderId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const islandId = island === 'all' ? undefined : islands.data?.find((i) => i.code === island)?.id;

  const list = useQuery({ queryKey: ['reports'], queryFn: () => apiFetch<Listed[]>('/reports') });
  const global = state.status === 'authenticated' && ROLE_SCOPE[state.user.role] === 'GLOBAL';
  const leaders = useQuery({
    queryKey: ['leaders', 'all'],
    enabled: global,
    queryFn: () => apiFetch<{ id: string; fullName: string }[]>('/reports/meta/leaders'),
  });
  const query = qs({
    from,
    to,
    islandId: global ? islandId : undefined,
    siteId: global ? siteId : undefined,
    leaderId: global ? leaderId : undefined,
  });
  const report = useQuery({
    queryKey: ['report', type, query],
    enabled: !!type,
    queryFn: () => apiFetch<ReportView>(`/reports/${type}${query}`),
  });

  if (state.status !== 'authenticated') return null;
  if (!state.user.modules.some((m) => m.key === 'reports')) return <Forbidden />;

  const download = async (format: 'xlsx' | 'pdf') => {
    if (!type) return;
    setBusy(format);
    try {
      const r = await apiDownload<ReportJobAccepted>(
        `/reports/${type}${query}&format=${format}`,
        `rapport-${type}.${format}`,
      );
      toast(r ? r.message : `Export ${format.toUpperCase()} téléchargé`, 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };
  const r = report.data;
  const select = (t: ReportType) =>
    router.replace(`/rapports${qs({ type: t, from, to })}`, { scroll: false });

  return (
    <>
      <PageHeader
        title="Rapports"
        subtitle={
          global
            ? 'Rapports de la plateforme, exportables en Excel et en PDF'
            : 'Rapports de ton équipe, exportables en Excel et en PDF'
        }
      />
      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Rapports disponibles"
      >
        {(list.data ?? []).map((d) => (
          <button
            key={d.type}
            type="button"
            onClick={() => select(d.type)}
            aria-pressed={type === d.type}
            className={cn(
              'flex min-h-touch flex-col items-start gap-1 rounded-lg border border-surface-border bg-white p-3 text-left transition hover:border-brand-blue',
              type === d.type && 'border-brand-blue ring-2 ring-brand-blue/30',
            )}
          >
            <span className="text-sm font-bold text-ink">{d.label}</span>
            <span className="text-xs text-ink-muted">{d.description}</span>
          </button>
        ))}
      </div>

      {type ? (
        <Card className="flex flex-col gap-4">
          <form
            className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-5"
            aria-label="Filtres du rapport"
            onSubmit={(e) => e.preventDefault()}
          >
            <Field label="Du" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Field label="Au" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            {global ? (
              <SelectField
                label="Site"
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                placeholder="Tous les sites"
                options={(sites.data ?? [])
                  .filter((s) => !islandId || s.island.id === islandId)
                  .map((s) => ({ value: s.id, label: s.name }))}
              />
            ) : null}
            {global ? (
              <SelectField
                label="Leader"
                value={leaderId}
                onChange={(e) => setLeaderId(e.target.value)}
                placeholder="Tous les leaders"
                options={(leaders.data ?? []).map((l) => ({ value: l.id, label: l.fullName }))}
              />
            ) : null}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!!busy || !r}
                onClick={() => void download('xlsx')}
              >
                Excel
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!!busy || !r}
                onClick={() => void download('pdf')}
              >
                PDF
              </Button>
            </div>
          </form>
          {report.isError ? (
            <p className="text-sm text-status-red-fg">{errorMessage(report.error)}</p>
          ) : null}
          {r ? (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-base font-bold text-ink">{r.title}</h2>
                <span className="text-xs text-ink-muted">
                  {r.params
                    .filter((p) => p.label !== 'Rapport')
                    .map((p) => `${p.label} : ${p.value}`)
                    .join(' · ')}
                </span>
              </div>
              <Table aria-label={r.title}>
                <THead>
                  <TR>
                    {r.columns.map((c) => (
                      <TH key={c.key} className={numeric(c) ? 'text-right' : undefined}>
                        {c.label}
                      </TH>
                    ))}
                  </TR>
                </THead>
                <TBody>
                  {r.rows.map((row, i) => (
                    <TR key={i}>
                      {r.columns.map((c) => (
                        <TD
                          key={c.key}
                          className={cn(numeric(c) && 'whitespace-nowrap text-right')}
                        >
                          {cell(c, row[c.key])}
                        </TD>
                      ))}
                    </TR>
                  ))}
                  {!r.rows.length ? (
                    <TR>
                      <TD colSpan={r.columns.length} className="py-8 text-center text-ink-muted">
                        Aucune donnée sur la période.
                      </TD>
                    </TR>
                  ) : null}
                  {r.columns.some((c) => c.total) && r.rows.length ? (
                    <TR data-testid="report-totals" className="bg-status-orange-bg font-bold">
                      {r.columns.map((c, i) => (
                        <TD
                          key={c.key}
                          className={cn(numeric(c) && 'whitespace-nowrap text-right')}
                        >
                          {i === 0 ? 'Total' : c.total ? cell(c, r.totals[c.key] ?? 0) : ''}
                        </TD>
                      ))}
                    </TR>
                  ) : null}
                </TBody>
              </Table>
            </>
          ) : report.isLoading ? (
            <p className="text-sm text-ink-muted">Calcul du rapport…</p>
          ) : null}
        </Card>
      ) : (
        <Card>
          <p className="text-sm text-ink-muted">
            Choisis un rapport pour l’afficher et l’exporter.
          </p>
        </Card>
      )}
    </>
  );
}

export default function ReportsPage() {
  return (
    <Suspense>
      <ReportsInner />
    </Suspense>
  );
}
