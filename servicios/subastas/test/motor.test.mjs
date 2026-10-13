import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { atender, comprobarProxy, config, firmaProxy, firmarDatos, leerDatos, supabase } from '../lib/motor.mjs';

const SECRETO = 'secreto-de-la-app';
const CLAVE = 'clave-del-motor';
const cfg = config({ SHOPIFY_APP_SECRET: SECRETO, TIENDA_URL: 'https://sidonia.es', SUBASTAS_CLAVE: CLAVE });
const ahora = () => String(Math.floor(Date.now() / 1000));
const firmar = (q) => ({ ...q, signature: firmaProxy(q, SECRETO) });
const q = (extra = {}, cliente = '7001') => firmar({ shop: 'sidonia.myshopify.com', path_prefix: '/apps/subastas', timestamp: ahora(), logged_in_customer_id: cliente, ...extra });

function fakeDb() {
  const calls = [];
  const db = async (fn, args) => {
    calls.push([fn, args]);
    if (fn === 'sidonia_estado') return { ahora: 'x', subastas: args.p_handles.map((h) => ({ handle: h })) };
    if (fn === 'sidonia_pujador') return db.pujador ?? null;
    if (fn === 'sidonia_registrar') return args.p_alias.length < 3 ? { ok: false, error: 'alias' } : { ok: true, pujador: { alias: args.p_alias, stripe_cliente: null } };
    return { ok: true, fn, args };
  };
  db.calls = calls;
  return db;
}
function fakeStripe() {
  const calls = [];
  const s = async (method, path, body) => {
    calls.push([method, path, body]);
    if (path === 'customers') return { id: 'cus_1' };
    if (path === 'checkout/sessions') return { url: 'https://checkout.stripe.com/c/pay/cs_1' };
    if (path.startsWith('checkout/sessions/')) return s.sesion;
    return {};
  };
  s.calls = calls;
  return s;
}

test('la firma es la del proxy de Shopify', () => {
  const query = { shop: 'sidonia.myshopify.com', path_prefix: '/apps/subastas', timestamp: '1760000000', logged_in_customer_id: '7001', extra: ['1', '2'] };
  const texto = 'extra=1,2logged_in_customer_id=7001path_prefix=/apps/subastasshop=sidonia.myshopify.comtimestamp=1760000000';
  assert.equal(firmaProxy(query, SECRETO), createHmac('sha256', SECRETO).update(texto).digest('hex'));
  assert.equal(comprobarProxy({ ...query, signature: firmaProxy(query, SECRETO) }, SECRETO, 1760000000 * 1000), true);
  assert.equal(comprobarProxy({ ...query, logged_in_customer_id: '9999', signature: firmaProxy(query, SECRETO) }, SECRETO, 1760000000 * 1000), false, 'cambiar el cliente rompe la firma');
  assert.equal(comprobarProxy({ ...query, signature: firmaProxy(query, SECRETO) }, SECRETO, (1760000000 + 7200) * 1000), false, 'firma caducada');
});

test('sin firma válida no se hace nada', async () => {
  const db = fakeDb();
  const r = await atender({ method: 'POST', ruta: 'api/pujar', query: { logged_in_customer_id: '7001' }, body: { handle: 'x', importe: 1 } }, cfg, { db });
  assert.equal(r.status, 401);
  assert.equal(db.calls.length, 0);
});

test('estado de varias subastas, con el cliente que mira', async () => {
  const db = fakeDb();
  const r = await atender({ method: 'GET', ruta: 'api/estado', query: q({ h: 'porsche,barco' }) }, cfg, { db });
  assert.equal(r.status, 200);
  assert.deepEqual(db.calls[0], ['sidonia_estado', { p_handles: ['porsche', 'barco'], p_cliente: '7001' }]);
});

test('pujar: pide sesión, valida y pasa el intento', async () => {
  const db = fakeDb();
  const sin = await atender({ method: 'POST', ruta: 'api/pujar', query: q({}, ''), body: { handle: 'porsche', importe: 1000 } }, cfg, { db });
  assert.equal(JSON.parse(sin.body).error, 'login');
  const mal = await atender({ method: 'POST', ruta: 'api/pujar', query: q(), body: { handle: 'porsche', importe: -5 } }, cfg, { db });
  assert.equal(mal.status, 400);
  await atender({ method: 'POST', ruta: 'api/pujar', query: q(), body: { handle: 'porsche', importe: '22750', tipo: 'maxima', intento: 'abc' } }, cfg, { db });
  assert.deepEqual(db.calls.at(-1), ['sidonia_pujar', { p_handle: 'porsche', p_cliente: '7001', p_importe: 22750, p_tipo: 'maxima', p_intento: 'abc' }]);
});

test('comentar y seguir', async () => {
  const db = fakeDb();
  await atender({ method: 'POST', ruta: 'api/comentar', query: q(), body: { handle: 'porsche', texto: '¿Tiene libro?' } }, cfg, { db });
  await atender({ method: 'POST', ruta: 'api/seguir', query: q(), body: { handle: 'porsche', on: true } }, cfg, { db });
  assert.deepEqual(db.calls.map((c) => c[0]), ['sidonia_comentar', 'sidonia_seguir']);
});

test('registro: sin sesión, a entrar; con sesión, la página dentro del tema', async () => {
  const db = fakeDb();
  const sin = await atender({ method: 'GET', ruta: 'registro', query: q({ return_url: '/products/porsche' }, '') }, cfg, { db });
  assert.equal(sin.status, 302);
  assert.match(sin.headers.Location, /^\/account\/login\?return_url=/);
  const r = await atender({ method: 'GET', ruta: 'registro', query: q({ return_url: '/products/porsche' }) }, cfg, { db });
  assert.equal(r.headers['Content-Type'], 'application/liquid');
  assert.match(r.body, /Regístrate para pujar/);
  db.pujador = { registrado: true };
  const ya = await atender({ method: 'GET', ruta: 'registro', query: q({ return_url: '/products/porsche' }) }, cfg, { db });
  assert.equal(ya.headers.Location, '/products/porsche');
});

test('registro: nombre de usuario, Stripe y vuelta a la ficha', async () => {
  const db = fakeDb();
  const st = fakeStripe();
  const corto = await atender({ method: 'POST', ruta: 'registro', query: q(), body: { alias: 'ab', condiciones: '1', return_url: '/products/porsche' } }, cfg, { db, stripe: st });
  assert.match(corto.body, /al menos 3/);
  const ok = await atender({ method: 'POST', ruta: 'registro', query: q(), body: { alias: 'lucia', condiciones: '1', return_url: '/products/porsche' } }, cfg, { db, stripe: st });
  assert.equal(ok.headers.Location, 'https://checkout.stripe.com/c/pay/cs_1');
  const sesion = st.calls.find((c) => c[1] === 'checkout/sessions')[2];
  assert.equal(sesion.mode, 'setup');
  assert.match(sesion.success_url, /^https:\/\/sidonia\.es\/apps\/subastas\/registro\/vuelta\?return_url=%2Fproducts%2Fporsche/);

  st.sesion = { status: 'complete', customer: 'cus_1', metadata: { shopify_cliente: '7001' }, setup_intent: { payment_method: { card: { brand: 'visa', last4: '4242' } } } };
  const v = await atender({ method: 'GET', ruta: 'registro/vuelta', query: q({ session_id: 'cs_test_1', return_url: '/products/porsche' }) }, cfg, { db, stripe: st });
  assert.equal(v.headers.Location, '/products/porsche');
  assert.deepEqual(db.calls.at(-1), ['sidonia_registro_ok', { p_cliente: '7001', p_tarjeta: 'Visa •••• 4242', p_stripe: 'cus_1' }]);

  st.sesion = { ...st.sesion, metadata: { shopify_cliente: 'otro' } };
  const ajena = await atender({ method: 'GET', ruta: 'registro/vuelta', query: q({ session_id: 'cs_test_1', return_url: '/products/porsche' }) }, cfg, { db, stripe: st });
  assert.match(ajena.headers.Location, /\/apps\/subastas\/registro/, 'la sesión de Stripe de otra persona no vale');
});

test('volver solo a páginas de la tienda', async () => {
  const db = fakeDb();
  db.pujador = { registrado: true };
  const r = await atender({ method: 'GET', ruta: 'registro', query: q({ return_url: 'https://malo.com' }) }, cfg, { db });
  assert.equal(r.headers.Location, '/');
});

test('Supabase: clave nueva solo en apikey; clave antigua también como Bearer', async () => {
  const vistos = [];
  const f = async (url, init) => { vistos.push([url, init.headers]); return { ok: true, json: async () => ({}) }; };
  await supabase(config({ SUPABASE_URL: 'https://x.supabase.co/', SUPABASE_SERVICE_KEY: 'sb_secret_abc' }), f)('sidonia_estado', {});
  await supabase(config({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'eyJjwt' }), f)('sidonia_estado', {});
  assert.equal(vistos[0][0], 'https://x.supabase.co/rest/v1/rpc/sidonia_estado');
  assert.equal(vistos[0][1].apikey, 'sb_secret_abc');
  assert.equal('Authorization' in vistos[0][1], false);
  assert.equal(vistos[1][1].Authorization, 'Bearer eyJjwt');
});

test('página de conexión: dice qué falla sin enseñar nada secreto', async () => {
  const db = fakeDb();
  const ok = await atender({ method: 'GET', ruta: 'conexion', query: q() }, cfg, { db });
  assert.equal(ok.headers['Content-Type'], 'application/liquid');
  assert.match(ok.body, /está conectado/);
  const mal = await atender({ method: 'GET', ruta: 'conexion', query: { ...q(), signature: 'x' } }, cfg, { db });
  assert.match(mal.body, /La firma no cuadra/);
  assert.equal(mal.body.includes(SECRETO), false);
});

test('sincronizar: la subasta sale de la ficha de Shopify, firmada por el tema', async () => {
  const t = Math.floor(Date.now() / 1000);
  const d = { handle: 'nissan-vanette', t, inicio: t, fin: t + 86400, salida: 750, reserva: 1500, titulo: 'Nissan Vanette | 1990' };
  const { datos, firma } = firmarDatos(d, CLAVE);
  assert.equal(datos.includes('1500'), false, 'la reserva no viaja a la vista');
  assert.deepEqual(leerDatos(datos, firma, CLAVE), d);
  assert.equal(leerDatos(datos.replace('|750|', '|1|'), firma, CLAVE), null, 'cambiar el precio rompe la firma');
  assert.equal(leerDatos(datos, firma, 'otra'), null);
  assert.equal(leerDatos(firmarDatos({ ...d, t: t + 3600 }, CLAVE).datos, firmarDatos({ ...d, t: t + 3600 }, CLAVE).firma, CLAVE), null, 'del futuro, no');
  assert.equal(leerDatos(...Object.values(firmarDatos({ ...d, reserva: null }, CLAVE)), CLAVE).reserva, null, 'sin reserva');

  const db = fakeDb();
  const r = await atender({ method: 'POST', ruta: 'api/sincronizar', query: q({}, ''), body: { datos, firma } }, cfg, { db });
  assert.equal(r.status, 200, 'no hace falta haber iniciado sesión');
  assert.deepEqual(db.calls[0], ['sidonia_sincronizar', {
    p_handle: 'nissan-vanette', p_titulo: 'Nissan Vanette | 1990', p_inicio: new Date(t * 1000).toISOString(), p_fin: new Date((t + 86400) * 1000).toISOString(),
    p_salida: 750, p_reserva: 1500, p_version: t, p_cliente: null
  }]);
  const mal = await atender({ method: 'POST', ruta: 'api/sincronizar', query: q(), body: { datos, firma: 'ab' } }, cfg, { db });
  assert.equal(mal.status, 400);
  assert.equal(db.calls.length, 1);
});
