import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { atender, codigoError, config, firmaProxy } from '../lib/motor.mjs';
import { atenderPanel, leerEdicion, descripcionHtml, metacamposFiltros, permisosSubida, productoShopify, publicarEnShopify, slugVendedor, telefono, validar } from '../lib/circulo.mjs';

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

test('avisos: email al equipo con cada anuncio (si hay Resend) y visitas de clientes', async () => {
  const enviados = [];
  const fetchFalso = async (url, o) => { enviados.push({ url, body: JSON.parse(o.body) }); return { ok: true, text: async () => '' }; };
  const db = async (fn) => (fn === 'sidonia_anuncio_mio' ? null : fn === 'sidonia_visita' ? { ok: true, nuevo: true } : { ok: true, anuncio: { id: 1 } });
  const cfgAvisos = { ...cfg, resendKey: 're_x', avisosEquipo: ['hola@sidonia.es'], avisosRemitente: 'Sidonia <avisos@sidonia.es>', avisosClientes: true };
  await atender({ method: 'POST', ruta: 'api/anuncio', query: q(), body: bueno() }, cfgAvisos, { db, fetch: fetchFalso });
  assert.equal(enviados.length, 2, 'al equipo y al dueño');
  assert.match(enviados[0].body.subject, /Nuevo anuncio gratis: Porsche 911 SC 1982/);
  assert.deepEqual(enviados[0].body.to, ['hola@sidonia.es']);
  assert.match(enviados[1].body.subject, /Hemos recibido tu anuncio: Porsche 911 SC 1982/);
  assert.deepEqual(enviados[1].body.to, ['e@x.es']);
  enviados.shift();
  const v = await atender({ method: 'POST', ruta: 'api/visita', query: q(), body: { email: 'e@x.es', nombre: 'Enrique' } }, cfgAvisos, { db, fetch: fetchFalso });
  assert.equal(JSON.parse(v.body).ok, true);
  assert.match(enviados[1].body.subject, /Nuevo cliente en Sidonia: Enrique/);
  // Sin Resend no se envía nada (y no falla)
  await atender({ method: 'POST', ruta: 'api/anuncio', query: q(), body: bueno() }, cfg, { db, fetch: fetchFalso });
  assert.equal(enviados.length, 2);
  const sin = await atender({ method: 'POST', ruta: 'api/visita', query: q(''), body: {} }, cfg, { db });
  assert.equal(JSON.parse(sin.body).error, 'login');
});

test('panel › clientes: quién se registra y quién entra', async () => {
  const auth = { authorization: `Basic ${Buffer.from('equipo:panel-secreto').toString('base64')}` };
  const db = async (fn) => (fn === 'sidonia_clientes_lista' ? { lista: [{ cliente: '1', email: 'e@x.es', nombre: 'Enrique', primera: '2026-10-22T09:00:00Z', ultima: '2026-10-22T10:00:00Z', visitas: 3 }], total: 1, nuevos_hoy: 1, hoy: 1, semana: 1 } : []);
  const r = await atenderPanel({ method: 'GET', query: { estado: 'clientes' }, headers: auth }, cfg, { db });
  assert.equal(r.status, 200);
  assert.match(r.body, /Nuevos hoy/);
  assert.match(r.body, /e@x\.es/);
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
  // Clientes: la primera visita es «nuevo», las siguientes suman
  assert.equal(JSON.parse(psql("select sidonia_visita('9', 'a@b.es', 'Ana')::text")).nuevo, true);
  assert.equal(JSON.parse(psql("select sidonia_visita('9', '', '')::text")).nuevo, false);
  const cl = JSON.parse(psql('select sidonia_clientes_lista()::text'));
  assert.equal(cl.total, 1);
  assert.equal(cl.lista[0].visitas, 2);
  assert.equal(cl.lista[0].email, 'a@b.es', 'no se borra el email con una visita sin él');
});

test('panel: editar antes de publicar (textos, ficha, fotos) y emails al dueño', async () => {
  const auth = { authorization: `Basic ${Buffer.from('equipo:panel-secreto').toString('base64')}` };
  const a = { id: 9, ...validar(bueno(), '7001').datos, estado: 'pendiente' };
  const e = leerEdicion({ tipo: 'coche', titulo: 'Porsche 911 SC Targa 1982', precio: '62.500', ubicacion: 'Sevilla', resumen: 'r', historia: 'h', mecanica: 'm',
    ficha: 'Marca: Porsche\nAño: 1982\nsin dos puntos\nColor: Rojo: Guards', vendedor_nombre: 'Enrique', vendedor_tipo: 'profesional', telefono: '+34612345678', quitar: ['0', '1'], portada: '3' }, a);
  assert.equal(e.titulo, 'Porsche 911 SC Targa 1982');
  assert.equal(e.precio, 62500);
  assert.deepEqual(e.ficha, [['Marca', 'Porsche'], ['Año', '1982'], ['Color', 'Rojo: Guards']]);
  assert.equal(e.fotos.length, 8);
  assert.equal(e.fotos[0], a.fotos[3], 'la portada elegida va primera');
  assert.equal(leerEdicion({ titulo: 'Porsche', telefono: '612345678', quitar: a.fotos.map((_, i) => String(i)) }, a).error, 'Tiene que quedar al menos una foto.');
  assert.equal(leerEdicion({ titulo: 'Porsche', precio: '', telefono: '612345678' }, a).precio, null);

  let guardado = null;
  const db = async (fn) => (fn === 'sidonia_anuncios_lista' ? [a] : fn === 'sidonia_anuncio_uno' ? a : { ok: true });
  const g = await atenderPanel({ method: 'POST', query: {}, body: { id: '9', accion: 'guardar', titulo: 'Nuevo título', telefono: '612345678' }, headers: auth }, cfg, { db, guardar: async (c, id, x) => { guardado = { id, x }; } });
  assert.match(g.body, /Guardados los cambios del anuncio #9/);
  assert.equal(guardado.id, 9);
  assert.equal(guardado.x.titulo, 'Nuevo título');
  assert.match(g.body, /Editar antes de publicar/);

  const enviados = [];
  const fetchFalso = async (url, o) => { enviados.push(JSON.parse(o.body)); return { ok: true, text: async () => '' }; };
  const cfgR = { ...cfg, resendKey: 're_x', avisosRemitente: 'Sidonia <hola@sidonia.es>' };
  const r = await atenderPanel({ method: 'POST', query: {}, body: { id: '9', accion: 'rechazar', nota: 'Las fotos tienen poca luz.', avisar: '1' }, headers: auth }, cfgR, { db, fetch: fetchFalso });
  assert.match(r.body, /Email enviado a e@x\.es/);
  assert.match(enviados[0].subject, /Sobre tu anuncio en Sidonia/);
  assert.match(enviados[0].html, /Las fotos tienen poca luz\./);
  const gql = async (query) => (/productCreate/.test(query) ? { productCreate: { product: { id: 'P', handle: 'porsche', variants: { nodes: [] } }, userErrors: [] } } : /publications/.test(query) && !/publishablePublish/.test(query) ? { publications: { nodes: [] } } : {});
  const p = await atenderPanel({ method: 'POST', query: {}, body: { id: '9', accion: 'publicar', avisar: '1' }, headers: auth }, cfgR, { db, gql, fetch: fetchFalso });
  assert.match(p.body, /Email enviado/);
  assert.match(enviados[1].subject, /¡Enhorabuena!/);
  assert.match(enviados[1].html, /https:\/\/sidonia\.es\/products\/porsche/);
  const sin = await atenderPanel({ method: 'POST', query: {}, body: { id: '9', accion: 'rechazar', nota: 'x', avisar: '1' }, headers: auth }, cfg, { db });
  assert.match(sin.body, /falta RESEND_API_KEY/);
});

test('el dueño edita su anuncio: por revisar se cambia ya; publicado, los cambios esperan al equipo', async () => {
  const base = { id: 9, cliente: '7001', ...validar(bueno(), '7001').datos, producto: 'porsche', revision: null };
  const pruebas = [['pendiente', false], ['publicado', true]];
  for (const [estado, conRevision] of pruebas) {
    const cambios = [];
    const tabla = { leer: async () => [{ ...base, estado }], cambiar: async (id, c) => { cambios.push([id, c]); } };
    const db = async () => null;
    const g = JSON.parse((await atender({ method: 'GET', ruta: 'api/anuncio/editar', query: q(), body: {} }, cfg, { db, tabla })).body);
    assert.equal(g.anuncio.titulo, 'Porsche 911 SC 1982');
    assert.equal(g.anuncio.fotos_url.length, 10);
    assert.match(g.anuncio.fotos_url[0], /^https:\/\/x\.supabase\.co\/storage\/v1\/object\/public\/anuncios\/7001\//);
    const r = JSON.parse((await atender({ method: 'POST', ruta: 'api/anuncio/editar', query: q(), body: bueno({ titulo: 'Porsche 911 SC Targa 1982' }) }, cfg, { db, tabla })).body);
    assert.deepEqual(r, { ok: true, revision: conRevision });
    const [id, c] = cambios[0];
    assert.equal(id, 9);
    if (conRevision) {
      assert.equal(c.revision.titulo, 'Porsche 911 SC Targa 1982');
      assert.equal(c.titulo, undefined, 'lo publicado no cambia hasta que se aprueba');
    } else {
      assert.equal(c.titulo, 'Porsche 911 SC Targa 1982');
      assert.equal(c.revision, null);
    }
    assert.equal((c.revision || c).vendedor_slug, undefined, 'el perfil del vendedor no cambia');
  }
  const sin = JSON.parse((await atender({ method: 'POST', ruta: 'api/anuncio/editar', query: q(), body: bueno() }, cfg, { db: async () => null, tabla: { leer: async () => [] } })).body);
  assert.equal(sin.error, 'sin-anuncio');
});

test('el dueño elimina su anuncio: se retira, se archiva en Shopify y puede publicar otro', async () => {
  const llamadas = [];
  const db = async (fn, a) => { llamadas.push([fn, a]); return fn === 'sidonia_anuncio_mio' ? { id: 9, estado: 'publicado', titulo: 'Porsche', producto: 'porsche' } : { ok: true }; };
  const gqls = [];
  const gql = async (query, v) => { gqls.push(v); return /products\(first/.test(query) ? { products: { nodes: [{ id: 'gid://P/1', handle: 'porsche', variants: { nodes: [] }, media: { nodes: [] } }] } } : { productUpdate: { userErrors: [] } }; };
  const r = JSON.parse((await atender({ method: 'POST', ruta: 'api/anuncio/eliminar', query: q(), body: {} }, cfg, { db, gql, tabla: { cambiar: async () => {} } })).body);
  assert.deepEqual(r, { ok: true, archivado: true });
  assert.deepEqual(llamadas.find((c) => c[0] === 'sidonia_anuncio_estado')[1], { p_id: 9, p_estado: 'retirado', p_nota: 'Eliminado por el dueño', p_producto: null });
  assert.deepEqual(gqls[1], { product: { id: 'gid://P/1', status: 'ARCHIVED' } });
  // Con un anuncio activo puede pedir fotos solo para editar
  const dbActivo = async (fn) => (fn === 'sidonia_anuncio_mio' ? { id: 9, estado: 'publicado' } : null);
  const nuevo = JSON.parse((await atender({ method: 'POST', ruta: 'api/anuncio/fotos', query: q(), body: { tipos: ['image/jpeg'] } }, cfg, { db: dbActivo, subidas: async () => ({ ok: true, subidas: [] }) })).body);
  assert.equal(nuevo.error, 'limite');
  const editar = JSON.parse((await atender({ method: 'POST', ruta: 'api/anuncio/fotos', query: q(), body: { tipos: ['image/jpeg'], editar: true } }, cfg, { db: dbActivo, subidas: async () => ({ ok: true, subidas: [] }) })).body);
  assert.equal(editar.ok, true);
});

test('panel › Cambios: antes y ahora; aprobar actualiza la ficha y el anuncio; no aprobar lo deja como estaba', async () => {
  const auth = { authorization: `Basic ${Buffer.from('equipo:panel-secreto').toString('base64')}` };
  const a = { id: 9, cliente: '7001', ...validar(bueno(), '7001').datos, estado: 'publicado', producto: 'porsche', revision_fecha: new Date().toISOString() };
  a.revision = { ...Object.fromEntries(['tipo', 'titulo', 'precio', 'ubicacion', 'resumen', 'historia', 'mecanica', 'ficha', 'fotos', 'vendedor_nombre', 'vendedor_tipo', 'telefono', 'acepta_telefono'].map((k) => [k, a[k]])), titulo: 'Porsche 911 SC Targa', precio: 60000 };
  let cambiado = null;
  const tabla = { leer: async () => [a], cambiar: async (id, c) => { cambiado = c; } };
  const lista = await atenderPanel({ method: 'GET', query: { estado: 'cambios' }, headers: auth }, cfg, { db: async () => null, tabla });
  assert.match(lista.body, /class="antes">Porsche 911 SC 1982<\/td><td class="ahora">Porsche 911 SC Targa<\/td>/);
  assert.match(lista.body, /65\.000 €<\/td><td class="ahora">60\.000 €/);
  assert.doesNotMatch(lista.body, /<th>Ubicación<\/th>/, 'solo lo que cambia');
  const pasos = [];
  const gql = async (query, v) => {
    pasos.push(query.match(/(productUpdate|productVariantsBulkUpdate|metafieldsSet|productCreateMedia|productDeleteMedia|products\(first)/)[1]);
    if (/products\(first/.test(query)) return { products: { nodes: [{ id: 'gid://P/1', handle: 'porsche', variants: { nodes: [{ id: 'gid://V/1' }] }, media: { nodes: [{ id: 'gid://M/1' }] } }] } };
    if (/productUpdate/.test(query)) { assert.equal(v.product.title, 'Porsche 911 SC Targa'); return { productUpdate: { userErrors: [] } }; }
    return {};
  };
  const ok = await atenderPanel({ method: 'POST', query: { estado: 'cambios' }, body: { id: '9', accion: 'aplicar' }, headers: auth }, cfg, { db: async () => null, tabla, gql });
  assert.match(ok.body, /Cambios aprobados en el anuncio #9 y actualizada su ficha en la tienda/);
  assert.deepEqual(pasos, ['products(first', 'productUpdate', 'productVariantsBulkUpdate', 'metafieldsSet'], 'las fotos no han cambiado: no se tocan');
  assert.equal(cambiado.titulo, 'Porsche 911 SC Targa');
  assert.equal(cambiado.revision, null);
  const no = await atenderPanel({ method: 'POST', query: { estado: 'cambios' }, body: { id: '9', accion: 'descartar', nota: 'El precio no cuadra' }, headers: auth }, cfg, { db: async () => null, tabla });
  assert.match(no.body, /No aprobados los cambios del anuncio #9/);
  assert.deepEqual(cambiado, { revision: null, revision_fecha: null });
});
