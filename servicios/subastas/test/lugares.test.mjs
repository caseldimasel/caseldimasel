// Fotos de Google Maps de talleres y eventos: la primera foto del sitio, con su autor; sin clave, nada
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atender, config } from '../lib/motor.mjs';

test('foto de Google Maps: busca el sitio, pide la foto y devuelve su autor; se guarda unas horas en la caché', async () => {
  const llamadas = [];
  const fetch = async (u, o = {}) => {
    llamadas.push([u, o.headers?.['X-Goog-FieldMask'] || '']);
    if (u.endsWith('places:searchText')) return { ok: true, json: async () => ({ places: [{ id: 'p1', displayName: { text: 'Cochera Clásicos' }, photos: [{ name: 'places/p1/photos/f1', authorAttributions: [{ displayName: 'Ana', uri: 'https://maps.google.com/ana' }] }] }] }) };
    if (u.includes('/places/p1/photos/f1/media')) return { ok: true, json: async () => ({ photoUri: 'https://lh3.googleusercontent.com/foto1' }) };
    return { ok: false, status: 404, text: async () => '' };
  };
  const ir = (cfg, q) => atender({ method: 'GET', ruta: 'foto', query: q, body: {}, directo: true, headers: {} }, cfg, { db: async () => null, fetch });
  const sin = await ir(config({}), { q: 'Cochera Clásicos Cercedilla' });
  assert.equal(JSON.parse(sin.body).error, 'sin-clave', 'sin clave, la web deja su icono');
  const cfg = config({ GOOGLE_MAPS_KEY: 'k1' });
  const r = await ir(cfg, { q: 'Cochera Clásicos Cercedilla', w: '600' });
  const d = JSON.parse(r.body);
  assert.equal(d.ok, true); assert.equal(d.url, 'https://lh3.googleusercontent.com/foto1'); assert.equal(d.autor, 'Ana');
  assert.match(r.headers['Cache-Control'], /s-maxage=21600/);
  assert.match(llamadas[0][1], /places\.photos/);
  assert.match(llamadas[1][0], /maxWidthPx=600&skipHttpRedirect=true/);
  assert.equal(JSON.parse((await ir(cfg, { q: 'x' })).body).error, 'datos');
});
