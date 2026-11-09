import type { MeResponse } from '@digecom/shared';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, logout as apiLogout, onSessionChange, refresh } from './api';
import { resetQueue } from './offline';
import { queryClient } from './query';
import { registerForPush, unregisterPush } from './push';

/** Rôles servis par l'application mobile (les autres utilisent le back-office web). */
export const MOBILE_ROLES = ['SELLER', 'COURIER'] as const;

interface SessionValue {
  user: MeResponse | null;
  /** Vrai tant que la session enregistrée n'a pas été vérifiée au démarrage. */
  loading: boolean;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue>({
  user: null,
  loading: true,
  logout: async () => undefined,
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const off = onSessionChange((u) => {
      setUser(u);
      // Compte désactivé ou session révoquée : on vide tout ce qui appartient au compte.
      if (!u) {
        queryClient.clear();
        void resetQueue();
      }
    });
    void refresh()
      .then(async (ok) => {
        if (ok) setUser(await api<MeResponse>('/auth/me'));
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
    return off;
  }, []);

  useEffect(() => {
    if (user) void registerForPush();
  }, [user?.id]);

  const logout = async () => {
    await unregisterPush();
    await apiLogout();
  };

  return (
    <SessionContext.Provider value={{ user, loading, logout }}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
