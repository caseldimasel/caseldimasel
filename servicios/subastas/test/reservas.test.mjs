import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { atender, config } from '../lib/motor.mjs';
import { estadoActual, precio, libre } from '../lib/reservas.mjs';

const cfg = config({ SUBASTAS_CLAVE: 'k', ADMIN_CLAVE: 'panel', RESEND_API_KEY: 're_x', AVISOS_EQUIPO: 'equipo@sidonia.es', TIENDA_URL: 'https://sidonia.es', SERVIDOR_URL: 'https://motor.test', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 's' });
const quien = (c) => { const t = String(Math.floor(Date.now() / 1000)); return { c, ct: t, cf: createHmac('sha256', 'k').update(`${c}.${t}`).digest('hex') }; };
function memo(filas = [], clave = 'id') {
  let sig = 100;
  const ok = (f, x) => f.split('&').every((p) => {
    const m = /^(\w+)=(eq|neq|in)\.(.*)$/.exec(p); if (!m) return true;
    const v = decodeURIComponent(m[3]), a = String(x[m[1]] ?? '');
    if (m[2] === 'eq') return a === v; if (m[2] === 'neq') return a !== v;
    return v.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/"/g, '')).includes(a);
  });
  return { filas,
    leer: async (f) => { let l = filas.filter((x) => ok(f, x)); if (/order=creado\.desc/.test(f)) l = [...l].reverse(); const lim = /limit=(\d+)/.exec(f); return lim ? l.slice(0, +lim[1]) : l; },
    cambiar: async (id, c) => Object.assign(filas.find((x) => Number(x.id) === Number(id)), c),
    guardar: async (x, k = clave) => { const ks = k.split(','); const ya = filas.find((y) => ks.every((kk) => kk in x && String(y[kk]) === String(x[kk]))); if (ya) return Object.assign(ya, x); const n = { id: sig++, creado: new Date().toISOString(), ...x }; filas.push(n); return n; } };
}
const dia = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
function preparar(alq = {}) {
  const correos = [];
  const deps = { db: async () => null, fetch: async (u, o) => { correos.push(JSON.parse(o.body)); return { ok: true, json: async () => ({}) }; },
    garaje: memo([{ id: 7, cliente: '55', marca: 'Alfa Romeo', modelo: 'Spider', anio: 1975, fotos: ['55/aaaaaaaa.jpg'], alquiler: true, visible: true, likes: 0, bloqueos: [[dia(40), dia(42)]],
      alq: { precio: 150, fianza: 500, minimo: 1, conductor: 'con', ciudad: 'Madrid', entrega: 'Calle Secreta 1', inmediata: false, ...alq } }]),
    alquiler: memo([{ id: 1, rol: 'poner', cliente: '55', nombre: 'Marta', email: 'marta@x.es', telefono: '600000000' }]),
    perfiles: memo([{ cliente: '55', nombre: 'Marta Ruiz', ciudad: 'Madrid', slug: 'marta' }], 'cliente'),
    reservas: memo(), reservas_mensajes: memo(), reservas_resenas: memo([], 'reserva_id,rol') };
  const api = (ruta, body = {}, q = {}, method = 'POST') => atender({ method, ruta, query: { ...q, ...(method === 'GET' ? body : {}) }, body, directo: true, headers: {} }, cfg, deps).then((r) => JSON.parse(r.body));
  return { deps, api, correos };
}
const pedir = { coche_id: 7, desde: dia(10), hasta: dia(12), nombre: 'Lucía Gómez', email: 'lucia@x.es', telefono: '611111111', mensaje: 'Hola, es para mi boda, ¿puede ser?', para: 'boda' };

test('reservas: precio, disponibilidad y estados que se calculan solos', () => {
  assert.deepEqual(precio({ precio: 150, fianza: 500 }, '2027-06-10', '2027-06-12', 0), { dias: 3, precio_dia: 150, subtotal: 450, tarifa: 0, total: 450, fianza: 500 });
  assert.deepEqual(precio({ precio: 150 }, '2027-06-10', '2027-06-12', 15), { dias: 3, precio_dia: 150, subtotal: 450, tarifa: 68, total: 518, fianza: 0 });
  assert.equal(estadoActual({ estado: 'aceptada', pago: 'pendiente', hasta: '2099-01-01', respondida: new Date(Date.now() - 25 * 3600e3).toISOString() }), 'caducada', 'sin pagar en 24 h');
  assert.equal(libre({ bloqueos: [['2027-06-11', '2027-06-11']] }, [], '2027-06-10', '2027-06-12'), false);
  assert.equal(libre({ bloqueos: [] }, [{ desde: '2027-06-12', hasta: '2027-06-14', estado: 'aceptada', creado: new Date().toISOString() }], '2027-06-10', '2027-06-11'), true);
  assert.equal(estadoActual({ estado: 'pendiente', creado: new Date(Date.now() - 25 * 3600e3).toISOString() }), 'caducada');
  assert.equal(estadoActual({ estado: 'aceptada', hasta: '2020-01-01' }), 'completada');
});

test('reservas: buscar y ver la ficha sin la dirección de entrega; solicitud, el dueño acepta y se ven los contactos', async () => {
  const { api, correos, deps } = preparar();
  const b = await api('api/alquiler/coches', { ciudad: 'madrid', desde: dia(10), hasta: dia(12) }, {}, 'GET');
  assert.equal(b.coches.length, 1);
  assert.equal(b.coches[0].alq.entrega, undefined, 'la dirección no se enseña');
  assert.equal(b.coches[0].anfitrion.nombre, 'Marta Ruiz');
  assert.equal((await api('api/alquiler/coches', { desde: dia(41), hasta: dia(41) }, {}, 'GET')).coches.length, 0, 'bloqueado por el dueño');
  const f = await api('api/alquiler/coche', { id: 7 }, {}, 'GET');
  assert.equal(f.coche.titulo, 'Alfa Romeo Spider 1975');
  assert.equal(JSON.stringify(f).includes('Calle Secreta'), false);
  // Sin sesión no se reserva; el dueño no se reserva a sí mismo
  assert.equal((await api('api/alquiler/reservar', pedir)).error, 'login');
  assert.equal((await api('api/alquiler/reservar', pedir, quien('55'))).error, 'suyo');
  const r = await api('api/alquiler/reservar', pedir, quien('77'));
  assert.equal(r.ok, true); assert.equal(r.reserva.estado, 'pendiente'); assert.equal(r.reserva.total, 450);
  assert.ok(correos.some((c) => c.to.includes('marta@x.es') && /Solicitud de reserva/.test(c.subject)));
  assert.ok(correos.some((c) => c.to.includes('lucia@x.es') && /Solicitud enviada/.test(c.subject)));
  // Antes de confirmar: ni teléfono ni dirección
  let v = await api('api/alquiler/reservas', {}, quien('77'), 'GET');
  assert.equal(v.viajes[0].estado, 'pendiente'); assert.equal(v.viajes[0].otro.telefono, undefined); assert.equal(v.viajes[0].coche.entrega, undefined);
  // Mensajes dentro de Sidonia
  await api('api/alquiler/mensajes', { id: r.reserva.id, texto: '¡Claro! ¿A qué hora?' }, quien('55'));
  const m = await api('api/alquiler/mensajes', { id: r.reserva.id }, quien('77'), 'GET');
  assert.equal(m.mensajes.length, 2); assert.equal(m.mensajes[1].mio, false);
  assert.equal((await api('api/alquiler/mensajes', { id: r.reserva.id }, quien('99'), 'GET')).error, 'no-existe', 'otros no la ven');
  // Quien alquila no puede aceptarla; el dueño sí
  assert.equal((await api('api/alquiler/reserva', { id: r.reserva.id, accion: 'aceptar' }, quien('77'))).error, 'estado');
  assert.equal((await api('api/alquiler/reserva', { id: r.reserva.id, accion: 'aceptar' }, quien('55'))).estado, 'aceptada');
  v = await api('api/alquiler/reservas', {}, quien('77'), 'GET');
  assert.equal(v.viajes[0].otro.telefono, '600000000'); assert.equal(v.viajes[0].coche.entrega, 'Calle Secreta 1');
  const d = await api('api/alquiler/reservas', {}, quien('55'), 'GET');
  assert.equal(d.solicitudes[0].otro.email, 'lucia@x.es');
  // Ya ocupado para otro
  assert.equal((await api('api/alquiler/reservar', { ...pedir, desde: dia(11), hasta: dia(11) }, quien('88'))).error, 'ocupado');
  // Reseña solo al acabar
  assert.equal((await api('api/alquiler/resena', { id: r.reserva.id, nota: 5, texto: 'Un coche precioso y Marta encantadora' }, quien('77'))).error, 'estado');
  deps.reservas.filas[0].hasta = dia(-1); deps.reservas.filas[0].desde = dia(-3);
  assert.equal((await api('api/alquiler/resena', { id: r.reserva.id, nota: 5, texto: 'Un coche precioso y Marta encantadora' }, quien('77'))).ok, true);
  const f2 = await api('api/alquiler/coche', { id: 7 }, {}, 'GET');
  assert.equal(f2.coche.nota, 5); assert.equal(f2.resenas[0].nombre, 'Lucía G.');
});

test('reservas: con reserva inmediata queda confirmada al momento; mínimo de días y cancelar', async () => {
  const { api } = preparar({ inmediata: true, minimo: 2 });
  assert.equal((await api('api/alquiler/reservar', { ...pedir, hasta: pedir.desde }, quien('77'))).error, 'minimo');
  const r = await api('api/alquiler/reservar', pedir, quien('77'));
  assert.equal(r.reserva.estado, 'aceptada');
  assert.equal((await api('api/alquiler/reserva', { id: r.reserva.id, accion: 'cancelar' }, quien('77'))).estado, 'cancelada');
  assert.equal((await api('api/alquiler/reservar', pedir, quien('88'))).reserva.estado, 'aceptada', 'vuelve a estar libre');
});

test('reservas: si algún día se cobra (ALQUILER_COBRAR=1): precio + 15 % de servicio y hasta pagar no se ve el contacto', async () => {
  const cfgP = config({ SUBASTAS_CLAVE: 'k', ADMIN_CLAVE: 'panel', RESEND_API_KEY: 're_x', AVISOS_EQUIPO: 'equipo@sidonia.es', TIENDA_URL: 'https://sidonia.es', SERVIDOR_URL: 'https://motor.test', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 's', STRIPE_SECRET_KEY: 'sk_test', ALQUILER_COBRAR: '1', ALQUILER_COMISION: '15' });
  const { deps } = preparar({ inmediata: true });
  const llamadas = [];
  deps.stripe = async (m, path, b) => { llamadas.push([m, path, b]); return m === 'POST' ? { url: 'https://checkout.stripe.test/x' } : { metadata: { reserva: String(deps.reservas.filas[0].id) }, payment_status: 'paid' }; };
  const api = (ruta, body = {}, q = {}, method = 'POST') => atender({ method, ruta, query: { ...q, ...(method === 'GET' ? body : {}) }, body, directo: true, headers: {} }, cfgP, deps);
  const r = JSON.parse((await api('api/alquiler/reservar', pedir, quien('77'))).body);
  assert.equal(r.reserva.tarifa, 68); assert.equal(r.reserva.total, 518);
  assert.match(r.reserva.pagar, /\/tienda\/alquiler\/pagar\?r=\d+&f=/);
  let v = JSON.parse((await api('api/alquiler/reservas', {}, quien('77'), 'GET')).body);
  assert.equal(v.viajes[0].otro.telefono, undefined, 'aceptada pero sin pagar: sin contacto');
  // A Stripe y vuelta
  const u = new URL(r.reserva.pagar);
  const ir = await atender({ method: 'GET', ruta: 'alquiler/pagar', query: Object.fromEntries(u.searchParams), body: {}, directo: true, headers: {} }, cfgP, deps);
  assert.equal(ir.status, 303); assert.equal(ir.headers.Location, 'https://checkout.stripe.test/x');
  assert.equal(llamadas[0][2].line_items[0].price_data.unit_amount, 51800);
  const vuelta = await atender({ method: 'GET', ruta: 'alquiler/pagado', query: { ...Object.fromEntries(u.searchParams), session_id: 'cs_test_1' }, body: {}, directo: true, headers: {} }, cfgP, deps);
  assert.equal(vuelta.status, 303);
  assert.equal(deps.reservas.filas[0].pago, 'pagado');
  v = JSON.parse((await api('api/alquiler/reservas', {}, quien('77'), 'GET')).body);
  assert.equal(v.viajes[0].otro.telefono, '600000000');
  // Firma mala
  const mal = await atender({ method: 'GET', ruta: 'alquiler/pagar', query: { r: u.searchParams.get('r'), f: 'x' }, body: {}, directo: true, headers: {} }, cfgP, deps);
  assert.match(mal.body, /Enlace no válido/);
});
