// Panel › Gestiones de venta y Alquileres
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atenderPanel } from '../lib/circulo.mjs';
import { config } from '../lib/motor.mjs';

const cfg = config({ ADMIN_CLAVE: 'p', TIENDA_URL: 'https://sidonia.es', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 's', RESEND_API_KEY: 're_x' });
const auth = { authorization: 'Basic ' + Buffer.from('a:p').toString('base64') };
function memo(filas = []) {
  let sig = 50;
  return { filas,
    leer: async (f = '') => {
      let l = [...filas];
      for (const [, k, op, v] of f.matchAll(/(?:^|&)(\w+)=(eq|in)\.([^&]+)/g)) {
        const vv = decodeURIComponent(v);
        l = l.filter((x) => (op === 'eq' ? String(x[k]) === vv : vv.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/"/g, '')).includes(String(x[k]))));
      }
      return l;
    },
    guardar: async (x) => { const n = { id: sig++, creado: new Date().toISOString(), ...x }; filas.push(n); return n; },
    cambiar: async (id, c) => Object.assign(filas.find((x) => Number(x.id) === Number(id)), c),
    borrar: async (f) => { const id = Number(/id=eq\.(\d+)/.exec(f)[1]); filas.splice(filas.findIndex((x) => Number(x.id) === id), 1); } };
}

test('panel › Gestiones de venta: se ven con su WhatsApp, se cambia el estado y se añaden a mano', async () => {
  const gestiones = memo([{ id: 1, estado: 'nueva', creado: '2026-11-12T10:00:00Z', datos: { marca: 'Aston Martin', modelo: 'DB7', anio: '1996', ubicacion: 'Álava', nombre: 'Íñigo López', telefono: '+34600112233', fotos: ['55/abcdefgh1.jpg'], historia: 'Siempre en garaje.' } }]);
  const deps = { db: async () => [], tabla: memo([]), gestiones, garaje: memo([]), perfiles: memo([]), fetch: async () => ({ ok: true, json: async () => ({}) }) };
  const r = await atenderPanel({ method: 'GET', query: { estado: 'gestiones' }, headers: auth }, cfg, deps);
  assert.match(r.body, /Aston Martin DB7 1996/);
  assert.match(r.body, /https:\/\/wa\.me\/34600112233\?text=Hola%20%C3%8D%C3%B1igo/);
  assert.match(r.body, /Gestiones de venta <b class="num">1<\/b>/, 'el número rojo del menú');
  await atenderPanel({ method: 'POST', query: { estado: 'gestiones' }, body: { accion: 'gestion', id: '1', estado: 'contactado', nota: 'Le llamo el lunes' }, headers: auth }, cfg, deps);
  assert.equal(gestiones.filas[0].estado, 'contactado'); assert.equal(gestiones.filas[0].nota, 'Le llamo el lunes');
  await atenderPanel({ method: 'POST', query: { estado: 'gestiones' }, body: { accion: 'gestion-nueva', marca: 'Porsche', modelo: '911', nombre: 'Ana', telefono: '611222333', origen: 'Email' }, headers: auth }, cfg, deps);
  assert.equal(gestiones.filas.at(-1).datos.telefono, '+34611222333'); assert.equal(gestiones.filas.at(-1).estado, 'nueva');
});

test('panel › Alquileres: revisar, ocultar, rechazar con email, editar, fotos y borrar', async () => {
  const garaje = memo([{ id: 7, cliente: '55', marca: 'Mercedes', modelo: '280 SL', anio: 1970, alquiler: true, visible: true, fotos: ['55/aaaaaaaa1.jpg', '55/aaaaaaaa2.jpg', '55/aaaaaaaa3.jpg'], historia: 'De mi abuelo.', alq: { hora: 60, min_horas: 3, ciudad: 'Madrid', declara: true }, creado: '2026-11-12T10:00:00Z' }]);
  const perfiles = memo([{ cliente: '55', nombre: 'Marta', alq_legal: { nombre: 'Marta Ruiz', dni: '12345678Z', domicilio: 'Calle 1', telefono: '600000000', email: 'marta@x.es', acepto: 'x', version: 'v' } }]);
  const correos = [];
  const deps = { db: async () => [], tabla: memo([]), gestiones: memo([]), garaje, perfiles, fetch: async (u, o) => { correos.push(JSON.parse(o.body)); return { ok: true, json: async () => ({}) }; } };
  const ir = (body) => atenderPanel({ method: body ? 'POST' : 'GET', query: { estado: 'alquileres' }, body, headers: auth }, cfg, deps);
  const r = await ir();
  assert.match(r.body, /Mercedes 280 SL 1970/); assert.match(r.body, /Publicado · sin revisar/); assert.match(r.body, /Alquileres <b class="num">1<\/b>/);
  await ir({ accion: 'alq-revisado', id: '7' }); assert.ok(garaje.filas[0].alq.revisado);
  await ir({ accion: 'alq-fotos', id: '7', quitar: ['0', '2'] }); assert.deepEqual(garaje.filas[0].fotos, ['55/aaaaaaaa2.jpg']);
  await ir({ accion: 'alq-editar', id: '7', marca: 'Mercedes-Benz', modelo: '280 SL', anio: '1970', hora: '75', min_horas: '2', ciudad: 'Toledo', plazas: '2', historia: 'Nueva', normas: 'Sin fumar' });
  assert.equal(garaje.filas[0].marca, 'Mercedes-Benz'); assert.equal(garaje.filas[0].alq.hora, 75); assert.equal(garaje.filas[0].alq.ciudad, 'Toledo');
  await ir({ accion: 'alq-rechazar', id: '7', motivo: 'Las fotos están borrosas' });
  assert.equal(garaje.filas[0].visible, false);
  assert.ok(correos.some((c) => [].concat(c.to).includes('marta@x.es') && /borrosas/.test(c.html)));
  await ir({ accion: 'alq-mostrar', id: '7' }); assert.equal(garaje.filas[0].visible, true);
  await ir({ accion: 'alq-borrar', id: '7' }); assert.equal(garaje.filas.length, 0);
});
