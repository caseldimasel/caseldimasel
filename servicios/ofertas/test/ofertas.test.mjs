import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { atender, comprobarFirma, config, emailCliente, emailEquipo, firmar, validar } from '../lib/ofertas.mjs';

const cfg = config({
  RESEND_API_KEY: 're_test', OFERTAS_EQUIPO: 'hola@sidonia.es', OFERTAS_CLAVE: 'clave-de-prueba', OFERTAS_WHATSAPP: '+34 675 287 095'
});
const base = {
  handle: 'porsche-924-1984', titulo: 'PORSCHE 924 1984', url: 'https://sidonia.es/products/porsche-924-1984', precio: 23000,
  oferta: 21000, nombre: 'Lucía Prueba', email: 'Lucia@Ejemplo.es', telefono: '+34 600 111 222', mensaje: 'Pago al contado.'
};
const silencio = { error() {} };

function fakeFetch(fallos = {}) {
  const enviados = [];
  const fn = async (url, init) => {
    const body = JSON.parse(init.body);
    enviados.push(body);
    const quien = body.to.includes('hola@sidonia.es') ? 'equipo' : 'cliente';
    if (fallos[quien]) return { ok: false, status: 500, text: async () => 'error' };
    return { ok: true, json: async () => ({ id: 'x' }) };
  };
  fn.enviados = enviados;
  return fn;
}

test('valida y limpia la oferta', () => {
  const v = validar({ ...base, oferta: '21000', mensaje: 'x'.repeat(5000) });
  assert.equal(v.ok, true);
  assert.equal(v.oferta.oferta, 21000);
  assert.equal(v.oferta.email, 'lucia@ejemplo.es');
  assert.equal(v.oferta.mensaje.length, 2000);
  assert.equal(validar({ ...base, oferta: 0 }).error, 'oferta');
  assert.equal(validar({ ...base, email: 'no-es-email' }).error, 'email');
  assert.equal(validar({ ...base, nombre: ' ' }).error, 'nombre');
  assert.equal(validar(null).error, 'datos');
  assert.equal(validar({ ...base, url: 'javascript:alert(1)' }).oferta.url, '');
});

test('la firma es la misma que calcula Shopify con hmac_sha256', () => {
  const ts = '1760000000';
  const liquid = createHmac('sha256', 'clave-de-prueba').update(`7001:lucia@ejemplo.es:${ts}`).digest('hex');
  assert.equal(firmar('7001', 'Lucia@Ejemplo.es', ts, 'clave-de-prueba'), liquid);
  const o = validar({ ...base, cliente: { id: 7001, ts, firma: liquid } }).oferta;
  assert.equal(comprobarFirma(o, cfg, 1760000000 * 1000 + 3600e3), null);
  assert.equal(comprobarFirma(o, cfg, 1760000000 * 1000 + 72 * 3600e3), 'firma_caducada');
  const mala = validar({ ...base, email: 'otra@ejemplo.es', cliente: { id: 7001, ts, firma: liquid } }).oferta;
  assert.equal(comprobarFirma(mala, cfg, 1760000000 * 1000), 'firma');
  assert.equal(comprobarFirma(validar(base).oferta, { ...cfg, soloFirmadas: true }), 'sin_firma');
  assert.equal(comprobarFirma(validar(base).oferta, cfg), null);
});

test('los emails escapan lo que escribe el cliente', () => {
  const o = validar({ ...base, nombre: '<b>Lucía</b>', mensaje: '<script>alert(1)</script>' }).oferta;
  const c = emailCliente(o, cfg);
  const e = emailEquipo(o, cfg);
  assert.ok(!c.html.includes('<script>'));
  assert.ok(!e.html.includes('<b>Lucía</b>'));
  assert.match(c.subject, /Hemos recibido tu oferta por PORSCHE 924 1984/);
  assert.match(c.html, /21\.000\s€/);
  assert.match(c.html, /wa\.me\/34675287095/);
  assert.deepEqual(c.to, ['lucia@ejemplo.es']);
  assert.equal(c.reply_to, 'hola@sidonia.es');
  assert.equal(e.reply_to, 'lucia@ejemplo.es');
  assert.match(e.html, /91 % del precio/);
});

test('atiende una oferta: aviso al equipo y email de gracias', async () => {
  const f = fakeFetch();
  const r = await atender(base, cfg, { fetchImpl: f, log: silencio });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, email_enviado: true });
  assert.equal(f.enviados.length, 2);
  assert.deepEqual(f.enviados[0].to, ['hola@sidonia.es']);
  assert.deepEqual(f.enviados[1].to, ['lucia@ejemplo.es']);
});

test('si falla el email de gracias, la oferta llega igual al equipo', async () => {
  const r = await atender(base, cfg, { fetchImpl: fakeFetch({ cliente: true }), log: silencio });
  assert.deepEqual(r.body, { ok: true, email_enviado: false });
});

test('si falla el aviso al equipo, responde error (el tema usa el formulario de Shopify)', async () => {
  const r = await atender(base, cfg, { fetchImpl: fakeFetch({ equipo: true }), log: silencio });
  assert.equal(r.status, 502);
  assert.equal(r.body.ok, false);
});

test('sin configurar no envía nada', async () => {
  const f = fakeFetch();
  const r = await atender(base, config({}), { fetchImpl: f, log: silencio });
  assert.equal(r.status, 503);
  assert.equal(f.enviados.length, 0);
});
