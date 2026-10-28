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
  assert.match(h, /href="https:\/\/sidonia\.es\/collections\/all\?q=porsche%20911"/);
  assert.match(h, /class="on">30 días/);
  assert.match(paginaEstadisticas(null, { error: 'function sidonia_estadisticas does not exist' }), /falta ejecutar sql\/estadisticas\.sql/);
});

test('panel › Estadísticas: con contraseña, y elige el periodo', async () => {
  const cfg = config({ ADMIN_CLAVE: 'panel' });
  const auth = { authorization: 'Basic ' + Buffer.from('equipo:panel').toString('base64') };
  let pedido = null;
  const r = await atenderPanel({ method: 'GET', query: { estado: 'estadisticas', dias: '7' }, body: {}, headers: auth }, cfg, { db: async (fn, a) => { pedido = [fn, a]; return datos; } });
  assert.deepEqual(pedido, ['sidonia_estadisticas', { p_dias: 7 }]);
  assert.match(r.body, /Estadísticas web · Panel de Sidonia/);
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

/* ---------------------------------------------------------------------------- Clientes (CRM) */
import { csvClientes, hace, paginaAnuncio, paginaCliente, paginaClientesCrm, temperatura } from '../lib/crm.mjs';

const AHORA = Date.parse('2026-10-26T12:00:00Z');
const crm = {
  dias: 30, total: 3, nuevos: 2, activos: 2,
  lista: [
    { cliente: '7', email: 'ana@correo.es', nombre: 'Ana', primera: '2026-10-20T10:00:00Z', vistas: 12, anuncios: 4, likes: 2, contactos: 1, quiso_contactar: 1, ofertas: 0, busquedas: 3, alertas: 1, actividad: '2026-10-26T09:00:00Z', ultimo_contacto: '2026-10-25T10:00:00Z', le_interesa: 'BMW 2002', le_interesa_handle: 'bmw', puntos: 40 },
    { cliente: '8', email: '=cmd@x.es', nombre: 'Luis; "El Rápido"', primera: '2026-10-01T10:00:00Z', vistas: 3, likes: 1, puntos: 6, actividad: '2026-10-10T09:00:00Z' },
    { cliente: '9', email: 'c@x.es', nombre: '', primera: '2026-09-01T10:00:00Z', puntos: 0 }
  ]
};

test('crm: temperatura y «hace cuánto»', () => {
  assert.deepEqual(temperatura(crm.lista[0], AHORA), ['caliente', 'Caliente']);
  assert.deepEqual(temperatura(crm.lista[1], AHORA), ['templado', 'Templado']);
  assert.deepEqual(temperatura(crm.lista[2], AHORA), ['frio', 'Frío']);
  assert.deepEqual(temperatura({ puntos: 2, ultimo_contacto: '2026-09-01T00:00:00Z' }, AHORA)[0], 'frio', 'contactó hace mucho');
  assert.equal(hace('2026-10-26T09:00:00Z', AHORA), 'hace 3 h');
  assert.equal(hace('2026-10-24T12:00:00Z', AHORA), 'hace 2 días');
});

test('crm: la lista, el CSV (Excel, sin fórmulas), un cliente y los interesados de un anuncio', () => {
  const h = paginaClientesCrm(crm, { dias: 30, ahora: AHORA });
  assert.match(h, /<span class="temp caliente">Caliente<\/span>/);
  assert.match(h, /\?estado=anuncio&h=bmw">BMW 2002/);
  assert.match(h, /<b>1<\/b><span>Calientes/);
  assert.match(h, /csv=1/);
  const csv = csvClientes(crm, AHORA);
  assert.ok(csv.startsWith('﻿email;nombre;interes'));
  assert.match(csv, /ana@correo\.es;Ana;Caliente;12;4;2;1;1;0;3;1;BMW 2002/);
  assert.match(csv, /"'=cmd@x\.es";"Luis; ""El Rápido"""/);
  const c = paginaCliente({ cliente: { cliente: '7', email: 'ana@correo.es', nombre: 'Ana', primera: '2026-10-20T10:00:00Z', visitas: 3 }, resumen: { vistas: 5, likes: 1, contactos: 1, ultima: '2026-10-26T09:00:00Z' },
    anuncios: [{ handle: 'bmw', titulo: 'BMW 2002', vistas: 4, like: true, contactos: 1, ofertas: 0, ultima: '2026-10-26T09:00:00Z' }], busquedas: [{ q: 'bmw e30', n: 2 }], alertas: [{ nombre: 'BMW · hasta 30.000 €', avisos: 2, creada: '2026-10-21T10:00:00Z' }],
    historial: [{ tipo: 'contacto', canal: 'whatsapp', handle: 'bmw', titulo: 'BMW 2002', creado: '2026-10-25T10:00:00Z' }, { tipo: 'busqueda', q: 'bmw e30', creado: '2026-10-24T10:00:00Z' }] }, { ahora: AHORA });
  assert.match(c, /Ana <span class="temp caliente">/);
  assert.match(c, /mailto:ana@correo\.es\?subject=Sobre%20el%20BMW%202002/);
  assert.match(c, /Escribió por WhatsApp · <a href="https:\/\/sidonia\.es\/products\/bmw"/);
  assert.match(c, /Buscó «bmw e30»/);
  assert.match(c, /BMW · hasta 30\.000 €/);
  assert.match(paginaCliente({ cliente: null }), /No hemos encontrado/);
  const a = paginaAnuncio({ handle: 'bmw', titulo: 'BMW 2002', total: { vistas: 50, personas: 30, likes: 4, contactos: 2 }, interesados: [{ cliente: '7', email: 'ana@correo.es', nombre: 'Ana', vistas: 4, like: true, contactos: 1, ultima: '2026-10-26T09:00:00Z' }, { cliente: '9', email: 'c@x.es', vistas: 1 }] }, { ahora: AHORA });
  assert.match(a, /Escribir a los 2 interesados/);
  assert.match(a, /bcc=ana%40correo\.es%2Cc%40x\.es/);
});

test('panel: Clientes con lo que hace cada uno (y CSV); sin el SQL nuevo, la lista de siempre', async () => {
  const cfg = config({ ADMIN_CLAVE: 'panel' });
  const auth = { authorization: 'Basic ' + Buffer.from('equipo:panel').toString('base64') };
  const pedidos = [];
  const db = async (fn, a) => { pedidos.push([fn, a]); return fn === 'sidonia_crm_clientes' ? crm : fn === 'sidonia_crm_cliente' ? { cliente: { cliente: '7', email: 'ana@correo.es' } } : { handle: 'bmw', interesados: [] }; };
  assert.match((await atenderPanel({ method: 'GET', query: { estado: 'clientes', dias: '90' }, headers: auth }, cfg, { db })).body, /Descargar CSV/);
  assert.deepEqual(pedidos[0], ['sidonia_crm_clientes', { p_dias: 90 }]);
  const csv = await atenderPanel({ method: 'GET', query: { estado: 'clientes', csv: '1' }, headers: auth }, cfg, { db });
  assert.match(csv.headers['Content-Type'], /text\/csv/);
  assert.match(csv.headers['Content-Disposition'], /clientes-sidonia-30-dias\.csv/);
  await atenderPanel({ method: 'GET', query: { estado: 'cliente', id: '7' }, headers: auth }, cfg, { db });
  assert.deepEqual(pedidos.at(-1), ['sidonia_crm_cliente', { p_cliente: '7' }]);
  await atenderPanel({ method: 'GET', query: { estado: 'anuncio', h: 'bmw' }, headers: auth }, cfg, { db });
  assert.deepEqual(pedidos.at(-1), ['sidonia_crm_anuncio', { p_handle: 'bmw' }]);
  const viejo = await atenderPanel({ method: 'GET', query: { estado: 'clientes' }, headers: auth }, cfg, { db: async (fn) => { if (fn === 'sidonia_crm_clientes') throw new Error('function sidonia_crm_clientes does not exist'); return { lista: [], total: 0 }; } });
  assert.match(viejo.body, /Clientes en total/);
});

test('base de datos: lo que hizo antes de entrar con su cuenta también es suyo', { skip: !CONN && 'sin PGTEST' }, () => {
  const args = (db) => [...CONN.split(/\s+/), '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atq'];
  const psql = (sql) => execFileSync('psql', [...args('sidonia_estad'), '-c', sql], { encoding: 'utf8' }).trim();
  const ev = (o) => psql(`select sidonia_evento('${JSON.stringify(o)}'::jsonb)`);
  psql("select sidonia_visita('77', 'ana@correo.es', 'Ana')");
  ev({ tipo: 'vista', sesion: 'navana', handle: 'bmw', titulo: 'BMW 2002' });
  ev({ tipo: 'contacto', canal: 'registro', sesion: 'navana', handle: 'bmw' });
  ev({ tipo: 'like', sesion: 'navana', cliente: '77', handle: 'bmw' });
  ev({ tipo: 'busqueda', sesion: 'navana', cliente: '77', q: 'bmw e30' });
  ev({ tipo: 'vista', sesion: 'otro', handle: 'bmw' });
  const l = JSON.parse(psql('select sidonia_crm_clientes(30)::text'));
  const ana = l.lista.find((c) => c.cliente === '77');
  assert.deepEqual([ana.email, ana.vistas, ana.likes, ana.quiso_contactar, ana.busquedas, ana.le_interesa_handle], ['ana@correo.es', 1, 1, 1, 1, 'bmw']);
  const c = JSON.parse(psql("select sidonia_crm_cliente('77')::text"));
  assert.equal(c.cliente.email, 'ana@correo.es');
  assert.equal(c.historial.length, 4);
  assert.deepEqual(c.busquedas.map((b) => b.q), ['bmw e30']);
  const a = JSON.parse(psql("select sidonia_crm_anuncio('bmw')::text"));
  assert.equal(a.titulo, 'BMW 2002');
  assert.equal(a.total.personas, 2, 'cuenta también a los anónimos');
  assert.deepEqual(a.interesados.map((x) => [x.email, x.like, x.quiso_contactar]), [['ana@correo.es', true, 1]]);
});

test('estadísticas › detalle de una cajita: contactos por anuncio, por canal y quién (24 h)', async () => {
  const { atenderPanel } = await import('../lib/circulo.mjs');
  const { config } = await import('../lib/motor.mjs');
  const cfg = config({ ADMIN_CLAVE: 'p', TIENDA_URL: 'https://sidonia.es' });
  const ahora = new Date().toISOString();
  const ev = [
    { tipo: 'contacto', handle: 'bmw-m3', titulo: 'BMW M3 E30', canal: 'whatsapp', sesion: 's1', cliente: '11', creado: ahora },
    { tipo: 'contacto', handle: 'bmw-m3', titulo: 'BMW M3 E30', canal: 'llamar', sesion: 's2', cliente: '', creado: ahora },
    { tipo: 'contacto', handle: 'seat-600', titulo: 'SEAT 600', canal: 'email', sesion: 's3', cliente: '', creado: ahora }];
  const pedidas = [];
  const eventos = { leer: async (f) => { pedidas.push(f); return /canal=eq\.registro/.test(f) ? [] : /creado=lt/.test(f) ? [{ sesion: 'x' }] : ev; } };
  const clientes = { leer: async () => [{ cliente: '11', nombre: 'Lucía', email: 'lucia@x.es' }] };
  const auth = { authorization: 'Basic ' + Buffer.from('a:p').toString('base64') };
  const r = await atenderPanel({ method: 'GET', query: { estado: 'estadisticas', dias: '1', ver: 'contactos' }, headers: auth }, cfg, { db: async () => null, eventos, clientes });
  assert.match(r.body, /<title>Contactos/);
  assert.match(r.body, /class="on">24 h/);
  assert.match(r.body, /BMW M3 E30<\/span><\/a>.*?<b>2<\/b>/s);
  assert.match(r.body, /WhatsApp 1 · Llamada 1/);
  assert.match(r.body, /Lucía<\/a><span class="sub">lucia@x\.es/);
  assert.match(r.body, /\+200 %/);
  assert.ok(pedidas[0].includes('tipo=eq.contacto&canal=neq.registro'));
  // Y la portada de estadísticas tiene las cajitas enlazadas y el periodo de 24 h
  const p = await atenderPanel({ method: 'GET', query: { estado: 'estadisticas', dias: '1' }, headers: auth }, cfg, { db: async () => ({ actual: {}, anterior: {} }) });
  assert.match(p.body, /href="\?estado=estadisticas&dias=1&ver=contactos"/);
  assert.match(p.body, /Las últimas 24 horas/);
});

test('estadísticas › ahora en la web: lo último de cada persona, con quién es y la portada del anuncio', async () => {
  const { leerActividad, cajaActividad, fotosDe, frase } = await import('../lib/actividad.mjs');
  const ahora = Date.now();
  const t = (min) => new Date(ahora - min * 60e3).toISOString();
  const eventos = [
    { tipo: 'contacto', canal: 'whatsapp', handle: 'porsche-944', titulo: 'PORSCHE 944 S2', sesion: 's1', cliente: '7', movil: true, creado: t(1) },
    { tipo: 'vista', handle: 'porsche-944', titulo: 'PORSCHE 944 S2', sesion: 's1', cliente: '7', movil: true, creado: t(2) },
    { tipo: 'vista', handle: 'porsche-944', titulo: 'PORSCHE 944 S2', sesion: 's1', cliente: '7', movil: true, creado: t(3) },
    { tipo: 'busqueda', q: '944', sesion: 's1', cliente: '7', movil: true, creado: t(4) },
    { tipo: 'visita', origen: 'instagram', sesion: 'abcd1234', cliente: null, creado: t(30) }
  ];
  const deps = {
    eventos: { leer: async () => eventos },
    clientes: { leer: async () => [{ cliente: '7', email: 'ana@x.es', nombre: 'Ana <b>' }] },
    gql: async (q, v) => ({ products: { nodes: [{ handle: 'porsche-944', featuredImage: { url: 'https://cdn.shopify.com/944.jpg' } }] } })
  };
  const lista = await leerActividad({}, deps);
  assert.equal(lista.length, 2);
  assert.equal(lista[0].email, 'ana@x.es');
  assert.equal(lista[0].acciones[1].veces, 2, 'ver dos veces seguidas la misma ficha cuenta una, ×2');
  const fotos = await fotosDe({}, deps, ['porsche-944']);
  assert.equal(fotos['porsche-944'], 'https://cdn.shopify.com/944.jpg');
  const h = cajaActividad(lista, fotos, { ahora });
  assert.match(h, /Escribió por WhatsApp por/);
  assert.match(h, /Buscó «944»/);
  assert.match(h, /src="https:\/\/cdn\.shopify\.com\/944\.jpg"/);
  assert.match(h, /Ana &lt;b&gt;/);
  assert.match(h, /Entró en la web desde Instagram/);
  assert.match(h, /Visitante sin cuenta/);
  assert.deepEqual(frase({ tipo: 'contacto', canal: 'registro' })[0], 'Quiso contactar sin cuenta (le pedimos registrarse) por');
});
