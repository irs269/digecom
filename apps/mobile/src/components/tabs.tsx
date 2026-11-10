import { Tabs } from 'expo-router';
import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts } from '@/theme';

export interface TabDef {
  name: string;
  title: string;
  icon: string;
}

/** Barre d'onglets commune aux deux profils ; `hidden` : écrans de détail sans onglet. */
export function AppTabs({ tabs, hidden = [] }: { tabs: TabDef[]; hidden?: string[] }): ReactNode {
  // Android bord à bord : on ajoute la hauteur des boutons du téléphone (retour, accueil).
  const { bottom } = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.blue,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 12 },
        tabBarStyle: { height: 64 + bottom, paddingBottom: 8 + bottom, paddingTop: 6 },
      }}
    >
      {tabs.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>{t.icon}</Text>,
          }}
        />
      ))}
      {hidden.map((name) => (
        <Tabs.Screen key={name} name={name} options={{ href: null }} />
      ))}
    </Tabs>
  );
}
