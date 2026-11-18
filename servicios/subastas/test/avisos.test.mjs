import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createVerify, generateKeyPairSync } from 'node:crypto';
import { atender, config } from '../lib/motor.mjs';
import { atenderPanel } from '../lib/circulo.mjs';
import { avisarCliente, cuentaFirebase, enviarAviso, jwtGoogle, mensaje, registrarDispositivo } from '../lib/avisos.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const cuenta = { project_id: 'sidonia-app', client_email: 'avisos@sidonia-app.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const CLAVE = 'clave-del-motor';
const cfg = config({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'sb_secret_x', SUBASTAS_CLAVE: CLAVE, ADMIN_CLAVE: 'panel', FIREBASE_SERVICE_ACCOUNT: Buffer.from(JSON.stringify(cuenta)).toString('base64') });
const TOKEN = 'fcm-token-' + 'x'.repeat(140);

// Un Firebase de mentira: el token de Google y el envío de FCM
function fcmFalso({ caducados = [] } = {}) {
  const enviados = [];
  const fetch = async (url, op) => {
    if (url === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ access_token: 'ya29.x', expires_in: 3600 }));
    if (url.startsWith('https://fcm.googleapis.com/v1/projects/sidonia-app/messages:send')) {
      assert.equal(op.headers.Authorization, 'Bearer ya29.x');
      const m = JSON.parse(op.body).message;
      if (m.token && caducados.includes(m.token)) return new Response('{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}', { status: 404 });
      enviados.push(m);
      return new Response('{"name":"projects/sidonia-app/messages/1"}');
    }
    throw new Error('url inesperada ' + url);
  };
  return { fetch, enviados };
}

// La tabla «dispositivos» en memoria
function tablaFalsa(filas = []) {
  return {
    filas,
    async leer(filtro) { const c = decodeURIComponent(filtro.match(/cliente=eq\.([^&]+)/)[1]); return filas.filter((f) => f.cliente === c); },
    async guardar(fila) { const i = filas.findIndex((f) => f.token === fila.token); if (i >= 0) filas[i] = { ...filas[i], ...fila }; else filas.push(fila); return fila; },
    async borrar(filtro) { const t = decodeURIComponent(filtro.match(/token=eq\.(.+)$/)[1]); filas.splice(filas.findIndex((f) => f.token === t), 1); }
  };
}

test('la cuenta de Firebase se lee en JSON o en base64; mal puesta, no hay avisos', () => {
  assert.equal(cuentaFirebase(JSON.stringify(cuenta)).project_id, 'sidonia-app');
  assert.equal(cfg.firebase.client_email, cuenta.client_email);
  assert.equal(cuentaFirebase('no es json'), null);
  assert.equal(cuentaFirebase(JSON.stringify({ project_id: 'x' })), null);
  assert.equal(config({}).firebase, null);
});

test('el JWT para Google va firmado con la clave de la cuenta (RS256)', () => {
  const jwt = jwtGoogle(cuenta, 1_700_000_000_000);
  const [h, c, f] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.iss, cuenta.client_email);
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/firebase.messaging');
  assert.equal(claims.exp - claims.iat, 3600);
  assert.ok(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(f, 'base64url')));
});

test('el mensaje lleva título, texto, la página que abre y la foto', () => {
  const m = mensaje({ topic: 'novedades' }, { titulo: 'Acaba de llegar', texto: 'Un Giulia', url: '/products/giulia', imagen: 'https://cdn.shopify.com/x.jpg' }).message;
  assert.equal(m.topic, 'novedades');
  assert.equal(m.notification.title, 'Acaba de llegar');
  assert.equal(m.notification.image, 'https://cdn.shopify.com/x.jpg');
  assert.equal(m.data.url, '/products/giulia');
  assert.equal(m.apns.payload.aps.sound, 'default');
});

test('enviar: sale a FCM; un token caducado se avisa; sin Firebase no hace nada', async () => {
  const f = fcmFalso({ caducados: ['viejo'] });
  assert.equal(await enviarAviso(cfg, { topic: 'novedades' }, { titulo: 'Hola', texto: 'x' }, f.fetch), 'ok');
  assert.equal(await enviarAviso(cfg, { token: 'viejo' }, { titulo: 'Hola', texto: 'x' }, f.fetch), 'caducado');
  assert.equal(await enviarAviso(config({}), { topic: 'novedades' }, { titulo: 'x' }, f.fetch), 'sin-firebase');
});

test('registrar el móvil: con sesión se guarda de quién es; sin sesión no borra al dueño', async () => {
  const t = tablaFalsa();
  assert.deepEqual(await registrarDispositivo(cfg, { dispositivos: t }, { token: TOKEN, plataforma: 'ios' }, '7001'), { ok: true });
  assert.equal(t.filas[0].cliente, '7001');
  await registrarDispositivo(cfg, { dispositivos: t }, { token: TOKEN, plataforma: 'ios' }, null);
  assert.equal(t.filas[0].cliente, '7001');
  assert.equal(t.filas.length, 1);
  assert.equal((await registrarDispositivo(cfg, { dispositivos: t }, { token: 'corto' }, null)).error, 'datos');
});

test('directo /tienda: api/push/registrar llega, con la firma del tema si ha iniciado sesión', async () => {
  const t = tablaFalsa();
  const ct = String(Math.floor(Date.now() / 1000));
  const cf = createHmac('sha256', CLAVE).update(`7001.${ct}`).digest('hex');
  const r = await atender({ method: 'POST', ruta: 'api/push/registrar', query: { c: '7001', ct, cf }, body: { token: TOKEN, plataforma: 'android' }, directo: true }, cfg, { db: async () => null, dispositivos: t });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).ok, true);
  assert.equal(t.filas[0].cliente, '7001');
  assert.equal(t.filas[0].plataforma, 'android');
});

test('avisar a un cliente: a todos sus móviles, y los caducados se borran', async () => {
  const t = tablaFalsa([{ token: 'a1', cliente: '7001' }, { token: 'viejo', cliente: '7001' }, { token: 'b1', cliente: '8000' }]);
  const f = fcmFalso({ caducados: ['viejo'] });
  const n = await avisarCliente(cfg, { fetch: f.fetch, dispositivos: t }, '7001', { titulo: 'Publicado', texto: 'x', url: '/products/y' });
  assert.equal(n, 1);
  assert.deepEqual(f.enviados.map((m) => m.token), ['a1']);
  assert.deepEqual(t.filas.map((x) => x.token), ['a1', 'b1']);
});

test('panel › Avisos: manda al tema «novedades»; pide título y texto y un enlace de sidonia.es', async () => {
  const auth = { authorization: 'Basic ' + Buffer.from('equipo:panel').toString('base64') };
  const f = fcmFalso();
  const get = await atenderPanel({ method: 'GET', query: { estado: 'avisos' }, body: {}, headers: auth }, cfg, { db: async () => [], fetch: f.fetch });
  assert.match(get.body, /Aviso a todos los que tienen la app/);
  const mal = await atenderPanel({ method: 'POST', query: { estado: 'avisos' }, body: { titulo: 'Hola', texto: 'x', url: 'https://otra.com/' }, headers: auth }, cfg, { db: async () => [], fetch: f.fetch });
  assert.match(mal.body, /tiene que ser de sidonia\.es/);
  const ok = await atenderPanel({ method: 'POST', query: { estado: 'avisos' }, body: { titulo: 'Acaba de llegar', texto: 'Un Giulia GT', url: '/products/giulia' }, headers: auth }, cfg, { db: async () => [], fetch: f.fetch });
  assert.match(ok.body, /Aviso enviado a todos/);
  assert.equal(f.enviados.at(-1).topic, 'novedades');
  const sin = await atenderPanel({ method: 'POST', query: { estado: 'avisos' }, body: { titulo: 'x', texto: 'y', url: '/' }, headers: auth }, config({ ADMIN_CLAVE: 'panel' }), { db: async () => [] });
  assert.match(sin.body, /Falta FIREBASE_SERVICE_ACCOUNT/);
});
