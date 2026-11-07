'use client';

import { useRef } from 'react';
import { cn } from '@/lib/utils';

interface TabsProps<T extends string> {
  label: string;
  tabs: { key: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

/** Onglets accessibles (rôle tablist, flèches gauche/droite). */
export function Tabs<T extends string>({ label, tabs, value, onChange }: TabsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (index: number) => {
    const next = (index + tabs.length) % tabs.length;
    onChange(tabs[next]!.key);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex gap-1 overflow-x-auto rounded-lg border border-surface-border bg-white p-1"
    >
      {tabs.map((t, i) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={active}
            aria-controls={`panel-${t.key}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.key)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') move(i + 1);
              if (e.key === 'ArrowLeft') move(i - 1);
            }}
            className={cn(
              'min-h-touch whitespace-nowrap rounded-md px-4 text-sm font-semibold transition-colors',
              active
                ? 'bg-brand-blue text-white'
                : 'text-ink-muted hover:bg-surface hover:text-ink',
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div
      role="tabpanel"
      id={`panel-${id}`}
      aria-labelledby={`tab-${id}`}
      className="flex flex-col gap-4"
    >
      {children}
    </div>
  );
}
