import type { ReactNode } from 'react';
import { Linking } from 'react-native';
import { WebView } from 'react-native-webview';

/** Android : carte Google Maps dans une WebView. */
export function MapFrame({ html }: { html: string; src: string }): ReactNode {
  return (
    <WebView
      source={{ html }}
      originWhitelist={['*']}
      javaScriptEnabled
      domStorageEnabled
      nestedScrollEnabled
      // Les liens « Agrandir la carte » de Google ouvrent l'application Google Maps.
      onShouldStartLoadWithRequest={(req) => {
        if (req.isTopFrame && req.url.startsWith('http') && !req.url.includes('output=embed')) {
          void Linking.openURL(req.url);
          return false;
        }
        return true;
      }}
    />
  );
}
