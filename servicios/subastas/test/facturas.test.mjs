import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../lib/motor.mjs';
import { atenderPanel } from '../lib/circulo.mjs';
import { emparejarFacturas, FACTURAS_INICIALES, hacienda, leerFactura } from '../lib/facturas.mjs';
import { GASTOS_INICIALES, porMesGastos } from '../lib/gastos.mjs';

const r2 = (x) => Math.round(x * 100) / 100;

test('facturas de partida: las 20, y base + IVA = total en cada una', () => {
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
  assert.equal(r.ingresos['2026-02'], 2125 + 250 + 250 + 2065 + 3816, 'las facturas sin venta son ingresos');
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
  assert.match(await pag({ estado: 'facturas' }), /Cargar las 20 facturas/);
  assert.match(await pag({ estado: 'facturas' }, 'POST', { accion: 'iniciales' }), /Cargadas 20 facturas; 1 enlazadas con su venta/);
  assert.equal(facturas.filas.find((f) => f.numero === '2026-011').operacion_id, 900);
  const h = await pag({ estado: 'facturas' });
  assert.match(h, /Hacienda, trimestre a trimestre/); assert.match(h, /9924,85 €|9\.924,85 €/); assert.match(h, /Ventas con factura<\/span><b>1 de 1/);
  assert.match(await pag({ estado: 'ventas' }), /factura 2026-011/);
  const meses = await pag({ estado: 'meses', ano: '2026' });
  assert.match(meses, /<th>Otros servicios<\/th>/);
  assert.match((await atenderPanel({ method: 'GET', query: { estado: 'facturas', csv: '1' }, body: {}, headers: auth }, cfg, deps)).body, /2026-011;2026-04-15;Eduardo Luis Álvarez Aznar;50888936X;Gestión de Venta Cadillac 0694 KLX;3300,00;693,00;3993,00;2026-T2;900;CADILLAC ELDORADO 1976/);
});
