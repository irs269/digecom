import { allowedModules, type LoginResponse, type MeResponse } from '@digecom/shared';
import request from 'supertest';
import { SEED_USERS } from '../prisma/seed-data';
import {
  createTestApp,
  freshIp,
  login,
  PASSWORD,
  refreshCookie,
  type TestContext,
} from './helpers';

const ADMIN = '+2693300001';
const CASHIER = '+2693300005';
const FINANCE = '+2693300002';

describe('Auth (e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('POST /auth/login', () => {
    it('connecte un compte valide (jeton 15 min + cookie refresh httpOnly)', async () => {
      const res = await login(ctx.app, ADMIN);
      expect(res.status).toBe(200);
      const body = res.body as LoginResponse;
      expect(body.accessToken).toEqual(expect.any(String));
      expect(body.expiresIn).toBe(900);
      expect(body.user.role).toBe('ADMIN');
      expect(body.user.modules).toHaveLength(16);
      const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith('dc_rt='),
      );
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Secure/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
    });

    it('accepte un téléphone saisi avec espaces et sans indicatif', async () => {
      const res = await login(ctx.app, '330 00 01');
      expect(res.status).toBe(200);
    });

    it('refuse un mauvais mot de passe (401)', async () => {
      const res = await login(ctx.app, FINANCE, 'mauvais');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ code: 'INVALID_CREDENTIALS', message: expect.any(String) });
    });

    it('refuse un téléphone inconnu (401, même message)', async () => {
      const res = await login(ctx.app, '+2693999999');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('renvoie 422 sur une saisie invalide', async () => {
      const res = await http().post('/auth/login').send({ phone: 'abc' });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'phone' })]),
      );
    });

    it('verrouille le compte 15 min après 5 échecs, même depuis une autre IP', async () => {
      const phone = '+2693300003';
      let last: request.Response | undefined;
      for (let i = 0; i < 5; i++) last = await login(ctx.app, phone, 'faux', freshIp());
      expect(last!.status).toBe(401);
      expect(last!.body.code).toBe('ACCOUNT_LOCKED');

      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { phone } });
      expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);

      const withGoodPassword = await login(ctx.app, phone, PASSWORD, freshIp());
      expect(withGoodPassword.status).toBe(401);
      expect(withGoodPassword.body.code).toBe('ACCOUNT_LOCKED');

      // Déverrouillage pour les tests suivants.
      await ctx.prisma.user.update({ where: { phone }, data: { lockedUntil: null } });
    });

    it('limite à 5 essais / 15 min par IP + téléphone (429 au 6e)', async () => {
      const ip = freshIp();
      const phone = '+2693300004';
      for (let i = 0; i < 4; i++)
        expect((await login(ctx.app, phone, 'faux', ip)).status).toBe(401);
      expect((await login(ctx.app, phone, PASSWORD, ip)).status).toBe(200);
      const sixth = await login(ctx.app, phone, PASSWORD, ip);
      expect(sixth.status).toBe(429);
      expect(sixth.body.code).toBe('TOO_MANY_REQUESTS');
      // Une autre IP n'est pas bloquée.
      expect((await login(ctx.app, phone, PASSWORD, freshIp())).status).toBe(200);
    });
  });

  describe('refresh et logout', () => {
    it('fait tourner le refresh token et détecte sa réutilisation', async () => {
      const first = refreshCookie(await login(ctx.app, CASHIER));

      const r1 = await http().post('/auth/refresh').set('Cookie', first);
      expect(r1.status).toBe(200);
      expect((r1.body as LoginResponse).user.role).toBe('CASHIER');
      const second = refreshCookie(r1);
      expect(second).not.toBe(first);

      // Réutiliser l'ancien jeton → refus et révocation de toutes les sessions.
      const reuse = await http().post('/auth/refresh').set('Cookie', first);
      expect(reuse.status).toBe(401);
      const afterReuse = await http().post('/auth/refresh').set('Cookie', second);
      expect(afterReuse.status).toBe(401);
    });

    it('mobile : refresh token dans le corps, sans cookie, rotatif', async () => {
      const COURIER = SEED_USERS.find((u) => u.role === 'COURIER')!.phone;
      const res = await http()
        .post('/auth/login')
        .set('X-Client', 'mobile')
        .set('X-Forwarded-For', freshIp())
        .send({ phone: COURIER, password: PASSWORD });
      expect(res.status).toBe(200);
      expect(res.headers['set-cookie']).toBeUndefined();
      const first = (res.body as LoginResponse).refreshToken!;
      expect(first).toEqual(expect.any(String));

      const r1 = await http()
        .post('/auth/refresh')
        .set('X-Client', 'mobile')
        .send({ refreshToken: first });
      expect(r1.status).toBe(200);
      const second = (r1.body as LoginResponse).refreshToken!;
      expect(second).not.toBe(first);

      const out = await http()
        .post('/auth/logout')
        .set('X-Client', 'mobile')
        .send({ refreshToken: second });
      expect(out.status).toBe(204);
    });

    it('refuse le refresh sans cookie', async () => {
      const res = await http().post('/auth/refresh');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('SESSION_EXPIRED');
    });

    it('logout révoque la session', async () => {
      const cookie = refreshCookie(await login(ctx.app, CASHIER));
      const out = await http().post('/auth/logout').set('Cookie', cookie);
      expect(out.status).toBe(204);
      expect((await http().post('/auth/refresh').set('Cookie', cookie)).status).toBe(401);
    });
  });

  describe('gardes', () => {
    it('route protégée sans jeton → 401', async () => {
      const res = await http().get('/auth/me');
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ code: 'UNAUTHORIZED', message: expect.any(String) });
    });

    it('jeton invalide → 401', async () => {
      const res = await http().get('/auth/me').set('Authorization', 'Bearer pas-un-jwt');
      expect(res.status).toBe(401);
    });

    it('module interdit → 403', async () => {
      const token = (await login(ctx.app, CASHIER)).body.accessToken as string;
      const res = await http().get('/audit').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('module autorisé → 200', async () => {
      const token = (await login(ctx.app, ADMIN)).body.accessToken as string;
      const res = await http().get('/audit?pageSize=5').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeLessThanOrEqual(5);
    });

    it('endpoint sans permission déclarée → 403 par défaut, même pour ADMIN', async () => {
      const token = (await login(ctx.app, ADMIN)).body.accessToken as string;
      const res = await http().post('/__test/undeclared').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('/health est public', async () => {
      const res = await http().get('/health');
      expect(res.status).toBe(200);
      expect(res.body.checks).toEqual({ db: 'up', redis: 'up' });
    });
  });

  describe('GET /auth/me', () => {
    it.each(SEED_USERS.map((u) => [u.role, u.phone] as const))(
      '%s : modules conformes à la matrice',
      async (role, phone) => {
        const token = (await login(ctx.app, phone)).body.accessToken as string;
        const res = await http().get('/auth/me').set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        const me = res.body as MeResponse;
        expect(me.role).toBe(role);
        expect(me.modules).toEqual(allowedModules(role));
      },
    );

    it("renvoie l'île et le site des rôles d'île", async () => {
      const token = (await login(ctx.app, CASHIER)).body.accessToken as string;
      const me = (await http().get('/auth/me').set('Authorization', `Bearer ${token}`))
        .body as MeResponse;
      expect(me.scope).toBe('ISLAND');
      expect(me.island?.code).toBe('MO');
      expect(me.site?.name).toBe('Fomboni – Boutique');
    });
  });

  describe("journal d'audit", () => {
    it('journalise connexions réussies, échouées et déconnexions', async () => {
      const ok = await login(ctx.app, FINANCE);
      await login(ctx.app, FINANCE, 'faux');
      await http().post('/auth/logout').set('Cookie', refreshCookie(ok));
      const user = await ctx.prisma.user.findUniqueOrThrow({ where: { phone: FINANCE } });
      const actions = (
        await ctx.prisma.auditLog.findMany({
          where: { entityId: user.id },
          select: { action: true },
        })
      ).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT']));
    });

    it('journalise chaque mutation authentifiée (sans données sensibles)', async () => {
      const token = (await login(ctx.app, ADMIN)).body.accessToken as string;
      const res = await http()
        .post('/__test/echo')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Request-Id', 'req-audit-1')
        .send({ label: 'Test', password: 'secret' });
      expect(res.status).toBe(201);
      const entry = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { requestId: 'req-audit-1' },
      });
      expect(entry.action).toBe('POST /__test/echo');
      expect(entry.entityId).toBe('echo-1');
      expect(entry.after).toEqual({ id: 'echo-1', label: 'Test', password: '[masqué]' });
    });

    it('les mutations refusées ne sont pas journalisées comme réussies', async () => {
      const token = (await login(ctx.app, CASHIER)).body.accessToken as string;
      const res = await http()
        .post('/__test/echo')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Request-Id', 'req-audit-403')
        .send({});
      expect(res.status).toBe(403);
      expect(await ctx.prisma.auditLog.count({ where: { requestId: 'req-audit-403' } })).toBe(0);
    });

    it('est append-only : UPDATE et DELETE refusés par la base', async () => {
      const entry = await ctx.prisma.auditLog.findFirstOrThrow();
      await expect(
        ctx.prisma.auditLog.update({ where: { id: entry.id }, data: { action: 'X' } }),
      ).rejects.toThrow(/append-only/);
      await expect(ctx.prisma.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(
        /append-only/,
      );
    });
  });
});
