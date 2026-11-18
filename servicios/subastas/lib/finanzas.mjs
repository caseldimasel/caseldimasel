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
import { marcaDe, marco, resumen } from './operaciones.mjs';
import { IRPF_PCT, porMesGastos, trimestreDePago } from './gastos.mjs';

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
  .fz-vf { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); } .fz-vf .tabla { overflow-x: auto; }
  .fz-big { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; } .fz-big a.fz-k { text-decoration: none; color: inherit; } .fz-big a.fz-k:hover { border-color: var(--linea-2); }
  .fz-big .fz-k b { font-size: 30px; } .fz-big .fz-k.top b { font-size: 32px; }
  .fz-atajos { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 10px 0 6px; }
  .fz-atajos a { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 2px 10px; padding: 12px 16px; border-radius: 14px; background: var(--caja-2); border: 1px solid var(--linea); text-decoration: none; color: inherit; }
  .fz-atajos a:hover { border-color: var(--verde); } .fz-atajos span { font-size: 12px; color: var(--suave); } .fz-atajos b { grid-row: 2; font-size: 20px; } .fz-atajos i { grid-row: 1 / 3; grid-column: 2; font-style: normal; font-size: 12px; color: var(--suave); text-align: right; }
  @media (max-width: 1100px) { .fz-big { grid-template-columns: repeat(3, 1fr); } .fz-atajos { grid-template-columns: 1fr 1fr; } } @media (max-width: 900px) { .fz-vf { grid-template-columns: 1fr; } } @media (max-width: 600px) { .fz-big { grid-template-columns: 1fr 1fr; } .fz-atajos { grid-template-columns: 1fr; } }
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

/* ---------------------------------------------------------------------------- Finanzas › Ventas (la portada) */
const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const clave = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
const sumaMes = (k, d) => { const [y, m] = k.split('-').map(Number); const t = y * 12 + (m - 1) + d; return clave(Math.floor(t / 12), (t % 12) + 1); };
const entre = (a, b) => { const l = []; for (let k = a; k <= b; k = sumaMes(k, 1)) l.push(k); return l; };
const nombreMes = (k, largo = false) => `${(largo ? MESES : MES_CORTO)[Number(k.slice(5)) - 1]}${largo ? ' de ' : ' '}${k.slice(0, 4)}`;
const ORIGEN = { persona: 'En persona', llamada: 'Por teléfono', web: 'Formulario de la web', recomendacion: 'Recomendación', otro: 'Otro' };
const PERIODOS = [['mes', 'Este mes'], ['3m', '3 meses'], ['ano', 'Este año'], ['12m', '12 meses'], ['todo', 'Todo']];

/** El periodo elegido: { p, desde, hasta, antes: [desde, hasta], titulo } (meses «2026-11») */
export function periodo(p, hoy = new Date(), primero = null) {
  const ahora = clave(hoy.getFullYear(), hoy.getMonth() + 1);
  let desde, hasta = ahora, titulo;
  if (/^\d{4}$/.test(String(p))) { desde = `${p}-01`; hasta = `${p}-12` < ahora ? `${p}-12` : ahora; titulo = `En ${p}`; }
  else if (p === 'mes') { desde = ahora; titulo = `En ${MESES[hoy.getMonth()]}`; }
  else if (p === '3m') { desde = sumaMes(ahora, -2); titulo = 'En los últimos 3 meses'; }
  else if (p === '12m') { desde = sumaMes(ahora, -11); titulo = 'En los últimos 12 meses'; }
  else if (p === 'todo') { desde = primero && primero < ahora ? primero : sumaMes(ahora, -11); titulo = 'Desde el principio'; }
  else { p = 'ano'; desde = `${hoy.getFullYear()}-01`; titulo = `En ${hoy.getFullYear()}`; }
  const largo = entre(desde, hasta).length;
  return { p: String(p), desde, hasta, meses: entre(desde, hasta), antes: [sumaMes(desde, -largo), sumaMes(desde, -1)], titulo };
}

/** Cada mes desde la primera venta: coches, vendido, comisión, días hasta vender, otros ingresos, gastos, IRPF y resultado */
export function serieMeses(datos, hoy = new Date()) {
  const vendidas = datos.ops.filter((o) => o.estado === 'vendido' && o.fecha_venta && o.modalidad !== 'encargo');
  const ahora = clave(hoy.getFullYear(), hoy.getMonth() + 1);
  const primero = [...vendidas.map((o) => String(o.fecha_venta).slice(0, 7)), ...datos.facturas.map((f) => String(f.fecha).slice(0, 7))].filter((k) => /^\d{4}-\d{2}$/.test(k) && k <= ahora).sort()[0] || ahora;
  const meses = entre(primero, ahora);
  const anos = [...new Set(meses.map((k) => Number(k.slice(0, 4))))];
  const N = Object.fromEntries(anos.map((a) => [a, numerosFinanzas(datos, a, hoy)]));
  const serie = Object.fromEntries(meses.map((k) => { const m = N[Number(k.slice(0, 4))].mes[k] || {};
    return [k, { k, coches: 0, vendido: 0, comision: 0, dias: [], ventas: [], otros: n(m.servicios) + n(m.comunidad), gastos: n(m.gastos), irpf: n(m.irpf) }]; }));
  for (const o of vendidas) {
    const s = serie[String(o.fecha_venta).slice(0, 7)];
    if (!s) continue;
    s.coches += 1; s.vendido += n(o.precio_venta); s.comision += n(o.comision); s.ventas.push(o);
    const d = o.fecha_alta ? Math.round((new Date(o.fecha_venta) - new Date(o.fecha_alta)) / 864e5) : null;
    if (d != null && d >= 0) s.dias.push(d);
  }
  for (const s of Object.values(serie)) { s.ingresos = s.comision + s.otros; s.resultado = s.ingresos - s.gastos - s.irpf; }
  return { serie, meses, primero, N };
}

/** Los números de un tramo de meses */
function tramo(serie, meses) {
  const l = meses.map((k) => serie[k]).filter(Boolean);
  const s = (c) => l.reduce((t, x) => t + n(x[c]), 0);
  const dias = l.flatMap((x) => x.dias);
  const r = { coches: s('coches'), vendido: s('vendido'), comision: s('comision'), otros: s('otros'), gastos: s('gastos'), irpf: s('irpf'), ingresos: s('ingresos'), resultado: s('resultado'), ventas: l.flatMap((x) => x.ventas) };
  r.ticket = r.coches ? r.vendido / r.coches : 0;
  r.pct = r.vendido ? (r.comision / r.vendido) * 100 : 0;
  r.dias = dias.length ? Math.round(dias.reduce((a, b) => a + b, 0) / dias.length) : null;
  return r;
}

const delta = (a, b) => {
  if (!n(b)) return n(a) ? '<span class="vt-d sube">nuevo</span>' : '<span class="vt-d">—</span>';
  const d = Math.round(((n(a) - n(b)) / Math.abs(n(b))) * 100);
  return `<span class="vt-d ${d > 0 ? 'sube' : d < 0 ? 'baja' : ''}">${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${Math.abs(d)} %</span>`;
};

/** La gráfica: área suave con sus puntos, y al pasar por encima, el mes y su valor */
function grafica(id, puntos, { formato, visible }) {
  const W = 1000, H = 280, pl = 54, pr = 16, pt = 18, pb = 34;
  const max = Math.max(1, ...puntos.map((p) => p.v));
  const paso = Math.pow(10, Math.floor(Math.log10(max)));
  const tope = Math.ceil(max / paso) * paso;
  const x = (i) => pl + (puntos.length === 1 ? (W - pl - pr) / 2 : (i * (W - pl - pr)) / (puntos.length - 1));
  const y = (v) => pt + (H - pt - pb) * (1 - v / tope);
  const P = puntos.map((p, i) => [x(i), y(p.v)]);
  // Curva suave (Catmull-Rom → Bézier), sin pasarse por debajo de cero
  let d = `M${P[0][0]},${P[0][1]}`;
  for (let i = 0; i < P.length - 1; i += 1) {
    const [a, b, c, e] = [P[i - 1] || P[i], P[i], P[i + 1], P[i + 2] || P[i + 1]];
    const c1 = [b[0] + (c[0] - a[0]) / 6, Math.min(y(0), b[1] + (c[1] - a[1]) / 6)], c2 = [c[0] - (e[0] - b[0]) / 6, Math.min(y(0), c[1] - (e[1] - b[1]) / 6)];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${c[0]},${c[1]}`;
  }
  const area = `${d} L${P.at(-1)[0]},${y(0)} L${P[0][0]},${y(0)} Z`;
  const rej = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line x1="${pl}" x2="${W - pr}" y1="${y(tope * f)}" y2="${y(tope * f)}" class="rj"/><text x="${pl - 10}" y="${y(tope * f) + 4}" text-anchor="end" class="ej">${esc(formato(tope * f, true))}</text>`).join('');
  const cada = Math.ceil(puntos.length / 12);
  const ejes = puntos.map((p, i) => (i % cada === 0 || i === puntos.length - 1 ? `<text x="${x(i)}" y="${H - 10}" text-anchor="middle" class="ej">${esc(p.etq)}</text>` : '')).join('');
  const zonas = puntos.map((p, i) => { const w = (W - pl - pr) / Math.max(1, puntos.length - 1); return `<rect x="${x(i) - w / 2}" y="${pt}" width="${w}" height="${H - pt - pb}" class="zona" data-x="${x(i)}" data-y="${y(p.v)}" data-t="${esc(p.titulo)}" data-v="${esc(formato(p.v))}"/>`; }).join('');
  return `<div class="vt-g" data-graf="${id}"${visible ? '' : ' hidden'}><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución">
    <defs><linearGradient id="gr-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--verde)" stop-opacity=".28"/><stop offset="1" stop-color="var(--verde)" stop-opacity="0"/></linearGradient></defs>
    ${rej}<path d="${area}" fill="url(#gr-${id})"/><path d="${d}" class="ln"/>${P.map(([px, py], i) => (puntos[i].v ? `<circle cx="${px}" cy="${py}" r="4" class="pt"/>` : '')).join('')}${ejes}
    <line class="guia" x1="0" x2="0" y1="${pt}" y2="${H - pb}" style="display:none"/><circle class="foco" r="6" style="display:none"/>${zonas}</svg><div class="vt-tip" hidden></div></div>`;
}

const CSS_V = `
  .vt-cab { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 14px; margin: 8px 0 18px; }
  .vt-cab h1 { margin: 0; font-size: 30px; letter-spacing: -.02em; } .vt-cab p { margin: 4px 0 0; color: var(--suave); }
  .seg { display: inline-flex; padding: 4px; gap: 2px; border-radius: 12px; background: var(--caja); border: 1px solid var(--linea); box-shadow: var(--sombra); flex-wrap: wrap; }
  .seg a { padding: 8px 14px; border-radius: 9px; text-decoration: none; font-weight: 700; font-size: 14px; color: var(--suave); white-space: nowrap; }
  .seg a:hover { color: var(--texto); } .seg a.on { background: var(--texto); color: var(--fondo); }
  .seg select { border: 0; background: transparent; color: var(--suave); font-weight: 700; font: inherit; padding: 6px 8px; }
  .vt-siempre { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0; margin: 0 0 16px; border-radius: 16px; background: var(--caja); border: 1px solid var(--linea); box-shadow: var(--sombra); overflow: hidden; }
  .vt-siempre a { display: block; padding: 14px 18px; text-decoration: none; color: inherit; border-right: 1px solid var(--linea); } .vt-siempre a:last-child { border-right: 0; } .vt-siempre a:hover { background: var(--caja-2); }
  .vt-siempre span { display: block; font-size: 12px; color: var(--suave); } .vt-siempre b { display: block; font-size: 21px; letter-spacing: -.01em; margin-top: 2px; } .vt-siempre small { font-size: 12px; color: var(--flojo); }
  .vt-et { font-size: 11px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--flojo); margin: 0 0 6px; }
  .vt-main { padding: 0; overflow: hidden; }
  .vt-kpis { display: grid; grid-template-columns: repeat(4, 1fr); border-bottom: 1px solid var(--linea); }
  .vt-kpis .vt-k { cursor: pointer; outline: none; padding: 18px 22px 16px; border-right: 1px solid var(--linea); position: relative; }
  .vt-kpis .vt-k:last-child { border-right: 0; } .vt-kpis .vt-k:hover { background: var(--caja-2); }
  .vt-kpis .vt-k.on::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 3px; background: var(--verde); }
  .vt-kpis .vt-k > span:first-child { display: block; font-size: 13px; color: var(--suave); font-family: Inter, sans-serif; }
  .vt-kpis b { display: block; font-size: 32px; letter-spacing: -.02em; line-height: 1.15; margin: 4px 0 4px; font-family: Inter, sans-serif; }
  .vt-kpis .vt-k:first-child b { font-size: 38px; }
  .vt-kpis small { font-size: 12px; color: var(--flojo); font-family: Inter, sans-serif; }
  .vt-d { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 800; background: var(--caja-3); color: var(--suave); margin-right: 6px; }
  .vt-d.sube { background: var(--verde-fondo); color: var(--verde); } .vt-d.baja { background: var(--rojo-fondo); color: var(--rojo); }
  .vt-g { position: relative; padding: 12px 18px 6px; } .vt-g svg { width: 100%; height: auto; display: block; }
  .vt-g .rj { stroke: var(--linea); } .vt-g .ej { fill: var(--flojo); font-size: 12px; font-family: Inter, sans-serif; }
  .vt-g .ln { fill: none; stroke: var(--verde); stroke-width: 3; stroke-linejoin: round; } .vt-g .pt { fill: var(--caja); stroke: var(--verde); stroke-width: 2.5; }
  .vt-g .zona { fill: transparent; cursor: crosshair; } .vt-g .guia { stroke: var(--linea-2); stroke-dasharray: 4 4; } .vt-g .foco { fill: var(--verde); stroke: var(--caja); stroke-width: 3; }
  .vt-tip { position: absolute; pointer-events: none; transform: translate(-50%, -120%); padding: 8px 12px; border-radius: 10px; background: var(--texto); color: var(--fondo); font-size: 13px; white-space: nowrap; box-shadow: 0 8px 24px -8px rgba(0,0,0,.4); }
  .vt-tip b { display: block; font-size: 16px; }
  .vt-2 { display: grid; grid-template-columns: 1.15fr 1fr; gap: 14px; margin-top: 14px; }
  .vt-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 14px; }
  .vt-2 .card, .vt-3 .card { margin: 0; }
  .cuenta { list-style: none; margin: 0; padding: 0; } .cuenta li { display: flex; justify-content: space-between; align-items: baseline; padding: 9px 0; border-bottom: 1px solid var(--linea); font-size: 15px; }
  .cuenta li span { color: var(--suave); } .cuenta li.mas b { color: var(--verde); } .cuenta li.menos b { color: var(--rojo); }
  .cuenta li.total { border-bottom: 0; padding-top: 14px; } .cuenta li.total span { color: var(--texto); font-weight: 700; } .cuenta li.total b { font-size: 28px; letter-spacing: -.02em; }
  .cuenta li.total.neg b { color: var(--rojo); }
  .vt-links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; } .vt-links a { font-size: 13px; padding: 7px 12px; border-radius: 999px; background: var(--caja-2); border: 1px solid var(--linea); text-decoration: none; }
  .vt-links a:hover { border-color: var(--verde); }
  .ritmo2 { margin-top: 12px; padding: 12px 14px; border-radius: 12px; background: var(--amarillo-fondo); font-size: 13px; color: var(--texto); } .ritmo2 b { color: var(--amarillo); }
  .pend { list-style: none; margin: 0; padding: 0; } .pend li { display: flex; gap: 10px; align-items: center; padding: 9px 0; border-bottom: 1px solid var(--linea); font-size: 14px; }
  .pend li div { flex: 1; min-width: 0; } .pend li small { display: block; color: var(--suave); font-size: 12px; } .pend .boton { padding: 7px 12px; font-size: 13px; }
  .pend i { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--amarillo); } .pend i.c { background: var(--lila); } .pend i.a { background: var(--rojo); }
  .pipe { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 12px; } .pipe a { padding: 12px; border-radius: 12px; background: var(--caja-2); text-decoration: none; }
  .pipe span { display: block; font-size: 12px; color: var(--suave); } .pipe b { font-size: 20px; }
  .barras2 { list-style: none; margin: 0; padding: 0; } .barras2 li { padding: 7px 0; font-size: 14px; }
  .barras2 .f { display: flex; justify-content: space-between; gap: 10px; } .barras2 .f span { color: var(--suave); font-size: 12px; }
  .barras2 .b { height: 6px; border-radius: 3px; background: var(--barra-fondo); margin-top: 5px; overflow: hidden; } .barras2 .b i { display: block; height: 100%; border-radius: 3px; background: var(--verde); }
  .mm td, .mm th { white-space: nowrap; } .mm tr.fuera td { opacity: .45; } .mm tr.tot td { font-weight: 800; border-top: 2px solid var(--linea-2); }
  .mm .bm { display: inline-block; width: 70px; height: 6px; border-radius: 3px; background: var(--barra-fondo); vertical-align: middle; margin-right: 8px; overflow: hidden; } .mm .bm i { display: block; height: 100%; background: var(--verde); }
  .mm .neg { color: var(--rojo); }
  .vl { list-style: none; margin: 0; padding: 0; } .vl li a { display: grid; grid-template-columns: 64px 1fr auto auto; gap: 14px; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--linea); text-decoration: none; }
  .vl img, .vl .sf { width: 64px; height: 48px; border-radius: 10px; object-fit: cover; background: var(--caja-3); display: block; }
  .vl b { display: block; } .vl small { color: var(--suave); font-size: 12px; } .vl .pr { text-align: right; } .vl .pr b { font-size: 16px; } .vl .pr small { display: block; }
  .chip2 { padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 800; white-space: nowrap; } .chip2.ok { background: var(--verde-fondo); color: var(--verde); } .chip2.pd { background: var(--amarillo-fondo); color: var(--amarillo); } .chip2.no { background: var(--rojo-fondo); color: var(--rojo); }
  @media (max-width: 1200px) { .vt-siempre { grid-template-columns: repeat(3, 1fr); } .vt-siempre a:nth-child(3) { border-right: 0; } .vt-siempre a:nth-child(-n+3) { border-bottom: 1px solid var(--linea); } }
  @media (max-width: 900px) { .vt-kpis { grid-template-columns: 1fr 1fr; } .vt-kpis .vt-k:nth-child(2) { border-right: 0; } .vt-kpis .vt-k:nth-child(-n+2) { border-bottom: 1px solid var(--linea); } .vt-2, .vt-3 { grid-template-columns: 1fr; } }
  @media (max-width: 560px) { .vt-siempre { grid-template-columns: 1fr 1fr; } .vt-siempre a { border-right: 0 !important; border-bottom: 1px solid var(--linea); } .vt-kpis b { font-size: 24px !important; } .vl li a { grid-template-columns: 56px 1fr auto; } .vl .chip2 { display: none; } }`;

const SCRIPT_V = `<script>(() => {
  document.querySelectorAll('.vt-kpis .vt-k').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.vt-kpis .vt-k').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('[data-graf]').forEach((g) => { g.hidden = g.dataset.graf !== b.dataset.ver; });
  }));
  document.querySelectorAll('.vt-g').forEach((g) => {
    const svg = g.querySelector('svg'), tip = g.querySelector('.vt-tip'), guia = g.querySelector('.guia'), foco = g.querySelector('.foco');
    g.querySelectorAll('.zona').forEach((z) => {
      z.addEventListener('mouseenter', () => {
        const k = svg.clientWidth / svg.viewBox.baseVal.width, x = +z.dataset.x, y = +z.dataset.y;
        guia.setAttribute('x1', x); guia.setAttribute('x2', x); guia.style.display = ''; foco.setAttribute('cx', x); foco.setAttribute('cy', y); foco.style.display = '';
        tip.innerHTML = z.dataset.t + '<b>' + z.dataset.v + '</b>'; tip.style.left = (18 + x * k) + 'px'; tip.style.top = (12 + y * k) + 'px'; tip.hidden = false;
      });
    });
    svg.addEventListener('mouseleave', () => { tip.hidden = true; guia.style.display = 'none'; foco.style.display = 'none'; });
  });
})();</script>`;

/** Finanzas › Ventas: lo que ha vendido Sidonia, en el periodo que elijas y desde el principio, con su análisis mes a mes */
export function paginaFinanzas(datos, { p = 'ano', ano = null, hoy = new Date(), error = '', fotos = {}, web = null, avisos = [] } = {}) {
  const { serie, meses: todos, primero, N } = serieMeses(datos, hoy);
  const P = periodo(ano && /^\d{4}$/.test(String(ano)) ? String(ano) : p, hoy, primero);
  const A = tramo(serie, P.meses), B = tramo(serie, entre(P.antes[0], P.antes[1]));
  const R = resumen(datos.ops), siempre = tramo(serie, todos);
  const NA = N[hoy.getFullYear()] || numerosFinanzas(datos, hoy.getFullYear(), hoy);
  const e0 = (x) => eur(x);
  const corto = (v) => (v >= 1e6 ? `${(v / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 1 })} M€` : v >= 1e4 ? `${Math.round(v / 1000).toLocaleString('es-ES')} k€` : eur(v));
  // La gráfica: los meses del periodo (al menos 6, para ver la tendencia)
  const mg = P.meses.length >= 6 ? P.meses : entre(sumaMes(P.hasta, -5), P.hasta);
  const pts = (c) => mg.map((k) => ({ v: n(serie[k]?.[c]), etq: MES_CORTO[Number(k.slice(5)) - 1] + (mg.length > 12 || k.endsWith('-01') ? ` ${k.slice(2, 4)}` : ''), titulo: nombreMes(k, true) }));
  const ticketPts = mg.map((k) => ({ v: serie[k]?.coches ? serie[k].vendido / serie[k].coches : 0, etq: MES_CORTO[Number(k.slice(5)) - 1], titulo: nombreMes(k, true) }));
  const fmtE = (v, eje) => (eje ? corto(v) : eur(v)), fmtC = (v, eje) => (eje ? fmt(Math.round(v)) : `${fmt(Math.round(v))} ${Math.round(v) === 1 ? 'coche' : 'coches'}`);
  const periodoTxt = P.p === 'mes' ? 'frente al mes anterior' : 'vs. periodo anterior';
  // Por marca, por cómo llegó y por comercial (en el periodo)
  const grupo = (f) => { const m = {}; for (const o of A.ventas) { const k = f(o) || '—'; m[k] ||= { k, n: 0, v: 0, c: 0 }; m[k].n += 1; m[k].v += n(o.precio_venta); m[k].c += n(o.comision); } return Object.values(m).sort((a, b) => b.c - a.c || b.n - a.n).slice(0, 7); };
  const lista = (g, vacio) => { const max = Math.max(1, ...g.map((x) => x.c)); return g.length ? `<ul class="barras2">${g.map((x) => `<li><div class="f"><b>${esc(x.k)}</b><b>${eur(x.c)}</b></div><div class="f"><span>${fmt(x.n)} ${x.n === 1 ? 'coche' : 'coches'} · ${eur(x.v)} vendidos</span></div><div class="b"><i style="width:${((x.c / max) * 100).toFixed(1)}%"></i></div></li>`).join('')}</ul>` : `<p class="vacio">${vacio}</p>`; };
  // Lo pendiente de las ventas
  const fact = datos.facturas.filter((f) => f.estado !== 'anulada');
  const facDe = new Map(fact.filter((f) => f.operacion_id).map((f) => [Number(f.operacion_id), f]));
  const anoAhora = String(hoy.getFullYear());
  const sinFactura = datos.ops.filter((o) => o.estado === 'vendido' && o.modalidad !== 'encargo' && String(o.fecha_venta || '').startsWith(anoAhora) && !facDe.has(Number(o.id)));
  const sinCobrar = fact.filter((f) => f.forma_pago && !f.cobrada);
  const pend = [...avisos.map(([t, h]) => ['a', t.replace(/ ›$/, ''), 'En Anuncios', h, 'Ver']), ...sinFactura.map((o) => ['', `Factura: ${o.titulo}`, `Vendido el ${fechaCorta(o.fecha_venta)}${o.comision ? ` · comisión ${eur(o.comision)}` : ''}`, `?estado=expediente&id=${o.id}#factura`, 'Hacer']),
    ...sinCobrar.map((f) => ['c', `Cobrar la factura ${f.numero}`, `${f.cliente} · ${eur(f.total)}`, f.operacion_id ? `?estado=expediente&id=${f.operacion_id}#cobro` : '?estado=facturas', 'Cobrar'])];
  // El ritmo del año
  const mesesAno = P.meses.filter((k) => k.startsWith(anoAhora));
  const transcurrido = hoy.getMonth() + hoy.getDate() / new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  const delAno = tramo(serie, entre(`${anoAhora}-01`, clave(hoy.getFullYear(), hoy.getMonth() + 1)));
  const anual = (v) => (transcurrido ? (v / transcurrido) * 12 : 0);
  // Mes a mes: todos los meses desde el principio (los del periodo, resaltados)
  const maxC = Math.max(1, ...todos.map((k) => serie[k].comision));
  const filasMM = todos.slice().reverse().map((k) => { const s = serie[k];
    return `<tr class="${P.meses.includes(k) ? '' : 'fuera'}"><td class="izq"><b>${esc(nombreMes(k, true))}</b></td><td>${fmt(s.coches)}</td><td>${s.vendido ? eur(s.vendido) : '—'}</td><td class="izq"><span class="bm"><i style="width:${((s.comision / maxC) * 100).toFixed(1)}%"></i></span>${s.comision ? eur(s.comision) : '—'}</td>
      <td>${s.coches ? eur(s.vendido / s.coches) : '—'}</td><td>${s.dias.length ? `${Math.round(s.dias.reduce((a, b) => a + b, 0) / s.dias.length)} días` : '—'}</td><td>${eur(s.gastos + s.irpf)}</td><td class="${s.resultado < 0 ? 'neg' : ''}"><b>${eur(s.resultado)}</b></td></tr>`; }).join('');
  const filaT = (t, x) => `<tr class="tot"><td class="izq">${t}</td><td>${fmt(x.coches)}</td><td>${eur(x.vendido)}</td><td class="izq">${eur(x.comision)}</td><td>${x.coches ? eur(x.ticket) : '—'}</td><td>${x.dias != null ? `${x.dias} días` : '—'}</td><td>${eur(x.gastos + x.irpf)}</td><td class="${x.resultado < 0 ? 'neg' : ''}">${eur(x.resultado)}</td></tr>`;
  const ventas = A.ventas.slice().sort((a, b) => String(b.fecha_venta).localeCompare(String(a.fecha_venta)));
  const filaV = (o) => { const f = facDe.get(Number(o.id));
    const chip = f ? (f.cobrada ? '<span class="chip2 ok">Cobrada</span>' : '<span class="chip2 pd">Sin cobrar</span>') : '<span class="chip2 no">Sin factura</span>';
    return `<li><a href="${o.expediente && Object.keys(o.expediente).length ? `?estado=expediente&id=${Number(o.id)}` : `?estado=operacion&id=${Number(o.id)}`}">${fotos[o.handle] ? `<img src="${esc(fotos[o.handle])}" alt="" loading="lazy">` : '<span class="sf"></span>'}
      <div><b>${esc(o.titulo)}</b><small>${esc(fechaCorta(o.fecha_venta))}${o.propietario_nombre ? ` · ${esc(o.propietario_nombre)}` : ''}${o.comercial ? ` · ${esc(o.comercial)}` : ''}</small></div>${chip}
      <div class="pr"><b>${o.precio_venta ? eur(o.precio_venta) : '—'}</b><small>comisión ${o.comision ? eur(o.comision) : '—'}</small></div></a></li>`; };
  const anos = [...new Set(todos.map((k) => k.slice(0, 4)))].reverse();
  return marco('Ventas', 'finanzas', `
${error ? `<p class="aviso mal">${esc(error)}</p>` : ''}
<div class="vt-cab"><div><h1>Ventas</h1><p>${esc(P.titulo)} · ${esc(nombreMes(P.desde))}${P.desde !== P.hasta ? ` – ${esc(nombreMes(P.hasta))}` : ''}</p></div>
  <div class="seg">${PERIODOS.map(([k, t]) => `<a href="?estado=finanzas&p=${k}" class="${P.p === k ? 'on' : ''}">${t}</a>`).join('')}${anos.length > 1 ? anos.map((a) => `<a href="?estado=finanzas&p=${a}" class="${P.p === a ? 'on' : ''}">${a}</a>`).join('') : ''}</div></div>

<p class="vt-et">Desde el principio</p>
<div class="vt-siempre">
  <a href="?estado=ventas&ver=vendido"><span>Coches vendidos</span><b>${fmt(R.vendidos)}</b><small>desde ${esc(nombreMes(primero))}</small></a>
  <a href="?estado=ventas&ver=vendido"><span>Vendido en total</span><b>${corto(R.facturado)}</b><small>ticket medio ${eur(R.ticket)}</small></a>
  <a href="?estado=ventas"><span>Comisión de Sidonia</span><b>${corto(R.comision)}</b><small>${R.pct.toLocaleString('es-ES', { maximumFractionDigits: 1 })} % de media</small></a>
  <a href="?estado=sidonia&ver=venta"><span>En venta ahora</span><b>${fmt(R.enVenta)}</b><small>${R.comisionPrevista ? `${corto(R.comisionPrevista)} de comisión prevista` : `${corto(R.valorEnVenta)} en coches`}</small></a>
  <a href="?estado=estadisticas"><span>Contactos de la web</span><b>${web ? fmt(web.contactos) : '—'}</b><small>${web ? `+${fmt(web.contactos30)} en 30 días` : 'WhatsApp, llamadas y emails'}</small></a>
  <a href="?estado=clientes"><span>Registrados</span><b>${web ? fmt(web.registros) : '—'}</b><small>${web ? `+${fmt(web.registros30)} en 30 días` : 'personas con cuenta'}</small></a>
</div>

<div class="card vt-main">
  <div class="vt-kpis">
    <div class="vt-k on" role="button" tabindex="0" data-ver="vendido"><span>Vendido</span><b>${e0(A.vendido)}</b>${delta(A.vendido, B.vendido)}<small>${periodoTxt}</small></div>
    <div class="vt-k" role="button" tabindex="0" data-ver="comision"><span>Comisión de Sidonia</span><b>${e0(A.comision)}</b>${delta(A.comision, B.comision)}<small>${A.pct ? `${A.pct.toLocaleString('es-ES', { maximumFractionDigits: 1 })} % de lo vendido` : periodoTxt}</small></div>
    <div class="vt-k" role="button" tabindex="0" data-ver="coches"><span>Coches vendidos</span><b>${fmt(A.coches)}</b>${delta(A.coches, B.coches)}<small>${A.dias != null ? `en ${A.dias} días de media` : periodoTxt}</small></div>
    <div class="vt-k" role="button" tabindex="0" data-ver="ticket"><span>Ticket medio</span><b>${A.coches ? e0(A.ticket) : '—'}</b>${delta(A.ticket, B.ticket)}<small>precio medio de venta</small></div>
  </div>
  ${grafica('vendido', pts('vendido'), { formato: fmtE, visible: true })}${grafica('comision', pts('comision'), { formato: fmtE })}${grafica('coches', pts('coches'), { formato: fmtC })}${grafica('ticket', ticketPts, { formato: fmtE })}
</div>

<div class="vt-2">
  <div class="card"><p class="vt-et">Resultado · ${esc(P.titulo.toLowerCase())}</p>
    <ul class="cuenta"><li class="mas"><span>Comisión de las ventas</span><b>+ ${eur(A.comision)}</b></li><li class="mas"><span>Otros ingresos (servicios facturados, comunidad)</span><b>+ ${eur(A.otros)}</b></li>
    <li class="menos"><span>Gastos (fijos, puntuales y comercial)</span><b>− ${eur(A.gastos)}</b></li><li class="menos"><span>IRPF (pagado o reservado)</span><b>− ${eur(A.irpf)}</b></li>
    <li class="total${A.resultado < 0 ? ' neg' : ''}"><span>Lo que queda</span><b>${eur(A.resultado)}</b></li></ul>
    ${mesesAno.length ? `<p class="ritmo2">A este ritmo, ${anoAhora} cerraría con <b>${fmt(Math.round(anual(delAno.coches)))} coches</b>, <b>${eur(anual(delAno.vendido))}</b> vendidos y <b>${eur(anual(delAno.comision))}</b> de comisión.</p>` : ''}
    <div class="vt-links"><a href="?estado=gastos">Gastos ›</a><a href="?estado=facturas">Facturas ›</a><a href="?estado=impuestos">IVA del ${NA.hacienda.t.slice(6)}.º trimestre: ${eur(NA.hacienda.iva)} ›</a><a href="?estado=meses">Mes a mes con gastos ›</a></div></div>
  <div class="card"><p class="vt-et">Ahora mismo</p>
    <div class="pipe"><a href="?estado=sidonia&ver=venta"><span>En venta</span><b>${fmt(R.enVenta)}</b></a><a href="?estado=sidonia&ver=factura"><span>Por facturar</span><b>${fmt(sinFactura.length)}</b></a><a href="?estado=sidonia&ver=cobro"><span>Por cobrar</span><b>${corto(sinCobrar.reduce((s, f) => s + n(f.total), 0))}</b></a></div>
    ${pend.length ? `<ul class="pend">${pend.slice(0, 6).map(([c, t, s, h, b]) => `<li><i class="${c}"></i><div>${esc(t)}<small>${esc(s)}</small></div><a class="boton claro" href="${h}">${b}</a></li>`).join('')}</ul>${pend.length > 6 ? `<p class="sub"><a href="?estado=sidonia">Y ${pend.length - 6} más en Anuncios ›</a></p>` : ''}` : '<p class="vacio">Todo facturado y cobrado. 👌</p>'}</div>
</div>

<div class="vt-3">
  <div class="card"><p class="vt-et">Por marca</p>${lista(grupo((o) => marcaDe(o.titulo)), 'Sin ventas en este periodo.')}</div>
  <div class="card"><p class="vt-et">Cómo llegó el coche</p>${lista(grupo((o) => ORIGEN[o.expediente?.origen] || 'Antes del panel'), 'Sin ventas en este periodo.')}</div>
  <div class="card"><p class="vt-et">Quién lo llevó</p>${lista(grupo((o) => o.comercial || 'Sin comercial'), 'Sin ventas en este periodo.')}</div>
</div>

<div class="card" style="margin-top:14px"><div class="barra" style="margin:0 0 10px"><p class="vt-et" style="margin:0">Ventas · ${esc(P.titulo.toLowerCase())} · ${fmt(ventas.length)}</p><a class="boton claro" href="?estado=ventas">Todas las ventas ›</a></div>
  ${ventas.length ? `<ul class="vl">${ventas.slice(0, 30).map(filaV).join('')}</ul>` : '<p class="vacio">Aún no hay ventas en este periodo.</p>'}</div>

<div class="card" style="margin-top:14px"><div class="barra" style="margin:0 0 10px"><p class="vt-et" style="margin:0">Análisis mes a mes</p><a class="boton claro" href="?estado=ventas&csv=1">Descargar CSV</a></div>
  <div class="tabla mm"><table><thead><tr><th class="izq">Mes</th><th>Coches</th><th>Vendido</th><th class="izq">Comisión</th><th>Ticket medio</th><th>Días en venderse</th><th>Gastos e IRPF</th><th>Resultado</th></tr></thead>
  <tbody>${filasMM}${filaT(esc(P.titulo), A)}${P.p !== 'todo' ? filaT('Desde el principio', siempre) : ''}</tbody></table></div>
  <p class="nota">Una venta cuenta en el mes en que se vendió. «Días en venderse»: desde que se anunció hasta la venta. Los gastos e IRPF salen de Gastos; el IVA no es un gasto.</p></div>
${SCRIPT_V}`, CSS + CSS2 + CSS_V);
}
const fechaCorta = (f) => (f ? new Date(`${String(f).slice(0, 10)}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

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
  // La web: contactos y registrados desde siempre y en los últimos 30 días (sql/estadisticas.sql)
  let web = null;
  if (deps.db) {
    try {
      const [todo, mes] = await Promise.all([deps.db('sidonia_estadisticas', { p_dias: 3650 }), deps.db('sidonia_estadisticas', { p_dias: 30 })]);
      if (todo && mes) web = { contactos: n(todo.actual?.contactos), registros: n(todo.registros), contactos30: n(mes.actual?.contactos), registros30: n(mes.registros), visitantes30: n(mes.actual?.visitantes) };
    } catch (e) { web = null; }
  }
  return html(paginaFinanzas(datos, { avisos: deps.tareas || [], web, p: req.query.p, ano: req.query.ano, error: faltan.length ? `Faltan datos (${faltan.join(', ')}): ejecuta sql/centro-operativo.sql en Supabase › SQL Editor.` : '', fotos, avisos: deps.tareas || [] }));
}
