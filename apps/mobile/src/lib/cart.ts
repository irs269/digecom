import type { VisibleProduct } from '@digecom/shared';

/** Panier d'une vente : identifiant du produit → quantité. */
export type Cart = Record<string, number>;

/** Ce que le vendeur gagne sur tout le panier : (part − taxe) × quantité, produit par produit. */
export function cartEarnings(products: VisibleProduct[], cart: Cart) {
  let price = 0;
  let part = 0;
  let tax = 0;
  let units = 0;
  for (const [id, qty] of Object.entries(cart)) {
    const p = products.find((x) => x.id === id);
    if (!p) continue;
    price += p.salePrice * qty;
    part += (p.sellerAmount ?? 0) * qty;
    tax += p.sellerTax * qty;
    units += qty;
  }
  return { price, part, tax, net: part - tax, units };
}

/** Sites de l'île qui ont tout le panier en stock (la commande est préparée sur un seul site). */
export function commonSites(products: VisibleProduct[], cart: Cart): string[] {
  let sites: string[] | null = null;
  for (const [id, qty] of Object.entries(cart)) {
    const p = products.find((x) => x.id === id);
    const ok = (p?.sites ?? []).filter((s) => s.available >= qty).map((s) => s.siteId);
    sites = sites === null ? ok : sites.filter((s) => ok.includes(s));
  }
  return sites ?? [];
}
