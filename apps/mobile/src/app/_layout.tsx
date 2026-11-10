import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  useFonts,
} from '@expo-google-fonts/poppins';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import * as Notifications from 'expo-notifications';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CallScreen } from '@/components/CallScreen';
import { CallProvider, useCalls } from '@/lib/calls/CallProvider';
import { startLive, stopLive, wakeLive } from '@/lib/live';
import { reportLocation } from '@/lib/location';
import { setOnSynced, startAutoFlush } from '@/lib/offline';
import { persister, queryClient } from '@/lib/query';
import { SessionProvider, useSession } from '@/lib/session';

void SplashScreen.preventAutoHideAsync();

function Root() {
  const { loading, user } = useSession();
  const { checkRinging } = useCalls();

  // Flux temps réel (appels, statuts) ouvert tant qu'un compte est connecté.
  useEffect(() => {
    if (!user) return;
    startLive();
    void checkRinging();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        wakeLive();
        void checkRinging();
      }
    });
    return () => {
      sub.remove();
      stopLive();
    };
  }, [user?.id]);

  // Position : livreur toutes les 2 min tant que l'application est ouverte (classement par
  // distance au site) ; e-commerçant à l'ouverture (itinéraire du livreur jusqu'à lui).
  useEffect(() => {
    if (!user || (user.role !== 'COURIER' && user.role !== 'SELLER')) return;
    void reportLocation(0);
    const timer =
      user.role === 'COURIER' ? setInterval(() => void reportLocation(), 2 * 60_000) : null;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void reportLocation();
    });
    return () => {
      if (timer) clearInterval(timer);
      sub.remove();
    };
  }, [user?.id, user?.role]);

  useEffect(() => {
    setOnSynced(() => void queryClient.invalidateQueries());
    return startAutoFlush();
  }, []);

  // Une notification (offre de course, commande…) rafraîchit les données et ouvre l'écran lié.
  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener(() => {
      void queryClient.invalidateQueries();
    });
    const opened = Notifications.addNotificationResponseReceivedListener((r) => {
      const data = r.notification.request.content.data as { type?: string } | undefined;
      void queryClient.invalidateQueries();
      // Appel entrant touché depuis la notification : l'écran d'appel s'ouvre s'il sonne encore.
      if (data?.type === 'CALL_INCOMING') void checkRinging();
      if (data?.type === 'DELIVERY_OFFER' || data?.type === 'DELIVERY_ASSIGNED') {
        router.navigate('/livreur');
      }
    });
    return () => {
      received.remove();
      opened.remove();
    };
  }, [checkRinging]);

  useEffect(() => {
    if (!loading) void SplashScreen.hideAsync();
  }, [loading]);

  if (loading) return null;
  return (
    <>
      <StatusBar style={user ? 'dark' : 'light'} />
      <Stack screenOptions={{ headerShown: false }} />
      <CallScreen />
    </>
  );
}

export default function Layout() {
  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });
  if (!fontsLoaded) return null;
  return (
    <SafeAreaProvider>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister, maxAge: 24 * 3600_000 }}
      >
        <SessionProvider>
          <CallProvider>
            <Root />
          </CallProvider>
        </SessionProvider>
      </PersistQueryClientProvider>
    </SafeAreaProvider>
  );
}
