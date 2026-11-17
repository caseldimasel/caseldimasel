/* SIDONIA · Panel › Ventas › Gastos: lo que gasta Sidonia cada mes.
 *
 *   ?estado=gastos[&csv=1]
 * Dos tipos (tabla gastos, sql/gastos.sql):
 *   cuota  lo que se paga cada mes (suscripciones): importe al mes desde una fecha (y hasta otra, si se dio de baja).
 *          «variable» si cambia cada mes (ManyChat, según los contactos): su importe es solo una estimación
 *   cargo  un cargo real del extracto, con su día y su importe (ManyChat, Shopify, gasolina…)
 * Cada mes y concepto: si hay cargos reales, cuentan esos (real); si no, la cuota (según la suscripción o estimado).
 * Ventas › Por meses resta los gastos de los ingresos (porMesGastos).
 */
import { esc } from './circulo.mjs';
import { fmt, n } from './estadisticas.mjs';
import { marco } from './operaciones.mjs';

const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const CATEGORIAS = ['Comercial', 'Autónomo', 'Impuestos', 'IVA', 'Gestoría y abogados', 'Web', 'Apps', 'Marketing', 'Banco', 'Transporte', 'Otros'];
/** IRPF: lo que se adelanta cada trimestre (modelo 130) es el 20 % del beneficio; mientras no se pongan los pagos reales, se reserva eso */
export const IRPF_PCT = 20;
const IRPF = `IRPF (reserva del ${IRPF_PCT} %)`;
const trimestre = (k) => `${k.slice(0, 4)}-T${Math.ceil(Number(k.slice(5)) / 3)}`;
/** El trimestre que paga un modelo 130 o 303 (se paga del 1 al 20 del mes siguiente: el del 20 de abril es el 1.er trimestre) */
export const trimestreDePago = (fecha) => { const d = new Date(`${String(fecha).slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 25); return trimestre(d.toISOString().slice(0, 7)); };
const euros = (x, dec = false) => `${n(x).toLocaleString('es-ES', { minimumFractionDigits: dec ? 2 : 0, maximumFractionDigits: dec ? 2 : 0, useGrouping: 'always' })} €`;
const mesDe = (f) => String(f || '').slice(0, 7);
const nombreMes = (k) => `${MES[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}`;
const siguiente = (k) => { const [a, m] = k.split('-').map(Number); return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`; };
const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** Los gastos de partida (noviembre de 2026): las suscripciones de cada mes y los cargos reales de ManyChat y Shopify del extracto */
export const GASTOS_INICIALES = [
  ...[['Squarespace', 'Web', 9.68, 'Web antigua y dominio'], ['Revolut Premium', 'Banco', 9.99, 'Plan de la cuenta'], ['Canva Pro', 'Apps', 12, ''], ['ChatGPT Plus', 'Apps', 22.99, ''],
    ['Claude Pro', 'Apps', 22, ''], ['Google One (Gmail 200 GB)', 'Apps', 2.99, ''], ['iCloud+ 200 GB', 'Apps', 2.99, ''], ['Meta Verified (Instagram)', 'Marketing', 16.99, '']]
    .map(([concepto, categoria, importe, notas]) => ({ tipo: 'cuota', concepto, categoria, importe, fecha: '2025-06-01', notas: notas || 'Desde junio de 2025' })),
  { tipo: 'cuota', concepto: 'Shopify', categoria: 'Web', importe: 49.5, fecha: '2026-03-01', notas: 'Plan de la tienda (cambia unos céntimos según el cambio)' },
  { tipo: 'cuota', concepto: 'ManyChat', categoria: 'Marketing', importe: 130, fecha: '2025-12-01', variable: true, notas: 'Según los contactos de cada mes: el plan el día 1 y dos cargos más a final de mes' },
  ...[['2026-03-17', 49.02], ['2026-04-12', 49.5], ['2026-05-12', 49.14], ['2026-06-11', 49.38], ['2026-07-11', 49.42], ['2026-08-10', 49.61], ['2026-09-09', 49.46], ['2026-10-09', 49.42], ['2026-11-08', 50.03]]
    .map(([fecha, importe]) => ({ tipo: 'cargo', concepto: 'Shopify', categoria: 'Web', importe, fecha, notas: 'Extracto Revolut' })),
  ...[['2025-12-01', 21.81], ['2025-12-26', 12.93], ['2026-01-01', 21.61], ['2026-01-26', 12.84], ['2026-02-01', 46.61], ['2026-02-26', 12.9], ['2026-03-01', 39.17], ['2026-03-26', 13.2],
    ['2026-04-01', 72.53], ['2026-04-26', 13], ['2026-05-01', 55.51], ['2026-05-26', 13.09], ['2026-06-01', 56.62], ['2026-06-26', 13.35], ['2026-07-01', 57.97], ['2026-07-26', 13.53],
    ['2026-08-01', 130.65], ['2026-08-26', 15.63], ['2026-08-29', 17.85], ['2026-09-01', 99.61], ['2026-09-26', 16.01], ['2026-09-29', 18.27], ['2026-10-01', 102.23], ['2026-10-26', 16.3],
    ['2026-10-29', 18.51], ['2026-11-01', 103.66]]
    .map(([fecha, importe]) => ({ tipo: 'cargo', concepto: 'ManyChat', categoria: 'Marketing', importe, fecha, notas: 'Extracto Revolut (cobrado en dólares)' })),
  // Autónomo: alta en enero de 2026; la primera cuota (tarifa plana) se cobró el 1 de abril. Desde enero de 2027, la normal
  { tipo: 'cuota', concepto: 'Cuota de autónomo', categoria: 'Autónomo', importe: 88.56, fecha: '2026-04-01', hasta: '2026-12-31', notas: 'Tarifa plana (alta en enero; la primera cuota se cobró el 1 de abril)' },
  { tipo: 'cuota', concepto: 'Cuota de autónomo', categoria: 'Autónomo', importe: 310, fecha: '2027-01-01', variable: true, notas: 'Se acaba la tarifa plana: más de 300 € (pon la cuota exacta cuando la sepas; si pasas a autónomo societario, la que diga la gestoría)' },
  // Gestoría: el alta en mayo y luego cada mes, sobre el día 6
  { tipo: 'cuota', concepto: 'Gestoría', categoria: 'Gestoría y abogados', importe: 48.4, fecha: '2026-05-01', notas: 'Gestión de autónomos, sobre el día 6' },
  ...[['2026-05-06', 104.8], ['2026-06-06', 48.4], ['2026-07-06', 48.4], ['2026-08-06', 48.4], ['2026-09-06', 48.4]]
    .map(([fecha, importe]) => ({ tipo: 'cargo', concepto: 'Gestoría', categoria: 'Gestoría y abogados', importe, fecha, notas: 'Sobre el día 6 de cada mes' })),
  // Abogado: no son fijos, pero se han pagado (los contratos, entre septiembre y octubre)
  { tipo: 'cargo', concepto: 'Abogado · contratos', categoria: 'Gestoría y abogados', importe: 325, fecha: '2026-09-15', notas: 'Álvaro Sánchez Yera: los contratos (650 € entre septiembre y octubre; reparto por confirmar)' },
  { tipo: 'cargo', concepto: 'Abogado · contratos', categoria: 'Gestoría y abogados', importe: 325, fecha: '2026-10-15', notas: 'Álvaro Sánchez Yera: los contratos (650 € entre septiembre y octubre; reparto por confirmar)' },
  { tipo: 'cargo', concepto: 'Abogado · crear la empresa', categoria: 'Gestoría y abogados', importe: 200, fecha: '2026-11-17', notas: 'Álvaro Sánchez Yera: constitución de la sociedad' },
  // Hacienda: el IRPF (modelo 130, «Tributo 130…») y el IVA (modelo 303, «Tributo 303…») de cada trimestre
  ...[['2026-04-20', 2111.37, 2354.59, '1.er'], ['2026-07-20', 2204.25, 3002.96, '2.º'], ['2026-10-20', 554.83, 1814.69, '3.er']].flatMap(([fecha, irpf, iva, t]) => [
    { tipo: 'cargo', concepto: 'IRPF (modelo 130)', categoria: 'Impuestos', importe: irpf, fecha, notas: `${t} trimestre de 2026` },
    { tipo: 'cargo', concepto: 'IVA (modelo 303)', categoria: 'IVA', importe: iva, fecha, notas: `${t} trimestre de 2026: el IVA cobrado en las facturas menos el de los gastos` }])
];
/** El mismo gasto (para no meter dos veces uno de partida) */
/** Los de partida de antes que se han corregido (si siguen como se cargaron, se quitan al añadir los nuevos) */
export const PARTIDA_CORREGIDOS = [
  { tipo: 'cuota', concepto: 'Cuota de autónomo', importe: 88.56, fecha: '2026-05-01' },
  ...['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'].map((fecha, i) => ({ tipo: 'cargo', concepto: 'Gestoría', importe: i ? 48.4 : 104.8, fecha })),
  { tipo: 'cargo', concepto: 'Abogado · contratos', importe: 650, fecha: '2026-10-15' }
];
const mismo = (a, b) => a.tipo === b.tipo && a.concepto === b.concepto && String(a.fecha).slice(0, 10) === b.fecha && Math.abs(n(a.importe) - n(b.importe)) < 0.005;

/**
 * Mes a mes: { meses: ['2025-06', …], conceptos: [{ concepto, categoria }], celdas: { '2026-10': { ManyChat: { importe, real } } },
 * total: { '2026-10': x }, porCategoria: { '2026-10': { Web: x } } } desde el primer gasto hasta hoy
 */
export function porMesGastos(gastos, hoy = new Date(), { ops = [], pagos = [], facturas = [] } = {}) {
  const ahora = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  const primero = gastos.map((g) => mesDe(g.fecha)).filter(Boolean).sort()[0];
  const meses = [];
  if (primero) for (let k = primero; k <= ahora; k = siguiente(k)) meses.push(k);
  const celdas = {}, total = {}, porCategoria = {}, conceptos = new Map();
  const poner = (k, g, importe, real) => {
    if (!meses.includes(k)) return;
    celdas[k] ||= {};
    const c = (celdas[k][g.concepto] ||= { importe: 0, real, variable: Boolean(g.variable) });
    c.importe = Math.round((c.importe + importe) * 100) / 100;
    total[k] = Math.round(((total[k] || 0) + importe) * 100) / 100;
    porCategoria[k] ||= {};
    porCategoria[k][g.categoria] = Math.round(((porCategoria[k][g.categoria] || 0) + importe) * 100) / 100;
    if (!conceptos.has(g.concepto)) conceptos.set(g.concepto, g.categoria);
  };
  const cargos = gastos.filter((g) => g.tipo === 'cargo');
  const conCargo = new Set(cargos.map((g) => `${mesDe(g.fecha)}|${g.concepto}`));
  // El IVA no es un gasto de Sidonia (se cobra en las facturas y se entrega a Hacienda): va aparte
  const iva = {};
  for (const g of cargos.filter((x) => x.categoria === 'IVA')) { const k = mesDe(g.fecha); iva[k] = Math.round(((iva[k] || 0) + n(g.importe)) * 100) / 100; }
  for (const g of cargos.filter((x) => x.categoria !== 'IVA')) poner(mesDe(g.fecha), g, n(g.importe), true);
  for (const g of gastos.filter((x) => x.tipo === 'cuota' && x.categoria !== 'IVA')) {
    const fin = g.hasta ? mesDe(g.hasta) : ahora;
    for (const k of meses) if (k >= mesDe(g.fecha) && k <= fin && !conCargo.has(`${k}|${g.concepto}`)) poner(k, g, n(g.importe), false);
  }
  // La comisión del comercial (Hugo) de cada venta, de Ventas: es un gasto de Sidonia
  const comercial = {};
  for (const o of ops) {
    if (o.estado !== 'vendido' || !o.fecha_venta || !n(o.comision_comercial)) continue;
    const k = mesDe(o.fecha_venta);
    poner(k, { concepto: `Comisión de ${o.comercial || 'comercial'}`, categoria: 'Comercial' }, n(o.comision_comercial), true);
    if (meses.includes(k)) comercial[k] = Math.round(((comercial[k] || 0) + n(o.comision_comercial)) * 100) / 100;
  }
  // Lo que entra cada mes (comisión de las ventas + lo cobrado a la comunidad) y el IRPF: si en el trimestre hay pagos
  // reales («Impuestos»), cuentan esos; si no, se reserva el 20 % del beneficio del mes
  const ingresos = {};
  for (const o of ops) if (o.estado === 'vendido' && o.fecha_venta) { const k = mesDe(o.fecha_venta); ingresos[k] = (ingresos[k] || 0) + n(o.comision); }
  for (const p of pagos) if (p.fecha) { const k = mesDe(p.fecha); ingresos[k] = (ingresos[k] || 0) + n(p.importe); }
  // Las facturas de otros servicios (marketing, asesoría…: las que no son de una venta) también son ingresos
  for (const f of facturas) if (f.fecha && !f.operacion_id) { const k = mesDe(f.fecha); ingresos[k] = (ingresos[k] || 0) + n(f.base); }
  const conImpuestos = new Set(cargos.filter((g) => g.categoria === 'Impuestos').map((g) => trimestreDePago(g.fecha)));
  const irpf = {}, beneficio = {};
  for (const k of meses) {
    beneficio[k] = Math.round((n(ingresos[k]) - n(total[k])) * 100) / 100;
    if (conImpuestos.has(trimestre(k)) || beneficio[k] <= 0) continue;
    irpf[k] = Math.round(beneficio[k] * IRPF_PCT) / 100;
    poner(k, { concepto: IRPF, categoria: 'Impuestos', variable: true }, irpf[k], false);
  }
  const orden = [...conceptos.entries()].sort((a, b) => CATEGORIAS.indexOf(a[1]) - CATEGORIAS.indexOf(b[1]) || a[0].localeCompare(b[0]));
  // resto: lo que no es ni el comercial ni la reserva de IRPF (Por meses los pone aparte)
  const resto = Object.fromEntries(meses.map((k) => [k, Math.round((n(total[k]) - n(comercial[k]) - n(irpf[k])) * 100) / 100]));
  return { meses, conceptos: orden.map(([concepto, categoria]) => ({ concepto, categoria })), celdas, total, porCategoria, ahora, comercial, irpf, resto, ingresos, beneficio, iva };
}

/** Los próximos meses: lo que costarán las cuotas (las que empiezan, acaban o suben), sin cargos sueltos ni impuestos */
export function prevision(gastos, hoy = new Date(), cuantos = 12) {
  const ahora = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  const activas = (k) => gastos.filter((g) => g.tipo === 'cuota' && mesDe(g.fecha) <= k && (!g.hasta || mesDe(g.hasta) >= k));
  const out = [];
  let k = ahora, antes = activas(ahora);
  for (let i = 0; i < cuantos; i += 1) {
    k = siguiente(k);
    const a = activas(k);
    const empiezan = a.filter((g) => !antes.includes(g)), acaban = antes.filter((g) => !a.includes(g));
    out.push({ mes: k, importe: Math.round(a.reduce((s, g) => s + n(g.importe), 0) * 100) / 100, empiezan, acaban });
    antes = a;
  }
  return out;
}

/** Lo que se paga al mes ahora en cuotas (las activas) */
export const cuotasAlMes = (gastos, hoy = new Date()) => {
  const d = hoy.toISOString().slice(0, 10);
  return gastos.filter((g) => g.tipo === 'cuota' && String(g.fecha) <= d && (!g.hasta || String(g.hasta) >= d)).reduce((s, g) => s + n(g.importe), 0);
};

/** Lee el formulario: { gasto } o { error } */
export function leerGasto(b) {
  const tipo = b.tipo === 'cuota' ? 'cuota' : 'cargo';
  const concepto = String(b.concepto || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (concepto.length < 2) return { error: 'Pon el concepto (ManyChat, Shopify, gasolina…).' };
  const importe = Number(String(b.importe ?? '').replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  if (!(importe >= 0) || String(b.importe ?? '').trim() === '') return { error: 'El importe no es un número.' };
  const fecha = String(b.fecha || '');
  if (!DIA.test(fecha)) return { error: tipo === 'cuota' ? 'Pon desde cuándo se paga.' : 'Pon la fecha del cargo.' };
  const hasta = tipo === 'cuota' && DIA.test(String(b.hasta || '')) ? String(b.hasta) : null;
  if (hasta && hasta < fecha) return { error: '«Hasta» es antes de «desde».' };
  return { gasto: { tipo, concepto, categoria: CATEGORIAS.includes(b.categoria) ? b.categoria : 'Otros', importe: Math.round(importe * 100) / 100, fecha, hasta,
    variable: tipo === 'cuota' && Boolean(b.variable), notas: String(b.notas || '').trim().slice(0, 300) } };
}

/** CSV (; y BOM, para Excel): cada gasto, y el resumen mes a mes */
export function csvGastos(gastos, hoy = new Date(), extra = {}) {
  const celda = (v) => { const t = String(v ?? ''); return /[;"\n\r]/.test(t) || /^[=+\-@]/.test(t) ? `"${t.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : t; };
  const num = (x) => n(x).toFixed(2).replace('.', ',');
  const r = porMesGastos(gastos, hoy, extra);
  const filas = [['mes', 'concepto', 'categoria', 'importe', 'origen'].join(';')];
  for (const k of r.meses) for (const c of r.conceptos) { const x = r.celdas[k]?.[c.concepto]; if (x) filas.push([k, c.concepto, c.categoria, num(x.importe), x.real ? 'cargo real' : x.variable ? 'estimado' : 'cuota'].map(celda).join(';')); }
  return `﻿${filas.join('\r\n')}\r\n`;
}

/* ---------------------------------------------------------------------------- La página */
export function paginaGastos(gastos, { aviso = '', error = '', hoy = new Date(), editar = null, ops = [], pagos = [], facturas = [] } = {}) {
  const r = porMesGastos(gastos, hoy, { ops, pagos, facturas });
  const faltan = GASTOS_INICIALES.filter((x) => !gastos.some((g) => mismo(g, x)));
  const corregir = gastos.filter((g) => PARTIDA_CORREGIDOS.some((x) => mismo(g, x)));
  const prev = prevision(gastos, hoy);
  const k = r.ahora, kAnt = r.meses[r.meses.length - 2];
  const cerrados = r.meses.filter((x) => x < k).slice(-12);
  const media = cerrados.length ? cerrados.reduce((s, x) => s + n(r.total[x]), 0) / cerrados.length : 0;
  const totalTodo = r.meses.reduce((s, x) => s + n(r.total[x]), 0);
  const max = Math.max(1, ...r.meses.map((x) => n(r.total[x])));
  const grafica = r.meses.length ? `<div class="g-graf">${r.meses.map((x) => `<div title="${nombreMes(x)}: ${euros(r.total[x], true)}"><span class="v">${Math.round(n(r.total[x]))}</span><i style="height:${Math.max(3, Math.round((n(r.total[x]) / max) * 140))}px"${x === k ? ' class="curso"' : ''}></i><small>${MES[Number(x.slice(5)) - 1].slice(0, 3)}${x.endsWith('-01') || x === r.meses[0] ? `<br>${x.slice(2, 4)}` : ''}</small></div>`).join('')}</div>` : '';
  const cab = r.conceptos.map((c) => `<th>${esc(c.concepto)}<span class="sub">${esc(c.categoria)}</span></th>`).join('');
  const filas = [...r.meses].reverse().map((x) => `<tr${x === k ? ' class="este"' : ''}><td class="izq"><b>${nombreMes(x)}</b>${x === k ? '<span class="sub">en curso</span>' : ''}</td>${r.conceptos.map((c) => {
    const v = r.celdas[x]?.[c.concepto];
    return `<td>${v ? `${euros(v.importe, true)}${v.real ? '' : `<span class="sub">${v.variable ? 'estimado' : 'cuota'}</span>`}` : '—'}</td>`;
  }).join('')}<td><b>${euros(r.total[x], true)}</b></td></tr>`).join('');
  const cuotas = gastos.filter((g) => g.tipo === 'cuota').sort((a, b) => CATEGORIAS.indexOf(a.categoria) - CATEGORIAS.indexOf(b.categoria) || a.concepto.localeCompare(b.concepto));
  const cargos = gastos.filter((g) => g.tipo === 'cargo').sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || b.id - a.id);
  const sel = (v) => `<select name="categoria">${CATEGORIAS.map((c) => `<option${c === v ? ' selected' : ''}>${c}</option>`).join('')}</select>`;
  const borrar = (g) => `<form method="post" action="?estado=gastos" style="display:inline"><input type="hidden" name="id" value="${g.id}"><button class="lnk" name="accion" value="borrar" onclick="return confirm('¿Borrar «${esc(g.concepto).replace(/'/g, '')}»?')">Borrar</button></form>`;
  const form = (g = {}) => `<form method="post" action="?estado=gastos" class="op g-form">
    ${g.id ? `<input type="hidden" name="id" value="${g.id}">` : ''}
    <label>Tipo<select name="tipo"><option value="cargo"${g.tipo !== 'cuota' ? ' selected' : ''}>Un cargo (con su día)</option><option value="cuota"${g.tipo === 'cuota' ? ' selected' : ''}>Cuota de cada mes</option></select></label>
    <label>Concepto<input name="concepto" required value="${esc(g.concepto || '')}" placeholder="ManyChat, Shopify, gasolina…" list="g-conceptos"></label>
    <label>Categoría${sel(g.categoria || 'Otros')}</label>
    <label>Importe (€)<input name="importe" required inputmode="decimal" value="${g.importe != null ? esc(String(g.importe).replace('.', ',')) : ''}" placeholder="12,50"></label>
    <label>Fecha (cargo) o desde (cuota)<input type="date" name="fecha" required value="${esc(String(g.fecha || hoy.toISOString().slice(0, 10)).slice(0, 10))}"></label>
    <label>Hasta (cuota dada de baja)<input type="date" name="hasta" value="${esc(String(g.hasta || '').slice(0, 10))}"></label>
    <label class="ancho"><span><input type="checkbox" name="variable" value="1"${g.variable ? ' checked' : ''}> Cuota que cambia cada mes (el importe es una estimación hasta que pongas los cargos)</span></label>
    <label class="ancho">Notas<input name="notas" value="${esc(g.notas || '')}"></label>
    <div class="acc"><button class="boton" name="accion" value="guardar">${g.id ? 'Guardar' : 'Añadir'}</button>${g.id ? '<a class="boton claro" href="?estado=gastos">Cancelar</a>' : ''}</div>
    <datalist id="g-conceptos">${[...new Set(gastos.map((x) => x.concepto))].map((c) => `<option value="${esc(c)}">`).join('')}</datalist></form>`;
  return marco('Gastos', 'gastos', `
${aviso ? `<p class="aviso${/^Error/.test(aviso) ? ' mal' : ''}">${esc(aviso)}</p>` : ''}
${error ? `<p class="aviso mal">${esc(/gastos|relation|schema/.test(error) ? 'Falta crear la tabla de gastos: ejecuta sql/gastos.sql en Supabase › SQL Editor.' : error)}</p>` : ''}
${!error && (faltan.length || corregir.length) ? `<div class="card"><h2>${gastos.length ? 'Gastos de partida nuevos' : 'Empezar'}</h2><p>${gastos.length ? `Hay ${faltan.length} gastos de partida que aún no están: ${esc([...new Set(faltan.map((x) => x.concepto))].join(', '))}.` : 'Carga los gastos de partida: las suscripciones (desde junio de 2025), Shopify y ManyChat con sus cargos del extracto, la cuota de autónomo, la gestoría y el abogado.'} Luego los cambias o añades lo que falte.</p>
  <form method="post" action="?estado=gastos"><button class="boton" name="accion" value="iniciales">${gastos.length ? `Añadir los ${faltan.length} que faltan${corregir.length ? ` y corregir ${corregir.length}` : ''}` : 'Cargar los gastos de partida'}</button></form></div>` : ''}
${editar ? `<div class="card"><h2>Cambiar «${esc(editar.concepto)}»</h2>${form(editar)}</div>` : ''}
<div class="kpis">
  <div class="kpi"><span>Este mes</span><b>${euros(r.total[k])}</b><small>${nombreMes(k)} · en curso</small></div>
  <div class="kpi"><span>Mes pasado</span><b>${euros(kAnt ? r.total[kAnt] : 0)}</b><small>${kAnt ? nombreMes(kAnt) : '—'}</small></div>
  <div class="kpi"><span>Media al mes</span><b>${euros(media)}</b><small>últimos ${cerrados.length} meses cerrados</small></div>
  <div class="kpi"><span>Cuotas al mes</span><b>${euros(cuotasAlMes(gastos, hoy))}</b><small>suscripciones activas${cuotas.some((g) => g.variable) ? ' (ManyChat estimado)' : ''}</small></div>
  <div class="kpi"><span>Total</span><b>${euros(totalTodo)}</b><small>${r.meses.length ? `desde ${nombreMes(r.meses[0])}` : 'aún sin gastos'}</small></div>
</div>
${grafica ? `<div class="card"><h2>Mes a mes</h2>${grafica}</div>` : ''}
${r.meses.length ? `<div class="card"><div class="barra" style="margin:0 0 8px"><h2 style="margin:0">Cada mes, por concepto</h2><a class="boton claro" href="?estado=gastos&csv=1">Descargar CSV</a></div><div class="tabla"><table>
  <thead><tr><th class="izq">Mes</th>${cab}<th>Total</th></tr></thead><tbody>${filas}</tbody></table></div>
  <p class="nota">Sin nota debajo: cargos reales (del extracto, o la comisión del comercial de cada venta, de Ventas). «Cuota»: lo que cuesta ese mes. «Estimado»: un gasto que cambia (ManyChat) del que aún no hay cargos, o la reserva de IRPF: el ${IRPF_PCT} % del beneficio del mes (lo que entra menos estos gastos), que es lo que se adelanta cada trimestre con el modelo 130. Cuando paguéis el IRPF de un trimestre, ponedlo como cargo con categoría «Impuestos» y sustituye a la reserva de ese trimestre.</p></div>` : ''}
<div class="card"><h2>Lo que viene: los próximos 12 meses</h2>
  <div class="tabla"><table><thead><tr><th class="izq">Mes</th><th>Cuotas</th><th class="izq">Qué cambia</th></tr></thead><tbody>
  ${prev.map((x, i) => { const d = x.importe - (i ? prev[i - 1].importe : cuotasAlMes(gastos, hoy)); return `<tr${x.empiezan.length || x.acaban.length ? ' class="cambia"' : ''}><td class="izq"><b>${nombreMes(x.mes)}</b></td><td>${euros(x.importe, true)}${Math.abs(d) >= 0.01 ? `<span class="sub" style="color:var(${d > 0 ? '--rojo' : '--verde'})">${d > 0 ? '+' : '−'}${euros(Math.abs(d), true)}</span>` : ''}</td>
    <td class="izq">${[...x.empiezan.map((g) => `empieza ${esc(g.concepto)} (${euros(g.importe, true)}${g.variable ? ', estimado' : ''})`), ...x.acaban.map((g) => `acaba ${esc(g.concepto)} (${euros(g.importe, true)})`)].join(' · ') || '—'}</td></tr>`; }).join('')}
  </tbody></table></div>
  <p class="nota">Solo las cuotas (sin cargos sueltos ni impuestos). Para que salga aquí algo que va a cambiar, pon su cuota con la fecha en que empieza (y en la vieja, «hasta»).</p>
  <div class="empresa"><b>Al pasar a empresa (sociedad), se encarece:</b> añade cada cosa como cuota desde el mes en que empiece, con lo que os digan.
    <ul><li><b>Autónomo societario</b>: la cuota sube (la base mínima del societario es más alta que la del autónomo normal).</li><li><b>Gestoría de la sociedad</b>: contabilidad, impuesto de sociedades, cuentas anuales.</li><li><b>Abogado</b>: lo que os cobre cada mes o por trabajo.</li>
    <li><b>Constitución</b>: notaría, registro mercantil y la cuenta de empresa (cargos sueltos).</li><li><b>Impuesto de sociedades</b>: lo pagará la sociedad sobre su beneficio (lo pondrá la gestoría).</li></ul></div></div>
<div class="grid2">
  <div class="card"><h2>Cuotas de cada mes</h2><div class="tabla"><table><thead><tr><th class="izq">Concepto</th><th>Al mes</th><th class="izq">Desde</th><th class="izq">Hasta</th><th></th></tr></thead><tbody>
    ${cuotas.map((g) => `<tr><td class="izq"><b>${esc(g.concepto)}</b><span class="sub">${esc(g.categoria)}${g.variable ? ' · cambia cada mes' : ''}${g.notas ? ` · ${esc(g.notas)}` : ''}</span></td><td>${euros(g.importe, true)}</td><td class="izq">${esc(String(g.fecha).slice(0, 10))}</td><td class="izq">${g.hasta ? esc(String(g.hasta).slice(0, 10)) : 'sigue'}</td><td><a href="?estado=gastos&editar=${g.id}">Cambiar</a> · ${borrar(g)}</td></tr>`).join('') || '<tr><td colspan="5" class="vacio">Sin cuotas.</td></tr>'}
  </tbody></table></div></div>
  <div class="card"><h2>Añadir un gasto</h2>${form()}</div>
</div>
<div class="card" style="margin-top:14px"><h2>Cargos</h2><div class="tabla"><table><thead><tr><th class="izq">Fecha</th><th class="izq">Concepto</th><th>Importe</th><th class="izq">Notas</th><th></th></tr></thead><tbody>
  ${cargos.slice(0, 300).map((g) => `<tr><td class="izq">${esc(String(g.fecha).slice(0, 10))}</td><td class="izq"><b>${esc(g.concepto)}</b><span class="sub">${esc(g.categoria)}</span></td><td>${euros(g.importe, true)}</td><td class="izq">${esc(g.notas || '')}</td><td><a href="?estado=gastos&editar=${g.id}">Cambiar</a> · ${borrar(g)}</td></tr>`).join('') || '<tr><td colspan="5" class="vacio">Sin cargos.</td></tr>'}
</tbody></table></div></div>
<p class="nota">Cada mes y concepto: si hay cargos reales, cuentan esos; si no, su cuota. Ventas › Por meses resta estos gastos de los ingresos.</p>`, `
  .g-graf { display: flex; gap: 6px; align-items: flex-end; overflow-x: auto; padding-top: 8px; }
  .g-graf > div { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 34px; }
  .g-graf i { display: block; width: 18px; border-radius: 4px 4px 1px 1px; background: var(--rojo, #e5484d); opacity: .85; } .g-graf i.curso { opacity: .45; }
  .g-graf .v { font-size: 11px; color: var(--suave); } .g-graf small { font-size: 11px; color: var(--flojo); text-align: center; line-height: 1.2; }
  tr.este td { background: var(--verde-fondo); } tr.cambia td { background: var(--rojo-fondo, rgba(229,72,77,.08)); }
  .empresa { margin-top: 12px; padding: 12px 14px; border-radius: 12px; border: 1px dashed var(--linea-2, #555); font-size: 14px; line-height: 1.5; } .empresa ul { margin: 6px 0 0; padding-left: 18px; }
  .g-form { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; } .g-form .ancho, .g-form .acc { grid-column: 1 / -1; }
  button.lnk { display: inline; background: none; border: 0; padding: 0; color: var(--rojo) !important; text-decoration: underline; cursor: pointer; font: inherit; font-weight: 400; letter-spacing: 0; }
  .g-form .ancho span { display: flex; gap: 8px; align-items: flex-start; } .g-form input[type=checkbox] { width: auto; margin-top: 3px; }
  @media (max-width: 700px) { .g-form { grid-template-columns: 1fr; } }`);
}

/* ---------------------------------------------------------------------------- La ruta */
export async function rutasGastos(req, { t, ops: tOps = null, pagos: tPagos = null, facturas: tFacturas = null }, html) {
  const b = req.body || {};
  let aviso = '', editar = null;
  if (req.method === 'POST') {
    try {
      if (b.accion === 'iniciales') {
        const ya = (await t.leer('select=*&limit=20000')).map((g) => ({ ...g, fecha: String(g.fecha).slice(0, 10) }));
        // Los de partida que se han corregido (si nadie los ha cambiado) se quitan, y se añaden los que faltan
        const viejos = ya.filter((g) => PARTIDA_CORREGIDOS.some((x) => mismo(g, x)));
        for (const g of viejos) await t.borrar(`id=eq.${Number(g.id)}`);
        const nuevos = GASTOS_INICIALES.filter((x) => !ya.some((g) => mismo(g, x)));
        for (const g of nuevos) await t.guardar({ hasta: null, variable: false, ...g }, 'id');
        aviso = nuevos.length || viejos.length ? `Añadidos ${nuevos.length} gastos de partida${viejos.length ? ` (y corregidos ${viejos.length} de antes)` : ''}.` : 'Ya estaban todos.';
      } else if (b.accion === 'borrar' && Number(b.id)) {
        await t.borrar(`id=eq.${Number(b.id)}`); aviso = 'Borrado.';
      } else if (b.accion === 'guardar') {
        const { gasto, error } = leerGasto(b);
        if (error) aviso = `Error: ${error}`;
        else if (Number(b.id)) { await t.cambiar(Number(b.id), gasto); aviso = `Guardado: ${gasto.concepto}.`; }
        else { await t.guardar(gasto, 'id'); aviso = `Añadido: ${gasto.concepto}, ${euros(gasto.importe, true)}.`; }
      }
    } catch (e) { aviso = `Error: ${/gastos|relation|schema/.test(e.message) ? 'falta crear la tabla: ejecuta sql/gastos.sql en Supabase › SQL Editor.' : e.message}`; }
  }
  let gastos = [], error = '';
  try { gastos = await t.leer('select=*&order=fecha.asc&limit=20000'); } catch (e) { error = e.message; }
  gastos = gastos.map((g) => ({ ...g, importe: n(g.importe), fecha: String(g.fecha).slice(0, 10), hasta: g.hasta ? String(g.hasta).slice(0, 10) : null }));
  if (req.query.csv) {
    let ops = [], pagos = [];
    try { if (tOps) ops = await tOps.leer('select=estado,fecha_venta,comision,comision_comercial,comercial&limit=5000'); } catch (e) { ops = []; }
    try { if (tPagos) pagos = await tPagos.leer('select=fecha,importe&limit=20000'); } catch (e) { pagos = []; }
    return { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="gastos-sidonia.csv"', 'Cache-Control': 'no-store' }, body: csvGastos(gastos, new Date(), { ops, pagos }) };
  }
  if (Number(req.query.editar)) editar = gastos.find((g) => g.id === Number(req.query.editar)) || null;
  let ops = [], pagos = [];
  try { if (tOps) ops = await tOps.leer('select=estado,fecha_venta,comision,comision_comercial,comercial&limit=5000'); } catch (e) { ops = []; }
  try { if (tPagos) pagos = await tPagos.leer('select=fecha,importe&limit=20000'); } catch (e) { pagos = []; }
  let facturas = [];
  try { if (tFacturas) facturas = await tFacturas.leer('select=fecha,base,operacion_id&limit=5000'); } catch (e) { facturas = []; }
  return html(paginaGastos(gastos, { aviso, error, editar, ops, pagos, facturas }));
}
