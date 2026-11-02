import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../lib/motor.mjs';
import { atenderPanel } from '../lib/circulo.mjs';
import { codigoBueno, cookieSesion, intentarEntrar, sesionValida } from '../lib/acceso.mjs';

const cfg = config({ ADMIN_CLAVE: 'una-contraseña-larga', ADMIN_PIN: '48213' });

function tablaFalsa(filas = []) {
  return { filas, async leer() { return filas.filter((f) => !f.ok); }, async guardar(x) { filas.push(x); return x; } };
}

test('código: el PIN o la contraseña de siempre; ADMIN_PIN solo si son cifras', () => {
  assert.equal(cfg.adminPin, '48213');
  assert.equal(config({ ADMIN_PIN: 'abc12' }).adminPin, '');
  assert.ok(codigoBueno('48213', cfg));
  assert.ok(codigoBueno('una-contraseña-larga', cfg));
  assert.ok(!codigoBueno('48214', cfg));
  assert.ok(!codigoBueno('', cfg));
});

test('sesión guardada: firmada, caduca, y no vale con otra clave', () => {
  const ahora = Date.parse('2026-10-27T10:00:00Z');
  const c = cookieSesion(cfg.adminClave, ahora).split(';')[0];
  assert.match(cookieSesion(cfg.adminClave, ahora), /HttpOnly; Secure; SameSite=Lax/);
  assert.ok(sesionValida({ cookie: `otra=1; ${c}` }, cfg.adminClave, ahora));
  assert.ok(!sesionValida({ cookie: c }, 'otra-clave', ahora));
  assert.ok(!sesionValida({ cookie: c }, cfg.adminClave, ahora + 181 * 864e5), 'a los 180 días caduca');
  assert.ok(!sesionValida({ cookie: c.replace(/.$/, (x) => (x === '0' ? '1' : '0')) }, cfg.adminClave, ahora), 'firma tocada');
});

test('intentos: tras 5 fallos desde la misma conexión, bloqueado (aunque luego acierte)', async () => {
  const intentos = tablaFalsa();
  const h = { 'x-forwarded-for': '1.2.3.4' };
  for (let i = 0; i < 5; i += 1) assert.match((await intentarEntrar('00000', h, cfg, { intentos, sinEspera: true })).error, /incorrecto/);
  const r = await intentarEntrar('48213', h, cfg, { intentos, sinEspera: true });
  assert.equal(r.bloqueado, true);
  assert.equal((await intentarEntrar('48213', { 'x-forwarded-for': '9.9.9.9' }, cfg, { intentos, sinEspera: true })).ok, true, 'otra conexión sí');
});

test('panel: sin sesión, la pantalla del código; al acertar, sesión guardada y de vuelta a donde iba', async () => {
  const deps = { db: async () => [], intentos: tablaFalsa(), sinEspera: true };
  const sin = await atenderPanel({ method: 'GET', query: { estado: 'clientes' }, headers: {} }, cfg, deps);
  assert.equal(sin.status, 401);
  assert.ok(!sin.headers['WWW-Authenticate'], 'sin la ventanita de usuario y contraseña del navegador');
  assert.match(sin.body, /Código del panel/);
  assert.match(sin.body, /inputmode="numeric"/);
  const mal = await atenderPanel({ method: 'POST', query: { estado: 'clientes' }, body: { codigo: '11111' }, headers: {} }, cfg, deps);
  assert.match(mal.body, /Código incorrecto. Te quedan 4 intentos/);
  const bien = await atenderPanel({ method: 'POST', query: { estado: 'clientes' }, body: { codigo: '48213' }, headers: {} }, cfg, deps);
  assert.equal(bien.status, 303);
  assert.equal(bien.headers.Location, '?estado=clientes');
  const cookie = bien.headers['Set-Cookie'].split(';')[0];
  const dentro = await atenderPanel({ method: 'GET', query: { estado: 'herramientas' }, headers: { cookie } }, cfg, deps);
  assert.equal(dentro.status, 200);
  assert.match(dentro.body, /Cerrar sesión/);
  const fuera = await atenderPanel({ method: 'GET', query: { salir: '1' }, headers: { cookie } }, cfg, deps);
  assert.match(fuera.headers['Set-Cookie'], /Max-Age=0/);
  // El acceso de antes sigue valiendo
  const basic = await atenderPanel({ method: 'GET', query: { estado: 'herramientas' }, headers: { authorization: 'Basic ' + Buffer.from('x:una-contraseña-larga').toString('base64') } }, cfg, deps);
  assert.equal(basic.status, 200);
});
