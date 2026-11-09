import type {
  DeliveryOfferView,
  OrderView,
  SellerBalanceView,
  VisibleCatalog,
} from '@digecom/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

interface Page<T> {
  items: T[];
  total: number;
}

export interface CourierHistory {
  runs: {
    id: string;
    number: string;
    status: OrderView['status'];
    handedOverAt: string;
    courierFee: number | null;
    amountCollected: number | null;
    deliveryMode: OrderView['deliveryMode'];
  }[];
  totalFees: number;
  totalCollected: number;
}

export const keys = {
  catalog: ['catalog'] as const,
  myOrders: ['me', 'orders'] as const,
  balance: ['me', 'balance'] as const,
  offers: ['courier', 'offers'] as const,
  runs: ['courier', 'runs'] as const,
  history: ['courier', 'history'] as const,
};

export const useCatalog = () =>
  useQuery({ queryKey: keys.catalog, queryFn: () => api<VisibleCatalog>('/catalog/visible') });

export const useMyOrders = () =>
  useQuery({
    queryKey: keys.myOrders,
    queryFn: () => api<Page<OrderView>>('/me/orders?pageSize=100'),
    // Statuts à jour sans geste : toutes les 30 s quand l'app est ouverte (et à chaque push).
    refetchInterval: 30_000,
  });

export const useBalance = () =>
  useQuery({ queryKey: keys.balance, queryFn: () => api<SellerBalanceView>('/me/balance') });

/** Offres : rafraîchies toutes les 15 s en plus du push (une offre prise par un autre disparaît). */
export const useOffers = (enabled: boolean) =>
  useQuery({
    queryKey: keys.offers,
    queryFn: () => api<DeliveryOfferView[]>('/courier/offers'),
    refetchInterval: enabled ? 15_000 : false,
    enabled,
  });

export const useRuns = () =>
  useQuery({ queryKey: keys.runs, queryFn: () => api<OrderView[]>('/courier/runs') });

export const useHistory = () =>
  useQuery({ queryKey: keys.history, queryFn: () => api<CourierHistory>('/courier/history') });
