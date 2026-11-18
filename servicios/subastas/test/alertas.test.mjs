import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config, atender } from '../lib/motor.mjs';
import { correoAlerta, encaja, limpiarFiltros, revisarAlertas, rutasAlertas } from '../lib/alertas.mjs';

const porsche = { title: 'PORSCHE 911 CARRERA 3.2 COUPÉ 1986', productType: 'Coches', vendor: 'Sidonia', tags: ['Madrid'], descripcion: 'Gasolina, manual', provincia: 'Madrid', precio: 77911, colecciones: ['coches'], creado: '2026-10-26T10:00:00Z', handle: 'porsche', foto: 'https://cdn/x.jpg' };
const moto = { title: 'YAMAHA YZF 750 R', productType: 'Motos', vendor: 'Sidonia', tags: [], descripcion: '', provincia: 'Cádiz', precio: 7990, colecciones: ['motos'], creado: '2026-10-26T11:00:00Z', handle: 'yamaha', foto: '' };

test('filtros: solo lo que se entiende, limpio', () => {
  assert.deepEqual(limpiarFiltros({ q: ' porsche 911 ', coleccion: 'Coches', marca: 'Porsche, BMW', precio: '-80000', anio: 'x', raro: 1 }), { q: 'porsche 911', coleccion: 'coches', marca: 'Porsche,BMW', precio: '-80000' });
  assert.deepEqual(limpiarFiltros({ coleccion: 'all' }), {});
});

test('encaja: texto sin tildes, marca en el título, precio, año, colección y provincia', () => {
  assert.equal(encaja({ q: 'porsche coupe' }, porsche), true);
  assert.equal(encaja({ q: 'porsche 964' }, porsche), false);
  assert.equal(encaja({ marca: 'BMW,Porsche', precio: '50000-80000' }, porsche), true);
  assert.equal(encaja({ precio: '-50000' }, porsche), false);
  assert.equal(encaja({ anio: '1980-1989', localizacion: 'Madrid' }, porsche), true);
  assert.equal(encaja({ anio: '1990-' }, porsche), false);
  assert.equal(encaja({ coleccion: 'motos' }, porsche), false);
  assert.equal(encaja({ coleccion: 'motos', localizacion: 'Cadiz' }, moto), true);
  assert.equal(encaja({ q: 'yz' }, moto), false, 'palabras enteras');
});

function tablaFalsa(filas = []) {
  let n = filas.length;
  return {
    filas,
    async leer(f) { return filas.filter((a) => (!f.includes('cliente=eq.') || f.includes(`cliente=eq.${a.cliente}`)) && a.activa !== false); },
    async guardar(fila) { const x = { id: ++n, activa: true, avisos: 0, creada: '2026-10-25T00:00:00Z', revisada: '2026-10-25T00:00:00Z', ...fila }; filas.push(x); return x; },
    async cambiar(id, c) { Object.assign(filas.find((a) => a.id === id), c); },
    async borrar(f) { const id = Number(f.match(/id=eq\.(\d+)/)[1]); const i = filas.findIndex((a) => a.id === id && f.includes(`cliente=eq.${a.cliente}`)); if (i >= 0) filas.splice(i, 1); }
  };
}

test('rutas: sin sesión pide entrar; crea, no repite, lista y borra la suya', async () => {
  const alertas = tablaFalsa();
  const cfg = config({});
  assert.deepEqual(await rutasAlertas({ ruta: 'api/alertas', method: 'POST', body: {} }, null, cfg, { alertas }), { ok: false, error: 'login' });
  const r = await rutasAlertas({ ruta: 'api/alertas', method: 'POST', body: { nombre: 'Porsche', filtros: { q: 'porsche' }, email: 'Ana@Correo.es' } }, '7', cfg, { alertas });
  assert.equal(r.ok, true);
  assert.equal(alertas.filas[0].email, 'ana@correo.es');
  assert.equal((await rutasAlertas({ ruta: 'api/alertas', method: 'POST', body: { filtros: { q: 'porsche' } } }, '7', cfg, { alertas })).ya, true);
  assert.equal((await rutasAlertas({ ruta: 'api/alertas', method: 'POST', body: { filtros: {} } }, '7', cfg, { alertas })).error, 'vacia');
  assert.equal((await rutasAlertas({ ruta: 'api/alertas', method: 'GET', body: {} }, '7', cfg, { alertas })).alertas.length, 1);
  await rutasAlertas({ ruta: 'api/alertas/borrar', method: 'POST', body: { id: r.id } }, '8', cfg, { alertas });
  assert.equal(alertas.filas.length, 1, 'otro cliente no la borra');
  await rutasAlertas({ ruta: 'api/alertas/borrar', method: 'POST', body: { id: r.id } }, '7', cfg, { alertas });
  assert.equal(alertas.filas.length, 0);
});

test('repaso: avisa por email solo con lo nuevo que encaja y apunta hasta cuándo ha mirado', async () => {
  const alertas = tablaFalsa([
    { id: 1, cliente: '7', email: 'ana@correo.es', nombre: 'Porsche', filtros: { q: 'porsche' }, activa: true, avisos: 0, creada: '2026-10-20T00:00:00Z', revisada: '2026-10-25T00:00:00Z' },
    { id: 2, cliente: '8', email: 'luis@correo.es', nombre: 'Barcos', filtros: { coleccion: 'barcos' }, activa: true, avisos: 0, creada: '2026-10-20T00:00:00Z', revisada: '2026-10-25T00:00:00Z' }
  ]);
  const gql = async (q, v) => {
    assert.match(v.q, /created_at:>'2026-10-25/);
    return { products: { nodes: [porsche, moto].map((p) => ({ ...p, createdAt: p.creado, description: p.descripcion, precio: { minVariantPrice: { amount: String(p.precio) } }, featuredImage: p.foto ? { url: p.foto } : null, provincia: { value: p.provincia }, collections: { nodes: p.colecciones.map((handle) => ({ handle })) } })), pageInfo: { hasNextPage: false } } };
  };
  const enviados = [];
  const fetch = async (url, o) => { enviados.push(JSON.parse(o.body)); return { ok: true, json: async () => ({}) }; };
  const cfg = config({ RESEND_API_KEY: 're_x', TIENDA_URL: 'https://sidonia.es' });
  const inf = await revisarAlertas(cfg, { gql, alertas, fetch }, Date.parse('2026-10-26T12:00:00Z'));
  assert.deepEqual(inf, { alertas: 2, productos: 2, avisadas: 1, emails: 1, moviles: 0 });
  assert.deepEqual(enviados[0].to, ['ana@correo.es']);
  assert.match(enviados[0].subject, /PORSCHE 911/);
  assert.match(enviados[0].html, /https:\/\/sidonia\.es\/products\/porsche/);
  assert.equal(alertas.filas[0].avisos, 1);
  assert.equal(alertas.filas[1].revisada, '2026-10-26T12:00:00.000Z');
});

test('correo: varios anuncios, con «y N más»', () => {
  const c = correoAlerta(config({}), { nombre: 'Clásicos' }, Array.from({ length: 8 }, (_, i) => ({ ...porsche, handle: `p${i}` })));
  assert.match(c.asunto, /8 nuevos en Sidonia/);
  assert.match(c.html, /Y 2 más/);
});

test('motor: el repaso solo con el secreto del cron; las alertas por la entrada directa', async () => {
  const cfg = config({ CRON_SECRET: 'cron123', SUBASTAS_CLAVE: 'k' });
  const no = await atender({ method: 'GET', ruta: 'api/alertas/revisar', query: {}, body: {}, directo: true, headers: {} }, cfg, { db: async () => [] });
  assert.equal(no.status, 401);
  const si = await atender({ method: 'GET', ruta: 'api/alertas/revisar', query: {}, body: {}, directo: true, headers: { authorization: 'Bearer cron123' } }, cfg, { db: async () => [], alertas: tablaFalsa() });
  assert.equal(JSON.parse(si.body).ok, true);
  const sin = await atender({ method: 'GET', ruta: 'api/alertas', query: {}, body: {}, directo: true }, cfg, { db: async () => [], alertas: tablaFalsa() });
  assert.deepEqual(JSON.parse(sin.body), { ok: false, error: 'login' });
});
