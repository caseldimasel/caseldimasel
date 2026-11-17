import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../lib/motor.mjs';
import { atenderPanel } from '../lib/circulo.mjs';
import { cuotasAlMes, GASTOS_INICIALES, leerGasto, porMesGastos, prevision } from '../lib/gastos.mjs';

const HOY = new Date('2026-11-17T12:00:00Z');
const suma = (l) => Math.round(l.reduce((s, g) => s + g.importe, 0) * 100) / 100;

test('gastos de partida: los cargos de ManyChat y Shopify suman lo mismo que el extracto', () => {
  assert.equal(suma(GASTOS_INICIALES.filter((g) => g.tipo === 'cargo' && g.concepto === 'ManyChat')), 1015.39);
  assert.equal(suma(GASTOS_INICIALES.filter((g) => g.tipo === 'cargo' && g.concepto === 'Shopify')), 444.98);
  assert.equal(Math.round(cuotasAlMes(GASTOS_INICIALES, HOY) * 100) / 100, Math.round((9.68 + 9.99 + 12 + 22.99 + 22 + 2.99 + 2.99 + 16.99 + 49.5 + 130 + 88.56 + 48.4) * 100) / 100);
  assert.equal(suma(GASTOS_INICIALES.filter((g) => g.concepto.startsWith('Abogado'))), 850);
});

test('gastos mes a mes: los cargos reales mandan; si no hay, la cuota', () => {
  const r = porMesGastos(GASTOS_INICIALES, HOY);
  assert.equal(r.meses[0], '2025-06'); assert.equal(r.meses.at(-1), '2026-11'); assert.equal(r.meses.length, 18);
  // Junio de 2025: solo las suscripciones (ni Shopify ni ManyChat aún)
  assert.equal(r.total['2025-06'], 99.63);
  assert.equal(r.celdas['2025-06'].ManyChat, undefined); assert.equal(r.celdas['2025-06'].Shopify, undefined);
  // Agosto de 2026: ManyChat real (130,65 + 15,63 + 17,85) y Shopify real (49,61), no sus cuotas
  assert.deepEqual(r.celdas['2026-08'].ManyChat, { importe: 164.13, real: true, variable: false });
  assert.equal(r.celdas['2026-08'].Shopify.importe, 49.61);
  assert.equal(r.celdas['2026-08']['Cuota de autónomo'].importe, 88.56); assert.equal(r.celdas['2026-08'].Gestoría.importe, 48.4);
  assert.equal(r.celdas['2026-05'].Gestoría.importe, 104.8, 'el alta de la gestoría');
  assert.equal(r.total['2026-08'], Math.round((99.63 + 164.13 + 49.61 + 88.56 + 48.4) * 100) / 100);
  // Una cuota dada de baja deja de contar
  const baja = porMesGastos([{ tipo: 'cuota', concepto: 'X', categoria: 'Apps', importe: 10, fecha: '2026-01-01', hasta: '2026-03-31' }], HOY);
  assert.equal(baja.total['2026-03'], 10); assert.equal(baja.total['2026-04'], undefined);
});

test('gastos: el formulario', () => {
  assert.deepEqual(leerGasto({ tipo: 'cargo', concepto: ' Gasolina ', categoria: 'Transporte', importe: '1.234,56', fecha: '2026-11-10' }).gasto,
    { tipo: 'cargo', concepto: 'Gasolina', categoria: 'Transporte', importe: 1234.56, fecha: '2026-11-10', hasta: null, variable: false, notas: '' });
  assert.equal(leerGasto({ tipo: 'cargo', concepto: 'XY', importe: '9,68', fecha: '2026-11-10' }).gasto.importe, 9.68);
  assert.match(leerGasto({ concepto: 'XY', importe: 'abc', fecha: '2026-11-10' }).error, /número/);
  assert.match(leerGasto({ tipo: 'cuota', concepto: 'XY', importe: '5', fecha: '2026-11-10', hasta: '2026-01-01' }).error, /antes/);
});

test('panel › Gastos: cargar los de partida, añadir, cambiar, borrar, CSV y Por meses con el resultado', async () => {
  const cfg = config({ ADMIN_CLAVE: 'panel' });
  const auth = { authorization: 'Basic ' + Buffer.from('equipo:panel').toString('base64') };
  let id = 1;
  const filas = [];
  const gastos = { leer: async () => filas, guardar: async (x) => { const n = { id: id++, ...x }; filas.push(n); return n; }, cambiar: async (i, c) => Object.assign(filas.find((x) => x.id === i), c),
    borrar: async (q) => { const i = filas.findIndex((x) => `id=eq.${x.id}` === q); if (i >= 0) filas.splice(i, 1); } };
  const deps = { gastos, operaciones: { leer: async () => [] }, pagos: { leer: async () => [] }, tabla: { leer: async () => [] } };
  const pag = async (query, method = 'GET', body = {}) => (await atenderPanel({ method, query, body, headers: auth }, cfg, deps));
  assert.match((await pag({ estado: 'gastos' })).body, /Cargar los gastos de partida/);
  // Si ya cargaron los de antes, solo se añaden los nuevos
  await gastos.guardar({ ...GASTOS_INICIALES[0], hasta: null, variable: false });
  assert.match((await pag({ estado: 'gastos' })).body, new RegExp(`Añadir los ${GASTOS_INICIALES.length - 1} que faltan`));
  assert.match((await pag({ estado: 'gastos' }, 'POST', { accion: 'iniciales' })).body, new RegExp(`Añadidos ${GASTOS_INICIALES.length - 1} gastos de partida`));
  assert.equal(filas.length, GASTOS_INICIALES.length);
  assert.match((await pag({ estado: 'gastos' }, 'POST', { accion: 'iniciales' })).body, /Ya estaban todos/);
  assert.match((await pag({ estado: 'gastos' })).body, /Lo que viene/);
  const h = (await pag({ estado: 'gastos' })).body;
  assert.match(h, /ManyChat/); assert.match(h, /Squarespace/); assert.match(h, /Cuotas de cada mes/);
  assert.match((await pag({ estado: 'gastos' }, 'POST', { accion: 'guardar', tipo: 'cargo', concepto: 'Gasolina', categoria: 'Transporte', importe: '60', fecha: '2026-11-15' })).body, /Añadido: Gasolina, 60,00 €/);
  const gas = filas.find((x) => x.concepto === 'Gasolina');
  await pag({ estado: 'gastos' }, 'POST', { accion: 'guardar', id: String(gas.id), tipo: 'cargo', concepto: 'Gasolina', categoria: 'Transporte', importe: '65', fecha: '2026-11-15' });
  assert.equal(gas.importe, 65);
  assert.match((await pag({ estado: 'gastos', editar: String(gas.id) })).body, /Cambiar «Gasolina»/);
  await pag({ estado: 'gastos' }, 'POST', { accion: 'borrar', id: String(gas.id) });
  assert.ok(!filas.some((x) => x.concepto === 'Gasolina'));
  const csv = await pag({ estado: 'gastos', csv: '1' });
  assert.match(csv.headers['Content-Type'], /text\/csv/); assert.match(csv.body, /2026-08;ManyChat;Marketing;164,13;cargo real/);
  const meses = (await pag({ estado: 'meses', ano: '2026' })).body;
  assert.match(meses, /<th>Gastos<\/th><th>IRPF \(reserva\)<\/th><th>Resultado<\/th>/); assert.match(meses, /Gastos 2026/);
});

test('gastos: la comisión del comercial y la reserva de IRPF (20 % del beneficio, o lo pagado en el trimestre)', () => {
  const g = [{ tipo: 'cuota', concepto: 'Canva', categoria: 'Apps', importe: 100, fecha: '2026-01-01' }];
  const ops = [{ estado: 'vendido', fecha_venta: '2026-02-10', comision: 3000, comision_comercial: 600, comercial: 'Hugo' }];
  const r = porMesGastos(g, HOY, { ops, pagos: [{ fecha: '2026-02-20', importe: 100 }] });
  assert.deepEqual(r.celdas['2026-02']['Comisión de Hugo'], { importe: 600, real: true, variable: false });
  assert.equal(r.beneficio['2026-02'], 3100 - 700); assert.equal(r.irpf['2026-02'], 480);
  assert.equal(r.irpf['2026-01'], undefined, 'sin beneficio, sin IRPF');
  assert.equal(r.resto['2026-02'], 100, 'Por meses: el comercial y el IRPF van aparte');
  // Pagado el IRPF del trimestre: cuenta lo pagado, no la reserva
  const r2 = porMesGastos([...g, { tipo: 'cargo', concepto: 'IRPF modelo 130', categoria: 'Impuestos', importe: 300, fecha: '2026-04-20' }], HOY, { ops });
  assert.equal(r2.irpf['2026-02'], 460, 'el primer trimestre aún sin pagar');
  const r3 = porMesGastos([...g, { tipo: 'cargo', concepto: 'IRPF modelo 130', categoria: 'Impuestos', importe: 300, fecha: '2026-03-20' }], HOY, { ops });
  assert.equal(r3.irpf['2026-02'], undefined); assert.equal(r3.celdas['2026-03']['IRPF modelo 130'].importe, 300);
});

test('gastos: lo que viene (en enero sube el autónomo)', () => {
  const p = prevision(GASTOS_INICIALES, HOY);
  assert.equal(p[0].mes, '2026-12'); assert.equal(p[1].mes, '2027-01');
  assert.equal(Math.round((p[1].importe - p[0].importe) * 100) / 100, Math.round((310 - 88.56) * 100) / 100);
  assert.deepEqual(p[1].empiezan.map((g) => g.concepto), ['Cuota de autónomo']); assert.deepEqual(p[1].acaban.map((g) => g.importe), [88.56]);
});
