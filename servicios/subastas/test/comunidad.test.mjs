import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../lib/motor.mjs';
import { atenderPanel } from '../lib/circulo.mjs';
import { altaComunidad, anunciantes, estadoCobro, leerFormTarifa, limpiarTarifa, metricas, precioMes, sumarMeses, TARIFA_BASE } from '../lib/comunidad.mjs';

const DIA = 864e5;
const AHORA = Date.parse('2026-10-26T10:00:00Z');

function tablaFalsa(filas = []) {
  let sig = 100;
  const filtra = (q) => {
    let l = [...filas];
    for (const [, k, v] of q.matchAll(/(?:^|&)(id|cliente|anuncio|clave)=eq\.([^&]+)/g)) l = l.filter((o) => String(o[k]) === decodeURIComponent(v));
    const est = q.match(/estado=in\.\(([^)]+)\)/);
    if (est) l = l.filter((o) => est[1].split(',').includes(o.estado));
    return l;
  };
  return {
    filas,
    async leer(q) { return filtra(q); },
    async cambiar(id, c) { Object.assign(filas.find((o) => o.id === id), c); },
    async guardar(x, clave) { const ya = clave !== 'id' && filas.find((o) => o[clave] === x[clave]); if (ya) Object.assign(ya, x); else filas.push({ id: sig++, ...x }); return x; },
    async borrar(q) { for (const o of filtra(q)) filas.splice(filas.indexOf(o), 1); }
  };
}

test('tarifa: tramos, precio por anuncio según cuántos tiene, meses', () => {
  assert.deepEqual([1, 2, 3, 4, 9, 10, 30].map((k) => precioMes(TARIFA_BASE, k)), [14.9, 12.9, 12.9, 9.9, 9.9, 7.9, 7.9]);
  const t = limpiarTarifa({ tramos: [{ desde: 3, precio: '5,5' }, { desde: 0, precio: 10 }], meses_gratis: 2, aviso: 99 });
  assert.deepEqual(t, { tramos: [{ desde: 1, precio: 10 }, { desde: 3, precio: 5.5 }], meses_gratis: 2, aviso: 30 });
  assert.deepEqual(leerFormTarifa({ desde_0: '1', precio_0: '20', desde_1: '5', precio_1: '15', desde_2: '', precio_2: '', meses_gratis: '0', aviso: '5' }), { tramos: [{ desde: 1, precio: 20 }, { desde: 5, precio: 15 }], meses_gratis: 0, aviso: 5 });
  assert.equal(sumarMeses('2026-01-31T10:00:00Z', 1).toISOString().slice(0, 10), '2026-02-28');
});

test('cómo va cada anuncio y cada anunciante, y lo que entra', () => {
  const a = (id, cliente, caduca, extra = {}) => ({ id, cliente, estado: 'publicado', titulo: `A${id}`, vendedor_nombre: cliente, email: `${cliente}@x.es`, creado: '2026-09-01T00:00:00Z', caduca, gratis: false, ...extra });
  const ancho = (d) => new Date(AHORA + d * DIA).toISOString();
  assert.equal(estadoCobro(a(1, 'x', null), AHORA), 'por_cobrar');
  assert.equal(estadoCobro(a(1, 'x', ancho(-1)), AHORA), 'caducado');
  assert.equal(estadoCobro(a(1, 'x', ancho(3)), AHORA), 'pronto');
  assert.equal(estadoCobro(a(1, 'x', ancho(20), { gratis: true }), AHORA), 'gratis');
  assert.equal(estadoCobro(a(1, 'x', ancho(20)), AHORA), 'al_dia');
  assert.equal(estadoCobro(a(1, 'x', null, { estado: 'vendido' }), AHORA), 'inactivo');
  const anuncios = [a(1, 'ana', ancho(20), { gratis: true }), a(2, 'beto', ancho(20)), a(3, 'beto', null), a(4, 'carla', ancho(-2)), a(5, 'carla', null, { estado: 'vendido' })];
  const pagos = [{ id: 1, cliente: 'ana', anuncio: 1, concepto: 'gratis', importe: 0, fecha: '2026-10-01' }, { id: 2, cliente: 'beto', anuncio: 2, concepto: 'alta', importe: 12.9, fecha: '2026-10-10' },
    { id: 3, cliente: 'carla', anuncio: 4, concepto: 'alta', importe: 14.9, fecha: '2026-09-05' }, { id: 4, cliente: 'beto', anuncio: 2, concepto: 'renovacion', importe: 12.9, fecha: '2026-09-10' }];
  const l = anunciantes(anuncios, pagos, TARIFA_BASE, AHORA);
  assert.deepEqual(l.map((x) => [x.cliente, x.estado, x.activos, x.precio_mes, x.gastado]), [['beto', 'por_cobrar', 2, 12.9, 25.8], ['carla', 'caducado', 1, 14.9, 14.9], ['ana', 'gratis', 1, 14.9, 0]]);
  const m = metricas(l, pagos, AHORA);
  assert.equal(m.este_mes, 12.9);
  assert.equal(Math.round(m.mes_anterior * 100) / 100, 27.8);
  assert.equal(m.por_cobrar.length, 2, 'el de beto sin pagar y el caducado de carla');
  assert.equal(Math.round(m.mensual * 100) / 100, 40.7, 'los de pago (sin el mes gratis de ana)');
  assert.deepEqual([m.anunciantes, m.pagadores, m.gratis], [3, 2, 1]);
});

test('al publicar: el primero gratis un mes, el segundo por cobrar', async () => {
  const cfg = config({ ADMIN_CLAVE: 'p' });
  const tabla = tablaFalsa([{ id: 1, cliente: 'ana', estado: 'publicado', titulo: 'Porsche', vendedor_nombre: 'Ana' }, { id: 2, cliente: 'ana', estado: 'publicado', titulo: 'Vespa', vendedor_nombre: 'Ana' }]);
  const pagos = tablaFalsa([]);
  const deps = { tabla, pagos, ajustes: tablaFalsa([]) };
  assert.match(await altaComunidad(cfg, deps, tabla.filas[0], AHORA), /primer anuncio: gratis hasta el 26\/11\/26/);
  assert.equal(tabla.filas[0].gratis, true);
  assert.equal(pagos.filas[0].concepto, 'gratis');
  assert.match(await altaComunidad(cfg, deps, tabla.filas[1], AHORA), /por cobrar \(12,90 € al mes\)/);
  assert.equal(tabla.filas[1].caduca, undefined);
});

test('panel › Cobros, cobrar, tarifa y Clientes › Anunciantes', async () => {
  const cfg = config({ ADMIN_CLAVE: 'p', TIENDA_URL: 'https://sidonia.es' });
  const auth = { authorization: 'Basic ' + Buffer.from('a:p').toString('base64') };
  const tabla = tablaFalsa([{ id: 7, cliente: '55', estado: 'publicado', titulo: 'SEAT 600', vendedor_nombre: 'Luis', vendedor_tipo: 'particular', email: 'luis@x.es', telefono: '+34600111222', fotos: [], producto: 'seat-600', creado: '2026-09-01T00:00:00Z', caduca: null, gratis: false }]);
  const pagos = tablaFalsa([]);
  const ajustes = tablaFalsa([]);
  const deps = { db: async () => [], tabla, pagos, ajustes };
  const c = await atenderPanel({ method: 'GET', query: { estado: 'cobros' }, headers: auth }, cfg, deps);
  assert.match(c.body, /<title>Cobros de la comunidad/);
  assert.match(c.body, /class="on">Cobros comunidad/);
  assert.match(c.body, /Por cobrar<\/span>/);
  const ok = await atenderPanel({ method: 'POST', query: { estado: 'cobrar', id: '7' }, body: { accion: 'cobrar', meses: '3', importe: '44,7', metodo: 'bizum', fecha: '2026-10-26' }, headers: auth }, cfg, deps);
  assert.match(ok.body, /Apuntado: 44,70 € · 3 meses/);
  assert.equal(pagos.filas.length, 1);
  assert.equal(pagos.filas[0].metodo, 'bizum');
  assert.ok(Date.parse(tabla.filas[0].caduca) > Date.now() + 80 * DIA);
  const an = await atenderPanel({ method: 'GET', query: { estado: 'anunciantes' }, headers: auth }, cfg, deps);
  assert.match(an.body, /class="on">Anunciantes · comunidad/);
  assert.match(an.body, /Luis/);
  const uno = await atenderPanel({ method: 'GET', query: { estado: 'anunciante', id: '55' }, headers: auth }, cfg, deps);
  assert.match(uno.body, /Lleva gastado<\/span><b>44,70 €/);
  assert.match(uno.body, /Bizum/);
  // Borrar el pago: vuelve a estar por cobrar
  await atenderPanel({ method: 'POST', query: { estado: 'cobrar', id: '7' }, body: { accion: 'borrar_pago', pago: String(pagos.filas[0].id) }, headers: auth }, cfg, deps);
  assert.equal(pagos.filas.length, 0);
  assert.equal(tabla.filas[0].caduca, null);
  // La tarifa
  const t = await atenderPanel({ method: 'POST', query: { estado: 'tarifa' }, body: { accion: 'guardar', desde_0: '1', precio_0: '19,9', desde_1: '3', precio_1: '9', meses_gratis: '1', aviso: '7' }, headers: auth }, cfg, deps);
  assert.match(t.body, /Tarifa guardada/);
  assert.deepEqual(ajustes.filas[0].valor.tramos, [{ desde: 1, precio: 19.9 }, { desde: 3, precio: 9 }]);
  assert.match((await atenderPanel({ method: 'GET', query: { estado: 'cobros' }, headers: auth }, cfg, deps)).body, /1–2 anuncios: <b>19,90 €/);
});
