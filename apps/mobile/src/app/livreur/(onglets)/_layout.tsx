import { AppTabs } from '@/components/tabs';

/** Onglets du livreur. Le détail d'une course est dans la pile parente (livreur/_layout). */
export default function LivreurOnglets() {
  return (
    <AppTabs
      tabs={[
        { name: 'index', title: 'Courses', icon: '➜' },
        { name: 'historique', title: 'Historique', icon: '☰' },
        { name: 'gains', title: 'Gains', icon: '◎' },
      ]}
    />
  );
}
