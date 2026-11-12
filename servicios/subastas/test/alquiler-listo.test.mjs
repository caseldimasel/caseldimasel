import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../lib/motor.mjs';
import { avisarCochesListos, rutasCobros } from '../lib/cobros.mjs';
import { VERSION_CONDICIONES } from '../lib/contratos.mjs';

const memoria = (filas) => ({
  filas,
  async leer() { return this.filas; },
  async cambiar(id, cambios) { const f = this.filas.find((x) => x.id === id); Object.assign(f, cambios); },
  async guardar(fila) { const f = this.filas.find((x) => x.cliente === fila.cliente); if (f) Object.assign(f, fila); else this.filas.push(fila); return fila; }
});

function montar() {
  const cfg = config({ ALQUILER_COBRAR: '1', STRIPE_SECRET_KEY: 'sk_test_x', RESEND_API_KEY: 're_x', AVISOS_EQUIPO: 'equipo@sidonia.es', TIENDA_URL: 'https://sidonia.es' });
  const emails = [];
  const fetch = async (u, o) => { emails.push(JSON.parse(o.body)); return { ok: true, json: async () => ({}), text: async () => '' }; };
  const perfiles = memoria([{ cliente: '7', nombre: 'Álvaro', stripe_cuenta: 'acct_1', cobros_ok: true }]);
  const garaje = memoria([{ id: 1, cliente: '7', marca: 'Volkswagen', modelo: 'T1', anio: 1965, alquiler: true, visible: true, alq: { hora: 80, min_horas: 3, declara: true, ciudad: 'Madrid' } }]);
  return { cfg, emails, deps: { fetch, perfiles, garaje }, perfiles, garaje };
}

test('alquiler: al guardar sus datos con todo listo, avisa al dueño y al equipo una sola vez', async () => {
  const { cfg, emails, deps, garaje } = montar();
  const body = { accion: 'datos', nombre: 'Álvaro Pérez', dni: '12345678Z', domicilio: 'Calle Mayor 1, 28001 Madrid', telefono: '600000000', email: 'alvaro@example.com', acepto: '1' };
  const r = await rutasCobros({ ruta: 'api/alquiler/cobros', method: 'POST', body, ip: '1.1.1.1' }, '7', cfg, deps);
  assert.equal(JSON.parse(r.body).ok, true);
  const para = emails.map((e) => [].concat(e.to).join(','));
  assert.ok(para.includes('alvaro@example.com'), 'email al dueño');
  assert.ok(para.includes('equipo@sidonia.es'), 'email al equipo');
  assert.match(emails.find((e) => [].concat(e.to).includes('alvaro@example.com')).subject, /ya se puede alquilar/);
  assert.ok(garaje.filas[0].alq.aviso_listo);
  emails.length = 0;
  assert.equal(await avisarCochesListos(cfg, deps, '7'), 0);
  assert.equal(emails.length, 0);
});

test('alquiler: sin la declaración del coche no se avisa', async () => {
  const { cfg, emails, deps, garaje, perfiles } = montar();
  garaje.filas[0].alq.declara = false;
  perfiles.filas[0].alq_legal = { nombre: 'Álvaro Pérez', dni: '12345678Z', domicilio: 'Calle Mayor 1', acepto: 'x', version: VERSION_CONDICIONES, email: 'a@b.es' };
  assert.equal(await avisarCochesListos(cfg, deps, '7'), 0);
  assert.equal(emails.length, 0);
});

test('alquiler: si la base de datos falla al guardar los datos, avisa al equipo y responde «sin-tabla»', async () => {
  const { cfg, emails, deps } = montar();
  deps.perfiles.guardar = async () => { throw new Error('Falta actualizar la base de datos del alquiler: ejecuta sql/reservas.sql'); };
  const body = { accion: 'datos', nombre: 'Álvaro Pérez', dni: '12345678Z', domicilio: 'Calle Mayor 1, 28001 Madrid', telefono: '600000000', acepto: '1' };
  const r = await rutasCobros({ ruta: 'api/alquiler/cobros', method: 'POST', body }, '7', cfg, deps);
  assert.equal(JSON.parse(r.body).error, 'sin-tabla');
  assert.match(emails[0].subject, /no ha podido guardar/);
});

test('alquiler: dueño nuevo SIN alta de cobros: al firmar sus datos su coche queda publicado, con perfil público y email', async () => {
  const { cfg, emails, deps, garaje, perfiles } = montar();
  perfiles.filas.length = 0; // aún no tiene perfil
  const body = { accion: 'datos', nombre: 'Álvaro Pérez', dni: 'pab123456', domicilio: 'Calle Mayor 1, 28001 Madrid', telefono: '+34 600 00 00 00', email: 'alvaro@example.com', acepto: '1' };
  const r = JSON.parse((await rutasCobros({ ruta: 'api/alquiler/cobros', method: 'POST', body }, '7', cfg, deps)).body);
  assert.equal(r.ok, true, 'pasaporte y teléfono con espacios valen');
  assert.ok(perfiles.filas[0].slug, 'tiene dirección pública'); assert.equal(perfiles.filas[0].nombre, 'Álvaro');
  assert.ok(garaje.filas[0].alq.aviso_listo, 'publicado sin esperar a Stripe');
  const al = emails.find((e) => [].concat(e.to).includes('alvaro@example.com'));
  assert.match(al.subject, /ya se puede alquilar/); assert.match(al.html, /date de alta para cobrar/i);
  for (const t of ['600-000-000', '(+34) 600 000 000', '600000000']) assert.equal(JSON.parse((await rutasCobros({ ruta: 'api/alquiler/cobros', method: 'POST', body: { ...body, telefono: t } }, '7', cfg, deps)).body).ok, true, t);
  assert.equal(JSON.parse((await rutasCobros({ ruta: 'api/alquiler/cobros', method: 'POST', body: { ...body, telefono: '123' } }, '7', cfg, deps)).body).error, 'telefono');
});
