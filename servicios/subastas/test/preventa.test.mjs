import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atender, config } from '../lib/motor.mjs';
import { leerReserva, paginaPreventas } from '../lib/preventa.mjs';

const cfg = config({ SUBASTAS_CLAVE: 'clave', TIENDA_URL: 'https://sidonia.es', STRIPE_SECRET_KEY: 'sk_test_x', SERVIDOR_URL: 'https://motor.test', RESEND_API_KEY: 're_x', AVISOS_REMITENTE: 'Sidonia <hola@sidonia.es>' });
const BUENA = { producto: 'rd10', nombre: 'Lucía Prueba', email: 'lucia@ejemplo.es', telefono: '+34 600 000 000', cantidad: 2, precio: 99, acepto: true, volver: 'https://sidonia.es/pages/sidonia-rd10' };

function fakes() {
  const filas = [];
  const preventas = {
    async leer(f) {
      const id = /id=eq\.(\d+)/.exec(f)?.[1];
      const email = decodeURIComponent(/email=eq\.([^&]+)/.exec(f)?.[1] || '');
      const est = /estado=eq\.(\w+)/.exec(f)?.[1];
      return filas.filter((x) => (!id || String(x.id) === id) && (!email || x.email === email) && (!est || x.estado === est));
    },
    async guardar(fila) { const f = { id: filas.length + 1, ...fila }; filas.push(f); return f; },
    async cambiar(id, c) { Object.assign(filas.find((x) => x.id === Number(id)), c); }
  };
  const stripeCalls = [];
  const stripe = async (m, path, body) => {
    stripeCalls.push([m, path, body]);
    if (path === 'customers') return { id: 'cus_1' };
    if (path === 'checkout/sessions') return { url: 'https://checkout.stripe.com/c/pay/cs_test_1' };
    if (path.startsWith('checkout/sessions/')) return { status: 'complete', metadata: { reserva: '1' }, setup_intent: { payment_method: { id: 'pm_1', card: { brand: 'visa', last4: '4242' } } } };
    throw new Error(path);
  };
  const correos = [];
  const fetch = async (url, init) => { correos.push(JSON.parse(init.body)); return { ok: true, json: async () => ({}), text: async () => '' }; };
  return { filas, stripeCalls, correos, deps: { preventas, stripe, fetch, db: async () => ({}) } };
}
const ir = (deps, ruta, method = 'GET', query = {}, body = {}) => atender({ method, ruta, query, body, directo: true }, cfg, deps);

test('leerReserva valida el formulario', () => {
  assert.equal(leerReserva(BUENA).ok, true);
  assert.equal(leerReserva({ ...BUENA, producto: 'otra' }).error, 'producto');
  assert.equal(leerReserva({ ...BUENA, email: 'no' }).error, 'email');
  assert.equal(leerReserva({ ...BUENA, cantidad: 9 }).error, 'cantidad');
  assert.equal(leerReserva({ ...BUENA, acepto: false }).error, 'acepto');
});

test('reservar: guarda la tarjeta en Stripe sin cobrar, confirma por email y cuenta en el contador', async () => {
  const { filas, stripeCalls, correos, deps } = fakes();
  const r = JSON.parse((await ir(deps, 'api/preventa/reservar', 'POST', {}, BUENA)).body);
  assert.equal(r.ok, true);
  assert.match(r.url, /checkout\.stripe\.com/);
  const ses = stripeCalls.find((c) => c[1] === 'checkout/sessions')[2];
  assert.equal(ses.mode, 'setup', 'sin cobro: solo guardar la tarjeta');
  assert.match(ses['custom_text[submit][message]'], /no se cobra nada ahora/);
  assert.equal(filas[0].estado, 'pendiente');
  // Sin firma no vale
  const mal = await ir(deps, 'preventa/vuelta', 'GET', { r: '1', f: 'x'.repeat(32), session_id: 'cs_test_1' });
  assert.match(mal.body, /Enlace no válido/);
  // La vuelta de Stripe (con la firma que puso el motor en success_url)
  const f = /f=([0-9a-f]{32})/.exec(ses.success_url)[1];
  const v = await ir(deps, 'preventa/vuelta', 'GET', { r: '1', f, session_id: 'cs_test_1' });
  assert.equal(v.status, 303);
  assert.match(v.headers.Location, /reservada=1/);
  assert.equal(filas[0].estado, 'reservada');
  assert.equal(filas[0].tarjeta, 'Visa •••• 4242');
  assert.match(correos[0].subject, /Tienes reservada tu SIDONIA RD10/);
  assert.match(correos[0].html, /No te hemos cobrado nada/);
  const c = JSON.parse((await ir(deps, 'api/preventa/contador', 'GET', { p: 'rd10' })).body);
  assert.deepEqual([c.reservas, c.personas], [2, 1]);
  // La misma persona no reserva dos veces a la vez
  const otra = JSON.parse((await ir(deps, 'api/preventa/reservar', 'POST', {}, BUENA)).body);
  assert.equal(otra.error, 'ya');
  // Cancelar con el enlace del email
  const cx = await ir(deps, 'preventa/cancelar', 'GET', { r: '1', f });
  assert.match(cx.body, /Reserva cancelada/);
  assert.equal(filas[0].estado, 'cancelada');
  const c2 = JSON.parse((await ir(deps, 'api/preventa/contador', 'GET', { p: 'rd10' })).body);
  assert.equal(c2.reservas, 0);
});

test('volver solo a la tienda; panel con el total', async () => {
  const { stripeCalls, deps } = fakes();
  await ir(deps, 'api/preventa/reservar', 'POST', {}, { ...BUENA, volver: 'https://malo.com/x' });
  assert.equal(stripeCalls.find((c) => c[1] === 'checkout/sessions')[2].cancel_url, 'https://sidonia.es');
  const h = paginaPreventas(cfg, [{ creado: '2026-11-09T10:00:00Z', nombre: 'A', email: 'a@b.es', cantidad: 2, precio: 99, estado: 'reservada' }, { creado: '2026-11-09T11:00:00Z', nombre: 'B', email: 'b@b.es', cantidad: 1, precio: 99, estado: 'pendiente' }]);
  assert.match(h, /<b style="font-size:28px">2<\/b> radios reservadas por 1 persona/);
  assert.match(h, /198 €/);
});

test('condiciones, «ya la hemos pedido» y cobrar desde el panel', async () => {
  const { filas, stripeCalls, correos, deps } = fakes();
  const cd = await ir(deps, 'preventa/condiciones');
  assert.equal(cd.status, 200);
  assert.match(cd.body, /Condiciones de la reserva/);
  assert.match(cd.body, /Al reservar no se cobra nada/);
  // Dos reservas con tarjeta guardada
  filas.push({ id: 1, producto: 'rd10', nombre: 'Ana Uno', email: 'a@b.es', cantidad: 1, precio: 99, estado: 'reservada', stripe_cliente: 'cus_1', metodo_pago: 'pm_1', tarjeta: 'Visa •••• 4242' });
  filas.push({ id: 2, producto: 'rd10', nombre: 'Bea Dos', email: 'b@b.es', cantidad: 2, precio: 99, estado: 'reservada', stripe_cliente: 'cus_2', metodo_pago: 'pm_2' });
  const { accionPanelPreventas } = await import('../lib/preventa.mjs');
  assert.match(await accionPanelPreventas({ accion: 'avisar', entrega: 'mediados de enero' }, cfg, deps), /2 emails/);
  assert.match(correos[0].subject, /Ya hemos pedido tu SIDONIA RD10/);
  assert.match(correos[0].html, /mediados de enero/);
  assert.ok(filas.every((f) => f.avisado));
  assert.match(await accionPanelPreventas({ accion: 'avisar', entrega: 'enero' }, cfg, deps), /0 emails/, 'no repite');
  // Sin confirmar el número exacto no cobra
  assert.match(await accionPanelPreventas({ accion: 'cobrar', confirmo: '5' }, cfg, deps), /No se ha cobrado nada/);
  // Stripe: la 1 se cobra, la 2 la rechaza el banco
  deps.stripe = async (m, path, body) => {
    stripeCalls.push([m, path, body]);
    if (path === 'payment_intents') {
      if (body.customer === 'cus_2') throw new Error('Stripe payment_intents 402: authentication_required');
      return { id: 'pi_1', status: 'succeeded' };
    }
    if (path === 'checkout/sessions') return { url: 'https://checkout.stripe.com/c/pay/cs_test_2' };
    if (path.startsWith('checkout/sessions/')) return { payment_status: 'paid', payment_intent: 'pi_2', metadata: { reserva: '2' } };
    throw new Error(path);
  };
  const aviso = await accionPanelPreventas({ accion: 'cobrar', confirmo: '2' }, cfg, deps);
  assert.match(aviso, /Cobradas 1\. 1 no se han podido cobrar/);
  const pi = stripeCalls.find((c) => c[1] === 'payment_intents' && c[2].customer === 'cus_1')[2];
  assert.deepEqual([pi.amount, pi.off_session, pi.confirm], ['9900', 'true', 'true']);
  assert.equal(filas[0].estado, 'cobrada');
  assert.equal(filas[1].estado, 'fallida');
  assert.match(filas[1].error, /authentication_required/);
  const pend = correos.find((c) => /Falta el pago/.test(c.subject));
  const enlace = /href="([^"]*preventa\/pagar[^"]*)"/.exec(pend.html)[1].replace(/&amp;/g, '&');
  const u = new URL(enlace);
  // El enlace del email lleva a pagar con Stripe y la vuelta la marca como cobrada
  const pg = await ir(deps, 'preventa/pagar', 'GET', Object.fromEntries(u.searchParams));
  assert.equal(pg.status, 303);
  const ses = stripeCalls.findLast((c) => c[1] === 'checkout/sessions')[2];
  assert.equal(ses.mode, 'payment');
  assert.equal(ses['line_items[0][quantity]'], '2');
  assert.equal(ses['line_items[0][price_data][unit_amount]'], '9900');
  const vuelta = await ir(deps, 'preventa/pagado', 'GET', { ...Object.fromEntries(u.searchParams), session_id: 'cs_test_2' });
  assert.match(vuelta.body, /Pagada/);
  assert.equal(filas[1].estado, 'cobrada');
  const h = paginaPreventas(cfg, filas.map((f) => ({ ...f, creado: '2026-11-10T10:00:00Z' })));
  assert.match(h, /2 cobradas/);
});

test('panel: visitas de la página y qué parte reserva', () => {
  const h = paginaPreventas(cfg, [{ creado: '2026-11-10T10:00:00Z', nombre: 'A', email: 'a@b.es', cantidad: 1, precio: 99, estado: 'reservada' }], { vistas: { vistas: 60, personas: 40 } });
  assert.match(h, /<b>60<\/b> visitas a la página de la RD10 de <b>40<\/b> personas · reserva el 2,5 %/);
});
