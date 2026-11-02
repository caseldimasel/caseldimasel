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

/** Tabla en memoria con los filtros que usa el alquiler (eq, neq, gte, order, limit) */
function memo(filas = []) {
  let sig = filas.length + 1;
  const ok = (f, x) => f.split('&').every((p) => {
    const m = /^(\w+)=(eq|neq|gte)\.(.*)$/.exec(p); if (!m) return true;
    const v = decodeURIComponent(m[3]), a = x[m[1]];
    return m[2] === 'eq' ? String(a) === v : m[2] === 'neq' ? String(a ?? '') !== v : String(a) >= v;
  });
  return { filas, leer: async (f) => { let l = filas.filter((x) => ok(f, x)); const lim = /limit=(\d+)/.exec(f); return lim ? l.slice(0, +lim[1]) : l; },
    guardar: async (x) => { const n = { id: sig++, creado: new Date().toISOString(), estado: 'abierta', publico: false, ...x }; filas.push(n); return n; },
    cambiar: async (id, c) => Object.assign(filas.find((x) => x.id === id), c) };
}
const firmado = (c) => { const t = String(Math.floor(Date.now() / 1000)); return { c, ct: t, cf: require_hmac(c, t) }; };
import { createHmac } from 'node:crypto';
function require_hmac(c, t) { return createHmac('sha256', 'k').update(`${c}.${t}`).digest('hex'); }

test('alquiler: la petición pública se ve sin datos personales; un dueño contesta y a quien busca le llega su propuesta', async () => {
  const correos = [];
  const deps = { db: async () => null, fetch: async (u, o) => { correos.push(JSON.parse(o.body)); return { ok: true, json: async () => ({}) }; }, alquiler: memo(), alquiler_contactos: memo(), garaje: memo() };
  const api = (ruta, body, q = {}, method = 'POST') => atender({ method, ruta, query: { ...q, ...(method === 'GET' ? body : {}) }, body, directo: true, headers: {} }, cfg, deps).then((r) => JSON.parse(r.body));
  await api('api/alquiler', { ...quiere, busca: 'Un clásico rojo descapotable', publico: true });
  await api('api/alquiler', { ...quiere, email: 'otra@x.es', busca: 'Privado', publico: false });
  const pub = await api('api/alquiler/peticiones', {}, {}, 'GET');
  assert.equal(pub.peticiones.length, 1);
  assert.equal(pub.peticiones[0].busca, 'Un clásico rojo descapotable');
  assert.equal(pub.peticiones[0].inicial, 'L');
  assert.equal(JSON.stringify(pub).includes('lucia@x.es'), false, 'sin email');
  assert.equal(JSON.stringify(pub).includes('600111222'), false, 'sin teléfono');
  const id = pub.peticiones[0].id;
  assert.equal((await api('api/alquiler/contactar', { tipo: 'tengo', peticion: id, nombre: 'Pablo', email: 'p@x.es', coche: 'Alfa Spider 1975' })).error, 'login');
  correos.length = 0;
  const r = await api('api/alquiler/contactar', { tipo: 'tengo', peticion: id, nombre: 'Pablo Ruiz', email: 'p@x.es', telefono: '611222333', coche: 'Alfa Romeo Spider 1975 rojo', mensaje: 'Está perfecto' }, firmado('9'));
  assert.equal(r.ok, true); assert.equal(r.enviado, true);
  const a = correos.find((c) => c.to.includes('lucia@x.es'));
  assert.match(a.subject, /Tienen un coche para ti: Alfa Romeo Spider 1975 rojo/);
  assert.match(a.html, /p@x\.es/); assert.equal(a.reply_to, 'p@x.es');
  assert.ok(correos.some((c) => c.to.includes('equipo@sidonia.es')));
  assert.equal(deps.alquiler_contactos.filas.length, 1);
  // Cerrada desde el panel: ya no se ve
  await atenderPanel({ method: 'POST', query: { estado: 'alquiler' }, body: { accion: 'peticion-estado', id: String(id), valor: 'cerrada' }, headers: auth }, cfg, deps);
  assert.equal((await api('api/alquiler/peticiones', {}, {}, 'GET')).peticiones.length, 0);
});

test('alquiler: «Me interesa alquilarlo» llega al dueño del coche; el equipo añade peticiones desde el panel', async () => {
  const correos = [];
  const deps = { db: async () => null, fetch: async (u, o) => { correos.push(JSON.parse(o.body)); return { ok: true, json: async () => ({}) }; }, alquiler: memo([{ id: 1, rol: 'poner', cliente: '55', nombre: 'Marta', email: 'marta@x.es', creado: '2026-10-01' }]), alquiler_contactos: memo(), garaje: memo([{ id: 7, cliente: '55', marca: 'Porsche', modelo: '356', anio: 1960, alquiler: true }]) };
  const api = (ruta, body, q = {}) => atender({ method: 'POST', ruta, query: q, body, directo: true, headers: {} }, cfg, deps).then((r) => JSON.parse(r.body));
  const r = await api('api/alquiler/contactar', { tipo: 'interes', coche_id: 7, nombre: 'Ana', email: 'ana@x.es', fecha: '3 de mayo' }, firmado('77'));
  assert.equal(r.ok, true);
  const m = correos.find((c) => c.to.includes('marta@x.es'));
  assert.match(m.subject, /Quieren alquilar tu Porsche 356 1960/);
  // Panel: la petición de un cliente que escribió por WhatsApp
  const p = await atenderPanel({ method: 'POST', query: { estado: 'alquiler' }, body: { accion: 'peticion-nueva', busca: 'Clásico rojo descapotable', ciudad: 'Madrid', fecha: '12 de junio', email: 'cliente@x.es' }, headers: auth }, cfg, deps);
  assert.match(p.body, /Clásico rojo descapotable/);
  assert.match(p.body, /Quiere alquilarlo/);
  const nueva = deps.alquiler.filas.find((x) => x.busca === 'Clásico rojo descapotable');
  assert.equal(nueva.publico, true);
});
