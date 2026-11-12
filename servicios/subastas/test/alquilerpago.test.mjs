// Alquiler con pago en la web: contrato firmado por los dos, pago retenido hasta que acepta el dueño, devoluciones según
// la política de cancelación y transferencia al dueño el día que empieza (Stripe Connect). Sin servicios reales.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { atender, config } from '../lib/motor.mjs';
import { estadoActual, paraDueno, ponerAlDia, revisarReservas } from '../lib/reservas.mjs';
import { reembolso, condicionesAlquiler, VERSION_CONDICIONES } from '../lib/contratos.mjs';
import { dniValido, documentoValido, faltaParaAlquilar } from '../lib/cobros.mjs';

const cfg = config({ SUBASTAS_CLAVE: 'k', RESEND_API_KEY: 're_x', AVISOS_EQUIPO: 'equipo@sidonia.es', TIENDA_URL: 'https://sidonia.es', SERVIDOR_URL: 'https://motor.test',
  SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 's', STRIPE_SECRET_KEY: 'sk_test', ALQUILER_COBRAR: '1', ALQUILER_COMISION: '10', ALQUILER_IVA: '0',
  SIDONIA_RAZON_SOCIAL: 'Sidonia Garage S.L.', SIDONIA_NIF: 'B00000000', CRON_SECRET: 'cron' });
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
const LEGAL = { nombre: 'Marta Ruiz Pérez', dni: '12345678Z', domicilio: 'Calle Mayor 1, 28013 Madrid', telefono: '600000000', acepto: '2026-11-01T10:00:00Z', version: VERSION_CONDICIONES };
const ALQ = { precio: 150, fianza: 500, km: 200, minimo: 1, conductor: 'con', plazas: 4, ciudad: 'Madrid', entrega: 'Calle Secreta 1', matricula: '1234ABC', seguro_compania: 'Mutua', seguro_poliza: 'POL-999',
  seguro_tipo: 'todo-riesgo', seguro_cubre: true, itv_hasta: dia(300), edad_min: 25, carne_min: 3, declara: true };
function preparar({ alq = {}, perfil = {} } = {}) {
  const correos = [], stripe = [];
  let piEstado = 'requires_capture';
  const deps = { db: async () => null, fetch: async (u, o) => { correos.push(JSON.parse(o.body)); return { ok: true, json: async () => ({}) }; },
    garaje: memo([{ id: 7, cliente: '55', marca: 'Alfa Romeo', modelo: 'Spider', anio: 1975, fotos: ['55/aaaaaaaa.jpg'], alquiler: true, visible: true, likes: 0, bloqueos: [], alq: { ...ALQ, ...alq } }]),
    alquiler: memo([{ id: 1, rol: 'poner', cliente: '55', nombre: 'Marta', email: 'marta@x.es', telefono: '600000000' }]),
    perfiles: memo([{ cliente: '55', nombre: 'Marta', slug: 'marta', alq_legal: LEGAL, stripe_cuenta: 'acct_1', cobros_ok: true, ...perfil }], 'cliente'),
    reservas: memo(), reservas_mensajes: memo(), reservas_resenas: memo([], 'reserva_id,rol'),
    stripe: async (m, path, b) => {
      stripe.push([m, path, b]);
      if (path === 'checkout/sessions') return { id: 'cs_test_1', url: 'https://checkout.stripe.test/x' };
      if (path.startsWith('checkout/sessions/')) return { metadata: { reserva: String(deps.reservas.filas.at(-1).id) }, status: 'complete', payment_intent: { id: 'pi_1', status: piEstado } };
      if (path === 'payment_intents/pi_1') return { id: 'pi_1', latest_charge: 'ch_1' };
      if (path === 'transfers') return { id: 'tr_1' };
      if (path === 'accounts') return { id: 'acct_nuevo' };
      if (path === 'account_links') return { url: 'https://connect.stripe.test/alta' };
      return {};
    } };
  const api = (ruta, body = {}, q = {}, method = 'POST', headers = {}) => atender({ method, ruta, query: { ...q, ...(method === 'GET' ? body : {}) }, body, directo: true, headers }, cfg, deps).then((r) => (/json/.test(r.headers?.['Content-Type'] || '') ? JSON.parse(r.body) : r));
  return { deps, api, correos, stripe, setPi: (e) => { piEstado = e; } };
}
const pedir = { coche_id: 7, desde: dia(10), hasta: dia(12), nombre: 'Lucía Gómez Sanz', email: 'lucia@x.es', telefono: '611111111', mensaje: 'Hola, es para mi boda, ¿puede ser?', para: 'boda',
  dni: '87654321X', nacimiento: '1990-05-01', domicilio: 'Calle Luna 3, Sevilla', carne_num: '87654321X', carne_fecha: '2010-01-01', acepto: '1', firma: 'lucía gómez sanz', recogida: 'Iglesia de San Jerónimo, Madrid', pasajeros: 2 };

test('alquiler con pago: DNI, documento y lo que falta para poder alquilar', () => {
  assert.equal(dniValido('12345678Z'), true); assert.equal(dniValido('12345678A'), false); assert.equal(dniValido('X1234567L'), true);
  assert.equal(documentoValido('PAB123456'), true); assert.equal(documentoValido('87654321Y'), false);
  assert.deepEqual(faltaParaAlquilar({ alq: ALQ }, { alq_legal: LEGAL, stripe_cuenta: 'a', cobros_ok: true }, true), []);
  // Sidonia solo intermedia: no pide póliza ni VTC, solo la declaración responsable del dueño y sus datos. El alta de
  // cobros en Stripe no hace falta para publicar (se le guarda su parte hasta que la termine)
  assert.deepEqual(faltaParaAlquilar({ alq: { ...ALQ, conductor: 'con', seguro_cubre: false } }, { alq_legal: LEGAL }, true), []);
  assert.deepEqual(faltaParaAlquilar({ alq: { ...ALQ, declara: false } }, { alq_legal: LEGAL, stripe_cuenta: 'a', cobros_ok: true }, true), ['declara']);
  // Si cambian las condiciones, se le pide aceptar las nuevas, pero su coche sigue publicado
  assert.deepEqual(faltaParaAlquilar({ alq: ALQ }, { alq_legal: { ...LEGAL, version: '2020-01-01' }, stripe_cuenta: 'a', cobros_ok: true }, true), []);
  assert.deepEqual(faltaParaAlquilar({ alq: ALQ }, { alq_legal: { ...LEGAL, acepto: '' } }, true), ['datos']);
});

test('alquiler con pago: política de cancelación', () => {
  const r = { total: 495, tarifa: 45, desde: dia(30) };
  assert.deepEqual(reembolso(r, 'cliente'), { importe: 495, tarifa: true, motivo: reembolso(r, 'cliente').motivo }, '14 días o más: todo');
  assert.equal(reembolso({ ...r, desde: dia(10) }, 'cliente').importe, 225, 'entre 14 y 7 días: la mitad del alquiler');
  assert.equal(reembolso({ ...r, desde: dia(4) }, 'cliente').importe, 0, 'menos de 7 días: nada');
  // Con la señal pagada y el resto sin cobrar: a más de 14 días se devuelve la señal y la tarifa; entre 14 y 7, nada (la señal es menos de la mitad)
  const sen = { ...r, resto: 315 };
  assert.equal(reembolso({ ...sen, desde: dia(30) }, 'cliente').importe, 180);
  assert.equal(reembolso({ ...sen, desde: dia(10) }, 'cliente').importe, 0);
  assert.equal(paraDueno({ ...sen, reembolso: 0 }), 135, 'el dueño se queda la señal');
  assert.equal(reembolso({ ...r, desde: dia(1) }, 'dueno').importe, 495);
  assert.equal(paraDueno({ total: 495, tarifa: 45, reembolso: 225, reembolso_tarifa: false }), 225);
  assert.equal(paraDueno({ total: 495, tarifa: 45, reembolso: 495, reembolso_tarifa: true }), 0);
  assert.match(condicionesAlquiler(cfg), /no es parte/); assert.match(condicionesAlquiler(cfg), /Sidonia Garage S\.L\./);
});

test('alquiler con pago: sin el alta de cobros el coche SÍ se ve; sin la declaración del dueño, no', async () => {
  let { api } = preparar({ perfil: { cobros_ok: false } });
  assert.equal((await api('api/alquiler/coches', {}, {}, 'GET')).coches.length, 1);
  assert.equal((await api('api/alquiler/coche', { id: 7 }, {}, 'GET')).ok, true);
  ({ api } = preparar({ alq: { declara: false } }));
  assert.equal((await api('api/alquiler/coches', {}, {}, 'GET')).coches.length, 0);
  ({ api } = preparar());
  const l = await api('api/alquiler/coches', {}, {}, 'GET');
  assert.equal(l.coches.length, 1);
  assert.equal(l.coches[0].alq.matricula, undefined, 'la matrícula no es pública'); assert.equal(l.coches[0].alq.seguro_poliza, undefined);
  // Siempre con su dueño al volante, aunque el anuncio dijera otra cosa
  ({ api } = preparar({ alq: { conductor: 'ambos' } }));
  assert.equal((await api('api/alquiler/coche', { id: 7 }, {}, 'GET')).coche.alq.conductor, 'con');
});

test('alquiler con pago: solicitud con contrato firmado, retención, el dueño firma y se cobra; cancelar con 7 días devuelve todo', async () => {
  const { api, deps, stripe, correos } = preparar();
  // Datos que faltan o no cuadran
  assert.equal((await api('api/alquiler/reservar', { ...pedir, dni: '87654321Y' }, quien('77'))).error, 'dni');
  assert.equal((await api('api/alquiler/reservar', { ...pedir, firma: 'Otra Persona' }, quien('77'))).error, 'firma');
  assert.equal((await api('api/alquiler/reservar', { ...pedir, acepto: '' }, quien('77'))).error, 'acepto');
  assert.equal((await api('api/alquiler/reservar', { ...pedir, nacimiento: dia(-365 * 10) }, quien('77'))).error, 'nacimiento', 'mayor de edad');
  assert.equal((await api('api/alquiler/reservar', { ...pedir, nacimiento: '2003-01-01', carne_fecha: '' }, quien('77'))).ok, true, 'no conduce: ni edad para conducir ni carné');
  // Bien: se guarda el contrato firmado por quien alquila y se va a Stripe a retener
  const r = await api('api/alquiler/reservar', pedir, quien('77'), 'POST', { 'x-forwarded-for': '81.2.3.4, 10.0.0.1', 'user-agent': 'Prueba' });
  assert.equal(r.ok, true); assert.equal(r.pagar, 'https://checkout.stripe.test/x');
  assert.equal(r.reserva.total, 495); assert.equal(r.reserva.tarifa, 45);
  const fila = deps.reservas.filas.at(-1);
  assert.equal(fila.pago, 'sin-pagar'); assert.equal(fila.firma_cliente.ip, '81.2.3.4'); assert.equal(fila.firma_cliente.hash, fila.contrato.hash);
  assert.match(fila.contrato.html, /1234ABC/); assert.match(fila.contrato.html, /87654321X/); assert.match(fila.contrato.html, /12345678Z/);
  const ses = stripe.find((x) => x[1] === 'checkout/sessions')[2];
  assert.equal(ses.payment_intent_data.capture_method, 'manual'); assert.equal(ses.payment_intent_data.on_behalf_of, 'acct_1');
  assert.equal(ses.line_items[0].price_data.unit_amount, 45000); assert.equal(ses.line_items[1].price_data.unit_amount, 4500);
  // El dueño aún no la ve (no se ha pagado)
  assert.equal((await api('api/alquiler/reservas', {}, quien('55'), 'GET')).solicitudes.length, 0);
  // Vuelta de Stripe: retenido; ahora sí le llega
  const vuelta = await api('alquiler/pagado', {}, { r: String(fila.id), f: new URL((await api('api/alquiler/reservas', {}, quien('77'), 'GET')).viajes[0].pagar).searchParams.get('f'), session_id: 'cs_test_1' }, 'GET');
  assert.equal(vuelta.status, 303); assert.match(vuelta.headers.Location, /reserva=ok/);
  assert.equal(fila.pago, 'autorizado'); assert.equal(fila.estado, 'pendiente');
  assert.ok(correos.some((c) => /Te han pedido tu coche/.test(c.html || '') && c.to?.includes?.('marta@x.es') || (c.to === 'marta@x.es')));
  let v = await api('api/alquiler/reservas', {}, quien('55'), 'GET');
  assert.equal(v.solicitudes.length, 1); assert.equal(v.solicitudes[0].gana, 450); assert.equal(v.solicitudes[0].otro.telefono, undefined);
  // El dueño acepta: tiene que firmar con su nombre
  assert.equal((await api('api/alquiler/reserva', { id: fila.id, accion: 'aceptar', acepto: '1', firma: 'Marta' }, quien('55'))).error, 'firma');
  const ac = await api('api/alquiler/reserva', { id: fila.id, accion: 'aceptar', acepto: '1', firma: 'Marta Ruiz Pérez' }, quien('55'));
  assert.equal(ac.ok, true);
  assert.ok(stripe.some((x) => x[1] === 'payment_intents/pi_1/capture'));
  assert.equal(fila.pago, 'pagado'); assert.equal(fila.estado, 'aceptada'); assert.equal(fila.firma_dueno.nombre, 'Marta Ruiz Pérez');
  v = await api('api/alquiler/reservas', {}, quien('77'), 'GET');
  assert.equal(v.viajes[0].otro.telefono, '600000000'); assert.equal(v.viajes[0].coche.entrega, 'Calle Secreta 1');
  assert.equal(v.viajes[0].si_cancelo.importe, 225, 'a 10 días: la mitad del alquiler');
  // El contrato firmado por los dos
  const con = await api('alquiler/contrato', {}, Object.fromEntries(new URL(v.viajes[0].contrato).searchParams), 'GET');
  assert.match(con.body, /Lucía Gómez Sanz/); assert.match(con.body, /Marta Ruiz Pérez · 12345678Z/); assert.match(con.body, /Firmado por las dos partes/);
  assert.doesNotMatch(con.body, /Pendiente de firma/);
  // Cancela quien alquila con 10 días: se devuelve la mitad del alquiler (la tarifa no)
  const ca = await api('api/alquiler/reserva', { id: fila.id, accion: 'cancelar' }, quien('77'));
  assert.equal(ca.reembolso, 225);
  const ref = stripe.find((x) => x[1] === 'refunds')[2];
  assert.equal(ref.amount, 22500); assert.equal(ref.payment_intent, 'pi_1');
  assert.equal(fila.pago, 'devuelto-parcial'); assert.equal(fila.cancelada_por, 'cliente');
});

test('alquiler con pago: rechazar libera la retención; caducar también; cancelar tarde paga la mitad al dueño el día que empieza', async () => {
  const { api, deps, stripe } = preparar();
  await api('api/alquiler/reservar', pedir, quien('77'));
  const fila = deps.reservas.filas.at(-1);
  const f = new URL((await api('api/alquiler/reservas', {}, quien('77'), 'GET')).viajes[0].pagar).searchParams.get('f');
  await api('alquiler/pagado', {}, { r: String(fila.id), f, session_id: 'cs_test_1' }, 'GET');
  await api('api/alquiler/reserva', { id: fila.id, accion: 'rechazar' }, quien('55'));
  assert.ok(stripe.some((x) => x[1] === 'payment_intents/pi_1/cancel')); assert.equal(fila.pago, 'liberado');
  // Caduca sin respuesta: el repaso libera
  const r2 = { ...fila, id: 900, estado: 'pendiente', pago: 'autorizado', creado: new Date(Date.now() - 30 * 3600e3).toISOString() };
  deps.reservas.filas.push(r2);
  assert.equal(estadoActual(r2), 'caducada');
  await ponerAlDia(cfg, deps, r2);
  assert.equal(deps.reservas.filas.at(-1).pago, 'liberado');
  // Pagada y cancelada por quien alquila a 10 días: se devuelve la mitad del alquiler; el día que empezaba, la otra mitad al dueño
  const r3 = { ...fila, id: 901, estado: 'aceptada', pago: 'pagado', stripe_pi: 'pi_1', stripe_transfer: '', desde: dia(10), hasta: dia(11), total: 330, tarifa: 30, resto: 0 };
  deps.reservas.filas.push(r3);
  const ca = await api('api/alquiler/reserva', { id: 901, accion: 'cancelar' }, quien('77'));
  assert.equal(ca.reembolso, 150); assert.equal(r3.pago, 'devuelto-parcial');
  assert.equal(paraDueno(r3), 150);
  // Aún no ha empezado: no se transfiere
  await revisarReservas(cfg, deps); assert.equal(r3.stripe_transfer, '');
  // Llega el día (cron con su clave)
  r3.desde = dia(0);
  assert.equal((await api('api/alquiler/revisar', {}, {}, 'GET')).ok, false, 'sin la clave del cron no');
  const rv = await api('api/alquiler/revisar', {}, {}, 'GET', { authorization: 'Bearer cron' });
  assert.equal(rv.ok, true);
  const tr = stripe.find((x) => x[1] === 'transfers')[2];
  assert.equal(tr.amount, 15000); assert.equal(tr.destination, 'acct_1'); assert.equal(tr.source_transaction, 'ch_1');
  assert.equal(r3.stripe_transfer, 'tr_1');
});

test('alquiler con pago: reserva inmediata se cobra al momento y queda firmada por el dueño de antemano', async () => {
  const { api, deps, stripe, setPi } = preparar({ alq: { inmediata: true } });
  setPi('succeeded');
  await api('api/alquiler/reservar', pedir, quien('77'));
  assert.equal(stripe.find((x) => x[1] === 'checkout/sessions')[2].payment_intent_data.capture_method, 'automatic');
  const fila = deps.reservas.filas.at(-1);
  const f = new URL((await api('api/alquiler/reservas', {}, quien('77'), 'GET')).viajes[0].pagar).searchParams.get('f');
  await api('alquiler/pagado', {}, { r: String(fila.id), f, session_id: 'cs_test_1' }, 'GET');
  assert.equal(fila.pago, 'pagado'); assert.equal(fila.estado, 'aceptada'); assert.equal(fila.firma_dueno.inmediata, true);
});

test('alquiler con pago: el modelo de contrato y las condiciones se leen sin datos privados', async () => {
  const { api } = preparar();
  const m = await api('alquiler/contrato-modelo', {}, { coche: '7', desde: dia(10), hasta: dia(12) }, 'GET');
  assert.equal(m.status, 200);
  assert.match(m.body, /Contrato de arrendamiento de vehículo con conductor/); assert.match(m.body, /Marta Ruiz Pérez/);
  assert.doesNotMatch(m.body, /1234ABC|POL-999|12345678Z|Calle Secreta|Calle Mayor/);
  const c = await api('alquiler/condiciones', {}, {}, 'GET');
  assert.match(c.body, /Condiciones del servicio de alquiler/);
});

test('alquiler con pago: el dueño pone sus datos y se da de alta en Stripe', async () => {
  const { api, deps, stripe } = preparar({ perfil: { alq_legal: {}, stripe_cuenta: '', cobros_ok: false } });
  let g = await api('api/alquiler/cobros', {}, quien('55'), 'GET');
  assert.equal(g.datos_ok, false); assert.equal(g.listo, false);
  assert.equal((await api('api/alquiler/cobros', { accion: 'alta' }, quien('55'))).error, 'datos');
  assert.equal((await api('api/alquiler/cobros', { accion: 'datos', nombre: 'Marta Ruiz', dni: '12345678A', domicilio: 'Calle Mayor 1, Madrid', telefono: '600000000', acepto: '1' }, quien('55'))).error, 'dni');
  assert.equal((await api('api/alquiler/cobros', { accion: 'datos', nombre: 'Marta Ruiz', dni: '12345678Z', domicilio: 'Calle Mayor 1, Madrid', telefono: '600000000' }, quien('55'))).error, 'acepto');
  assert.equal((await api('api/alquiler/cobros', { accion: 'datos', nombre: 'Marta Ruiz', dni: '12345678z', domicilio: 'Calle Mayor 1, Madrid', telefono: '600000000', acepto: '1' }, quien('55'))).ok, true);
  assert.equal(deps.perfiles.filas[0].alq_legal.dni, '12345678Z');
  const a = await api('api/alquiler/cobros', { accion: 'alta' }, quien('55'));
  assert.equal(a.url, 'https://connect.stripe.test/alta');
  const cuenta = stripe.find((x) => x[1] === 'accounts')[2];
  assert.equal(cuenta.type, 'express'); assert.equal(cuenta.country, 'ES'); assert.equal(cuenta.business_profile.mcc, '7512');
  assert.equal(deps.perfiles.filas[0].stripe_cuenta, 'acct_nuevo');
});

test('siempre con su dueño al volante: no hay alquiler sin conductor', async () => {
  const { precioDe, conductorEfectivo } = await import('../lib/cobros.mjs');
  const { leerAlq } = await import('../lib/garaje.mjs');
  assert.equal(leerAlq({ conductor: 'sin' }).conductor, 'con', 'aunque lo pida, se guarda con conductor');
  assert.equal(conductorEfectivo({ conductor: 'ambos' }), 'con');
  assert.equal(precioDe({ conductor: 'sin', precio: 150 }, 'sin'), 0); assert.equal(precioDe({ precio: 300 }, 'con'), 300);
  const { api, deps } = preparar({ alq: { ...ALQ, conductor: 'ambos', precio_con: 400 } });
  const l = await api('api/alquiler/coche', { id: 7 }, {}, 'GET');
  assert.equal(l.coche.alq.conductor, 'con');
  // Aunque se pida «sin conductor», la reserva es con su dueño al volante: recogida y pasajeros, sin carné
  assert.equal((await api('api/alquiler/reservar', { ...pedir, conductor: 'sin', recogida: '' }, quien('77'))).error, 'recogida');
  const r = await api('api/alquiler/reservar', { ...pedir, conductor: 'sin', desde: dia(10), hasta: dia(10), pasajeros: 9 }, quien('77'));
  assert.equal(r.ok, true); assert.equal(r.reserva.fianza, 0);
  const fila = deps.reservas.filas.at(-1);
  assert.equal(fila.conductor, 'con'); assert.equal(fila.datos.pasajeros, 3, 'como mucho las plazas menos el conductor'); assert.equal(fila.datos.carne_num, '');
  assert.match(fila.contrato.html, /con conductor/); assert.doesNotMatch(fila.contrato.html, /Fianza\.<\/b> El Arrendatario entregará/);
});

test('por horas: un precio por hora para todo, mínimo de horas y varios días con sus horas', async () => {
  const { precioHoras, leerTramos, libreHoras, cuandoTxt } = await import('../lib/reservas.mjs');
  const { leerAlq } = await import('../lib/garaje.mjs');
  const { desdeHora } = await import('../lib/cobros.mjs');
  const A = { ...ALQ, ...leerAlq({ ...ALQ, hora: 120, min_horas: 3 }) };
  assert.deepEqual([A.hora, A.min_horas, desdeHora(A)], [120, 3, 120]);
  // Tramos: uno por día, de media en media hora
  assert.equal(leerTramos([{ dia: dia(10), de: '10:00', a: '09:00' }]), null);
  assert.equal(leerTramos([{ dia: dia(10), de: '10:15', a: '12:00' }]), null);
  const t = leerTramos([{ dia: dia(11), de: '17:00', a: '19:00' }, { dia: dia(10), de: '10:00', a: '14:30' }]);
  assert.equal(t[0].dia, dia(10), 'ordenados');
  // 4,5 h + 2 h (que se cobran como el mínimo: 3 h) = 7,5 h × 120 € = 900 €, sea boda, rodaje o lo que sea
  const p = precioHoras(A, t, '', 15);
  assert.deepEqual([p.horas, p.precio_hora, p.subtotal, p.tarifa, p.total, p.fianza], [7.5, 120, 900, 135, 1035, 0]);
  // Los anuncios de antes, con un precio por plan, siguen funcionando
  assert.equal(precioHoras({ planes: { boda: { hora: 100, min: 2 } } }, [{ dia: dia(10), de: '10:00', a: '11:00' }], 'boda', 0).total, 200);
  // Libre: se puede reservar la tarde de un día que tiene la mañana reservada, pero no a la vez
  const rs = [{ desde: dia(10), hasta: dia(10), estado: 'aceptada', creado: new Date().toISOString(), tramos: [{ dia: dia(10), de: '10:00', a: '13:00' }] }];
  assert.equal(libreHoras({ bloqueos: [] }, rs, [{ dia: dia(10), de: '13:00', a: '16:00' }]), true);
  assert.equal(libreHoras({ bloqueos: [] }, rs, [{ dia: dia(10), de: '12:00', a: '14:00' }]), false);
  assert.equal(libreHoras({ bloqueos: [[dia(12), dia(12)]] }, [], [{ dia: dia(12), de: '10:00', a: '11:00' }]), false, 'día bloqueado');
  assert.match(cuandoTxt({ tramos: t, horas: 7.5 }), /10:00–14:30 · .*17:00–19:00 \(7,5 h\)/);
  // Reservar por horas: se guarda con sus tramos y el contrato por horas
  const { api, deps, stripe } = preparar({ alq: A });
  assert.equal((await api('api/alquiler/coche', { id: 7 }, {}, 'GET')).coche.alq.hora, 120);
  const r = await api('api/alquiler/reservar', { ...pedir, tramos: t, para: 'rodaje' }, quien('77'));
  assert.equal(r.ok, true);
  const fila = deps.reservas.filas.at(-1);
  assert.deepEqual([fila.horas, fila.desde, fila.hasta, fila.dias, fila.para], [7.5, dia(10), dia(11), 2, 'rodaje']);
  assert.match(fila.contrato.html, /de 10:00 a 14:30 h/); assert.match(fila.contrato.html, /120 € por hora/);
  assert.equal(stripe.find((x) => x[1] === 'checkout/sessions')[2].line_items[0].price_data.unit_amount, 90000);
});

test('la comisión de Sidonia va más IVA: 15 % + 21 % = 18,15 % del alquiler', async () => {
  const { tarifaPct, precioHoras } = await import('../lib/reservas.mjs');
  const c = config({ ALQUILER_COBRAR: '1', STRIPE_SECRET_KEY: 'sk', ALQUILER_COMISION: '15' });
  assert.equal(tarifaPct(c), 18.15);
  const p = precioHoras({ hora: 100, min_horas: 2 }, [{ dia: dia(10), de: '10:00', a: '14:00' }], '', tarifaPct(c));
  assert.deepEqual([p.subtotal, p.tarifa, p.total], [400, 73, 473]);
  const { condicionesAlquiler } = await import('../lib/contratos.mjs');
  assert.match(condicionesAlquiler(c), /15 % del precio del alquiler, más el 21 % de IVA/);
});

test('pago en dos veces: señal al reservar, el resto 14 días antes, impago y al dueño 24 h después del servicio', async () => {
  const { partes } = await import('../lib/reservas.mjs');
  assert.deepEqual(partes(495, 45, dia(10)), { a_cuenta: 495, resto: 0 }, 'a menos de 14 días, todo');
  assert.deepEqual(partes(495, 45, dia(40)), { a_cuenta: 180, resto: 315 }, 'señal: 30 % de 450 + 45');
  const { api, deps, stripe } = preparar();
  const pide = { ...pedir, desde: dia(40), hasta: dia(40) };
  const r = await api('api/alquiler/reservar', pide, quien('77'));
  assert.equal(r.ok, true); assert.deepEqual([r.reserva.a_cuenta, r.reserva.resto], [60, 105], '1 día: 150 de alquiler + 15 de tarifa; señal 45 + 15, resto 105');
  const ses = stripe.find((x) => x[1] === 'checkout/sessions')[2];
  assert.equal(ses.line_items[0].price_data.unit_amount, 4500); assert.match(ses.line_items[0].price_data.product_data.name, /Señal \(30 %\)/);
  assert.equal(ses.payment_intent_data.setup_future_usage, 'off_session'); assert.equal(ses.customer_creation, 'always');
  // Ya aceptada y pagada la señal: hasta 14 días antes, nada; luego se cobra el resto con la tarjeta guardada
  const fila = deps.reservas.filas.at(-1);
  Object.assign(fila, { estado: 'aceptada', pago: 'pagado', stripe_pi: 'pi_1', stripe_transfer: '' });
  const llamadas = [];
  let falla = false;
  deps.stripe = async (m, path, b) => {
    llamadas.push([m, path, b]);
    if (path === 'payment_intents/pi_1') return { id: 'pi_1', latest_charge: 'ch_1', amount_received: 6000, customer: 'cus_1', payment_method: 'pm_1' };
    if (path === 'payment_intents/pi_2') return { id: 'pi_2', latest_charge: 'ch_2', amount_received: 10500 };
    if (path === 'payment_intents' && m === 'POST') { if (falla) throw new Error('Stripe 402: card_declined'); return { id: 'pi_2', status: 'succeeded' }; }
    if (path === 'transfers') return { id: `tr_${llamadas.filter((x) => x[1] === 'transfers').length}` };
    if (path === 'refunds') return { id: 're_1' };
    return {};
  };
  const { ponerAlDia } = await import('../lib/reservas.mjs');
  await ponerAlDia(cfg, deps, fila);
  assert.ok(!llamadas.some((x) => x[1] === 'payment_intents' && x[0] === 'POST'), 'aún faltan más de 14 días');
  fila.desde = fila.hasta = dia(13);
  await ponerAlDia(cfg, deps, fila);
  const p2 = llamadas.find((x) => x[1] === 'payment_intents' && x[0] === 'POST')[2];
  assert.deepEqual([p2.amount, p2.customer, p2.payment_method, p2.off_session, p2.on_behalf_of], [10500, 'cus_1', 'pm_1', 'true', 'acct_1']);
  assert.equal(fila.resto_pi, 'pi_2'); assert.ok(fila.resto_pagado);
  // Tras el servicio (24 h después), al dueño: 45 de la señal (sin la tarifa) y 105 del resto
  fila.desde = fila.hasta = dia(-2);
  await ponerAlDia(cfg, deps, fila);
  const trs = llamadas.filter((x) => x[1] === 'transfers').map((x) => [x[2].amount, x[2].source_transaction]);
  assert.deepEqual(trs, [[4500, 'ch_1'], [10500, 'ch_2']]);
  assert.equal(fila.stripe_transfer, 'tr_1,tr_2');
  // Si el cobro del resto falla: email con el enlace; a las 48 h sin pagar, se cancela
  const otra = { ...fila, id: 950, desde: dia(10), hasta: dia(10), resto_pi: null, resto_pagado: null, resto_aviso: null, stripe_transfer: '', estado: 'aceptada', pago: 'pagado' };
  deps.reservas.filas.push(otra);
  falla = true;
  await ponerAlDia(cfg, deps, otra);
  assert.ok(otra.resto_aviso); assert.match(otra.resto_error, /card_declined/);
  await ponerAlDia(cfg, deps, otra, Date.now() + 49 * 3600e3);
  assert.equal(otra.estado, 'cancelada'); assert.equal(otra.cancelada_por, 'impago');
  assert.equal(paraDueno(otra), 45, 'el dueño se queda la señal');
});

test('alquiler con pago: dueño SIN alta de cobros: su coche se reserva, Sidonia cobra y le guarda su parte hasta que se da de alta', async () => {
  const { api, deps, stripe, correos } = preparar({ perfil: { stripe_cuenta: '', cobros_ok: false } });
  const r = await api('api/alquiler/reservar', pedir, quien('77'));
  assert.equal(r.ok, true); assert.equal(r.pagar, 'https://checkout.stripe.test/x');
  const ses = stripe.find((x) => x[1] === 'checkout/sessions')[2];
  assert.equal(ses.payment_intent_data.on_behalf_of, undefined, 'sin cuenta, el cargo lo hace Sidonia');
  const fila = deps.reservas.filas.at(-1);
  const f = new URL((await api('api/alquiler/reservas', {}, quien('77'), 'GET')).viajes[0].pagar).searchParams.get('f');
  await api('alquiler/pagado', {}, { r: String(fila.id), f, session_id: 'cs_test_1' }, 'GET');
  assert.ok(correos.some((c) => /Te han pedido tu coche/.test(c.html || '') && /date de alta para cobrar/i.test(c.html || '')), 'al dueño se le recuerda darse de alta');
  // Termina el servicio: no hay a quién transferir, se le guarda y se le avisa
  Object.assign(fila, { estado: 'aceptada', pago: 'pagado', stripe_pi: 'pi_1', stripe_transfer: '', desde: dia(-3), hasta: dia(-2) });
  const antes = correos.length;
  await ponerAlDia(cfg, deps, fila, Date.parse(`${dia(-2)}T23:59:00+01:00`) + 24 * 3600e3 + 3600e3);
  assert.equal(stripe.filter((x) => x[1] === 'transfers').length, 0);
  assert.ok(correos.slice(antes).some((c) => /Tienes dinero esperándote/.test(c.subject || '')));
  // Se da de alta: se le transfiere
  Object.assign(deps.perfiles.filas[0], { stripe_cuenta: 'acct_2', cobros_ok: true });
  await ponerAlDia(cfg, deps, fila);
  const tr = stripe.find((x) => x[1] === 'transfers')[2];
  assert.equal(tr.destination, 'acct_2'); assert.equal(fila.stripe_transfer, 'tr_1');
});

test('alquiler: el repaso diario avisa (una vez) al dueño cuyo coche no se publica, con lo que le falta', async () => {
  const { deps, correos } = preparar({ perfil: { alq_legal: {} } });
  await revisarReservas(cfg, deps);
  const m = correos.filter((c) => /Te falta muy poco/.test(c.subject || ''));
  assert.equal(m.length, 1); assert.match(m[0].html, /tus datos para el contrato/);
  assert.ok(correos.some((c) => /atascado/.test(c.subject || '')), 'y al equipo');
  assert.ok(deps.garaje.filas[0].alq.aviso_falta);
  const n = correos.length;
  await revisarReservas(cfg, deps);
  assert.equal(correos.filter((c) => /Te falta muy poco/.test(c.subject || '')).length, 1, 'no se repite');
  assert.ok(correos.length >= n);
});
