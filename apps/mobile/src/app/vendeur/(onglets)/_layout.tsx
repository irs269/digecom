import { AppTabs } from '@/components/tabs';

/** Onglets de l'e-commerçant. Le détail d'une commande est dans la pile parente (vendeur/_layout). */
export default function VendeurOnglets() {
  return (
    <AppTabs
      tabs={[
        { name: 'index', title: 'Accueil', icon: '⌂' },
        { name: 'vente', title: 'Vendre', icon: '＋' },
        { name: 'commandes', title: 'Commandes', icon: '☰' },
        { name: 'solde', title: 'Solde', icon: '◎' },
      ]}
    />
  );
}
