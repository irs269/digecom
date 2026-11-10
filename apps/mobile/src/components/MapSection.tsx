import type { GeoPoint } from '@digecom/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Button } from '@/components/ui';
import { currentPosition } from '@/lib/location';
import { colors } from '@/theme';

type Target = GeoPoint | string;

const q = (t: Target) =>
  encodeURIComponent(typeof t === 'string' ? t : `${t.latitude},${t.longitude}`);

/** URL de carte intégrable Google Maps (sans clé d'API) : itinéraire si une origine est connue. */
export function embedUrl(dest: Target, origin?: GeoPoint | null): string {
  return origin
    ? `https://maps.google.com/maps?saddr=${q(origin)}&daddr=${q(dest)}&hl=fr&output=embed`
    : `https://maps.google.com/maps?q=${q(dest)}&z=15&hl=fr&output=embed`;
}

/**
 * Carte affichée DANS l'application (WebView + iframe Google Maps).
 * `route` : trace l'itinéraire depuis la position actuelle du téléphone.
 * `externalUrl` : bouton secondaire pour la navigation guidée (application Google Maps).
 */
export function MapSection({
  destination,
  route = false,
  externalUrl,
  testID,
}: {
  destination: Target;
  route?: boolean;
  externalUrl?: string;
  testID?: string;
}): ReactNode {
  const [origin, setOrigin] = useState<GeoPoint | null | undefined>(route ? undefined : null);

  useEffect(() => {
    if (!route) return;
    let alive = true;
    void currentPosition().then((p) => alive && setOrigin(p));
    return () => {
      alive = false;
    };
  }, [route]);

  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%}</style></head>
<body><iframe src="${origin === undefined ? '' : embedUrl(destination, origin)}" allowfullscreen></iframe></body></html>`;

  return (
    <View testID={testID} style={{ marginTop: 10, gap: 6 }}>
      <View
        style={{
          height: 260,
          borderRadius: 12,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.line,
          justifyContent: 'center',
        }}
      >
        {origin === undefined ? (
          <ActivityIndicator color={colors.blue} />
        ) : (
          <WebView
            source={{ html }}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            nestedScrollEnabled
            // Les liens « Agrandir la carte » de Google ouvrent l'application Google Maps.
            onShouldStartLoadWithRequest={(req) => {
              if (
                req.isTopFrame &&
                req.url.startsWith('http') &&
                !req.url.includes('output=embed')
              ) {
                void Linking.openURL(req.url);
                return false;
              }
              return true;
            }}
          />
        )}
      </View>
      {externalUrl ? (
        <Button
          label="Navigation guidée (Google Maps)"
          variant="ghost"
          onPress={() => void Linking.openURL(externalUrl)}
        />
      ) : null}
    </View>
  );
}
