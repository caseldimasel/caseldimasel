import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { atender, config } from '../lib/motor.mjs';
import { tapar } from '../lib/chat.mjs';

const cfg = config({ SUBASTAS_CLAVE: 'k', ADMIN_CLAVE: 'panel', RESEND_API_KEY: 're_x', AVISOS_EQUIPO: 'equipo@sidonia.es', TIENDA_URL: 'https://sidonia.es', SERVIDOR_URL: 'https://motor.test', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 's' });
const quien = (c) => { const t = String(Math.floor(Date.now() / 1000)); return { c, ct: t, cf: createHmac('sha256', 'k').update(`${c}.${t}`).digest('hex') }; };
function memo(filas = []) {
  let sig = 50;
  const ok = (f, x) => f.split('&').every((p) => { const m = /^(\w+)=(eq|neq)\.(.*)$/.exec(p); if (!m) return true; const v = decodeURIComponent(m[3]), a = String(x[m[1]] ?? ''); return m[2] === 'eq' ? a === v : a !== v; });
  return { filas, leer: async (f) => { let l = filas.filter((x) => ok(f, x)); const lim = /limit=(\d+)/.exec(f); return lim ? l.slice(0, +lim[1]) : l; },
    cambiar: async (id, c) => Object.assign(filas.find((x) => Number(x.id) === Number(id)), c),
    guardar: async (x, k = 'id') => { const ks = k.split(','); const ya = filas.find((y) => ks.every((kk) => kk in x && String(y[kk]) === String(x[kk]))); if (ya) return Object.assign(ya, x); const n = { id: sig++, creado: new Date().toISOString(), ...x }; filas.push(n); return n; } };
}
function preparar() {
  const correos = [];
  const deps = { db: async () => null, fetch: async (u, o) => { correos.push(JSON.parse(o.body)); return { ok: true, json: async () => ({}) }; },
    anuncios: memo([{ id: 3, cliente: '55', titulo: 'Porsche 911 1982', fotos: [], producto: 'porsche-911', vendedor_nombre: 'Enrique', email: 'enrique@x.es', estado: 'publicado' }]),
    garaje: memo([{ id: 7, cliente: '55', marca: 'Alfa', modelo: 'Spider', anio: 1975, fotos: [], alquiler: true }]),
    perfiles: memo([{ cliente: '55', nombre: 'Enrique López' }]), alquiler: memo([{ id: 1, rol: 'poner', cliente: '55', nombre: 'Enrique', email: 'enrique@x.es' }]),
    reservas: memo(), chats: memo(), chat_mensajes: memo() };
  const api = (ruta, body = {}, q = {}, method = 'POST') => atender({ method, ruta, query: { ...q, ...(method === 'GET' ? body : {}) }, body, directo: true, headers: {} }, cfg, deps).then((r) => JSON.parse(r.body));
  return { deps, api, correos };
}

test('chat: tapa teléfonos, emails y WhatsApp', () => {
  assert.equal(tapar('Llámame al 600 111 222 o escribe a ana@x.es o wa.me/34600111222'), 'Llámame al [teléfono oculto] o escribe a [email oculto] o [enlace oculto]');
  assert.equal(tapar('Lo quiero el 12 de junio de 2027'), 'Lo quiero el 12 de junio de 2027');
});

test('chat: preguntar por un coche en venta sin ver su teléfono; el dueño contesta y se avisa por email', async () => {
  const { api, correos } = preparar();
  assert.equal((await api('api/chat/abrir', { tipo: 'venta', ref: 3, texto: 'Hola' })).error, 'login');
  assert.equal((await api('api/chat/abrir', { tipo: 'venta', ref: 3, texto: 'Hola' }, quien('55'))).error, 'suyo');
  const a = await api('api/chat/abrir', { tipo: 'venta', ref: 3, texto: '¿Sigue disponible? Mi teléfono 611222333', nombre: 'Lucía Gómez', email: 'lucia@x.es' }, quien('77'));
  assert.equal(a.ok, true); assert.equal(a.chat.otro, 'Enrique');
  assert.ok(correos.some((c) => c.to.includes('enrique@x.es') && /Lucía te ha escrito/.test(c.subject)));
  // El dueño lo ve sin leer y contesta
  const l = await api('api/chat', {}, quien('55'), 'GET');
  assert.equal(l.sin_leer, 1); assert.equal(l.chats[0].otro, 'Lucía');
  const m = await api('api/chat/mensajes', { id: a.chat.id, texto: 'Sí, ¿cuándo quieres verlo?' }, quien('55'));
  assert.equal(m.mensajes.length, 2); assert.match(m.mensajes[0].texto, /611222333/, 'en la venta no se tapa');
  assert.ok(correos.some((c) => c.to.includes('lucia@x.es')));
  assert.equal((await api('api/chat/mensajes', { id: a.chat.id }, quien('99'), 'GET')).error, 'no-existe');
  // Volver a escribir no crea otra conversación
  const b = await api('api/chat/abrir', { tipo: 'venta', ref: 3, texto: 'Otra cosa', nombre: 'Lucía' }, quien('77'));
  assert.equal(b.chat.id, a.chat.id);
});

test('chat: el alquiler, gratis como la venta: no se tapa nada', async () => {
  const { api } = preparar();
  const a = await api('api/chat/abrir', { tipo: 'alquiler', ref: 7, texto: '¿Está libre en junio? llámame 611 222 333', nombre: 'Ana' }, quien('77'));
  const m = await api('api/chat/mensajes', { id: a.chat.id }, quien('55'), 'GET');
  assert.match(m.mensajes[0].texto, /611 222 333/);
});

test('chat: «Hacer oferta» en un anuncio de la comunidad llega al chat con el dueño', async () => {
  const { api, deps, correos } = preparar();
  deps.ofertas = memo(); deps.tabla = deps.anuncios;
  const r = await api('api/oferta', { handle: 'porsche-911', titulo: 'Porsche 911 1982', oferta: 42000, precio: 45000, nombre: 'Lucía Gómez', email: 'lucia@x.es', telefono: '611222333', mensaje: 'Pago al contado' }, quien('77'));
  assert.equal(r.ok, true); assert.equal(r.en_chat, true);
  const l = await api('api/chat', {}, quien('55'), 'GET');
  assert.equal(l.chats.length, 1);
  const m = await api('api/chat/mensajes', { id: l.chats[0].id }, quien('55'), 'GET');
  assert.match(m.mensajes[0].texto, /💶 Oferta: 42\.000 €/);
  assert.match(m.mensajes[0].texto, /Pago al contado/);
  assert.equal(correos.filter((c) => c.to.includes('enrique@x.es')).length, 1, 'un solo aviso al dueño (el del chat)');
});
