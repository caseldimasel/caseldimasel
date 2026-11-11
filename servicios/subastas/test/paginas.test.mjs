import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../lib/motor.mjs';
import { atenderPanel } from '../lib/circulo.mjs';
import { ponerPaginas, PAGINAS } from '../lib/paginas.mjs';

// Una tienda de mentira: «alquiler» ya existe sin plantilla y oculta, «profesionales» ya está bien; el tema no tiene la de eventos
function tienda({ temaSin = ['templates/page.agenda.json'], sinPermisoTema = false } = {}) {
  const paginas = [
    { id: 'gid://shopify/Page/1', handle: 'alquiler', title: 'Alquiler', templateSuffix: null, isPublished: false },
    { id: 'gid://shopify/Page/2', handle: 'profesionales', title: 'Profesionales', templateSuffix: 'profesionales', isPublished: true }
  ];
  const hechos = { creadas: [], cambiadas: [] };
  const gql = async (q, v) => {
    if (q.includes('pages(first')) return { pages: { nodes: paginas } };
    if (q.includes('pageCreate')) { hechos.creadas.push(v.page); return { pageCreate: { page: { id: 'x', handle: v.page.handle }, userErrors: [] } }; }
    if (q.includes('pageUpdate')) { hechos.cambiadas.push([v.id, v.page]); return { pageUpdate: { page: { id: v.id }, userErrors: [] } }; }
    if (q.includes('themes(')) {
      if (sinPermisoTema) throw new Error('Shopify 200: [{"extensions":{"code":"ACCESS_DENIED"}}]');
      return { themes: { nodes: [{ id: 't', name: 'Sidonia', files: { nodes: v.f.filter((f) => !temaSin.includes(f)).map((filename) => ({ filename })) } }] } };
    }
    throw new Error('consulta inesperada');
  };
  return { gql, hechos };
}

test('páginas: crea las que faltan con su plantilla, pone la plantilla a las que no la tienen y no publica las ocultas', async () => {
  const { gql, hechos } = tienda();
  const { informe } = await ponerPaginas(gql);
  const por = Object.fromEntries(informe.map((r) => [r.handle, r]));
  assert.equal(por.eventos.estado, 'creada');
  assert.equal(por.alquiler.estado, 'enlazada');
  assert.equal(por.alquiler.oculta, true);
  assert.equal(por.profesionales.estado, 'ok');
  assert.equal(por.eventos.plantillaEnTema, false);
  assert.equal(por.alquiler.plantillaEnTema, true);
  assert.deepEqual(hechos.creadas.find((p) => p.handle === 'eventos'), { title: 'Eventos', handle: 'eventos', body: '', isPublished: true, templateSuffix: 'agenda' });
  assert.equal(hechos.creadas.length, PAGINAS.length - 2);
  assert.deepEqual(hechos.cambiadas, [['gid://shopify/Page/1', { templateSuffix: 'alquiler' }]]);
});

test('páginas: sin el botón solo mira (no crea ni cambia nada); sin permiso de temas sigue funcionando', async () => {
  const { gql, hechos } = tienda({ sinPermisoTema: true });
  const { informe, tema } = await ponerPaginas(gql, { hacer: false });
  assert.equal(informe.find((r) => r.handle === 'eventos').estado, 'falta');
  assert.equal(informe.find((r) => r.handle === 'alquiler').estado, 'sin-plantilla');
  assert.equal(informe[0].plantillaEnTema, null);
  assert.equal(tema.error, 'sin-permiso');
  assert.deepEqual(hechos, { creadas: [], cambiadas: [] });
});

test('panel › Páginas de la web: el botón las crea y avisa si el tema no tiene la plantilla', async () => {
  const { gql } = tienda();
  const cfg = config({ ADMIN_CLAVE: 'panel', SHOPIFY_TIENDA: 'sidonia.myshopify.com', SHOPIFY_CLIENT_ID: 'cid', TIENDA_URL: 'https://sidonia.es' });
  const auth = { authorization: 'Basic ' + Buffer.from('equipo:panel').toString('base64') };
  const get = await atenderPanel({ method: 'GET', query: { estado: 'paginas' }, body: {}, headers: auth }, cfg, { db: async () => [], gql });
  assert.match(get.body, /Crear las páginas y poner los textos legales/);
  assert.match(get.body, /No existe/);
  // La web con los textos legales (para copiarlos en las políticas de Shopify)
  const leidas = [];
  const fetchWeb = async (u) => { leidas.push(u); return { text: async () => `<article class="lg"><div class="lg__in"><h1>Título</h1><p class="lg__meta">Hoy</p><p><button type="button" class="lg__btn" data-lg-cookies>Cambiar</button></p>${'<p>Texto legal de Sidonia. </p>'.repeat(20)}<nav class="lg__otros">menú</nav></div></article>` }; };
  const politicas = [];
  const gql2 = async (q, v) => { if (/shopPolicyUpdate/.test(q)) { politicas.push(v.p); return { shopPolicyUpdate: { shopPolicy: { id: 'x', type: v.p.type }, userErrors: [] } }; } return gql(q, v); };
  const r = await atenderPanel({ method: 'POST', query: { estado: 'paginas' }, body: { accion: 'paginas' }, headers: auth }, cfg, { db: async () => [], gql: gql2, fetch: fetchWeb });
  assert.match(r.body, new RegExp(`Listo: ${PAGINAS.length - 2} páginas creadas, 1 con su plantilla puesta, 4 políticas de Shopify con los textos nuevos`));
  assert.deepEqual(politicas.map((x) => x.type), ['PRIVACY_POLICY', 'TERMS_OF_SERVICE', 'CONTACT_INFORMATION', 'LEGAL_NOTICE']);
  assert.match(leidas[0], /sidonia\.es\/pages\/vende-con-nosotros\?view=privacidad/);
  assert.doesNotMatch(politicas[0].body, /<h1>|data-lg-cookies|lg__otros/); assert.match(politicas[0].body, /Texto legal de Sidonia/);
  assert.match(r.body, /no tiene la plantilla de Eventos/);
  assert.match(r.body, /https:\/\/sidonia\.es\/pages\/eventos/);
});

test('páginas: sin permiso de páginas, explica qué permisos añadir', async () => {
  const gql = async () => { throw new Error('La app de Shopify no tiene permiso para crear productos.'); };
  await assert.rejects(ponerPaginas(gql), /write_online_store_pages/);
});
