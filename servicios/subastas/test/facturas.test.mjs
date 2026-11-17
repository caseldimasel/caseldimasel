import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../lib/motor.mjs';
import { atenderPanel } from '../lib/circulo.mjs';
import { emparejarFacturas, hacienda, leerCsvFacturas, leerFactura } from '../lib/facturas.mjs';

// Facturas de prueba: los importes y fechas de 2026, con clientes inventados (los de verdad no van en el código)
const CSV = `numero;fecha;cliente;nif;concepto;base;iva;total
2026-001;2026-01-20;Cliente 1 S.L.;B00000000;Gestión de Venta Jaguar XJRS;1700.00;357.00;2057.00
2026-002;2026-01-29;Cliente 2 S.L.;B00000001;Gestión de Venta Jaguar XJ8;1045.00;219.45;1264.45
2026-003;2026-02-02;Cliente 3 S.L.;B00000002;Gestión redes sociales y publicidad;2125.00;446.25;2571.25
2026-004;2026-02-04;Cliente 4 S.L.;B00000003;Servicio de marketing;250.00;52.50;302.50
2026-005;2026-02-05;Cliente 5 S.L.;B00000004;Servicio de marketing;250.00;52.50;302.50
2026-006;2026-02-12;Cliente 6 S.L.;B00000005;Gestión redes sociales y publicidad;2065.00;433.65;2498.65
2026-007;2026-02-14;Cliente 7 S.L.;B00000006;Gestión de Venta Porsche 911;3816.00;801.36;4617.36
2026-008;2026-03-30;Cliente 8 S.L.;B00000007;Gestión de Venta Vehículo;704.00;147.84;851.84
2026-009;2026-03-30;Cliente 9 S.L.;B00000008;Servicio de marketing;466.16;97.89;564.05
2026-010;2026-04-11;Cliente 10 S.L.;B00000009;Gestión de Venta Vehículo;2625.00;551.25;3176.25
2026-011;2026-04-15;Cliente 11 S.L.;B00000000;Gestión de Venta Cadillac Eldorado;3300.00;693.00;3993.00
2026-012;2026-05-05;Cliente 12 S.L.;B00000001;Gestión de Venta Vehículo;6900.00;1449.00;8349.00
2026-013;2026-05-29;Cliente 13 S.L.;B00000002;Gestión de Venta Vehículo;2940.00;617.40;3557.40
2026-014;2026-07-01;Cliente 14 S.L.;B00000003;Servicio de marketing;1500.00;315.00;1815.00
2026-015;2026-07-02;Cliente 15 S.L.;B00000004;Gestión redes sociales y publicidad;3995.00;838.95;4833.95
2026-016;2026-07-03;Cliente 16 S.L.;B00000005;Gestión de Venta Vehículo;2080.00;436.80;2516.80
2026-017;2026-07-16;Cliente 17 S.L.;B00000006;Gestión de Venta Mercedes-Benz CLK 430;330.00;69.30;399.30
2026-018;2026-07-16;Cliente 18 S.L.;B00000007;Gestión de Venta Mercedes-Benz 500SL Mille Miglia;2100.00;441.00;2541.00
2026-019;2026-07-16;Cliente 19 S.L.;B00000008;Gestión de Venta Mercedes-Benz 280SEL;1200.00;252.00;1452.00
2026-020;2026-09-03;Cliente 20 S.L.;B00000009;Gestión de Venta Land Cruiser BJ40;1494.00;313.74;1807.74`;
const FACTURAS_INICIALES = leerCsvFacturas(CSV).facturas;
import { GASTOS_INICIALES, porMesGastos } from '../lib/gastos.mjs';

const r2 = (x) => Math.round(x * 100) / 100;

test('facturas: el CSV se lee entero, y base + IVA = total en cada una', () => {
  assert.equal(FACTURAS_INICIALES.length, 20);
  for (const f of FACTURAS_INICIALES) assert.equal(r2(f.base + f.iva), f.total, f.numero);
  assert.equal(r2(FACTURAS_INICIALES.reduce((s, f) => s + f.base, 0)), 40885.16);
});

test('Hacienda: el IVA de los gastos y los gastos declarados de cada trimestre, con lo pagado (303 y 130)', () => {
  const H = hacienda(FACTURAS_INICIALES, GASTOS_INICIALES);
  assert.deepEqual(H.map((x) => x.t), ['2026-T1', '2026-T2', '2026-T3']);
  assert.deepEqual(H.map((x) => x.base), [12421.16, 15765, 12699]);
  assert.deepEqual(H.map((x) => x.iva), [2608.44, 3310.65, 2666.79]);
  assert.deepEqual(H.map((x) => x.ivaGastos), [253.85, 307.69, 852.1]);
  assert.deepEqual(H.map((x) => x.rendimiento), [10556.85, 11021.25, 2774.15]);
  assert.deepEqual(H.map((x) => x.gastosDeclarados), [1864.31, 4743.75, 9924.85]);
});

test('Gastos: el IVA no cuenta como gasto y el IRPF pagado tapa la reserva de su trimestre', () => {
  const r = porMesGastos(GASTOS_INICIALES, new Date('2026-11-17T12:00:00Z'), { facturas: FACTURAS_INICIALES });
  assert.equal(r.iva['2026-10'], 1814.69); assert.equal(r.celdas['2026-10']['IVA (modelo 303)'], undefined);
  assert.equal(r.celdas['2026-10']['IRPF (modelo 130)'].importe, 554.83);
  assert.equal(r.irpf['2026-02'], undefined, 'el 1.er trimestre está pagado');
  assert.equal(r.ingresos['2026-02'], 2125 + 250 + 250 + 2065, 'las facturas de otros servicios son ingresos; las de una venta sin enlazar, no (su ingreso es la comisión de la venta)');
});

test('facturas: cada una de venta se enlaza con su venta (comisión, fecha y coche)', () => {
  const ops = [
    { id: 1, titulo: 'JAGUAR XJRS 1993', estado: 'vendido', comision: 1700, fecha_venta: '2026-01-18' },
    { id: 2, titulo: 'CADILLAC ELDORADO 1976', estado: 'vendido', comision: 3300, fecha_venta: '2026-04-10' },
    { id: 3, titulo: 'MERCEDES-BENZ CLK 430 AVANTGARDE 1998', estado: 'vendido', comision: 330, fecha_venta: '2026-07-15' },
    { id: 4, titulo: 'MERCEDES 500SL MILLE MIGLIA EDITION 1996', estado: 'vendido', comision: 2100, fecha_venta: '2026-07-10' },
    { id: 5, titulo: 'PORSCHE 911 1985', estado: 'vendido', comision: 900, fecha_venta: '2025-01-01' }
  ];
  const facturas = FACTURAS_INICIALES.map((f, i) => ({ ...f, id: i + 1 }));
  const p = emparejarFacturas(facturas, ops);
  assert.deepEqual(p.map((x) => [x.factura.numero, x.op.id]).sort(), [['2026-001', 1], ['2026-011', 2], ['2026-017', 3], ['2026-018', 4]]);
  assert.ok(!p.some((x) => x.factura.numero === '2026-003'), 'la de redes sociales no es de una venta');
});

test('facturas: el formulario', () => {
  const f = leerFactura({ numero: '2026-021', fecha: '2026-11-10', cliente: 'X', base: '1.500', iva_pct: '21', concepto: 'Gestión de Venta' }).factura;
  assert.deepEqual([f.base, f.iva, f.total], [1500, 315, 1815]);
  assert.match(leerFactura({ numero: '', fecha: '2026-11-10', base: '1' }).error, /número/);
});

test('panel › Facturas: cargar, enlazar, Hacienda y en Ventas la factura de cada venta', async () => {
  const cfg = config({ ADMIN_CLAVE: 'panel' });
  const auth = { authorization: 'Basic ' + Buffer.from('equipo:panel').toString('base64') };
  let id = 1;
  const tabla = (filas) => ({ filas, leer: async () => filas, guardar: async (x) => { const nn = { id: id++, ...x }; filas.push(nn); return nn; }, cambiar: async (i, c) => Object.assign(filas.find((x) => x.id === i), c),
    borrar: async (q) => { const i = filas.findIndex((x) => `id=eq.${x.id}` === q); if (i >= 0) filas.splice(i, 1); } });
  const ops = tabla([{ id: 900, titulo: 'CADILLAC ELDORADO 1976', estado: 'vendido', modalidad: 'gestion', comision: 3300, fecha_venta: '2026-04-10' }]);
  const gastos = tabla(GASTOS_INICIALES.map((g) => ({ id: id++, hasta: null, variable: false, ...g })));
  const facturas = tabla([]);
  const deps = { facturas, operaciones: ops, gastos, pagos: tabla([]), tabla: { leer: async () => [] } };
  const pag = async (query, method = 'GET', body = {}) => (await atenderPanel({ method, query, body, headers: auth }, cfg, deps)).body;
  assert.match(await pag({ estado: 'facturas' }), /Importar facturas \(CSV\)/);
  assert.match(await pag({ estado: 'facturas' }, 'POST', { accion: 'importar', csv: CSV }), /Importadas 20 facturas; 1 enlazadas con su venta/);
  assert.match(await pag({ estado: 'facturas' }, 'POST', { accion: 'importar', csv: CSV }), /Importadas 0 facturas \(20 ya estaban\)/);
  assert.equal(facturas.filas.find((f) => f.numero === '2026-011').operacion_id, 900);
  const h = await pag({ estado: 'facturas' });
  assert.match(h, /Hacienda, trimestre a trimestre/); assert.match(h, /9924,85 €|9\.924,85 €/); assert.match(h, /Ventas con factura<\/span><b>1 de 1/);
  assert.match(await pag({ estado: 'ventas' }), /factura 2026-011/);
  const meses = await pag({ estado: 'meses', ano: '2026' });
  assert.match(meses, /<th>Otros servicios<\/th>/);
  assert.match((await atenderPanel({ method: 'GET', query: { estado: 'facturas', csv: '1' }, body: {}, headers: auth }, cfg, deps)).body, /2026-011;2026-04-15;Cliente 11 S\.L\.;B00000000;Gestión de Venta Cadillac Eldorado;3300,00;693,00;3993,00;2026-T2;900;CADILLAC ELDORADO 1976/);
});

test('facturas: el CSV acepta fechas 20/01/2026, importes 1.700,00 y calcula el IVA si no viene', () => {
  const r = leerCsvFacturas('numero;fecha;cliente;base\n2026-030;20/01/2026;Ana;1.700,00\n;;;\n');
  assert.deepEqual(r.facturas, [{ numero: '2026-030', fecha: '2026-01-20', cliente: 'Ana', nif: '', concepto: '', base: 1700, iva: 357, total: 2057 }]);
  assert.equal(r.errores.length, 1);
  assert.match(leerCsvFacturas('a;b\n1;2').errores[0], /cabecera/);
});
