'use client';

import { formatBusinessDateTime, type NotificationView } from '@digecom/shared';
import * as Popover from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Cloche de l'en-tête : nombre de non lues, liste, lien vers l'objet. */
export function NotificationBell() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const data = useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiFetch<{ items: NotificationView[]; unread: number }>('/notifications'),
    refetchInterval: 120_000,
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const read = useMutation({
    mutationFn: (id: string) => apiFetch(`/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: refresh,
  });
  const readAll = useMutation({
    mutationFn: () => apiFetch('/notifications/read-all', { method: 'POST' }),
    onSuccess: refresh,
  });
  const unread = data.data?.unread ?? 0;

  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={unread ? `Notifications : ${unread} non lue(s)` : 'Notifications'}
        className="relative flex min-h-touch min-w-touch items-center justify-center rounded-md border border-surface-border bg-white text-ink hover:bg-surface"
        data-testid="notification-bell"
      >
        <svg
          aria-hidden="true"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread ? (
          <span
            className="absolute -right-1 -top-1 min-w-[20px] rounded-full bg-brand-orange px-1 text-center text-xs font-bold text-brand-on-orange"
            data-testid="unread-count"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Overlay className="fixed inset-0 z-40" />
        <Popover.Content className="fixed right-4 top-16 z-50 flex max-h-[70vh] w-[min(380px,calc(100%-32px))] flex-col rounded-xl border border-surface-border bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-surface-border px-4 py-3">
            <Popover.Title className="text-base font-bold text-ink">Notifications</Popover.Title>
            <Popover.Description className="sr-only">Dernières notifications</Popover.Description>
            {unread ? (
              <button
                type="button"
                className="min-h-touch text-sm font-semibold text-brand-blue"
                onClick={() => readAll.mutate()}
              >
                Tout marquer comme lu
              </button>
            ) : null}
            <Popover.Close asChild>
              <Link
                href="/preferences"
                className="min-h-touch content-center text-sm text-ink-muted underline"
              >
                Préférences
              </Link>
            </Popover.Close>
          </div>
          <ul
            className="flex-1 divide-y divide-surface-border overflow-y-auto"
            aria-label="Liste des notifications"
          >
            {data.data?.items.length ? (
              data.data.items.map((n) => (
                <li key={n.id}>
                  <Popover.Close asChild>
                    <button
                      type="button"
                      className={cn(
                        'flex w-full flex-col gap-0.5 px-4 py-3 text-left hover:bg-surface',
                        !n.readAt && 'bg-status-blue-bg/40',
                      )}
                      onClick={() => {
                        if (!n.readAt) read.mutate(n.id);
                        if (n.link?.startsWith('/api/')) {
                          // Export généré en tâche de fond : lien signé temporaire.
                          void apiFetch<{ url: string }>(n.link.slice(4)).then((r) => {
                            window.location.href = r.url;
                          });
                        } else if (n.link) router.push(n.link);
                      }}
                    >
                      <span className="text-sm font-semibold text-ink">{n.title}</span>
                      <span className="text-xs text-ink-muted">{n.body}</span>
                      <span className="text-[11px] text-ink-muted">
                        {formatBusinessDateTime(n.createdAt)}
                      </span>
                    </button>
                  </Popover.Close>
                </li>
              ))
            ) : (
              <li className="px-4 py-6 text-center text-sm text-ink-muted">Aucune notification.</li>
            )}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
