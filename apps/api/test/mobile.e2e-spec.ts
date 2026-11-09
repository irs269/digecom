import type { LoginResponse, SellerBalanceView } from '@digecom/shared';
import request from 'supertest';
import { SEED_USERS } from '../prisma/seed-data';
import { buildMessages } from '../src/notifications/expo-push.provider';
import { createTestApp, login, type TestContext } from './helpers';

const SELLER = SEED_USERS.find((u) => u.role === 'SELLER')!.phone;
const COURIER = SEED_USERS.find((u) => u.role === 'COURIER')!.phone;

describe('API mobile (e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  const token = async (phone: string) =>
    ((await login(ctx.app, phone)).body as LoginResponse).accessToken;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });

  describe('appareils (push)', () => {
    it('enregistre un téléphone, le réattribue au dernier compte, puis le retire', async () => {
      const seller = await token(SELLER);
      const courier = await token(COURIER);
      const device = { token: 'ExponentPushToken[test-appareil-1]', platform: 'android' };

      expect(
        (await http().post('/me/devices').auth(seller, { type: 'bearer' }).send(device)).status,
      ).toBe(204);
      expect(
        (await http().post('/me/devices').auth(courier, { type: 'bearer' }).send(device)).status,
      ).toBe(204);
      const row = await ctx.prisma.device.findUniqueOrThrow({ where: { token: device.token } });
      const courierUser = await ctx.prisma.user.findUniqueOrThrow({ where: { phone: COURIER } });
      expect(row.userId).toBe(courierUser.id);

      // Le vendeur ne peut pas retirer le téléphone du livreur.
      await http()
        .delete(`/me/devices/${encodeURIComponent(device.token)}`)
        .auth(seller, { type: 'bearer' });
      expect(await ctx.prisma.device.count({ where: { token: device.token } })).toBe(1);

      const del = await http()
        .delete(`/me/devices/${encodeURIComponent(device.token)}`)
        .auth(courier, { type: 'bearer' });
      expect(del.status).toBe(204);
      expect(await ctx.prisma.device.count({ where: { token: device.token } })).toBe(0);
    });

    it('refuse un jeton invalide (422)', async () => {
      const res = await http()
        .post('/me/devices')
        .auth(await token(SELLER), { type: 'bearer' })
        .send({ token: 'x', platform: 'android' });
      expect(res.status).toBe(422);
    });

    it('les offres de course partent sur le canal « courses » en priorité haute', () => {
      const [offer] = buildMessages(['t'], { type: 'DELIVERY_OFFER', title: 'Course', body: 'b' });
      const [other] = buildMessages(['t'], { type: 'ORDER_SOLD', title: 'Vente', body: 'b' });
      expect(offer).toMatchObject({ channelId: 'courses', priority: 'high', sound: 'default' });
      expect(other).toMatchObject({ channelId: 'default', priority: 'default' });
    });
  });

  describe('solde e-commerçant', () => {
    it('renvoie le cycle en cours et ses relevés', async () => {
      const res = await http()
        .get('/me/balance')
        .auth(await token(SELLER), { type: 'bearer' });
      expect(res.status).toBe(200);
      const body = res.body as SellerBalanceView;
      expect(body.cycle.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(body.current.estimatedNet).toBe(
        body.current.commission - body.current.taxes - body.current.subscriptions,
      );
      expect(Array.isArray(body.statements)).toBe(true);
      expect(body.statements.every((s) => s.seller.phone === SELLER)).toBe(true);
    });

    it('est réservé aux e-commerçants', async () => {
      const res = await http()
        .get('/me/balance')
        .auth(await token(COURIER), { type: 'bearer' });
      expect(res.status).toBe(403);
    });
  });

  describe('Idempotency-Key', () => {
    it('rejoue la réponse sans refaire l’action', async () => {
      const courier = await token(COURIER);
      const key = `test-${Date.now()}-dispo`;
      const first = await http()
        .patch('/courier/availability')
        .auth(courier, { type: 'bearer' })
        .set('Idempotency-Key', key)
        .send({ isAvailable: false });
      expect(first.status).toBe(200);
      expect(first.headers['idempotent-replayed']).toBeUndefined();

      const audits = await ctx.prisma.auditLog.count({ where: { action: 'COURIER_AVAILABILITY' } });
      const replay = await http()
        .patch('/courier/availability')
        .auth(courier, { type: 'bearer' })
        .set('Idempotency-Key', key)
        .send({ isAvailable: false });
      expect(replay.status).toBe(200);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.body).toEqual(first.body);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'COURIER_AVAILABILITY' } })).toBe(
        audits,
      );

      // Remise à l'état disponible pour les autres tests.
      await http()
        .patch('/courier/availability')
        .auth(courier, { type: 'bearer' })
        .send({ isAvailable: true });
    });

    it('libère la clé après un échec', async () => {
      const seller = await token(SELLER);
      const key = `test-${Date.now()}-echec`;
      const fail = () =>
        http()
          .post('/me/orders/inconnue/markSold')
          .auth(seller, { type: 'bearer' })
          .set('Idempotency-Key', key)
          .send({});
      expect((await fail()).status).toBe(404);
      const again = await fail();
      expect(again.status).toBe(404);
      expect(again.headers['idempotent-replayed']).toBeUndefined();
    });

    it('refuse une clé mal formée', async () => {
      const res = await http()
        .patch('/courier/availability')
        .auth(await token(COURIER), { type: 'bearer' })
        .set('Idempotency-Key', 'a b')
        .send({ isAvailable: true });
      expect(res.status).toBe(422);
    });
  });
});
