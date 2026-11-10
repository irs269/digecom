import { DELIVERY_MODE_LABELS, formatDistance, distanceKm, type MeResponse } from '@digecom/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { PendingBanner } from '@/components/pending';
import { Badge, Card, Empty, Notice, Screen, T } from '@/components/ui';
import { api, ApiError, updateUser } from '@/lib/api';
import { useRuns } from '@/lib/hooks';
import { currentPosition, reportLocation } from '@/lib/location';
import { useSession } from '@/lib/session';
import { colors } from '@/theme';

/**
 * Accueil du livreur. Plus d'offre « premier qui accepte » : la logistique de l'île affecte les
 * courses au livreur disponible le plus proche du site, grâce à la position partagée ici.
 */
export default function Courses() {
  const { user, logout } = useSession();
  const available = user?.isAvailable ?? false;
  const runs = useRuns();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'red' | 'orange' | 'green'; text: string } | null>(
    null,
  );
  const [here, setHere] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationOff, setLocationOff] = useState(false);

  useEffect(() => {
    void currentPosition().then((p) => {
      setHere(p);
      setLocationOff(!p);
    });
  }, []);

  const toggle = async (next: boolean) => {
    if (!user) return;
    setBusy(true);
    setMessage(null);
    try {
      await api('/courier/availability', { method: 'PATCH', body: { isAvailable: next } });
      updateUser({ ...user, isAvailable: next } as MeResponse);
      // Position fraîche dès qu'on se déclare disponible : elle sert au classement par distance.
      if (next) void reportLocation(0);
    } catch (err) {
      setMessage({
        tone: 'red',
        text:
          err instanceof ApiError && err.isNetwork
            ? 'Pas de réseau : réessaie.'
            : (err as Error).message,
      });
    } finally {
      setBusy(false);
    }
  };

  const list = runs.data ?? [];

  return (
    <Screen
      onRefresh={() => {
        void runs.refetch();
        void reportLocation(0);
      }}
      refreshing={runs.isRefetching}
    >
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}
      >
        <View style={{ flex: 1 }}>
          <T weight="bold" style={{ fontSize: 22 }}>
            {user?.fullName}
          </T>
          <T style={{ color: colors.muted }}>Livreur · {user?.island?.name}</T>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 10 }}>
          <Pressable
            onPress={() => router.push('/appels')}
            accessibilityRole="button"
            testID="ouvrir-appels"
          >
            <T weight="semibold" style={{ color: colors.blue, fontSize: 14 }}>
              📞 Appels
            </T>
          </Pressable>
          <Pressable onPress={() => void logout()} accessibilityRole="button">
            <T style={{ color: colors.blue, fontSize: 13 }}>Déconnexion</T>
          </Pressable>
        </View>
      </View>

      <Card
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 14,
          backgroundColor: available ? colors.greenSoft : colors.white,
        }}
      >
        <View style={{ flex: 1 }}>
          <T
            weight="semibold"
            style={{ fontSize: 16, color: available ? colors.green : colors.muted }}
          >
            {available ? 'Disponible' : 'Indisponible'}
          </T>
          <T style={{ color: colors.muted, fontSize: 12 }}>
            {available
              ? 'La logistique peut t’affecter une course.'
              : 'Aucune course ne te sera affectée.'}
          </T>
        </View>
        <Switch
          testID="disponible"
          value={available}
          disabled={busy}
          onValueChange={(v) => void toggle(v)}
          trackColor={{ true: colors.green, false: colors.line }}
        />
      </Card>

      {locationOff ? (
        <Notice tone="orange">
          Position non partagée : autorise la localisation pour que la logistique te propose les
          courses proches de toi et pour obtenir les itinéraires.
        </Notice>
      ) : null}
      <PendingBanner />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      <T weight="semibold" style={{ fontSize: 17, marginVertical: 8 }}>
        Mes courses
      </T>
      {list.length === 0 ? (
        <Empty
          title={available ? 'Aucune course pour le moment' : 'Tu es indisponible'}
          text={
            available
              ? 'Une notification arrive dès que la logistique t’affecte une course.'
              : 'Repasse en disponible quand tu es prêt.'
          }
        />
      ) : (
        list.map((r) => {
          const site =
            r.site.latitude !== null && r.site.longitude !== null
              ? { latitude: r.site.latitude, longitude: r.site.longitude }
              : null;
          const toSite = here && site && r.status === 'ASSIGNED' ? distanceKm(here, site) : null;
          const toSeller =
            here && r.sellerLocation && r.status !== 'ASSIGNED'
              ? distanceKm(here, r.sellerLocation)
              : null;
          return (
            <Pressable
              key={r.id}
              onPress={() => router.push(`/livreur/course/${r.id}`)}
              testID={`course-${r.number}`}
            >
              <Card style={{ borderLeftWidth: 4, borderLeftColor: colors.blue }}>
                <T style={{ color: colors.muted, fontSize: 12 }}>#{r.number}</T>
                <T weight="semibold">{r.items.map((i) => i.product.name).join(', ')}</T>
                <T style={{ color: colors.muted, fontSize: 13, marginBottom: 6 }}>
                  {DELIVERY_MODE_LABELS[r.deliveryMode]} · retrait à {r.site.name}
                </T>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Badge status={r.status} />
                  {toSite !== null ? (
                    <T style={{ fontSize: 12, color: colors.muted }}>
                      Site à {formatDistance(toSite)}
                    </T>
                  ) : null}
                  {toSeller !== null ? (
                    <T style={{ fontSize: 12, color: colors.muted }}>
                      E-commerçant à {formatDistance(toSeller)}
                    </T>
                  ) : null}
                </View>
              </Card>
            </Pressable>
          );
        })
      )}
    </Screen>
  );
}
