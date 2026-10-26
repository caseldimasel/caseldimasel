import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../lib/motor.mjs';
import { atenderPanel } from '../lib/circulo.mjs';
import { createHmac } from 'node:crypto';
import { atender } from '../lib/motor.mjs';
import { altaComunidad, anunciantes, cancelarRenovacion, enlacePago, estadoCobro, leerFormTarifa, limpiarTarifa, metricas, precioMes, procesarStripe, revisarComunidad, sumarMeses, TARIFA_BASE, verificarStripe } from '../lib/comunidad.mjs';

const DIA = 864e5;
const AHORA = Date.parse('2026-10-26T10:00:00Z');

function tablaFalsa(filas = []) {
  let sig = 100;
  const filtra = (q) => {
    let l = [...filas];
    for (const [, k, v] of q.matchAll(/(?:^|&)(\w+)=eq\.([^&]+)/g)) l = l.filter((o) => String(o[k]) === decodeURIComponent(v));
    const est = q.match(/estado=in\.\(([^)]+)\)/);
    if (est) l = l.filter((o) => est[1].split(',').includes(o.estado));
    return l;
  };
  return {
    filas,
    async leer(q) { return filtra(q); },
    async cambiar(id, c) { Object.assign(filas.find((o) => o.id === id), c); },
    async guardar(x, clave) { const ya = clave !== 'id' && filas.find((o) => o[clave] === x[clave]); if (ya) Object.assign(ya, x); else filas.push({ id: sig++, ...x }); return x; },
    async borrar(q) { for (const o of filtra(q)) filas.splice(filas.indexOf(o), 1); }
  };
}

test('tarifa: tramos, precio por anuncio según cuántos tiene, meses', () => {
  assert.deepEqual([1, 2, 3, 4, 9, 10, 30].map((k) => precioMes(TARIFA_BASE, k)), [14.9, 12.9, 12.9, 9.9, 9.9, 7.9, 7.9]);
  const t = limpiarTarifa({ tramos: [{ desde: 3, precio: '5,5' }, { desde: 0, precio: 10 }], meses_gratis: 2, aviso: 99 });
  assert.deepEqual(t, { tramos: [{ desde: 1, precio: 10 }, { desde: 3, precio: 5.5 }], meses_gratis: 2, aviso: 30, retirar: 0 });
  assert.deepEqual(leerFormTarifa({ desde_0: '1', precio_0: '20', desde_1: '5', precio_1: '15', desde_2: '', precio_2: '', meses_gratis: '0', aviso: '5', retirar: '3' }), { tramos: [{ desde: 1, precio: 20 }, { desde: 5, precio: 15 }], meses_gratis: 0, aviso: 5, retirar: 3 });
  assert.equal(sumarMeses('2026-01-31T10:00:00Z', 1).toISOString().slice(0, 10), '2026-02-28');
});

test('cómo va cada anuncio y cada anunciante, y lo que entra', () => {
  const a = (id, cliente, caduca, extra = {}) => ({ id, cliente, estado: 'publicado', titulo: `A${id}`, vendedor_nombre: cliente, email: `${cliente}@x.es`, creado: '2026-09-01T00:00:00Z', caduca, gratis: false, ...extra });
  const ancho = (d) => new Date(AHORA + d * DIA).toISOString();
  assert.equal(estadoCobro(a(1, 'x', null), AHORA), 'por_cobrar');
  assert.equal(estadoCobro(a(1, 'x', ancho(-1)), AHORA), 'caducado');
  assert.equal(estadoCobro(a(1, 'x', ancho(3)), AHORA), 'pronto');
  assert.equal(estadoCobro(a(1, 'x', ancho(20), { gratis: true }), AHORA), 'gratis');
  assert.equal(estadoCobro(a(1, 'x', ancho(20)), AHORA), 'al_dia');
  assert.equal(estadoCobro(a(1, 'x', null, { estado: 'vendido' }), AHORA), 'inactivo');
  const anuncios = [a(1, 'ana', ancho(20), { gratis: true }), a(2, 'beto', ancho(20)), a(3, 'beto', null), a(4, 'carla', ancho(-2)), a(5, 'carla', null, { estado: 'vendido' })];
  const pagos = [{ id: 1, cliente: 'ana', anuncio: 1, concepto: 'gratis', importe: 0, fecha: '2026-10-01' }, { id: 2, cliente: 'beto', anuncio: 2, concepto: 'alta', importe: 12.9, fecha: '2026-10-10' },
    { id: 3, cliente: 'carla', anuncio: 4, concepto: 'alta', importe: 14.9, fecha: '2026-09-05' }, { id: 4, cliente: 'beto', anuncio: 2, concepto: 'renovacion', importe: 12.9, fecha: '2026-09-10' }];
  const l = anunciantes(anuncios, pagos, TARIFA_BASE, AHORA);
  assert.deepEqual(l.map((x) => [x.cliente, x.estado, x.activos, x.precio_mes, x.gastado]), [['beto', 'por_cobrar', 2, 12.9, 25.8], ['carla', 'caducado', 1, 14.9, 14.9], ['ana', 'gratis', 1, 14.9, 0]]);
  const m = metricas(l, pagos, AHORA);
  assert.equal(m.este_mes, 12.9);
  assert.equal(Math.round(m.mes_anterior * 100) / 100, 27.8);
  assert.equal(m.por_cobrar.length, 2, 'el de beto sin pagar y el caducado de carla');
  assert.equal(Math.round(m.mensual * 100) / 100, 40.7, 'los de pago (sin el mes gratis de ana)');
  assert.deepEqual([m.anunciantes, m.pagadores, m.gratis], [3, 2, 1]);
});

test('al publicar: el primero gratis un mes, el segundo por cobrar', async () => {
  const cfg = config({ ADMIN_CLAVE: 'p' });
  const tabla = tablaFalsa([{ id: 1, cliente: 'ana', estado: 'publicado', titulo: 'Porsche', vendedor_nombre: 'Ana' }, { id: 2, cliente: 'ana', estado: 'publicado', titulo: 'Vespa', vendedor_nombre: 'Ana' }]);
  const pagos = tablaFalsa([]);
  const deps = { tabla, pagos, ajustes: tablaFalsa([]) };
  assert.match(await altaComunidad(cfg, deps, tabla.filas[0], AHORA), /primer anuncio: gratis hasta el 26\/11\/26/);
  assert.equal(tabla.filas[0].gratis, true);
  assert.equal(pagos.filas[0].concepto, 'gratis');
  assert.match(await altaComunidad(cfg, deps, tabla.filas[1], AHORA), /por cobrar \(12,90 € al mes\)/);
  assert.equal(tabla.filas[1].caduca, undefined);
});

test('panel › Cobros, cobrar, tarifa y Clientes › Anunciantes', async () => {
  const cfg = config({ ADMIN_CLAVE: 'p', TIENDA_URL: 'https://sidonia.es' });
  const auth = { authorization: 'Basic ' + Buffer.from('a:p').toString('base64') };
  const tabla = tablaFalsa([{ id: 7, cliente: '55', estado: 'publicado', titulo: 'SEAT 600', vendedor_nombre: 'Luis', vendedor_tipo: 'particular', email: 'luis@x.es', telefono: '+34600111222', fotos: [], producto: 'seat-600', creado: '2026-09-01T00:00:00Z', caduca: null, gratis: false }]);
  const pagos = tablaFalsa([]);
  const ajustes = tablaFalsa([]);
  const deps = { db: async () => [], tabla, pagos, ajustes };
  const c = await atenderPanel({ method: 'GET', query: { estado: 'cobros' }, headers: auth }, cfg, deps);
  assert.match(c.body, /<title>Cobros de la comunidad/);
  assert.match(c.body, /class="on">Cobros comunidad/);
  assert.match(c.body, /Por cobrar<\/span>/);
  const ok = await atenderPanel({ method: 'POST', query: { estado: 'cobrar', id: '7' }, body: { accion: 'cobrar', meses: '3', importe: '44,7', metodo: 'bizum', fecha: '2026-10-26' }, headers: auth }, cfg, deps);
  assert.match(ok.body, /Apuntado: 44,70 € · 3 meses/);
  assert.equal(pagos.filas.length, 1);
  assert.equal(pagos.filas[0].metodo, 'bizum');
  assert.ok(Date.parse(tabla.filas[0].caduca) > Date.now() + 80 * DIA);
  const an = await atenderPanel({ method: 'GET', query: { estado: 'anunciantes' }, headers: auth }, cfg, deps);
  assert.match(an.body, /class="on">Anunciantes · comunidad/);
  assert.match(an.body, /Luis/);
  const uno = await atenderPanel({ method: 'GET', query: { estado: 'anunciante', id: '55' }, headers: auth }, cfg, deps);
  assert.match(uno.body, /Lleva gastado<\/span><b>44,70 €/);
  assert.match(uno.body, /Bizum/);
  // Borrar el pago: vuelve a estar por cobrar
  await atenderPanel({ method: 'POST', query: { estado: 'cobrar', id: '7' }, body: { accion: 'borrar_pago', pago: String(pagos.filas[0].id) }, headers: auth }, cfg, deps);
  assert.equal(pagos.filas.length, 0);
  assert.equal(tabla.filas[0].caduca, null);
  // La tarifa
  const t = await atenderPanel({ method: 'POST', query: { estado: 'tarifa' }, body: { accion: 'guardar', desde_0: '1', precio_0: '19,9', desde_1: '3', precio_1: '9', meses_gratis: '1', aviso: '7' }, headers: auth }, cfg, deps);
  assert.match(t.body, /Tarifa guardada/);
  assert.deepEqual(ajustes.filas[0].valor.tramos, [{ desde: 1, precio: 19.9 }, { desde: 3, precio: 9 }]);
  assert.match((await atenderPanel({ method: 'GET', query: { estado: 'cobros' }, headers: auth }, cfg, deps)).body, /1–2 anuncios: <b>19,90 €/);
});

test('Stripe: enlace firmado, página de pago y Checkout con el mes gratis sin cobrar', async () => {
  const cfg = config({ ADMIN_CLAVE: 'p', SUBASTAS_CLAVE: 'k', STRIPE_SECRET_KEY: 'sk_test', SERVIDOR_URL: 'https://motor.test', TIENDA_URL: 'https://sidonia.es' });
  const caduca = new Date(Date.now() + 20 * DIA).toISOString();
  const tabla = tablaFalsa([{ id: 9, cliente: '77', estado: 'publicado', titulo: 'SEAT 600', vendedor_nombre: 'Luis', email: 'luis@x.es', fotos: [], producto: 'seat-600', caduca, gratis: true, stripe_estado: '' }]);
  const llamadas = [];
  const stripeFalso = async (m, path, body) => {
    llamadas.push([m, path, body]);
    if (path === 'checkout/sessions') return { url: 'https://checkout.stripe.com/c/x' };
    if (path.startsWith('checkout/sessions/')) return { metadata: { anuncio: '9' }, status: 'complete', subscription: 'sub_1', customer: 'cus_1' };
    return {};
  };
  const deps = { db: async () => null, tabla, ajustes: tablaFalsa([]), stripe: stripeFalso };
  const url = enlacePago(cfg, 9);
  assert.match(url, /^https:\/\/motor\.test\/tienda\/pagar\?a=9&f=[0-9a-f]{32}$/);
  const f = new URL(url).searchParams.get('f');
  const ir = (ruta, query, method = 'GET', body = {}) => atender({ method, ruta, query, body, directo: true, headers: {} }, cfg, deps);
  assert.equal((await ir('pagar', { a: '9', f: 'x'.repeat(32) })).status, 404, 'firma mala');
  assert.equal((await ir('pagar', { a: '8', f })).status, 404, 'la firma es de otro anuncio');
  const p = await ir('pagar', { a: '9', f });
  assert.match(p.body, /14,90 €/);
  assert.match(p.body, /Hoy no se cobra nada/);
  const c = await ir('pagar', { a: '9', f, ir: '1' });
  assert.equal(c.status, 303);
  assert.equal(c.headers.Location, 'https://checkout.stripe.com/c/x');
  const [, , s] = llamadas[0];
  assert.equal(s.mode, 'subscription');
  assert.equal(s.line_items[0].price_data.unit_amount, 1490);
  assert.equal(s.line_items[0].price_data.recurring.interval, 'month');
  assert.equal(s.subscription_data.trial_end, Math.floor(Date.parse(caduca) / 1000), 'no se cobra hasta que acaba el mes gratis');
  assert.equal(s.subscription_data.metadata.anuncio, '9');
  assert.equal(s.customer_email, 'luis@x.es');
  // Vuelta: queda apuntada la suscripción
  const ok = await ir('pagar/ok', { a: '9', f, session_id: 'cs_test_1' });
  assert.match(ok.body, /se renueva solo/);
  assert.deepEqual([tabla.filas[0].stripe_suscripcion, tabla.filas[0].stripe_estado], ['sub_1', 'activa']);
  // Ya activa: cambiar tarjeta o cancelar (portal de Stripe)
  assert.match((await ir('pagar', { a: '9', f })).body, /Cambiar tarjeta o cancelar/);
  tabla.filas[0].stripe_cliente = 'cus_1';
  llamadas.length = 0;
  await ir('pagar', { a: '9', f }, 'POST', { accion: 'portal' });
  assert.equal(llamadas[0][1], 'billing_portal/sessions');
  // Al venderse: no se le vuelve a cobrar
  assert.equal(await cancelarRenovacion(cfg, deps, 9), true);
  assert.deepEqual(llamadas.at(-1), ['POST', 'subscriptions/sub_1', { cancel_at_period_end: 'true' }]);
  assert.equal(tabla.filas[0].stripe_estado, 'cancela');
});

test('Stripe: firma del aviso, factura pagada (una vez), impago y cancelación', async () => {
  const cuerpo = JSON.stringify({ type: 'invoice.paid' });
  const t = Math.floor(Date.now() / 1000);
  const firma = createHmac('sha256', 'whsec_x').update(`${t}.${cuerpo}`).digest('hex');
  assert.deepEqual(verificarStripe(cuerpo, `t=${t},v1=${firma}`, 'whsec_x'), { type: 'invoice.paid' });
  assert.equal(verificarStripe(cuerpo, `t=${t},v1=${'0'.repeat(64)}`, 'whsec_x'), null);
  assert.equal(verificarStripe(cuerpo, `t=${t - 1000},v1=${firma}`, 'whsec_x'), null, 'demasiado viejo');

  const cfg = config({ ADMIN_CLAVE: 'p' });
  const tabla = tablaFalsa([{ id: 9, cliente: '77', estado: 'publicado', titulo: 'SEAT 600', vendedor_nombre: 'Luis', email: 'luis@x.es', caduca: new Date(Date.now() - DIA).toISOString(), gratis: true, stripe_suscripcion: 'sub_1', stripe_estado: 'activa' }]);
  const pagos = tablaFalsa([]);
  const deps = { tabla, pagos, stripe: async () => ({}) };
  const fin = Math.floor(Date.now() / 1000) + 30 * 86400;
  const factura = { type: 'invoice.paid', data: { object: { id: 'in_1', number: 'A-1', customer: 'cus_1', amount_paid: 1490, billing_reason: 'subscription_cycle', created: t,
    parent: { subscription_details: { subscription: 'sub_1', metadata: { anuncio: '9' } } }, lines: { data: [{ period: { start: t, end: fin } }] } } } };
  assert.equal(await procesarStripe(factura, cfg, deps), 'pago');
  assert.equal(await procesarStripe(factura, cfg, deps), 'repetido', 'Stripe repite avisos: no se apunta dos veces');
  assert.equal(pagos.filas.length, 1);
  assert.deepEqual([pagos.filas[0].importe, pagos.filas[0].metodo, pagos.filas[0].concepto, pagos.filas[0].ref], [14.9, 'stripe', 'renovacion', 'in_1']);
  assert.equal(Date.parse(tabla.filas[0].caduca), fin * 1000, 'el anuncio se alarga hasta el fin del periodo');
  assert.equal(tabla.filas[0].gratis, false);
  // Por la suscripción guardada, aunque la factura no traiga los datos (API antigua)
  assert.equal(await procesarStripe({ type: 'invoice.payment_failed', data: { object: { subscription: 'sub_1' } } }, cfg, deps), 'impago');
  assert.equal(tabla.filas[0].stripe_estado, 'impago');
  assert.equal(await procesarStripe({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', status: 'canceled', metadata: { anuncio: '9' } } } }, cfg, deps), 'cancelada');
  assert.equal(await procesarStripe({ type: 'otro.evento', data: { object: {} } }, cfg, deps), 'ignorado');
});

test('repaso diario: recuerda el pago una vez por semana y retira los caducados si se pide', async () => {
  const cfg = config({ ADMIN_CLAVE: 'p', SUBASTAS_CLAVE: 'k', SERVIDOR_URL: 'https://motor.test', RESEND_API_KEY: 're_x' });
  const enviados = [];
  const fetch = async (url, o) => { enviados.push(JSON.parse(o.body)); return { ok: true, json: async () => ({}) }; };
  const tabla = tablaFalsa([
    { id: 1, cliente: 'a', estado: 'publicado', titulo: 'Caduca pronto', email: 'a@x.es', caduca: new Date(AHORA + 3 * DIA).toISOString(), stripe_estado: '' },
    { id: 2, cliente: 'b', estado: 'publicado', titulo: 'Auto', email: 'b@x.es', caduca: new Date(AHORA + 3 * DIA).toISOString(), stripe_estado: 'activa' },
    { id: 3, cliente: 'c', estado: 'publicado', titulo: 'Caducado hace mucho', email: 'c@x.es', caduca: new Date(AHORA - 20 * DIA).toISOString(), stripe_estado: '' },
    { id: 4, cliente: 'd', estado: 'publicado', titulo: 'Ya avisado', email: 'd@x.es', caduca: null, avisado: new Date(AHORA - 2 * DIA).toISOString(), stripe_estado: '' }]);
  const estados = [];
  const deps = { fetch, tabla, pagos: tablaFalsa([]), ajustes: tablaFalsa([{ clave: 'tarifa', valor: { ...TARIFA_BASE, retirar: 14 } }]), db: async (fn, a) => { estados.push([fn, a.p_id, a.p_estado]); } };
  const r = await revisarComunidad(cfg, deps, AHORA);
  assert.deepEqual(r, { recordados: 1, retirados: 1 });
  assert.deepEqual(enviados.map((e) => e.to[0]), ['a@x.es']);
  assert.match(enviados[0].html, /motor\.test\/tienda\/pagar\?a=1&amp;f=/);
  assert.deepEqual(estados, [['sidonia_anuncio_estado', 3, 'retirado']]);
  assert.ok(tabla.filas[0].avisado);
  // Al día siguiente no se le vuelve a mandar
  assert.deepEqual(await revisarComunidad(cfg, { ...deps, db: async () => {} }, AHORA + DIA), { recordados: 0, retirados: 1 });
});
