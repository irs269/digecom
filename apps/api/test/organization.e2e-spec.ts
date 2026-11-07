import {
  businessToday,
  type CreatedUserResponse,
  type LeaderTeamView,
  type Paginated,
  type SettingView,
  type SiteView,
  type UserView,
} from '@digecom/shared';
import request from 'supertest';
import { createTestApp, login, PASSWORD, refreshCookie, type TestContext } from './helpers';

const PHONES = {
  ADMIN: '+2693300001',
  FINANCE: '+2693300002',
  ACCOUNTANT: '+2693300003',
  CASHIER: '+2693300005',
  STOCK: '+2693300006',
  LEADER_S_GC: '+2693300008',
  LEADER_J_GC: '+2693300009',
  TCI_GC: '+2693300010',
  SELLER_GC: '+2693300011',
  LEADER_S_AN: '+2693300013',
  LEADER_S_MO: '+2693300014',
};

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

describe('Organisation, utilisateurs, droits et paramètres (e2e)', () => {
  let ctx: TestContext;
  const tokens: Record<string, string> = {};
  const http = () => request(ctx.app.getHttpServer());
  const as = (who: keyof typeof PHONES) => ({ Authorization: `Bearer ${tokens[who]}` });
  const userId = async (phone: string) =>
    (await ctx.prisma.user.findUniqueOrThrow({ where: { phone } })).id;
  const islandId = async (code: 'GC' | 'AN' | 'MO') =>
    (await ctx.prisma.island.findUniqueOrThrow({ where: { code } })).id;

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

  describe('îles et sites', () => {
    it('GET /islands : tout utilisateur connecté', async () => {
      const res = await http().get('/islands').set(as('CASHIER'));
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
    });

    it("GET /sites : un rôle d'île ne voit que les sites de son île", async () => {
      const all = await http().get('/sites').set(as('ADMIN'));
      expect(all.body).toHaveLength(3);
      const mine = await http().get('/sites').set(as('CASHIER'));
      expect((mine.body as SiteView[]).map((s) => s.island.code)).toEqual(['MO']);
    });

    it('POST /sites : admin 201, comptable 403, nom en double 409', async () => {
      const body = {
        name: 'Moroni – Boutique Volo-Volo',
        type: 'SHOP',
        islandId: await islandId('GC'),
      };
      expect((await http().post('/sites').set(as('ACCOUNTANT')).send(body)).status).toBe(403);
      const created = await http().post('/sites').set(as('ADMIN')).send(body);
      expect(created.status).toBe(201);
      expect((await http().post('/sites').set(as('ADMIN')).send(body)).status).toBe(409);
    });

    it('PATCH /sites/:id et désactivation (jamais de suppression)', async () => {
      const site = await ctx.prisma.site.findUniqueOrThrow({
        where: { name: 'Moroni – Boutique Volo-Volo' },
      });
      const patched = await http()
        .patch(`/sites/${site.id}`)
        .set(as('ADMIN'))
        .send({ address: 'Volo-Volo, Moroni' });
      expect(patched.status).toBe(200);
      expect(patched.body.address).toBe('Volo-Volo, Moroni');
      expect((await http().patch(`/sites/${site.id}`).set(as('FINANCE')).send({})).status).toBe(
        403,
      );

      const off = await http().post(`/sites/${site.id}/deactivate`).set(as('ADMIN'));
      expect(off.body.isActive).toBe(false);
      expect(await ctx.prisma.site.count({ where: { id: site.id } })).toBe(1);
      const visible = (await http().get('/sites').set(as('ADMIN'))).body as SiteView[];
      expect(visible.some((s) => s.id === site.id)).toBe(false);
      const on = await http().post(`/sites/${site.id}/reactivate`).set(as('ADMIN'));
      expect(on.body.isActive).toBe(true);
      expect((await http().post(`/sites/${site.id}/deactivate`).set(as('STOCK'))).status).toBe(403);
    });
  });

  describe('comptes', () => {
    it('GET /users : admin liste et filtre ; les autres rôles 403', async () => {
      const res = await http().get('/users?role=SELLER&pageSize=50').set(as('ADMIN'));
      expect(res.status).toBe(200);
      const page = res.body as Paginated<UserView>;
      expect(page.items.every((u) => u.role === 'SELLER')).toBe(true);
      expect(page.total).toBeGreaterThanOrEqual(6);
      expect(page.items[0]).not.toHaveProperty('passwordHash');

      const search = await http().get('/users?q=Fatima').set(as('ADMIN'));
      expect((search.body as Paginated<UserView>).items.map((u) => u.fullName)).toContain(
        'Fatima Said',
      );

      for (const who of ['FINANCE', 'CASHIER', 'LEADER_S_GC', 'TCI_GC'] as const) {
        expect((await http().get('/users').set(as(who))).status).toBe(403);
      }
    });

    it('GET /users/:id : admin 200, inconnu 404, autre rôle 403', async () => {
      const id = await userId(PHONES.SELLER_GC);
      const ok = await http().get(`/users/${id}`).set(as('ADMIN'));
      expect(ok.status).toBe(200);
      expect(ok.body.leader.fullName).toBe('Ali Mohamed');
      expect((await http().get('/users/inexistant').set(as('ADMIN'))).status).toBe(404);
      expect((await http().get(`/users/${id}`).set(as('ACCOUNTANT'))).status).toBe(403);
    });

    it('crée un e-commerçant avec mot de passe temporaire à changer', async () => {
      const res = await http()
        .post('/users')
        .set(as('ADMIN'))
        .send({
          fullName: 'Nadia Abdou',
          phone: '+269 331 11 22',
          role: 'SELLER',
          islandId: await islandId('GC'),
          leaderId: await userId(PHONES.LEADER_S_GC),
        });
      expect(res.status).toBe(201);
      const body = res.body as CreatedUserResponse;
      expect(body.temporaryPassword).toMatch(/^[A-Za-z]{4}-\d{4}-[A-Za-z]{4}$/);
      expect(body.user.mustChangePassword).toBe(true);
      expect(body.user.phone).toBe('+2693311122');

      // L'audit ne contient jamais le mot de passe temporaire.
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'USER_CREATE', entityId: body.user.id },
      });
      expect(JSON.stringify(audit.after)).not.toContain(body.temporaryPassword);

      // Première connexion : tout est bloqué sauf le profil et le changement de mot de passe.
      const first = await login(ctx.app, '+2693311122', body.temporaryPassword);
      expect(first.status).toBe(200);
      const t = { Authorization: `Bearer ${first.body.accessToken}` };
      expect((await http().get('/auth/me').set(t)).body.mustChangePassword).toBe(true);
      expect((await http().get('/islands').set(t)).body.code).toBe('PASSWORD_CHANGE_REQUIRED');

      const weak = await http()
        .post('/auth/change-password')
        .set(t)
        .send({ currentPassword: body.temporaryPassword, newPassword: 'court' });
      expect(weak.status).toBe(422);
      const wrong = await http()
        .post('/auth/change-password')
        .set(t)
        .send({ currentPassword: 'faux', newPassword: 'Nouveau-mdp-2026' });
      expect(wrong.status).toBe(422);
      const changed = await http()
        .post('/auth/change-password')
        .set(t)
        .set('Cookie', refreshCookie(first))
        .send({ currentPassword: body.temporaryPassword, newPassword: 'Nouveau-mdp-2026' });
      expect(changed.status).toBe(200);
      expect(changed.body.mustChangePassword).toBe(false);
      expect((await http().get('/islands').set(t)).status).toBe(200);
      expect((await login(ctx.app, '+2693311122', 'Nouveau-mdp-2026')).status).toBe(200);
      expect(
        await ctx.prisma.auditLog.count({
          where: { action: 'PASSWORD_CHANGE', entityId: body.user.id },
        }),
      ).toBe(1);
    });

    it('POST /users : un rôle non admin est refusé (403)', async () => {
      const res = await http()
        .post('/users')
        .set(as('FINANCE'))
        .send({ fullName: 'X', phone: '+2693319999', role: 'ADMIN' });
      expect(res.status).toBe(403);
    });

    it('SELLER sans leader → 422', async () => {
      const res = await http()
        .post('/users')
        .set(as('ADMIN'))
        .send({
          fullName: 'Sans Leader',
          phone: '+2693312000',
          role: 'SELLER',
          islandId: await islandId('GC'),
        });
      expect(res.status).toBe(422);
      expect(res.body.details[0].path).toBe('leaderId');
    });

    it('TCI rattaché à un Leader Senior → 422', async () => {
      const res = await http()
        .post('/users')
        .set(as('ADMIN'))
        .send({
          fullName: 'Mauvais Leader',
          phone: '+2693312001',
          role: 'TELECONSULTANT',
          islandId: await islandId('GC'),
          leaderId: await userId(PHONES.LEADER_S_GC),
        });
      expect(res.status).toBe(422);
    });

    it('vendeur et leader sur des îles différentes → 422', async () => {
      const res = await http()
        .post('/users')
        .set(as('ADMIN'))
        .send({
          fullName: 'Autre Île',
          phone: '+2693312002',
          role: 'SELLER',
          islandId: await islandId('GC'),
          leaderId: await userId(PHONES.LEADER_S_AN),
        });
      expect(res.status).toBe(422);
    });

    it("rôle d'île sans île → 422 ; site d'une autre île → 422 ; téléphone pris → 409", async () => {
      const noIsland = await http()
        .post('/users')
        .set(as('ADMIN'))
        .send({ fullName: 'Caissier X', phone: '+2693312003', role: 'CASHIER' });
      expect(noIsland.status).toBe(422);

      const fomboni = await ctx.prisma.site.findUniqueOrThrow({
        where: { name: 'Fomboni – Boutique' },
      });
      const badSite = await http()
        .post('/users')
        .set(as('ADMIN'))
        .send({
          fullName: 'Caissier Y',
          phone: '+2693312004',
          role: 'CASHIER',
          islandId: await islandId('GC'),
          siteId: fomboni.id,
        });
      expect(badSite.status).toBe(422);

      const taken = await http()
        .post('/users')
        .set(as('ADMIN'))
        .send({ fullName: 'Doublon', phone: PHONES.FINANCE, role: 'ACCOUNTANT' });
      expect(taken.status).toBe(409);
      expect(taken.body.code).toBe('PHONE_TAKEN');
    });

    it('PATCH /users/:id : modifie et journalise avant/après ; non admin 403', async () => {
      const id = await userId(PHONES.STOCK);
      const res = await http()
        .patch(`/users/${id}`)
        .set(as('ADMIN'))
        .send({ fullName: 'Nourdine Assoumani Said' });
      expect(res.status).toBe(200);
      expect(res.body.fullName).toBe('Nourdine Assoumani Said');
      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { action: 'USER_UPDATE', entityId: id },
        orderBy: { at: 'desc' },
      });
      expect(audit.before).toMatchObject({ fullName: 'Nourdine Assoumani' });
      expect(audit.after).toMatchObject({ fullName: 'Nourdine Assoumani Said' });
      expect(
        (await http().patch(`/users/${id}`).set(as('CASHIER')).send({ fullName: 'X' })).status,
      ).toBe(403);
    });

    it("un leader qui a une équipe ne change pas de rôle (409) ; l'admin ne change pas son propre rôle", async () => {
      const leader = await userId(PHONES.LEADER_S_GC);
      const res = await http()
        .patch(`/users/${leader}`)
        .set(as('ADMIN'))
        .send({ role: 'LEADER_JUNIOR' });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TEAM_NOT_EMPTY');
      const self = await http()
        .patch(`/users/${await userId(PHONES.ADMIN)}`)
        .set(as('ADMIN'))
        .send({ role: 'ACCOUNTANT' });
      expect(self.status).toBe(409);
    });

    it('désactivation : plus de connexion ni de refresh ; réactivation', async () => {
      const id = await userId(PHONES.ACCOUNTANT);
      const session = await login(ctx.app, PHONES.ACCOUNTANT);
      const cookie = refreshCookie(session);

      expect((await http().post(`/users/${id}/deactivate`).set(as('FINANCE'))).status).toBe(403);
      const off = await http().post(`/users/${id}/deactivate`).set(as('ADMIN'));
      expect(off.status).toBe(200);
      expect(off.body.isActive).toBe(false);

      expect((await login(ctx.app, PHONES.ACCOUNTANT)).body.code).toBe('ACCOUNT_DISABLED');
      expect((await http().post('/auth/refresh').set('Cookie', cookie)).status).toBe(401);
      const access = { Authorization: `Bearer ${session.body.accessToken}` };
      expect((await http().get('/auth/me').set(access)).status).toBe(401);

      const on = await http().post(`/users/${id}/reactivate`).set(as('ADMIN'));
      expect(on.body.isActive).toBe(true);
      expect((await login(ctx.app, PHONES.ACCOUNTANT)).status).toBe(200);

      const self = await http()
        .post(`/users/${await userId(PHONES.ADMIN)}/deactivate`)
        .set(as('ADMIN'));
      expect(self.status).toBe(409);
    });

    it('réinitialisation du mot de passe : déverrouille et impose le changement', async () => {
      const phone = '+2693300004';
      const id = await userId(phone);
      await ctx.prisma.user.update({
        where: { id },
        data: { lockedUntil: new Date(Date.now() + 600_000) },
      });
      expect((await http().post(`/users/${id}/reset-password`).set(as('CASHIER'))).status).toBe(
        403,
      );
      const res = await http().post(`/users/${id}/reset-password`).set(as('ADMIN'));
      expect(res.status).toBe(200);
      expect((await login(ctx.app, phone, PASSWORD)).status).toBe(401);
      const fresh = await login(ctx.app, phone, res.body.temporaryPassword as string);
      expect(fresh.status).toBe(200);
      expect(fresh.body.user.mustChangePassword).toBe(true);
    });
  });

  describe('équipes et réaffectations', () => {
    it('réaffecte un vendeur, historise et journalise', async () => {
      const seller = await userId('+2693300017'); // Hassane Daoud, équipe Ali Mohamed (GC)
      const target = await userId(PHONES.LEADER_S_AN);

      expect(
        (
          await http()
            .post(`/users/${seller}/reassign`)
            .set(as('LEADER_S_GC'))
            .send({ leaderId: target, reason: 'Test' })
        ).status,
      ).toBe(403);

      const wrongType = await http()
        .post(`/users/${seller}/reassign`)
        .set(as('ADMIN'))
        .send({ leaderId: await userId(PHONES.LEADER_J_GC), reason: 'Mauvais type' });
      expect(wrongType.status).toBe(422);

      const res = await http()
        .post(`/users/${seller}/reassign`)
        .set(as('ADMIN'))
        .send({ leaderId: target, reason: 'Déménagement à Anjouan' });
      expect(res.status).toBe(200);
      expect(res.body.leader.fullName).toBe('Nassur Ahmed');
      expect(res.body.island.code).toBe('AN');

      const history = await http().get(`/users/${seller}/team-history`).set(as('ADMIN'));
      expect(history.status).toBe(200);
      expect(history.body[0]).toMatchObject({
        reason: 'Déménagement à Anjouan',
        fromLeader: { fullName: 'Ali Mohamed' },
        toLeader: { fullName: 'Nassur Ahmed' },
      });
      expect((await http().get(`/users/${seller}/team-history`).set(as('FINANCE'))).status).toBe(
        403,
      );
      expect(
        await ctx.prisma.auditLog.count({ where: { action: 'USER_REASSIGN', entityId: seller } }),
      ).toBe(1);

      const all = await http().get('/team-assignments').set(as('ADMIN'));
      expect(all.status).toBe(200);
      expect((await http().get('/team-assignments').set(as('LEADER_S_GC'))).status).toBe(403);
    });

    it('GET /leaders : admin 200, autres 403', async () => {
      const res = await http().get('/leaders').set(as('ADMIN'));
      expect(res.status).toBe(200);
      const ali = (res.body as LeaderTeamView[]).find((t) => t.leader.fullName === 'Ali Mohamed');
      expect(ali?.members.map((m) => m.fullName)).toEqual(
        expect.arrayContaining(['Fatima Said', 'Mouhidine Youssouf']),
      );
      expect((await http().get('/leaders').set(as('CASHIER'))).status).toBe(403);
    });

    it('GET /leaders/:id/team : un leader voit sa propre équipe, pas celle d’un autre (404)', async () => {
      const ali = await userId(PHONES.LEADER_S_GC);
      const nassur = await userId(PHONES.LEADER_S_AN);
      expect((await http().get(`/leaders/${ali}/team`).set(as('LEADER_S_GC'))).status).toBe(200);
      expect((await http().get(`/leaders/${nassur}/team`).set(as('LEADER_S_GC'))).status).toBe(404);
      expect((await http().get(`/leaders/${nassur}/team`).set(as('FINANCE'))).status).toBe(200);
      expect((await http().get(`/leaders/${ali}/team`).set(as('CASHIER'))).status).toBe(403);
      expect((await http().get(`/leaders/${ali}/team`).set(as('TCI_GC'))).status).toBe(403);
    });
  });

  describe('matrice et journal', () => {
    it('GET /permissions/matrix : même source que le code ; admin seulement', async () => {
      const res = await http().get('/permissions/matrix').set(as('ADMIN'));
      expect(res.status).toBe(200);
      expect(res.body.modules).toHaveLength(16);
      expect(res.body.permissions.CASHIER).toEqual({ dashboard: 'L', settlements: 'C', cash: 'C' });
      expect((await http().get('/permissions/matrix').set(as('FINANCE'))).status).toBe(403);
    });

    it('GET /audit : filtres acteur, action, période ; refusé hors admin', async () => {
      const admin = await userId(PHONES.ADMIN);
      const today = businessToday();
      const res = await http()
        .get(`/audit?actorId=${admin}&action=USER_&from=${today}&to=${today}&pageSize=100`)
        .set(as('ADMIN'));
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      expect(res.body.items.every((e: { action: string }) => e.action.startsWith('USER_'))).toBe(
        true,
      );
      const tomorrow = addDays(today, 1);
      const none = await http().get(`/audit?from=${tomorrow}`).set(as('ADMIN'));
      expect(none.body.total).toBe(0);
      expect((await http().get('/audit').set(as('ACCOUNTANT'))).status).toBe(403);
    });
  });

  describe('paramètres versionnés', () => {
    it('GET /settings : admin et finance (lecture) ; comptable 403', async () => {
      const res = await http().get('/settings').set(as('FINANCE'));
      expect(res.status).toBe(200);
      const sub = (res.body as SettingView[]).find((s) => s.key === 'subscription.weekly');
      expect(sub?.current).toBe(10000);
      expect((await http().get('/settings').set(as('ACCOUNTANT'))).status).toBe(403);
    });

    it('POST /settings/:key : finance 403 (lecture seule), admin 201', async () => {
      const body = { value: 12000, effectiveFrom: addDays(businessToday(), 10) };
      expect(
        (await http().post('/settings/subscription.weekly').set(as('FINANCE')).send(body)).status,
      ).toBe(403);
      const res = await http().post('/settings/subscription.weekly').set(as('ADMIN')).send(body);
      expect(res.status).toBe(201);
    });

    it('date passée → 422 ; valeur invalide → 422 ; clé inconnue → 404', async () => {
      const yesterday = addDays(businessToday(), -1);
      const past = await http()
        .post('/settings/subscription.weekly')
        .set(as('ADMIN'))
        .send({ value: 9000, effectiveFrom: yesterday });
      expect(past.status).toBe(422);
      const negative = await http()
        .post('/settings/subscription.weekly')
        .set(as('ADMIN'))
        .send({ value: -5, effectiveFrom: businessToday() });
      expect(negative.status).toBe(422);
      const unknown = await http()
        .post('/settings/inconnu')
        .set(as('ADMIN'))
        .send({ value: 1, effectiveFrom: businessToday() });
      expect(unknown.status).toBe(404);
    });

    it('prime TCI min > max → 422', async () => {
      const res = await http()
        .post('/settings/tci.bonusMin')
        .set(as('ADMIN'))
        .send({ value: 4000, effectiveFrom: businessToday() });
      expect(res.status).toBe(422);
    });

    it('la lecture à une date renvoie la bonne version, sans jamais écraser', async () => {
      const today = businessToday();
      const in10 = addDays(today, 10);
      const in20 = addDays(today, 20);
      expect(
        (
          await http()
            .post('/settings/subscription.weekly')
            .set(as('ADMIN'))
            .send({ value: 15000, effectiveFrom: in20 })
        ).status,
      ).toBe(201);
      // Même date que la version prévue à J+10 → conflit, aucune écrasée.
      const dup = await http()
        .post('/settings/subscription.weekly')
        .set(as('ADMIN'))
        .send({ value: 13000, effectiveFrom: in10 });
      expect(dup.status).toBe(409);

      const at = async (day: string) =>
        (await http().get(`/settings/subscription.weekly?at=${day}`).set(as('ADMIN'))).body.value;
      expect(await at(today)).toBe(10000);
      expect(await at(addDays(today, 9))).toBe(10000);
      expect(await at(in10)).toBe(12000);
      expect(await at(addDays(today, 19))).toBe(12000);
      expect(await at(in20)).toBe(15000);

      expect(await ctx.prisma.setting.count({ where: { key: 'subscription.weekly' } })).toBe(3);
      const view = ((await http().get('/settings').set(as('ADMIN'))).body as SettingView[]).find(
        (s) => s.key === 'subscription.weekly',
      );
      expect(view?.upcoming).toHaveLength(2);
      expect(
        await ctx.prisma.auditLog.count({
          where: { action: 'SETTING_VERSION', entityId: 'subscription.weekly' },
        }),
      ).toBe(2);
    });

    it('une version datée d’aujourd’hui s’applique immédiatement', async () => {
      const res = await http()
        .post('/settings/delivery.feePerRun')
        .set(as('ADMIN'))
        .send({ value: 1200, effectiveFrom: businessToday() });
      expect(res.status).toBe(201);
      const now = await http().get('/settings/delivery.feePerRun').set(as('ADMIN'));
      expect(now.body.value).toBe(1200);
    });
  });
});
