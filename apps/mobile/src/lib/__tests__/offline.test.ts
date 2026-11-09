/**
 * File hors ligne : une action faite sans réseau est envoyée au retour du réseau, une seule fois,
 * toujours avec la même clé d'idempotence (le serveur ignore un renvoi).
 */
type Call = { url: string; method: string; key: string | null; body: unknown };

const calls: Call[] = [];
let online = false;
/** Clés déjà traitées par le « serveur » simulé (comme l'intercepteur Idempotency-Key). */
const seen = new Map<string, unknown>();
let serverStatus = 200;

beforeEach(async () => {
  calls.length = 0;
  seen.clear();
  online = false;
  serverStatus = 200;
  jest.resetModules();
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
    if (!online) throw new TypeError('Network request failed');
    const headers = (init.headers ?? {}) as Record<string, string>;
    const key = headers['Idempotency-Key'] ?? null;
    calls.push({
      url,
      method: String(init.method),
      key,
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    if (serverStatus !== 200) {
      return new Response(
        JSON.stringify({ code: 'CONFLICT_STATE', message: 'Statut déjà changé' }),
        { status: serverStatus },
      );
    }
    const replay = key ? seen.has(key) : false;
    const body = replay ? seen.get(key!) : { ok: true, n: calls.length };
    if (key && !replay) seen.set(key, body);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
});

const load = () => require('../offline') as typeof import('../offline');

test('en ligne : envoi direct avec une clé d’idempotence', async () => {
  online = true;
  const { submitAction } = load();
  const res = await submitAction('/me/orders/o1/markSold', {}, 'Client a pris');
  expect(res.status).toBe('sent');
  expect(calls).toHaveLength(1);
  expect(calls[0]!.key).toMatch(/^m-/);
});

test('hors ligne : action gardée, puis envoyée une seule fois au retour du réseau', async () => {
  const { submitAction, flush, subscribeQueue } = load();
  const res = await submitAction('/me/orders/o1/sellerConfirm', {}, 'Reçu');
  expect(res.status).toBe('queued');
  let pending = 0;
  subscribeQueue((s) => (pending = s.pending.length));
  expect(pending).toBe(1);

  online = true;
  await flush();
  await flush(); // un second passage ne renvoie rien
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toContain('/me/orders/o1/sellerConfirm');
  expect(pending).toBe(0);
});

test('coupure pendant la réponse : le renvoi garde la même clé et le serveur ne double pas', async () => {
  const { submitAction, flush, subscribeQueue } = load();
  await submitAction('/courier/runs/o2/pickup', {}, 'Retrait');
  online = true;
  // 1er envoi : le serveur exécute l'action, puis la réponse se perd (réseau coupé).
  const server = globalThis.fetch as jest.Mock;
  const base = server.getMockImplementation()!;
  server.mockImplementationOnce(async (url: string, init: RequestInit) => {
    await base(url, init);
    throw new TypeError('Network request failed');
  });
  await flush();
  let pending = -1;
  subscribeQueue((s) => (pending = s.pending.length));
  expect(pending).toBe(1); // le téléphone ne sait pas que l'action est passée

  // Retour du réseau : renvoi avec la même clé, le serveur reconnaît l'action déjà faite.
  await flush();
  expect(pending).toBe(0);
  expect(calls).toHaveLength(2);
  expect(calls[0]!.key).toBe(calls[1]!.key);
  expect(seen.size).toBe(1); // une seule action exécutée côté serveur
});

test('l’ordre des actions est respecté', async () => {
  const { submitAction, flush } = load();
  await submitAction('/courier/runs/o3/pickup', {}, 'Retrait');
  await submitAction('/courier/runs/o3/handover', {}, 'Remise');
  online = true;
  await flush();
  expect(calls.map((c) => c.url.split('/').pop())).toEqual(['pickup', 'handover']);
});

test('refus définitif du serveur : action retirée et signalée', async () => {
  const { submitAction, flush, subscribeQueue } = load();
  await submitAction('/me/orders/o4/markSold', {}, 'Client a pris');
  online = true;
  serverStatus = 422;
  await flush();
  let failed: { error?: string }[] = [];
  let pending = -1;
  subscribeQueue((s) => {
    failed = s.failed;
    pending = s.pending.length;
  });
  expect(pending).toBe(0);
  expect(failed[0]?.error).toBe('Statut déjà changé');
});

test('photo de preuve prise hors ligne : envoyée une fois, puis l’action avec sa clé', async () => {
  const { submitAction, flush } = load();
  await submitAction('/courier/runs/o5/handover', { amountCollected: 15000 }, 'Remise', {
    uri: 'file:///cache/preuve.jpg',
    contentType: 'image/jpeg',
    presignPath: '/courier/proof-upload-url',
  });
  online = true;
  const realFetch = globalThis.fetch as jest.Mock;
  realFetch.mockImplementationOnce(async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: String(init.method),
      key: null,
      body: JSON.parse(String(init.body)),
    });
    return new Response(JSON.stringify({ key: 'tmp/u1/p.jpg', uploadUrl: 'http://minio/put' }), {
      status: 200,
    });
  });
  realFetch.mockImplementationOnce(async () => new Response('blob', { status: 200 })); // lecture du fichier
  realFetch.mockImplementationOnce(async (url: string) => {
    calls.push({ url, method: 'PUT', key: null, body: null });
    return new Response(null, { status: 200 });
  });
  await flush();
  expect(calls.map((c) => c.method)).toEqual(['POST', 'PUT', 'POST']);
  expect(calls[2]!.body).toEqual({ amountCollected: 15000, proofKey: 'tmp/u1/p.jpg' });
});
