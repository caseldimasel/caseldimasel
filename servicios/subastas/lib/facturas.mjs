/* SIDONIA · Panel › Ventas › Facturas: las facturas que emite Sidonia, enlazadas con su venta, y lo pagado a Hacienda.
 *
 *   ?estado=facturas[&csv=1]
 * Tabla facturas (sql/facturas.sql). Una factura «Gestión de venta…» se enlaza con su venta (por el importe de la
 * comisión, la fecha y el coche); las demás (marketing, asesoría…) son ingresos de otros servicios.
 * Hacienda, cada trimestre: lo facturado, el IVA cobrado, lo pagado (modelo 303 de IVA y 130 de IRPF, en Gastos con
 * categoría «IVA» e «Impuestos») y lo que eso dice de lo declarado: el IVA de los gastos y los gastos deducidos.
 */
import { esc } from './circulo.mjs';
import { fmt, n } from './estadisticas.mjs';
import { marco, normal } from './operaciones.mjs';
import { IRPF_PCT, trimestreDePago } from './gastos.mjs';

const euros = (x) => `${n(x).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' })} €`;
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const trimestre = (f) => `${String(f).slice(0, 4)}-T${Math.ceil(Number(String(f).slice(5, 7)) / 3)}`;
const nombreT = (t) => `${t.slice(6)}.º trimestre de ${t.slice(0, 4)}`;

/** Importar facturas pegando un CSV (o el archivo): numero;fecha;cliente;nif;concepto;base;iva;total (con cabecera; la
 *  fecha, 2026-01-20 o 20/01/2026; los importes, 1.700,00 o 1700.00). Los datos de clientes no van en el código: el
 *  repositorio es público. Devuelve { facturas, errores } */
export function leerCsvFacturas(texto) {
  const lineas = String(texto || '').replace(/^\ufeff/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lineas.length) return { facturas: [], errores: ['El archivo está vacío.'] };
  const sep = lineas[0].includes(';') ? ';' : lineas[0].includes('\t') ? '\t' : ',';
  const partir = (l) => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === sep && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()); };
  const cab = partir(lineas[0]).map((x) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
  const col = (k) => cab.findIndex((c) => c === k || c.startsWith(k));
  const idx = { numero: col('numero'), fecha: col('fecha'), cliente: col('cliente'), nif: col('nif'), concepto: col('concepto'), base: col('base'), iva: col('iva'), total: col('total') };
  if (idx.numero < 0 || idx.fecha < 0 || idx.base < 0) return { facturas: [], errores: ['Falta la cabecera: numero;fecha;cliente;nif;concepto;base;iva;total'] };
  const num = (v) => { const t = String(v || '').replace(/\s|€/g, ''); return Number(/,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')); };
  const fecha = (v) => { const t = String(v || ''); const a = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (a) return a[0]; const b = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); return b ? `${b[3].length === 2 ? `20${b[3]}` : b[3]}-${b[2].padStart(2, '0')}-${b[1].padStart(2, '0')}` : ''; };
  const facturas = [], errores = [];
  lineas.slice(1).forEach((l, i) => {
    const c = partir(l), v = (k) => (idx[k] >= 0 ? c[idx[k]] || '' : '');
    const f = { numero: v('numero').slice(0, 30), fecha: fecha(v('fecha')), cliente: v('cliente').slice(0, 160), nif: v('nif').toUpperCase().slice(0, 20), concepto: v('concepto').slice(0, 300), base: num(v('base')) };
    f.iva = idx.iva >= 0 && v('iva') !== '' ? num(v('iva')) : Math.round(f.base * 21) / 100;
    f.total = idx.total >= 0 && v('total') !== '' ? num(v('total')) : Math.round((f.base + f.iva) * 100) / 100;
    if (!f.numero || !f.fecha || !(f.base >= 0)) errores.push(`Línea ${i + 2}: falta el número, la fecha o la base.`);
    else facturas.push(f);
  });
  return { facturas, errores };
}

export const esDeVenta = (f) => /gesti[oó]n de venta/i.test(String(f.concepto || ''));

/** Lee el formulario: { factura } o { error } */
export function leerFactura(b) {
  const numero = String(b.numero || '').trim().slice(0, 30);
  if (!numero) return { error: 'Pon el número de factura.' };
  const fecha = String(b.fecha || '');
  if (!DIA.test(fecha)) return { error: 'Pon la fecha.' };
  const num = (v) => Number(String(v ?? '').replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  const base = num(b.base);
  if (!(base >= 0) || String(b.base ?? '').trim() === '') return { error: 'La base no es un número.' };
  const pct = String(b.iva_pct ?? '').trim() === '' ? 21 : num(b.iva_pct);
  if (!(pct >= 0 && pct <= 30)) return { error: 'El % de IVA no es válido.' };
  const iva = Math.round(base * pct) / 100;
  return { factura: { numero, fecha, cliente: String(b.cliente || '').trim().slice(0, 160), nif: String(b.nif || '').trim().toUpperCase().slice(0, 20), concepto: String(b.concepto || '').trim().slice(0, 300),
    base: Math.round(base * 100) / 100, iva, total: Math.round((base + iva) * 100) / 100, notas: String(b.notas || '').trim().slice(0, 300) } };
}

/** Las palabras del coche (sin «gestión», «venta», «vehículo», la matrícula…) */
const palabras = (t) => normal(t).split(' ').filter((w) => w.length >= 3 && !['gestion', 'venta', 'vehiculo', 'matricula'].includes(w) && !/^\d{4}$/.test(w));
/**
 * Para cada factura de una venta sin enlazar, la venta que es: la comisión igual a la base (o al total), la fecha de venta
 * cerca y el coche parecido. Devuelve [{ factura, op, puntos }] (cada venta, con una sola factura)
 */
export function emparejarFacturas(facturas, ops) {
  const usadas = new Set(facturas.map((f) => Number(f.operacion_id)).filter(Boolean));
  const pares = [];
  for (const f of facturas.filter((x) => !x.operacion_id && esDeVenta(x))) {
    const pf = palabras(f.concepto);
    for (const o of ops) {
      if (usadas.has(Number(o.id)) || o.modalidad === 'encargo') continue;
      const importe = n(o.comision) > 0 && (Math.abs(n(o.comision) - n(f.base)) <= 1 || Math.abs(n(o.comision) - n(f.total)) <= 1);
      const po = palabras(o.titulo);
      const comunes = pf.filter((w) => po.some((x) => x === w || (x.length >= 4 && w.length >= 4 && (x.startsWith(w) || w.startsWith(x))))).length;
      const dias = o.fecha_venta ? Math.abs(new Date(o.fecha_venta) - new Date(f.fecha)) / 864e5 : null;
      if (dias != null && dias > 90) continue;
      const puntos = (importe ? 3 : 0) + Math.min(2, comunes) + (dias != null && dias <= 45 ? 1 : 0);
      if (puntos >= 4 || (importe && dias != null && dias <= 45)) pares.push({ factura: f, op: o, puntos });
    }
  }
  pares.sort((a, b) => b.puntos - a.puntos);
  const hechas = new Set(), out = [];
  for (const p of pares) {
    if (hechas.has(p.factura.numero) || usadas.has(Number(p.op.id))) continue;
    hechas.add(p.factura.numero); usadas.add(Number(p.op.id)); out.push(p);
  }
  return out;
}

/**
 * Hacienda, por trimestre: { t, base, iva, ivaPagado, irpfPagado, ivaGastos, rendimiento, gastosDeclarados } — el IVA de
 * los gastos = el cobrado menos el pagado (modelo 303); con el IRPF pagado (modelo 130, que es acumulado en el año: el
 * 20 % del rendimiento desde enero menos lo ya pagado) sale el rendimiento declarado y, con lo facturado, los gastos deducidos
 */
export function hacienda(facturas, gastos) {
  const t = {};
  const de = (k) => (t[k] ||= { t: k, base: 0, iva: 0, facturas: 0, ivaPagado: null, irpfPagado: null });
  for (const f of facturas) { const x = de(trimestre(f.fecha)); x.base += n(f.base); x.iva += n(f.iva); x.facturas += 1; }
  for (const g of gastos.filter((x) => x.tipo === 'cargo' && ['IVA', 'Impuestos'].includes(x.categoria))) {
    const x = de(trimestreDePago(g.fecha));
    if (g.categoria === 'IVA') x.ivaPagado = (x.ivaPagado || 0) + n(g.importe); else x.irpfPagado = (x.irpfPagado || 0) + n(g.importe);
  }
  const lista = Object.values(t).sort((a, b) => a.t.localeCompare(b.t));
  const porAno = {};
  for (const x of lista) {
    const a = (porAno[x.t.slice(0, 4)] ||= { base: 0, pagado: 0, gastos: 0, completo: true });
    a.base += x.base;
    if (x.ivaPagado != null) x.ivaGastos = Math.round((x.iva - x.ivaPagado) * 100) / 100;
    if (x.irpfPagado != null && a.completo) {
      // Rendimiento desde enero = (lo pagado este trimestre + lo de antes) / 20 %
      const rendAcum = (x.irpfPagado + a.pagado) / (IRPF_PCT / 100);
      const gastosAcum = a.base - rendAcum;
      x.rendimiento = Math.round((rendAcum - (a.rend || 0)) * 100) / 100;
      x.gastosDeclarados = Math.round((gastosAcum - a.gastos) * 100) / 100;
      a.pagado += x.irpfPagado; a.gastos = gastosAcum; a.rend = rendAcum;
    } else a.completo = false;
    x.base = Math.round(x.base * 100) / 100; x.iva = Math.round(x.iva * 100) / 100;
  }
  return lista;
}

/** CSV (; y BOM, para Excel) */
export function csvFacturas(facturas, ops = []) {
  const celda = (v) => { const t = String(v ?? ''); return /[;"\n\r]/.test(t) || /^[=+\-@]/.test(t) ? `"${t.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : t; };
  const num = (x) => n(x).toFixed(2).replace('.', ',');
  const porId = new Map(ops.map((o) => [Number(o.id), o]));
  const cab = ['numero', 'fecha', 'cliente', 'nif', 'concepto', 'base', 'iva', 'total', 'trimestre', 'venta_id', 'venta'];
  const filas = facturas.map((f) => [f.numero, f.fecha, f.cliente, f.nif, f.concepto, num(f.base), num(f.iva), num(f.total), trimestre(f.fecha), f.operacion_id || '', porId.get(Number(f.operacion_id))?.titulo || ''].map(celda).join(';'));
  return `﻿${[cab.join(';'), ...filas].join('\r\n')}\r\n`;
}

/* ---------------------------------------------------------------------------- La página */
export function paginaFacturas(facturas, { ops = [], gastos = [], aviso = '', error = '', editar = null } = {}) {
  const porId = new Map(ops.map((o) => [Number(o.id), o]));
  const lista = [...facturas].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || String(b.numero).localeCompare(String(a.numero)));
  const H = hacienda(facturas, gastos);
  const suma = (k) => facturas.reduce((s, f) => s + n(f[k]), 0);
  const deVenta = facturas.filter(esDeVenta), sinEnlazar = deVenta.filter((f) => !f.operacion_id);
  const vendidas = ops.filter((o) => o.estado === 'vendido' && o.modalidad !== 'encargo');
  const conFactura = new Set(facturas.map((f) => Number(f.operacion_id)).filter(Boolean));
  const ivaPagado = H.reduce((s, x) => s + n(x.ivaPagado), 0), irpfPagado = H.reduce((s, x) => s + n(x.irpfPagado), 0);
  const opciones = (f) => `<select name="operacion_id"><option value="">— Sin venta (otro servicio) —</option>${ops.filter((o) => !conFactura.has(Number(o.id)) || Number(o.id) === Number(f.operacion_id)).map((o) => `<option value="${o.id}"${Number(o.id) === Number(f.operacion_id) ? ' selected' : ''}>${esc(o.titulo)}${o.fecha_venta ? ` · ${esc(String(o.fecha_venta).slice(0, 10))}` : ''}${n(o.comision) ? ` · comisión ${Math.round(n(o.comision))} €` : ''}</option>`).join('')}</select>`;
  const filas = lista.map((f) => { const o = porId.get(Number(f.operacion_id)); return `<tr>
    <td class="izq"><b>${esc(f.numero)}</b><span class="sub">${esc(String(f.fecha).slice(0, 10))}</span></td>
    <td class="izq">${esc(f.cliente)}<span class="sub">${esc(f.nif || '')}</span></td>
    <td class="izq">${esc(f.concepto)}${f.notas ? `<span class="sub">${esc(f.notas)}</span>` : ''}</td>
    <td>${euros(f.base)}</td><td>${euros(f.iva)}</td><td><b>${euros(f.total)}</b></td>
    <td class="izq">${o ? `<a href="?estado=operacion&id=${o.id}">${esc(o.titulo)}</a>${o.handle ? ` · <a href="?estado=anuncio&h=${encodeURIComponent(o.handle)}">anuncio</a>` : ''}` : esDeVenta(f) ? '<span style="color:#b45309">Sin enlazar con su venta</span>' : '<span class="sub">Otro servicio</span>'}
      <form method="post" action="?estado=facturas" class="enl"><input type="hidden" name="id" value="${f.id}">${opciones(f)}<button class="claro" name="accion" value="ligar">Guardar</button></form></td>
    <td><a href="?estado=facturas&editar=${f.id}">Cambiar</a></td></tr>`; }).join('');
  const form = (f = {}) => `<form method="post" action="?estado=facturas" class="op g-form">${f.id ? `<input type="hidden" name="id" value="${f.id}">` : ''}
    <label>N.º de factura<input name="numero" required value="${esc(f.numero || '')}" placeholder="2026-021"></label>
    <label>Fecha<input type="date" name="fecha" required value="${esc(String(f.fecha || new Date().toISOString()).slice(0, 10))}"></label>
    <label>Cliente<input name="cliente" value="${esc(f.cliente || '')}"></label><label>NIF / CIF<input name="nif" value="${esc(f.nif || '')}"></label>
    <label class="ancho">Concepto<input name="concepto" value="${esc(f.concepto || '')}" placeholder="Gestión de Venta Porsche 911 1234 ABC"></label>
    <label>Base imponible (€)<input name="base" required inputmode="decimal" value="${f.base != null ? esc(String(f.base).replace('.', ',')) : ''}"></label>
    <label>IVA (%)<input name="iva_pct" inputmode="decimal" value="${f.base ? esc(String(Math.round((n(f.iva) / n(f.base)) * 1000) / 10).replace('.', ',')) : '21'}"></label>
    <label class="ancho">Notas<input name="notas" value="${esc(f.notas || '')}"></label>
    <div class="acc"><button class="boton" name="accion" value="guardar">${f.id ? 'Guardar' : 'Añadir'}</button>${f.id ? `<a class="boton claro" href="?estado=facturas">Cancelar</a><button class="boton rojo no" name="accion" value="borrar" onclick="return confirm('¿Borrar la factura ${esc(f.numero)}?')">Borrar</button>` : ''}</div></form>`;
  const filasH = H.map((x) => `<tr><td class="izq"><b>${nombreT(x.t)}</b><span class="sub">${fmt(x.facturas)} facturas</span></td><td>${euros(x.base)}</td><td>${euros(x.iva)}</td>
    <td>${x.ivaPagado != null ? euros(x.ivaPagado) : '<span class="sub">sin pagar aún</span>'}</td><td>${x.ivaGastos != null ? euros(x.ivaGastos) : '—'}</td>
    <td>${x.irpfPagado != null ? euros(x.irpfPagado) : '<span class="sub">sin pagar aún</span>'}</td><td>${x.rendimiento != null ? euros(x.rendimiento) : '—'}</td><td>${x.gastosDeclarados != null ? euros(x.gastosDeclarados) : '—'}</td></tr>`).join('');
  return marco('Facturas', 'facturas', `
${aviso ? `<p class="aviso${/^Error/.test(aviso) ? ' mal' : ''}">${esc(aviso)}</p>` : ''}
${error ? `<p class="aviso mal">${esc(/facturas|relation|schema/.test(error) ? 'Falta crear la tabla de facturas: ejecuta sql/facturas.sql en Supabase › SQL Editor.' : error)}</p>` : ''}
${!error ? `<details class="card"${facturas.length ? '' : ' open'}><summary><b>Importar facturas (CSV)</b></summary><p>Pega aquí el CSV (o elige el archivo): <code>numero;fecha;cliente;nif;concepto;base;iva;total</code>, con esa cabecera. Las que ya estén (mismo número) no se repiten, y las de «Gestión de venta» se enlazan solas con su venta.</p>
  <form method="post" action="?estado=facturas"><input type="file" accept=".csv,.txt,text/csv" onchange="const f=this.files[0];if(f)f.text().then((t)=>{this.form.csv.value=t})"><textarea name="csv" rows="6" style="width:100%;margin:8px 0;font-family:ui-monospace,monospace;font-size:12px" placeholder="numero;fecha;cliente;nif;concepto;base;iva;total"></textarea><button class="boton" name="accion" value="importar">Importar</button></form></details>` : ''}
${editar ? `<div class="card"><h2>Cambiar la factura ${esc(editar.numero)}</h2>${form(editar)}</div>` : ''}
<div class="kpis">
  <div class="kpi"><span>Facturado</span><b>${euros(suma('base'))}</b><small>${fmt(facturas.length)} facturas · base imponible</small></div>
  <div class="kpi"><span>IVA cobrado</span><b>${euros(suma('iva'))}</b><small>en las facturas</small></div>
  <div class="kpi"><span>IVA pagado</span><b>${euros(ivaPagado)}</b><small>modelo 303</small></div>
  <div class="kpi"><span>IRPF pagado</span><b>${euros(irpfPagado)}</b><small>modelo 130</small></div>
  <div class="kpi"><span>Ventas con factura</span><b>${fmt(vendidas.filter((o) => conFactura.has(Number(o.id))).length)} de ${fmt(vendidas.length)}</b><small>${sinEnlazar.length ? `${fmt(sinEnlazar.length)} facturas de venta sin enlazar` : 'todas las facturas de venta, enlazadas'}</small></div>
</div>
${H.length ? `<div class="card"><h2>Hacienda, trimestre a trimestre</h2><div class="tabla"><table>
  <thead><tr><th class="izq">Trimestre</th><th>Facturado</th><th>IVA cobrado</th><th>IVA pagado</th><th>IVA de los gastos</th><th>IRPF pagado</th><th>Beneficio declarado</th><th>Gastos declarados</th></tr></thead><tbody>${filasH}</tbody></table></div>
  <p class="nota">El IVA pagado (modelo 303) es el IVA cobrado en las facturas menos el IVA de los gastos: la diferencia es el IVA de los gastos que se han deducido. El IRPF (modelo 130) es el ${IRPF_PCT} % del beneficio desde enero menos lo ya pagado ese año; de ahí sale el beneficio que se ha declarado cada trimestre y, restándolo de lo facturado, los gastos que la gestoría ha deducido. Si esos gastos son más que los del panel (Ventas › Gastos), pedid a la gestoría el libro de gastos para meterlos. Los pagos se ponen en Gastos: el IRPF con categoría «Impuestos» y el IVA con categoría «IVA».</p></div>` : ''}
<div class="card"><div class="barra" style="margin:0 0 8px"><h2 style="margin:0">Facturas</h2><a class="boton claro" href="?estado=facturas&csv=1">Descargar CSV</a></div><div class="tabla"><table>
  <thead><tr><th class="izq">Factura</th><th class="izq">Cliente</th><th class="izq">Concepto</th><th>Base</th><th>IVA</th><th>Total</th><th class="izq">Venta</th><th></th></tr></thead>
  <tbody>${filas || '<tr><td colspan="8" class="vacio">Aún no hay facturas.</td></tr>'}</tbody></table></div></div>
<div class="card"><h2>Añadir una factura</h2>${form()}</div>`, `
  .g-form { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; } .g-form .ancho, .g-form .acc { grid-column: 1 / -1; }
  form.enl { display: flex; gap: 6px; margin-top: 6px; } form.enl select { max-width: 260px; font-size: 13px; } form.enl button { padding: 6px 10px; font-size: 13px; }
  @media (max-width: 700px) { .g-form { grid-template-columns: 1fr; } }`);
}

/* ---------------------------------------------------------------------------- La ruta */
export async function rutasFacturas(req, { t, ops: tOps, gastos: tGastos }, html) {
  const b = req.body || {};
  let aviso = '', ops = [], gastos = [];
  try { ops = await tOps.leer('select=id,titulo,estado,modalidad,comision,fecha_venta,handle&limit=5000'); } catch (e) { ops = []; }
  try { gastos = (await tGastos.leer('select=tipo,categoria,importe,fecha&limit=20000')).map((g) => ({ ...g, fecha: String(g.fecha).slice(0, 10) })); } catch (e) { gastos = []; }
  const leer = async () => (await t.leer('select=*&order=fecha.asc&limit=5000')).map((f) => ({ ...f, fecha: String(f.fecha).slice(0, 10), base: n(f.base), iva: n(f.iva), total: n(f.total) }));
  // Las de venta sin enlazar se enlazan solas con su venta
  const enlazarSolas = async (lista) => { const pares = emparejarFacturas(lista, ops); for (const p of pares) await t.cambiar(p.factura.id, { operacion_id: Number(p.op.id) }); return pares.length; };
  if (req.method === 'POST') {
    try {
      if (b.accion === 'importar') {
        const { facturas: leidas, errores } = leerCsvFacturas(b.csv);
        const ya = await leer();
        const nuevas = leidas.filter((x) => !ya.some((f) => f.numero === x.numero));
        for (const f of nuevas) await t.guardar({ ...f, notas: '' }, 'id');
        const k = await enlazarSolas(await leer());
        aviso = `${errores.length && !nuevas.length ? 'Error: ' : ''}Importadas ${nuevas.length} facturas${leidas.length - nuevas.length ? ` (${leidas.length - nuevas.length} ya estaban)` : ''}${k ? `; ${k} enlazadas con su venta` : ''}.${errores.length ? ` ${errores.slice(0, 3).join(' ')}` : ''}`;
      } else if (b.accion === 'ligar' && Number(b.id)) {
        await t.cambiar(Number(b.id), { operacion_id: Number(b.operacion_id) || null }); aviso = 'Guardado.';
      } else if (b.accion === 'borrar' && Number(b.id)) {
        await t.borrar(`id=eq.${Number(b.id)}`); aviso = 'Factura borrada.';
      } else if (b.accion === 'guardar') {
        const { factura, error } = leerFactura(b);
        if (error) aviso = `Error: ${error}`;
        else if (Number(b.id)) { await t.cambiar(Number(b.id), factura); aviso = `Guardada la factura ${factura.numero}.`; }
        else { await t.guardar(factura, 'id'); const k = await enlazarSolas(await leer()); aviso = `Añadida la factura ${factura.numero}${k ? ', enlazada con su venta' : ''}.`; }
      }
    } catch (e) { aviso = `Error: ${/facturas|relation|schema/.test(e.message) ? 'falta crear la tabla: ejecuta sql/facturas.sql en Supabase › SQL Editor.' : /duplicate|unique/.test(e.message) ? 'ya hay una factura con ese número.' : e.message}`; }
  }
  let facturas = [], error = '';
  try { facturas = await leer(); } catch (e) { error = e.message; }
  if (req.query.csv) return { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="facturas-sidonia.csv"', 'Cache-Control': 'no-store' }, body: csvFacturas(facturas, ops) };
  const editar = Number(req.query.editar) ? facturas.find((f) => Number(f.id) === Number(req.query.editar)) || null : null;
  return html(paginaFacturas(facturas, { ops, gastos, aviso, error, editar }));
}
