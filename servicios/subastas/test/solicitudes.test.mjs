// Panel › Gestiones de venta y Alquileres
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atenderPanel } from '../lib/circulo.mjs';
import { config } from '../lib/motor.mjs';

const cfg = config({ ADMIN_CLAVE: 'p', TIENDA_URL: 'https://sidonia.es', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 's', RESEND_API_KEY: 're_x', AVISOS_EQUIPO: 'equipo@x.es' });
const auth = { authorization: 'Basic ' + Buffer.from('a:p').toString('base64') };
function memo(filas = []) {
  let sig = 50;
  return { filas,
    leer: async (f = '') => {
      let l = [...filas];
      for (const [, k, op, v] of f.matchAll(/(?:^|&)(\w+)=(eq|in)\.([^&]+)/g)) {
        const vv = decodeURIComponent(v);
        l = l.filter((x) => (op === 'eq' ? String(x[k]) === vv : vv.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/"/g, '')).includes(String(x[k]))));
      }
      return l;
    },
    guardar: async (x) => { const n = { id: sig++, creado: new Date().toISOString(), ...x }; filas.push(n); return n; },
    cambiar: async (id, c) => Object.assign(filas.find((x) => Number(x.id) === Number(id)), c),
    borrar: async (f) => { const id = Number(/id=eq\.(\d+)/.exec(f)[1]); filas.splice(filas.findIndex((x) => Number(x.id) === id), 1); } };
}

test('panel › Gestiones de venta: se ven con su WhatsApp, se cambia el estado y se añaden a mano', async () => {
  const gestiones = memo([{ id: 1, estado: 'nueva', creado: '2026-11-12T10:00:00Z', datos: { marca: 'Aston Martin', modelo: 'DB7', anio: '1996', ubicacion: 'Álava', nombre: 'Íñigo López', telefono: '+34600112233', fotos: ['55/abcdefgh1.jpg'], historia: 'Siempre en garaje.' } }]);
  const deps = { db: async () => [], tabla: memo([]), gestiones, garaje: memo([]), perfiles: memo([]), fetch: async () => ({ ok: true, json: async () => ({}) }) };
  const r = await atenderPanel({ method: 'GET', query: { estado: 'gestiones' }, headers: auth }, cfg, deps);
  assert.match(r.body, /Aston Martin DB7 1996/);
  assert.match(r.body, /https:\/\/wa\.me\/34600112233\?text=Hola%20%C3%8D%C3%B1igo/);
  assert.match(r.body, /Gestiones de venta <b class="num">1<\/b>/, 'el número rojo del menú');
  await atenderPanel({ method: 'POST', query: { estado: 'gestiones' }, body: { accion: 'gestion', id: '1', estado: 'contactado', nota: 'Le llamo el lunes' }, headers: auth }, cfg, deps);
  assert.equal(gestiones.filas[0].estado, 'contactado'); assert.equal(gestiones.filas[0].nota, 'Le llamo el lunes');
  await atenderPanel({ method: 'POST', query: { estado: 'gestiones' }, body: { accion: 'gestion-nueva', marca: 'Porsche', modelo: '911', nombre: 'Ana', telefono: '611222333', origen: 'Email' }, headers: auth }, cfg, deps);
  assert.equal(gestiones.filas.at(-1).datos.telefono, '+34611222333'); assert.equal(gestiones.filas.at(-1).estado, 'nueva');
});

test('panel › Alquileres: llega por revisar, se edita (fotos incluidas), se aprueba y publica, o se rechaza con email', async () => {
  const garaje = memo([{ id: 7, cliente: '55', marca: 'Mercedes', modelo: '280 SL', anio: 1970, alquiler: true, visible: true, fotos: ['55/aaaaaaaa1.jpg', '55/aaaaaaaa2.jpg', '55/aaaaaaaa3.jpg'], historia: 'De mi abuelo.', alq: { hora: 60, min_horas: 3, ciudad: 'Madrid', declara: true, estado: 'pendiente', recibido: '2026-11-12T10:00:00Z' }, creado: '2026-11-12T10:00:00Z' }]);
  const perfiles = memo([{ cliente: '55', nombre: 'Marta', alq_legal: { nombre: 'Marta Ruiz', dni: '12345678Z', domicilio: 'Calle 1', telefono: '600000000', email: 'marta@x.es', acepto: 'x', version: 'v' } }]);
  const correos = [];
  const deps = { db: async () => [], tabla: memo([]), gestiones: memo([]), garaje, perfiles, alquiler: memo([]),
    subidas: async (c, cliente, tipos) => ({ ok: true, subidas: tipos.map((_, i) => ({ ruta: `${cliente}/nuevafoto${i}.jpg`, url: `https://x/subir/${i}` })) }),
    fetch: async (u, o) => { correos.push(JSON.parse(o.body)); return { ok: true, json: async () => ({}) }; } };
  const ir = (body, ver) => atenderPanel({ method: body ? 'POST' : 'GET', query: { estado: 'alquileres', ...(ver ? { ver } : {}) }, body, headers: auth }, cfg, deps);
  const r = await ir();
  assert.match(r.body, /MERCEDES 280 SL 1970/); assert.match(r.body, /Por revisar · no se ve/); assert.match(r.body, /Aprobar y publicar/); assert.match(r.body, /Alquileres <b class="num">1<\/b>/);
  assert.match(r.body, /wa\.me\/34600000000\?text=/);
  // Fotos: quitar, añadir (permiso + rutas de su carpeta) y portada
  await ir({ accion: 'alq-fotos', id: '7', quitar: ['0', '2'] }); assert.deepEqual(garaje.filas[0].fotos, ['55/aaaaaaaa2.jpg']);
  const s = JSON.parse((await ir({ accion: 'alq-subir', id: '7', n: '2' })).body);
  assert.equal(s.ok, true); assert.equal(s.subidas.length, 2);
  await ir({ accion: 'alq-fotos-nuevas', id: '7', ruta: ['55/nuevafoto0.jpg', '99/ajena123.jpg'] });
  assert.deepEqual(garaje.filas[0].fotos, ['55/aaaaaaaa2.jpg', '55/nuevafoto0.jpg'], 'solo las de su carpeta');
  // Ordenar (la primera es la portada), con una editada nueva y sin las de otra carpeta
  const o = JSON.parse((await atenderPanel({ method: 'POST', query: { estado: 'alquileres' }, body: { accion: 'alq-fotos-orden', id: '7', ruta: ['55/nuevafoto0.jpg', '99/ajena123.jpg', '55/editada12.jpg', '55/aaaaaaaa2.jpg'] }, headers: { ...auth, accept: 'application/json' } }, cfg, deps)).body);
  assert.deepEqual(o.fotos, ['55/nuevafoto0.jpg', '55/editada12.jpg', '55/aaaaaaaa2.jpg']); assert.deepEqual(garaje.filas[0].fotos, o.fotos);
  assert.equal(JSON.parse((await ir({ accion: 'alq-fotos-orden', id: '7', ruta: ['99/ajena123.jpg'] })).body).ok, false, 'al menos una foto');
  assert.match((await ir()).body, /data-fotos="7"/);
  await ir({ accion: 'alq-editar', id: '7', marca: 'MERCEDES-BENZ', modelo: '280 SL', anio: '1970', hora: '75', min_horas: '2', ciudad: 'Toledo', plazas: '2', historia: 'Nueva', normas: 'Sin fumar' });
  assert.equal(garaje.filas[0].marca, 'MERCEDES-BENZ'); assert.equal(garaje.filas[0].alq.hora, 75); assert.equal(garaje.filas[0].alq.estado, 'pendiente', 'editar no lo publica');
  // Rechazar: con el motivo por email, sigue sin verse
  await ir({ accion: 'alq-rechazar', id: '7', motivo: 'Las fotos están borrosas' });
  assert.equal(garaje.filas[0].alq.estado, 'rechazado');
  assert.ok(correos.some((c) => [].concat(c.to).includes('marta@x.es') && /borrosas/.test(c.html)));
  assert.match((await ir(null, 'rechazados')).body, /Motivo del rechazo: Las fotos están borrosas/);
  // Aprobar y publicar: se ve y le llega «ya está publicado» (una vez)
  correos.length = 0;
  const pub = await ir({ accion: 'alq-publicar', id: '7' });
  assert.equal(garaje.filas[0].alq.estado, 'publicado'); assert.equal(garaje.filas[0].visible, true); assert.equal(garaje.filas[0].alq.rechazado, undefined);
  assert.match(pub.body, /Publicado en Alquiler y avisado por email/);
  assert.ok(correos.some((c) => [].concat(c.to).includes('marta@x.es') && /ya está publicado/i.test(c.html)));
  assert.ok(garaje.filas[0].alq.aviso_listo);
  await ir({ accion: 'alq-ocultar', id: '7' }); assert.equal(garaje.filas[0].visible, false);
  await ir({ accion: 'alq-mostrar', id: '7' }); assert.equal(garaje.filas[0].visible, true);
  await ir({ accion: 'alq-borrar', id: '7' }); assert.equal(garaje.filas.length, 0);
});

test('alquiler › lo nuevo no se publica solo: queda por revisar, no sale en la web y llega «recibido»', async () => {
  const { rutasGaraje } = await import('../lib/garaje.mjs');
  const { rutasReservas } = await import('../lib/reservas.mjs');
  const garaje = memo([]), perfiles = memo([{ cliente: '55', slug: 'marta-55', nombre: 'Marta' }]);
  const correos = [];
  const deps = { garaje, perfiles, alquiler: memo([]), reservas: memo([]), reservas_resenas: memo([]), reservas_mensajes: memo([]), ajustes: memo([]),
    fetch: async (u, o) => { correos.push(JSON.parse(o.body)); return { ok: true, json: async () => ({}) }; } };
  const coche = { tipo: 'coche', marca: 'Seat', modelo: '600', anio: '1968', historia: 'El coche de mi abuela, siempre en garaje y con sus papeles.', fotos: ['55/abcdefgh1.jpg'], alquiler: true, alquiler_como: 'con', visible: true, email: 'marta@x.es',
    alq: { hora: 50, min_horas: 2, ciudad: 'Madrid', declara: true, matricula: '1234ABC', seguro_compania: 'Mutua', seguro_poliza: 'P-1', itv_hasta: '2030-01-01' } };
  const sinDatos = JSON.parse((await rutasGaraje({ ruta: 'api/garaje', method: 'POST', body: { ...coche, alq: { hora: 50, ciudad: 'Madrid', declara: true } } }, '55', cfg, deps)).body);
  assert.equal(sinDatos.error, 'vehiculo', 'como Airbnb: sin matrícula, seguro e ITV no se publica'); assert.equal(garaje.filas.length, 0);
  const r = await rutasGaraje({ ruta: 'api/garaje', method: 'POST', body: coche }, '55', cfg, deps);
  assert.equal(JSON.parse(r.body).ok, true);
  const c = garaje.filas[0];
  assert.equal(c.alq.estado, 'pendiente'); assert.equal(c.alq.contacto, 'marta@x.es');
  assert.ok(correos.some((m) => [].concat(m.to).includes('marta@x.es') && /hemos recibido/i.test(m.html)), 'al dueño: recibido');
  assert.ok(correos.some((m) => /Alquiler por revisar/.test(m.subject)), 'al equipo: por revisar');
  const lista = JSON.parse((await rutasReservas({ ruta: 'api/alquiler/coches', method: 'GET', body: {} }, '', cfg, deps)).body);
  assert.equal(lista.coches.length, 0, 'no sale en Alquiler');
  const una = await rutasReservas({ ruta: 'api/alquiler/coche', method: 'GET', body: { id: c.id } }, '77', cfg, deps);
  assert.equal(una.status, 404);
  const pub = JSON.parse((await rutasGaraje({ ruta: 'api/garaje/recientes', method: 'GET', body: { alquiler: '1' } }, '', cfg, deps)).body);
  assert.equal(pub.coches.length, 0);
  const mio = JSON.parse((await rutasGaraje({ ruta: 'api/garaje', method: 'GET', body: {} }, '55', cfg, deps)).body);
  assert.equal(mio.coches[0].revision, 'pendiente'); assert.equal(mio.coches[0].alquiler, true); assert.ok(mio.coches[0].falta.includes('revision'));
  // Editarlo mientras espera: no manda otro «recibido»
  const n = correos.length;
  await rutasGaraje({ ruta: 'api/garaje', method: 'POST', body: { ...coche, id: c.id, historia: coche.historia + ' Más.' } }, '55', cfg, deps);
  assert.equal(correos.length, n); assert.equal(garaje.filas[0].alq.estado, 'pendiente');
  // Publicado: ahora sí sale; y al editarlo sigue publicado
  garaje.filas[0].alq.estado = 'publicado';
  assert.equal(JSON.parse((await rutasReservas({ ruta: 'api/alquiler/coches', method: 'GET', body: {} }, '', cfg, deps)).body).coches.length, 1);
  await rutasGaraje({ ruta: 'api/garaje', method: 'POST', body: { ...coche, id: c.id, alq: { ...coche.alq, hora: 55 } } }, '55', cfg, deps);
  assert.equal(garaje.filas[0].alq.estado, 'publicado'); assert.equal(garaje.filas[0].alq.hora, 55);
  // Rechazado y lo cambia: vuelve a revisión
  garaje.filas[0].alq.estado = 'rechazado'; garaje.filas[0].alq.rechazado = 'Faltan fotos';
  await rutasGaraje({ ruta: 'api/garaje', method: 'POST', body: { ...coche, id: c.id } }, '55', cfg, deps);
  assert.equal(garaje.filas[0].alq.estado, 'pendiente'); assert.equal(garaje.filas[0].alq.rechazado_antes, 'Faltan fotos');
});

test('alquiler › «Pide un coche» con día, horas y fotos (solo las suyas), y se ven en «Lo que se busca»', async () => {
  const { recibirAlquiler, peticionesPublicas } = await import('../lib/alquiler.mjs');
  const filas = [];
  const alquiler = { leer: async (f = '') => (f.includes('publico=eq.true') ? filas.filter((x) => x.publico) : []), guardar: async (x) => { const n = { id: filas.length + 1, estado: 'abierta', creado: new Date().toISOString(), ...x }; filas.push(n); return n; } };
  const deps = { alquiler, fetch: async () => ({ ok: true, json: async () => ({}) }) };
  const r = await recibirAlquiler({ rol: 'alquilar', publico: true, nombre: 'Lucía', email: 'l@x.es', busca: 'Un descapotable blanco', para: 'boda', fecha: '12 de diciembre · de 10:00 a 14:00', ciudad: 'Madrid', fotos: ['55/abcdefgh1.jpg', '99/ajena1234.jpg', '../mal.jpg'] }, '55', cfg, deps);
  assert.equal(r.ok, true);
  assert.deepEqual(filas[0].fotos, ['55/abcdefgh1.jpg']);
  const l = await peticionesPublicas(cfg, deps);
  assert.equal(l[0].busca, 'Un descapotable blanco'); assert.equal(l[0].fecha, '12 de diciembre · de 10:00 a 14:00');
  assert.match(l[0].fotos[0], /\/storage\/v1\/object\/public\/anuncios\/55\/abcdefgh1\.jpg$/);
  // Sin la columna «fotos» todavía: van en el mensaje y se leen igual
  const filas2 = [];
  const vieja = { leer: async () => filas2, guardar: async (x) => { if ('fotos' in x) throw new Error('column "fotos" does not exist'); const n = { id: 1, estado: 'abierta', publico: true, ...x }; filas2.push(n); return n; } };
  await recibirAlquiler({ rol: 'alquilar', publico: true, nombre: 'Ana', email: 'a@x.es', busca: 'Un 2CV', fotos: ['55/abcdefgh2.jpg'] }, '55', cfg, { alquiler: vieja, fetch: deps.fetch });
  assert.match(filas2[0].mensaje, /Fotos: 55\/abcdefgh2\.jpg/);
  assert.match((await peticionesPublicas(cfg, { alquiler: vieja }))[0].fotos[0], /abcdefgh2\.jpg$/);
});
