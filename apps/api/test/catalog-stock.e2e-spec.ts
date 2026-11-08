import type {
  InventoryView,
  Paginated,
  ProductView,
  PurchaseOrderView,
  StockRow,
  StockSummary,
  VisibleCatalog,
} from '@digecom/shared';
import sharp from 'sharp';
import request from 'supertest';
import { BUCKETS, StorageService } from '../src/storage/storage.service';
import { createTestApp, login, type TestContext } from './helpers';

const PHONES = {
  ADMIN: '+2693300001',
  FINANCE: '+2693300002',
  CASHIER: '+2693300005',
  STOCK_AN: '+2693300006',
  LOGISTICS_GC: '+2693300007',
  ALI: '+2693300008', // Leader Senior GC
  RACHAD: '+2693300009', // Leader Junior GC
  TCI_RACHAD: '+2693300010',
  SELLER_ALI: '+2693300011',
  NASSUR: '+2693300013', // Leader Senior AN
  SELLER_NASSUR: '+2693300018',
};

describe('Catalogues, stock et achats (e2e)', () => {
  let ctx: TestContext;
  const tokens: Record<string, string> = {};
  const http = () => request(ctx.app.getHttpServer());
  const as = (who: keyof typeof PHONES) => ({ Authorization: `Bearer ${tokens[who]}` });
  const userId = async (phone: string) =>
    (await ctx.prisma.user.findUniqueOrThrow({ where: { phone } })).id;
  const siteId = async (name: string) =>
    (await ctx.prisma.site.findUniqueOrThrow({ where: { name } })).id;
  const productOf = async (leaderPhone: string, name: string) =>
    ctx.prisma.product.findFirstOrThrow({ where: { name, leader: { phone: leaderPhone } } });

  beforeAll(async () => {
    ctx = await createTestApp();
    for (const [who, phone] of Object.entries(PHONES)) {
      const res = await login(ctx.app, phone);
      expect(res.status).toBe(200);
      tokens[who] = res.body.accessToken as string;
    }
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('catalogues cloisonnés', () => {
    it('un leader ne voit que ses produits ; un rôle d’île ceux des leaders de son île', async () => {
      const ali = (await http().get('/products').set(as('ALI'))).body as Paginated<ProductView>;
      expect(new Set(ali.items.map((p) => p.leader.fullName))).toEqual(new Set(['Ali Mohamed']));
      expect(ali.items.map((p) => p.name).sort()).toEqual(
        ['Écouteurs sans fil', 'Sac à main', 'Ventilateur rechargeable'].sort(),
      );
      const ecouteurs = ali.items.find((p) => p.name === 'Écouteurs sans fil')!;
      expect(ecouteurs).toMatchObject({ salePrice: 12500, sellerAmount: 7500, state: 'PUBLISHED' });
      expect(ecouteurs.stock.available).toBe(3);
      expect(ali.items.find((p) => p.name === 'Ventilateur rechargeable')!.state).toBe(
        'OUT_OF_STOCK',
      );

      const logistics = (await http().get('/products?pageSize=200').set(as('LOGISTICS_GC')))
        .body as Paginated<ProductView>;
      expect(logistics.items.every((p) => p.leader.island?.code === 'GC')).toBe(true);
      expect((await http().get('/products').set(as('CASHIER'))).status).toBe(403);
    });

    it('un vendeur ne reçoit que le catalogue publié de SON leader (avec stock)', async () => {
      const mine = (await http().get('/catalog/visible').set(as('SELLER_ALI')))
        .body as VisibleCatalog;
      expect(mine.leader.fullName).toBe('Ali Mohamed');
      expect(mine.products.map((p) => p.name).sort()).toEqual(
        ['Sac à main', 'Écouteurs sans fil'].sort(),
      );
      expect(mine.hiddenCount).toBe(1); // ventilateur en rupture

      const other = (await http().get('/catalog/visible').set(as('SELLER_NASSUR')))
        .body as VisibleCatalog;
      const aliIds = new Set(mine.products.map((p) => p.id));
      expect(other.leader.fullName).toBe('Nassur Ahmed');
      expect(other.products.some((p) => aliIds.has(p.id))).toBe(false);
      expect(
        other.products.every((p) => p.sites.every((s) => s.siteName.startsWith('Mutsamudu'))),
      ).toBe(true);

      // Un vendeur ne peut pas demander le catalogue d'un autre leader.
      const forced = (
        await http()
          .get(`/catalog/visible?asLeader=${await userId(PHONES.ALI)}`)
          .set(as('SELLER_NASSUR'))
      ).body as VisibleCatalog;
      expect(forced.leader.fullName).toBe('Nassur Ahmed');
    });

    it('le TCI voit le catalogue de son Leader Junior avec la prime', async () => {
      const res = (await http().get('/catalog/visible').set(as('TCI_RACHAD')))
        .body as VisibleCatalog;
      expect(res.products.map((p) => [p.name, p.tciBonus]).sort()).toEqual([
        ['Blender portable', 2500],
        ['Montre connectée Sport', 3000],
      ]);
    });

    it('aperçu « ce que voit chaque équipe » : admin avec asLeader ; leader : la sienne ; caissier 403', async () => {
      const nassur = await userId(PHONES.NASSUR);
      const preview = await http().get(`/catalog/visible?asLeader=${nassur}`).set(as('ADMIN'));
      expect(preview.status).toBe(200);
      expect(preview.body.leader.fullName).toBe('Nassur Ahmed');
      expect((await http().get('/catalog/visible').set(as('ADMIN'))).status).toBe(422);
      expect((await http().get(`/catalog/visible?asLeader=${nassur}`).set(as('ALI'))).status).toBe(
        404,
      );
      expect((await http().get('/catalog/visible').set(as('CASHIER'))).status).toBe(403);
    });
  });

  describe('fiches produit', () => {
    it('Leader Senior : part requise, pas de prime TCI', async () => {
      const bad = await http().post('/products').set(as('ALI')).send({
        name: 'Powerbank',
        salePrice: 8000,
        sellerShareType: 'FIXED',
        sellerShareValue: 4000,
        tciBonus: 2000,
      });
      expect(bad.status).toBe(422);
      const noShare = await http()
        .post('/products')
        .set(as('ALI'))
        .send({ name: 'Powerbank', salePrice: 8000 });
      expect(noShare.status).toBe(422);
      const ok = await http().post('/products').set(as('ALI')).send({
        name: 'Powerbank 10 000 mAh',
        salePrice: 8000,
        sellerShareType: 'PERCENT',
        sellerShareValue: 60,
        isPublished: true,
      });
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({
        sellerAmount: 4800,
        sku: expect.stringMatching(/^PRD-\d{6}$/),
      });
      expect(ok.body.leader.fullName).toBe('Ali Mohamed');
    });

    it('Leader Junior : prime TCI hors bornes → 422, dans les bornes → 201', async () => {
      const tooHigh = await http()
        .post('/products')
        .set(as('RACHAD'))
        .send({ name: 'Casque', salePrice: 20000, tciBonus: 4000 });
      expect(tooHigh.status).toBe(422);
      expect(tooHigh.body.message).toContain('2000');
      const tooLow = await http()
        .post('/products')
        .set(as('RACHAD'))
        .send({ name: 'Casque', salePrice: 20000, tciBonus: 1500 });
      expect(tooLow.status).toBe(422);
      const ok = await http()
        .post('/products')
        .set(as('RACHAD'))
        .send({ name: 'Casque Bluetooth', salePrice: 20000, tciBonus: 3000 });
      expect(ok.status).toBe(201);
      expect(ok.body.sellerAmount).toBe(3000);
    });

    it('prime −500 / +500 bornée', async () => {
      const p = await productOf(PHONES.RACHAD, 'Montre connectée Sport');
      const up = await http().post(`/products/${p.id}/tci-bonus/up`).set(as('RACHAD'));
      expect(up.body.tciBonus).toBe(3500);
      expect((await http().post(`/products/${p.id}/tci-bonus/up`).set(as('RACHAD'))).status).toBe(
        422,
      );
      const down = await http().post(`/products/${p.id}/tci-bonus/down`).set(as('RACHAD'));
      expect(down.body.tciBonus).toBe(3000);
      expect((await http().post(`/products/${p.id}/tci-bonus/up`).set(as('ALI'))).status).toBe(403);
    });

    it('un leader qui modifie le produit d’un autre → 404', async () => {
      const aliProduct = await productOf(PHONES.ALI, 'Sac à main');
      expect(
        (
          await http()
            .patch(`/products/${aliProduct.id}`)
            .set(as('RACHAD'))
            .send({ name: 'Sac modifié' })
        ).status,
      ).toBe(404);
      expect(
        (await http().patch(`/products/${aliProduct.id}`).set(as('NASSUR')).send({ salePrice: 1 }))
          .status,
      ).toBe(404);
      expect((await http().get(`/products/${aliProduct.id}`).set(as('NASSUR'))).status).toBe(404);
    });

    it('changement de prix : nouvelle valeur, ancienne gardée dans l’audit', async () => {
      const p = await productOf(PHONES.ALI, 'Sac à main');
      const res = await http()
        .patch(`/products/${p.id}`)
        .set(as('ALI'))
        .send({ salePrice: 15000, sellerShareValue: 9000 });
      expect(res.status).toBe(200);
      expect(res.body.salePrice).toBe(15000);
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'PRODUCT_UPDATE', entityId: p.id },
      });
      expect(audit.before).toMatchObject({ salePrice: 14000 });
      expect(
        (await http().patch(`/products/${p.id}`).set(as('FINANCE')).send({ salePrice: 1 })).status,
      ).toBe(403);
    });

    it('retirer / publier : un produit retiré disparaît du catalogue visible', async () => {
      const p = await productOf(PHONES.ALI, 'Sac à main');
      expect((await http().post(`/products/${p.id}/unpublish`).set(as('ALI'))).body.state).toBe(
        'UNPUBLISHED',
      );
      let visible = (await http().get('/catalog/visible').set(as('SELLER_ALI')))
        .body as VisibleCatalog;
      expect(visible.products.some((x) => x.id === p.id)).toBe(false);
      expect((await http().post(`/products/${p.id}/publish`).set(as('ALI'))).body.state).toBe(
        'PUBLISHED',
      );
      visible = (await http().get('/catalog/visible').set(as('SELLER_ALI'))).body as VisibleCatalog;
      expect(visible.products.some((x) => x.id === p.id)).toBe(true);
    });

    it('stock +/− du catalogue avec motif ; jamais négatif', async () => {
      const p = await productOf(PHONES.ALI, 'Écouteurs sans fil');
      const plus = await http()
        .post(`/products/${p.id}/stock`)
        .set(as('ALI'))
        .send({ delta: 2, reason: 'Retour fournisseur' });
      expect(plus.status).toBe(200);
      expect(plus.body.stock.available).toBe(5);
      const noReason = await http()
        .post(`/products/${p.id}/stock`)
        .set(as('ALI'))
        .send({ delta: 1, reason: '' });
      expect(noReason.status).toBe(422);
      const tooMuch = await http()
        .post(`/products/${p.id}/stock`)
        .set(as('ALI'))
        .send({ delta: -100, reason: 'Erreur' });
      expect(tooMuch.status).toBe(409);
      const m = await ctx.prisma.stockMovement.findFirstOrThrow({
        where: { productId: p.id, reason: 'Retour fournisseur' },
      });
      expect(m.byId).toBe(await userId(PHONES.ALI));
    });

    it('photos : conversion WebP, 5 maximum, clé étrangère refusée', async () => {
      const p = await productOf(PHONES.ALI, 'Écouteurs sans fil');
      const upload = await http()
        .post(`/products/${p.id}/photos/upload-url`)
        .set(as('ALI'))
        .send({ contentType: 'image/png' });
      expect(upload.status).toBe(200);
      expect(upload.body.uploadUrl).toContain(upload.body.key);

      // Simule l'envoi direct du navigateur vers MinIO.
      const storage = ctx.app.get(StorageService);
      const png = await sharp({
        create: { width: 40, height: 30, channels: 3, background: '#0B2FE0' },
      })
        .png()
        .toBuffer();
      await storage.put(BUCKETS.products, upload.body.key as string, png, 'image/png');
      const added = await http()
        .post(`/products/${p.id}/photos`)
        .set(as('ALI'))
        .send({ key: upload.body.key });
      expect(added.status).toBe(200);
      expect(added.body.photos).toHaveLength(1);
      expect(added.body.photos[0].key).toMatch(/\.webp$/);

      const foreign = await http()
        .post(`/products/${p.id}/photos`)
        .set(as('ALI'))
        .send({ key: 'tmp/autre/xyz' });
      expect(foreign.status).toBe(422);
      expect(
        (
          await http()
            .post(`/products/${p.id}/photos/upload-url`)
            .set(as('NASSUR'))
            .send({ contentType: 'image/png' })
        ).status,
      ).toBe(404);

      const removed = await http()
        .delete(`/products/${p.id}/photos?key=${encodeURIComponent(added.body.photos[0].key)}`)
        .set(as('ALI'));
      expect(removed.body.photos).toHaveLength(0);
    });
  });

  describe('stock par site', () => {
    it('le gestionnaire de stock d’Anjouan ne voit que les sites d’Anjouan', async () => {
      const rows = (await http().get('/stock').set(as('STOCK_AN'))).body as StockRow[];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.site.island.code === 'AN')).toBe(true);
      const all = (await http().get('/stock').set(as('FINANCE'))).body as StockRow[];
      expect(new Set(all.map((r) => r.site.island.code))).toEqual(new Set(['GC', 'AN', 'MO']));
      expect((await http().get('/stock').set(as('CASHIER'))).status).toBe(403);
    });

    it('coût rendu et valeur : écouteurs LOT-014 à 750', async () => {
      const rows = (await http().get('/stock?q=PRD').set(as('ADMIN'))).body as StockRow[];
      const ecouteurs = rows.find(
        (r) => r.productName === 'Écouteurs sans fil' && r.leader.fullName === 'Ali Mohamed',
      )!;
      expect(ecouteurs.unitCost).toBe(750);
      const summary = (await http().get('/stock/summary').set(as('ADMIN'))).body as StockSummary;
      expect(summary.value).toBeGreaterThan(0);
      expect(summary.alerts.OUT).toBeGreaterThanOrEqual(1);
    });

    it('alertes : rupture et stock faible', async () => {
      const out = (await http().get('/stock?alert=OUT').set(as('ADMIN'))).body as StockRow[];
      expect(out.map((r) => r.productName)).toContain('Ventilateur rechargeable');
      const low = (await http().get('/stock?alert=LOW').set(as('ADMIN'))).body as StockRow[];
      expect(low.every((r) => r.available > 0 && r.available <= 3)).toBe(true);
    });

    it('ajustement : motif obligatoire, hors île → 404, rôle lecture → 403', async () => {
      const montre = await productOf(PHONES.NASSUR, 'Montre connectée');
      const mutsamudu = await siteId('Mutsamudu – Boutique');
      const moroni = await siteId('Moroni – Entrepôt central');
      const ok = await http().post('/stock/adjust').set(as('STOCK_AN')).send({
        productId: montre.id,
        siteId: mutsamudu,
        kind: 'DAMAGED',
        delta: 1,
        reason: 'Bracelet cassé',
      });
      expect(ok.status).toBe(201);
      const outside = await http()
        .post('/stock/adjust')
        .set(as('STOCK_AN'))
        .send({ productId: montre.id, siteId: moroni, kind: 'ADJUST', delta: 1, reason: 'Test' });
      expect(outside.status).toBe(404);
      const logistic = await http()
        .post('/stock/adjust')
        .set(as('LOGISTICS_GC'))
        .send({ productId: montre.id, siteId: moroni, kind: 'ADJUST', delta: 1, reason: 'Test' });
      expect(logistic.status).toBe(403);
    });

    it('transfert inter-sites et historique des mouvements', async () => {
      const p = await productOf(PHONES.ALI, 'Écouteurs sans fil');
      const from = await siteId('Moroni – Entrepôt central');
      const to = await siteId('Mutsamudu – Boutique');
      const res = await http().post('/stock/transfer').set(as('ADMIN')).send({
        productId: p.id,
        fromSiteId: from,
        toSiteId: to,
        quantity: 1,
        reason: 'Réassort Anjouan',
      });
      expect(res.status).toBe(201);
      const history = await http().get(`/stock/movements?productId=${p.id}`).set(as('ADMIN'));
      expect(history.body.map((m: { type: string }) => m.type)).toEqual(
        expect.arrayContaining(['TRANSFER_OUT', 'TRANSFER_IN', 'ENTRY']),
      );
      // Le leader voit l'historique de son produit, pas un autre leader.
      expect(
        (await http().get(`/stock/movements?productId=${p.id}`).set(as('ALI'))).body.length,
      ).toBeGreaterThan(0);
      expect(
        (await http().get(`/stock/movements?productId=${p.id}`).set(as('NASSUR'))).body,
      ).toEqual([]);
    });

    it('inventaire : ouverture, comptage, clôture avec écart', async () => {
      const fomboni = await siteId('Fomboni – Boutique');
      const lampe = await productOf('+2693300014', 'Lampe solaire');
      const inv = (await http().post('/inventories').set(as('ADMIN')).send({ siteId: fomboni }))
        .body as InventoryView;
      const line = inv.lines.find((l) => l.productId === lampe.id)!;
      expect(line.expected).toBe(14);
      expect(
        (await http().post('/inventories').set(as('ADMIN')).send({ siteId: fomboni })).status,
      ).toBe(409);
      expect((await http().post(`/inventories/${inv.id}/close`).set(as('ADMIN'))).status).toBe(422);
      const counted = await http()
        .patch(`/inventories/${inv.id}/count`)
        .set(as('ADMIN'))
        .send({
          lines: inv.lines.map((l) => ({
            productId: l.productId,
            counted: l.productId === lampe.id ? 12 : l.expected,
          })),
        });
      expect(
        counted.body.lines.find((l: { productId: string }) => l.productId === lampe.id).difference,
      ).toBe(-2);
      const closed = await http().post(`/inventories/${inv.id}/close`).set(as('ADMIN'));
      expect(closed.body.status).toBe('CLOSED');
      const lvl = await ctx.prisma.stockLevel.findUniqueOrThrow({
        where: { productId_siteId: { productId: lampe.id, siteId: fomboni } },
      });
      expect(lvl.available).toBe(12);
      expect(
        await ctx.prisma.stockAlert.count({
          where: { type: 'INVENTORY_DIFF', productId: lampe.id },
        }),
      ).toBe(1);
      expect(
        (await http().post('/inventories').set(as('STOCK_AN')).send({ siteId: fomboni })).status,
      ).toBe(404);
    });

    it('recalcul des alertes invendus : stock / admin seulement', async () => {
      expect((await http().post('/stock/alerts/refresh').set(as('ADMIN'))).status).toBe(200);
      expect((await http().post('/stock/alerts/refresh').set(as('FINANCE'))).status).toBe(403);
    });
  });

  describe('achats Chine et lots', () => {
    it('commande fournisseur : 125 000 + 250 000 pour 500 unités → 750 / unité', async () => {
      const supplier = await ctx.prisma.supplier.findFirstOrThrow({
        where: { name: 'Shenzhen Audio Co.' },
      });
      const p = await productOf(PHONES.ALI, 'Écouteurs sans fil');
      const res = await http()
        .post('/purchase-orders')
        .set(as('ADMIN'))
        .send({
          supplierId: supplier.id,
          productId: p.id,
          destinationSiteId: await siteId('Moroni – Entrepôt central'),
          quantity: 500,
          currency: 'kmf',
          exchangeRate: 1,
          purchaseAmountForeign: 125000,
          shippingKmf: 250000,
        });
      expect(res.status).toBe(201);
      const po = res.body as PurchaseOrderView;
      expect(po).toMatchObject({
        number: 'LOT-018',
        status: 'DRAFT',
        unitCost: 750,
        totalCostKmf: 375000,
        currency: 'KMF',
      });
    });

    it('conversion devise : 1 000 USD à 455,50 → 455 500 KMF', async () => {
      const supplier = await ctx.prisma.supplier.findFirstOrThrow({
        where: { name: 'Guangzhou Smart Watch' },
      });
      const p = await productOf(PHONES.NASSUR, 'Montre connectée');
      const res = await http()
        .post('/purchase-orders')
        .set(as('STOCK_AN'))
        .send({
          supplierId: supplier.id,
          productId: p.id,
          destinationSiteId: await siteId('Mutsamudu – Boutique'),
          quantity: 100,
          currency: 'USD',
          exchangeRate: 455.5,
          purchaseAmountForeign: 1000,
          shippingKmf: 44500,
        });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ purchaseAmountKmf: 455500, unitCost: 5000 });
      // Destination hors de son île → 404.
      const outside = await http()
        .post('/purchase-orders')
        .set(as('STOCK_AN'))
        .send({
          ...res.body,
          supplierId: supplier.id,
          productId: p.id,
          destinationSiteId: await siteId('Fomboni – Boutique'),
          currency: 'USD',
          exchangeRate: 1,
          purchaseAmountForeign: 1,
          quantity: 1,
        });
      expect(outside.status).toBe(404);
      expect((await http().post('/purchase-orders').set(as('FINANCE')).send({})).status).toBe(403);
    });

    it('avancement des statuts ; la réception exige l’action dédiée', async () => {
      const po = await ctx.prisma.purchaseOrder.findUniqueOrThrow({ where: { number: 'LOT-018' } });
      for (const expected of ['ORDERED', 'IN_TRANSIT', 'ARRIVED', 'IN_CUSTOMS']) {
        const r = await http().post(`/purchase-orders/${po.id}/advance`).set(as('ADMIN'));
        expect(r.body.status).toBe(expected);
        expect(r.body.dates[expected]).toBeTruthy();
      }
      expect((await http().post(`/purchase-orders/${po.id}/advance`).set(as('ADMIN'))).status).toBe(
        409,
      );
    });

    it('réception de LOT-015 à Anjouan : lot au coût réel, stock disponible chez Nassur seulement', async () => {
      const po = await ctx.prisma.purchaseOrder.findUniqueOrThrow({ where: { number: 'LOT-015' } });
      const montre = await productOf(PHONES.NASSUR, 'Montre connectée');
      const before = (await http().get('/catalog/visible').set(as('SELLER_NASSUR')))
        .body as VisibleCatalog;
      const stockBefore = before.products.find((p) => p.id === montre.id)!.available;

      const res = await http()
        .post(`/purchase-orders/${po.id}/receive`)
        .set(as('STOCK_AN'))
        .send({ receivedQuantity: 200, paidAmountKmf: 240000, paidAt: '2026-10-10' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'RECEIVED',
        receivedQuantity: 200,
        unitCost: 2100,
        paidAmountKmf: 240000,
      });
      const lot = await ctx.prisma.lot.findUniqueOrThrow({ where: { number: 'LOT-015' } });
      expect(lot).toMatchObject({
        quantity: 200,
        remaining: 200,
        unitCost: 2100,
        purchaseOrderId: po.id,
      });

      const after = (await http().get('/catalog/visible').set(as('SELLER_NASSUR')))
        .body as VisibleCatalog;
      expect(after.products.find((p) => p.id === montre.id)!.available).toBe(stockBefore + 200);
      const ali = (await http().get('/catalog/visible').set(as('SELLER_ALI')))
        .body as VisibleCatalog;
      expect(ali.products.some((p) => p.id === montre.id)).toBe(false);

      expect(
        (
          await http()
            .post(`/purchase-orders/${po.id}/receive`)
            .set(as('STOCK_AN'))
            .send({ receivedQuantity: 1 })
        ).status,
      ).toBe(409);
    });

    it('réception hors île → 404 ; quantité reçue différente : coût sur la quantité reçue', async () => {
      const lot16 = await ctx.prisma.purchaseOrder.findUniqueOrThrow({
        where: { number: 'LOT-016' },
      });
      expect(
        (
          await http()
            .post(`/purchase-orders/${lot16.id}/receive`)
            .set(as('STOCK_AN'))
            .send({ receivedQuantity: 1 })
        ).status,
      ).toBe(404);
      await http().post(`/purchase-orders/${lot16.id}/advance`).set(as('ADMIN'));
      const r = await http()
        .post(`/purchase-orders/${lot16.id}/receive`)
        .set(as('ADMIN'))
        .send({ receivedQuantity: 270 });
      expect(r.status).toBe(200);
      expect(r.body.unitCost).toBe(1000); // 270 000 / 270 (30 lampes perdues en route)
    });

    it('fournisseurs : création, doublon 409, lecture refusée au caissier', async () => {
      const created = await http()
        .post('/suppliers')
        .set(as('ADMIN'))
        .send({ name: 'Foshan Kitchen', platform: 'Alibaba' });
      expect(created.status).toBe(201);
      expect(
        (await http().post('/suppliers').set(as('ADMIN')).send({ name: 'Foshan Kitchen' })).status,
      ).toBe(409);
      expect((await http().get('/suppliers').set(as('CASHIER'))).status).toBe(403);
      expect((await http().get('/suppliers').set(as('FINANCE'))).status).toBe(200);
    });
  });
});
