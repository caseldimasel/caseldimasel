import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { atender, config } from '../lib/motor.mjs';
import { atenderPanel } from '../lib/circulo.mjs';
import { leerCoche } from '../lib/garaje.mjs';

const cfg = config({ SUBASTAS_CLAVE: 'k', ADMIN_CLAVE: 'panel', TIENDA_URL: 'https://sidonia.es', SERVIDOR_URL: 'https://motor.test', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 's' });
const auth = { authorization: 'Basic ' + Buffer.from('equipo:panel').toString('base64') };
const quien = (c = '55') => { const t = String(Math.floor(Date.now() / 1000)); return { c, ct: t, cf: createHmac('sha256', 'k').update(`${c}.${t}`).digest('hex') }; };

/** Una tabla en memoria que entiende los filtros que usa el garaje (eq, in, order, limit) */
function memoria(filas = [], clave = 'id') {
  let sig = filas.length + 1;
  const cumple = (f, x) => f.split('&').every((p) => {
    const m = /^(\w+)=(eq|in)\.(.*)$/.exec(p);
    if (!m) return true;
    const v = decodeURIComponent(m[3]);
    if (m[2] === 'eq') return String(x[m[1]]) === v;
    return v.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/"/g, '')).includes(String(x[m[1]]));
  });
  return {
    filas,
    leer: async (f) => { let l = filas.filter((x) => cumple(f, x)); const lim = /limit=(\d+)/.exec(f); if (/order=creado\.desc/.test(f)) l = [...l].reverse(); return lim ? l.slice(0, Number(lim[1])) : l; },
    cambiar: async (id, c) => { Object.assign(filas.find((x) => Number(x.id) === Number(id)), c); },
    borrar: async (f) => { for (let i = filas.length - 1; i >= 0; i -= 1) if (cumple(f, filas[i])) filas.splice(i, 1); },
    guardar: async (fila, k) => {
      const ks = (k || clave).split(',');
      const ya = filas.find((x) => ks.every((kk) => kk in fila && String(x[kk]) === String(fila[kk])));
      if (ya) { Object.assign(ya, fila); return ya; }
      const nueva = { ...(clave === 'id' && !fila.id ? { id: sig++ } : {}), creado: new Date().toISOString(), ...fila };
      filas.push(nueva); return nueva;
    }
  };
}

function preparar() {
  const deps = { db: async () => null, fetch: async () => ({ ok: true, json: async () => ({}) }), garaje: memoria(), garaje_likes: memoria([], 'coche,cliente'), perfiles: memoria([], 'cliente'), alquiler: memoria() };
  const api = (ruta, body, q = quien(), method = body ? 'POST' : 'GET') => atender({ method, ruta, query: { ...q, ...(method === 'GET' ? body || {} : {}) }, body: body || {}, directo: true, headers: {} }, cfg, deps).then((r) => JSON.parse(r.body));
  return { deps, api };
}
const coche = { tipo: 'coche', marca: 'MERCEDES-BENZ', modelo: '280 SL PAGODA', anio: 1970, apodo: 'La PAGODA', historia: 'Era de mi abuelo.', mods: 'Llantas originales restauradas', fotos: ['55/abcd1234.jpg', '99/ajenaaaa.jpg'] };

test('garaje: comprueba el coche (marca, modelo y al menos una foto suya)', () => {
  assert.equal(leerCoche({ ...coche, marca: '' }, '55').campo, 'marca');
  assert.equal(leerCoche({ ...coche, fotos: ['99/ajenaaaa.jpg'] }, '55').campo, 'fotos');
  const v = leerCoche(coche, '55');
  assert.deepEqual(v.coche.fotos, ['55/abcd1234.jpg'], 'solo sus fotos');
  assert.equal(leerCoche({ ...coche, anio: 3000 }, '55').coche.anio, null);
});

test('garaje: añade su coche (con su perfil y dirección pública), lo ve en público y la comunidad le da «me gusta»', async () => {
  const { deps, api } = preparar();
  const r = await api('api/garaje', { ...coche, nombre: 'Lucía' });
  assert.equal(r.ok, true);
  assert.match(r.slug, /^lucia-[0-9a-f]{4}$/);
  assert.equal(r.coche.titulo, 'MERCEDES-BENZ 280 SL PAGODA 1970');
  assert.match(r.coche.fotos[0], /\/storage\/v1\/object\/public\/anuncios\/55\/abcd1234\.jpg$/);
  // Su garaje público (sin sesión)
  const pub = await api('api/garaje/publico', { slug: r.slug }, {}, 'GET');
  assert.equal(pub.perfil.nombre, 'Lucía');
  assert.equal(pub.coches.length, 1);
  assert.equal(pub.coches[0].apodo, 'La PAGODA');
  // Otra persona le da «me gusta»; el dueño no se lo puede dar a sí mismo
  const id = pub.coches[0].id;
  assert.deepEqual(await api('api/garaje/like', { id, on: true }, quien('77')), { ok: true, likes: 1, liked: true });
  assert.equal((await api('api/garaje/like', { id, on: true })).likes, 1);
  const visto = await api('api/garaje/publico', { slug: r.slug }, quien('77'), 'GET');
  assert.equal(visto.coches[0].liked, true);
  assert.equal(visto.coches[0].likes, 1);
  // En «Garajes» de la comunidad, con su dueño
  const rec = await api('api/garaje/recientes', null, {}, 'GET');
  assert.equal(rec.coches[0].dueno.nombre, 'Lucía');
  // Oculto: ya no se ve en público, pero sí en el suyo
  await api('api/garaje', { ...coche, id, visible: false });
  assert.equal((await api('api/garaje/publico', { slug: r.slug }, {}, 'GET')).coches.length, 0);
  assert.equal((await api('api/garaje')).coches[0].visible, false);
  // Borrarlo
  assert.equal((await api('api/garaje/borrar', { id })).ok, true);
  assert.equal(deps.garaje.filas.length, 0);
});

test('garaje: «Lo alquilaría» lo apunta en la lista de espera del alquiler (una vez)', async () => {
  const { deps, api } = preparar();
  const r = await api('api/garaje', { ...coche, alquiler: true, alquiler_como: 'con', nombre: 'Lucía', email: 'lucia@x.es' });
  assert.equal(deps.alquiler.filas.length, 1);
  assert.equal(deps.alquiler.filas[0].rol, 'poner');
  assert.equal(deps.alquiler.filas[0].coche, 'MERCEDES-BENZ 280 SL PAGODA 1970');
  assert.equal(deps.alquiler.filas[0].conductor, 'con');
  await api('api/garaje', { ...coche, id: r.coche.id, alquiler: true, historia: 'Otra' });
  assert.equal(deps.alquiler.filas.length, 1, 'no se repite');
});

test('garaje: sin sesión no se añade nada', async () => {
  const { api } = preparar();
  assert.deepEqual(await api('api/garaje', coche, {}), { ok: false, error: 'login' });
});

test('panel › Clientes › Garajes: los coches, quién los alquilaría y qué quiere recibir la comunidad', async () => {
  const { deps, api } = preparar();
  await api('api/garaje', { ...coche, alquiler: true, nombre: 'Lucía' });
  deps.perfiles.filas[0].avisos = { eventos: true, tienda: true, coches: false };
  const h = (await atenderPanel({ method: 'GET', query: { estado: 'garajes' }, body: {}, headers: auth }, cfg, deps)).body;
  assert.match(h, /MERCEDES-BENZ 280 SL PAGODA 1970/);
  assert.match(h, /«La PAGODA»/);
  assert.match(h, /Los alquilarían<\/span><b>1<\/b>/);
  assert.match(h, /Quieren eventos<\/span><b>1<\/b>/);
  assert.match(h, /view=garaje&u=lucia-/);
});

test('calendario: periodos bloqueados con su nota (solo para el dueño), días seguidos juntos y hasta 3 años', async () => {
  const { leerBloqueos, bloqueosPublicos } = await import('../lib/garaje.mjs');
  const l = leerBloqueos([['2027-06-03', '2027-06-03'], ['2027-06-01', '2027-06-02'], ['2027-07-10', '2027-07-01', 'Viaje'], ['2099-01-01', '2099-01-02'], ['malo']]);
  assert.deepEqual(l, [['2027-06-01', '2027-06-03', ''], ['2027-07-01', '2027-07-10', 'Viaje']]);
  assert.deepEqual(bloqueosPublicos(l), [['2027-06-01', '2027-06-03'], ['2027-07-01', '2027-07-10']], 'sin la nota');
});
