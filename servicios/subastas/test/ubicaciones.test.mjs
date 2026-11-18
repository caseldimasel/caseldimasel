import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../lib/motor.mjs';
import { atenderPanel } from '../lib/circulo.mjs';
import { provinciaDe, provinciaDeDescripcion, rellenarUbicaciones, ubicacionDe } from '../lib/ubicaciones.mjs';

test('ubicación: «📍 Ubicación: …», «📍 Madrid», línea «Ubicación:» y «Ubicación» con el sitio debajo', () => {
  assert.equal(ubicacionDe('<p>Ficha técnica</p><p>📍 Ubicación: Pozuelo de Alarcón, Madrid</p>'), 'Pozuelo de Alarcón, Madrid');
  assert.equal(ubicacionDe('<p>Bonito coche</p><p>📍 Marbella</p>'), 'Marbella');
  assert.equal(ubicacionDe('<p>📍 Origen: Alemania</p><p>📍 Sitges</p>'), 'Sitges', '«Origen» no es la ubicación');
  assert.equal(ubicacionDe('<ul><li>Año: 1967</li><li>Ubicación: Valencia</li></ul>'), 'Valencia');
  assert.equal(ubicacionDe('<p>🗺️ Localización: Bilbao</p>'), 'Bilbao');
  assert.equal(ubicacionDe('<h3>Ubicación</h3><p>Sotogrande</p>'), 'Sotogrande');
  assert.equal(ubicacionDe('Ubicación: Toledo<br>Precio: 30.000 €'), 'Toledo');
  assert.equal(ubicacionDe('<p>Un libro precioso sobre Ferrari</p>'), '');
});

test('provincia: del sitio a la provincia, sin confundir palabras parecidas', () => {
  assert.equal(provinciaDe('Pozuelo de Alarcón'), 'Madrid');
  assert.equal(provinciaDe('Marbella, Málaga'), 'Málaga');
  assert.equal(provinciaDe('Puerto de Santa María'), 'Cádiz');
  assert.equal(provinciaDe('Palmanova'), '', '«palma» dentro de otra palabra no cuenta');
  assert.deepEqual(provinciaDeDescripcion('<p>📍 Ubicación: Majadahonda</p>'), { sitio: 'Majadahonda', provincia: 'Madrid' });
  assert.deepEqual(provinciaDeDescripcion('<p>📍 Ubicación: Saint-Tropez</p>'), { sitio: 'Saint-Tropez', provincia: 'Saint-Tropez' }, 'si no se reconoce, el sitio tal cual');
});

// Una tienda de mentira: tres productos (uno ya con provincia, otro sin ubicación en la descripción)
function tienda() {
  const productos = [
    { id: 'gid://shopify/Product/1', handle: 'porsche-911', title: 'PORSCHE 911', tags: [], descriptionHtml: '<p>📍 Ubicación: Las Rozas</p>', provincia: null },
    { id: 'gid://shopify/Product/2', handle: 'jaguar-xj', title: 'JAGUAR XJ', tags: ['Sevilla'], descriptionHtml: '<p>📍 Sevilla</p>', provincia: { value: 'Sevilla' } },
    { id: 'gid://shopify/Product/3', handle: 'libro', title: 'LIBRO FERRARI', tags: [], descriptionHtml: '<p>Un libro</p>', provincia: null }
  ];
  const hechos = { metafields: [], tags: [] };
  const gql = async (q, v) => {
    if (q.includes('products(first: 100')) return { products: { nodes: productos, pageInfo: { hasNextPage: false, endCursor: null } } };
    if (q.includes('metafieldsSet')) { hechos.metafields.push(...v.m); return { metafieldsSet: { userErrors: [] } }; }
    if (q.includes('tagsAdd')) { hechos.tags.push([v.id, ...v.tags]); return { tagsAdd: { userErrors: [] } }; }
    throw new Error('consulta inesperada');
  };
  return { gql, hechos };
}

test('rellenar: pone provincia y etiqueta a los que no la tienen; respeta las puestas', async () => {
  const { gql, hechos } = tienda();
  const informe = await rellenarUbicaciones(gql, { etiqueta: true });
  assert.deepEqual(informe.map((r) => [r.handle, r.provincia, r.estado]), [['porsche-911', 'Madrid', 'nuevo'], ['jaguar-xj', 'Sevilla', 'ya'], ['libro', '', 'sin']]);
  assert.deepEqual(hechos.metafields, [{ ownerId: 'gid://shopify/Product/1', namespace: 'custom', key: 'provincia', type: 'single_line_text_field', value: 'Madrid' }]);
  assert.deepEqual(hechos.tags, [['gid://shopify/Product/1', 'Madrid']]);
});

test('panel › Ubicaciones: el botón lo pone todo y enseña el informe', async () => {
  const { gql } = tienda();
  const cfg = config({ ADMIN_CLAVE: 'panel', SHOPIFY_TIENDA: 'sidonia.myshopify.com', SHOPIFY_CLIENT_ID: 'cid', TIENDA_URL: 'https://sidonia.es' });
  const auth = { authorization: 'Basic ' + Buffer.from('equipo:panel').toString('base64') };
  const get = await atenderPanel({ method: 'GET', query: { estado: 'ubicaciones' }, body: {}, headers: auth }, cfg, { db: async () => [], gql });
  assert.match(get.body, /Poner las ubicaciones/);
  const r = await atenderPanel({ method: 'POST', query: { estado: 'ubicaciones' }, body: { accion: 'ubicaciones', etiqueta: '1' }, headers: auth }, cfg, { db: async () => [], gql });
  assert.match(r.body, /Listo: 1 ubicaciones puestas/);
  assert.match(r.body, /<b>Madrid<\/b> <small>\(Las Rozas\)<\/small>/);
  assert.match(r.body, /Ponerla a mano/);
});
