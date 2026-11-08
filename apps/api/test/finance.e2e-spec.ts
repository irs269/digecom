import {
  addDays,
  businessToday,
  type CashSessionView,
  type ExpenseView,
  type NetResult,
  type OrderView,
  type SettlementView,
} from '@digecom/shared';
import request from 'supertest';
import { FinanceJobs } from '../src/finance/finance-jobs';
import { createTestApp, freshIp, login, PASSWORD, type TestContext } from './helpers';

const PHONES = {
  ADMIN: '+2693300001',
  FINANCE: '+2693300002',
  ACCOUNTANT: '+2693300003',
  ASSISTANT: '+2693300004',
  CASHIER_MO: '+2693300005',
  LOGISTICS_GC: '+2693300007',
  FATIMA: '+2693300011',
  KARIM: '+2693300023',
  CASHIER_GC: '+2693300025',
};

describe('Finance (e2e)', () => {
  let ctx: TestContext;
  const tokens: Record<string, string> = {};
  const http = () => request(ctx.app.getHttpServer());
  const as = (who: keyof typeof PHONES) => ({ Authorization: `Bearer ${tokens[who]}` });
  const userId = async (phone: string) =>
    (await ctx.prisma.user.findUniqueOrThrow({ where: { phone } })).id;
  let ecouteurs: string;
  let moroni: string;

  async function soldOrder(mode: 'PICKUP' | 'TO_CUSTOMER' = 'PICKUP'): Promise<OrderView> {
    const created = await http()
      .post('/orders')
      .set(as('LOGISTICS_GC'))
      .send({
        sellerId: await userId(PHONES.FATIMA),
        items: [{ productId: ecouteurs, quantity: 1 }],
        customerName: 'Hadja Mmadi',
        customerPhone: '3321487',
        deliveryMode: mode,
      });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    for (const a of ['confirm', 'prepare', 'ready'])
      await http().post(`/orders/${id}/actions/${a}`).set(as('LOGISTICS_GC')).expect(200);
    if (mode === 'PICKUP') {
      await http().post(`/me/orders/${id}/sellerConfirm`).set(as('FATIMA')).send({}).expect(200);
      await http().post(`/orders/${id}/actions/siteHandover`).set(as('LOGISTICS_GC')).expect(200);
    } else {
      await http()
        .post(`/deliveries/${id}/assign`)
        .set(as('LOGISTICS_GC'))
        .send({ courierId: await userId(PHONES.KARIM) })
        .expect(200);
      await http().post(`/courier/runs/${id}/pickup`).set(as('KARIM')).expect(200);
      await http()
        .post(`/courier/runs/${id}/handover`)
        .set(as('KARIM'))
        .send({ amountCollected: 12500 })
        .expect(200);
    }
    return (await http().get(`/orders/${id}`).set(as('ADMIN'))).body as OrderView;
  }

  const entries = (orderId: string) =>
    ctx.prisma.ledgerEntry.findMany({
      where: { orderId, type: { notIn: ['CASH_IN', 'CASH_OUT'] } },
      orderBy: { type: 'asc' },
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    for (const [key, phone] of Object.entries(PHONES)) {
      const r = await login(ctx.app, phone, PASSWORD, freshIp());
      expect(r.status).toBe(200);
      tokens[key] = r.body.accessToken as string;
    }
    ecouteurs = (
      await ctx.prisma.product.findFirstOrThrow({
        where: { name: 'Écouteurs sans fil', leader: { phone: '+2693300008' } },
      })
    ).id;
    moroni = (
      await ctx.prisma.site.findUniqueOrThrow({ where: { name: 'Moroni – Entrepôt central' } })
    ).id;
    // Réapprovisionne les écouteurs pour les scénarios (LOT au coût de 750).
    await http()
      .post('/stock/entry')
      .set(as('ADMIN'))
      .send({
        productId: ecouteurs,
        siteId: moroni,
        quantity: 20,
        unitCost: 750,
        reason: 'Stock de test',
      })
      .expect(201);
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('écritures de vente', () => {
    it('une commande de 12 500 vendue produit exactement les écritures attendues', async () => {
      const order = await soldOrder('PICKUP');
      expect((await entries(order.id)).map((e) => [e.type, e.amount])).toEqual([]);
      const sold = await http().post(`/me/orders/${order.id}/markSold`).set(as('FATIMA')).send({});
      expect(sold.body.status).toBe('SOLD');
      const rows = await entries(order.id);
      expect(Object.fromEntries(rows.map((e) => [e.type, e.amount]))).toEqual({
        SALE_REVENUE: 12500,
        COGS: 750,
        DIGECOM_TAX: 500,
        SELLER_TAX: 500,
        SELLER_COMMISSION: 7500,
      });
      const fatima = await userId(PHONES.FATIMA);
      expect(rows.find((e) => e.type === 'SELLER_COMMISSION')!.beneficiaryId).toBe(fatima);
    });

    it('livraison directe : frais de course au livreur', async () => {
      const order = await soldOrder('TO_CUSTOMER');
      await http().post(`/courier/runs/${order.id}/markSold`).set(as('KARIM')).expect(200);
      const fee = (await entries(order.id)).find((e) => e.type === 'COURIER_FEE');
      expect(fee).toMatchObject({ amount: 1000, beneficiaryId: await userId(PHONES.KARIM) });
    });

    it('un refus ne produit aucune écriture', async () => {
      const order = await soldOrder('PICKUP');
      await http()
        .post(`/me/orders/${order.id}/markRefused`)
        .set(as('FATIMA'))
        .send({ reason: 'Ne correspond pas' })
        .expect(200);
      expect(await entries(order.id)).toHaveLength(0);
    });

    it('retour après vente : écritures inverses liées et justifiées, jamais supprimées', async () => {
      const order = await soldOrder('PICKUP');
      await http().post(`/me/orders/${order.id}/markSold`).set(as('FATIMA')).send({}).expect(200);
      await http()
        .post(`/orders/${order.id}/actions/returnAfterSale`)
        .set(as('ADMIN'))
        .send({ reason: 'Défaut sous garantie' })
        .expect(200);
      const rows = await entries(order.id);
      const originals = rows.filter((e) => !e.reversalOfId);
      const reversals = rows.filter((e) => e.reversalOfId);
      expect(reversals).toHaveLength(originals.length);
      for (const r of reversals) {
        const o = originals.find((x) => x.id === r.reversalOfId)!;
        expect(r.amount).toBe(-o.amount);
        expect(r.justification).toContain('Défaut sous garantie');
      }
      expect(rows.reduce((s, e) => s + e.amount, 0)).toBe(0);
    });

    it('le grand livre est immuable : UPDATE et DELETE SQL échouent', async () => {
      const e = await ctx.prisma.ledgerEntry.findFirstOrThrow();
      await expect(
        ctx.prisma.$executeRawUnsafe(
          `UPDATE "LedgerEntry" SET "amount" = 1 WHERE "id" = '${e.id}'`,
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        ctx.prisma.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "id" = '${e.id}'`),
      ).rejects.toThrow(/append-only/);
    });

    it('paiement fournisseur enregistré une seule fois à la réception', async () => {
      const lot = await ctx.prisma.purchaseOrder.findUniqueOrThrow({
        where: { number: 'LOT-015' },
      });
      await http()
        .post(`/purchase-orders/${lot.id}/receive`)
        .set(as('ADMIN'))
        .send({ receivedQuantity: 200, paidAmountKmf: 240000 })
        .expect(200);
      const payments = await ctx.prisma.ledgerEntry.findMany({
        where: { purchaseOrderId: lot.id, type: 'SUPPLIER_PAYMENT' },
      });
      expect(payments.map((p) => p.amount)).toEqual([240000]);
    });
  });

  describe('abonnements et relevés', () => {
    it('job d’abonnement idempotent', async () => {
      const jobs = ctx.app.get(FinanceJobs);
      const nextWeek = addDays(businessToday(), 8);
      const first = await jobs.runSubscriptions(nextWeek);
      expect(first).toBeGreaterThan(0);
      expect(await jobs.runSubscriptions(nextWeek)).toBe(0);
      const sellers = await ctx.prisma.user.count({ where: { role: 'SELLER', isActive: true } });
      expect(first).toBe(sellers);
    });

    it('relevé de démonstration de Fatima Said : 10 ventes → 50 000 KMF', async () => {
      const list = (await http().get('/settlements').set(as('ACCOUNTANT')))
        .body as SettlementView[];
      const fatima = list.find((s) => s.seller.fullName === 'Fatima Said')!;
      expect(fatima).toMatchObject({
        salesCount: 10,
        grossCommission: 75000,
        taxes: 5000,
        subscriptions: 20000,
        netToPay: 50000,
        status: 'GENERATED',
        nextAction: 'verify',
      });
      const detail = (await http().get(`/settlements/${fatima.id}`).set(as('ACCOUNTANT')))
        .body as SettlementView;
      expect(detail.lines).toHaveLength(22);
    });

    it('génération idempotente', async () => {
      const r = await http().post('/settlements/generate').set(as('ADMIN')).send({});
      expect(r.status).toBe(200);
      expect(r.body.created).toBe(0);
    });

    it('circuit vérifier → valider → payer avec séparation des tâches', async () => {
      const s = ((await http().get('/settlements').set(as('ADMIN'))).body as SettlementView[]).find(
        (x) => x.seller.fullName === 'Fatima Said',
      )!;
      expect((await http().post(`/settlements/${s.id}/approve`).set(as('FINANCE'))).status).toBe(
        409,
      );
      expect((await http().post(`/settlements/${s.id}/verify`).set(as('FINANCE'))).status).toBe(
        403,
      );
      const verified = await http().post(`/settlements/${s.id}/verify`).set(as('ACCOUNTANT'));
      expect(verified.body).toMatchObject({
        status: 'VERIFIED',
        verifiedBy: { fullName: 'Abdallah Saïd' },
      });
      expect((await http().post(`/settlements/${s.id}/approve`).set(as('ACCOUNTANT'))).status).toBe(
        403,
      );
      const approved = await http().post(`/settlements/${s.id}/approve`).set(as('FINANCE'));
      expect(approved.body.status).toBe('APPROVED');

      // Caisse d'une autre île : relevé invisible. Espèces sans caisse ouverte : refus.
      expect(
        (
          await http()
            .post(`/settlements/${s.id}/pay`)
            .set(as('CASHIER_MO'))
            .send({ paymentMethod: 'CASH' })
        ).status,
      ).toBe(404);
      expect(
        (
          await http()
            .post(`/settlements/${s.id}/pay`)
            .set(as('CASHIER_GC'))
            .send({ paymentMethod: 'CASH' })
        ).status,
      ).toBe(409);
      await http()
        .post('/cash/open')
        .set(as('CASHIER_GC'))
        .send({ siteId: moroni, openingAmount: 100000 })
        .expect(201);
      const paid = await http()
        .post(`/settlements/${s.id}/pay`)
        .set(as('CASHIER_GC'))
        .send({ paymentMethod: 'CASH', paymentRef: 'Reçu 001' });
      expect(paid.body).toMatchObject({
        status: 'PAID',
        paidBy: { fullName: 'Halima Abdou' },
        paymentMethod: 'CASH',
      });
      const payment = await ctx.prisma.ledgerEntry.findFirstOrThrow({
        where: { settlementId: s.id, type: 'SETTLEMENT_PAYMENT' },
      });
      expect(payment.amount).toBe(50000);
      const registers = (await http().get('/cash/registers').set(as('CASHIER_GC'))).body as {
        current: CashSessionView;
      }[];
      expect(registers[0]!.current.totalOut).toBe(50000);
    });

    it('le même utilisateur qui vérifie puis valide → 403 (même l’administrateur)', async () => {
      // Nouveau relevé : vente du cycle courant, génération du cycle courant.
      const order = await soldOrder('PICKUP');
      await http().post(`/me/orders/${order.id}/markSold`).set(as('FATIMA')).send({}).expect(200);
      const start = businessToday();
      const gen = await http()
        .post('/settlements/generate')
        .set(as('ADMIN'))
        .send({ start, end: addDays(start, 14) });
      expect(gen.body.created).toBeGreaterThan(0);
      const s = (
        (await http().get(`/settlements?periodStart=${start}`).set(as('ADMIN')))
          .body as SettlementView[]
      ).find((x) => x.seller.fullName === 'Fatima Said')!;
      await http().post(`/settlements/${s.id}/verify`).set(as('ADMIN')).expect(200);
      const same = await http().post(`/settlements/${s.id}/approve`).set(as('ADMIN'));
      expect(same.status).toBe(403);
    });

    it('relevé PDF', async () => {
      const s = ((await http().get('/settlements').set(as('ADMIN'))).body as SettlementView[])[0]!;
      const res = await http()
        .get(`/settlements/${s.id}/pdf`)
        .set(as('ACCOUNTANT'))
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    });
  });

  describe('caisse', () => {
    it('remise d’argent du livreur, vente comptoir, clôture avec écart', async () => {
      const order = await soldOrder('TO_CUSTOMER');
      const pending = await http().get(`/cash/remittances/${moroni}`).set(as('CASHIER_GC'));
      const karim = pending.body.find(
        (p: { courier: { fullName: string } }) => p.courier.fullName === 'Karim Bacar',
      );
      expect(karim.orders.map((o: { id: string }) => o.id)).toContain(order.id);

      const wrong = await http()
        .post(`/cash/${moroni}/operations`)
        .set(as('CASHIER_GC'))
        .send({
          direction: 'IN',
          category: 'COURIER_REMITTANCE',
          amount: 1,
          courierId: karim.courier.id,
          orderIds: [order.id],
        });
      expect(wrong.status).toBe(422);
      const ok = await http()
        .post(`/cash/${moroni}/operations`)
        .set(as('CASHIER_GC'))
        .send({
          direction: 'IN',
          category: 'COURIER_REMITTANCE',
          amount: 12500,
          courierId: karim.courier.id,
          orderIds: [order.id],
        });
      expect(ok.status).toBe(201);
      const again = await http()
        .post(`/cash/${moroni}/operations`)
        .set(as('CASHIER_GC'))
        .send({
          direction: 'IN',
          category: 'COURIER_REMITTANCE',
          amount: 12500,
          courierId: karim.courier.id,
          orderIds: [order.id],
        });
      expect(again.status).toBe(422);
      await http()
        .post(`/cash/${moroni}/operations`)
        .set(as('CASHIER_GC'))
        .send({ direction: 'IN', category: 'COUNTER_SALE', amount: 3000, label: 'Vente comptoir' })
        .expect(201);

      const before = (await http().get('/cash/registers').set(as('CASHIER_GC'))).body[0]
        .current as CashSessionView;
      const closed = await http()
        .post(`/cash/${moroni}/close`)
        .set(as('CASHIER_GC'))
        .send({ countedAmount: before.expectedAmount - 500 });
      expect(closed.body).toMatchObject({
        status: 'CLOSED',
        difference: -500,
        expectedAmount: before.expectedAmount,
      });
      expect(
        await ctx.prisma.notification.count({ where: { type: 'CASH_DIFFERENCE' } }),
      ).toBeGreaterThan(0);
      expect(
        (
          await http()
            .post(`/cash/${moroni}/operations`)
            .set(as('CASHIER_GC'))
            .send({ direction: 'IN', category: 'OTHER', amount: 1 })
        ).status,
      ).toBe(409);
      expect((await http().get('/cash/registers').set(as('LOGISTICS_GC'))).status).toBe(403);
    });

    it('la caisse de Mohéli ne voit que son site', async () => {
      const regs = (await http().get('/cash/registers').set(as('CASHIER_MO'))).body as {
        site: { name: string };
      }[];
      expect(regs.map((r) => r.site.name)).toEqual(['Fomboni – Boutique']);
      expect(
        (
          await http()
            .post('/cash/open')
            .set(as('CASHIER_MO'))
            .send({ siteId: moroni, openingAmount: 0 })
        ).status,
      ).toBe(404);
    });

    it('solde bancaire : saisie comptable', async () => {
      await http()
        .post('/cash/bank-balance')
        .set(as('ASSISTANT'))
        .send({ date: businessToday(), amount: 2_500_000, source: 'Relevé BIC novembre' })
        .expect(201);
      expect((await http().get('/cash/bank-balance').set(as('CASHIER_GC'))).body.amount).toBe(
        2_500_000,
      );
      expect(
        (
          await http()
            .post('/cash/bank-balance')
            .set(as('CASHIER_GC'))
            .send({ date: businessToday(), amount: 1, source: 'X X' })
        ).status,
      ).toBe(403);
    });
  });

  describe('dépenses et résultat net', () => {
    let gc: string;
    beforeAll(async () => {
      gc = (await ctx.prisma.island.findUniqueOrThrow({ where: { code: 'GC' } })).id;
    });

    it('saisie → validation par le responsable financier (pas sa propre saisie) → écriture', async () => {
      const created = await http().post('/expenses').set(as('ASSISTANT')).send({
        category: 'RENT',
        label: 'Loyer entrepôt Moroni',
        amount: 150000,
        islandId: gc,
        periodDate: businessToday(),
      });
      expect(created.status).toBe(201);
      expect(created.body.status).toBe('PENDING');
      expect(
        (await http().post(`/expenses/${created.body.id}/approve`).set(as('ASSISTANT'))).status,
      ).toBe(403);
      const approved = await http().post(`/expenses/${created.body.id}/approve`).set(as('FINANCE'));
      expect(approved.body.status).toBe('APPROVED');
      expect(
        await ctx.prisma.ledgerEntry.count({
          where: { expenseId: created.body.id, type: 'EXPENSE' },
        }),
      ).toBe(1);

      const own = await http().post('/expenses').set(as('ADMIN')).send({
        category: 'BANK_FEES',
        label: 'Frais de tenue de compte',
        amount: 4500,
        islandId: gc,
        periodDate: businessToday(),
      });
      expect((await http().post(`/expenses/${own.body.id}/approve`).set(as('ADMIN'))).status).toBe(
        403,
      );
      expect((await http().post('/expenses').set(as('CASHIER_GC')).send({})).status).toBe(403);
    });

    it('dépense validée : annulation par écriture inverse justifiée', async () => {
      const list = (await http().get('/expenses?status=APPROVED').set(as('FINANCE')))
        .body as ExpenseView[];
      const rent = list.find((e) => e.label === 'Loyer entrepôt Moroni')!;
      const r = await http()
        .post(`/expenses/${rent.id}/reverse`)
        .set(as('FINANCE'))
        .send({ reason: 'Doublon de saisie' });
      expect(r.body.reversed).toBe(true);
      const sum = await ctx.prisma.ledgerEntry.aggregate({
        where: { expenseId: rent.id, type: 'EXPENSE' },
        _sum: { amount: true },
      });
      expect(sum._sum.amount).toBe(0);
      expect(
        (
          await http()
            .post(`/expenses/${rent.id}/reverse`)
            .set(as('FINANCE'))
            .send({ reason: 'Encore' })
        ).status,
      ).toBe(409);
    });

    it('résultat net = marge après coût et taxes − frais de course − charges validées', async () => {
      const expense = await http().post('/expenses').set(as('ASSISTANT')).send({
        category: 'ADVERTISING',
        label: 'Campagne Facebook',
        amount: 60000,
        islandId: gc,
        periodDate: businessToday(),
      });
      await http().post(`/expenses/${expense.body.id}/approve`).set(as('FINANCE')).expect(200);
      const today = businessToday();
      const res = (
        await http()
          .get(`/finance/result?from=${addDays(today, -60)}&to=${today}&islandId=${gc}`)
          .set(as('FINANCE'))
      ).body as NetResult;
      expect(res.marginAfterTax).toBe(res.digecomShare - res.cost - res.digecomTax);
      expect(res.netResult).toBe(res.marginAfterTax - res.courierFees - res.expenses);
      expect(res.expenses).toBe(60000);
      expect(
        (await http().get(`/finance/result?from=${today}&to=${today}`).set(as('CASHIER_GC')))
          .status,
      ).toBe(403);
    });

    it('encart « vente de référence » : calcul réel d’une vente vendue', async () => {
      const r = await http().get('/finance/sale-breakdown').set(as('ADMIN'));
      expect(r.status).toBe(200);
      expect(r.body.order.sale).toMatchObject({
        revenue: 12500,
        sellerGross: 7500,
        digecomShare: 5000,
        marginAfterTax: expect.any(Number),
      });
      expect((await http().get('/finance/sale-breakdown').set(as('LOGISTICS_GC'))).status).toBe(
        403,
      );
    });
  });
});
