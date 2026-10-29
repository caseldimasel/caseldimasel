/* SIDONIA · Panel › Ventas › Por meses: cada mes con lo vendido, lo facturado, la comisión, lo del comercial, el neto
 * de Sidonia, lo cobrado a la comunidad, y cómo va frente al mes anterior y al mismo mes del año pasado.
 *   ?estado=meses[&ano=2026]
 * Una venta cuenta en el mes de su fecha de venta; un anuncio nuevo, en el de su fecha de alta. Lo de la comunidad sale
 * de pagos (sql/comunidad.sql): si aún no está, esa columna va a cero.
 */
import { esc } from './circulo.mjs';
import { fmt, n } from './estadisticas.mjs';
import { marco, TIPOS_OP } from './operaciones.mjs';

const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const euros = (x) => `${Math.round(n(x)).toLocaleString('es-ES')} €`;
const clave = (f) => String(f || '').slice(0, 7);   // «2026-10»

/** Los números de cada mes: { '2026-10': { vendidos, facturado, comision, comercial, neto, comunidad, total, altas, dias, ticket, porTipo } } */
export function porMeses(ops, pagos = []) {
  const m = {};
  const mes = (k) => (m[k] ||= { vendidos: 0, facturado: 0, comision: 0, comercial: 0, neto: 0, comunidad: 0, total: 0, altas: 0, tiempos: [], porTipo: {} });
  for (const o of ops) {
    if (o.fecha_alta) mes(clave(o.fecha_alta)).altas += 1;
    if (o.estado !== 'vendido' || !o.fecha_venta) continue;
    const x = mes(clave(o.fecha_venta));
    x.vendidos += 1;
    x.facturado += n(o.precio_venta ?? o.precio_anunciado);
    x.comision += n(o.comision);
    x.comercial += n(o.comision_comercial);
    x.porTipo[o.tipo || 'otro'] = (x.porTipo[o.tipo || 'otro'] || 0) + 1;
    if (o.fecha_alta) { const d = Math.round((new Date(o.fecha_venta) - new Date(o.fecha_alta)) / 864e5); if (d >= 0) x.tiempos.push(d); }
  }
  for (const p of pagos) if (p.fecha && n(p.importe)) mes(clave(p.fecha)).comunidad += n(p.importe);
  for (const x of Object.values(m)) {
    x.neto = x.comision - x.comercial;
    x.total = x.neto + x.comunidad;
    x.ticket = x.vendidos ? x.facturado / x.vendidos : 0;
    x.dias = x.tiempos.length ? Math.round(x.tiempos.reduce((s, d) => s + d, 0) / x.tiempos.length) : null;
    x.pct = x.facturado ? (x.comision / x.facturado) * 100 : 0;
  }
  return m;
}

const VACIO = { vendidos: 0, facturado: 0, comision: 0, comercial: 0, neto: 0, comunidad: 0, total: 0, altas: 0, ticket: 0, dias: null, pct: 0, porTipo: {} };
const anterior = (k) => { const [a, mm] = k.split('-').map(Number); return mm === 1 ? `${a - 1}-12` : `${a}-${String(mm - 1).padStart(2, '0')}`; };
const haceUnAno = (k) => { const [a, mm] = k.split('-'); return `${Number(a) - 1}-${mm}`; };

/** «+12 %» / «−5 %» / «nuevo» */
export function crece(ahora, antes) {
  if (!n(antes)) return n(ahora) ? '<em class="sube">nuevo</em>' : '<em>—</em>';
  const d = Math.round(((n(ahora) - n(antes)) / Math.abs(n(antes))) * 100);
  return d ? `<em class="${d > 0 ? 'sube' : 'baja'}">${d > 0 ? '+' : '−'}${Math.abs(d)} %</em>` : '<em>=</em>';
}

export function paginaMeses(ops, pagos, { ano = null, error = '', hoy = new Date() } = {}) {
  const m = porMeses(ops, pagos);
  const anos = [...new Set([...Object.keys(m).map((k) => Number(k.slice(0, 4))), hoy.getFullYear()])].filter(Boolean).sort((a, b) => b - a);
  const A = anos.includes(Number(ano)) ? Number(ano) : hoy.getFullYear();
  const ultimoMes = A === hoy.getFullYear() ? hoy.getMonth() + 1 : 12;
  const claves = Array.from({ length: 12 }, (_, i) => `${A}-${String(i + 1).padStart(2, '0')}`);
  const de = (k) => m[k] || VACIO;
  const suma = (ks, campo) => ks.reduce((s, k) => s + n(de(k)[campo]), 0);
  // Lo que va de año frente al mismo periodo del año pasado
  const hasta = claves.slice(0, ultimoMes);
  const antes = hasta.map(haceUnAno);
  const vendidosA = suma(hasta, 'vendidos'), netoA = suma(hasta, 'neto'), totalA = suma(hasta, 'total'), facturadoA = suma(hasta, 'facturado'), comunidadA = suma(hasta, 'comunidad');
  const mejor = hasta.filter((k) => de(k).total).sort((a, b) => de(b).total - de(a).total)[0];
  const esteMes = claves[ultimoMes - 1];
  const max = Math.max(1, ...claves.map((k) => de(k).total), ...claves.map((k) => de(haceUnAno(k)).total));

  const grafica = `<div class="meses-graf">${claves.map((k, i) => {
    const x = de(k), y = de(haceUnAno(k));
    return `<div title="${MES[i]} ${A}: ${euros(x.total)} (${A - 1}: ${euros(y.total)})"><span class="v">${x.total ? euros(x.total).replace(' €', '') : ''}</span>
      <span class="pa"><i class="antes" style="height:${Math.round((y.total / max) * 140)}px"></i><i class="ahora${i + 1 > ultimoMes ? ' futuro' : ''}" style="height:${Math.max(x.total ? 3 : 0, Math.round((x.total / max) * 140))}px"></i></span>
      <small>${MES[i].slice(0, 3)}</small></div>`;
  }).join('')}</div><p class="ley"><span class="c-a"></span>${A} &nbsp; <span class="c-b"></span>${A - 1} &nbsp;·&nbsp; neto de Sidonia + comunidad</p>`;

  const filas = claves.slice(0, ultimoMes).reverse().map((k) => {
    const x = de(k), p = de(anterior(k)), y = de(haceUnAno(k));
    const tipos = Object.entries(x.porTipo).map(([t, v]) => `${v} ${(TIPOS_OP[t] || t).toLowerCase()}${v > 1 && t !== 'otro' ? 's' : ''}`).join(' · ');
    return `<tr${k === esteMes ? ' class="este"' : ''}>
      <td class="izq"><b>${MES[Number(k.slice(5)) - 1]}</b>${k === esteMes ? '<span class="sub">en curso</span>' : ''}</td>
      <td><b>${fmt(x.vendidos)}</b>${tipos ? `<span class="sub">${esc(tipos)}</span>` : ''}</td>
      <td>${euros(x.facturado)}${x.vendidos ? `<span class="sub">ticket ${euros(x.ticket)}</span>` : ''}</td>
      <td>${euros(x.comision)}${x.pct ? `<span class="sub">${x.pct.toLocaleString('es-ES', { maximumFractionDigits: 1 })} %</span>` : ''}</td>
      <td>${x.comercial ? euros(x.comercial) : '—'}</td>
      <td><b>${euros(x.neto)}</b></td>
      <td>${x.comunidad ? euros(x.comunidad) : '—'}</td>
      <td><b>${euros(x.total)}</b></td>
      <td>${crece(x.total, p.total)}<span class="sub">vs ${MES[Number(anterior(k).slice(5)) - 1].slice(0, 3)}</span></td>
      <td>${crece(x.total, y.total)}<span class="sub">vs ${A - 1}</span></td>
      <td>${fmt(x.altas)}</td>
      <td>${x.dias != null ? `${fmt(x.dias)} d` : '—'}</td></tr>`;
  }).join('');

  return marco('Ventas por meses', 'meses', `
${error ? `<p class="aviso mal">${esc(error)}</p>` : ''}
<div class="per">${anos.map((a) => `<a href="?estado=meses&ano=${a}" class="${a === A ? 'on' : ''}">${a}</a>`).join('')}</div>
<div class="kpis">
  <div class="kpi"><span>Ingresos ${A}</span><b>${euros(totalA)}</b>${crece(totalA, suma(antes, 'total'))}<small>neto ventas + comunidad · vs ${A - 1} (mismos meses)</small></div>
  <div class="kpi"><span>Neto de ventas</span><b>${euros(netoA)}</b>${crece(netoA, suma(antes, 'neto'))}<small>comisión de Sidonia menos comerciales</small></div>
  <div class="kpi"><span>Comunidad</span><b>${euros(comunidadA)}</b>${crece(comunidadA, suma(antes, 'comunidad'))}<small>cobrado por anuncios</small></div>
  <div class="kpi"><span>Vendidos</span><b>${fmt(vendidosA)}</b>${crece(vendidosA, suma(antes, 'vendidos'))}<small>${euros(facturadoA)} vendidos en total</small></div>
  <div class="kpi"><span>Media al mes</span><b>${euros(totalA / Math.max(1, ultimoMes))}</b><small>${fmt(vendidosA / Math.max(1, ultimoMes))} ventas al mes</small></div>
  <div class="kpi"><span>Mejor mes</span><b>${mejor ? MES[Number(mejor.slice(5)) - 1] : '—'}</b><small>${mejor ? euros(de(mejor).total) : 'aún sin ventas'}</small></div>
</div>
<div class="card"><h2>Mes a mes</h2>${grafica}</div>
<div class="card"><div class="tabla"><table>
  <thead><tr><th class="izq">Mes</th><th>Vendidos</th><th>Facturado</th><th>Comisión</th><th>Comercial</th><th>Neto ventas</th><th>Comunidad</th><th>Total</th><th>Mes anterior</th><th>Año anterior</th><th>Nuevos en venta</th><th>Días en venta</th></tr></thead>
  <tbody>${filas || '<tr><td colspan="12" class="vacio">Aún sin datos este año.</td></tr>'}</tbody>
</table></div></div>
<p class="nota">Una venta cuenta en el mes en que se vendió (su fecha de venta); los nuevos en venta, en el de su fecha de alta. «Total» = neto de Sidonia (comisión menos comerciales) + lo cobrado a la comunidad. Las ventas sin fecha de venta no salen aquí: pónsela en su ficha.</p>`, `
  .meses-graf { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 6px; align-items: end; padding-top: 8px; }
  .meses-graf > div { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 0; }
  .meses-graf .pa { display: flex; gap: 2px; align-items: flex-end; height: 140px; }
  .meses-graf i { display: block; width: 12px; border-radius: 4px 4px 1px 1px; }
  .meses-graf .ahora { background: var(--verde); } .meses-graf .ahora.futuro { opacity: .3; } .meses-graf .antes { background: var(--linea-2, var(--linea)); }
  .meses-graf .v { font-size: 11px; color: var(--suave); white-space: nowrap; } .meses-graf small { font-size: 11px; color: var(--flojo); }
  .ley .c-a, .ley .c-b { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 4px; vertical-align: -1px; background: var(--verde); } .ley .c-b { background: var(--linea-2, var(--linea)); }
  td em { font-style: normal; font-weight: 800; } td em.sube { color: var(--verde); } td em.baja { color: var(--rojo); }
  tr.este td { background: var(--verde-fondo); }
  @media (max-width: 700px) { .meses-graf { gap: 2px; } .meses-graf i { width: 7px; } .meses-graf .v { display: none; } }`);
}
