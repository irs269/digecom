import { useEffect, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { Button, Notice, T } from '@/components/ui';
import { isStandalone, registerWebPush, webPushSupported } from '@/lib/push';

const isIos = () =>
  Platform.OS === 'web' &&
  (/iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/**
 * PWA (web uniquement) :
 * - iPhone dans Safari : comment installer l'application sur l'écran d'accueil ;
 * - application installée : bouton pour activer les notifications (geste requis sur iPhone).
 */
export function PwaBanner(): ReactNode {
  const [state, setState] = useState<'hidden' | 'install' | 'notify' | 'denied'>('hidden');

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (isIos() && !isStandalone()) return setState('install');
    if (!webPushSupported()) return;
    if (Notification.permission === 'granted') void registerWebPush();
    else setState(Notification.permission === 'denied' ? 'denied' : 'notify');
  }, []);

  if (state === 'install') {
    return (
      <Notice tone="blue">
        Installe Dig&apos;eCom sur ton iPhone : touche <T weight="bold">Partager</T> (carré avec une
        flèche ↑) en bas de Safari, puis <T weight="bold">« Sur l&apos;écran d&apos;accueil »</T>.
        Ouvre ensuite l&apos;application depuis son icône pour recevoir les notifications.
      </Notice>
    );
  }
  if (state === 'notify') {
    return (
      <Button
        testID="activer-notifications"
        label="🔔 Activer les notifications"
        variant="outline"
        onPress={() => void registerWebPush(true).then((ok) => setState(ok ? 'hidden' : 'denied'))}
      />
    );
  }
  if (state === 'denied') {
    return (
      <Notice tone="orange">
        Notifications bloquées : autorise-les dans Réglages → Notifications → Dig&apos;eCom.
      </Notice>
    );
  }
  return null;
}
