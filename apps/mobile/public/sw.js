/* Service worker de la PWA Dig'eCom : notifications push (iPhone, navigateurs). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let msg = { title: "Dig'eCom", body: '', data: {} };
  try {
    msg = { ...msg, ...event.data.json() };
  } catch {
    if (event.data) msg.body = event.data.text();
  }
  const call = msg.data && msg.data.type === 'CALL_INCOMING';
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(msg.title, {
        body: msg.body,
        data: msg.data,
        icon: '/pwa/icons/icon-192.png',
        badge: '/pwa/icons/icon-192.png',
        tag: call ? 'appel' : undefined,
        requireInteraction: call,
        vibrate: call ? [800, 600, 800, 600, 800] : [200],
      });
      // Application ouverte : elle rafraîchit ses données.
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      wins.forEach((w) => w.postMessage({ type: 'push', data: msg.data }));
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target =
    data.type === 'DELIVERY_OFFER' || data.type === 'DELIVERY_ASSIGNED' ? '/pwa/livreur' : '/pwa/';
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const win = wins.find((w) => w.url.includes('/pwa'));
      if (win) {
        await win.focus();
        win.postMessage({ type: 'open', data });
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
