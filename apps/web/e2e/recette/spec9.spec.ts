/**
 * Recette – critères de validation globaux de la SPEC §9, joués contre un environnement déployé
 * (préproduction) avec les données de démonstration :
 *   RECETTE=1 E2E_BASE_URL=https://app.preprod.digecom.km RECETTE_PASSWORD=… \
 *   pnpm exec playwright test e2e/recette --project=desktop
 * Les appels passent par l'API publique de l'environnement (/api), comme l'application.
 */
import { moduleAccess, MODULE_KEYS, type ModuleKey, type Role } from '@digecom/shared';
import { expect, test, type APIRequestContext } from '@playwright/test';

const PASSWORD =
  process.env.RECETTE_PASSWORD ?? process.env.SEED_DEFAULT_PASSWORD ?? 'Digecom2026!';
const P = {
  ADMIN: '+2693300001',
  FINANCE: '+2693300002',
  ACCOUNTANT: '+2693300003',
  ACC_ASSIST: '+2693300004',
  CASHIER_MO: '+2693300005',
  STOCK_AN: '+2693300006',
  LOGISTICS_GC: '+2693300007',
  ALI: '+2693300008',
  RACHAD: '+2693300009',
  ANLIA: '+2693300010',
  FATIMA: '+2693300011',
  DJAMAL: '+2693300012',
  ANRIFA: '+2693300018',
  ZAINABA: '+2693300020',
  KARIM: '+2693300023',
  YOUSSOUF: '+2693300024',
} as const;
type Who = keyof typeof P;

const ROLES: Record<Role, Who | null> = {
  ADMIN: 'ADMIN',
  FINANCE_MANAGER: 'FINANCE',
  ACCOUNTANT: 'ACCOUNTANT',
  ACCOUNTANT_ASSISTANT: 'ACC_ASSIST',
  CASHIER: 'CASHIER_MO',
  STOCK_MANAGER: 'STOCK_AN',
  LOGISTICS_ASSISTANT: 'LOGISTICS_GC',
  LEADER_SENIOR: 'ALI',
  LEADER_JUNIOR: 'RACHAD',
  TELECONSULTANT: 'ANLIA',
  SELLER: 'FATIMA',
  COURIER: 'KARIM',
};

/** Endpoint de lecture représentatif de chaque module (PERMISSIONS.md). */
const MODULE_ENDPOINTS: Partial<Record<ModuleKey, string>> = {
  dashboard: '/dashboard',
  orders: '/orders',
  deliveries: '/deliveries/board',
  stock: '/stock',
  purchases: '/purchase-orders',
  network: '/network',
  catalog: '/products',
  campaigns: '/campaigns',
  prospects: '/prospects',
  settlements: '/settlements',
  cash: '/cash/registers',
  expenses: '/expenses',
  reports: '/reports',
  users: '/users',
  settings: '/settings',
};

test.describe.configure({ mode: 'serial' });

let api: APIRequestContext;
const tokens = new Map<Who, string>();

async function as(who: Who) {
  if (!tokens.has(who)) {
    const r = await api.post('auth/login', { data: { phone: P[who], password: PASSWORD } });
    expect(r.status(), `connexion ${who}`).toBe(200);
    tokens.set(who, ((await r.json()) as { accessToken: string }).accessToken);
  }
  return { Authorization: `Bearer ${tokens.get(who)}` };
}
async function get<T = unknown>(who: Who, path: string): Promise<T> {
  const r = await api.get(path.replace(/^\//, ''), { headers: await as(who) });
  expect(r.ok(), `GET ${path} (${who}) → ${r.status()}`).toBe(true);
  return (await r.json()) as T;
}
async function post<T = unknown>(who: Who, path: string, data: object = {}, status = [200, 201]) {
  const r = await api.post(path.replace(/^\//, ''), { headers: await as(who), data });
  expect(status, `POST ${path} (${who}) → ${r.status()} ${await r.text()}`).toContain(r.status());
  return (await r.json()) as T;
}
const items = <T>(body: unknown): T[] =>
  Array.isArray(body) ? (body as T[]) : (((body as { items?: T[] }).items ?? []) as T[]);

interface Order {
  id: string;
  number: string;
  status: string;
}
interface Product {
  id: string;
  name: string;
  leader: { id: string; fullName: string };
}

test.beforeAll(async ({ playwright, baseURL }) => {
  api = await playwright.request.newContext({ baseURL: `${baseURL}/api/` });
});
test.afterAll(async () => {
  await api.dispose();
});

async function productId(name: string, leader: string) {
  const list = items<Product>(await get('ADMIN', '/products?pageSize=200'));
  const p = list.find((x) => x.name === name && x.leader.fullName === leader);
  expect(p, `produit ${name} (${leader})`).toBeTruthy();
  return p!.id;
}
async function sellerId(fullName: string) {
  const sellers = items<{ id: string; fullName: string }>(await get('ADMIN', '/orders/sellers'));
  const s = sellers.find((x) => x.fullName === fullName);
  expect(s, `vendeur ${fullName}`).toBeTruthy();
  return s!.id;
}
async function order(
  mode: 'TO_SELLER' | 'TO_CUSTOMER' | 'PICKUP',
  product: string,
  seller = 'Fatima Said',
) {
  return post<Order>('LOGISTICS_GC', '/orders', {
    sellerId: await sellerId(seller),
    items: [{ productId: product, quantity: 1 }],
    customerName: 'Client Recette',
    customerPhone: '+269 332 14 87',
    customerAddress: 'Moroni',
    zone: 'Moroni Nord',
    deliveryMode: mode,
  });
}
const act = (who: Who, id: string, action: string, data: object = {}) =>
  post<Order>(who, `/orders/${id}/actions/${action}`, data);
async function toReady(id: string, who: Who = 'LOGISTICS_GC') {
  for (const a of ['confirm', 'prepare', 'ready']) await act(who, id, a);
}

test('§4.1 et simulation 100 produits : exacts au KMF près', async ({ page }) => {
  const sim = await get<{ rows: { indicator: string; amount: number }[] }>(
    'ADMIN',
    '/reports/simulation?from=2026-01-01&to=2026-01-01',
  );
  const v = Object.fromEntries(sim.rows.map((r) => [r.indicator, r.amount]));
  expect(v).toMatchObject({
    Achats: 25_000,
    Expédition: 50_000,
    'Coût total': 75_000,
    'Chiffre d’affaires': 1_250_000,
    'Part Dig’eCom': 500_000,
    'Part brute e-commerçants': 750_000,
    'Marge brute': 425_000,
    'Taxes Dig’eCom': 50_000,
    'Taxes e-commerçants': 50_000,
    'Net e-commerçants': 700_000,
    'Marge après coût et taxe': 375_000,
  });
  // Même tableau à l'écran.
  await page.goto('/connexion');
  await page.getByLabel('Téléphone').fill(P.ADMIN);
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/tableau-de-bord/);
  await page.goto('/rapports?type=simulation');
  await expect(page.getByRole('table', { name: 'Simulation 100 produits' })).toContainText('375');
});

test('§4.2 : relevé de référence de Fatima Said = 50 000 KMF', async () => {
  const list = items<{ seller: { fullName: string }; netToPay: number; salesCount: number }>(
    await get('ACCOUNTANT', '/settlements?pageSize=100'),
  );
  const ref = list.find((s) => s.seller.fullName === 'Fatima Said' && s.salesCount === 10);
  expect(ref, 'relevé de démonstration de Fatima Said').toBeTruthy();
  expect(ref!.netToPay).toBe(50_000);
});

test('une commande à Mohéli ne notifie aucun livreur d’une autre île', async () => {
  const lampe = await productId('Lampe solaire', 'Moinaecha Ali');
  const o = await post<Order>('ADMIN', '/orders', {
    sellerId: await sellerId('Zainaba Ibrahim'),
    items: [{ productId: lampe, quantity: 1 }],
    customerName: 'Client Recette Mohéli',
    customerPhone: '3389012',
    deliveryMode: 'TO_CUSTOMER',
  });
  await toReady(o.id, 'ADMIN');
  for (const courier of ['KARIM', 'YOUSSOUF', 'DJAMAL'] as const) {
    const offers = await get<{ orderId: string }[]>(courier, '/courier/offers');
    expect(
      offers.map((x) => x.orderId),
      `offres de ${courier}`,
    ).not.toContain(o.id);
  }
  // Données de recette : la commande est annulée, le stock libéré.
  await act('ADMIN', o.id, 'cancel', { reason: 'Recette : test d’isolation par île' });
});

test('un vendeur du leader 2 ne voit aucun produit ni stock du leader 1', async () => {
  const anrifa = await get<{ leader: { fullName: string }; products: Product[] }>(
    'ANRIFA',
    '/catalog/visible',
  );
  expect(anrifa.leader.fullName).toBe('Nassur Ahmed');
  const ali = items<Product>(await get('ADMIN', '/products?pageSize=200'))
    .filter((p) => p.leader.fullName === 'Ali Mohamed')
    .map((p) => p.id);
  expect(anrifa.products.map((p) => p.id).filter((id) => ali.includes(id))).toEqual([]);
  const fatima = await get<{ leader: { fullName: string } }>('FATIMA', '/catalog/visible');
  expect(fatima.leader.fullName).toBe('Ali Mohamed');
});

test('trois modes de remise et leurs confirmations ; refus et retour sans commission', async () => {
  const sac = await productId('Sac à main', 'Ali Mohamed');
  const today = new Date().toISOString().slice(0, 10);
  const net = async () =>
    (
      await get<{ rows: { seller: string; sellerNet: number }[] }>(
        'ADMIN',
        `/reports/seller?from=${today}&to=${today}`,
      )
    ).rows.find((r) => r.seller === 'Fatima Said')?.sellerNet ?? 0;

  // 1. Livraison directe au client : offre, acceptation, retrait, remise, vente.
  const direct = await order('TO_CUSTOMER', sac);
  await toReady(direct.id);
  await post('KARIM', `/courier/offers/${direct.id}/accept`);
  await post('KARIM', `/courier/runs/${direct.id}/pickup`);
  const handed = await post<Order>('KARIM', `/courier/runs/${direct.id}/handover`, {
    amountCollected: 14_000,
  });
  expect(handed.status).toBe('HANDED_OVER');
  expect((await post<Order>('KARIM', `/courier/runs/${direct.id}/markSold`)).status).toBe('SOLD');

  // 2. Livraison à l'e-commerçant : double confirmation (livreur + vendeur), puis refus.
  const before = await net();
  const toSeller = await order('TO_SELLER', sac);
  await toReady(toSeller.id);
  await post('YOUSSOUF', `/courier/offers/${toSeller.id}/accept`);
  await post('YOUSSOUF', `/courier/runs/${toSeller.id}/pickup`);
  expect((await post<Order>('YOUSSOUF', `/courier/runs/${toSeller.id}/handover`)).status).toBe(
    'OUT_FOR_DELIVERY',
  );
  expect((await post<Order>('FATIMA', `/me/orders/${toSeller.id}/sellerConfirm`)).status).toBe(
    'HANDED_OVER',
  );
  const refused = await post<Order>('FATIMA', `/me/orders/${toSeller.id}/markRefused`, {
    reason: 'Recette : client absent',
  });
  expect(refused.status).toBe('RETURN_IN_PROGRESS');
  expect((await act('ADMIN', toSeller.id, 'restock')).status).toBe('RETURNED_TO_STOCK');
  expect(await net(), 'aucune commission sur un refus').toBe(before);

  // 3. Retrait au site : aucun livreur, double confirmation site + vendeur.
  const pickup = await order('PICKUP', sac);
  await toReady(pickup.id);
  for (const courier of ['KARIM', 'YOUSSOUF'] as const) {
    const offers = await get<{ orderId: string }[]>(courier, '/courier/offers');
    expect(offers.map((x) => x.orderId)).not.toContain(pickup.id);
  }
  expect((await post<Order>('FATIMA', `/me/orders/${pickup.id}/sellerConfirm`)).status).toBe(
    'READY',
  );
  expect((await act('LOGISTICS_GC', pickup.id, 'siteHandover')).status).toBe('HANDED_OVER');
  expect((await post<Order>('FATIMA', `/me/orders/${pickup.id}/markSold`)).status).toBe('SOLD');
});

test('un TCI ne voit que ses prospects ; prime comptée seulement en SOLD', async () => {
  const mine = items<{ tci: { fullName: string } | null }>(await get('ANLIA', '/prospects'));
  expect(mine.length).toBeGreaterThan(0);
  expect(mine.every((p) => p.tci?.fullName === 'Anlia Hassani')).toBe(true);
  const e = await get<{
    weekEarnings: number;
    totalEarnings: number;
    weekOrders: { status: string; bonus: number; soldAt: string | null }[];
    toClose: { status: string }[];
  }>('ANLIA', '/tci/me/earnings');
  const soldBonus = e.weekOrders
    .filter((o) => o.status === 'SOLD')
    .reduce((s, o) => s + o.bonus, 0);
  expect(e.weekEarnings).toBe(soldBonus);
  expect(e.toClose.every((o) => o.status === 'HANDED_OVER')).toBe(true);
  expect(e.totalEarnings).toBeGreaterThanOrEqual(e.weekEarnings);
});

test('séparation des tâches des règlements', async () => {
  const generated = items<{ id: string }>(await get('ACCOUNTANT', '/settlements?status=GENERATED'));
  test.skip(!generated.length, 'Aucun relevé « Généré » dans cet environnement');
  const id = generated[0]!.id;
  // Payer ou valider avant vérification : refusé.
  await post(
    'CASHIER_MO',
    `/settlements/${id}/pay`,
    { paymentMethod: 'CASH' },
    [403, 404, 409, 422],
  );
  await post('ACCOUNTANT', `/settlements/${id}/verify`);
  // Le comptable qui a vérifié ne peut pas valider ; le caissier ne peut pas valider.
  await post('ACCOUNTANT', `/settlements/${id}/approve`, {}, [403]);
  await post('CASHIER_MO', `/settlements/${id}/approve`, {}, [403]);
});

test('chaque rôle n’accède qu’aux modules prévus par PERMISSIONS.md', async () => {
  for (const [role, who] of Object.entries(ROLES) as [Role, Who | null][]) {
    if (!who) continue;
    for (const key of MODULE_KEYS) {
      const path = MODULE_ENDPOINTS[key];
      if (!path) continue;
      const r = await api.get(path.slice(1), { headers: await as(who) });
      const allowed = moduleAccess(role, key) !== null;
      if (allowed) expect(r.status(), `${role} → ${key} (${path})`).not.toBe(403);
      else expect(r.status(), `${role} → ${key} (${path})`).toBe(403);
    }
  }
});
