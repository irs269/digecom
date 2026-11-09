import { Redirect } from 'expo-router';
import { AppTabs } from '@/components/tabs';
import { useSession } from '@/lib/session';

export default function VendeurLayout() {
  const { user } = useSession();
  if (!user || user.role !== 'SELLER') return <Redirect href="/" />;
  return (
    <AppTabs
      tabs={[
        { name: 'index', title: 'Accueil', icon: '⌂' },
        { name: 'vente', title: 'Vendre', icon: '＋' },
        { name: 'commandes', title: 'Commandes', icon: '☰' },
        { name: 'solde', title: 'Solde', icon: '◎' },
      ]}
      hidden={['commande/[id]']}
    />
  );
}
