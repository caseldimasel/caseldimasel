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
