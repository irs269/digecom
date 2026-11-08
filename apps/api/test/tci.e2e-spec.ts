import {
  businessToday,
  addDays,
  type CampaignView,
  type OrderView,
  type ProspectView,
  type TciEarnings,
} from '@digecom/shared';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { createTestApp, freshIp, login, PASSWORD, type TestContext } from './helpers';

const PHONES = {
  ADMIN: '+2693300001',
  FINANCE: '+2693300002',
  LOGISTICS_GC: '+2693300007',
  RACHAD: '+2693300009', // Leader Junior GC
  ANLIA: '+2693300010', // TCI de Rachad
  FAIZA: '+2693300021', // TCI de Rachad
  KAMARIA: '+2693300015', // Leader Junior AN
  BACAR: '+2693300022', // TCI de Kamaria
  KARIM: '+2693300023',
  CASHIER_MO: '+2693300005',
};

describe('Leaders Junior, prospects et gains TCI (e2e)', () => {
  let ctx: TestContext;
  const tokens: Record<string, string> = {};
  const http = () => request(ctx.app.getHttpServer());
  const as = (who: keyof typeof PHONES) => ({ Authorization: `Bearer ${tokens[who]}` });
  const userId = async (phone: string) =>
    (await ctx.prisma.user.findUniqueOrThrow({ where: { phone } })).id;
  let montre: string;
  let campaignId: string;

  const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

  async function deliver(orderId: string) {
    for (const a of ['confirm', 'prepare', 'ready'])
      await http().post(`/orders/${orderId}/actions/${a}`).set(as('LOGISTICS_GC')).expect(200);
    await http()
      .post(`/deliveries/${orderId}/assign`)
      .set(as('LOGISTICS_GC'))
      .send({ courierId: await userId(PHONES.KARIM) })
      .expect(200);
    await http().post(`/courier/runs/${orderId}/pickup`).set(as('KARIM')).expect(200);
    await http()
      .post(`/courier/runs/${orderId}/handover`)
      .set(as('KARIM'))
      .send({ amountCollected: 17000 })
      .expect(200);
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    for (const [key, phone] of Object.entries(PHONES)) {
      const r = await login(ctx.app, phone, PASSWORD, freshIp());
      expect(r.status).toBe(200);
      tokens[key] = r.body.accessToken as string;
    }
    montre = (
      await ctx.prisma.product.findFirstOrThrow({ where: { name: 'Montre connectée Sport' } })
    ).id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('gains du prototype', () => {
    it('Anlia Hassani : 47 500 vendus / 8 500 de gains / 68 000 globaux, une vente à clôturer', async () => {
      const r = (await http().get('/tci/me/earnings').set(as('ANLIA'))).body as TciEarnings;
      expect(r).toMatchObject({
        soldAmount: 47500,
        soldCount: 3,
        weekEarnings: 8500,
        totalEarnings: 68000,
      });
      expect(r.toClose).toHaveLength(1);
      expect(r.byProduct.map((p) => [p.product, p.count, p.bonus, p.total])).toEqual([
        ['Montre connectée Sport', 2, 3000, 6000],
        ['Blender portable', 1, 2500, 2500],
      ]);

      // Clôture de la vente livrée → 11 500 de gains cette semaine.
      const closed = await http()
        .post(`/tci/sales/${r.toClose[0]!.id}/close`)
        .set(as('ANLIA'))
        .send({ result: 'SOLD' });
      expect(closed.body.status).toBe('SOLD');
      const after = (await http().get('/tci/me/earnings').set(as('ANLIA'))).body as TciEarnings;
      expect(after).toMatchObject({ weekEarnings: 11500, totalEarnings: 71000, soldAmount: 64500 });
      expect(after.toClose).toHaveLength(0);
      expect(
        await ctx.prisma.ledgerEntry.count({
          where: { orderId: r.toClose[0]!.id, type: 'TCI_BONUS', amount: 3000 },
        }),
      ).toBe(1);
    });

    it('équipe du Leader Junior : tableau par TCI ; un autre leader ne voit pas cette équipe', async () => {
      const team = (await http().get('/tci/team/earnings').set(as('RACHAD'))).body as TciEarnings;
      expect(team.byTci!.map((t) => t.tci.fullName).sort()).toEqual([
        'Anlia Hassani',
        'Faïza Mohamed',
      ]);
      expect(team.byTci!.find((t) => t.tci.fullName === 'Faïza Mohamed')!.totalEarnings).toBe(
        33500,
      );
      expect(
        (
          await http()
            .get(`/tci/team/earnings?leaderId=${await userId(PHONES.KAMARIA)}`)
            .set(as('RACHAD'))
        ).status,
      ).toBe(404);
      const bacar = (await http().get('/tci/team/earnings').set(as('KAMARIA'))).body as TciEarnings;
      expect(bacar.byTci!.map((t) => [t.tci.fullName, t.totalEarnings])).toEqual([
        ['Bacar Toybou', 20000],
      ]);
      expect((await http().get('/tci/team/earnings').set(as('CASHIER_MO'))).status).toBe(403);
    });

    it('semaine précédente au format ISO', async () => {
      const week = (await http().get('/tci/me/earnings').set(as('ANLIA'))).body.week
        .start as string;
      const prev = addDays(week, -7);
      const isoPrev = (await http().get(`/tci/me/earnings?week=${'2026-W01'}`).set(as('ANLIA')))
        .status;
      expect(isoPrev).toBe(200);
      expect((await http().get('/tci/me/earnings?week=bad').set(as('ANLIA'))).status).toBe(422);
      expect(prev < week).toBe(true);
    });
  });

  describe('campagnes', () => {
    it('création par le Leader Junior : produit de son catalogue, budget = dépense à valider', async () => {
      const today = businessToday();
      const other = await ctx.prisma.product.findFirstOrThrow({ where: { name: 'Sac à main' } });
      expect(
        (
          await http()
            .post('/campaigns')
            .set(as('RACHAD'))
            .send({
              name: 'Hors catalogue',
              productId: other.id,
              channel: 'FACEBOOK',
              budget: 1000,
              startDate: today,
              endDate: addDays(today, 10),
            })
        ).status,
      ).toBe(422);
      const res = await http()
        .post('/campaigns')
        .set(as('RACHAD'))
        .send({
          name: 'Montre Sport – Décembre',
          productId: montre,
          channel: 'WHATSAPP',
          budget: 50000,
          startDate: today,
          endDate: addDays(today, 14),
        });
      expect(res.status).toBe(201);
      const c = res.body as CampaignView;
      expect(c).toMatchObject({
        number: 'CP-08',
        status: 'ACTIVE',
        contacts: 0,
        costPerSale: null,
        expense: { status: 'PENDING' },
      });
      const expense = await ctx.prisma.expense.findUniqueOrThrow({ where: { id: c.expense!.id } });
      expect(expense).toMatchObject({
        category: 'ADVERTISING',
        amount: 50000,
        campaignId: c.id,
        leaderId: await userId(PHONES.RACHAD),
      });
      campaignId = c.id;
      expect((await http().post('/campaigns').set(as('ANLIA')).send({})).status).toBe(403);
    });

    it('pause / relance ; un autre leader → 404 ; indicateurs CP-07', async () => {
      expect(
        (await http().post(`/campaigns/${campaignId}/pause`).set(as('RACHAD'))).body.status,
      ).toBe('PAUSED');
      expect(
        (await http().post(`/campaigns/${campaignId}/resume`).set(as('RACHAD'))).body.status,
      ).toBe('ACTIVE');
      expect((await http().post(`/campaigns/${campaignId}/pause`).set(as('KAMARIA'))).status).toBe(
        404,
      );
      const list = (await http().get('/campaigns').set(as('RACHAD'))).body as CampaignView[];
      const cp07 = list.find((x) => x.number === 'CP-07')!;
      expect(cp07.sold).toBeGreaterThan(0);
      expect(cp07.costPerSale).toBe(Math.round(75000 / cp07.sold));
      expect(list.find((x) => x.number === 'CP-06')!.status).toBe('ENDED');
      expect((await http().get('/campaigns').set(as('KAMARIA'))).body).toEqual([]);
    });

    it('budget déjà validé par la finance : modification refusée', async () => {
      const c = await ctx.prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
      await http().post(`/expenses/${c.expenseId}/approve`).set(as('FINANCE')).expect(200);
      expect(
        (await http().patch(`/campaigns/${campaignId}`).set(as('RACHAD')).send({ budget: 60000 }))
          .status,
      ).toBe(409);
      expect(
        (
          await http()
            .patch(`/campaigns/${campaignId}`)
            .set(as('RACHAD'))
            .send({ name: 'Montre Sport – Fêtes' })
        ).body.name,
      ).toBe('Montre Sport – Fêtes');
    });
  });

  describe('import et répartition des prospects', () => {
    it('aperçu puis import CSV : doublons, numéros invalides, rapport exact', async () => {
      const csv = [
        'nom;téléphone;note',
        'Mariam Abdou;331 20 45;',
        'Youssouf Mmadi;342 88 10;rappeler après 17h',
        'Doublon;3312045;',
        'Numéro faux;123;',
        ';3330001;',
        'Ibrahim Said;+269 344 55 66;',
      ].join('\n');
      const preview = await http()
        .post(`/campaigns/${campaignId}/prospects/import`)
        .set(as('RACHAD'))
        .send({ fileName: 'contacts.csv', contentBase64: b64(csv), dryRun: true });
      expect(preview.body).toMatchObject({ rows: 6, imported: 3, duplicates: 1, invalid: 2 });
      expect(await ctx.prisma.prospect.count({ where: { campaignId } })).toBe(0);

      const done = await http()
        .post(`/campaigns/${campaignId}/prospects/import`)
        .set(as('RACHAD'))
        .send({ fileName: 'contacts.csv', contentBase64: b64(csv), dryRun: false });
      expect(done.body).toMatchObject({ imported: 3, batchId: expect.any(String) });
      const batch = await ctx.prisma.prospectImportBatch.findUniqueOrThrow({
        where: { id: done.body.batchId },
      });
      expect(batch).toMatchObject({ rows: 6, imported: 3, duplicates: 1 });
      expect(batch.errors).toHaveLength(3);

      // Réimport : tout est en doublon.
      const again = await http()
        .post(`/campaigns/${campaignId}/prospects/import`)
        .set(as('RACHAD'))
        .send({ fileName: 'contacts.csv', contentBase64: b64(csv), dryRun: true });
      expect(again.body).toMatchObject({ imported: 0, duplicates: 4 });
      expect(
        (
          await http()
            .post(`/campaigns/${campaignId}/prospects/import`)
            .set(as('ANLIA'))
            .send({ fileName: 'x.csv', contentBase64: b64(csv) })
        ).status,
      ).toBe(403);
    });

    it('import XLSX et saisie manuelle', async () => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Contacts');
      ws.addRow(['Nom', 'Téléphone', 'Note']);
      ws.addRow(['Housna Madi', '336 47 03', 'Vue sur Facebook']);
      ws.addRow(['Kamal Abdou', '3406615', '']);
      const buffer = Buffer.from(await wb.xlsx.writeBuffer());
      const r = await http()
        .post(`/campaigns/${campaignId}/prospects/import`)
        .set(as('RACHAD'))
        .send({
          fileName: 'contacts.xlsx',
          contentBase64: buffer.toString('base64'),
          dryRun: false,
        });
      expect(r.body).toMatchObject({ rows: 2, imported: 2 });
      const manual = await http()
        .post(`/campaigns/${campaignId}/prospects`)
        .set(as('RACHAD'))
        .send({ fullName: 'Saïd Abdallah', phone: '347 02 11' });
      expect(manual.status).toBe(201);
      expect(
        (
          await http()
            .post(`/campaigns/${campaignId}/prospects`)
            .set(as('RACHAD'))
            .send({ fullName: 'Doublon', phone: '3470211' })
        ).status,
      ).toBe(409);
    });

    it('répartition équitable entre les TCI actifs, avec notification', async () => {
      const r = await http()
        .post(`/campaigns/${campaignId}/prospects/assign`)
        .set(as('RACHAD'))
        .send({ mode: 'auto' });
      expect(r.body.assigned).toBe(6);
      const counts = r.body.byTci.map((t: { count: number }) => t.count).sort();
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
      expect(
        await ctx.prisma.notification.count({
          where: { type: 'PROSPECTS_ASSIGNED', user: { phone: PHONES.FAIZA } },
        }),
      ).toBeGreaterThan(0);
      expect(
        (
          await http()
            .post(`/campaigns/${campaignId}/prospects/assign`)
            .set(as('RACHAD'))
            .send({ mode: 'auto' })
        ).body.assigned,
      ).toBe(0);
    });
  });

  describe('appels, confirmation et clôture', () => {
    let mine: ProspectView[];

    it('un TCI ne voit que ses prospects ; ceux d’un autre → 404', async () => {
      mine = (await http().get(`/prospects?campaignId=${campaignId}`).set(as('ANLIA')))
        .body as ProspectView[];
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.every((p) => p.tci?.fullName === 'Anlia Hassani')).toBe(true);
      const faizas = (await http().get(`/prospects?campaignId=${campaignId}`).set(as('FAIZA')))
        .body as ProspectView[];
      expect(faizas.some((p) => mine.some((m) => m.id === p.id))).toBe(false);
      expect(
        (
          await http()
            .post(`/prospects/${faizas[0]!.id}/call`)
            .set(as('ANLIA'))
            .send({ outcome: 'UNREACHABLE' })
        ).status,
      ).toBe(404);
      expect(
        (
          await http()
            .post(`/prospects/${faizas[0]!.id}/confirm`)
            .set(as('ANLIA'))
            .send({ customerName: 'X Y', customerPhone: '3321487' })
        ).status,
      ).toBe(404);
      const team = (await http().get(`/prospects?campaignId=${campaignId}`).set(as('RACHAD')))
        .body as ProspectView[];
      expect(team).toHaveLength(6);
      expect((await http().get('/prospects').set(as('CASHIER_MO'))).status).toBe(403);
    });

    it('injoignable : tentative comptée, reste à rappeler ; leader ne peut pas appeler', async () => {
      const r = await http()
        .post(`/prospects/${mine[0]!.id}/call`)
        .set(as('ANLIA'))
        .send({ outcome: 'UNREACHABLE', note: 'Messagerie' });
      expect(r.body).toMatchObject({ status: 'UNREACHABLE', attempts: 1 });
      expect(r.body.note).toContain('Messagerie');
      expect(
        (
          await http()
            .post(`/prospects/${mine[0]!.id}/call`)
            .set(as('RACHAD'))
            .send({ outcome: 'NOT_INTERESTED' })
        ).status,
      ).toBe(403);
    });

    it('scénario complet : prospect → commande → livraison → « Vendu » → +3 000 de gains', async () => {
      const before = (await http().get('/tci/me/earnings').set(as('ANLIA'))).body as TciEarnings;
      const p = mine[0]!;
      const r = await http().post(`/prospects/${p.id}/confirm`).set(as('ANLIA')).send({
        customerName: p.fullName,
        customerPhone: p.phone,
        customerAddress: 'Itsandra',
        zone: 'Moroni Nord',
      });
      expect(r.status).toBe(201);
      const order = r.body.order as OrderView;
      expect(order).toMatchObject({
        sellerType: 'TELECONSULTANT',
        deliveryMode: 'TO_CUSTOMER',
        status: 'NEW',
      });
      expect(order.items[0]).toMatchObject({ tciBonus: 3000, sellerShare: null, sellerTax: 0 });
      expect(r.body.prospect).toMatchObject({
        status: 'CONFIRMED',
        order: { number: order.number },
      });
      expect(
        (
          await http()
            .post(`/prospects/${p.id}/confirm`)
            .set(as('ANLIA'))
            .send({ customerName: 'X Y', customerPhone: '3321487' })
        ).status,
      ).toBe(409);

      await deliver(order.id);
      const mid = (await http().get('/tci/me/earnings').set(as('ANLIA'))).body as TciEarnings;
      expect(mid.toClose.map((o) => o.id)).toContain(order.id);
      expect(mid.weekEarnings).toBe(before.weekEarnings);

      expect(
        (
          await http()
            .post(`/tci/sales/${order.id}/close`)
            .set(as('FAIZA'))
            .send({ result: 'SOLD' })
        ).status,
      ).toBe(404);
      await http()
        .post(`/tci/sales/${order.id}/close`)
        .set(as('ANLIA'))
        .send({ result: 'SOLD' })
        .expect(200);
      const after = (await http().get('/tci/me/earnings').set(as('ANLIA'))).body as TciEarnings;
      expect(after.weekEarnings - before.weekEarnings).toBe(3000);
      expect(after.totalEarnings - before.totalEarnings).toBe(3000);
      const campaign = (
        (await http().get('/campaigns').set(as('RACHAD'))).body as CampaignView[]
      ).find((c) => c.id === campaignId)!;
      expect(campaign).toMatchObject({ confirmed: 1, sold: 1, costPerSale: 50000 });
    });

    it('refus après livraison : aucune prime', async () => {
      const p = mine[1]!;
      const before = (await http().get('/tci/me/earnings').set(as('ANLIA'))).body as TciEarnings;
      const r = await http()
        .post(`/prospects/${p.id}/confirm`)
        .set(as('ANLIA'))
        .send({ customerName: p.fullName, customerPhone: p.phone });
      await deliver(r.body.order.id);
      expect(
        (
          await http()
            .post(`/tci/sales/${r.body.order.id}/close`)
            .set(as('ANLIA'))
            .send({ result: 'REFUSED' })
        ).status,
      ).toBe(422);
      const refused = await http()
        .post(`/tci/sales/${r.body.order.id}/close`)
        .set(as('ANLIA'))
        .send({ result: 'REFUSED', reason: 'A changé d’avis' });
      expect(refused.body.status).toBe('RETURN_IN_PROGRESS');
      const after = (await http().get('/tci/me/earnings').set(as('ANLIA'))).body as TciEarnings;
      expect(after.totalEarnings).toBe(before.totalEarnings);
      expect(await ctx.prisma.ledgerEntry.count({ where: { orderId: r.body.order.id } })).toBe(0);
    });

    it('prime modifiée après une vente : la vente garde l’ancienne prime', async () => {
      const p = mine[2] ?? mine[0]!;
      const fresh = await http()
        .post(`/campaigns/${campaignId}/prospects`)
        .set(as('RACHAD'))
        .send({ fullName: 'Nouveau Client', phone: '339 99 88' });
      await http()
        .post(`/campaigns/${campaignId}/prospects/assign`)
        .set(as('RACHAD'))
        .send({ mode: 'manual', tciId: await userId(PHONES.ANLIA), prospectIds: [fresh.body.id] })
        .expect(200);
      const r = await http()
        .post(`/prospects/${fresh.body.id}/confirm`)
        .set(as('ANLIA'))
        .send({ customerName: 'Nouveau Client', customerPhone: '3399988' });
      expect(r.body.order.items[0].tciBonus).toBe(3000);
      await http().post(`/products/${montre}/tci-bonus/up`).set(as('RACHAD')).expect(200);
      const reread = (await http().get(`/orders/${r.body.order.id}`).set(as('ADMIN')))
        .body as OrderView;
      expect(reread.items[0]!.tciBonus).toBe(3000);
      await http().post(`/products/${montre}/tci-bonus/down`).set(as('RACHAD')).expect(200);
      expect(p).toBeDefined();
    });
  });
});
