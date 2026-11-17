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
export const CATEGORIAS = ['Web', 'Apps', 'Marketing', 'Banco', 'Transporte', 'Gestoría', 'Otros'];
const euros = (x, dec = false) => `${n(x).toLocaleString('es-ES', { minimumFractionDigits: dec ? 2 : 0, maximumFractionDigits: dec ? 2 : 0 })} €`;
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
    .map(([fecha, importe]) => ({ tipo: 'cargo', concepto: 'ManyChat', categoria: 'Marketing', importe, fecha, notas: 'Extracto Revolut (cobrado en dólares)' }))
];

/**
 * Mes a mes: { meses: ['2025-06', …], conceptos: [{ concepto, categoria }], celdas: { '2026-10': { ManyChat: { importe, real } } },
 * total: { '2026-10': x }, porCategoria: { '2026-10': { Web: x } } } desde el primer gasto hasta hoy
 */
export function porMesGastos(gastos, hoy = new Date()) {
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
  for (const g of cargos) poner(mesDe(g.fecha), g, n(g.importe), true);
  for (const g of gastos.filter((x) => x.tipo === 'cuota')) {
    const fin = g.hasta ? mesDe(g.hasta) : ahora;
    for (const k of meses) if (k >= mesDe(g.fecha) && k <= fin && !conCargo.has(`${k}|${g.concepto}`)) poner(k, g, n(g.importe), false);
  }
  const orden = [...conceptos.entries()].sort((a, b) => CATEGORIAS.indexOf(a[1]) - CATEGORIAS.indexOf(b[1]) || a[0].localeCompare(b[0]));
  return { meses, conceptos: orden.map(([concepto, categoria]) => ({ concepto, categoria })), celdas, total, porCategoria, ahora };
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
export function csvGastos(gastos, hoy = new Date()) {
  const celda = (v) => { const t = String(v ?? ''); return /[;"\n\r]/.test(t) || /^[=+\-@]/.test(t) ? `"${t.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : t; };
  const num = (x) => n(x).toFixed(2).replace('.', ',');
  const r = porMesGastos(gastos, hoy);
  const filas = [['mes', 'concepto', 'categoria', 'importe', 'origen'].join(';')];
  for (const k of r.meses) for (const c of r.conceptos) { const x = r.celdas[k]?.[c.concepto]; if (x) filas.push([k, c.concepto, c.categoria, num(x.importe), x.real ? 'cargo real' : x.variable ? 'estimado' : 'cuota'].map(celda).join(';')); }
  return `﻿${filas.join('\r\n')}\r\n`;
}

/* ---------------------------------------------------------------------------- La página */
export function paginaGastos(gastos, { aviso = '', error = '', hoy = new Date(), editar = null } = {}) {
  const r = porMesGastos(gastos, hoy);
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
${!error && !gastos.length ? `<div class="card"><h2>Empezar</h2><p>Carga los gastos fijos de partida: las suscripciones (Squarespace, Revolut, Canva, ChatGPT, Claude, Google, iCloud y Meta Verified, desde junio de 2025), Shopify desde marzo de 2026 y ManyChat desde diciembre de 2025, con todos sus cargos reales del extracto. Luego los cambias o añades lo que falte.</p>
  <form method="post" action="?estado=gastos"><button class="boton" name="accion" value="iniciales">Cargar los gastos fijos de partida</button></form></div>` : ''}
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
  <p class="nota">Sin nota debajo: cargos reales del extracto. «Cuota»: lo que cuesta la suscripción ese mes. «Estimado»: un gasto que cambia (ManyChat) del que aún no has puesto los cargos.</p></div>` : ''}
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
  tr.este td { background: var(--verde-fondo); }
  .g-form { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; } .g-form .ancho, .g-form .acc { grid-column: 1 / -1; }
  button.lnk { display: inline; background: none; border: 0; padding: 0; color: var(--rojo) !important; text-decoration: underline; cursor: pointer; font: inherit; font-weight: 400; letter-spacing: 0; }
  .g-form .ancho span { display: flex; gap: 8px; align-items: flex-start; } .g-form input[type=checkbox] { width: auto; margin-top: 3px; }
  @media (max-width: 700px) { .g-form { grid-template-columns: 1fr; } }`);
}

/* ---------------------------------------------------------------------------- La ruta */
export async function rutasGastos(req, t, html) {
  const b = req.body || {};
  let aviso = '', editar = null;
  if (req.method === 'POST') {
    try {
      if (b.accion === 'iniciales') {
        const ya = await t.leer('select=id&limit=1');
        if (ya.length) aviso = 'Error: ya hay gastos; añade lo que falte a mano.';
        else { for (const g of GASTOS_INICIALES) await t.guardar({ hasta: null, variable: false, ...g }, 'id'); aviso = `Cargados ${GASTOS_INICIALES.length} gastos de partida.`; }
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
  if (req.query.csv) return { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="gastos-sidonia.csv"', 'Cache-Control': 'no-store' }, body: csvGastos(gastos) };
  if (Number(req.query.editar)) editar = gastos.find((g) => g.id === Number(req.query.editar)) || null;
  return html(paginaGastos(gastos, { aviso, error, editar }));
}
