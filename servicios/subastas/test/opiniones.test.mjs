import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { atender, config } from '../lib/motor.mjs';
import { atenderPanel } from '../lib/circulo.mjs';
import { firma, leerOpinion } from '../lib/opiniones.mjs';

const cfg = config({ SUBASTAS_CLAVE: 'k', ADMIN_CLAVE: 'panel', TIENDA_URL: 'https://sidonia.es', SERVIDOR_URL: 'https://motor.test', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_KEY: 's' });
const auth = { authorization: 'Basic ' + Buffer.from('equipo:panel').toString('base64') };
const quien = (c = '55') => { const t = String(Math.floor(Date.now() / 1000)); return { c, ct: t, cf: createHmac('sha256', 'k').update(`${c}.${t}`).digest('hex') }; };

function memoria(filas = []) {
  let sig = 1;
  const cumple = (f, x) => f.split('&').every((p) => { const m = /^(\w+)=eq\.(.*)$/.exec(p); return !m || String(x[m[1]]) === decodeURIComponent(m[2]); });
  return {
    filas,
    leer: async (f) => { let l = filas.filter((x) => cumple(f, x)); if (/order=creado\.desc/.test(f)) l = [...l].reverse(); const lim = /limit=(\d+)/.exec(f); return lim ? l.slice(0, Number(lim[1])) : l; },
    cambiar: async (id, c) => { Object.assign(filas.find((x) => Number(x.id) === Number(id)), c); },
    borrar: async (f) => { for (let i = filas.length - 1; i >= 0; i -= 1) if (cumple(f, filas[i])) filas.splice(i, 1); },
    guardar: async (fila, k) => {
      const ks = k.split(',');
      const ya = filas.find((x) => ks.every((kk) => String(x[kk]) === String(fila[kk])));
      if (ya) { Object.assign(ya, fila); return ya; }
      const n = { id: sig++, visible: true, creado: new Date().toISOString(), ...fila }; filas.push(n); return n;
    }
  };
}
function preparar() {
  const deps = { db: async () => null, fetch: async () => ({ ok: true, json: async () => ({}) }), opiniones_pro: memoria(), perfiles: memoria([{ id: 1, cliente: '77', nombre: 'Lucía Martín' }]) };
  const api = (ruta, body, q = quien(), method = body ? 'POST' : 'GET') => atender({ method, ruta, query: { ...q, ...(method === 'GET' ? body || {} : {}) }, body: body || {}, directo: true, headers: {} }, cfg, deps).then((r) => JSON.parse(r.body));
  return { deps, api };
}

test('opiniones: comprueba nota, texto y profesional; firma con nombre e inicial', () => {
  assert.equal(leerOpinion({ pro: 'cochera', nota: 6, texto: 'Muy bien todo, de diez' }).campo, 'nota');
  assert.equal(leerOpinion({ pro: 'cochera', nota: 5, texto: 'Bien' }).campo, 'texto');
  assert.equal(leerOpinion({ pro: '', nota: 5, texto: 'Muy bien todo, de diez' }).campo, 'pro');
  assert.equal(leerOpinion({ pro: 'Talleres Gordillo!', nota: 4, texto: 'Muy bien todo, de diez' }).opinion.pro, 'tallerresgordillo'.replace('rr', 'r'));
  assert.equal(firma('Lucía Martín Pérez'), 'Lucía P.');
  assert.equal(firma(''), 'Miembro de Sidonia');
});

test('opiniones: sin sesión pide entrar; con sesión opina una vez (la cambia), se ve en público y en el resumen', async () => {
  const { deps, api } = preparar();
  assert.equal((await api('api/opiniones', { pro: 'cochera', nota: 5, texto: 'Me dejaron la Pagoda perfecta' }, {})).error, 'login');
  const a = await api('api/opiniones', { pro: 'cochera', nota: 5, texto: 'Me dejaron la Pagoda perfecta', servicio: 'Restauración', coche: 'Mercedes 280 SL' }, quien('77'));
  assert.equal(a.ok, true);
  assert.equal(a.opinion.nombre, 'Lucía M.', 'firma con su perfil');
  await api('api/opiniones', { pro: 'cochera', nota: 4, texto: 'Ahora le pongo un cuatro, muy bien', nombre: 'Pablo Gómez' }, quien('77'));
  await api('api/opiniones', { pro: 'cochera', nota: 3, texto: 'Bien, pero tardaron bastante', nombre: 'Ana Ruiz' }, quien('88'));
  assert.equal(deps.opiniones_pro.filas.length, 2, 'una por persona');
  const pub = await api('api/opiniones', { pro: 'cochera' }, {}, 'GET');
  assert.equal(pub.n, 2);
  assert.equal(pub.media, 3.5);
  assert.equal(pub.opiniones[0].nombre, 'Ana R.');
  assert.equal(pub.opiniones.some((o) => o.mia), false);
  const yo = await api('api/opiniones', { pro: 'cochera' }, quien('77'), 'GET');
  assert.equal(yo.mia.nota, 4);
  const res = await api('api/opiniones/resumen', null, {}, 'GET');
  assert.deepEqual(res.pros.cochera, { media: 3.5, n: 2 });
  // Borra la suya
  await api('api/opiniones/borrar', { pro: 'cochera' }, quien('77'));
  assert.equal((await api('api/opiniones', { pro: 'cochera' }, {}, 'GET')).n, 1);
});

test('opiniones: el panel las lista y «Ocultar» las quita de la web', async () => {
  const { deps, api } = preparar();
  await api('api/opiniones', { pro: 'tapizatop', nota: 5, texto: 'Los asientos quedaron de fábrica' }, quien('88'));
  const id = deps.opiniones_pro.filas[0].id;
  const r = await atenderPanel({ method: 'POST', query: { estado: 'opiniones' }, body: { accion: 'opinion', id: String(id), visible: '0' }, headers: auth }, cfg, deps);
  assert.match(r.body, /Los asientos quedaron de fábrica/);
  assert.match(r.body, /Mostrar/);
  assert.equal((await api('api/opiniones', { pro: 'tapizatop' }, {}, 'GET')).n, 0);
});
