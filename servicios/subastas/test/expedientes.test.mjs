// El centro operativo: de la gestión de la web (o en persona) al contrato firmado, la venta, la factura y el cobro;
// y el resumen de Finanzas
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config, atender } from '../lib/motor.mjs';
import { atenderPanel } from '../lib/circulo.mjs';
import { GASTOS_INICIALES } from '../lib/gastos.mjs';
import { contratoIntermediacion, crearBorrador, facturaPropuesta, leerFacturaForm, ligarSolos, pasoDe, siguienteNumero } from '../lib/expedientes.mjs';
import { numerosFinanzas } from '../lib/finanzas.mjs';
import { importe } from '../lib/estadisticas.mjs';

let id = 1000;
const tabla = (filas, clave = 'id') => ({ filas, leer: async (q = '') => { let l = filas; for (const m of q.matchAll(/(\w+)=eq\.([^&]+)/g)) l = l.filter((x) => String(x[m[1]]) === decodeURIComponent(m[2])); return l; },
  guardar: async (x, k = 'id') => { const ya = k !== 'id' && filas.find((y) => y[k] === x[k]); if (ya) return Object.assign(ya, x); const nn = { id: id++, creado: new Date().toISOString(), ...x }; filas.push(nn); return nn; },
  cambiar: async (i, c) => Object.assign(filas.find((x) => Number(x.id) === Number(i)), c), borrar: async () => {} });
const cfg = config({ ADMIN_CLAVE: 'p', TIENDA_URL: 'https://sidonia.es', SERVIDOR_URL: 'https://motor.test', SUBASTAS_CLAVE: 'k', RESEND_API_KEY: 're_x', AVISOS_EQUIPO: 'equipo@sidonia.es' });
const auth = { authorization: 'Basic ' + Buffer.from('e:p').toString('base64') };
function preparar() {
  const correos = [];
  const deps = { operaciones: tabla([{ id: 1, titulo: 'JAGUAR XJRS 1993', estado: 'vendido', modalidad: 'gestion', comision: 1700, precio_venta: 30000, fecha_venta: '2026-01-18' }]), facturas: tabla([]), gastos: tabla([]), pagos: tabla([]), ajustes: tabla([], 'clave'),
    gestiones: tabla([{ id: 77, estado: 'nueva', datos: { marca: 'Land Rover', modelo: 'Defender 110', anio: '1998', km: '180000', precio: '42000', nombre: 'Íñigo Prueba', telefono: '600111222', email: 'inigo@ejemplo.es' }, nota: '' }]),
    tabla: { leer: async () => [] }, fetch: async (u, o) => { correos.push(JSON.parse(o.body)); return { ok: true, json: async () => ({}), text: async () => '' }; } };
  const pag = (query, method = 'GET', body = {}) => atenderPanel({ method, query, body, headers: auth }, cfg, deps);
  const aviso = (r) => (r.body.match(/class="aviso[^"]*">([^<]*)/) || [])[1] || '';
  const pub = (ruta, url, method = 'GET', body = {}) => atender({ method, ruta, query: Object.fromEntries(new URL(url).searchParams), body, directo: true, headers: { 'x-forwarded-for': '81.1.1.1', 'user-agent': 'Prueba' } }, cfg, deps);
  return { deps, correos, pag, aviso, pub };
}
const EXP = { p_nombre: 'Íñigo Prueba Martín', p_telefono: '600111222', p_email: 'inigo@ejemplo.es', c_marca: 'Land Rover', c_modelo: 'Defender 110', c_anio: '1998', c_matricula: '1234 bcd', c_bastidor: 'SALLDHMF7WA123456', c_km: '180000', k_pct: '6', k_min: '1500', k_meses: '3', k_salida: '42.000', origen: 'web' };

test('importes escritos a mano', () => {
  assert.deepEqual(['40.000', '1.234,56', '2400', '9,68', '12.50', '1500 €', '', 'x'].map(importe), [40000, 1234.56, 2400, 9.68, 12.5, 1500, null, null]);
});

test('centro operativo: de la web al contrato firmado, vendido, factura (editable) y cobro', async () => {
  const { deps, correos, pag, aviso, pub } = preparar();
  // Sin los datos de facturación, avisa
  await pag({ estado: 'facturacion' }, 'POST', { nombre: 'Titular de Prueba', nif: '12345678Z', direccion: 'Calle Falsa 1, 28001 Madrid', email: 'hola@sidonia.es', iban: 'ES00 1111', comision_pct: '5', exclusividad_meses: '3', iva_pct: '21' });
  assert.equal(deps.ajustes.filas[0].valor.nif, '12345678Z');
  // Desde la gestión del formulario de la web
  const r = await pag({ estado: 'expediente' }, 'POST', { accion: 'desde-gestion', gestion: '77' });
  assert.equal(r.status, 303);
  const eid = Number(r.headers.Location.match(/id=(\d+)/)[1]);
  const o = () => deps.operaciones.filas.find((x) => x.id === eid);
  assert.equal(o().estado, 'captado'); assert.equal(o().expediente.coche.marca, 'Land Rover'); assert.equal(o().precio_anunciado, 42000);
  assert.equal(deps.gestiones.filas[0].estado, 'en_gestion'); assert.match(deps.gestiones.filas[0].nota, new RegExp(`Expediente n\\.º ${eid}`));
  // Datos completos (DNI mal: avisa)
  assert.match(aviso(await pag({ estado: 'expediente', id: String(eid) }, 'POST', { accion: 'guardar', ...EXP, p_dni: '12345678A' })), /DNI/);
  assert.equal(aviso(await pag({ estado: 'expediente', id: String(eid) }, 'POST', { accion: 'guardar', ...EXP })), 'Guardado.');
  assert.equal(o().expediente.coche.matricula, '1234BCD'); assert.equal(o().expediente.condiciones.comision_pct, 6); assert.equal(o().titulo, 'LAND ROVER DEFENDER 110 1998');
  // Contrato por email (con su enlace firmado) y por WhatsApp
  assert.match(aviso(await pag({ estado: 'expediente', id: String(eid) }, 'POST', { accion: 'contrato-email' })), /Enviado a inigo@ejemplo\.es/);
  assert.equal(pasoDe(o()), 'venta');
  const enlace = correos.at(-1).html.match(/https:\/\/motor\.test\/tienda\/intermediacion\?o=\d+&amp;f=\w+/)[0].replace('&amp;', '&');
  const wa = await pag({ estado: 'expediente', id: String(eid), wa: 'contrato' });
  assert.equal(wa.status, 302); assert.match(wa.headers.Location, /^https:\/\/wa\.me\/34600111222\?text=Hola%20%C3%8D%C3%B1igo/);
  // Un enlace falso no vale
  assert.match((await pub('intermediacion', enlace.replace(/f=\w+/, 'f=mal'))).body, /Enlace no válido/);
  // El propietario lo lee (con sus datos y las condiciones) y lo firma
  const ver = (await pub('intermediacion', enlace)).body;
  assert.match(ver, /LAND ROVER|Land Rover Defender 110 1998/); assert.match(ver, /<b>6 %<\/b>/); assert.match(ver, /1\.500 €/); assert.match(ver, /<b>60 días<\/b>/); assert.match(ver, /Titular de Prueba/); assert.match(ver, /desistir/);
  assert.match((await pub('intermediacion', enlace, 'POST', { nombre: 'Íñigo Prueba Martín', dni: '12345678Z', direccion: 'Calle del Prado 3, Madrid' })).body, /Marca la casilla/);
  assert.match((await pub('intermediacion', enlace, 'POST', { nombre: 'Íñigo Prueba Martín', dni: '1234', direccion: 'Calle del Prado 3, Madrid', acepto: '1' })).body, /Revisa tu DNI/);
  const firmado = (await pub('intermediacion', enlace, 'POST', { nombre: 'Íñigo Prueba Martín', dni: '12345678z', direccion: 'Calle del Prado 3, 28014 Madrid', acepto: '1' })).body;
  assert.match(firmado, /¡Firmado!/); assert.match(firmado, /Huella SHA-256/);
  const ct = o().expediente.contrato;
  assert.equal(ct.firma.dni, '12345678Z'); assert.equal(ct.firma.ip, '81.1.1.1'); assert.equal(ct.hash.length, 64); assert.match(ct.html, /Calle del Prado 3/);
  assert.equal(o().estado, 'en_venta'); assert.equal(o().expediente.propietario.dni, '12345678Z');
  assert.ok(correos.some((c) => c.to.includes('equipo@sidonia.es') && /Contrato firmado/.test(c.subject)));
  // Firmado, ya no se puede volver a firmar
  await pub('intermediacion', enlace, 'POST', { nombre: 'Otro', dni: '87654321X', direccion: 'Otra calle 1, Madrid', acepto: '1' });
  assert.equal(o().expediente.contrato.firma.nombre, 'Íñigo Prueba Martín');
  // Vendido: la comisión, el % del precio final (con el mínimo)
  assert.match(aviso(await pag({ estado: 'expediente', id: String(eid) }, 'POST', { accion: 'vendido', precio_venta: '40.000', fecha_venta: '2026-11-15', comprador_nombre: 'Comprador' })), /2\.400,00 €/);
  assert.equal(o().estado, 'vendido'); assert.equal(o().comision, 2400);
  // La factura propuesta y la de verdad: a nombre de otra empresa, con la comisión rebajada; en efectivo ≥ 1.000 €, no
  const prop = facturaPropuesta(o(), deps.ajustes.filas[0].valor, []);
  assert.deepEqual([prop.numero.slice(5), prop.base, prop.destinatario.nombre], ['001', 2400, 'Íñigo Prueba Martín']);
  const fac = { accion: 'factura', numero: '2026-021', fecha: '2026-11-16', d_nombre: 'Prueba Motor S.L.', d_nif: 'B12345678', d_direccion: 'Calle Uno 1, Madrid', precio_venta: '40000', pct: '5', base: '2.000', iva_pct: '21', concepto: 'Gestión de Venta Land Rover Defender 110 1234BCD' };
  assert.match(aviso(await pag({ estado: 'expediente', id: String(eid) }, 'POST', { ...fac, forma_pago: 'efectivo' })), /En efectivo solo/);
  assert.match(aviso(await pag({ estado: 'expediente', id: String(eid) }, 'POST', { ...fac, forma_pago: 'transferencia' })), /Factura 2026-021 creada/);
  const f = deps.facturas.filas.at(-1);
  assert.deepEqual([f.base, f.iva, f.total, f.cliente, f.nif, f.operacion_id, f.forma_pago], [2000, 420, 2420, 'Prueba Motor S.L.', 'B12345678', eid, 'transferencia']);
  assert.equal(o().comision, 2000, 'la comisión de la venta, la de la factura');
  assert.equal(pasoDe(o(), f), 'cobro');
  assert.match(aviso(await pag({ estado: 'expediente', id: String(eid) }, 'POST', { ...fac, numero: '2026-022' })), /ya tiene factura/);
  // Enviarla y verla (con el diseño de Sidonia)
  assert.match(aviso(await pag({ estado: 'expediente', id: String(eid) }, 'POST', { accion: 'factura-email' })), /Enviada a inigo@ejemplo\.es/);
  const ef = correos.at(-1).html.match(/https:\/\/motor\.test\/tienda\/factura\?n=\d+&amp;f=\w+/)[0].replace('&amp;', '&');
  const vf = (await pub('factura', ef)).body;
  assert.match(vf, /FACTURA/); assert.match(vf, /2026-021/); assert.match(vf, /Prueba Motor S\.L\./); assert.match(vf, /2\.420,00 €/); assert.match(vf, /ES00 1111/); assert.match(vf, /Titular de Prueba/);
  assert.match((await pub('factura', ef.replace(/f=\w+/, 'f=x'))).body, /Enlace no válido/);
  // Cobrada (en efectivo no, por el importe); deshacer
  assert.match(aviso(await pag({ estado: 'expediente', id: String(eid) }, 'POST', { accion: 'cobrada', cobrada: '2026-11-17', forma_pago: 'efectivo' })), /no se puede cobrar en efectivo/);
  assert.equal(aviso(await pag({ estado: 'expediente', id: String(eid) }, 'POST', { accion: 'cobrada', cobrada: '2026-11-17', forma_pago: 'bizum' })), '¡Cobrada!');
  assert.equal(f.cobrada, '2026-11-17'); assert.equal(f.forma_pago, 'bizum'); assert.equal(pasoDe(o(), f), 'hecho');
  // Anular: queda anulada y se puede hacer otra
  await pag({ estado: 'expediente', id: String(eid) }, 'POST', { accion: 'factura-anular' });
  assert.equal(f.estado, 'anulada'); assert.equal(pasoDe(o(), null), 'factura');
  // El historial lo cuenta todo
  assert.ok(o().expediente.historial.length >= 8);
  // El tablero y el resumen
  assert.match((await pag({ estado: 'expedientes', ver: 'vendido' })).body, /LAND ROVER DEFENDER 110 1998/);
  assert.match((await pag({ estado: 'finanzas', ano: '2026' })).body, /Lo que queda/);
});

test('centro operativo: coche nuevo en persona y venta de antes sin factura', async () => {
  const { deps, pag, aviso } = preparar();
  assert.match((await pag({ estado: 'expediente', nuevo: '1' })).body, /Nuevo coche: su ficha/);
  assert.match(aviso(await pag({ estado: 'expediente' }, 'POST', { accion: 'crear', ...EXP, c_marca: '' })), /marca y el modelo/);
  const r = await pag({ estado: 'expediente' }, 'POST', { accion: 'crear', ...EXP, p_nombre: 'Concesionario Prueba S.L.', p_dni: 'B11111111', origen: 'llamada' });
  assert.equal(r.status, 303);
  const nuevo = deps.operaciones.filas.at(-1);
  assert.equal(nuevo.estado, 'captado'); assert.equal(nuevo.expediente.origen, 'llamada');
  // Firmado en papel
  await pag({ estado: 'expediente', id: String(nuevo.id) }, 'POST', { accion: 'contrato-firmado-papel' });
  assert.ok(nuevo.expediente.contrato.firma.papel); assert.equal(nuevo.estado, 'en_venta');
  // La venta de antes: su factura, con la comisión que ya tenía
  const p = facturaPropuesta(deps.operaciones.filas[0], {}, [{ numero: '2026-020' }]);
  assert.deepEqual([p.numero, p.base, p.pct], ['2026-021', 1700, 5.67]);
  const h = (await pag({ estado: 'finanzas', ano: '2026' })).body;
  assert.match(h, /comisiones cobradas en efectivo sin factura/, 'las de antes sin factura, en efectivo'); assert.match(h, /Efectivo · sin factura/); assert.match(h, /A este ritmo, \d{4} cerraría/);
  // En Anuncios se apuntan solas (una vez) como cobradas en efectivo
  await pag({ estado: 'sidonia' });
  assert.equal(deps.operaciones.filas[0].expediente.cobro.forma, 'efectivo'); assert.equal(deps.operaciones.filas[0].expediente.cobro.auto, true);
  // Una venta nueva (después del corte) sí pide su factura
  deps.operaciones.filas.push({ id: 77, titulo: 'BMW 2002 1973', estado: 'vendido', modalidad: 'gestion', comision: 900, precio_venta: 18000, fecha_venta: '2026-12-02', expediente: { propietario: { nombre: 'X' } } });
  await pag({ estado: 'sidonia' });
  assert.equal(deps.operaciones.filas.at(-1).expediente.cobro, undefined);
});

test('el contrato sin firmar deja huecos y la factura valida su NIF; los números de factura siguen', () => {
  const html = contratoIntermediacion({ id: 5, expediente: { propietario: { nombre: 'Ana' }, coche: { marca: 'Seat', modelo: '600' }, condiciones: { comision_pct: 5, exclusividad_meses: 3 } } }, {});
  assert.match(html, /class="hueco"/); assert.match(html, /Pendiente de firma/);
  assert.match(leerFacturaForm({ numero: '1', fecha: '2026-01-01', base: '100', d_nombre: 'X', d_nif: '123' }, { id: 1 }).error, /NIF/);
  assert.equal(siguienteNumero([{ numero: '2026-009' }, { numero: '2026-021' }, { numero: '2025-050' }, { numero: 'otra' }], '2026-11-17'), '2026-022');
  assert.equal(siguienteNumero([], '2027-01-02'), '2027-001');
});

test('Finanzas: ingresos, facturado, pendiente de facturar y de cobrar, gastos e IRPF', () => {
  const ops = [{ id: 1, estado: 'vendido', fecha_venta: '2026-03-10', comision: 3000 }, { id: 2, estado: 'vendido', fecha_venta: '2026-05-10', comision: 2000 }];
  const facturas = [{ numero: '2026-001', fecha: '2026-03-12', base: 3000, iva: 630, total: 3630, operacion_id: 1, forma_pago: 'transferencia', cobrada: '2026-03-20' },
    { numero: '2026-002', fecha: '2026-04-02', base: 1000, iva: 210, total: 1210, concepto: 'Marketing', forma_pago: 'transferencia' },
    { numero: '2026-003', fecha: '2026-04-03', base: 500, iva: 105, total: 605, concepto: 'Gestión de Venta Seat', estado: 'anulada' }];
  const N = numerosFinanzas({ ops, facturas, gastos: [{ tipo: 'cuota', concepto: 'Canva', categoria: 'Apps', importe: 100, fecha: '2026-01-01' }], pagos: [{ fecha: '2026-06-01', importe: 200 }] }, 2026, new Date('2026-11-17T12:00:00Z'));
  const T = N.totales;
  assert.equal(T.ventas, 5000); assert.equal(T.servicios, 1000); assert.equal(T.comunidad, 200); assert.equal(T.ingresos, 6200);
  assert.equal(T.facturado, 4000); assert.equal(T.pendienteFacturar, 2000); assert.equal(T.pendienteCobro, 1210); assert.equal(T.cobrado, 3630);
  assert.equal(T.gastos, 1100);
  assert.equal(Math.round(T.resultado), Math.round(6200 - 1100 - T.irpf));
});

test('Anuncios: crear la ficha desde un anuncio de la web, ligar con su propietario, vídeo hecho y quién lo lleva', async () => {
  const { cocheDeTitulo } = await import('../lib/expedientes.mjs');
  const { olvidarCatalogo } = await import('../lib/actividad.mjs');
  assert.deepEqual([cocheDeTitulo('MERCEDES-BENZ 220 SEB COUPÉ 1963').marca, cocheDeTitulo('MERCEDES-BENZ 220 SEB COUPÉ 1963').anio], ['Mercedes-Benz', '1963']);
  assert.deepEqual([cocheDeTitulo('LAND ROVER DEFENDER 110 2005').marca, cocheDeTitulo('LAND ROVER DEFENDER 110 2005').modelo], ['Land Rover', 'DEFENDER 110']);
  const { deps, pag, aviso } = preparar();
  olvidarCatalogo();
  deps.gql = async () => ({ products: { nodes: [{ handle: 'land-rover-defender-110-1998', title: 'LAND ROVER DEFENDER 110 1998', status: 'ACTIVE', tags: [], featuredImage: { url: 'https://cdn/def.jpg' }, variants: { nodes: [{ availableForSale: true }] } },
    { handle: 'porsche-912-1967', title: 'PORSCHE 912 1967', status: 'ACTIVE', tags: [], featuredImage: null, variants: { nodes: [{ availableForSale: false }] } }], pageInfo: { hasNextPage: false } } });
  // Una ficha con su contrato, sin anuncio aún: sugiere el de la web que se parece
  await pag({ estado: 'expediente' }, 'POST', { accion: 'crear', ...EXP, comercial: 'Hugo' });
  const o = deps.operaciones.filas.at(-1);
  assert.equal(o.comercial, 'Hugo');
  let h = (await pag({ estado: 'expediente', id: String(o.id) })).body;
  assert.match(h, /lo lleva Hugo/); assert.match(h, /¿Ya lo habéis subido\? Es alguno de estos/); assert.match(h, /Crear su anuncio en Shopify/); assert.match(h, /def\.jpg/); assert.match(h, /Es este, ligar/);
  assert.match(aviso(await pag({ estado: 'expediente', id: String(o.id) }, 'POST', { accion: 'video' })), /Vídeo hecho/);
  assert.ok(o.expediente.video);
  await pag({ estado: 'expediente', id: String(o.id) }, 'POST', { accion: 'anuncio', handle: 'land-rover-defender-110-1998' });
  assert.equal(o.handle, 'land-rover-defender-110-1998');
  h = (await pag({ estado: 'expediente', id: String(o.id) })).body;
  assert.match(h, /Ver en la web/); assert.doesNotMatch(h, /Es alguno de estos/); assert.doesNotMatch(h, /Crear su anuncio en Shopify/);
  // Desde Anuncios › En la web: ligar el otro anuncio (vendido en la web) con una ficha o crear su ficha
  let l = (await pag({ estado: 'ligar', h: 'porsche-912-1967' })).body;
  assert.match(l, /PORSCHE 912 1967/); assert.match(l, /JAGUAR XJRS 1993/); assert.match(l, /\+ Crear su ficha/);
  const nueva = (await pag({ estado: 'expediente', nuevo: '1', h: 'porsche-912-1967' })).body;
  assert.match(nueva, /value="Porsche"/); assert.match(nueva, /value="912"/); assert.match(nueva, /value="1967"/); assert.match(nueva, /name="handle" value="porsche-912-1967"/);
  const r = await pag({ estado: 'ligar', h: 'porsche-912-1967' }, 'POST', { id: '1' });
  assert.equal(r.status, 303); assert.equal(deps.operaciones.filas[0].handle, 'porsche-912-1967');
  l = (await pag({ estado: 'ligar', h: 'porsche-912-1967' })).body;
  assert.match(l, /Ya está ligado/);
});

test('Finanzas: el resumen con las ventas del mes y del año, y los impuestos aparte', async () => {
  const { deps, pag } = preparar();
  deps.gastos.filas.push({ id: 1, tipo: 'cuota', concepto: 'Canva Pro', categoria: 'Apps', importe: 12, fecha: '2026-01-01' }, { id: 2, tipo: 'cargo', concepto: 'IRPF (modelo 130)', categoria: 'Impuestos', importe: 300, fecha: '2026-04-20' });
  const h = (await pag({ estado: 'finanzas', ano: '2026' })).body;
  assert.match(h, /Desde el principio/); assert.match(h, /Coches vendidos/); assert.match(h, /Registrados/); assert.match(h, /IVA del \d\.º trimestre/);
  assert.match(h, /<title>Ventas/); assert.match(h, /Este mes/); assert.match(h, /Análisis mes a mes/); assert.match(h, /enero de 2026/); assert.match(h, /Lo que queda/); assert.match(h, /JAGUAR XJRS 1993/);
  assert.match(h, /data-ver="comision"/); assert.match(h, /Por marca/); assert.match(h, /Jaguar/);
  const mes = (await pag({ estado: 'finanzas', p: 'mes' })).body;
  assert.match(mes, /class="on">Este mes/); assert.match(mes, /frente al mes anterior/);
  assert.doesNotMatch(h, /Nuevo coche/); assert.doesNotMatch(h, /Hacienda:/);
  const i = (await pag({ estado: 'impuestos' })).body;
  assert.match(i, /<title>Impuestos/); assert.match(i, /IRPF \(modelo 130\)/); assert.match(i, /Lo próximo/);
});

test('el contrato explica lo importante y lleva el formulario de desistimiento', () => {
  const html = contratoIntermediacion({ id: 9, expediente: { propietario: { nombre: 'Ana' }, coche: { marca: 'Seat', modelo: '600', anio: '1970' }, condiciones: { comision_pct: 6, comision_min: 1500, precio_salida: 42000, exclusividad_meses: 3 } } }, { nombre: 'Sidonia', iva_pct: 21 });
  assert.match(html, /Lo importante, en claro/); assert.match(html, /si el Vehículo se vende por 42\.000 €, los honorarios serían 2\.520,00 € más 529,20 € de IVA \(3\.049,20 € en total\)/);
  assert.match(html, /mediación o corretaje/); assert.match(html, /Fotos, vídeo y anuncio/); assert.match(html, /Formulario de desistimiento/); assert.match(html, /14 días naturales/);
});

test('pasos de cada coche: en cartera (contrato y anuncio a la vez), por facturar, por cobrar y cerrado', async () => {
  const { situacionCartera } = await import('../lib/expedientes.mjs');
  const firmado = { expediente: { contrato: { firma: { nombre: 'A' } } }, estado: 'en_venta' };
  assert.equal(pasoDe({ expediente: { propietario: { nombre: 'A' } }, estado: 'captado' }), 'venta');
  assert.deepEqual(situacionCartera({ expediente: { propietario: { nombre: 'A' } }, estado: 'captado' }), { contrato: 'sin_enviar', anuncio: 'sin_anuncio' });
  assert.deepEqual(situacionCartera({ ...firmado, handle: 'x' }, { status: 'DRAFT' }), { contrato: 'firmado', anuncio: 'borrador' });
  assert.deepEqual(situacionCartera({ ...firmado, handle: 'x' }, { status: 'ACTIVE' }), { contrato: 'firmado', anuncio: 'en_web' });
  assert.equal(pasoDe({ ...firmado, handle: 'x' }, null, { status: 'ACTIVE', situacion: 'vendido' }), 'factura', 'vendido en la web');
  assert.equal(pasoDe({ ...firmado, handle: 'x' }, null, { status: 'ARCHIVED', situacion: 'oculto' }), 'hecho', 'archivado');
  assert.equal(pasoDe({ ...firmado, estado: 'vendido' }, { estado: 'emitida' }), 'cobro');
  assert.equal(pasoDe({ ...firmado, estado: 'vendido' }, { estado: 'emitida', cobrada: '2026-11-17' }), 'hecho');
  assert.equal(pasoDe({ estado: 'vendido', fecha_venta: '2025-06-01' }, null, undefined, new Date('2026-11-17')), 'hecho', 'una venta de antes');
  assert.equal(pasoDe({ estado: 'retirado' }), 'hecho');
});

test('Anuncios › De Sidonia: alta del coche (borrador en Shopify y contrato), lista por estados y ligar solo lo subido a mano', async () => {
  const { olvidarCatalogo } = await import('../lib/actividad.mjs');
  const { deps, pag, aviso } = preparar();
  olvidarCatalogo();
  await pag({ estado: 'facturacion' }, 'POST', { nombre: 'Titular de Prueba', nif: '12345678Z', direccion: 'Calle Falsa 1, 28001 Madrid', comision_pct: '5', exclusividad_meses: '3', iva_pct: '21' });
  const tienda = [
    { handle: 'ferrari-308-gts-1980', title: 'FERRARI 308 GTS 1980', status: 'ACTIVE', tags: [], createdAt: '2026-01-01T00:00:00Z', featuredImage: { url: 'https://cdn/f.jpg' }, variants: { nodes: [{ availableForSale: true }] } },
    { handle: 'seat-600-1970', title: 'SEAT 600 1970', status: 'ACTIVE', tags: ['dueno'], createdAt: '2026-01-01T00:00:00Z', featuredImage: null, variants: { nodes: [{ availableForSale: true }] } }
  ];
  const mutaciones = [];
  deps.gql = async (q, v) => {
    if (/productCreate/.test(q)) { mutaciones.push(v.product); tienda.push({ handle: 'land-rover-defender-110-1998', title: v.product.title, status: 'DRAFT', tags: [], createdAt: new Date().toISOString(), featuredImage: null, variants: { nodes: [{ availableForSale: true }] } }); return { productCreate: { product: { id: 'gid://shopify/Product/555', handle: 'land-rover-defender-110-1998', variants: { nodes: [{ id: 'gid://shopify/ProductVariant/1' }] } }, userErrors: [] } }; }
    if (/productVariantsBulkUpdate/.test(q)) { mutaciones.push(v.variants[0]); return { productVariantsBulkUpdate: { userErrors: [] } }; }
    if (/publications/.test(q)) return { publications: { nodes: [{ id: 'gid://p/1', name: 'Online Store' }] } };
    if (/publishablePublish/.test(q)) return { publishablePublish: { userErrors: [] } };
    return { products: { nodes: tienda, pageInfo: { hasNextPage: false } } };
  };
  // Hugo da de alta el coche: a la vez, su borrador en Shopify (título, descripción, precio) y el contrato listo para enviar
  const alta = await pag({ estado: 'expediente' }, 'POST', { accion: 'crear', ...EXP, comercial: 'Hugo', k_comercial: '30', c_ubicacion: 'Madrid', c_descripcion: 'Un Defender de los buenos.\n\nRestaurado en 2020.', k_especiales: 'Incluye la baca original.' });
  const o = deps.operaciones.filas.at(-1);
  assert.equal(alta.status, 303); assert.match(decodeURIComponent(alta.headers.Location), /aviso=Creado: su borrador ya está en Shopify/);
  assert.deepEqual([mutaciones[0].status, mutaciones[0].title, mutaciones[0].vendor, mutaciones[0].templateSuffix, mutaciones[1].price], ['DRAFT', 'LAND ROVER DEFENDER 110 1998', 'Sidonia', 'cars', '42000']);
  assert.match(mutaciones[0].descriptionHtml, /<p>Un Defender de los buenos\.<\/p><p>Restaurado en 2020\.<\/p>/);
  assert.equal(o.handle, 'land-rover-defender-110-1998'); assert.equal(o.expediente.shopify_id, 'gid://shopify/Product/555'); assert.equal(o.expediente.condiciones.comercial_pct, 30);
  assert.match((await pag({ estado: 'expediente', id: String(o.id), aviso: 'Creado' })).body, /class="aviso">Creado/);
  const { contratoIntermediacion: ci } = await import('../lib/expedientes.mjs');
  assert.match(ci(o, { nombre: 'Sidonia' }), /Pactos particulares[\s\S]*Incluye la baca original/);
  let l = (await pag({ estado: 'sidonia' })).body;
  assert.match(l, /<title>Coches de Sidonia/); assert.match(l, /class="on"><svg[\s\S]*?<\/svg>Anuncios/); assert.match(l, /class="on">De Sidonia/); assert.match(l, /De sus dueños/); assert.match(l, /De alquiler/);
  assert.doesNotMatch(l, /Cobros comunidad/);
  const filas = (h) => h.split('<div class="sd-r"').slice(1);
  assert.match(l, /Se han anunciado <b>\d+<\/b> coches/); assert.match(l, /Próximamente/); assert.match(l, /Disponibles/); assert.match(l, /Vendidos/);
  assert.ok(filas((await pag({ estado: 'sidonia', ver: 'solicitud' })).body).some((f) => /sd-p solicitud">Solicitud/.test(f) && /LAND ROVER DEFENDER 110 1998/.test(f) && /Crear ficha y contrato/.test(f)), 'las solicitudes de la web, el primer paso');
  l = (await pag({ estado: 'sidonia', ver: 'proximamente' })).body;
  assert.ok(filas(l).some((f) => /LAND ROVER DEFENDER 110 1998/.test(f) && /Enviar contrato/.test(f) && /Contrato sin enviar/.test(f) && /Íñigo Prueba Martín/.test(f) && /42\.000 €/.test(f)), 'una fila por coche: propietario, precio, contrato y anuncio');
  // El anuncio de Sidonia sin ficha: «Añadir su propietario»; el de la comunidad no sale
  const disp = (await pag({ estado: 'sidonia' })).body;
  assert.match(disp, /FERRARI 308 GTS 1980[\s\S]*Editar ficha/); assert.doesNotMatch(disp, /SEAT 600 1970/); assert.doesNotMatch(disp, /LAND ROVER DEFENDER 110 1998/, 'el borrador no está disponible aún');
  // Desde la tarjeta: el contrato por email, y vuelve a la lista con el aviso
  const r = await pag({ estado: 'expediente', id: String(o.id) }, 'POST', { accion: 'contrato-email', volver: 'sidonia' });
  assert.equal(r.status, 303); assert.match(decodeURIComponent(r.headers.Location), /estado=sidonia&aviso=Enviado a inigo@ejemplo\.es/);
  assert.match((await pag({ estado: 'sidonia', ver: 'proximamente', aviso: 'Enviado a inigo@ejemplo.es.' })).body, /Contrato enviado el/);
  assert.ok(filas((await pag({ estado: 'sidonia', ver: 'proximamente' })).body).some((f) => /LAND ROVER DEFENDER 110 1998/.test(f) && /Borrador: falta el vídeo/.test(f) && /Subir el vídeo en Shopify/.test(f)));
  assert.match(aviso(await pag({ estado: 'expediente', id: String(o.id) }, 'POST', { accion: 'crear-anuncio' })), /ya tiene su anuncio/);
  let e = (await pag({ estado: 'expediente', id: String(o.id) })).body;
  assert.match(e, /Borrador en Shopify/); assert.match(e, /admin\.shopify\.com\/store\/[^/]*\/products\/555|Abrir en Shopify/);
  // Lo publican en Shopify: pasa solo a «En venta»
  tienda.at(-1).status = 'ACTIVE'; olvidarCatalogo();
  l = (await pag({ estado: 'sidonia', ver: 'venta' })).body;
  assert.ok(filas(l).some((f) => /LAND ROVER DEFENDER 110 1998/.test(f) && /mc ok">En la web/.test(f) && /Editar/.test(f)));
  // Otro coche firmado que suben directamente en Shopify: se liga solo
  const p = { id: 9100, titulo: 'PORSCHE 911 CARRERA 1986', estado: 'captado', modalidad: 'gestion', creado: new Date().toISOString(), expediente: { propietario: { nombre: 'Ana' }, coche: { marca: 'Porsche' } } };
  deps.operaciones.filas.push(p);
  tienda.push({ handle: 'porsche-911-carrera-1986', title: 'PORSCHE 911 CARRERA 1986', status: 'ACTIVE', tags: [], createdAt: new Date(Date.now() + 1000).toISOString(), featuredImage: { url: 'https://cdn/p.jpg' }, variants: { nodes: [{ availableForSale: true }] } });
  olvidarCatalogo();
  await pag({ estado: 'sidonia' });
  assert.equal(p.handle, 'porsche-911-carrera-1986'); assert.match(p.expediente.historial.at(-1).texto, /Ligado solo/);
  assert.equal(o.handle, 'land-rover-defender-110-1998');
  // El Ferrari (más antiguo que la ficha) no se liga solo con nada
  assert.deepEqual(ligarSolos([{ id: 1, titulo: 'FERRARI 308 GTS 1980', estado: 'captado', creado: '2026-06-01T00:00:00Z', expediente: { coche: {} } }], new Map([['f', { handle: 'f', titulo: 'FERRARI 308 GTS 1980', creado: '2026-01-01T00:00:00Z', situacion: 'en_venta' }]])), []);
  // De sus dueños: los de la comunidad, con su revisión
  deps.db = async () => [];
  const com = await pag({ estado: 'comunidad' });
  assert.match(com.body, /class="on">De sus dueños/); assert.match(com.body, /chips-c/);
  assert.equal(typeof crearBorrador, 'function');
});

test('ventas sin factura: cobrada en efectivo (una o todas), y Ventas cuadra con «desde el principio»', async () => {
  const { deps, pag, aviso } = preparar();
  deps.operaciones.filas.push({ id: 2, titulo: 'SEAT 600 1970', estado: 'vendido', modalidad: 'gestion', precio_anunciado: 9000, comision: 500 }, { id: 3, titulo: 'FIAT 500 1968', estado: 'vendido', modalidad: 'encargo', precio_venta: 12000, comision: 800, fecha_venta: '2026-03-02' });
  // Ventas: «Todo» y «desde el principio» dicen lo mismo (con la venta sin fecha y el encargo)
  const h = (await pag({ estado: 'finanzas', p: 'todo' })).body;
  assert.match(h, /Sin fecha de venta/); assert.match(h, /<span>Vendido en total<\/span><b>51 k€/); assert.match(h, /data-ver="vendido"><span>Vendido<\/span><b>51\.000 €/);
  assert.match(h, /Comisión del comercial/); assert.match(h, /Gastos fijos/);
  // Una: desde su ficha
  assert.match(aviso(await pag({ estado: 'expediente', id: '1' }, 'POST', { accion: 'efectivo' })), /cobrada en efectivo/);
  assert.equal(deps.operaciones.filas[0].expediente.cobro.forma, 'efectivo');
  assert.equal(pasoDe(deps.operaciones.filas[0]), 'hecho');
  assert.match((await pag({ estado: 'expediente', id: '1' })).body, /Efectivo · sin factura/);
  // Todas las demás de golpe
  const r = await pag({ estado: 'sidonia', ver: 'factura' }, 'POST', { accion: 'efectivo-todas' });
  assert.match(r.body, /Apuntadas 2 ventas como cobradas en efectivo/);
  assert.ok(deps.operaciones.filas.every((o) => o.expediente?.cobro));
  assert.match((await pag({ estado: 'sidonia', ver: 'efectivo' })).body, /Cobrada en efectivo · sin factura/);
  assert.match((await pag({ estado: 'finanzas' })).body, /comisiones cobradas en efectivo sin factura/);
  await pag({ estado: 'expediente', id: '1' }, 'POST', { accion: 'efectivo-deshacer' });
  assert.equal(deps.operaciones.filas[0].expediente.cobro, undefined);
});

test('Propietarios: los de Sidonia, los que anuncian y los de alquiler, en un sitio', async () => {
  const { deps, pag } = preparar();
  deps.operaciones.filas.push({ id: 5, titulo: 'SEAT 600 1970', estado: 'en_venta', modalidad: 'gestion', expediente: { propietario: { nombre: 'Lucía Prueba', telefono: '611000111', dni: '12345678Z' } } });
  deps.tabla = { leer: async () => [{ id: 3, titulo: 'VESPA 1962', estado: 'publicado', vendedor_nombre: 'Lucía P.', telefono: '611 000 111', email: '', creado: '2026-10-01' }] };
  deps.garaje = { leer: async () => [{ id: 8, cliente: 'c1', marca: 'Ford', modelo: 'Mustang', anio: '1966', alquiler: true, alq: { estado: 'publicado' }, creado: '2026-09-01' }] };
  deps.perfiles = { leer: async () => [{ cliente: 'c1', alq_legal: { nombre: 'Pedro Alquila', telefono: '622000222' } }] };
  const h = (await pag({ estado: 'duenos' })).body;
  assert.match(h, /class="on"><svg[\s\S]*?<\/svg>Propietarios/);
  const filas = h.split('<div class="pp-r"').slice(1);
  const lucia = filas.find((f) => /Lucía Prueba/.test(f));
  assert.ok(lucia && /SEAT 600 1970/.test(lucia) && /VESPA 1962/.test(lucia) && /Gestión de Sidonia/.test(lucia) && /Anuncia en la web/.test(lucia), 'la misma persona, junta');
  assert.ok(filas.some((f) => /Pedro Alquila/.test(f) && /FORD|Ford Mustang 1966/.test(f) && /pp-t a">Alquiler/.test(f)));
  assert.match((await pag({ estado: 'duenos', ver: 'Alquiler' })).body, /Pedro Alquila/);
});

test('Shopify ↔ panel: lo cambiado en Shopify pasa a la ficha, y lo cambiado en la ficha va a Shopify', async () => {
  const { textoDeHtml, cambiosDeShopify, llevarAShopify } = await import('../lib/expedientes.mjs');
  assert.equal(textoDeHtml('<p>Hola &amp; adiós</p><p>Línea<br>dos</p>'), 'Hola & adiós\n\nLínea\ndos');
  const o = { id: 1, titulo: 'SEAT 600 1970', handle: 'seat-600', precio_anunciado: 9000, expediente: { coche: { descripcion: 'Viejo texto' }, condiciones: { precio_salida: 9000 } } };
  const r = cambiosDeShopify(o, { id: 'gid://shopify/Product/7', title: 'SEAT 600 D 1970', descriptionHtml: '<p>Nuevo texto</p>', variants: { nodes: [{ price: '9500.00' }] } });
  assert.deepEqual(r.qué, ['título', 'descripción', 'precio']);
  assert.equal(r.cambios.titulo, 'SEAT 600 D 1970'); assert.equal(r.cambios.expediente.coche.descripcion, 'Nuevo texto'); assert.equal(r.cambios.expediente.condiciones.precio_salida, 9500);
  assert.equal(cambiosDeShopify({ ...o, titulo: 'SEAT 600 D 1970', precio_anunciado: 9500, expediente: { ...r.cambios.expediente } }, { id: 'gid://shopify/Product/7', title: 'SEAT 600 D 1970', descriptionHtml: '<p>Nuevo texto</p>', variants: { nodes: [{ price: '9500.00' }] } }), null, 'sin cambios, nada');
  const llamadas = [];
  const gql = async (q, v) => { llamadas.push([q.match(/(productUpdate|productVariantsBulkUpdate|metafieldsSet|products)/)?.[1], v]); return /products\(/.test(q) ? { products: { nodes: [{ id: 'gid://shopify/Product/7', handle: 'seat-600', variants: { nodes: [{ id: 'v1', price: '9000' }] } }] } } : { productUpdate: { userErrors: [] }, productVariantsBulkUpdate: { userErrors: [] }, metafieldsSet: { userErrors: [] } }; };
  await llevarAShopify(gql, { ...o, titulo: 'SEAT 600 E 1971', expediente: { coche: { descripcion: 'Uno\n\nDos', marca: 'Seat' }, condiciones: { precio_salida: 9900 } } }, { titulo: true, descripcion: true, precio: true });
  const up = llamadas.find((x) => x[0] === 'productUpdate')[1].product;
  assert.deepEqual([up.title, up.descriptionHtml], ['SEAT 600 E 1971', '<p>Uno</p><p>Dos</p>']);
  assert.equal(llamadas.find((x) => x[0] === 'productVariantsBulkUpdate')[1].variants[0].price, '9900');
});

test('Anuncios: la ventana para editar la ficha y enviar el contrato, y la de vendido con su factura', async () => {
  const { olvidarCatalogo } = await import('../lib/actividad.mjs');
  const { deps, pag, correos } = preparar();
  olvidarCatalogo();
  await pag({ estado: 'facturacion' }, 'POST', { nombre: 'Titular de Prueba', nif: '12345678Z', direccion: 'Calle Falsa 1, 28001 Madrid', iban: 'ES00 1111', comision_pct: '5', exclusividad_dias: '30', iva_pct: '21' });
  assert.equal(deps.ajustes.filas[0].valor.exclusividad_dias, 60, 'la exclusividad, 60 días como mínimo');
  deps.gql = async (q) => (/products\(first: 1/.test(q) ? { products: { nodes: [{ id: 'gid://shopify/Product/9', handle: 'jaguar-e-type-1965', title: 'JAGUAR E-TYPE 1965', descriptionHtml: '<p>Un clásico.</p>', variants: { nodes: [{ id: 'v', price: '120000' }] } }] } }
    : { products: { nodes: [{ handle: 'jaguar-e-type-1965', title: 'JAGUAR E-TYPE 1965', status: 'DRAFT', tags: [], createdAt: new Date().toISOString(), featuredImage: null, variants: { nodes: [{ availableForSale: true, price: '120000' }] } }], pageInfo: { hasNextPage: false } } });
  // El borrador de Shopify sin ficha: «Editar ficha» abre la ventana, ya rellena con lo de Shopify
  const l = (await pag({ estado: 'sidonia', ver: 'proximamente' })).body;
  assert.match(l, /data-modal="\?estado=expediente&nuevo=1&h=jaguar-e-type-1965&parcial=1">Editar ficha/); assert.match(l, /<dialog class="md"/);
  const v = (await pag({ estado: 'expediente', nuevo: '1', h: 'jaguar-e-type-1965', parcial: '1' })).body;
  assert.doesNotMatch(v, /<html/); assert.match(v, /value="JAGUAR E-TYPE 1965"/); assert.match(v, /value="Jaguar"/); assert.match(v, /value="120000"/); assert.match(v, />Un clásico\.<\/textarea>/); assert.match(v, /value="60"/);
  assert.match(v, /Crear y enviar el contrato por WhatsApp/);
  // Guardar y enviar el contrato por WhatsApp: crea la ficha ligada al borrador y abre WhatsApp
  const r = await pag({ estado: 'expediente' }, 'POST', { accion: 'crear', enviar: 'wa', volver: 'sidonia', handle: 'jaguar-e-type-1965', c_titulo: 'JAGUAR E-TYPE 1965', p_nombre: 'Rosa Prueba', p_telefono: '600999888', p_email: 'rosa@ejemplo.es', c_marca: 'Jaguar', c_modelo: 'E-Type', c_anio: '1965', c_matricula: '1111AAA', k_pct: '6', k_dias: '90', k_salida: '120000' });
  const o = deps.operaciones.filas.at(-1);
  assert.equal(r.status, 302); assert.match(r.headers.Location, /^https:\/\/wa\.me\/34600999888/);
  assert.deepEqual([o.handle, o.expediente.condiciones.exclusividad_dias, o.expediente.contrato.via], ['jaguar-e-type-1965', 90, 'WhatsApp']);
  // La ventana de editar una ficha que ya existe, y guardar y enviar por email
  assert.match((await pag({ estado: 'expediente', id: String(o.id), parcial: 'editar' })).body, /value="Rosa Prueba"/);
  const g = await pag({ estado: 'expediente', id: String(o.id) }, 'POST', { accion: 'guardar', enviar: 'email', volver: 'sidonia', c_titulo: 'JAGUAR E-TYPE 1965', p_nombre: 'Rosa Prueba', p_telefono: '600999888', p_email: 'rosa@ejemplo.es', c_marca: 'Jaguar', c_modelo: 'E-Type', c_anio: '1965', c_matricula: '1111AAA', k_pct: '6', k_dias: '90', k_salida: '120000' });
  assert.equal(g.status, 303); assert.match(decodeURIComponent(g.headers.Location), /contrato enviado a rosa@ejemplo\.es/); assert.ok(correos.some((c) => c.to.includes('rosa@ejemplo.es')));
  // Vendido y su factura, de una vez, y enviada por email
  assert.match((await pag({ estado: 'expediente', id: String(o.id), parcial: 'vender' })).body, /Vendido y crear la factura/);
  const vf = await pag({ estado: 'expediente', id: String(o.id) }, 'POST', { accion: 'vender', facturar: 'email', volver: 'sidonia', precio_venta: '110.000', fecha_venta: '2026-12-01', d_nombre: 'Rosa Prueba', d_nif: '', d_direccion: 'Calle 1', pct: '6', base: '', iva_pct: '21', forma_pago: 'transferencia', numero: '2026-030', fecha: '2026-12-01', concepto: 'Gestión de Venta Jaguar E-Type' });
  assert.equal(vf.status, 303); assert.match(decodeURIComponent(vf.headers.Location), /¡Vendido! Factura 2026-030 creada\. Enviada a rosa@ejemplo\.es/);
  const f = deps.facturas.filas.at(-1);
  assert.deepEqual([o.estado, o.precio_venta, f.base, f.total, f.operacion_id], ['vendido', 110000, 6600, 7986, o.id]);
});
