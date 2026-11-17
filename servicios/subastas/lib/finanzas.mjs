/* SIDONIA · Panel › Finanzas › Resumen: toda la parte financiera de un vistazo.
 *
 *   ?estado=finanzas[&ano=2026]
 * Ingresos (comisiones de las ventas, otros servicios facturados y la comunidad), lo facturado y lo pendiente de facturar,
 * lo cobrado y lo pendiente de cobro, los gastos, el IRPF, el resultado, los coches en gestión por fase, los próximos
 * pagos a Hacienda y lo que hay que hacer (facturas, cobros, contratos sin firmar).
 * Lee: operaciones, facturas, gastos y pagos (de la comunidad).
 */
import { esc, tablaAnuncios } from './circulo.mjs';
import { fmt, n } from './estadisticas.mjs';
import { marco } from './operaciones.mjs';
import { IRPF_PCT, porMesGastos, trimestreDePago } from './gastos.mjs';
import { FASES, FORMAS_PAGO, faseDe } from './expedientes.mjs';

const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const eur = (x) => `${Math.round(n(x)).toLocaleString('es-ES', { useGrouping: 'always' })} €`;
const mesDe = (f) => String(f || '').slice(0, 7);
const trimestre = (k) => `${k.slice(0, 4)}-T${Math.ceil(Number(k.slice(5, 7)) / 3)}`;

/** Todos los números del año A (y del anterior, para comparar) */
export function numerosFinanzas({ ops = [], facturas = [], gastos = [], pagos = [] }, A, hoy = new Date()) {
  const fact = facturas.filter((f) => f.estado !== 'anulada');
  const claves = Array.from({ length: 12 }, (_, i) => `${A}-${String(i + 1).padStart(2, '0')}`);
  const ahora = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  const hasta = claves.filter((k) => k <= ahora);
  const G = porMesGastos(gastos, hoy, { ops, pagos, facturas: fact });
  const mes = Object.fromEntries(claves.map((k) => [k, { ventas: 0, servicios: 0, comunidad: 0, facturado: 0, gastos: n(G.resto[k]) + n(G.comercial[k]), irpf: n(G.irpf[k]) }]));
  const vendidas = ops.filter((o) => o.estado === 'vendido' && o.fecha_venta && o.modalidad !== 'encargo');
  for (const o of vendidas) { const k = mesDe(o.fecha_venta); if (mes[k]) mes[k].ventas += n(o.comision); }
  // Otros servicios: las facturas que no son de una venta (las de venta cuentan por la comisión de su venta)
  const deVenta = (f) => /gesti[oó]n de venta/i.test(String(f.concepto || ''));
  for (const f of fact) { const k = mesDe(f.fecha); if (!mes[k]) continue; mes[k].facturado += n(f.base); if (!f.operacion_id && !deVenta(f)) mes[k].servicios += n(f.base); }
  for (const p of pagos) { const k = mesDe(p.fecha); if (mes[k]) mes[k].comunidad += n(p.importe); }
  // Gastos fijos (lo que tiene cuota: suscripciones, Shopify, ManyChat, autónomo, gestoría) y puntuales (el resto)
  const conCuota = new Set(gastos.filter((g) => g.tipo === 'cuota').map((g) => g.concepto));
  for (const k of claves) {
    const c = G.celdas[k] || {};
    mes[k].fijos = Object.entries(c).filter(([con]) => conCuota.has(con)).reduce((s, [, v]) => s + n(v.importe), 0);
    mes[k].puntuales = Math.max(0, mes[k].gastos - mes[k].fijos - n(G.comercial[k]));
    mes[k].comercial = n(G.comercial[k]);
  }
  for (const o of vendidas) { const k = mesDe(o.fecha_venta); if (mes[k]) { mes[k].coches = (mes[k].coches || 0) + 1; mes[k].vendido = (mes[k].vendido || 0) + n(o.precio_venta); } }
  for (const k of claves) { const x = mes[k]; x.coches ||= 0; x.vendido ||= 0; x.ingresos = x.ventas + x.servicios + x.comunidad; x.resultado = x.ingresos - x.gastos - x.irpf; }
  const sum = (c) => hasta.reduce((s, k) => s + n(mes[k][c]), 0);
  const facturaDe = new Map(fact.filter((f) => f.operacion_id).map((f) => [Number(f.operacion_id), f]));
  const vendidasA = vendidas.filter((o) => String(o.fecha_venta).startsWith(String(A)));
  const sinFactura = vendidasA.filter((o) => !facturaDe.has(Number(o.id)));
  const pendientesCobro = fact.filter((f) => f.forma_pago && !f.cobrada);
  const cobradas = fact.filter((f) => f.cobrada && String(f.cobrada).startsWith(String(A)));
  const porForma = {};
  for (const f of cobradas) porForma[f.forma_pago || 'transferencia'] = (porForma[f.forma_pago || 'transferencia'] || 0) + n(f.total);
  // Hacienda: el trimestre en curso (o el último sin pagar), con lo que tocaría pagar
  const tAhora = trimestre(ahora);
  // El primer trimestre sin pagar que tiene facturas (o el de ahora)
  const conFacturas = new Set(fact.map((f) => trimestre(mesDe(f.fecha))));
  const pagadoT = (t) => gastos.some((g) => g.tipo === 'cargo' && g.categoria === 'Impuestos' && trimestreDePago(g.fecha) === t);
  const tPend = [...conFacturas, tAhora].filter((t) => t <= tAhora && !pagadoT(t)).sort()[0] || tAhora;
  const [tA, tQ] = [Number(tPend.slice(0, 4)), Number(tPend.slice(6))];
  const enT = (f) => trimestre(mesDe(f)) === tPend;
  const ivaT = fact.filter((f) => enT(f.fecha)).reduce((s, f) => s + n(f.iva), 0);
  const delAno = (k) => k.startsWith(String(tA)) && Number(k.slice(5, 7)) <= tQ * 3;
  const rendAno = Object.keys(G.ingresos).filter(delAno).reduce((s, k) => s + n(G.ingresos[k]) - n(G.resto[k]) - n(G.comercial[k]), 0);
  const irpfPagadoAno = gastos.filter((g) => g.tipo === 'cargo' && g.categoria === 'Impuestos' && trimestreDePago(g.fecha).startsWith(String(tA)) && trimestreDePago(g.fecha) < tPend).reduce((s, g) => s + n(g.importe), 0);
  const limite = tQ === 4 ? `${tA + 1}-01-30` : `${tA}-${String(tQ * 3 + 1).padStart(2, '0')}-20`;
  return {
    claves, hasta, mes, sum, ahora, G, conCuota, vendidasA, sinFactura, pendientesCobro, cobradas, porForma, facturaDe,
    sinEnlazar: fact.filter((f) => !f.operacion_id && deVenta(f) && String(f.fecha).startsWith(String(A))),
    hacienda: { t: tPend, iva: Math.round(ivaT * 100) / 100, irpf: Math.max(0, Math.round((rendAno * IRPF_PCT / 100 - irpfPagadoAno) * 100) / 100), limite },
    totales: { ingresos: sum('ingresos'), ventas: sum('ventas'), servicios: sum('servicios'), comunidad: sum('comunidad'), facturado: sum('facturado'), gastos: sum('gastos'), irpf: sum('irpf'), resultado: sum('resultado'),
      pendienteFacturar: sinFactura.reduce((s, o) => s + n(o.comision), 0), pendienteCobro: pendientesCobro.reduce((s, f) => s + n(f.total), 0), cobrado: cobradas.reduce((s, f) => s + n(f.total), 0), vendidos: vendidasA.length }
  };
}

/* ---------------------------------------------------------------------------- Gráficas (SVG, sin librerías) */
function barras(N) {
  const W = 960, H = 260, pl = 46, pb = 26, pt = 14, bw = (W - pl - 10) / 12;
  const max = Math.max(1, ...N.claves.map((k) => Math.max(N.mes[k].ingresos, N.mes[k].gastos + N.mes[k].irpf)));
  const y = (v) => pt + (H - pt - pb) * (1 - v / max);
  let acum = 0;
  const pts = N.claves.map((k, i) => { if (!N.hasta.includes(k)) return null; acum += N.mes[k].resultado; return [pl + bw * i + bw / 2, acum]; }).filter(Boolean);
  const maxA = Math.max(1, ...pts.map((p) => Math.abs(p[1])));
  const yA = (v) => pt + (H - pt - pb) * (0.5 - v / maxA / 2);
  const rejilla = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line x1="${pl}" x2="${W - 6}" y1="${y(max * f)}" y2="${y(max * f)}" class="rj"/><text x="${pl - 6}" y="${y(max * f) + 4}" text-anchor="end" class="ej">${Math.round((max * f) / 1000)}k</text>`).join('');
  const bs = N.claves.map((k, i) => { const x = N.mes[k], x0 = pl + bw * i, fut = !N.hasta.includes(k);
    return `<g class="${fut ? 'fut' : ''}"><title>${MES[i]}: ingresos ${eur(x.ingresos)} · gastos ${eur(x.gastos)} · IRPF ${eur(x.irpf)} · resultado ${eur(x.resultado)}</title>
      <rect x="${x0 + bw * 0.14}" y="${y(x.ingresos)}" width="${bw * 0.34}" height="${Math.max(0, H - pb - y(x.ingresos))}" rx="4" class="ing"/>
      <rect x="${x0 + bw * 0.52}" y="${y(x.gastos + x.irpf)}" width="${bw * 0.34}" height="${Math.max(0, H - pb - y(x.gastos))}" rx="4" class="gas"/>
      <text x="${x0 + bw / 2}" y="${H - 8}" text-anchor="middle" class="ej">${MES[i]}</text></g>`; }).join('');
  const linea = pts.length > 1 ? `<polyline points="${pts.map(([px, v]) => `${px},${yA(v)}`).join(' ')}" class="acu"/>${pts.map(([px, v]) => `<circle cx="${px}" cy="${yA(v)}" r="3.5" class="acu-p"><title>Resultado acumulado: ${eur(v)}</title></circle>`).join('')}<text x="${Math.min(W - 60, pts.at(-1)[0] + 8)}" y="${yA(pts.at(-1)[1]) - 8}" class="acu-t">${eur(pts.at(-1)[1])}</text>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" class="graf" role="img" aria-label="Ingresos y gastos de cada mes">${rejilla}${bs}${linea}</svg>
  <p class="ley"><i class="c-ing"></i>Ingresos <i class="c-gas"></i>Gastos e IRPF <i class="c-acu"></i>Resultado acumulado</p>`;
}
function donut(partes, centro, sub) {
  const total = partes.reduce((s, p) => s + p.v, 0);
  if (!total) return '<p class="vacio">Aún sin datos.</p>';
  const R = 70, C = 2 * Math.PI * R;
  let off = 0;
  const arcos = partes.filter((p) => p.v > 0).map((p) => { const l = (p.v / total) * C; const a = `<circle r="${R}" cx="90" cy="90" fill="none" stroke="${p.c}" stroke-width="22" stroke-dasharray="${l} ${C - l}" stroke-dashoffset="${-off}" transform="rotate(-90 90 90)"><title>${esc(p.t)}: ${eur(p.v)}</title></circle>`; off += l; return a; }).join('');
  return `<div class="donut"><svg viewBox="0 0 180 180">${arcos}<text x="90" y="88" text-anchor="middle" class="d-n">${esc(centro)}</text><text x="90" y="108" text-anchor="middle" class="d-s">${esc(sub)}</text></svg>
    <ul>${partes.map((p) => `<li><i style="background:${p.c}"></i>${esc(p.t)}<b>${eur(p.v)}</b><small>${total ? Math.round((p.v / total) * 100) : 0} %</small></li>`).join('')}</ul></div>`;
}

const CSS = `
  .fz-hero { display: grid; grid-template-columns: 1.3fr 1fr 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .fz-k { border-radius: 20px; padding: 18px 20px; background: var(--caja); border: 1px solid var(--linea); position: relative; overflow: hidden; }
  .fz-k span { font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--suave); }
  .fz-k b { display: block; font-size: 34px; line-height: 1.1; margin: 8px 0 4px; letter-spacing: -.02em; }
  .fz-k small { color: var(--suave); font-size: 13px; }
  .fz-k.top { background: linear-gradient(135deg, rgba(43,212,125,.22), rgba(43,212,125,.04) 60%), var(--caja); border-color: rgba(43,212,125,.35); }
  .fz-k.top b { font-size: 44px; color: var(--verde); }
  .fz-k.neg b { color: var(--rojo); }
  .fz-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 12px; }
  .fz-row .fz-k b { font-size: 26px; }
  .fz-k a.ir { position: absolute; right: 14px; top: 14px; font-size: 12px; color: var(--suave); }
  .graf { width: 100%; height: auto; } .graf .rj { stroke: var(--linea); } .graf .ej { fill: var(--flojo); font-size: 11px; }
  .graf .ing { fill: var(--verde); } .graf .gas { fill: var(--rojo); opacity: .8; } .graf .fut rect { opacity: .18; }
  .graf .acu { fill: none; stroke: #f0b400; stroke-width: 2.5; } .graf .acu-p { fill: #f0b400; } .graf .acu-t { fill: #f0b400; font-size: 13px; font-weight: 800; }
  .ley { font-size: 12px; color: var(--suave); display: flex; gap: 14px; align-items: center; margin: 4px 0 0; } .ley i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: -8px; }
  .c-ing { background: var(--verde); } .c-gas { background: var(--rojo); } .c-acu { background: #f0b400; }
  .fz-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-top: 12px; }
  .donut { display: grid; grid-template-columns: 150px 1fr; gap: 14px; align-items: center; } .donut svg { width: 150px; }
  .donut .d-n { fill: var(--texto); font-size: 20px; font-weight: 800; } .donut .d-s { fill: var(--suave); font-size: 11px; }
  .donut ul { list-style: none; padding: 0; margin: 0; font-size: 13px; } .donut li { display: grid; grid-template-columns: 12px 1fr auto; gap: 2px 8px; align-items: center; padding: 5px 0; border-bottom: 1px solid var(--linea); }
  .donut li i { width: 10px; height: 10px; border-radius: 3px; } .donut li small { grid-column: 2 / -1; color: var(--flojo); }
  .embudo-f { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
  .embudo-f a { display: block; text-decoration: none; color: inherit; background: var(--caja-2); border: 1px solid var(--linea); border-radius: 14px; padding: 12px; text-align: center; }
  .embudo-f a:hover { border-color: var(--verde); } .embudo-f b { display: block; font-size: 28px; } .embudo-f span { font-size: 12px; color: var(--suave); }
  .embudo-f .bar { height: 6px; border-radius: 3px; background: var(--verde); margin-top: 8px; opacity: .85; }
  .tareas-f { list-style: none; padding: 0; margin: 0; } .tareas-f li { display: grid; grid-template-columns: 1fr auto auto; gap: 10px; align-items: center; padding: 9px 0; border-bottom: 1px solid var(--linea); font-size: 14px; }
  .tareas-f li small { display: block; color: var(--suave); font-size: 12px; } .tareas-f .boton { padding: 7px 12px; font-size: 13px; }
  .hda { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; } .hda div { background: var(--caja-2); border-radius: 14px; padding: 12px 14px; } .hda b { display: block; font-size: 24px; } .hda span { font-size: 12px; color: var(--suave); }
  @media (max-width: 1000px) { .fz-hero, .fz-row { grid-template-columns: 1fr 1fr; } .fz-3 { grid-template-columns: 1fr; } .embudo-f { grid-template-columns: repeat(3, 1fr); } }
  @media (max-width: 560px) { .fz-hero, .fz-row { grid-template-columns: 1fr; } .donut { grid-template-columns: 1fr; justify-items: center; } }`;

const CSS2 = `
  .fz-sec { display: flex; align-items: baseline; gap: 12px; margin: 22px 0 10px; } .fz-sec h2 { margin: 0; font-size: 15px; letter-spacing: .08em; text-transform: uppercase; color: var(--suave); } .fz-sec small { color: var(--flojo); }
  .fz-6 { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; }
  .fz-6 .fz-k b { font-size: 26px; } .fz-6 .fz-k.top b { font-size: 30px; }
  .fz-k em { font-style: normal; font-size: 12px; font-weight: 800; margin-left: 6px; } .fz-k em.sube { color: var(--verde); } .fz-k em.baja { color: var(--rojo); }
  .ritmo { display: flex; flex-wrap: wrap; gap: 8px 22px; align-items: center; padding: 14px 18px; border-radius: 16px; background: linear-gradient(90deg, rgba(240,180,0,.12), transparent); border: 1px solid rgba(240,180,0,.3); margin-top: 10px; font-size: 14px; }
  .ritmo b { font-size: 18px; color: #f0b400; } .ritmo span { color: var(--suave); }
  .ventas-l td.foto img, .ventas-l td.foto span { width: 56px; height: 42px; border-radius: 8px; object-fit: cover; display: block; background: var(--caja-3); }
  .estado-f { font-size: 12px; font-weight: 800; } .estado-f.ok { color: var(--verde); } .estado-f.pend { color: #f0b400; } .estado-f.no { color: var(--rojo); }
  .fijos-l { list-style: none; padding: 0; margin: 0; font-size: 14px; } .fijos-l li { display: flex; justify-content: space-between; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--linea); } .fijos-l li span { color: var(--suave); font-size: 12px; }
  @media (max-width: 1100px) { .fz-6 { grid-template-columns: repeat(3, 1fr); } } @media (max-width: 600px) { .fz-6 { grid-template-columns: 1fr 1fr; } }`;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const cambio = (a, b) => { if (!n(b)) return ''; const d = Math.round(((n(a) - n(b)) / Math.abs(n(b))) * 100); return d ? `<em class="${d > 0 ? 'sube' : 'baja'}">${d > 0 ? '+' : '−'}${Math.abs(d)} %</em>` : ''; };
const kpi = (t, v, sub = '', cls = '', extra = '') => `<div class="fz-k ${cls}"><span>${t}</span><b>${v}${extra}</b><small>${sub}</small></div>`;

/** Finanzas › Resumen: las ventas de este mes y del año (y a qué ritmo va), con sus gastos fijos y el resultado */
export function paginaFinanzas(datos, { ano = null, hoy = new Date(), error = '', fotos = {}, avisos = [] } = {}) {
  const anos = [...new Set([hoy.getFullYear(), ...datos.ops.map((o) => Number(String(o.fecha_venta || '').slice(0, 4))), ...datos.facturas.map((f) => Number(String(f.fecha).slice(0, 4)))].filter((x) => x > 2000))].sort((a, b) => b - a);
  const A = anos.includes(Number(ano)) ? Number(ano) : hoy.getFullYear();
  const N = numerosFinanzas(datos, A, hoy), T = N.totales;
  const esteAno = A === hoy.getFullYear();
  const k = esteAno ? N.ahora : `${A}-12`, kAnt = N.claves[Number(k.slice(5)) - 2];
  const m = N.mes[k] || {}, p = (kAnt && N.mes[kAnt]) || {};
  const sumA = (c) => N.hasta.reduce((s, x) => s + n(N.mes[x][c]), 0);
  // El ritmo: lo que va de año, llevado a 12 meses (con la parte del mes en curso)
  const dias = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  const transcurrido = esteAno ? hoy.getMonth() + hoy.getDate() / dias : 12;
  const anual = (v) => (transcurrido ? (v / transcurrido) * 12 : 0);
  const vendidas = N.vendidasA.slice().sort((a, b) => String(b.fecha_venta).localeCompare(String(a.fecha_venta)));
  const facDe = N.facturaDe;
  const filas = vendidas.map((o) => { const f = facDe.get(Number(o.id));
    const est = f ? (f.cobrada ? `<span class="estado-f ok">Factura ${esc(f.numero)} · cobrada</span>` : `<span class="estado-f pend">Factura ${esc(f.numero)} · sin cobrar</span>`) : '<span class="estado-f no">Sin factura</span>';
    return `<tr><td class="foto">${fotos[o.handle] ? `<img src="${esc(fotos[o.handle])}" alt="" loading="lazy">` : '<span></span>'}</td><td class="izq"><b>${esc(o.titulo)}</b><span class="sub">${esc(new Date(`${String(o.fecha_venta).slice(0, 10)}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }))}${o.propietario_nombre ? ` · ${esc(o.propietario_nombre)}` : ''}</span></td>
      <td>${o.precio_venta ? eur(o.precio_venta) : '—'}</td><td><b>${o.comision ? eur(o.comision) : '—'}</b></td><td class="izq">${est}</td><td><a href="?estado=expediente&id=${Number(o.id)}">${f ? 'Ver' : 'Hacer factura'} ›</a></td></tr>`; }).join('');
  const hoyD = hoy.toISOString().slice(0, 10);
  const cuotas = datos.gastos.filter((g) => g.tipo === 'cuota' && String(g.fecha) <= hoyD && (!g.hasta || String(g.hasta) >= hoyD)).sort((a, b) => n(b.importe) - n(a.importe));
  const tareas = [
    ...N.sinFactura.slice(0, 10).map((o) => [`Hacer la factura: ${o.titulo}`, `Vendido el ${String(o.fecha_venta).slice(0, 10)}${o.comision ? ` · comisión ${eur(o.comision)}` : ''}`, `?estado=expediente&id=${o.id}`, 'Hacer factura']),
    ...N.pendientesCobro.slice(0, 10).map((f) => [`Cobrar la factura ${f.numero}`, `${f.cliente} · ${eur(f.total)}`, f.operacion_id ? `?estado=expediente&id=${f.operacion_id}` : '?estado=facturas', 'Marcar cobrada']),
    ...N.sinEnlazar.slice(0, 10).map((f) => [`Enlazar la factura ${f.numero} con su venta`, `${f.concepto} · ${eur(f.base)}`, '?estado=facturas', 'Enlazar'])];
  return marco('Finanzas', 'finanzas', `
${error ? `<p class="aviso mal">${esc(error)}</p>` : ''}
${avisos.length ? `<div class="tareas">${avisos.map(([t, href]) => `<a href="${href}">${esc(t)}</a>`).join('')}</div>` : ''}
<div class="per" style="margin-top:0">${anos.map((a) => `<a href="?estado=finanzas&ano=${a}" class="${a === A ? 'on' : ''}">${a}</a>`).join('')}</div>
<div class="fz-sec"><h2>${esteAno ? 'Este mes' : 'Diciembre'} · ${MESES[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}</h2><small>${esteAno ? `en curso · frente a ${kAnt ? MESES[Number(kAnt.slice(5)) - 1] : ''}` : ''}</small></div>
<div class="fz-6">
  ${kpi('Coches vendidos', fmt(m.coches), `${eur(m.vendido)} en ventas`, '', cambio(m.coches, p.coches))}
  ${kpi('Comisión de ventas', eur(m.ventas), 'lo que gana Sidonia por vender', '', cambio(m.ventas, p.ventas))}
  ${kpi('Otros ingresos', eur(n(m.servicios) + n(m.comunidad)), 'servicios facturados y comunidad')}
  ${kpi('Gastos fijos', eur(m.fijos), `+ ${eur(m.puntuales)} puntuales${m.comercial ? ` · ${eur(m.comercial)} comercial` : ''}`)}
  ${kpi('IRPF', eur(m.irpf), 'reserva del mes')}
  ${kpi('Resultado del mes', eur(m.resultado), 'ingresos − gastos − IRPF', `top${n(m.resultado) < 0 ? ' neg' : ''}`)}
</div>
<div class="fz-sec"><h2>En el año · ${A}</h2><small>${esteAno ? `hasta hoy (${MESES[hoy.getMonth()]})` : 'el año entero'}</small></div>
<div class="fz-6">
  ${kpi('Coches vendidos', fmt(T.vendidos), `${eur(sumA('vendido'))} en ventas`)}
  ${kpi('Comisión de ventas', eur(T.ventas), `ticket medio ${eur(T.vendidos ? T.ventas / T.vendidos : 0)}`)}
  ${kpi('Otros ingresos', eur(T.servicios + T.comunidad), 'servicios y comunidad')}
  ${kpi('Gastos', eur(T.gastos), `${eur(sumA('fijos'))} fijos · ${eur(sumA('puntuales'))} puntuales`)}
  ${kpi('IRPF', eur(T.irpf), 'pagado o reservado')}
  ${kpi(`Resultado ${A}`, eur(T.resultado), `ingresos ${eur(T.ingresos)}`, `top${T.resultado < 0 ? ' neg' : ''}`)}
</div>
${esteAno ? `<div class="ritmo"><span>Al ritmo de este año, ${A} cerraría con</span><b>${fmt(Math.round(anual(T.vendidos)))} coches</b><b>${eur(anual(T.ventas))} de comisión</b><b>${eur(anual(T.ingresos))} de ingresos</b><span>y un resultado de</span><b>${eur(anual(T.resultado))}</b></div>` : ''}
<div class="card" style="margin-top:14px"><h2>Mes a mes</h2>${barras(N)}</div>
<div class="grid2" style="margin-top:12px">
  <div class="card"><div class="barra" style="margin:0 0 8px"><h2 style="margin:0">Ventas de ${A}</h2><a class="boton claro" href="?estado=ventas">Todas las ventas ›</a></div>
    <div class="tabla ventas-l"><table><thead><tr><th></th><th class="izq">Coche</th><th>Vendido por</th><th>Comisión</th><th class="izq">Factura</th><th></th></tr></thead><tbody>${filas || '<tr><td colspan="6" class="vacio">Aún sin ventas este año.</td></tr>'}</tbody></table></div></div>
  <div class="card"><div class="barra" style="margin:0 0 8px"><h2 style="margin:0">Gastos fijos al mes</h2><a class="boton claro" href="?estado=gastos">Gastos ›</a></div>
    <ul class="fijos-l">${cuotas.map((g) => `<li><div>${esc(g.concepto)}<br><span>${esc(g.categoria)}${g.variable ? ' · cambia cada mes' : ''}</span></div><b>${eur(g.importe)}</b></li>`).join('') || '<li>Sin cuotas: añádelas en Gastos.</li>'}
    <li><b>Total al mes</b><b>${eur(cuotas.reduce((s, g) => s + n(g.importe), 0))}</b></li></ul></div>
</div>
${tareas.length ? `<div class="card" style="margin-top:12px"><h2>Pendiente</h2><ul class="tareas-f">${tareas.map(([titulo, sub, href, boton]) => `<li><div>${esc(titulo)}<small>${esc(sub)}</small></div><span></span><a class="boton claro" href="${href}">${boton} ›</a></li>`).join('')}</ul></div>` : ''}
<p class="nota">Una venta cuenta en el mes en que se vendió, por la comisión de Sidonia. Gastos fijos: los que tienen cuota (suscripciones, Shopify, ManyChat, autónomo, gestoría); puntuales, el resto (abogado, gasolina…). El IVA no es un gasto: está en Impuestos.</p>`, CSS + CSS2);
}

/** Finanzas › Impuestos: IRPF e IVA, lo pagado a Hacienda y lo que viene */
export function paginaImpuestos(datos, { ano = null, hoy = new Date(), hacienda: H = [] } = {}) {
  const A = Number(ano) || hoy.getFullYear();
  const N = numerosFinanzas(datos, A, hoy), T = N.totales, h = N.hacienda;
  const pagos = datos.gastos.filter((g) => g.tipo === 'cargo' && ['Impuestos', 'IVA'].includes(g.categoria)).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  const tot = (cat) => pagos.filter((g) => g.categoria === cat && String(g.fecha).startsWith(String(A))).reduce((s, g) => s + n(g.importe), 0);
  const eur2 = (x) => `${n(x).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' })} €`;
  const filasH = H.map((x) => `<tr><td class="izq"><b>${x.t.slice(6)}.º trimestre de ${x.t.slice(0, 4)}</b><span class="sub">${fmt(x.facturas)} facturas</span></td><td>${eur2(x.base)}</td><td>${eur2(x.iva)}</td>
    <td>${x.ivaPagado != null ? eur2(x.ivaPagado) : '<span class="sub">sin pagar aún</span>'}</td><td>${x.ivaGastos != null ? eur2(x.ivaGastos) : '—'}</td><td>${x.irpfPagado != null ? eur2(x.irpfPagado) : '<span class="sub">sin pagar aún</span>'}</td>
    <td>${x.rendimiento != null ? eur2(x.rendimiento) : '—'}</td><td>${x.gastosDeclarados != null ? eur2(x.gastosDeclarados) : '—'}</td></tr>`).join('');
  return marco('Impuestos', 'impuestos', `
<div class="fz-sec" style="margin-top:0"><h2>Lo próximo: ${h.t.slice(6)}.º trimestre de ${h.t.slice(0, 4)}</h2><small>hasta el ${new Date(`${h.limite}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</small></div>
<div class="fz-hero">
  ${kpi('IVA de las facturas del trimestre', eur(h.iva), 'modelo 303: menos el IVA de los gastos que deduzca la gestoría', 'top')}
  ${kpi('IRPF estimado', eur(h.irpf), `modelo 130: el ${IRPF_PCT} % del beneficio del año menos lo ya pagado`)}
  ${kpi(`IRPF pagado ${A}`, eur(tot('Impuestos')), `y ${eur(T.irpf)} entre pagado y reservado`)}
  ${kpi(`IVA pagado ${A}`, eur(tot('IVA')), 'el IVA no es un gasto: se cobra en la factura y se entrega')}
</div>
${filasH ? `<div class="card"><h2>Trimestre a trimestre</h2><div class="tabla"><table><thead><tr><th class="izq">Trimestre</th><th>Facturado</th><th>IVA cobrado</th><th>IVA pagado</th><th>IVA de los gastos</th><th>IRPF pagado</th><th>Beneficio declarado</th><th>Gastos declarados</th></tr></thead><tbody>${filasH}</tbody></table></div>
  <p class="nota">El IVA pagado (303) es el cobrado en las facturas menos el de los gastos. El IRPF (130) es el ${IRPF_PCT} % del beneficio desde enero menos lo ya pagado: de ahí sale el beneficio declarado y, restándolo de lo facturado, los gastos que ha deducido la gestoría. Si son más que los de Gastos, pedid a la gestoría el libro de gastos.</p></div>` : ''}
<div class="card"><div class="barra" style="margin:0 0 8px"><h2 style="margin:0">Pagos a Hacienda</h2><a class="boton claro" href="?estado=gastos">Apuntar un pago (en Gastos) ›</a></div><div class="tabla"><table><thead><tr><th class="izq">Fecha</th><th class="izq">Qué</th><th>Importe</th><th class="izq">Notas</th></tr></thead>
  <tbody>${pagos.map((g) => `<tr><td class="izq">${esc(String(g.fecha).slice(0, 10))}</td><td class="izq"><b>${esc(g.concepto)}</b><span class="sub">${g.categoria === 'IVA' ? 'IVA' : 'IRPF'} · ${esc(trimestreDePago(g.fecha).slice(6))}.º trimestre</span></td><td>${eur2(g.importe)}</td><td class="izq">${esc(g.notas || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="vacio">Aún no hay pagos apuntados.</td></tr>'}</tbody></table></div>
  <p class="nota">Apuntad cada pago en Gastos: el IRPF (modelo 130) con categoría «Impuestos» y el IVA (modelo 303) con categoría «IVA». En el extracto, el «Tributo 130…» es IRPF y el «Tributo 303…», IVA.</p></div>`, CSS + CSS2);
}

export async function rutasFinanzas(req, cfg, deps, html) {
  const leer = async (t, q) => { try { return await (deps[t] || tablaAnuncios(cfg, deps.fetch, t)).leer(q); } catch (e) { return null; } };
  const [ops, facturas, gastos, pagos] = await Promise.all([leer('operaciones', 'select=*&limit=5000'), leer('facturas', 'select=*&limit=5000'), leer('gastos', 'select=*&limit=20000'), leer('pagos', 'select=fecha,importe&limit=20000')]);
  const faltan = [!ops && 'operaciones', !facturas && 'facturas', !gastos && 'gastos'].filter(Boolean);
  const datos = {
    ops: ops || [], pagos: pagos || [],
    facturas: (facturas || []).map((f) => ({ ...f, fecha: String(f.fecha).slice(0, 10), base: n(f.base), iva: n(f.iva), total: n(f.total) })),
    gastos: (gastos || []).map((g) => ({ ...g, importe: n(g.importe), fecha: String(g.fecha).slice(0, 10), hasta: g.hasta ? String(g.hasta).slice(0, 10) : null }))
  };
  if (req.query.estado === 'impuestos') {
    const { hacienda } = await import('./facturas.mjs');
    return html(paginaImpuestos(datos, { ano: req.query.ano, hacienda: hacienda(datos.facturas.filter((f) => f.estado !== 'anulada'), datos.gastos) }));
  }
  let fotos = {};
  try { const { fotosDe } = await import('./actividad.mjs'); fotos = await fotosDe(cfg, deps, datos.ops.map((o) => o.handle).filter(Boolean)); } catch (e) { fotos = {}; }
  return html(paginaFinanzas(datos, { ano: req.query.ano, error: faltan.length ? `Faltan datos (${faltan.join(', ')}): ejecuta sql/centro-operativo.sql en Supabase › SQL Editor.` : '', fotos, avisos: deps.tareas || [] }));
}
