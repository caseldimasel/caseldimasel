import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atender, config } from '../lib/motor.mjs';
import { correoPublicado } from '../lib/correos.mjs';
import { DIAS_OFRECER, enlaceGestion, firmaGestion, ofrecerGestion } from '../lib/gestion.mjs';
import { paginaPanel } from '../lib/circulo.mjs';

const cfg = config({ SUBASTAS_CLAVE: 'k', RESEND_API_KEY: 're_x', AVISOS_EQUIPO: 'equipo@sidonia.es', TIENDA_URL: 'https://sidonia.es', SERVIDOR_URL: 'https://motor.test', SUPABASE_URL: 'https://x.supabase.co', CRON_SECRET: 'cron' });
const DIA = 864e5;
const anuncio = (x = {}) => ({ id: 9, estado: 'publicado', tipo: 'coche', titulo: 'BMW M3 E30 1988', precio: 64900, ubicacion: 'Madrid', vendedor_nombre: 'Javier', vendedor_tipo: 'particular', telefono: '600111222', email: 'javier@x.es', producto: 'bmw-m3-e30', fotos: ['77/a.jpg'], ficha: [], resumen: '', historia: '', mecanica: '', creado: new Date(Date.now() - 20 * DIA).toISOString(), ...x });

function preparar(filas) {
  const correos = [], cambios = [];
  const deps = {
    db: async () => null,
    fetch: async (u, o) => { correos.push(JSON.parse(o.body)); return { ok: true, json: async () => ({}) }; },
    tabla: {
      leer: async (f) => filas.filter((a) => (!f.includes('id=eq.') || f.includes(`id=eq.${a.id}`)) && (!f.includes('ofrecida_gestion=is.null') || (!a.ofrecida_gestion && !a.quiere_gestion && new Date(a.creado) < new Date(f.match(/creado=lt\.([^&]+)/)[1])))),
      cambiar: async (id, c) => { cambios.push([id, c]); Object.assign(filas.find((a) => a.id === id), c); }
    }
  };
  return { deps, correos, cambios };
}

test('gestión: el email de «Ya está publicado» ofrece que lo vendamos nosotros, con su enlace firmado', () => {
  const { html } = correoPublicado(cfg, anuncio(), 'https://sidonia.es/products/bmw-m3-e30');
  assert.match(html, /También podemos venderlo nosotros/);
  assert.ok(html.includes(`https://motor.test/tienda/gestion?a=9&amp;f=${firmaGestion(cfg, 9)}`));
});

test(`gestión: a los ${DIAS_OFRECER} días, un email una sola vez (y no a los recientes, reservados ni sin email)`, async () => {
  const filas = [anuncio(), anuncio({ id: 10, creado: new Date().toISOString() }), anuncio({ id: 11, reservado: true }), anuncio({ id: 12, email: '' })];
  const { deps, correos, cambios } = preparar(filas);
  assert.deepEqual(await ofrecerGestion(cfg, deps), { ofrecidos: 1 });
  assert.equal(correos[0].to[0], 'javier@x.es');
  assert.match(correos[0].subject, /¿Quieres que vendamos tu coche por ti\?/);
  assert.match(correos[0].html, /solo cobramos si se vende/);
  assert.match(correos[0].html, /Sí, quiero que lo vendáis/);
  assert.equal(cambios[0][0], 9);
  assert.ok(cambios[0][1].ofrecida_gestion);
  assert.deepEqual(await ofrecerGestion(cfg, deps), { ofrecidos: 0 }, 'la segunda vez, nada');
});

test('gestión: el repaso diario lo lanza el cron', async () => {
  const { deps, correos } = preparar([anuncio()]);
  deps.ajustes = { leer: async () => [] };
  const r2 = await atender({ method: 'GET', ruta: 'api/comunidad/revisar', query: {}, body: {}, directo: true, headers: { authorization: 'Bearer cron' } }, cfg, deps);
  assert.equal(JSON.parse(r2.body).gestion.ofrecidos, 1);
  assert.equal(correos.length, 1);
});

test('gestión: la página del enlace, el «Sí, quiero» y el aviso al equipo', async () => {
  const filas = [anuncio()];
  const { deps, correos } = preparar(filas);
  const url = new URL(enlaceGestion(cfg, 9));
  const q = Object.fromEntries(url.searchParams);
  const mala = await atender({ method: 'GET', ruta: 'gestion', query: { a: '9', f: 'x' }, body: {}, directo: true, headers: {} }, cfg, deps);
  assert.equal(mala.status, 404);
  const ver = await atender({ method: 'GET', ruta: 'gestion', query: q, body: {}, directo: true, headers: {} }, cfg, deps);
  assert.match(ver.body, /¿Vendemos «BMW M3 E30 1988» por ti\?/);
  assert.match(ver.body, /<form method="post">/);
  assert.equal(filas[0].quiere_gestion, undefined, 'solo con mirar la página no cuenta');
  const si = await atender({ method: 'POST', ruta: 'gestion', query: q, body: {}, directo: true, headers: {} }, cfg, deps);
  assert.match(si.body, /Te llamamos/);
  assert.ok(filas[0].quiere_gestion);
  assert.match(correos[0].subject, /^\[Gestión\] Javier quiere que vendáis «BMW M3 E30 1988»/);
  assert.deepEqual(correos[0].to, ['equipo@sidonia.es']);
  const otra = await atender({ method: 'GET', ruta: 'gestion', query: q, body: {}, directo: true, headers: {} }, cfg, deps);
  assert.match(otra.body, /Ya nos lo dijiste/);
});

test('gestión: en el panel sale «Quiere que lo vendamos» y su teléfono', () => {
  const h = paginaPanel(cfg, [anuncio({ quiere_gestion: '2026-10-27T10:00:00Z' })], { estado: 'publicado' });
  assert.match(h, /Quiere que lo vendamos/);
  assert.match(h, /que Sidonia lo venda \(gestión de venta\)/);
});
