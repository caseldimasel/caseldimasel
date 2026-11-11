import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atender, config } from '../lib/motor.mjs';

test('subastas: las condiciones que se aceptan al registrarse existen y dicen quién vende y qué pasa si no pagas', async () => {
  const cfg = config({ SIDONIA_RAZON_SOCIAL: 'Pablo Castells Cuadrillero', SIDONIA_NIF: '00000000T' });
  const r = await atender({ ruta: 'subastas/condiciones', directo: true, method: 'GET', query: {} }, cfg, {});
  assert.equal(r.status, 200);
  assert.match(r.body, /Condiciones de las subastas/);
  assert.match(r.body, /Pablo Castells Cuadrillero/);
  assert.match(r.body, /oferta firme e irrevocable/);
  assert.match(r.body, /Si no pagas/);
});
