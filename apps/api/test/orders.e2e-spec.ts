import type { OrderView, Paginated } from '@digecom/shared';
import request from 'supertest';
import { hashPassword } from '../src/auth/auth.service';
import { DeliveryJobs } from '../src/orders/delivery-jobs';
import { createTestApp, freshIp, login, PASSWORD, type TestContext } from './helpers';

const PHONES = {
  ADMIN: '+2693300001',
  FINANCE: '+2693300002',
  CASHIER_MO: '+2693300005',
  STOCK_AN: '+2693300006',
  LOGISTICS_GC: '+2693300007',
  ALI: '+2693300008',
  FATIMA: '+2693300011', // e-commerçante, équipe Ali Mohamed (GC)
  ZAINABA: '+2693300020', // e-commerçante, équipe Moinaecha Ali (MO)
  DJAMAL: '+2693300012', // livreur AN
  KARIM: '+2693300023', // livreur GC
  YOUSSOUF: '+2693300024', // livreur GC
};

describe('Commandes et livraisons (e2e)', () => {
  let ctx: TestContext;
  const tokens: Record<string, string> = {};
  const http = () => request(ctx.app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  let sacId: string;
  let moroniId: string;

  const userId = async (phone: string) =>
    (await ctx.prisma.user.findUniqueOrThrow({ where: { phone } })).id;
  const level = async (productId = sacId, siteId = moroniId) =>
    ctx.prisma.stockLevel.findUniqueOrThrow({ where: { productId_siteId: { productId, siteId } } });

  async function signIn(key: string, phone: string) {
    const res = await login(ctx.app, phone, PASSWORD, freshIp());
    expect(res.status).toBe(200);
    tokens[key] = res.body.accessToken as string;
  }

  async function createOrder(
    mode: 'TO_SELLER' | 'TO_CUSTOMER' | 'PICKUP',
    quantity = 1,
    productId = sacId,
    seller = PHONES.FATIMA,
  ) {
    const res = await http()
      .post('/orders')
      .set(as('LOGISTICS_GC'))
      .send({
        sellerId: await userId(seller),
        items: [{ productId, quantity }],
        customerName: 'Hadja Mmadi',
        customerPhone: '+269 332 14 87',
        customerAddress: 'Hamramba, Moroni',
        zone: 'Moroni Nord',
        deliveryMode: mode,
      });
    expect(res.status).toBe(201);
    return res.body as OrderView;
  }

  async function act(who: string, id: string, action: string, body: object = {}) {
    return http().post(`/orders/${id}/actions/${action}`).set(as(who)).send(body);
  }

  async function toReady(id: string) {
    for (const a of ['confirm', 'prepare', 'ready']) {
      const r = await act('LOGISTICS_GC', id, a);
      expect(r.status).toBe(200);
    }
  }

  /** Affectation par la personne qui prépare le colis (assistant logistique de l'île). */
  async function assign(id: string, phone: string, who = 'LOGISTICS_GC') {
    return http()
      .post(`/deliveries/${id}/assign`)
      .set(as(who))
      .send({ courierId: await userId(phone) });
  }
  const at = (who: string, latitude: number, longitude: number) =>
    http().post('/me/location').set(as(who)).send({ latitude, longitude });
  const offersOf = (orderId: string) =>
    ctx.prisma.deliveryOffer.findMany({ where: { orderId }, include: { courier: true } });
  const notified = (phone: string, type: string) =>
    ctx.prisma.notification.count({ where: { type, user: { phone } } });

  beforeAll(async () => {
    ctx = await createTestApp();
    for (const [key, phone] of Object.entries(PHONES)) await signIn(key, phone);
    sacId = (
      await ctx.prisma.product.findFirstOrThrow({
        where: { name: 'Sac à main', leader: { phone: PHONES.ALI } },
      })
    ).id;
    moroniId = (
      await ctx.prisma.site.findUniqueOrThrow({ where: { name: 'Moroni – Entrepôt central' } })
    ).id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('création', () => {
    it('réserve le stock et fige les instantanés (prix, part, taxes)', async () => {
      const before = await level();
      const order = await createOrder('TO_CUSTOMER', 2);
      expect(order).toMatchObject({
        status: 'NEW',
        number: expect.stringMatching(/^CMD-\d{6}$/),
        total: 28000,
      });
      expect(order.items[0]).toMatchObject({
        unitPrice: 14000,
        sellerShare: 8400,
        sellerTax: 500,
        digecomTax: 500,
        tciBonus: null,
      });
      const after = await level();
      expect(after.available).toBe(before.available - 2);
      expect(after.reserved).toBe(before.reserved + 2);

      // Changer le prix du produit ne change pas la commande.
      await http()
        .patch(`/products/${sacId}`)
        .set(as('ALI'))
        .send({ salePrice: 16000, sellerShareValue: 9600 });
      const reread = (await http().get(`/orders/${order.id}`).set(as('ADMIN'))).body as OrderView;
      expect(reread.items[0]).toMatchObject({ unitPrice: 14000, sellerShare: 8400 });
      await http()
        .patch(`/products/${sacId}`)
        .set(as('ALI'))
        .send({ salePrice: 14000, sellerShareValue: 8400 });
      await act('LOGISTICS_GC', order.id, 'cancel', { reason: 'Nettoyage du test' });
    });

    it('notifie la logistique de l’île et le leader', async () => {
      const before = await notified(PHONES.ALI, 'ORDER_NEW');
      await createOrder('PICKUP');
      expect(await notified(PHONES.ALI, 'ORDER_NEW')).toBe(before + 1);
      expect(await notified(PHONES.LOGISTICS_GC, 'ORDER_NEW')).toBeGreaterThan(0);
    });

    it('refuse un produit d’un autre leader (422) et un stock insuffisant (409)', async () => {
      const nassurProduct = await ctx.prisma.product.findFirstOrThrow({
        where: { leader: { phone: '+2693300013' } },
      });
      const other = await http()
        .post('/orders')
        .set(as('LOGISTICS_GC'))
        .send({
          sellerId: await userId(PHONES.FATIMA),
          items: [{ productId: nassurProduct.id, quantity: 1 }],
          customerName: 'X Y',
          customerPhone: '3321487',
          deliveryMode: 'PICKUP',
        });
      expect(other.status).toBe(422);
      const tooMuch = await http()
        .post('/orders')
        .set(as('LOGISTICS_GC'))
        .send({
          sellerId: await userId(PHONES.FATIMA),
          items: [{ productId: sacId, quantity: 99 }],
          customerName: 'X Y',
          customerPhone: '3321487',
          deliveryMode: 'PICKUP',
        });
      expect(tooMuch.status).toBe(409);
    });

    it('pour le compte de : logistique d’une autre île refusée ; caisse et finance 403', async () => {
      const zainaba = await userId(PHONES.ZAINABA);
      const res = await http()
        .post('/orders')
        .set(as('LOGISTICS_GC'))
        .send({
          sellerId: zainaba,
          items: [{ productId: sacId, quantity: 1 }],
          customerName: 'X Y',
          customerPhone: '3321487',
          deliveryMode: 'PICKUP',
        });
      expect(res.status).toBe(422);
      expect((await http().post('/orders').set(as('FINANCE')).send({})).status).toBe(403);
      expect((await http().get('/orders').set(as('CASHIER_MO'))).status).toBe(403);
    });

    it('le vendeur crée sa propre commande via /me/orders', async () => {
      const res = await http()
        .post('/me/orders')
        .set(as('FATIMA'))
        .send({
          items: [{ productId: sacId, quantity: 1 }],
          customerName: 'Rahma Youssouf',
          customerPhone: '+269 344 71 29',
          deliveryMode: 'TO_SELLER',
        });
      expect(res.status).toBe(201);
      expect(res.body.seller.fullName).toBe('Fatima Said');
      expect(res.body.createdOnBehalfBy).toBeNull();
      const mine = (await http().get('/me/orders').set(as('FATIMA'))).body as Paginated<OrderView>;
      expect(mine.items.every((o) => o.seller.fullName === 'Fatima Said')).toBe(true);
      expect(
        (
          await http()
            .post('/me/orders')
            .set(as('CASHIER_MO'))
            .send({
              items: [{ productId: sacId, quantity: 1 }],
              customerName: 'X Y',
              customerPhone: '3321487',
              deliveryMode: 'PICKUP',
            })
        ).status,
      ).toBe(403);
      await http()
        .post(`/me/orders/${res.body.id}/cancel`)
        .set(as('FATIMA'))
        .send({ reason: 'Client a changé d’avis' })
        .expect(200);
    });
  });

  describe('livraison directe au client', () => {
    let order: OrderView;

    it('prête : aucune offre automatique ; la logistique de l’île est prévenue', async () => {
      order = await createOrder('TO_CUSTOMER');
      await toReady(order.id);
      expect(await offersOf(order.id)).toHaveLength(0);
      expect(
        await ctx.prisma.notification.count({
          where: { type: 'DELIVERY_OFFER', title: { contains: order.number } },
        }),
      ).toBe(0);
      expect(await notified(PHONES.LOGISTICS_GC, 'ORDER_TO_ASSIGN')).toBeGreaterThan(0);
      const karimOffers = (await http().get('/courier/offers').set(as('KARIM'))).body as unknown[];
      expect(karimOffers).toHaveLength(0);
      // Un livreur ne peut pas se servir lui-même.
      expect(
        (await http().post(`/courier/offers/${order.id}/accept`).set(as('KARIM'))).status,
      ).toBe(404);
    });

    it('livreurs proposés : île du site seulement, disponibles puis du plus proche au plus loin', async () => {
      // Site de Moroni et positions des livreurs.
      await ctx.prisma.site.update({
        where: { id: moroniId },
        data: { latitude: -11.7022, longitude: 43.2551 },
      });
      expect((await at('KARIM', -11.7, 43.26)).status).toBe(204); // ≈ 0,6 km
      expect((await at('YOUSSOUF', -11.65, 43.27)).status).toBe(204); // ≈ 6 km
      expect((await at('DJAMAL', -11.7, 43.255)).status).toBe(204); // tout près, mais Anjouan
      expect((await at('FINANCE', -11.7, 43.25)).status).toBe(403);

      const res = await http().get(`/deliveries/${order.id}/candidates`).set(as('LOGISTICS_GC'));
      expect(res.status).toBe(200);
      const list = res.body as {
        fullName: string;
        distanceKm: number | null;
        isAvailable: boolean;
      }[];
      expect(list.map((c) => c.fullName).slice(0, 2)).toEqual(['Karim Bacar', 'Youssouf Ali']);
      expect(list.some((c) => c.fullName === 'Djamal Said')).toBe(false);
      expect(list[0]!.distanceKm).toBeLessThan(1);
      expect(list[1]!.distanceKm).toBeGreaterThan(5);

      // Indisponible : passe derrière, même s'il est le plus proche.
      await ctx.prisma.user.update({
        where: { phone: PHONES.KARIM },
        data: { isAvailable: false },
      });
      const again = (await http().get(`/deliveries/${order.id}/candidates`).set(as('LOGISTICS_GC')))
        .body as { fullName: string }[];
      expect(again[0]!.fullName).toBe('Youssouf Ali');
      await ctx.prisma.user.update({ where: { phone: PHONES.KARIM }, data: { isAvailable: true } });

      // Autre île et rôles sans affectation : refusés.
      expect(
        (await http().get(`/deliveries/${order.id}/candidates`).set(as('STOCK_AN'))).status,
      ).toBe(403);
      expect(
        (await http().get(`/deliveries/${order.id}/candidates`).set(as('FINANCE'))).status,
      ).toBe(403);
    });

    it('affectation par la logistique ; itinéraire : site et position de l’e-commerçant', async () => {
      await at('FATIMA', -11.71, 43.24);
      const r = await assign(order.id, PHONES.KARIM);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ status: 'ASSIGNED', courier: { fullName: 'Karim Bacar' } });
      expect(await notified(PHONES.FATIMA, 'ORDER_ASSIGNED')).toBeGreaterThan(0);
      const run = ((await http().get('/courier/runs').set(as('KARIM'))).body as OrderView[]).find(
        (o) => o.id === order.id,
      )!;
      expect(run.site).toMatchObject({ latitude: -11.7022, longitude: 43.2551 });
      expect(run.sellerLocation).toMatchObject({ latitude: -11.71, longitude: 43.24 });
      // L'e-commerçant voit la position du livreur ; un autre livreur ne voit rien.
      const mine = (
        (await http().get('/me/orders').set(as('FATIMA'))).body as { items: OrderView[] }
      ).items.find((o) => o.id === order.id)!;
      expect(mine.courierLocation).toMatchObject({ latitude: -11.7, longitude: 43.26 });
      expect(mine.sellerLocation).toBeNull();
    });

    it('retrait au site : sortie FIFO, coût figé sur la ligne', async () => {
      const before = await level();
      expect(
        (await http().post(`/courier/runs/${order.id}/pickup`).set(as('YOUSSOUF'))).status,
      ).toBe(404);
      const r = await http().post(`/courier/runs/${order.id}/pickup`).set(as('KARIM'));
      expect(r.status).toBe(200);
      expect(r.body.status).toBe('OUT_FOR_DELIVERY');
      expect(r.body.items[0].unitCost).toBe(2800);
      const after = await level();
      expect(after.reserved).toBe(before.reserved - 1);
      expect(after.available).toBe(before.available);
    });

    it('remise : montant encaissé obligatoire, frais de course figés', async () => {
      expect(
        (await http().post(`/courier/runs/${order.id}/handover`).set(as('KARIM')).send({})).status,
      ).toBe(422);
      const r = await http()
        .post(`/courier/runs/${order.id}/handover`)
        .set(as('KARIM'))
        .send({ amountCollected: 14000 });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        status: 'HANDED_OVER',
        amountCollected: 14000,
        courierFee: 1000,
      });
      expect(await notified(PHONES.FATIMA, 'ORDER_HANDED_OVER')).toBeGreaterThan(0);
    });

    it('client a pris → SOLD ; transition invalide ensuite → 409', async () => {
      const r = await http().post(`/courier/runs/${order.id}/markSold`).set(as('KARIM'));
      expect(r.body.status).toBe('SOLD');
      expect((await act('ADMIN', order.id, 'confirm')).status).toBe(409);
      expect(r.body.events.map((e: { toStatus: string }) => e.toStatus)).toEqual([
        'NEW',
        'CONFIRMED',
        'PREPARING',
        'READY',
        'ASSIGNED',
        'OUT_FOR_DELIVERY',
        'HANDED_OVER',
        'SOLD',
      ]);
      const history = await http().get('/courier/history').set(as('KARIM'));
      expect(history.body.totalFees).toBeGreaterThanOrEqual(1000);
    });
  });

  describe('livraison à l’e-commerçant, refus et retour', () => {
    it('double confirmation livreur + vendeur, puis refus et remise en stock', async () => {
      const start = await level();
      const order = await createOrder('TO_SELLER');
      await toReady(order.id);
      expect((await assign(order.id, PHONES.YOUSSOUF)).status).toBe(200);
      await http().post(`/courier/runs/${order.id}/pickup`).set(as('YOUSSOUF')).expect(200);
      const h = await http()
        .post(`/courier/runs/${order.id}/handover`)
        .set(as('YOUSSOUF'))
        .send({});
      expect(h.body.status).toBe('OUT_FOR_DELIVERY'); // attend la confirmation du vendeur
      expect(await notified(PHONES.FATIMA, 'HANDOVER_TO_CONFIRM')).toBeGreaterThan(0);
      const c = await http()
        .post(`/me/orders/${order.id}/sellerConfirm`)
        .set(as('FATIMA'))
        .send({});
      expect(c.body.status).toBe('HANDED_OVER');

      expect(
        (await http().post(`/me/orders/${order.id}/markRefused`).set(as('FATIMA')).send({})).status,
      ).toBe(422);
      const refused = await http()
        .post(`/me/orders/${order.id}/markRefused`)
        .set(as('FATIMA'))
        .send({ reason: 'Couleur différente' });
      expect(refused.body.status).toBe('RETURN_IN_PROGRESS');
      expect(refused.body.refuseReason).toBe('Couleur différente');
      expect((await level()).available).toBe(start.available - 1);

      expect((await act('LOGISTICS_GC', order.id, 'restock')).status).toBe(403);
      expect((await act('STOCK_AN', order.id, 'restock')).status).toBe(404); // autre île
      const back = await act('ADMIN', order.id, 'restock');
      expect(back.body.status).toBe('RETURNED_TO_STOCK');
      expect(await level()).toMatchObject({ available: start.available, reserved: start.reserved });
    });
  });

  describe('retrait au site', () => {
    it('aucun livreur notifié ; double confirmation site + vendeur', async () => {
      const start = await level();
      const order = await createOrder('PICKUP');
      await toReady(order.id);
      expect(await offersOf(order.id)).toHaveLength(0);
      expect(await notified(PHONES.FATIMA, 'ORDER_READY_PICKUP')).toBeGreaterThan(0);
      const seller = await http()
        .post(`/me/orders/${order.id}/sellerConfirm`)
        .set(as('FATIMA'))
        .send({});
      expect(seller.body.status).toBe('READY');
      const site = await act('LOGISTICS_GC', order.id, 'siteHandover');
      expect(site.body.status).toBe('HANDED_OVER');
      expect(site.body.courierFee).toBeNull();
      expect(await level()).toMatchObject({
        available: start.available - 1,
        reserved: start.reserved,
      });
      const sold = await http().post(`/me/orders/${order.id}/markSold`).set(as('FATIMA')).send({});
      expect(sold.body.status).toBe('SOLD');
      // Émulation : les autres e-commerçants de l'île (et eux seuls) sont notifiés.
      const peerSale = async (phone: string) =>
        ctx.prisma.notification.count({
          where: {
            type: 'PEER_SALE',
            userId: await userId(phone),
            title: { startsWith: '🎉 Fatima a conclu une vente de' },
          },
        });
      expect(await peerSale('+2693300016')).toBeGreaterThan(0); // Mouhidine, Grande Comore
      expect(await peerSale('+2693300018')).toBe(0); // Anrifa, Anjouan
      expect(await peerSale('+2693300011')).toBe(0); // Fatima elle-même
    });
  });

  describe('échec, casse, annulation, changement de mode', () => {
    it('affectation manuelle : même île uniquement ; échec avec motif puis casse', async () => {
      const start = await level();
      const order = await createOrder('TO_CUSTOMER');
      await toReady(order.id);
      expect(
        (
          await http()
            .post(`/deliveries/${order.id}/assign`)
            .set(as('LOGISTICS_GC'))
            .send({ courierId: await userId(PHONES.DJAMAL) })
        ).status,
      ).toBe(422);
      const assigned = await http()
        .post(`/deliveries/${order.id}/assign`)
        .set(as('LOGISTICS_GC'))
        .send({ courierId: await userId(PHONES.KARIM) });
      expect(assigned.body).toMatchObject({
        status: 'ASSIGNED',
        courier: { fullName: 'Karim Bacar' },
      });
      await http().post(`/courier/runs/${order.id}/pickup`).set(as('KARIM')).expect(200);
      expect(
        (await http().post(`/courier/runs/${order.id}/fail`).set(as('KARIM')).send({})).status,
      ).toBe(422);
      const failed = await http()
        .post(`/courier/runs/${order.id}/fail`)
        .set(as('KARIM'))
        .send({ reason: 'Client injoignable' });
      expect(failed.body).toMatchObject({
        status: 'RETURN_IN_PROGRESS',
        failReason: 'Client injoignable',
      });
      const damaged = await act('ADMIN', order.id, 'damaged', { reason: 'Boîte écrasée' });
      expect(damaged.body.status).toBe('DAMAGED');
      expect(await level()).toMatchObject({
        available: start.available - 1,
        reserved: start.reserved,
      });
      expect(
        await ctx.prisma.stockMovement.count({ where: { orderId: order.id, type: 'DAMAGED' } }),
      ).toBe(1);
    });

    it('annulation : stock libéré, offres retirées', async () => {
      const start = await level();
      const order = await createOrder('TO_CUSTOMER', 2);
      await toReady(order.id);
      expect((await act('LOGISTICS_GC', order.id, 'cancel')).status).toBe(422);
      const r = await act('LOGISTICS_GC', order.id, 'cancel', { reason: 'Doublon' });
      expect(r.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'Doublon' });
      expect(await level()).toMatchObject({ available: start.available, reserved: start.reserved });
      expect((await offersOf(order.id)).every((o) => o.response === 'EXPIRED')).toBe(true);
    });

    it('changement de mode avant sortie : vers le retrait, les offres expirent', async () => {
      const order = await createOrder('TO_CUSTOMER');
      await toReady(order.id);
      const r = await act('LOGISTICS_GC', order.id, 'changeMode', { deliveryMode: 'PICKUP' });
      expect(r.body.deliveryMode).toBe('PICKUP');
      expect((await offersOf(order.id)).every((o) => o.response === 'EXPIRED')).toBe(true);
      expect((await act('FINANCE', order.id, 'cancel', { reason: 'Test' })).status).toBe(403);
      await act('LOGISTICS_GC', order.id, 'cancel', { reason: 'Fin du test' });
    });

    it('retour après vente : admin uniquement, avec motif', async () => {
      const order = await createOrder('PICKUP');
      await toReady(order.id);
      await http().post(`/me/orders/${order.id}/sellerConfirm`).set(as('FATIMA')).send({});
      await act('LOGISTICS_GC', order.id, 'siteHandover');
      await http().post(`/me/orders/${order.id}/markSold`).set(as('FATIMA')).send({});
      expect(
        (await act('LOGISTICS_GC', order.id, 'returnAfterSale', { reason: 'Défaut' })).status,
      ).toBe(403);
      const r = await act('ADMIN', order.id, 'returnAfterSale', {
        reason: 'Défaut constaté sous 7 jours',
      });
      expect(r.body.status).toBe('RETURN_IN_PROGRESS');
      await act('ADMIN', order.id, 'restock', { reason: 'Contrôle OK' });
    });
  });

  describe('isolation par île et concurrence', () => {
    it('une commande à Mohéli ne notifie que les livreurs de Mohéli', async () => {
      const mo = await ctx.prisma.island.findUniqueOrThrow({ where: { code: 'MO' } });
      await ctx.prisma.user.create({
        data: {
          fullName: 'Livreur Mohéli',
          phone: '+2693309901',
          role: 'COURIER',
          islandId: mo.id,
          isAvailable: true,
          passwordHash: await hashPassword(PASSWORD),
        },
      });
      const lampe = await ctx.prisma.product.findFirstOrThrow({ where: { name: 'Lampe solaire' } });
      const res = await http()
        .post('/orders')
        .set(as('ADMIN'))
        .send({
          sellerId: await userId(PHONES.ZAINABA),
          items: [{ productId: lampe.id, quantity: 1 }],
          customerName: 'Ahmed Toiwilou',
          customerPhone: '3389012',
          deliveryMode: 'TO_CUSTOMER',
        });
      expect(res.status).toBe(201);
      for (const a of ['confirm', 'prepare', 'ready'])
        expect((await act('ADMIN', res.body.id, a)).status).toBe(200);
      // Aucune offre ni notification aux livreurs ; seuls ceux de Mohéli sont proposés.
      expect(await offersOf(res.body.id)).toHaveLength(0);
      const proposed = (await http().get(`/deliveries/${res.body.id}/candidates`).set(as('ADMIN')))
        .body as { fullName: string }[];
      expect(proposed.map((c) => c.fullName)).toEqual(['Livreur Mohéli']);
      expect((await assign(res.body.id, PHONES.KARIM, 'ADMIN')).status).toBe(422);
      // La logistique de Grande Comore ne voit pas cette commande ; la caisse de Mohéli n'a pas le module.
      expect((await http().get(`/orders/${res.body.id}`).set(as('LOGISTICS_GC'))).status).toBe(404);
    });

    it('réaffectation : le nouveau livreur prend la course, l’ancien ne la voit plus', async () => {
      const order = await createOrder('TO_CUSTOMER');
      await toReady(order.id);
      expect((await assign(order.id, PHONES.KARIM)).status).toBe(200);
      const r = await assign(order.id, PHONES.YOUSSOUF);
      expect(r.body).toMatchObject({ status: 'ASSIGNED', courier: { fullName: 'Youssouf Ali' } });
      const karim = (await http().get('/courier/runs').set(as('KARIM'))).body as OrderView[];
      expect(karim.some((o) => o.id === order.id)).toBe(false);
      expect((await http().post(`/courier/runs/${order.id}/pickup`).set(as('KARIM'))).status).toBe(
        404,
      );
      await act('LOGISTICS_GC', order.id, 'cancel', { reason: 'Fin du test' });
    });

    it('alerte « aucun livreur » après le délai (horloge simulée)', async () => {
      const order = await createOrder('TO_CUSTOMER');
      await toReady(order.id);
      const jobs = ctx.app.get(DeliveryJobs);
      const row = await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(await jobs.check(order.id, new Date(row.readyAt!.getTime() + 9 * 60_000))).toBe(false);
      const before = await notified(PHONES.LOGISTICS_GC, 'NO_COURIER');
      expect(await jobs.check(order.id, new Date(row.readyAt!.getTime() + 11 * 60_000))).toBe(true);
      expect(await notified(PHONES.LOGISTICS_GC, 'NO_COURIER')).toBe(before + 1);
      // Une fois affectée, plus d'alerte.
      await http()
        .post(`/deliveries/${order.id}/assign`)
        .set(as('LOGISTICS_GC'))
        .send({ courierId: await userId(PHONES.KARIM) });
      expect(await jobs.check(order.id, new Date(row.readyAt!.getTime() + 60 * 60_000))).toBe(
        false,
      );
    });
  });

  describe('lecture, tableau, notifications', () => {
    it('tableau des livraisons et livreurs de l’île', async () => {
      const board = await http().get('/deliveries/board').set(as('LOGISTICS_GC'));
      expect(board.status).toBe(200);
      expect(Object.keys(board.body)).toEqual(['waiting', 'inProgress', 'pickupReady', 'issues']);
      const all = [
        ...board.body.waiting,
        ...board.body.inProgress,
        ...board.body.pickupReady,
        ...board.body.issues,
      ] as OrderView[];
      expect(all.every((o) => o.island.code === 'GC')).toBe(true);
      const couriers = await http().get('/deliveries/couriers').set(as('LOGISTICS_GC'));
      expect(couriers.body.every((c: { island: { code: string } }) => c.island.code === 'GC')).toBe(
        true,
      );
      expect((await http().get('/deliveries/board').set(as('CASHIER_MO'))).status).toBe(403);
    });

    it('boutons calculés par la machine à états ; lecture seule pour la finance', async () => {
      const order = await createOrder('PICKUP');
      const logistics = (await http().get(`/orders/${order.id}`).set(as('LOGISTICS_GC')))
        .body as OrderView;
      expect(logistics.actions).toEqual(['confirm', 'cancel', 'changeMode']);
      const finance = (await http().get(`/orders/${order.id}`).set(as('FINANCE')))
        .body as OrderView;
      expect(finance.actions).toEqual([]);
      const list = (await http().get('/orders?q=Hadja&pageSize=5').set(as('ADMIN')))
        .body as Paginated<OrderView>;
      expect(list.items.length).toBeGreaterThan(0);
    });

    it('notifications : liste, non lues, marquer comme lu ; flux SSE sans session → 401', async () => {
      const res = await http().get('/notifications').set(as('FATIMA'));
      expect(res.body.unread).toBeGreaterThan(0);
      await http().post('/notifications/read-all').set(as('FATIMA')).expect(204);
      expect((await http().get('/notifications').set(as('FATIMA'))).body.unread).toBe(0);
      expect((await http().get('/notifications/stream')).status).toBe(401);
    });

    it('stock toujours cohérent : lots restants = disponible + réservé', async () => {
      const lots = await ctx.prisma.lot.aggregate({
        where: { productId: sacId, siteId: moroniId },
        _sum: { remaining: true },
      });
      const l = await level();
      expect(lots._sum.remaining).toBe(l.available + l.reserved);
    });
  });
});
