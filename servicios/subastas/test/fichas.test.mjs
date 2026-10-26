import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../lib/motor.mjs';
import { atenderPanel } from '../lib/circulo.mjs';
import { guardarFicha, leerFicha, situacion } from '../lib/fichas.mjs';
import { emparejar, parecido, sugerencias } from '../lib/operaciones.mjs';

const nodo = (o) => ({ id: `gid://shopify/Product/${o.n}`, handle: o.handle, title: o.title, status: o.status || 'ACTIVE', productType: 'Coches', vendor: 'Sidonia', tags: o.tags || [], createdAt: '2026-03-01T10:00:00Z', descriptionHtml: '<p>Hola</p>',
  featuredImage: { url: 'https://cdn/x.jpg' }, images: { nodes: [{ url: 'https://cdn/x.jpg' }] }, variants: { nodes: [{ id: `gid://shopify/ProductVariant/${o.n}`, price: String(o.precio || 0), compareAtPrice: null }] },
  provincia: o.provincia ? { value: o.provincia } : null, propietario: null, vendedor: null, precio: { minVariantPrice: { amount: String(o.precio || 0) } } });
const TIENDA = [nodo({ n: 1, handle: 'porsche-914-6-1970', title: 'PORSCHE 914/6 1970', precio: 69914, provincia: 'Madrid' }), nodo({ n: 2, handle: 'land-rover-santana', title: 'LAND ROVER SANTAN SERIE 3A 1980', precio: 15800, tags: ['vendido'] }),
  nodo({ n: 3, handle: 'mercedes-190-sl', title: 'MERCEDES-BENZ 190 SL 1962', precio: 130000, status: 'DRAFT' })];

function gqlFalso() {
  const llamadas = [];
  const gql = async (q, v) => {
    llamadas.push([q.match(/(productUpdate|productVariantsBulkUpdate|metafieldsSet|metafieldsDelete|products)/)?.[1], v]);
    if (/products\(first/.test(q)) return { products: { nodes: TIENDA, pageInfo: { hasNextPage: false } } };
    return { productUpdate: { userErrors: [] }, productVariantsBulkUpdate: { userErrors: [] }, metafieldsSet: { userErrors: [] }, metafieldsDelete: { userErrors: [] } };
  };
  return { gql, llamadas };
}

test('enlazar: erratas, títulos sin año y el más concreto primero', () => {
  assert.ok(parecido('LAND ROVER SANATANA SERIE III', 'LAND ROVER SANTANA SERIE III 1985') > 0.9, 'SANATANA = SANTANA');
  assert.ok(parecido('JEEP WRANGLLER', 'JEEP WRANGLER 2015') > 0.9);
  assert.ok(parecido('MERCEDES 190SL', 'MERCEDES-BENZ 190 SL 1962') > 0.9, '190SL = 190 SL');
  // El del año se queda su ficha; el que no lo tiene no se la quita
  const r = emparejar([{ id: 1, titulo: 'PORSCHE 914/6', precio_anunciado: 18000 }, { id: 2, titulo: 'PORSCHE 914/6 1970', precio_anunciado: 69914 }], [{ handle: 'p', title: 'PORSCHE 914/6 1970', precio: { minVariantPrice: { amount: '69914' } } }]);
  assert.deepEqual(r.map((x) => [x.id, x.cambios.handle]), [[2, 'p']]);
  // Si el precio es muy distinto, no se enlaza solo
  assert.equal(emparejar([{ id: 1, titulo: 'JEEP WRANGLER', precio_anunciado: 55000 }], [{ handle: 'j', title: 'JEEP WRANGLER 2.5 SPORT 2000', precio: { minVariantPrice: { amount: '12000' } } }]).length, 0);
  assert.deepEqual(sugerencias('MUSTANG 289 AZUL', [{ handle: 'f', title: 'FORD MUSTANG 1966' }, { handle: 'x', title: 'SAAB 900' }]).map((p) => p.handle), ['f']);
});

test('fichas: en venta, reservado, vendido u oculto', () => {
  assert.deepEqual([{ tags: ['Vendido'] }, { tags: ['reservado'] }, { status: 'DRAFT' }, { status: 'ACTIVE' }].map(situacion), ['vendido', 'reservado', 'oculto', 'en_venta']);
});

test('editar un anuncio: solo lo que cambia; vendido es una etiqueta; vacío quita el metacampo', async () => {
  const f = { id: 'gid://shopify/Product/1', variante: 'gid://shopify/ProductVariant/1', titulo: 'PORSCHE 914/6 1970', status: 'ACTIVE', tipo: 'Coches', descripcion: '<p>Hola</p>', tags: ['clasico'], precio: 69914, precio_antes: 0, provincia: 'Madrid', propietario: '' };
  const { cambios, situacion: s } = leerFicha({ titulo: 'PORSCHE 914/6 1970', situacion: 'vendido', status: 'ACTIVE', tipo: 'Coches', descripcion: '<p>Hola</p>', etiquetas: 'clasico, Vendido', precio: '65000', precio_antes: '69914', provincia: '', propietario: 'Carlos' }, f);
  assert.equal(s, 'vendido');
  assert.deepEqual(cambios, { tags: ['clasico', 'vendido'], precio: 65000, precio_antes: 69914, provincia: '', propietario: 'Carlos' });
  const { gql, llamadas } = gqlFalso();
  await guardarFicha(gql, f, cambios);
  assert.deepEqual(llamadas.map((x) => x[0]), ['productUpdate', 'productVariantsBulkUpdate', 'metafieldsSet', 'metafieldsDelete']);
  assert.deepEqual(llamadas[1][1].variants, [{ id: 'gid://shopify/ProductVariant/1', price: '65000', compareAtPrice: '69914' }]);
  assert.equal(leerFicha({ titulo: '' }, f).error, 'Falta el título.');
});

function tablaFalsa(filas = []) {
  return { filas, async leer(q) { const id = (q.match(/id=eq\.(\d+)/) || [])[1]; return id ? filas.filter((o) => o.id === Number(id)) : [...filas]; }, async cambiar(id, c) { Object.assign(filas.find((o) => o.id === id), c); }, async guardar(x) { filas.push(x); return x; }, async borrar() {} };
}

test('panel › Anuncios › En la web: lista, editar (y la venta al día) y enlazar a mano', async () => {
  const cfg = config({ ADMIN_CLAVE: 'p', SHOPIFY_TIENDA: 'sidonia.myshopify.com', TIENDA_URL: 'https://sidonia.es' });
  const auth = { authorization: 'Basic ' + Buffer.from('a:p').toString('base64') };
  const operaciones = tablaFalsa([{ id: 5, titulo: 'PORSCHE 914/6 1970', handle: 'porsche-914-6-1970', estado: 'en_venta', comision: 4194, modalidad: 'gestion' }, { id: 6, titulo: 'MERCEDES 190SL', estado: 'en_venta', modalidad: 'gestion', precio_anunciado: 130000 }]);
  const { gql, llamadas } = gqlFalso();
  const deps = { db: async () => [], gql, operaciones, tabla: tablaFalsa([]) };
  const l = await atenderPanel({ method: 'GET', query: { estado: 'fichas' }, headers: auth }, cfg, deps);
  assert.match(l.body, /<title>Anuncios en la web/);
  assert.match(l.body, /class="on">Anuncios/);
  assert.match(l.body, /\?estado=operacion&id=5">Venta · 4194 €/);
  assert.match(l.body, /\?estado=operacion&de=land-rover-santana" class="sub">\+ Crear venta/);
  const e = await atenderPanel({ method: 'GET', query: { estado: 'ficha', h: 'porsche-914-6-1970' }, headers: auth }, cfg, deps);
  assert.match(e.body, /admin\.shopify\.com\/store\/sidonia\/products\/1/);
  const g = await atenderPanel({ method: 'POST', query: { estado: 'ficha', h: 'porsche-914-6-1970' }, body: { accion: 'guardar', titulo: 'PORSCHE 914/6 1970', situacion: 'vendido', status: 'ACTIVE', tipo: 'Coches', descripcion: '<p>Hola</p>', etiquetas: '', precio: '69914', precio_antes: '', provincia: 'Madrid', propietario: 'Carlos' }, headers: auth }, cfg, deps);
  assert.match(g.body, /Guardado en la web/);
  assert.equal(operaciones.filas[0].estado, 'vendido', 'la venta pasa a vendida');
  assert.equal(operaciones.filas[0].propietario_nombre, 'Carlos');
  assert.ok(llamadas.some((x) => x[0] === 'productUpdate' && x[1].product.tags.includes('vendido')));
  // Crear venta desde un anuncio: rellenado con la ficha
  const c = await atenderPanel({ method: 'GET', query: { estado: 'operacion', de: 'land-rover-santana' }, headers: auth }, cfg, deps);
  assert.match(c.body, /value="LAND ROVER SANTAN SERIE 3A 1980"/);
  assert.match(c.body, /<option value="vendido" selected>/);
  // Enlazar a mano: sugerencias y enlazar
  const m = await atenderPanel({ method: 'GET', query: { estado: 'enlazar' }, headers: auth }, cfg, deps);
  assert.match(m.body, /MERCEDES 190SL/);
  assert.match(m.body, /name="handle" value="mercedes-190-sl"/);
  const ok = await atenderPanel({ method: 'POST', query: { estado: 'enlazar' }, body: { accion: 'ligar', id: '6', handle: 'mercedes-190-sl' }, headers: auth }, cfg, deps);
  assert.match(ok.body, /Enlazado: MERCEDES 190SL → MERCEDES-BENZ 190 SL 1962/);
  assert.deepEqual([operaciones.filas[1].handle, operaciones.filas[1].fecha_alta, operaciones.filas[1].titulo], ['mercedes-190-sl', '2026-03-01', 'MERCEDES-BENZ 190 SL 1962'], 'con el título del anuncio');
  // Todas las sugerencias claras de golpe
  operaciones.filas.push({ id: 7, titulo: 'LAND ROVER SANTANA SERIE 3A 1980', estado: 'vendido', modalidad: 'gestion' });
  const claras = await atenderPanel({ method: 'POST', query: { estado: 'enlazar' }, body: { accion: 'ligar_claras' }, headers: auth }, cfg, deps);
  assert.match(claras.body, /Enlazadas 1 con su anuncio/);
  assert.equal(operaciones.filas[2].handle, 'land-rover-santana');
  assert.match((await atenderPanel({ method: 'POST', query: { estado: 'enlazar' }, body: { accion: 'ligar', id: '6', handle: 'no-existe' }, headers: auth }, cfg, deps)).body, /no hay ninguna ficha/);
});
