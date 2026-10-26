import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { atender, config } from '../lib/motor.mjs';
import { atenderPanel } from '../lib/circulo.mjs';
import { paginaEstadisticas, registrarEvento } from '../lib/estadisticas.mjs';

test('evento: solo tipos conocidos, limpio, y sin bots', async () => {
  const llamadas = [];
  const db = async (fn, args) => { llamadas.push([fn, args]); return { ok: true }; };
  assert.deepEqual(await registrarEvento(db, { tipo: 'hackear' }, null), { ok: false, error: 'tipo' });
  assert.deepEqual(await registrarEvento(db, { tipo: 'vista' }, null, { 'user-agent': 'Googlebot/2.1' }), { ok: true, bot: true });
  await registrarEvento(db, { tipo: 'contacto', canal: 'whatsapp', handle: 'porsche-911', titulo: '  PORSCHE   911 ', sesion: 'abc123def', q: 'no', origen: 'x' }, '77');
  assert.deepEqual(llamadas[0], ['sidonia_evento', { p: { tipo: 'contacto', handle: 'porsche-911', titulo: 'PORSCHE 911', canal: 'whatsapp', q: '', sesion: 'abc123def', cliente: '77', app: false, movil: false, origen: '' } }]);
  await registrarEvento(db, { tipo: 'visita', handle: '../x', canal: 'fax', origen: 'Instagram!', sesion: 'x' }, null);
  const p = llamadas[1][1].p;
  assert.equal(p.handle, ''); assert.equal(p.canal, ''); assert.equal(p.origen, 'instagram'); assert.equal(p.sesion, '');
});

test('motor: api/evento por la entrada directa, sin sesión y sin romper nunca', async () => {
  const cfg = config({ SUBASTAS_CLAVE: 'k' });
  const ok = await atender({ method: 'POST', ruta: 'api/evento', query: {}, body: { tipo: 'visita', sesion: 'abcdef12' }, directo: true }, cfg, { db: async () => ({ ok: true }) });
  assert.deepEqual(JSON.parse(ok.body), { ok: true });
  const roto = await atender({ method: 'POST', ruta: 'api/evento', query: {}, body: { tipo: 'visita' }, directo: true }, cfg, { db: async () => { throw new Error('x'); } });
  assert.deepEqual(JSON.parse(roto.body), { ok: false });
});

const datos = {
  dias: 30, actual: { visitantes: 120, vistas: 300, contactos: 12, contactos_registro: 5, likes: 40, compartidos: 3, busquedas: 50, alertas: 4, ofertas: 2 },
  anterior: { visitantes: 100, vistas: 320, contactos: 0 }, registros: 9, registros_antes: 3,
  por_dia: [{ dia: '2026-10-25', visitantes: 50, vistas: 100, contactos: 5 }, { dia: '2026-10-26', visitantes: 70, vistas: 200, contactos: 7 }],
  anuncios: [{ handle: 'porsche', titulo: 'PORSCHE 911 <b>', vistas: 100, personas: 80, likes: 10, guardados: 8, contactos: 5, contactos_registro: 2, compartidos: 1 }],
  mas_contactados: [{ handle: 'porsche', titulo: 'PORSCHE 911', contactos: 5 }], mas_guardados: [], busquedas: [{ q: 'porsche 911', n: 7 }],
  canales: { whatsapp: 8, llamar: 4, registro: 5 }, origenes: [{ origen: 'instagram', n: 60 }, { origen: 'directo', n: 30 }], app: 10, movil: 90, con_cuenta: 15
};

test('panel: estadísticas con lo importante, comparando y sin colar HTML', () => {
  const h = paginaEstadisticas(datos, { dias: 30, tienda: 'https://sidonia.es' });
  assert.match(h, /<b>120<\/b><em class="sube">\+20 %<\/em><span>Visitantes/);
  assert.match(h, /<b>300<\/b><em class="baja">−6 %<\/em>/);
  assert.match(h, /De cada 100 fichas vistas, <b>4<\/b> acaban en un contacto/);
  assert.match(h, /<b>5<\/b> veces quisieron contactar sin cuenta/);
  assert.match(h, /PORSCHE 911 &lt;b&gt;/);
  assert.match(h, /Instagram/);
  assert.match(h, /href="https:\/\/sidonia\.es\/search\?q=porsche%20911&type=product"/);
  assert.match(h, /class="on">30 días/);
  assert.match(paginaEstadisticas(null, { error: 'function sidonia_estadisticas does not exist' }), /falta ejecutar sql\/estadisticas\.sql/);
});

test('panel › Estadísticas: con contraseña, y elige el periodo', async () => {
  const cfg = config({ ADMIN_CLAVE: 'panel' });
  const auth = { authorization: 'Basic ' + Buffer.from('equipo:panel').toString('base64') };
  let pedido = null;
  const r = await atenderPanel({ method: 'GET', query: { estado: 'estadisticas', dias: '7' }, body: {}, headers: auth }, cfg, { db: async (fn, a) => { pedido = [fn, a]; return datos; } });
  assert.deepEqual(pedido, ['sidonia_estadisticas', { p_dias: 7 }]);
  assert.match(r.body, /Estadísticas · Panel de Sidonia/);
  const sin = await atenderPanel({ method: 'GET', query: { estado: 'estadisticas' }, body: {}, headers: {} }, cfg, { db: async () => datos });
  assert.equal(sin.status, 401);
});

const CONN = process.env.PGTEST;
test('base de datos: apunta y resume', { skip: !CONN && 'sin PGTEST' }, () => {
  const args = (db) => [...CONN.split(/\s+/), '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atq'];
  const psql = (sql, db = 'sidonia_estad') => execFileSync('psql', [...args(db), '-c', sql], { encoding: 'utf8' }).trim();
  const fichero = (f) => execFileSync('psql', [...args('sidonia_estad'), '-f', fileURLToPath(new URL(`../sql/${f}`, import.meta.url))], { encoding: 'utf8' });
  psql('drop database if exists sidonia_estad', 'postgres');
  psql('create database sidonia_estad', 'postgres');
  psql("create schema storage; create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[])");
  fichero('circulo.sql');
  fichero('estadisticas.sql');
  fichero('estadisticas.sql');
  const ev = (o) => JSON.parse(psql(`select sidonia_evento('${JSON.stringify(o)}'::jsonb)::text`));
  assert.equal(ev({ tipo: 'visita', sesion: 's1', origen: 'instagram', movil: true }).ok, true);
  assert.equal(ev({ tipo: 'nada' }).ok, false);
  ev({ tipo: 'vista', sesion: 's1', handle: 'porsche', titulo: 'PORSCHE 911' });
  ev({ tipo: 'vista', sesion: 's2', handle: 'porsche', titulo: 'PORSCHE 911' });
  ev({ tipo: 'contacto', canal: 'whatsapp', sesion: 's1', handle: 'porsche' });
  ev({ tipo: 'contacto', canal: 'registro', sesion: 's2', handle: 'porsche' });
  ev({ tipo: 'like', sesion: 's2', handle: 'porsche' });
  ev({ tipo: 'busqueda', sesion: 's2', q: ' Porsche ' });
  psql("insert into eventos (tipo, sesion, creado) values ('visita', 'viejo', now() - interval '40 days')");
  const e = JSON.parse(psql('select sidonia_estadisticas(30)::text'));
  assert.deepEqual([e.actual.visitantes, e.actual.vistas, e.actual.contactos, e.actual.contactos_registro, e.actual.likes], [2, 2, 1, 1, 1]);
  assert.equal(e.anterior.visitantes, 1);
  assert.equal(e.por_dia.length >= 30, true);
  assert.deepEqual(e.anuncios[0], { handle: 'porsche', titulo: 'PORSCHE 911', vistas: 2, personas: 2, likes: 1, guardados: 1, contactos: 1, contactos_registro: 1, compartidos: 0, ofertas: 0 });
  assert.deepEqual(e.busquedas, [{ q: 'porsche', n: 1 }]);
  assert.deepEqual(e.origenes, [{ origen: 'instagram', n: 1 }]);
  assert.equal(e.movil, 1);
});
