import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { atender, config } from '../lib/motor.mjs';
import { leerOferta } from '../lib/ofertas.mjs';

const cfg = config({ SUBASTAS_CLAVE: 'k', RESEND_API_KEY: 're_x', AVISOS_EQUIPO: 'equipo@sidonia.es', TIENDA_URL: 'https://sidonia.es', SERVIDOR_URL: 'https://motor.test', SUPABASE_URL: 'https://x.supabase.co' });
const quien = (c = '55') => { const t = String(Math.floor(Date.now() / 1000)); return { c, ct: t, cf: createHmac('sha256', 'k').update(`${c}.${t}`).digest('hex') }; };
const oferta = { handle: 'bmw-m3-e30', titulo: 'BMW M3 E30 1988', url: 'https://sidonia.es/products/bmw-m3-e30', precio: 64900, oferta: '58.000', nombre: 'Lucía Gómez', email: 'Lucia@x.es', telefono: '600111222', mensaje: 'Pago al contado.' };

function preparar(anuncios) {
  const correos = [], guardadas = [];
  const deps = {
    db: async () => null,
    fetch: async (u, o) => { correos.push(JSON.parse(o.body)); return { ok: true, json: async () => ({}) }; },
    tabla: { leer: async (f) => anuncios.filter((a) => f.includes(`producto=eq.${a.producto}`)) },
    ofertas: { leer: async () => [], guardar: async (x) => { guardadas.push(x); return x; } }
  };
  const enviar = (body, q = quien()) => atender({ method: 'POST', ruta: 'api/oferta', query: q, body, directo: true, headers: {} }, cfg, deps).then((r) => JSON.parse(r.body));
  return { correos, guardadas, enviar };
}

test('oferta: limpia el importe y comprueba los datos', () => {
  assert.equal(leerOferta(oferta).oferta.oferta, 58000);
  assert.equal(leerOferta({ ...oferta, email: 'no' }).error, 'email');
  assert.equal(leerOferta({ ...oferta, oferta: '0' }).error, 'oferta');
});

test('oferta en un anuncio de la comunidad: le llega al dueño (responde al comprador), copia al equipo y resumen al comprador', async () => {
  const { correos, guardadas, enviar } = preparar([{ id: 9, producto: 'bmw-m3-e30', titulo: 'BMW M3 E30 1988', estado: 'publicado', vendedor_nombre: 'Javier', email: 'javier@x.es', cliente: '77', fotos: ['77/a.jpg'], precio: 64900 }]);
  const r = await enviar(oferta);
  assert.deepEqual([r.ok, r.para, r.vendedor, r.email_enviado], [true, 'dueno', 'Javier', true]);
  const dueno = correos.find((c) => c.to[0] === 'javier@x.es');
  assert.match(dueno.subject, /Oferta de 58\.000 € por BMW M3 E30 1988/);
  assert.equal(dueno.reply_to, 'lucia@x.es', 'respondiendo, le contesta al comprador');
  assert.match(dueno.html, /Tienes una oferta/);
  assert.match(dueno.html, /−11 %|-11 %/);
  assert.match(dueno.html, /wa\.me\/34600111222/);
  assert.match(correos.find((c) => c.to[0] === 'equipo@sidonia.es').subject, /^\[Comunidad\]/);
  assert.match(correos.find((c) => c.to[0] === 'lucia@x.es').html, /Le hemos enviado tu oferta a <b>Javier<\/b>/);
  assert.deepEqual([guardadas[0].para, guardadas[0].anuncio, guardadas[0].enviada, guardadas[0].cliente], ['dueno', 9, true, '55']);
  // Sin cuenta, a un dueño no
  assert.equal((await enviar(oferta, {})).error, 'login');
});

test('oferta en un anuncio de Sidonia: le llega al equipo, con la foto que manda la web', async () => {
  const { correos, enviar } = preparar([]);
  const r = await enviar({ ...oferta, imagen: 'https://cdn.shopify.com/m3.jpg' }, {});
  assert.deepEqual([r.ok, r.para], [true, 'sidonia']);
  const equipo = correos.find((c) => c.to[0] === 'equipo@sidonia.es');
  assert.match(equipo.subject, /^Oferta de 58\.000 €/);
  assert.match(equipo.html, /cdn\.shopify\.com\/m3\.jpg/);
  assert.match(correos.find((c) => c.to[0] === 'lucia@x.es').html, /te contestamos lo antes posible/);
});
