import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { ApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cache gardé 24 h : les écrans restent consultables sans réseau.
      gcTime: 24 * 3600_000,
      staleTime: 30_000,
      retry: (count, err) =>
        !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      networkMode: 'offlineFirst',
    },
  },
});

export const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: 'dc_cache' });

onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((s) => setOnline(!!s.isConnected)),
);

AppState.addEventListener('change', (s) => focusManager.setFocused(s === 'active'));
