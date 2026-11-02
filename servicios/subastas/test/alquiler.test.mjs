import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atender, config } from '../lib/motor.mjs';
import { atenderPanel } from '../lib/circulo.mjs';
import { leerAlquiler } from '../lib/alquiler.mjs';

const cfg = config({ SUBASTAS_CLAVE: 'k', ADMIN_CLAVE: 'panel', RESEND_API_KEY: 're_x', AVISOS_EQUIPO: 'equipo@sidonia.es', TIENDA_URL: 'https://sidonia.es', SERVIDOR_URL: 'https://motor.test', SUPABASE_URL: 'https://x.supabase.co' });
const auth = { authorization: 'Basic ' + Buffer.from('equipo:panel').toString('base64') };
const quiere = { rol: 'alquilar', nombre: 'Lucía Gómez', email: 'Lucia@x.es', telefono: '600111222', ciudad: 'Madrid', para: 'boda', fecha: 'Junio 2027', conductor: 'con', mensaje: 'Un descapotable blanco.' };

function preparar() {
  const correos = [], guardadas = [];
  const deps = {
    db: async () => null,
    fetch: async (u, o) => { correos.push(JSON.parse(o.body)); return { ok: true, json: async () => ({}) }; },
    alquiler: { leer: async () => guardadas.map((x, i) => ({ id: i + 1, creado: new Date().toISOString(), ...x })), guardar: async (x) => { guardadas.push(x); return x; } }
  };
  const enviar = (body) => atender({ method: 'POST', ruta: 'api/alquiler', query: {}, body, directo: true, headers: {} }, cfg, deps).then((r) => JSON.parse(r.body));
  return { correos, guardadas, enviar, deps };
}

test('alquiler: comprueba los datos (y quien pone su coche dice cuál)', () => {
  assert.equal(leerAlquiler(quiere).solicitud.email, 'lucia@x.es');
  assert.equal(leerAlquiler({ ...quiere, email: 'no' }).error, 'email');
  assert.equal(leerAlquiler({ ...quiere, nombre: '' }).error, 'nombre');
  assert.equal(leerAlquiler({ ...quiere, rol: 'poner' }).error, 'coche');
  assert.equal(leerAlquiler({ ...quiere, web: 'http://spam' }).error, 'spam');
  assert.equal(leerAlquiler({ ...quiere, para: 'cualquiera' }).solicitud.para, '');
});

test('alquiler: se apunta en la lista, aviso al equipo y «Estás en la lista» a la persona', async () => {
  const { correos, guardadas, enviar } = preparar();
  const r = await enviar(quiere);
  assert.equal(r.ok, true);
  assert.equal(guardadas[0].rol, 'alquilar');
  assert.equal(guardadas[0].para, 'boda');
  const equipo = correos.find((c) => c.to.includes('equipo@sidonia.es'));
  assert.match(equipo.subject, /^\[Alquiler\] Lucía Gómez quiere alquilar un coche/);
  assert.equal(equipo.reply_to, 'lucia@x.es');
  const persona = correos.find((c) => c.to.includes('lucia@x.es'));
  assert.match(persona.subject, /Estás en la lista/);
  const pone = await enviar({ ...quiere, rol: 'poner', coche: 'Mercedes 280 SL 1970', email: 'dueno@x.es' });
  assert.equal(pone.ok, true);
  assert.ok(correos.some((c) => /quiere poner su Mercedes 280 SL 1970/.test(c.subject)));
});

test('panel › Clientes › Alquiler: la lista de espera, con cuántos quieren alquilar y cuántos ponen su coche', async () => {
  const { enviar, deps } = preparar();
  await enviar(quiere);
  await enviar({ ...quiere, rol: 'poner', coche: 'Porsche 356 1959', email: 'p@x.es', para: 'rodaje' });
  const h = (await atenderPanel({ method: 'GET', query: { estado: 'alquiler' }, body: {}, headers: auth }, cfg, deps)).body;
  assert.match(h, /Alquiler · lista de espera/);
  assert.match(h, /Lucía Gómez/);
  assert.match(h, /Porsche 356 1959/);
  assert.match(h, /Quieren alquilar<\/span><b>1<\/b>/);
  assert.match(h, /Ponen su coche<\/span><b>1<\/b>/);
  assert.match(h, /Boda o evento/);
});
