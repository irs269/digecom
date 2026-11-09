// Étapes du back-office pendant un parcours mobile : la logistique confirme, prépare et
// déclare prête la dernière commande de Fatima Said (API, compte administrateur de démo).
// Variables : API_URL, PASSWORD. Sortie : output.orderNumber.
const base = API_URL;
const login = http.post(`${base}/auth/login`, {
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone: '+2693300001', password: PASSWORD }),
});
const token = json(login.body).accessToken;
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const list = json(http.get(`${base}/orders?q=Fatima&pageSize=1`, { headers: auth }).body);
const order = list.items[0];
for (const action of ['confirm', 'prepare', 'ready']) {
  http.post(`${base}/orders/${order.id}/actions/${action}`, { headers: auth, body: '{}' });
}
output.orderNumber = order.number;
