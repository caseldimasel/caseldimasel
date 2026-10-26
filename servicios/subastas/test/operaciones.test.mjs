import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from '../lib/motor.mjs';
import { atenderPanel } from '../lib/circulo.mjs';
import { leerXlsx } from '../lib/xlsx.mjs';
import { csvOperaciones, detectarOperaciones, emparejar, importar, leerOperacion, marcaDe, numero, parecido, propietarios, resumen, tipoDe } from '../lib/operaciones.mjs';

/** Un .xlsx de verdad (zip con deflate), hecho a mano: una hoja con una tabla y un encargo, y otra oculta */
function xlsx() {
  const ficheros = {
    'xl/workbook.xml': '<workbook><sheets><sheet name="Coches" sheetId="1" r:id="rId1"/><sheet name="Colección Arturo" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>COCHES/MODELO</t></si><si><t>PRECIO VENDIDO</t></si><si><t>COMISIÓN SIDONIA</t></si><si><t>COMISIÓN COMERCIAL</t></si><si><t>VENTA</t></si><si><t>PORSCHE 986 2.5</t></si><si><t>VENDIDO</t></si><si><r><t>JAGUAR </t></r><r><t>XJ6 &amp; Co</t></r></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="3"><c r="A3" t="s"><v>0</v></c><c r="B3" t="s"><v>1</v></c><c r="C3" t="s"><v>2</v></c><c r="D3" t="s"><v>3</v></c><c r="E3" t="s"><v>4</v></c></row>'
      + '<row r="4"><c r="A4" t="s"><v>5</v></c><c r="B4"><v>16500</v></c><c r="C4"><f>B4*0.05</f><v>825.0000000001</v></c><c r="D4"><v>0</v></c><c r="E4" t="s"><v>6</v></c></row>'
      + '<row r="5"><c r="A5" t="s"><v>7</v></c><c r="B5"><v>8500</v></c><c r="C5"><v>850</v></c><c r="D5"><v>212.5</v></c><c r="E5"/></row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="5"><c r="B5" t="inlineStr"><is><t>Coche</t></is></c><c r="C5" t="inlineStr"><is><t>Precio Venta Propuesto</t></is></c><c r="D5" t="inlineStr"><is><t>Est. Óptima</t></is></c></row>'
      + '<row r="6"><c r="B6" t="inlineStr"><is><t>Jensen Interceptor III (1974)</t></is></c><c r="C6" t="inlineStr"><is><t>45.000 €</t></is></c><c r="D6" t="inlineStr"><is><t>&gt;70.000 €</t></is></c></row></sheetData></worksheet>'
  };
  const locales = [], centrales = [];
  let off = 0;
  for (const [nombre, texto] of Object.entries(ficheros)) {
    const datos = deflateRawSync(Buffer.from(texto));
    const n = Buffer.from(nombre);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(8, 8); l.writeUInt32LE(datos.length, 18); l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(datos.length, 20); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    locales.push(l, n, datos); centrales.push(c, n);
    off += 30 + n.length + datos.length;
  }
  const central = Buffer.concat(centrales);
  const fin = Buffer.alloc(22); fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(Object.keys(ficheros).length, 10); fin.writeUInt32LE(central.length, 12); fin.writeUInt32LE(off, 16);
  return Buffer.concat([...locales, central, fin]);
}

test('xlsx: lee las hojas (también las ocultas), textos compartidos y números calculados', () => {
  const libro = leerXlsx(xlsx());
  assert.deepEqual(libro.map((h) => [h.nombre, h.oculta]), [['Coches', false], ['Colección Arturo', true]]);
  assert.deepEqual(libro[0].filas[3], ['PORSCHE 986 2.5', 16500, 825.0000000001, 0, 'VENDIDO']);
  assert.equal(libro[0].filas[4][0], 'JAGUAR XJ6 & Co');
  assert.equal(libro[1].filas[5][3], '>70.000 €');
});

test('excel → ventas: vendidos, en venta, comisiones, encargos y la colección de alguien en captación', () => {
  const ops = detectarOperaciones(leerXlsx(xlsx()));
  assert.equal(ops.length, 3);
  assert.deepEqual([ops[0].titulo, ops[0].estado, ops[0].precio_venta, ops[0].comision, ops[0].comision_comercial], ['PORSCHE 986 2.5', 'vendido', 16500, 825, null]);
  assert.deepEqual([ops[1].estado, ops[1].precio_anunciado, ops[1].comision_comercial], ['en_venta', 8500, 212.5]);
  assert.deepEqual([ops[2].estado, ops[2].propietario_nombre, ops[2].precio_anunciado, ops[2].notas], ['captacion', 'Arturo', 45000, 'Est. Óptima: >70.000 €']);
  // Encargos: la tabla de debajo de «Encargos…»
  const enc = detectarOperaciones([{ nombre: 'Coches', filas: [[], ['Encargos EXOTICA!'], ['COCHES/MODELO', 'PRECIO VENDIDO', 'COMISIÓN SIDONIA', 'COMISIÓN COMERCIAL', 'VENTA'], ['ENACRGO MARIO', 28000, 1400, 280, 'VENDIDO'], ['ENCARGOS QUIQUE 2', 20000, 400, 80, 'VENDIDO'], ['', 0, 0]] }]);
  assert.deepEqual(enc.map((o) => [o.titulo, o.modalidad, o.comprador_nombre]), [['Encargo · Mario', 'encargo', 'Mario'], ['Encargo · Quique 2', 'encargo', 'Quique']]);
  // Dos coches con el mismo título son dos ventas distintas
  const dobles = detectarOperaciones([{ nombre: 'C', filas: [['MODELO', 'PRECIO'], ['LAND ROVER 88 SUPER ', 20000], ['LAND ROVER 88 SUPER', 25000]] }]);
  assert.notEqual(dobles[0].ref, dobles[1].ref);
});

test('pequeñas cosas: números, tipo, marca y parecido de títulos', () => {
  assert.deepEqual(['45.000 €', '1.234,5', 30000, '12,5', '', 'abc'].map(numero), [45000, 1234.5, 30000, 12.5, null, null]);
  assert.deepEqual(['YAMAHA TZR 250 3MA RSE 1989', 'PORSCHE 911', 'Riva Aquarama'].map(tipoDe), ['moto', 'coche', 'barco']);
  assert.deepEqual(['LAND ROVER DEFENDER 90', 'MERCEDES-BENZ 280', 'range rover classic'].map(marcaDe), ['Land Rover', 'Mercedes', 'Range Rover']);
  assert.equal(parecido('PORSCHE 911 CARRERA 4S 997.1 2007', 'PORSCHE 911 CARRERA 4S 997.1 2007'), 1);
  assert.equal(parecido('JAGUAR XJS 1994', 'JAGUAR XJS V12 6.0 CONVERTIBLE 1994'), 1);
  assert.equal(parecido('JAGUAR XJS 1994', 'JAGUAR XJS 1991'), 0, 'otro año, otro coche');
});

test('enlazar con la tienda: la ficha que más se parece, sin repetir, y la fecha en que se anunció', () => {
  const ops = [{ id: 1, titulo: 'PORSCHE 924 1984', tipo: 'coche' }, { id: 2, titulo: 'YAMAHA TZR 250 1989', tipo: 'moto' }, { id: 3, titulo: 'Encargo · Paco', modalidad: 'encargo' }, { id: 4, titulo: 'PORSCHE 924 1984', handle: 'ya-tiene' }];
  const productos = [{ handle: 'porsche-924', title: 'PORSCHE 924 1984', productType: 'Coches', createdAt: '2026-03-02T10:00:00Z', precio: { minVariantPrice: { amount: '23000.0' } } },
    { handle: 'yamaha', title: 'YAMAHA TZR 250 3MA RSE 1989', productType: 'Motos', createdAt: '2026-05-01T10:00:00Z' }, { handle: 'ya-tiene', title: 'PORSCHE 924 1984' }];
  const r = emparejar(ops, productos);
  assert.deepEqual(r.map((x) => [x.id, x.cambios]).sort((a, b) => a[0] - b[0]), [[1, { handle: 'porsche-924', fecha_alta: '2026-03-02', precio_anunciado: 23000 }], [2, { handle: 'yamaha', fecha_alta: '2026-05-01' }]]);
});

const OPS = [
  { id: 1, titulo: 'PORSCHE 911 1986', estado: 'vendido', modalidad: 'gestion', precio_anunciado: 80000, precio_venta: 76000, comision: 4560, comision_comercial: 1140, comercial: 'Quique', fecha_alta: '2026-01-01', fecha_venta: '2026-03-02', propietario_nombre: 'Carlos', propietario_telefono: '+34 600 111 222' },
  { id: 2, titulo: 'Encargo · Paco', estado: 'vendido', modalidad: 'encargo', precio_venta: 40000, comision: 2000, comision_comercial: 400 },
  { id: 3, titulo: 'BMW 2002 1973', estado: 'en_venta', modalidad: 'gestion', precio_anunciado: 49000, comision: 2940, propietario_nombre: 'Carlos', propietario_telefono: '600111222' },
  { id: 4, titulo: 'Jensen Interceptor', estado: 'captacion', modalidad: 'gestion', precio_anunciado: 45000, propietario_nombre: 'Arturo' }
];

test('números del centro operativo', () => {
  const r = resumen(OPS);
  assert.deepEqual([r.vendidos, r.ventas, r.encargos, r.facturado, r.comision, r.comercial, r.neto], [2, 1, 1, 116000, 6560, 1540, 5020]);
  assert.equal(r.pct.toFixed(2), '5.66');
  assert.deepEqual([r.enVenta, r.valorEnVenta, r.comisionPrevista, r.captacion, r.diasMedios], [1, 49000, 2940, 1, 60]);
  assert.equal(r.descuento.toFixed(1), '5.0');
  assert.deepEqual(r.marcas, [{ marca: 'Porsche', n: 1, facturado: 76000, comision: 4560 }]);
  assert.deepEqual(r.comerciales, [{ comercial: 'Quique', n: 1, comision: 1140, sobre: 4560, pct: 25 }]);
});

test('formulario: limpio, comisión por % y handle desde la URL', () => {
  const { cambios } = leerOperacion({ titulo: ' Porsche 912 ', estado: 'vendido', precio_venta: '69.900', comision: '', comision_pct: '6', handle: 'https://sidonia.es/products/Porsche-912?x=1', fecha_venta: '2026-10-01', fecha_alta: 'ayer', tipo: 'nave' });
  assert.deepEqual([cambios.titulo, cambios.precio_venta, cambios.comision, cambios.handle, cambios.fecha_alta, cambios.tipo], ['Porsche 912', 69900, 4194, 'porsche-912', null, 'otro']);
  assert.equal(leerOperacion({ titulo: '' }).error, 'Falta el título.');
  assert.equal(leerOperacion({ titulo: 'x', estado: 'robado' }).error, 'Estado no válido.');
});

test('CSV para Excel, sin fórmulas', () => {
  const csv = csvOperaciones([{ ...OPS[0], notas: '=HYPERLINK("x")' }]);
  assert.ok(csv.startsWith('﻿id;tipo;titulo'));
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
  assert.match(csv, /;60\r\n$/, 'días hasta vender');
});

test('propietarios: junta a la misma persona de ventas y anuncios', () => {
  const l = propietarios(OPS, [{ id: 7, titulo: 'VESPA 1962', estado: 'publicado', vendedor_nombre: 'Carlos R.', telefono: '600 111 222', email: '', creado: '2026-10-01' }]);
  const carlos = l.find((p) => p.nombre === 'Carlos');
  assert.deepEqual([carlos.cosas.length, carlos.vendidos, carlos.facturado, carlos.tipo.sort()], [3, 1, 76000, ['Anuncio gratis', 'Venta gestionada']]);
  assert.ok(l.find((p) => p.nombre === 'Arturo'));
});

function tablaFalsa(filas = []) {
  let n = filas.length;
  return {
    filas,
    async leer(f) { const id = (f.match(/id=eq\.(\d+)/) || [])[1]; return id ? filas.filter((o) => o.id === Number(id)) : [...filas]; },
    async guardar(fila) { const x = { id: ++n, ...fila }; filas.push(x); return x; },
    async cambiar(id, c) { Object.assign(filas.find((o) => o.id === id), c); },
    async borrar(f) { const id = Number(f.match(/id=eq\.(\d+)/)[1]); filas.splice(filas.findIndex((o) => o.id === id), 1); }
  };
}

test('importar dos veces: la segunda pone al día, no duplica ni pisa lo puesto a mano', async () => {
  const t = tablaFalsa();
  const ops = detectarOperaciones(leerXlsx(xlsx()));
  assert.deepEqual(await importar(t, ops, []), { creadas: 3, puestas: 0 });
  t.filas[1].propietario_nombre = 'Lucía';
  const otra = ops.map((o) => (o.titulo.startsWith('JAGUAR') ? { ...o, estado: 'vendido', precio_venta: 8000, propietario_nombre: null } : o));
  assert.deepEqual(await importar(t, otra, t.filas), { creadas: 0, puestas: 1 });
  assert.deepEqual([t.filas.length, t.filas[1].estado, t.filas[1].precio_venta, t.filas[1].propietario_nombre], [3, 'vendido', 8000, 'Lucía']);
});

test('panel: la portada es Ventas; añadir, editar, importar (vista previa) y Propietarios', async () => {
  const cfg = config({ ADMIN_CLAVE: 'panel', TIENDA_URL: 'https://sidonia.es' });
  const auth = { authorization: 'Basic ' + Buffer.from('equipo:panel').toString('base64') };
  const operaciones = tablaFalsa(OPS.map((o) => ({ ...o })));
  const deps = { db: async () => [], operaciones, tabla: tablaFalsa([{ id: 7, estado: 'pendiente', titulo: 'VESPA', vendedor_nombre: 'Ana', telefono: '611', creado: '2026-10-01' }]) };
  const ventas = await atenderPanel({ method: 'GET', query: {}, headers: auth }, cfg, deps);
  assert.match(ventas.body, /<title>Ventas/);
  assert.match(ventas.body, /1 anuncio por revisar ›/);
  assert.match(ventas.body, /class="on">Anuncios <b class="num">1<\/b>|Anuncios <b class="num">1<\/b>/);
  assert.match(ventas.body, /PORSCHE 911 1986/);
  const nueva = await atenderPanel({ method: 'POST', query: { estado: 'operacion' }, body: { accion: 'guardar', titulo: 'VESPA GS 1958', estado: 'en_venta', precio_anunciado: '9000' }, headers: auth }, cfg, deps);
  assert.match(nueva.body, /Guardado: VESPA GS 1958/);
  assert.equal(operaciones.filas.at(-1).precio_anunciado, 9000);
  const editar = await atenderPanel({ method: 'GET', query: { estado: 'operacion', id: '1' }, headers: auth }, cfg, deps);
  assert.match(editar.body, /value="Carlos"/);
  const csv = await atenderPanel({ method: 'GET', query: { estado: 'ventas', csv: '1' }, headers: auth }, cfg, deps);
  assert.match(csv.headers['Content-Type'], /text\/csv/);
  const vista = await atenderPanel({ method: 'POST', query: { estado: 'importar' }, body: { accion: 'ver', archivo: xlsx().toString('base64'), nombre: 'Coches.xlsx' }, headers: auth }, cfg, deps);
  assert.match(vista.body, /Importar 3 filas/);
  assert.equal(operaciones.filas.length, 5, 'la vista previa no guarda nada');
  const duenos = await atenderPanel({ method: 'GET', query: { estado: 'duenos' }, headers: auth }, cfg, deps);
  assert.match(duenos.body, /Carlos/);
  assert.match(duenos.body, /Ana/);
  const malo = await atenderPanel({ method: 'POST', query: { estado: 'importar' }, body: { accion: 'ver', archivo: Buffer.from('hola').toString('base64') }, headers: auth }, cfg, deps);
  assert.match(malo.body, /no se ha podido leer el Excel/);
});

const CONN = process.env.PGTEST;
test('base de datos: la tabla de ventas (se puede ejecutar dos veces)', { skip: !CONN && 'sin PGTEST' }, () => {
  const args = (db) => [...CONN.split(/\s+/), '-d', db, '-v', 'ON_ERROR_STOP=1', '-Atq'];
  const psql = (sql, db = 'sidonia_ops') => execFileSync('psql', [...args(db), '-c', sql], { encoding: 'utf8' }).trim();
  psql('drop database if exists sidonia_ops', 'postgres');
  psql('create database sidonia_ops', 'postgres');
  for (let i = 0; i < 2; i += 1) execFileSync('psql', [...args('sidonia_ops'), '-f', fileURLToPath(new URL('../sql/operaciones.sql', import.meta.url))], { encoding: 'utf8' });
  psql("insert into operaciones (titulo, precio_venta, comision, ref) values ('PORSCHE 911', 76000, 4560, 'excel|c|porsche 911|1')");
  assert.equal(psql("select estado || ' ' || modalidad || ' ' || tipo || ' ' || origen from operaciones"), 'en_venta gestion coche panel');
});

test('enlazar: lo vendido o archivado en la tienda se pone igual aquí', () => {
  const r = emparejar([{ id: 1, titulo: 'BMW 2002 1973', estado: 'en_venta', handle: 'bmw-2002' }, { id: 2, titulo: 'SAAB 900 1992', estado: 'en_venta' }],
    [{ handle: 'bmw-2002', title: 'BMW 2002 1973', tags: ['Vendido'] }, { handle: 'saab', title: 'SAAB 900 1992', status: 'ARCHIVED', createdAt: '2025-01-01T00:00:00Z' }]);
  assert.deepEqual(r.map((x) => [x.id, x.cambios.estado]), [[1, 'vendido'], [2, 'retirado']]);
});

test('comercial: Hugo en las del Excel con comisión de comercial, y su % sobre la comisión de Sidonia', async () => {
  const { COMERCIAL, pctComercial } = await import('../lib/operaciones.mjs');
  assert.equal(COMERCIAL, 'Hugo');
  const ops = detectarOperaciones(leerXlsx(xlsx()));
  assert.deepEqual(ops.map((o) => o.comercial), [null, 'Hugo', null], 'solo donde hay comisión de comercial');
  assert.equal(pctComercial({ comision: 850, comision_comercial: 212.5 }), 25);
  // Formulario: el % del comercial calcula su parte; sin nombre, es Hugo
  const { cambios } = leerOperacion({ titulo: 'X', precio_venta: '50000', comision: '3000', comercial_pct: '30' });
  assert.deepEqual([cambios.comision_comercial, cambios.comercial], [900, 'Hugo']);
  const r = resumen([{ titulo: 'A', estado: 'vendido', precio_venta: 50000, comision: 3000, comision_comercial: 900, comercial: 'Hugo' }, { titulo: 'B', estado: 'vendido', precio_venta: 20000, comision: 1000, comision_comercial: 200, comercial: 'Hugo' }]);
  assert.deepEqual(r.comerciales.map((c) => [c.comercial, c.n, c.comision, c.sobre, c.pct.toFixed(1)]), [['Hugo', 2, 1100, 4000, '27.5']]);
  // Volver a importar pone a Hugo en las que no tenían comercial
  const t = { filas: [{ id: 1, ref: ops[1].ref, estado: 'en_venta', comision_comercial: 212.5, comercial: null }], async cambiar(id, c) { Object.assign(this.filas[0], c); }, async guardar() {} };
  await importar(t, [ops[1]], t.filas);
  assert.equal(t.filas[0].comercial, 'Hugo');
});
