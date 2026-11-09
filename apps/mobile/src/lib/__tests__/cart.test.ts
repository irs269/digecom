import type { VisibleProduct } from '@digecom/shared';
import { cartEarnings, commonSites } from '../cart';

const product = (id: string, patch: Partial<VisibleProduct>): VisibleProduct =>
  ({
    id,
    sku: id,
    name: id,
    salePrice: 15000,
    sellerAmount: 7500,
    sellerTax: 500,
    sites: [],
    available: 0,
    photos: [],
    ...patch,
  }) as VisibleProduct;

const ventilo = product('ventilo', {
  sites: [
    { siteId: 'moroni', siteName: 'Moroni', available: 5 },
    { siteId: 'mitsamiouli', siteName: 'Mitsamiouli', available: 1 },
  ],
});
const sac = product('sac', {
  salePrice: 10000,
  sellerAmount: 4000,
  sellerTax: 300,
  sites: [{ siteId: 'moroni', siteName: 'Moroni', available: 2 }],
});

test('gains du panier : somme produit par produit', () => {
  expect(cartEarnings([ventilo, sac], { ventilo: 2, sac: 1 })).toEqual({
    price: 40000,
    part: 19000,
    tax: 1300,
    net: 17700,
    units: 3,
  });
});

test('sites communs : un seul site doit avoir tout le panier', () => {
  expect(commonSites([ventilo, sac], { ventilo: 2, sac: 1 })).toEqual(['moroni']);
  expect(commonSites([ventilo, sac], { ventilo: 2, sac: 3 })).toEqual([]);
  expect(commonSites([ventilo], { ventilo: 1 })).toEqual(['moroni', 'mitsamiouli']);
});
