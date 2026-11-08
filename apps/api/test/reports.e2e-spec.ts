import {
  addDays,
  businessToday,
  settlementCycle,
  startOfBusinessDay,
  type DashboardView,
  type NetworkView,
  type ReportView,
} from '@digecom/shared';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, freshIp, login, PASSWORD, type TestContext } from './helpers';

const PHONES = {
  ADMIN: '+2693300001',
  FINANCE: '+2693300002',
  CASHIER_MO: '+2693300005',
  STOCK_AN: '+2693300006',
  LOGISTICS_GC: '+2693300007',
  ALI: '+2693300008', // Leader Senior GC
  RACHAD: '+2693300009', // Leader Junior GC
  ANLIA: '+2693300010', // TCI
  FATIMA: '+2693300011', // e-commerçante d'Ali
  NASSUR: '+2693300013', // Leader Senior AN
  ANRIFA: '+2693300018', // e-commerçante de Nassur
};

/** Binaire supertest (XLSX / PDF). */
const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('Tableaux de bord, réseau et rapports (e2e)', () => {
  let ctx: TestContext;
  const tokens: Record<string, string> = {};
  const http = () => request(ctx.app.getHttpServer());
  const as = (who: keyof typeof PHONES) => ({ Authorization: `Bearer ${tokens[who]}` });
  const userId = async (phone: string) =>
    (await ctx.prisma.user.findUniqueOrThrow({ where: { phone } })).id;
  const today = businessToday();
  const from = addDays(today, -60);
  const period = `from=${from}&to=${today}`;

  /** Requête de référence : CA et quantité des commandes SOLD de la période (Prisma, sans SQL). */
  async function reference(
    where: { leaderId?: string; islandId?: string },
    start: string,
    end: string,
  ) {
    const items = await ctx.prisma.orderItem.findMany({
      where: {
        order: {
          status: 'SOLD',
          soldAt: { gte: startOfBusinessDay(start), lt: startOfBusinessDay(addDays(end, 1)) },
          ...where,
        },
      },
    });
    return {
      revenue: items.reduce((s, i) => s + i.quantity * i.unitPrice, 0),
      quantity: items.reduce((s, i) => s + i.quantity, 0),
      cost: items.reduce((s, i) => s + i.quantity * (i.unitCost ?? 0), 0),
      margin: items.reduce(
        (s, i) =>
          s +
          i.quantity *
            (i.unitPrice -
              (i.sellerShare ?? 0) -
              (i.tciBonus ?? 0) -
              (i.unitCost ?? 0) -
              i.digecomTax),
        0,
      ),
    };
  }

  async function cycle() {
    const settings = await ctx.prisma.setting.findMany({
      where: { key: { in: ['settlement.anchorDate', 'settlement.cycleDays'] } },
      orderBy: { effectiveFrom: 'desc' },
    });
    const anchor = settings.find((s) => s.key === 'settlement.anchorDate')!.value as string;
    const days = settings.find((s) => s.key === 'settlement.cycleDays')!.value as number;
    const c = settlementCycle(anchor, days, today);
    return { start: c.start, end: addDays(c.end, -1) };
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    for (const [key, phone] of Object.entries(PHONES)) {
      const r = await login(ctx.app, phone, PASSWORD, freshIp());
      expect(r.status).toBe(200);
      tokens[key] = r.body.accessToken as string;
    }
  });

  afterAll(async () => {
    await ctx?.close();
  });

  // --- Tableaux de bord ----------------------------------------------------------------------

  it('direction : chaque bloc égale la requête de référence sur le seed', async () => {
    const res = await http().get('/dashboard').set(as('ADMIN')).expect(200);
    const d = res.body as DashboardView;
    const c = await cycle();
    expect(d.period).toMatchObject(c);
    const ref = await reference({}, c.start, c.end);
    const k = Object.fromEntries(d.kpis.map((x) => [x.key, x.value]));
    expect(k.revenue).toBe(ref.revenue);
    expect(k.margin).toBe(ref.margin);
    expect(k.sales).toBe(
      await ctx.prisma.order.count({
        where: {
          status: 'SOLD',
          soldAt: { gte: startOfBusinessDay(c.start), lt: startOfBusinessDay(addDays(c.end, 1)) },
        },
      }),
    );
    const todo = Object.fromEntries(d.todo.map((t) => [t.key, t.count]));
    expect(todo.toVerify).toBe(
      await ctx.prisma.settlement.count({ where: { status: 'GENERATED' } }),
    );
    expect(todo.expenses).toBe(await ctx.prisma.expense.count({ where: { status: 'PENDING' } }));
    expect(d.islands?.reduce((s, i) => s + i.revenue, 0)).toBe(ref.revenue);
    expect(d.recentOrders?.length).toBeGreaterThan(0);
    for (const kpi of d.kpis) expect(kpi.link).toBeTruthy();
  });

  it('filtre île : CA de Grande Comore seulement', async () => {
    const gc = await ctx.prisma.island.findUniqueOrThrow({ where: { code: 'GC' } });
    const res = await http().get(`/dashboard?islandId=${gc.id}`).set(as('FINANCE')).expect(200);
    const c = await cycle();
    const ref = await reference({ islandId: gc.id }, c.start, c.end);
    expect((res.body as DashboardView).kpis.find((k) => k.key === 'revenue')!.value).toBe(
      ref.revenue,
    );
  });

  it('chaque rôle a son tableau de bord', async () => {
    const expected: Record<string, string[]> = {
      CASHIER_MO: ['cashBalance', 'collectedToday', 'toPay', 'toClose'],
      STOCK_AN: ['stockValue', 'units', 'alerts', 'inTransit'],
      LOGISTICS_GC: ['new', 'noCourier', 'delivering', 'incidents'],
      ALI: ['teamSales', 'teamRevenue', 'activeSellers', 'remaining'],
      RACHAD: ['budget', 'contacts', 'sold', 'costPerSale'],
      ANLIA: ['toCall', 'soldWeek', 'weekEarnings', 'totalEarnings'],
    };
    for (const [who, keys] of Object.entries(expected)) {
      const res = await http()
        .get('/dashboard')
        .set(as(who as keyof typeof PHONES))
        .expect(200);
      expect((res.body as DashboardView).kpis.map((k) => k.key)).toEqual(keys);
    }
  });

  it('Leader Senior : CA, actifs et quantités restantes de son équipe', async () => {
    const res = await http().get('/dashboard').set(as('ALI')).expect(200);
    const d = res.body as DashboardView;
    const c = await cycle();
    const ali = await userId(PHONES.ALI);
    const ref = await reference({ leaderId: ali }, c.start, c.end);
    const k = Object.fromEntries(d.kpis.map((x) => [x.key, x.value]));
    expect(k.teamRevenue).toBe(ref.revenue);
    expect(k.teamSales).toBe(ref.quantity);
    expect(k.activeSellers).toBe(
      await ctx.prisma.user.count({
        where: { leaderId: ali, isActive: true, role: { in: ['SELLER', 'TELECONSULTANT'] } },
      }),
    );
    const allocated = await ctx.prisma.sellerAllocation.aggregate({
      where: { leaderId: ali },
      _sum: { quantity: true },
    });
    expect(allocated._sum.quantity).toBeGreaterThan(0);
    expect(k.remaining).toBeLessThanOrEqual(allocated._sum.quantity!);
    expect(d.ranking?.rows.every((r) => r.remaining !== undefined)).toBe(true);
  });

  it('cache : une écriture invalide le tableau de bord', async () => {
    const first = (await http().get('/dashboard').set(as('ADMIN')).expect(200))
      .body as DashboardView;
    const again = (await http().get('/dashboard').set(as('ADMIN')).expect(200))
      .body as DashboardView;
    expect(again.generatedAt).toBe(first.generatedAt);
    const admin = await userId(PHONES.ADMIN);
    const island = await ctx.prisma.island.findFirstOrThrow();
    // Écriture par le client Prisma de l'application (celui qu'observe le cache).
    await ctx.app.get(PrismaService).expense.create({
      data: {
        category: 'OTHER',
        label: 'Test cache',
        amount: 1000,
        islandId: island.id,
        periodDate: startOfBusinessDay(today),
        createdById: admin,
      },
    });
    const after = (await http().get('/dashboard').set(as('ADMIN')).expect(200))
      .body as DashboardView;
    expect(after.generatedAt).not.toBe(first.generatedAt);
    expect(after.todo.find((t) => t.key === 'expenses')!.count).toBe(
      first.todo.find((t) => t.key === 'expenses')!.count + 1,
    );
  });

  // --- Rapports ------------------------------------------------------------------------------

  it('simulation 100 produits : tableau exact de la SPEC §4.1', async () => {
    const res = await http().get(`/reports/simulation?${period}`).set(as('ADMIN')).expect(200);
    const values = Object.fromEntries(
      (res.body as ReportView).rows.map((r) => [r.indicator, r.amount]),
    );
    expect(values).toEqual({
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
  });

  it('tous les rapports répondent ; les ventes concordent entre rapports', async () => {
    const totals: Record<string, Record<string, number>> = {};
    for (const t of [
      'daily',
      'weekly',
      'monthly',
      'product',
      'lot',
      'seller',
      'leader',
      'island',
      'expenses',
      'margins',
      'settlements',
      'stock',
      'campaigns',
      'tci',
      'couriers',
    ]) {
      const res = await http().get(`/reports/${t}?${period}`).set(as('ADMIN'));
      expect(res.status).toBe(200);
      totals[t] = (res.body as ReportView).totals;
    }
    const ref = await reference({}, from, today);
    for (const t of ['daily', 'weekly', 'monthly', 'product', 'seller', 'leader', 'island'])
      expect(totals[t]!.revenue).toBe(ref.revenue);
    expect(totals.daily!.marginAfterTax).toBe(ref.margin);
    expect(totals.product!.cost).toBe(ref.cost);
  });

  it('export XLSX relu : totaux égaux à l’API, onglet Paramètres', async () => {
    const json = (await http().get(`/reports/product?${period}`).set(as('FINANCE')).expect(200))
      .body as ReportView;
    const res = await http()
      .get(`/reports/product?${period}&format=xlsx`)
      .set(as('FINANCE'))
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.getRow(1).font?.bold).toBe(true);
    const last = ws.getRow(ws.rowCount);
    expect(last.getCell(1).value).toBe('Total');
    json.columns.forEach((c, i) => {
      if (!c.total) return;
      const cell = last.getCell(i + 1).value as { formula: string; result: number };
      expect(cell.formula).toMatch(/^SUM\(/);
      expect(cell.result).toBe(json.totals[c.key]);
    });
    const revenueCol = json.columns.findIndex((c) => c.key === 'revenue') + 1;
    expect(ws.getColumn(revenueCol).numFmt).toContain('#,##0');
    const sum = json.rows.reduce((s, r) => s + Number(r.revenue), 0);
    let fromSheet = 0;
    for (let r = 2; r < ws.rowCount; r++)
      fromSheet += Number(ws.getRow(r).getCell(revenueCol).value);
    expect(fromSheet).toBe(sum);
    expect(wb.getWorksheet('Paramètres du rapport')).toBeTruthy();
  });

  it('export PDF : document paginé', async () => {
    const res = await http()
      .get(`/reports/seller?${period}&format=pdf`)
      .set(as('ADMIN'))
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('leader : son équipe seulement ; autre équipe → 404 ; rapport global → 403', async () => {
    const nassur = await userId(PHONES.NASSUR);
    await http().get(`/reports/seller?${period}&leaderId=${nassur}`).set(as('ALI')).expect(404);
    await http().get(`/reports/margins?${period}`).set(as('ALI')).expect(403);
    const mine = (await http().get(`/reports/seller?${period}`).set(as('ALI')).expect(200))
      .body as ReportView;
    const ali = await userId(PHONES.ALI);
    expect(mine.totals.revenue).toBe((await reference({ leaderId: ali }, from, today)).revenue);
    const list = (await http().get('/reports').set(as('ALI')).expect(200)).body as {
      type: string;
    }[];
    expect(list.map((r) => r.type)).not.toContain('margins');
    await http().get(`/reports/daily?${period}`).set(as('CASHIER_MO')).expect(403);
  });

  // --- Réseau commercial ---------------------------------------------------------------------

  it('réseau : Ali attribue à son équipe, pas à celle de Nassur ; jamais sous le commandé', async () => {
    const product = await ctx.prisma.product.findFirstOrThrow({
      where: { leader: { phone: PHONES.ALI }, isPublished: true },
    });
    const fatima = await userId(PHONES.FATIMA);
    const before = (await http().get('/network').set(as('ALI')).expect(200)).body as NetworkView;
    expect(before.teams).toHaveLength(1);
    const member = before.teams[0]!.members.find((m) => m.id === fatima)!;
    await http()
      .post('/network/allocations')
      .set(as('ALI'))
      .send({ sellerId: fatima, productId: product.id, quantity: 5 })
      .expect(201);
    const after = (await http().get('/network').set(as('ALI')).expect(200)).body as NetworkView;
    expect(after.teams[0]!.members.find((m) => m.id === fatima)!.allocated).toBe(
      member.allocated + 5,
    );
    await http()
      .post('/network/allocations')
      .set(as('ALI'))
      .send({ sellerId: await userId(PHONES.ANRIFA), productId: product.id, quantity: 5 })
      .expect(404);
    await http()
      .post('/network/allocations')
      .set(as('ALI'))
      .send({ sellerId: fatima, productId: product.id, quantity: -1000 })
      .expect(422);
    await http()
      .post('/network/allocations')
      .set(as('RACHAD'))
      .send({ sellerId: fatima, productId: product.id, quantity: 1 })
      .expect(403);
    const all = (await http().get('/network').set(as('FINANCE')).expect(200)).body as NetworkView;
    expect(all.teams.length).toBeGreaterThan(3);
    const audit = await ctx.prisma.auditLog.count({ where: { action: 'NETWORK_ALLOCATE' } });
    expect(audit).toBe(1);
  });

  it('objectif atteint : notification une seule fois par semaine', async () => {
    const ali = await userId(PHONES.ALI);
    await http()
      .put(`/network/targets/${ali}`)
      .set(as('ALI'))
      .send({ weeklyRevenue: 1 })
      .expect(200);
    const targets = ctx.app.get((await import('../src/reports/insights.module')).SalesTargets);
    const hasSales = (await reference({ leaderId: ali }, addDays(today, -7), today)).revenue > 0;
    const first = await targets.check(ali);
    const second = await targets.check(ali);
    expect(second).toBe(false);
    if (hasSales) expect(first).toBe(true);
    const n = await ctx.prisma.notification.count({
      where: { userId: ali, type: 'TARGET_REACHED' },
    });
    expect(n).toBe(first ? 1 : 0);
    await http()
      .put(`/network/targets/${await userId(PHONES.NASSUR)}`)
      .set(as('ALI'))
      .send({ weeklyRevenue: 1 })
      .expect(404);
  });

  // --- Notifications -------------------------------------------------------------------------

  it('préférences : enregistrées par utilisateur, in-app toujours créé', async () => {
    await http()
      .put('/notifications/preferences')
      .set(as('FATIMA'))
      .send({ ORDER_NEW: { push: false }, SETTLEMENT_PAID: { sms: true } })
      .expect(200);
    const res = await http().get('/notifications/preferences').set(as('FATIMA')).expect(200);
    expect(res.body).toEqual({ ORDER_NEW: { push: false }, SETTLEMENT_PAID: { sms: true } });
    await http().put('/notifications/preferences').set(as('FATIMA')).send({ bad: 1 }).expect(422);
  });
});
