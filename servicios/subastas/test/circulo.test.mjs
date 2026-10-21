import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { atender, codigoError, config, firmaProxy } from '../lib/motor.mjs';
import { atenderPanel, descripcionHtml, metacamposFiltros, permisosSubida, productoShopify, publicarEnShopify, slugVendedor, telefono, validar } from '../lib/circulo.mjs';

const SECRETO = 'secreto-de-la-app';
const cfg = config({ SHOPIFY_APP_SECRET: SECRETO, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 'sb_secret_x', TIENDA_URL: 'https://sidonia.es', SHOPIFY_TIENDA: 'sidonia.myshopify.com', SHOPIFY_CLIENT_ID: 'cid', ADMIN_CLAVE: 'panel-secreto' });
const q = (cliente = '7001') => { const x = { shop: 'sidonia.myshopify.com', path_prefix: '/apps/subastas', timestamp: String(Math.floor(Date.now() / 1000)), logged_in_customer_id: cliente }; return { ...x, signature: firmaProxy(x, SECRETO) }; };
const fotos = (n, c = '7001') => Array.from({ length: n }, (_, i) => `${c}/k${String(i).padStart(2, '0')}-abcdefgh.jpg`);
const bueno = (extra = {}) => ({
  tipo: 'coche', titulo: 'Porsche 911 SC 1982', precio: '65.000', ubicacion: 'Madrid',
  resumen: 'Un 911 SC de 1982 con la pintura original y todo el historial.',
  historia: 'Lo compró mi padre en 1989 en Stuttgart y desde entonces ha estado en la familia. '.repeat(3),
  mecanica: 'Motor revisado en 2023, embrague nuevo y frenos al día. Sin óxido.',
  ficha: [['Marca', 'Porsche'], ['Año', '1982'], ['Kilometraje', '128.000 km'], ['', 'vacío']],
  fotos: fotos(10), vendedor_nombre: 'Enrique', vendedor_tipo: 'particular', telefono: '612 345 678', email: 'e@x.es', acepta_telefono: true, condiciones: true, ...extra
});

test('validar: lo bueno pasa y se limpia; lo malo dice qué campo', () => {
  const v = validar(bueno(), '7001');
  assert.equal(v.ok, true);
  assert.equal(v.datos.precio, 65000);
  assert.equal(v.datos.telefono, '+34612345678');
  assert.equal(v.datos.ficha.length, 3, 'las filas vacías fuera');
  assert.match(v.datos.vendedor_slug, /^enrique-[0-9a-f]{4}$/);
  assert.equal(validar(bueno({ precio: '', precio_consultar: true }), '7001').datos.precio, null);
  assert.equal(validar(bueno({ tipo: 'moto' }), '7001').ok, true, 'las motos también');
  assert.equal(validar(bueno({ tipo: 'avion' }), '7001').campo, 'tipo');
  assert.equal(validar(bueno({ vendedor_tipo: '' }), '7001').campo, 'vendedor_tipo');
  assert.equal(validar(bueno({ vendedor_tipo: 'profesional' }), '7001').datos.vendedor_tipo, 'profesional');
  assert.equal(validar(bueno({ historia: 'corta' }), '7001').campo, 'historia');
  assert.equal(validar(bueno({ fotos: fotos(3) }), '7001').campo, 'fotos');
  assert.equal(validar(bueno({ fotos: fotos(10, '9999') }), '7001').campo, 'fotos', 'solo fotos de su carpeta');
  assert.equal(validar(bueno({ telefono: '123' }), '7001').campo, 'telefono');
  assert.equal(validar(bueno({ acepta_telefono: false }), '7001').campo, 'acepta_telefono');
  assert.equal(validar(bueno({ condiciones: false }), '7001').campo, 'condiciones');
});

test('errores: una palabra que dice qué falta, sin secretos', () => {
  assert.equal(codigoError(new Error('Supabase sidonia_anuncio_mio 404: {"message":"Could not find the function"}')), 'anuncios-sql');
  assert.equal(codigoError(new Error('Storage 400: Bucket not found')), 'anuncios-fotos');
  assert.equal(codigoError(new Error('Supabase sidonia_estado 401: key')), 'base-de-datos');
  assert.equal(codigoError(new Error('otra cosa')), 'motor');
});

test('teléfono y perfil del vendedor', () => {
  assert.equal(telefono('0034 699 11 22 33'), '+34699112233');
  assert.equal(telefono('+44 7700 900123'), '+447700900123');
  assert.equal(telefono('hola'), '');
  assert.equal(slugVendedor('Iñaki Ñúñez', '1'), `inaki-nunez-${slugVendedor('x', '1').slice(-4)}`);
  assert.notEqual(slugVendedor('Luis', '1'), slugVendedor('Luis', '2'), 'dos Luis no comparten perfil');
});

test('tienda: sin sesión pide entrar; con sesión guarda una solicitud', async () => {
  const llamadas = [];
  const db = async (fn, a) => { llamadas.push([fn, a]); if (fn === 'sidonia_anuncio_mio') return null; return { ok: true, anuncio: { id: 1, estado: 'pendiente' } }; };
  const sin = await atender({ method: 'POST', ruta: 'api/anuncio', query: q(''), body: bueno() }, cfg, { db });
  assert.equal(JSON.parse(sin.body).error, 'login');
  const mal = await atender({ method: 'POST', ruta: 'api/anuncio', query: q(), body: bueno({ titulo: '' }) }, cfg, { db });
  assert.equal(mal.status, 400);
  assert.equal(JSON.parse(mal.body).campo, 'titulo');
  const ok = await atender({ method: 'POST', ruta: 'api/anuncio', query: q(), body: bueno() }, cfg, { db });
  assert.equal(JSON.parse(ok.body).ok, true);
  assert.equal(llamadas.at(-1)[0], 'sidonia_anuncio_nuevo');
  assert.equal(llamadas.at(-1)[1].p_cliente, '7001');
  const sinFirma = await atender({ method: 'POST', ruta: 'api/anuncio', query: { logged_in_customer_id: '7001' }, body: bueno() }, cfg, { db });
  assert.equal(sinFirma.status, 401, 'nadie publica en nombre de otro');
});

test('fotos: una dirección firmada por foto, en la carpeta del cliente; no si ya tiene un anuncio activo', async () => {
  const pedidas = [];
  const f = async (url) => { pedidas.push(url); return { ok: true, json: async () => ({ url: `/object/upload/sign/anuncios/${url.split('/anuncios/')[1]}?token=t` }) }; };
  const r = await permisosSubida(cfg, '7001', ['image/jpeg', 'image/webp'], f);
  assert.equal(r.subidas.length, 2);
  assert.match(r.subidas[0].ruta, /^7001\/[a-z0-9-]+\.jpg$/);
  assert.match(r.subidas[1].ruta, /\.webp$/);
  assert.match(pedidas[0], /^https:\/\/x\.supabase\.co\/storage\/v1\/object\/upload\/sign\/anuncios\/7001\//);
  assert.equal(r.subidas[0].url, `https://x.supabase.co/storage/v1/object/upload/sign/anuncios/${r.subidas[0].ruta}?token=t`);
  assert.equal((await permisosSubida(cfg, '7001', ['text/html'], f)).ok, false);
  const db = async () => ({ id: 3, estado: 'pendiente' });
  const lim = await atender({ method: 'POST', ruta: 'api/anuncio/fotos', query: q(), body: { tipos: ['image/jpeg'] } }, cfg, { db });
  assert.equal(JSON.parse(lim.body).error, 'limite');
});

test('ficha en Shopify: descripción con el formato de Sidonia, sin HTML del vendedor', () => {
  const a = { id: 9, ...validar(bueno({ historia: 'Mi <script>alert(1)</script> coche. '.repeat(10) }), '7001').datos };
  const html = descripcionHtml(a);
  assert.match(html, /<h3>Historia<\/h3>/);
  assert.match(html, /<h3>Mecánica y estado<\/h3>/);
  assert.match(html, /<li>Año: 1982<\/li>/);
  assert.match(html, /<h3>Ubicación<\/h3>\n<p>Madrid<\/p>/);
  assert.equal(html.includes('<script>'), false);
  const { product, media } = productoShopify(cfg, a);
  assert.deepEqual(product.tags, ['COCHES', 'dueno', 'particular', `vendedor-${a.vendedor_slug}`]);
  assert.equal(product.vendor, 'Enrique');
  assert.equal(product.metafields.find((m) => m.key === 'vendedor_tipo').value, 'particular');
  assert.deepEqual(productoShopify(cfg, { ...a, tipo: 'moto', vendedor_tipo: 'profesional' }).product.tags.slice(0, 3), ['MOTOS', 'dueno', 'profesional']);
  assert.deepEqual(metacamposFiltros(a).map((m) => [m.key, m.value]), [['provincia', 'Madrid'], ['marca', 'Porsche'], ['ano', '1982']]);
  assert.equal(product.templateSuffix, 'cars');
  assert.equal(media.length, 10);
  assert.equal(media[0].originalSource, 'https://x.supabase.co/storage/v1/object/public/anuncios/7001/k00-abcdefgh.jpg');
  assert.equal(product.metafields.find((m) => m.key === 'vendedor_telefono').value, '+34612345678');
});

test('publicar en Shopify: crea, pone el precio y la publica en la tienda online', async () => {
  const pasos = [];
  const gql = async (query, vars) => {
    pasos.push(query.match(/(productCreate|productVariantsBulkUpdate|metafieldsSet|publications|publishablePublish)/)[1]);
    if (/productCreate/.test(query)) return { productCreate: { product: { id: 'gid://P/1', handle: 'porsche-911-sc-1982', variants: { nodes: [{ id: 'gid://V/1' }] } }, userErrors: [] } };
    if (/productVariantsBulkUpdate/.test(query)) { assert.equal(vars.variants[0].price, '65000'); return { productVariantsBulkUpdate: { userErrors: [] } }; }
    if (/metafieldsSet/.test(query)) { assert.equal(vars.m[0].ownerId, 'gid://P/1'); return { metafieldsSet: { userErrors: [] } }; }
    if (/publishablePublish/.test(query)) { assert.equal(vars.input[0].publicationId, 'gid://Pub/2'); return { publishablePublish: { userErrors: [] } }; }
    return { publications: { nodes: [{ id: 'gid://Pub/1', name: 'Point of Sale' }, { id: 'gid://Pub/2', name: 'Online Store' }] } };
  };
  const a = { id: 9, ...validar(bueno(), '7001').datos };
  const p = await publicarEnShopify(cfg, a, gql);
  assert.deepEqual(pasos, ['productCreate', 'productVariantsBulkUpdate', 'metafieldsSet', 'publications', 'publishablePublish']);
  assert.equal(p.url, 'https://sidonia.es/products/porsche-911-sc-1982');
});

test('panel: con contraseña; aprobar publica y marca el anuncio', async () => {
  const auth = (c) => ({ authorization: `Basic ${Buffer.from(`equipo:${c}`).toString('base64')}` });
  const db = async (fn) => (fn === 'sidonia_anuncios_lista' ? [] : fn === 'sidonia_anuncio_uno' ? { id: 9, ...validar(bueno(), '7001').datos, estado: 'pendiente' } : { ok: true });
  assert.equal((await atenderPanel({ method: 'GET', query: {}, headers: {} }, cfg, { db })).status, 401);
  assert.equal((await atenderPanel({ method: 'GET', query: {}, headers: auth('mala') }, cfg, { db })).status, 401);
  const ok = await atenderPanel({ method: 'GET', query: {}, headers: auth('panel-secreto') }, cfg, { db });
  assert.equal(ok.status, 200);
  assert.match(ok.body, /SIDONIA · ANUNCIOS DE DUEÑOS/);
  const llamadas = [];
  const db2 = async (fn, a) => { llamadas.push([fn, a]); return db(fn); };
  const gql = async (query) => (/productCreate/.test(query) ? { productCreate: { product: { id: 'P', handle: 'porsche', variants: { nodes: [] } }, userErrors: [] } } : /publications/.test(query) && !/publishablePublish/.test(query) ? { publications: { nodes: [] } } : {});
  const r = await atenderPanel({ method: 'POST', query: {}, body: { id: '9', accion: 'publicar' }, headers: auth('panel-secreto') }, cfg, { db: db2, gql });
  assert.match(r.body, /Publicado: https:\/\/sidonia\.es\/products\/porsche/);
  assert.deepEqual(llamadas.find((c) => c[0] === 'sidonia_anuncio_estado')[1], { p_id: 9, p_estado: 'publicado', p_nota: '', p_producto: 'porsche' });
});

// Contra un PostgreSQL de verdad (como test/sql.test.mjs)
const CONN = process.env.PGTEST;
test('base de datos: un anuncio activo por persona', { skip: !CONN && 'sin PGTEST' }, () => {
  const args = (db) => [...CONN.split(/\s+/), '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atq'];
  const psql = (sql, db = 'sidonia_circulo') => execFileSync('psql', [...args(db), '-c', sql], { encoding: 'utf8' }).trim();
  psql('drop database if exists sidonia_circulo', 'postgres');
  psql('create database sidonia_circulo', 'postgres');
  // En Supabase existe el esquema «storage»; aquí lo imitamos
  psql("create schema storage; create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[])");
  execFileSync('psql', [...args('sidonia_circulo'), '-f', fileURLToPath(new URL('../sql/circulo.sql', import.meta.url))], { encoding: 'utf8' });
  const datos = JSON.stringify({ ...validar(bueno(), '7001').datos }).replace(/'/g, "''");
  const nuevo = () => JSON.parse(psql(`select sidonia_anuncio_nuevo('7001', '${datos}'::jsonb)::text`));
  assert.equal(nuevo().ok, true);
  assert.equal(nuevo().error, 'limite', 'el segundo, no');
  const id = JSON.parse(psql("select sidonia_anuncio_mio('7001')::text")).id;
  psql(`select sidonia_anuncio_estado(${id}, 'rechazado', 'Fotos con otros coches')`);
  assert.equal(JSON.parse(psql("select sidonia_anuncio_mio('7001')::text")).nota, 'Fotos con otros coches');
  assert.equal(nuevo().ok, true, 'tras un rechazo puede enviar otro');
  assert.equal(psql("select public from storage.buckets where id = 'anuncios'"), 't');
  const mios = JSON.parse(psql("select sidonia_anuncios_mios('7001')::text"));
  assert.deepEqual(mios.map((m) => m.estado), ['pendiente', 'rechazado'], 'su perfil: todos, el último primero');
  assert.equal(mios[0].portada, '7001/k00-abcdefgh.jpg');
  // Se puede volver a ejecutar, y acepta motos y profesionales
  execFileSync('psql', [...args('sidonia_circulo'), '-f', fileURLToPath(new URL('../sql/circulo.sql', import.meta.url))], { encoding: 'utf8' });
  const moto = JSON.stringify({ ...validar(bueno({ tipo: 'moto', vendedor_tipo: 'profesional', fotos: fotos(10, '7002') }), '7002').datos }).replace(/'/g, "''");
  assert.equal(JSON.parse(psql(`select sidonia_anuncio_nuevo('7002', '${moto}'::jsonb)::text`)).ok, true);
  assert.equal(psql("select tipo || ' ' || vendedor_tipo from anuncios where cliente = '7002'"), 'moto profesional');
});
