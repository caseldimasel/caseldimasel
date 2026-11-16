// El panel con los anuncios de Shopify: fotos (también de los que solo tienen vídeo), vendidos por unidades, los números
// de cada anuncio, la ficha completa (anuncio + números + venta) y cada venta con su anuncio
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../lib/motor.mjs';
import { atenderPanel, fotoProducto, situacionTienda } from '../lib/circulo.mjs';
import { olvidarCatalogo } from '../lib/actividad.mjs';
import { emparejar } from '../lib/operaciones.mjs';

const cfg = config({ ADMIN_CLAVE: 'panel', TIENDA_URL: 'https://sidonia.es' });
const auth = { authorization: 'Basic ' + Buffer.from('equipo:panel').toString('base64') };
const nodo = (o) => ({ id: `gid://shopify/Product/${o.n}`, handle: o.handle, title: o.title, status: o.status || 'ACTIVE', productType: 'Cars', vendor: 'Sidonia', tags: o.tags || [], createdAt: '2026-03-01T10:00:00Z', descriptionHtml: '',
  featuredImage: o.foto ? { url: o.foto } : null, featuredMedia: o.foto || o.video ? { preview: { image: { url: o.foto || o.video } } } : null,
  media: { nodes: o.foto ? [{ mediaContentType: 'IMAGE', preview: { image: { url: o.foto } } }] : o.video ? [{ mediaContentType: 'VIDEO', preview: { image: { url: o.video } } }] : [] },
  variants: { nodes: [{ id: `gid://v/${o.n}`, price: String(o.precio || 0), compareAtPrice: null, availableForSale: o.disponible !== false }] }, precio: { minVariantPrice: { amount: String(o.precio || 0) } },
  provincia: null, propietario: null, vendedor: null, anuncio: o.anuncio ? { value: String(o.anuncio) } : null });
const TIENDA = [
  nodo({ n: 1, handle: 'porsche-912-1970', title: 'PORSCHE 912 1967', precio: 69900, video: 'https://cdn/912-video.jpg' }),
  nodo({ n: 2, handle: 'jaguar-xj12-he-19', title: 'JAGUAR XJ12 5.3 HE 1982', precio: 14500, foto: 'https://cdn/jaguar.jpg', disponible: false }),
  nodo({ n: 3, handle: 'seat-600-dueno', title: 'SEAT 600 1970', precio: 6000, foto: 'https://cdn/600.jpg', tags: ['dueno'], anuncio: 12 })
];
const memo = (filas) => { let id = 100; return { filas, leer: async (q = '') => { const m = /handle=eq\.([^&]+)/.exec(q); return m ? filas.filter((o) => o.handle === decodeURIComponent(m[1])) : filas; },
  cambiar: async (i, c) => Object.assign(filas.find((x) => x.id === i), c), guardar: async (x) => { const n = { id: id++, ...x }; filas.push(n); return n; }, borrar: async () => {} }; };
function preparar(ops = []) {
  olvidarCatalogo();
  const llamadas = [];
  const gql = async (q, v) => { llamadas.push(q); if (/products\(first/.test(q)) return { products: { nodes: TIENDA, pageInfo: { hasNextPage: false } } }; return { productUpdate: { userErrors: [] }, productVariantsBulkUpdate: { userErrors: [] } }; };
  const numeros = { 'porsche-912-1970': { vistas: 300, personas: 120, contactos: 7, guardados: 4 }, 'jaguar-xj12-he-19': { vistas: 50, personas: 30, contactos: 1, guardados: 0 } };
  const db = async (fn, a) => (fn === 'sidonia_por_anuncio' ? numeros : fn === 'sidonia_crm_anuncio' ? { handle: a.p_handle, titulo: 'TÍTULO DE CUANDO LO VIERON', total: { vistas: 300, personas: 120, contactos: 7 }, interesados: [] }
    : fn === 'sidonia_estadisticas' ? { actual: {}, anterior: {}, anuncios: [{ handle: 'porsche-912-1970', titulo: 'porsche viejo', vistas: 10 }, { handle: 'coche-borrado', titulo: 'BORRADO', vistas: 2 }], mas_contactados: [], mas_guardados: [], por_dia: [] } : {});
  const deps = { gql, db, operaciones: memo(ops), tabla: { leer: async () => [] }, eventos: { leer: async () => [] } };
  const pag = async (q, method = 'GET', body = {}) => (await atenderPanel({ method, query: q, body, headers: auth }, cfg, deps)).body;
  return { deps, pag, llamadas };
}

test('tienda: la portada es la foto o, si solo tiene vídeo, su imagen; vendido también si no quedan unidades', () => {
  assert.equal(fotoProducto(TIENDA[0]), 'https://cdn/912-video.jpg');
  assert.equal(fotoProducto(TIENDA[1]), 'https://cdn/jaguar.jpg');
  assert.equal(situacionTienda(TIENDA[0]), 'en_venta');
  assert.equal(situacionTienda(TIENDA[1]), 'vendido', 'sin unidades = vendido, como en la web');
  assert.equal(situacionTienda({ ...TIENDA[0], tags: ['Reservado'] }), 'reservado');
  assert.equal(situacionTienda({ ...TIENDA[0], status: 'DRAFT' }), 'oculto');
});

test('panel › Anuncios: todos con foto (también los de vídeo), vendidos por unidades, sus vistas y contactos, y crear las ventas que faltan', async () => {
  const { pag, deps } = preparar([]);
  const h = await pag({ estado: 'fichas' });
  assert.match(h, /912-video\.jpg/); assert.match(h, /▶ vídeo/);
  assert.match(h, /<span>Vendidos<\/span><b>1/); assert.match(h, /<span>En venta<\/span><b>2/);
  assert.match(h, />300<\/a>/); assert.match(h, /120 personas/);
  assert.match(h, /Crear la venta de los 2 anuncios de Sidonia sin venta/, 'los de dueños no');
  const o = await pag({ estado: 'fichas', orden: 'contactos' });
  assert.ok(o.indexOf('PORSCHE 912') < o.indexOf('JAGUAR'), 'ordenado por contactos');
  const r = await pag({ estado: 'fichas', de: 'gestion', ver: 'sinventa' }, 'POST', { accion: 'crear_ventas' });
  assert.match(r, /Creadas 2 ventas nuevas/);
  const ops = deps.operaciones.filas;
  assert.deepEqual(ops.map((x) => [x.handle, x.estado, x.precio_anunciado, x.modalidad]).sort(), [['jaguar-xj12-he-19', 'vendido', 14500, 'gestion'], ['porsche-912-1970', 'en_venta', 69900, 'gestion']]);
  assert.doesNotMatch(await pag({ estado: 'fichas' }), /Crear la venta de los/);
});

test('panel › un anuncio: foto, título de ahora, estado, sus números y su venta', async () => {
  const { pag } = preparar([{ id: 1, handle: 'jaguar-xj12-he-19', titulo: 'JAGUAR XJ12 5.3 HE 1982', estado: 'vendido', precio_venta: 14000, comision: 1200, comprador_nombre: 'Juan Pérez', fecha_venta: '2026-09-02' }]);
  const h = await pag({ estado: 'anuncio', h: 'jaguar-xj12-he-19' });
  assert.match(h, /jaguar\.jpg/); assert.match(h, /JAGUAR XJ12 5\.3 HE 1982/); assert.doesNotMatch(h, /TÍTULO DE CUANDO/);
  assert.match(h, /Vendido por 14\.000 €/); assert.match(h, /Comprador: Juan Pérez/); assert.match(h, /Comisión 1200 €|Comisión 1\.200 €/);
  assert.match(h, /\?estado=operacion&id=1/);
  const sin = await pag({ estado: 'anuncio', h: 'porsche-912-1970' });
  assert.match(sin, /\+ Crear la venta/); assert.match(sin, /912-video\.jpg/);
  assert.match(await pag({ estado: 'anuncio', h: 'coche-borrado' }), /Ya no está en la tienda/);
});

test('panel › Estadísticas: títulos de ahora y los que ya no están, marcados', async () => {
  const { pag } = preparar([]);
  const h = await pag({ estado: 'estadisticas' });
  assert.match(h, /PORSCHE 912 1967/); assert.doesNotMatch(h, /porsche viejo/);
  assert.match(h, /Ya no está en la web/);
  assert.match(h, /912-video\.jpg/);
});

test('panel › Ventas: foto de su anuncio, se enlazan solas y lo vendido en la tienda se pone igual', async () => {
  const ops = [{ id: 1, titulo: 'Porsche 912', estado: 'en_venta', modalidad: 'gestion', tipo: 'coche' }, { id: 2, titulo: 'Jaguar XJ12 5.3', estado: 'en_venta', modalidad: 'gestion', tipo: 'coche', precio_anunciado: 14500 }];
  const { pag } = preparar(ops);
  const h = await pag({ estado: 'ventas' });
  assert.equal(ops[0].handle, 'porsche-912-1970'); assert.equal(ops[0].titulo, 'PORSCHE 912 1967');
  assert.equal(ops[1].handle, 'jaguar-xj12-he-19'); assert.equal(ops[1].estado, 'vendido', 'sin unidades en la tienda: vendido');
  assert.match(h, /912-video\.jpg/); assert.match(h, /anuncio y números/);
});

test('enlazar: una venta cerrada no se enlaza sola con un anuncio que sigue a la venta', () => {
  const r = emparejar([{ id: 1, titulo: 'PORSCHE 912', estado: 'vendido' }], [{ ...TIENDA[0] }]);
  assert.equal(r.length, 0);
  assert.equal(emparejar([{ id: 1, titulo: 'JAGUAR XJ12 5.3 HE', estado: 'vendido' }], [{ ...TIENDA[1] }]).length, 1);
});

test('panel › Anuncios en CSV: cada anuncio con su estado, sus números y su venta', async () => {
  const { pag, deps } = preparar([{ id: 7, handle: 'jaguar-xj12-he-19', estado: 'vendido', comision: 1200, comprador_nombre: 'Juan' }]);
  const r = await atenderPanel({ method: 'GET', query: { estado: 'fichas', csv: '1' }, body: {}, headers: auth }, cfg, deps);
  assert.match(r.headers['Content-Type'], /text\/csv/);
  assert.match(r.body, /porsche-912-1970;PORSCHE 912 1967;En venta;Gestión de venta;Cars;;;69900;2026-03-01;300;120;7;4/);
  assert.match(r.body, /jaguar-xj12-he-19;.*;Vendido;.*;7;vendido;1200;Juan/);
  assert.ok(pag);
});
