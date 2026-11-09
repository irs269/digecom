import { Redirect, Stack } from 'expo-router';
import { useSession } from '@/lib/session';

/** Pile de l'e-commerçant : les onglets, puis le détail d'une commande par-dessus. */
export default function VendeurLayout() {
  const { user } = useSession();
  if (!user || user.role !== 'SELLER') return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
