import { formatKmf, type SettlementView } from '@digecom/shared';
import { View } from 'react-native';
import { Card, Empty, Loading, Row, Screen, T, Title } from '@/components/ui';
import { useBalance } from '@/lib/hooks';
import { colors, toneColors } from '@/theme';

const STATUS: Record<SettlementView['status'], { label: string; tone: keyof typeof toneColors }> = {
  GENERATED: { label: 'En vérification', tone: 'orange' },
  VERIFIED: { label: 'Vérifié', tone: 'blue' },
  APPROVED: { label: 'Validé', tone: 'blue' },
  PAID: { label: 'Payé', tone: 'green' },
};

const day = (d: string) =>
  new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
  });
const period = (s: { periodStart: string; periodEnd: string }) =>
  `${day(s.periodStart)} – ${day(s.periodEnd)}`;

function StatusPill({ status }: { status: SettlementView['status'] }) {
  const st = STATUS[status] ?? { label: status, tone: 'blue' as const };
  const c = toneColors[st.tone];
  return (
    <View
      style={{
        backgroundColor: c.bg,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 3,
      }}
    >
      <T weight="medium" style={{ color: c.fg, fontSize: 12 }}>
        {st.label}
      </T>
    </View>
  );
}

export default function Solde() {
  const q = useBalance();
  const b = q.data;
  const [last, ...previous] = b?.statements ?? [];

  return (
    <Screen onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <Title>Mon solde</Title>
      {q.isLoading ? <Loading /> : null}

      {last ? (
        <Card>
          <View
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <T style={{ color: colors.muted }}>Dernier relevé · {period(last)}</T>
            <StatusPill status={last.status} />
          </View>
          <T weight="bold" style={{ fontSize: 28, marginVertical: 6 }}>
            {formatKmf(last.netToPay)}
          </T>
          <T weight="semibold" style={{ marginTop: 6 }}>
            Détail du relevé
          </T>
          <Row label={`${last.salesCount} ventes`} value={formatKmf(last.grossCommission)} />
          <Row label="Taxes" value={`− ${formatKmf(last.taxes)}`} />
          <Row label="Abonnement" value={`− ${formatKmf(last.subscriptions)}`} />
          <Row label="Autres retenues" value={formatKmf(last.otherDeductions)} />
          {last.carriedOver ? (
            <Row label="Report du cycle précédent" value={formatKmf(last.carriedOver)} />
          ) : null}
          <Row label="Net à recevoir" value={formatKmf(last.netToPay)} strong />
        </Card>
      ) : b ? (
        <Empty
          title="Aucun relevé pour l’instant"
          text="Ton premier relevé arrive à la fin du cycle."
        />
      ) : null}

      {b ? (
        <Card>
          <T weight="semibold">
            Cycle en cours · {day(b.cycle.start)} – {day(b.cycle.end)}
          </T>
          <Row label="Ventes validées" value={String(b.current.salesCount)} />
          <Row label="Commissions" value={formatKmf(b.current.commission)} />
          <Row label="Taxes" value={`− ${formatKmf(b.current.taxes)}`} />
          <Row label="Abonnement" value={`− ${formatKmf(b.current.subscriptions)}`} />
          <Row
            label="Net estimé après abonnement"
            value={formatKmf(b.current.estimatedNet)}
            strong
          />
        </Card>
      ) : null}

      {previous.length ? (
        <Card>
          <T weight="semibold" style={{ marginBottom: 6 }}>
            Règlements précédents
          </T>
          {previous.map((s) => (
            <View
              key={s.id}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                paddingVertical: 8,
              }}
            >
              <T style={{ color: colors.muted, flex: 1 }}>{period(s)}</T>
              <T weight="semibold" style={{ marginRight: 8 }}>
                {formatKmf(s.netToPay)}
              </T>
              <StatusPill status={s.status} />
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
