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
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { setOnSynced, startAutoFlush } from '@/lib/offline';
import { persister, queryClient } from '@/lib/query';
import { SessionProvider, useSession } from '@/lib/session';

void SplashScreen.preventAutoHideAsync();

function Root() {
  const { loading, user } = useSession();

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
      if (data?.type === 'DELIVERY_OFFER' || data?.type === 'DELIVERY_ASSIGNED') {
        router.navigate('/livreur');
      }
    });
    return () => {
      received.remove();
      opened.remove();
    };
  }, []);

  useEffect(() => {
    if (!loading) void SplashScreen.hideAsync();
  }, [loading]);

  if (loading) return null;
  return (
    <>
      <StatusBar style={user ? 'dark' : 'light'} />
      <Stack screenOptions={{ headerShown: false }} />
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
          <Root />
        </SessionProvider>
      </PersistQueryClientProvider>
    </SafeAreaProvider>
  );
}
