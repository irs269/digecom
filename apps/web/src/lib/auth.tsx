'use client';

import type { MeResponse } from '@digecom/shared';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  apiFetch,
  login as apiLogin,
  logout as apiLogout,
  refreshSession,
  setAccessToken,
  setSessionExpiredHandler,
} from './api';

type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'anonymous'; user: null }
  | { status: 'authenticated'; user: MeResponse };

interface AuthContextValue {
  state: AuthState;
  login: (phone: string, password: string) => Promise<MeResponse>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  /** Met à jour le profil après une action (ex. changement de mot de passe). */
  setUser: (user: MeResponse) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Renouvelle le jeton d'accès un peu avant son expiration (15 min). */
const REFRESH_MARGIN_MS = 60_000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null });
  const [expiresIn, setExpiresIn] = useState<number | null>(null);

  const expire = useCallback(() => {
    setAccessToken(null);
    setState({ status: 'anonymous', user: null });
    router.replace('/connexion?expire=1');
  }, [router]);

  useEffect(() => {
    setSessionExpiredHandler(expire);
    return () => setSessionExpiredHandler(null);
  }, [expire]);

  // Au chargement : tentative de reprise de session via le cookie refresh.
  useEffect(() => {
    let cancelled = false;
    void refreshSession().then((session) => {
      if (cancelled) return;
      if (session) {
        setExpiresIn(session.expiresIn);
        setState({ status: 'authenticated', user: session.user });
      } else {
        setState({ status: 'anonymous', user: null });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh silencieux périodique.
  useEffect(() => {
    if (state.status !== 'authenticated' || !expiresIn) return;
    const delay = Math.max(expiresIn * 1000 - REFRESH_MARGIN_MS, 30_000);
    const timer = setTimeout(() => {
      void refreshSession().then((session) => {
        if (!session) return expire();
        setExpiresIn(session.expiresIn);
        setState({ status: 'authenticated', user: session.user });
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [state, expiresIn, expire]);

  const login = useCallback(async (phone: string, password: string) => {
    const session = await apiLogin(phone, password);
    setExpiresIn(session.expiresIn);
    setState({ status: 'authenticated', user: session.user });
    return session.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } finally {
      setState({ status: 'anonymous', user: null });
      router.replace('/connexion');
    }
  }, [router]);

  const reload = useCallback(async () => {
    const user = await apiFetch<MeResponse>('/auth/me');
    setState({ status: 'authenticated', user });
  }, []);

  const setUser = useCallback((user: MeResponse) => {
    setState({ status: 'authenticated', user });
  }, []);

  const value = useMemo(
    () => ({ state, login, logout, reload, setUser }),
    [state, login, logout, reload, setUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans <AuthProvider>');
  return ctx;
}
