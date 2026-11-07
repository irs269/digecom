'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/app-shell';
import { Forbidden } from '@/components/forbidden';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth';
import { AccountsTab } from './accounts-tab';
import { JournalTab, MatrixTab, TeamsTab } from './other-tabs';

type TabKey = 'comptes' | 'matrice' | 'equipes' | 'journal';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'comptes', label: 'Comptes' },
  { key: 'matrice', label: 'Matrice des droits' },
  { key: 'equipes', label: 'Équipes' },
  { key: 'journal', label: 'Journal d’activité' },
];

export default function UsersPage() {
  const { state } = useAuth();
  const [tab, setTab] = useState<TabKey>('comptes');
  if (state.status !== 'authenticated') return null;
  if (!state.user.modules.some((m) => m.key === 'users')) return <Forbidden />;

  return (
    <>
      <PageHeader title="Utilisateurs et droits" subtitle="Comptes, rôles, équipes et journal" />
      <Tabs label="Sections" tabs={TABS} value={tab} onChange={setTab} />
      <TabPanel id={tab}>
        {tab === 'comptes' ? <AccountsTab /> : null}
        {tab === 'matrice' ? <MatrixTab /> : null}
        {tab === 'equipes' ? <TeamsTab /> : null}
        {tab === 'journal' ? <JournalTab /> : null}
      </TabPanel>
    </>
  );
}
