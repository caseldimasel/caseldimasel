import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { atender, config, firmaProxy, firmarDatos } from '../lib/motor.mjs';
import { correoInvitacion, invitarSiToca, leerInvitacion } from '../lib/invitaciones.mjs';

const SECRETO = 'secreto-de-la-app';
const CLAVE = 'clave-del-motor';
const cfg = config({ SHOPIFY_APP_SECRET: SECRETO, TIENDA_URL: 'https://sidonia.es', SUBASTAS_CLAVE: CLAVE, RESEND_API_KEY: 're_x', AVISOS_REMITENTE: 'Sidonia <hola@sidonia.es>' });
const ahora = () => String(Math.floor(Date.now() / 1000));
const q = (cliente = '7001') => { const x = { shop: 's.myshopify.com', path_prefix: '/apps/sidonia', timestamp: ahora(), logged_in_customer_id: cliente }; return { ...x, signature: firmaProxy(x, SECRETO) }; };
const INV = JSON.stringify({ evento: 'Inauguración de Arka', fecha: 'Sábado 12 de diciembre', lugar: 'Villanueva de la Cañada (Madrid)', texto: 'Trae a quien quieras.' });
const firmaInv = (h, j, c = CLAVE) => createHmac('sha256', c).update(`inv|${h}|${j}`).digest('hex');

function tablas() {
  const t = { subasta_invitaciones: new Map(), invitaciones_enviadas: new Map() };
  const mk = (n, k) => ({
    async leer(f) { const h = decodeURIComponent(/handle=eq\.([^&]+)/.exec(f)?.[1] || ''); return t[n].has(h) ? [t[n].get(h)] : []; },
    async guardar(fila) { t[n].set(fila[k], fila); return fila; },
    async apuntar(fila) { const key = `${fila.handle}|${fila.cliente}`; if (t[n].has(key)) return false; t[n].set(key, fila); return true; }
  });
  return { t, deps: { subasta_invitaciones: mk('subasta_invitaciones', 'handle'), invitaciones_enviadas: mk('invitaciones_enviadas', 'handle') } };
}
function fakeFetch() {
  const enviados = [];
  const f = async (url, init) => { enviados.push([url, JSON.parse(init.body)]); return { ok: true, json: async () => ({ id: 'e1' }), text: async () => '' }; };
  f.enviados = enviados;
  return f;
}

test('leerInvitacion: solo con la firma del tema', () => {
  assert.equal(leerInvitacion('mercedes-600-sl', INV, firmaInv('mercedes-600-sl', INV), CLAVE).evento, 'Inauguración de Arka');
  assert.equal(leerInvitacion('mercedes-600-sl', INV, firmaInv('otro', INV), CLAVE), null, 'otra subasta');
  assert.equal(leerInvitacion('mercedes-600-sl', INV, firmaInv('mercedes-600-sl', INV, 'otra-clave'), CLAVE), null, 'otra clave');
  const sinEvento = JSON.stringify({ evento: '' });
  assert.equal(leerInvitacion('x', sinEvento, firmaInv('x', sinEvento), CLAVE), null);
});

test('sincronizar guarda la invitación; la primera puja manda el email, una sola vez', async () => {
  const { t, deps } = tablas();
  const fetch = fakeFetch();
  const calls = [];
  const db = async (fn, args) => {
    calls.push(fn);
    if (fn === 'sidonia_pujador') return { alias: 'clasicos_lucia', email: 'lucia@ejemplo.es' };
    if (fn === 'sidonia_pujar') return { ok: true, subasta: {} };
    return { ok: true };
  };
  const t0 = Math.floor(Date.now() / 1000);
  const { datos, firma } = firmarDatos({ handle: 'mercedes-600-sl', t: t0, inicio: t0, fin: t0 + 86400, salida: 1, titulo: 'Mercedes-Benz 600 SL 1993' }, CLAVE);
  await atender({ method: 'POST', ruta: 'api/sincronizar', query: q(''), body: { datos, firma, invitacion: INV, invitacion_firma: firmaInv('mercedes-600-sl', INV) } }, cfg, { db, fetch, ...deps });
  assert.equal(t.subasta_invitaciones.get('mercedes-600-sl').evento, 'Inauguración de Arka');
  assert.equal(t.subasta_invitaciones.get('mercedes-600-sl').titulo, 'Mercedes-Benz 600 SL 1993');

  const pujar = (importe) => atender({ method: 'POST', ruta: 'api/pujar', query: q(), body: { handle: 'mercedes-600-sl', importe, intento: String(importe) } }, cfg, { db, fetch, ...deps });
  await pujar(1);
  assert.equal(fetch.enviados.length, 1, 'un email');
  const [url, cuerpo] = fetch.enviados[0];
  assert.equal(url, 'https://api.resend.com/emails');
  assert.deepEqual(cuerpo.to, ['lucia@ejemplo.es']);
  assert.match(cuerpo.subject, /Gracias por pujar: te invitamos a Inauguración de Arka/);
  assert.match(cuerpo.html, /Villanueva de la Cañada/);
  assert.match(cuerpo.html, /Mercedes-Benz 600 SL 1993/);
  await pujar(101);
  assert.equal(fetch.enviados.length, 1, 'la segunda puja no manda otro');
});

test('sin invitación, sin Resend o con la puja rechazada: no se manda nada', async () => {
  const { deps } = tablas();
  const fetch = fakeFetch();
  assert.equal(await invitarSiToca(cfg, { ...deps, fetch }, { handle: 'otro', cliente: '7001' }), 'sin-invitacion');
  assert.equal(await invitarSiToca({ ...cfg, resendKey: '' }, { ...deps, fetch }, { handle: 'x', cliente: '7001' }), 'off');
  let invitadas = 0;
  const db = async (fn) => (fn === 'sidonia_pujar' ? { ok: false, error: 'registro' } : (invitadas++, null));
  await atender({ method: 'POST', ruta: 'api/pujar', query: q(), body: { handle: 'x', importe: 1 } }, cfg, { db, fetch, ...deps });
  assert.equal(invitadas, 0, 'sin registro para pujar no se invita');
  assert.equal(fetch.enviados.length, 0);
});

test('el email escapa lo que viene de la ficha', () => {
  const { html } = correoInvitacion(cfg, { inv: { evento: '<b>x</b>', fecha: '', lugar: '', texto: '' }, alias: '<i>', titulo: 'T', url: 'https://sidonia.es/products/t' });
  assert.doesNotMatch(html, /<b>x<\/b>|<i>/);
});
