'use client';

import {
  channelEnabled,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  type NotificationChannelKey,
  type NotificationPreferences,
} from '@digecom/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/app-shell';
import { Card } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api';
import { errorMessage } from '@/lib/queries';

const CHANNEL_LABELS: Record<NotificationChannelKey, string> = {
  push: 'Push mobile',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
};

/** Préférences de notification : l'in-app reste toujours actif, les autres canaux par type. */
export default function PreferencesPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const prefs = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => apiFetch<NotificationPreferences>('/notifications/preferences'),
  });
  const save = useMutation({
    mutationFn: (next: NotificationPreferences) =>
      apiFetch<NotificationPreferences>('/notifications/preferences', {
        method: 'PUT',
        body: JSON.stringify(next),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['notification-preferences'], data);
      toast('Préférences enregistrées', 'success');
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  const current = prefs.data ?? {};
  const toggle = (type: string, channel: NotificationChannelKey) =>
    save.mutate({
      ...current,
      [type]: { ...current[type], [channel]: !channelEnabled(current, type, channel) },
    });

  return (
    <>
      <PageHeader
        title="Préférences de notification"
        subtitle="Les notifications dans l’application sont toujours actives"
      />
      <Card>
        <Table aria-label="Préférences de notification">
          <THead>
            <TR>
              <TH>Événement</TH>
              <TH>Application</TH>
              {NOTIFICATION_CHANNELS.map((c) => (
                <TH key={c}>{CHANNEL_LABELS[c]}</TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {Object.entries(NOTIFICATION_TYPES).map(([type, label]) => (
              <TR key={type}>
                <TD>{label}</TD>
                <TD>
                  <input
                    type="checkbox"
                    checked
                    disabled
                    aria-label={`${label} : application (toujours active)`}
                  />
                </TD>
                {NOTIFICATION_CHANNELS.map((c) => (
                  <TD key={c}>
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      checked={channelEnabled(current, type, c)}
                      disabled={!prefs.data || save.isPending}
                      onChange={() => toggle(type, c)}
                      aria-label={`${label} : ${CHANNEL_LABELS[c]}`}
                    />
                  </TD>
                ))}
              </TR>
            ))}
          </TBody>
        </Table>
        <p className="mt-3 text-xs text-ink-muted">
          Le push mobile arrive avec l’application mobile (phase 8) ; SMS et WhatsApp viendront plus
          tard. Tes choix sont déjà enregistrés.
        </p>
      </Card>
    </>
  );
}
