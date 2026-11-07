'use client';

import {
  businessToday,
  formatBusinessDate,
  formatBusinessDateTime,
  formatSettingValue,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  SETTING_GROUPS,
  type AmountRule,
  type SettingVersion,
  type SettingView,
} from '@digecom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { Forbidden } from '@/components/forbidden';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { errorMessage, fieldErrors } from '@/lib/queries';

function ValueEditor({
  setting,
  value,
  onChange,
  id,
}: {
  setting: SettingView;
  value: unknown;
  onChange: (v: unknown) => void;
  id: string;
}) {
  const inputCls = 'max-w-[220px]';
  switch (setting.input) {
    case 'amountRule': {
      const rule = value as AmountRule;
      return (
        <div className="flex flex-wrap gap-2">
          <select
            aria-label={`${setting.label} : type`}
            value={rule.mode}
            onChange={(e) => onChange({ ...rule, mode: e.target.value })}
            className="min-h-touch rounded-md border border-surface-border bg-white px-3 text-sm"
          >
            <option value="FIXED">Montant fixe (KMF)</option>
            <option value="PERCENT">Pourcentage (%)</option>
          </select>
          <Input
            id={id}
            className={inputCls}
            type="number"
            inputMode="numeric"
            min={0}
            step={rule.mode === 'PERCENT' ? 0.5 : 1}
            value={String(rule.value)}
            onChange={(e) => onChange({ ...rule, value: Number(e.target.value) })}
          />
        </div>
      );
    }
    case 'kmf':
    case 'integer':
      return (
        <Input
          id={id}
          className={inputCls}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={String(value)}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
      );
    case 'date':
      return (
        <Input
          id={id}
          className={inputCls}
          type="date"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'boolean':
      return (
        <select
          id={id}
          value={value ? 'true' : 'false'}
          onChange={(e) => onChange(e.target.value === 'true')}
          className="min-h-touch max-w-[220px] rounded-md border border-surface-border bg-white px-3 text-sm"
        >
          <option value="false">Non</option>
          <option value="true">Oui</option>
        </select>
      );
    case 'paymentMethods': {
      const list = value as string[];
      return (
        <fieldset className="flex flex-wrap gap-3" id={id}>
          <legend className="sr-only">{setting.label}</legend>
          {PAYMENT_METHODS.map((m) => (
            <label key={m} className="flex min-h-touch items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-5 w-5 accent-brand-blue"
                checked={list.includes(m)}
                onChange={(e) =>
                  onChange(e.target.checked ? [...list, m] : list.filter((x) => x !== m))
                }
              />
              {PAYMENT_METHOD_LABELS[m]}
            </label>
          ))}
        </fieldset>
      );
    }
  }
}

function Versions({ setting, versions }: { setting: SettingView; versions: SettingVersion[] }) {
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {versions.map((v) => (
        <li key={v.id} className="flex flex-wrap gap-x-2 text-ink-muted">
          <span className="font-semibold text-ink">{formatSettingValue(setting.key, v.value)}</span>
          <span>à partir du {formatBusinessDate(v.effectiveFrom)}</span>
          <span>
            · saisi le {formatBusinessDateTime(v.createdAt)}
            {v.by ? ` par ${v.by.fullName}` : ' (valeur initiale)'}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SettingRow({ setting, canEdit }: { setting: SettingView; canEdit: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const id = useId();
  const [value, setValue] = useState<unknown>(setting.current);
  const [effectiveFrom, setEffectiveFrom] = useState(businessToday());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const changed = JSON.stringify(value) !== JSON.stringify(setting.current);

  const save = useMutation({
    mutationFn: () =>
      apiFetch<SettingVersion>(`/settings/${setting.key}`, {
        method: 'POST',
        body: JSON.stringify({ value, effectiveFrom }),
      }),
    onSuccess: (v) => {
      setErrors({});
      toast(
        `${setting.label} : ${formatSettingValue(setting.key, v.value)} à partir du ${formatBusinessDate(v.effectiveFrom)}`,
        'success',
      );
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) => {
      setErrors(fieldErrors(err));
      toast(errorMessage(err), 'error');
    },
  });

  return (
    <div
      className="flex flex-col gap-3 border-b border-surface-border py-4 last:border-0"
      data-setting={setting.key}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col">
          <label htmlFor={id} className="text-sm font-bold text-ink">
            {setting.label}
          </label>
          <span className="text-xs text-ink-muted">{setting.help}</span>
        </div>
        <div className="flex flex-col items-end">
          <span
            className="text-base font-extrabold text-ink"
            data-testid={`current-${setting.key}`}
          >
            {formatSettingValue(setting.key, setting.current)}
          </span>
          {setting.currentEffectiveFrom ? (
            <span className="text-xs text-ink-muted">
              depuis le {formatBusinessDate(setting.currentEffectiveFrom)}
            </span>
          ) : null}
        </div>
      </div>

      {setting.upcoming.length ? (
        <div className="flex flex-col gap-1 rounded-md bg-status-orange-bg px-3 py-2">
          <span className="text-xs font-bold text-status-orange-fg">Prévu</span>
          <Versions setting={setting} versions={[...setting.upcoming].reverse()} />
        </div>
      ) : null}

      {canEdit ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-ink-muted">Nouvelle valeur</span>
            <ValueEditor setting={setting} value={value} onChange={setValue} id={id} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-from`} className="text-xs font-semibold text-ink-muted">
              Date d’effet
            </label>
            <Input
              id={`${id}-from`}
              type="date"
              min={businessToday()}
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              className="max-w-[180px]"
            />
          </div>
          <Button
            variant="primary"
            disabled={!changed || save.isPending}
            onClick={() => save.mutate()}
            aria-label={`Enregistrer ${setting.label}`}
          >
            {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      ) : null}
      {errors.value || errors.effectiveFrom ? (
        <span role="alert" className="text-xs font-medium text-status-red-fg">
          {errors.value ?? errors.effectiveFrom}
        </span>
      ) : null}

      {setting.history.length > 1 ? (
        <details className="text-sm">
          <summary className="min-h-touch cursor-pointer py-2 font-semibold text-brand-blue">
            Historique ({setting.history.length} versions)
          </summary>
          <Versions setting={setting} versions={setting.history} />
        </details>
      ) : null}
    </div>
  );
}

export default function SettingsPage() {
  const { state } = useAuth();
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<SettingView[]>('/settings'),
  });
  if (state.status !== 'authenticated') return null;
  const mod = state.user.modules.find((m) => m.key === 'settings');
  if (!mod) return <Forbidden />;
  const canEdit = mod.access === 'C';

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <PageHeader
          title="Paramètres"
          subtitle="Chaque changement a une date d’effet : les ventes passées ne sont jamais recalculées."
        />
        {!canEdit ? <Badge tone="orange">Lecture seule</Badge> : null}
      </div>
      {settings.data ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {SETTING_GROUPS.map((group) => {
            const items = settings.data.filter((s) => s.group === group);
            if (!items.length) return null;
            return (
              <Card key={group} className="flex flex-col">
                <h2 className="text-lg font-bold text-ink">{group}</h2>
                {items.map((s) => (
                  <SettingRow
                    key={`${s.key}-${s.currentEffectiveFrom}-${s.upcoming.length}`}
                    setting={s}
                    canEdit={canEdit}
                  />
                ))}
              </Card>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-ink-muted" role="status">
          Chargement…
        </p>
      )}
    </>
  );
}
