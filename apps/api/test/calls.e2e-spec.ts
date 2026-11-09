import type { CallEvent, CallView, LiveEvent, OrderView, StartCallResponse } from '@digecom/shared';
import request from 'supertest';
import { turnCredentials } from '../src/calls/calls.service';
import { LiveService } from '../src/notifications/live.service';
import { createTestApp, freshIp, login, PASSWORD, type TestContext } from './helpers';

const PHONES = {
  LOGISTICS_GC: '+2693300007',
  CASHIER_MO: '+2693300005',
  FATIMA: '+2693300011', // e-commerçante GC
  KARIM: '+2693300023', // livreur GC
  YOUSSOUF: '+2693300024', // livreur GC, étranger à la commande
  ADMIN: '+2693300001',
  ALI: '+2693300008', // Leader Senior de Fatima
  DJAMAL: '+2693300012', // livreur AN
};

describe('Appels dans l’application (e2e)', () => {
  let ctx: TestContext;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const http = () => request(ctx.app.getHttpServer());
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  /** Événements d'appel reçus en temps réel, par utilisateur. */
  const inbox: Record<string, CallEvent[]> = {};
  let order: OrderView;

  const waitFor = async (who: string, type: CallEvent['type']) => {
    for (let i = 0; i < 50; i++) {
      const hit = inbox[who]!.find((e) => e.type === type);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`Aucun événement « ${type} » pour ${who}`);
  };
  const start = (who: string, orderId = order.id) =>
    http().post('/calls').set(as(who)).send({ orderId });
  const end = (who: string, id: string, reason = 'hangup') =>
    http().post(`/calls/${id}/end`).set(as(who)).send({ reason });

  beforeAll(async () => {
    ctx = await createTestApp();
    const live = ctx.app.get(LiveService);
    for (const [key, phone] of Object.entries(PHONES)) {
      const res = await login(ctx.app, phone, PASSWORD, freshIp());
      tokens[key] = res.body.accessToken as string;
      ids[key] = (await ctx.prisma.user.findUniqueOrThrow({ where: { phone } })).id;
      inbox[key] = [];
      live.subscribe(ids[key]!, (e: LiveEvent) => {
        if (e.kind === 'call') inbox[key]!.push(e.event);
      });
    }
    const product = await ctx.prisma.product.findFirstOrThrow({
      where: { name: 'Sac à main', leader: { phone: '+2693300008' } },
    });
    const created = await http()
      .post('/orders')
      .set(as('LOGISTICS_GC'))
      .send({
        sellerId: ids.FATIMA,
        items: [{ productId: product.id, quantity: 1 }],
        customerName: 'Hadja Mmadi',
        customerPhone: '+269 332 14 87',
        deliveryMode: 'TO_SELLER',
      });
    order = created.body as OrderView;
  });
  beforeEach(() => Object.values(inbox).forEach((l) => (l.length = 0)));
  afterAll(async () => {
    await ctx.close();
  });

  it('refuse un appel tant qu’aucun livreur n’a la commande', async () => {
    const res = await start('FATIMA');
    expect(res.status).toBe(409);
  });

  it('e-commerçant → livreur : sonnerie, décroché, relais WebRTC, fin et durée', async () => {
    for (const a of ['confirm', 'prepare', 'ready']) {
      await http().post(`/orders/${order.id}/actions/${a}`).set(as('LOGISTICS_GC')).send({});
    }
    const assigned = await http()
      .post(`/deliveries/${order.id}/assign`)
      .set(as('LOGISTICS_GC'))
      .send({ courierId: ids.KARIM });
    expect(assigned.body.status).toBe('ASSIGNED');

    const res = await start('FATIMA');
    expect(res.status).toBe(201);
    const { call, iceServers } = res.body as StartCallResponse;
    expect(call).toMatchObject({
      status: 'RINGING',
      orderNumber: order.number,
      caller: { fullName: 'Fatima Said', role: 'SELLER' },
      callee: { fullName: 'Karim Bacar', role: 'COURIER' },
    });
    expect(iceServers[0]!.urls).toContain('stun:');

    const incoming = await waitFor('KARIM', 'incoming');
    expect(incoming).toMatchObject({ call: { id: call.id } });
    expect(inbox.YOUSSOUF).toHaveLength(0);

    // Un tiers ne peut ni décrocher ni relayer.
    expect((await http().post(`/calls/${call.id}/accept`).set(as('YOUSSOUF'))).status).toBe(404);
    expect(
      (
        await http()
          .post(`/calls/${call.id}/signal`)
          .set(as('YOUSSOUF'))
          .send({ type: 'offer', payload: { sdp: 'x' } })
      ).status,
    ).toBe(404);
    // L'appelant ne peut pas décrocher à la place du destinataire.
    expect((await http().post(`/calls/${call.id}/accept`).set(as('FATIMA'))).status).toBe(404);

    const accepted = await http().post(`/calls/${call.id}/accept`).set(as('KARIM'));
    expect(accepted.status).toBe(200);
    expect(accepted.body.call.status).toBe('ACCEPTED');
    await waitFor('FATIMA', 'accepted');

    const offer = { type: 'offer', payload: { type: 'offer', sdp: 'v=0…' } };
    expect(
      (await http().post(`/calls/${call.id}/signal`).set(as('FATIMA')).send(offer)).status,
    ).toBe(204);
    expect(await waitFor('KARIM', 'signal')).toEqual({
      type: 'signal',
      callId: call.id,
      signal: offer,
    });

    await ctx.prisma.call.update({
      where: { id: call.id },
      data: { answeredAt: new Date(Date.now() - 42_000) },
    });
    const ended = await end('KARIM', call.id);
    expect(ended.body).toMatchObject({ status: 'ENDED' });
    expect((ended.body as CallView).durationSeconds).toBeGreaterThanOrEqual(41);
    await waitFor('FATIMA', 'ended');
    // Fin en double : sans effet.
    expect((await end('FATIMA', call.id)).body.status).toBe('ENDED');
  });

  it('livreur → e-commerçant refusé : « refusé » ; un seul appel à la fois', async () => {
    const { call } = (await start('KARIM')).body as StartCallResponse;
    expect(call.callee.role).toBe('SELLER');
    // Fatima est déjà sollicitée : pas de second appel vers elle.
    expect((await start('KARIM')).status).toBe(409);
    expect((await end('FATIMA', call.id)).body.status).toBe('DECLINED');
    await waitFor('KARIM', 'ended');
  });

  it('appel annulé avant décroché : « annulé » et notification d’appel manqué', async () => {
    const { call } = (await start('FATIMA')).body as StartCallResponse;
    expect((await end('FATIMA', call.id)).body.status).toBe('CANCELLED');
    const missed = await ctx.prisma.notification.count({
      where: { userId: ids.KARIM, type: 'CALL_MISSED' },
    });
    expect(missed).toBe(1);
  });

  it('sonnerie trop longue : « manqué » ; l’appel n’est plus décrochable', async () => {
    const { call } = (await start('FATIMA')).body as StartCallResponse;
    const ringing = await http().get('/calls/ringing').set(as('KARIM'));
    expect(ringing.body.call.id).toBe(call.id);
    await ctx.prisma.call.update({
      where: { id: call.id },
      data: { createdAt: new Date(Date.now() - 60_000) },
    });
    expect((await http().get('/calls/ringing').set(as('KARIM'))).body).toEqual({});
    expect((await http().post(`/calls/${call.id}/accept`).set(as('KARIM'))).status).toBe(409);
  });

  it('journal : participants et logistique de l’île ; autre île et tiers refusés', async () => {
    const mine = await http().get(`/calls?orderId=${order.id}`).set(as('FATIMA'));
    expect(mine.status).toBe(200);
    const statuses = (mine.body as CallView[]).map((c) => c.status);
    expect([...statuses].sort()).toEqual(['CANCELLED', 'DECLINED', 'ENDED', 'MISSED']);
    expect((await http().get(`/calls?orderId=${order.id}`).set(as('LOGISTICS_GC'))).status).toBe(
      200,
    );
    expect((await http().get(`/calls?orderId=${order.id}`).set(as('CASHIER_MO'))).status).toBe(404);
    expect((await http().get(`/calls?orderId=${order.id}`).set(as('YOUSSOUF'))).status).toBe(404);
    expect((await start('YOUSSOUF')).status).toBe(404);
    // La logistique n'est pas partie de la commande : pas d'appel « par la commande ».
    expect((await start('LOGISTICS_GC')).status).toBe(404);
    expect((await start('CASHIER_MO')).status).toBe(403);
  });

  describe('appels directs (annuaire)', () => {
    const direct = (who: string, target: string) =>
      http().post('/calls').set(as(who)).send({ userId: ids[target] });
    const contacts = async (who: string) =>
      (await http().get('/calls/contacts').set(as(who))).body as { fullName: string; id: string }[];

    it('annuaire selon le rôle : logistique (son île), leader (son équipe), admin (tous)', async () => {
      const log = await contacts('LOGISTICS_GC');
      const logIds = log.map((c) => c.id);
      expect(logIds).toEqual(expect.arrayContaining([ids.KARIM, ids.YOUSSOUF, ids.FATIMA]));
      expect(logIds).not.toContain(ids.DJAMAL);
      expect(logIds).not.toContain(ids.CASHIER_MO);
      expect((await contacts('ALI')).map((c) => c.id)).toContain(ids.FATIMA);
      expect((await contacts('ALI')).map((c) => c.id)).not.toContain(ids.KARIM);
      const fatima = (await contacts('FATIMA')).map((c) => c.id);
      expect(fatima).toEqual(expect.arrayContaining([ids.LOGISTICS_GC, ids.ALI, ids.ADMIN]));
      expect(fatima).not.toContain(ids.KARIM);
      expect((await contacts('ADMIN')).length).toBeGreaterThan(10);
      expect(await contacts('CASHIER_MO')).toEqual([]);
    });

    it('logistique → livreur de son île : appel sans commande, décroché, journal personnel', async () => {
      const res = await direct('LOGISTICS_GC', 'KARIM');
      expect(res.status).toBe(201);
      const { call } = res.body as StartCallResponse;
      expect(call).toMatchObject({ orderId: null, orderNumber: null, status: 'RINGING' });
      expect((await waitFor('KARIM', 'incoming')).type).toBe('incoming');
      expect((await http().post(`/calls/${call.id}/accept`).set(as('KARIM'))).status).toBe(200);
      expect((await end('LOGISTICS_GC', call.id)).body.status).toBe('ENDED');
      const mine = (await http().get('/calls/mine').set(as('KARIM'))).body as CallView[];
      expect(mine[0]).toMatchObject({ id: call.id, caller: { role: 'LOGISTICS_ASSISTANT' } });
    });

    it('refuse hors règle : autre île, entre livreurs, rôle non autorisé', async () => {
      expect((await direct('LOGISTICS_GC', 'DJAMAL')).status).toBe(404);
      expect((await direct('KARIM', 'YOUSSOUF')).status).toBe(404);
      expect((await direct('CASHIER_MO', 'ADMIN')).status).toBe(403);
      expect((await http().post('/calls').set(as('ADMIN')).send({})).status).toBe(422);
    });

    it('e-commerçant → son leader, puis admin → e-commerçant', async () => {
      const a = (await direct('FATIMA', 'ALI')).body as StartCallResponse;
      expect(a.call.callee.role).toBe('LEADER_SENIOR');
      await end('FATIMA', a.call.id);
      const b = (await direct('ADMIN', 'FATIMA')).body as StartCallResponse;
      expect(b.call.caller.role).toBe('ADMIN');
      expect((await end('FATIMA', b.call.id)).body.status).toBe('DECLINED');
    });
  });

  it('identifiants TURN temporaires au format coturn (HMAC-SHA1)', () => {
    const { username, credential } = turnCredentials('secret', 'u1', 3600, 1_000_000_000);
    expect(username).toBe('1003600:u1');
    expect(credential).toBe(
      require('node:crypto').createHmac('sha1', 'secret').update(username).digest('base64'),
    );
  });
});
