// «Te ayudamos a venderlo» desde el formulario de una sola pantalla: con su sesión, fotos suyas y lo básico del coche
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { atender, config } from '../lib/motor.mjs';

const cfg = config({ SUBASTAS_CLAVE: 'k', RESEND_API_KEY: 're_x', AVISOS_EQUIPO: 'equipo@sidonia.es', TIENDA_URL: 'https://sidonia.es', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 's' });
const quien = (c) => { const t = String(Math.floor(Date.now() / 1000)); return { c, ct: t, cf: createHmac('sha256', 'k').update(`${c}.${t}`).digest('hex') }; };
const bien = { fotos: ['55/abcdefgh1.jpg', '55/abcdefgh2.jpg'], marca: 'Porsche', modelo: '911 SC', anio: '1982', km: '128.000', precio: '65.000', ubicacion: 'Madrid', historia: 'Lo compró mi padre en 1989.', mecanica: 'Embrague nuevo en 2023.', ficha: [['Potencia', '204 CV'], ['ITV', 'En vigor']], nombre: 'Marta Ruiz', telefono: '600 11 22 33', email: 'marta@x.es' };

test('gestión de venta: llega al equipo con las fotos y al cliente su confirmación', async () => {
  const correos = [];
  const deps = { db: async () => null, fetch: async (u, o) => { correos.push(JSON.parse(o.body)); return { ok: true, json: async () => ({}) }; } };
  const ir = (b, q) => atender({ method: 'POST', ruta: 'api/venta', query: q, body: b, directo: true, headers: {} }, cfg, deps).then((r) => JSON.parse(r.body));
  assert.equal((await ir(bien, {})).error, 'login', 'sin sesión, no');
  assert.equal((await ir({ ...bien, fotos: ['99/abcdefgh1.jpg'] }, quien('55'))).campo, 'fotos', 'solo fotos suyas');
  assert.equal((await ir({ ...bien, marca: '' }, quien('55'))).campo, 'marca');
  assert.equal((await ir({ ...bien, telefono: '12' }, quien('55'))).campo, 'telefono');
  assert.equal((await ir(bien, quien('55'))).ok, true);
  const eq = correos.find((c) => [].concat(c.to).includes('equipo@sidonia.es'));
  assert.match(eq.subject, /Gestión de venta: Porsche 911 SC 1982/);
  assert.match(eq.html, /x\.supabase\.co\/storage\/v1\/object\/public\/anuncios\/55\/abcdefgh1\.jpg/);
  assert.match(eq.html, /\+34600112233/);
  assert.match(eq.html, /Potencia: <b>204 CV<\/b>/); assert.match(eq.html, /Embrague nuevo/);
  const cl = correos.find((c) => [].concat(c.to).includes('marta@x.es'));
  assert.match(cl.subject, /Hemos recibido tu Porsche/);
});
