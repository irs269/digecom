import { Redirect } from 'expo-router';
import { AppTabs } from '@/components/tabs';
import { useSession } from '@/lib/session';

export default function LivreurLayout() {
  const { user } = useSession();
  if (!user || user.role !== 'COURIER') return <Redirect href="/" />;
  return (
    <AppTabs
      tabs={[
        { name: 'index', title: 'Courses', icon: '➜' },
        { name: 'historique', title: 'Historique', icon: '☰' },
        { name: 'gains', title: 'Gains', icon: '◎' },
      ]}
      hidden={['course/[id]']}
    />
  );
}
