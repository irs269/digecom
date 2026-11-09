import { Redirect, Stack } from 'expo-router';
import { useSession } from '@/lib/session';

/** Pile du livreur : les onglets, puis le détail d'une course par-dessus. */
export default function LivreurLayout() {
  const { user } = useSession();
  if (!user || user.role !== 'COURIER') return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
