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
  for (const k of claves) { const x = mes[k]; x.ingresos = x.ventas + x.servicios + x.comunidad; x.resultado = x.ingresos - x.gastos - x.irpf; }
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
    claves, hasta, mes, sum, vendidasA, sinFactura, pendientesCobro, cobradas, porForma, facturaDe,
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

export function paginaFinanzas(datos, { ano = null, hoy = new Date(), error = '' } = {}) {
  const anos = [...new Set([hoy.getFullYear(), ...datos.ops.map((o) => Number(String(o.fecha_venta || '').slice(0, 4))), ...datos.facturas.map((f) => Number(String(f.fecha).slice(0, 4)))].filter((x) => x > 2000))].sort((a, b) => b - a);
  const A = anos.includes(Number(ano)) ? Number(ano) : hoy.getFullYear();
  const N = numerosFinanzas(datos, A, hoy), T = N.totales;
  const facDe = N.facturaDe;
  const fases = Object.fromEntries(FASES.map(([f]) => [f, 0]));
  for (const o of datos.ops.filter((x) => (x.expediente && Object.keys(x.expediente).length) || x.estado === 'captado')) fases[faseDe(o, facDe.get(Number(o.id)))] += 1;
  const maxF = Math.max(1, ...Object.values(fases));
  const contratos = datos.ops.filter((o) => o.expediente?.contrato?.enviado && !o.expediente.contrato.firma);
  const tareas = [
    ...N.sinFactura.slice(0, 12).map((o) => [`Hacer la factura: ${o.titulo}`, `Vendido el ${String(o.fecha_venta).slice(0, 10)}${o.comision ? ` · comisión ${eur(o.comision)}` : ''}`, `?estado=expediente&id=${o.id}`, 'Hacer factura']),
    ...N.pendientesCobro.slice(0, 12).map((f) => [`Cobrar la factura ${f.numero}`, `${f.cliente} · ${eur(f.total)} · ${FORMAS_PAGO[f.forma_pago] || ''}`, f.operacion_id ? `?estado=expediente&id=${f.operacion_id}` : '?estado=facturas', 'Marcar cobrada']),
    ...N.sinEnlazar.slice(0, 12).map((f) => [`Enlazar la factura ${f.numero} con su venta`, `${f.concepto} · ${eur(f.base)}`, '?estado=facturas', 'Enlazar']),
    ...contratos.slice(0, 12).map((o) => [`Contrato sin firmar: ${o.titulo}`, `Enviado el ${String(o.expediente.contrato.enviado).slice(0, 10)} a ${o.expediente.propietario?.nombre || ''}`, `?estado=expediente&id=${o.id}`, 'Recordar'])
  ];
  const tN = N.hacienda.t;
  return marco('Finanzas', 'finanzas', `
${error ? `<p class="aviso mal">${esc(error)}</p>` : ''}
<div class="barra" style="margin-top:0"><div class="per" style="margin:0">${anos.map((a) => `<a href="?estado=finanzas&ano=${a}" class="${a === A ? 'on' : ''}">${a}</a>`).join('')}</div>
  <a class="boton" href="?estado=expediente&nuevo=1">+ Nuevo coche</a><a class="boton claro" href="?estado=expedientes">Coches en gestión</a></div>
<div class="fz-hero">
  <div class="fz-k top${T.resultado < 0 ? ' neg' : ''}"><span>Resultado ${A}</span><b>${eur(T.resultado)}</b><small>ingresos ${eur(T.ingresos)} − gastos ${eur(T.gastos)} − IRPF ${eur(T.irpf)}</small></div>
  <div class="fz-k"><span>Ingresos</span><b>${eur(T.ingresos)}</b><small>${fmt(T.vendidos)} coches vendidos · servicios · comunidad</small></div>
  <div class="fz-k"><span>Gastos</span><b>${eur(T.gastos)}</b><small><a href="?estado=gastos">ver los gastos ›</a></small></div>
  <div class="fz-k"><span>IRPF</span><b>${eur(T.irpf)}</b><small>pagado o reservado (${IRPF_PCT} %)</small></div>
</div>
<div class="fz-row">
  <div class="fz-k"><a class="ir" href="?estado=facturas">Facturas ›</a><span>Facturado</span><b>${eur(T.facturado)}</b><small>base imponible de las facturas de ${A}</small></div>
  <div class="fz-k${T.pendienteFacturar ? ' neg' : ''}"><span>Pendiente de facturar</span><b>${eur(T.pendienteFacturar)}</b><small>${fmt(N.sinFactura.length)} ventas de ${A} sin factura</small></div>
  <div class="fz-k"><span>Cobrado</span><b>${eur(T.cobrado)}</b><small>facturas cobradas en ${A} (con IVA)</small></div>
  <div class="fz-k${T.pendienteCobro ? ' neg' : ''}"><span>Pendiente de cobro</span><b>${eur(T.pendienteCobro)}</b><small>${fmt(N.pendientesCobro.length)} facturas enviadas sin cobrar</small></div>
</div>
<div class="card"><h2>Mes a mes</h2>${barras(N)}</div>
<div class="fz-3">
  <div class="card"><h2>De dónde viene el dinero</h2>${donut([{ t: 'Comisiones de ventas', v: T.ventas, c: 'var(--verde)' }, { t: 'Otros servicios', v: T.servicios, c: '#5aa9ff' }, { t: 'Comunidad', v: T.comunidad, c: '#c08cff' }], eur(T.ingresos), `ingresos ${A}`)}</div>
  <div class="card"><h2>Cómo cobramos</h2>${donut(Object.entries(N.porForma).map(([k, v], i) => ({ t: FORMAS_PAGO[k] || k, v, c: ['var(--verde)', '#5aa9ff', '#f0b400', '#c08cff'][i % 4] })), eur(T.cobrado), 'cobrado')}</div>
  <div class="card"><h2>Hacienda: ${tN.slice(6)}.º trimestre de ${tN.slice(0, 4)}</h2><div class="hda"><div><span>IVA de las facturas</span><b>${eur(N.hacienda.iva)}</b><span>menos el IVA de los gastos que deduzca la gestoría</span></div><div><span>IRPF estimado</span><b>${eur(N.hacienda.irpf)}</b><span>${IRPF_PCT} % del beneficio del año menos lo ya pagado</span></div></div>
    <p class="nota" style="margin:10px 0 0">Se paga hasta el <b>${new Date(`${N.hacienda.limite}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</b> (modelos 303 y 130). Es una estimación: la cifra buena os la da la gestoría. Cuando lo paguéis, ponedlo en Gastos.</p></div>
</div>
<div class="card" style="margin-top:12px"><h2>Coches en gestión</h2><div class="embudo-f">${FASES.map(([f, nombre]) => `<a href="?estado=expedientes"><b>${fmt(fases[f])}</b><span>${nombre}</span><div class="bar" style="width:${Math.round((fases[f] / maxF) * 100)}%"></div></a>`).join('')}</div></div>
<div class="card" style="margin-top:12px"><h2>Lo que hay que hacer</h2>${tareas.length ? `<ul class="tareas-f">${tareas.map(([titulo, sub, href, boton]) => `<li><div>${esc(titulo)}<small>${esc(sub)}</small></div><span></span><a class="boton claro" href="${href}">${boton} ›</a></li>`).join('')}</ul>` : '<p class="vacio">Todo al día. 🎉</p>'}</div>
<p class="nota">Ingresos: la comisión de cada venta (en el mes en que se vendió), las facturas de otros servicios (marketing, asesoría…) y lo cobrado a la comunidad. Gastos: los de Gastos (sin el IVA, que no es un gasto) y la comisión del comercial. Pendiente de facturar: las ventas de ${A} que aún no tienen su factura enlazada (desde cada coche en gestión, o enlazándola en Facturas).</p>`, CSS);
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
  return html(paginaFinanzas(datos, { ano: req.query.ano, error: faltan.length ? `Faltan datos (${faltan.join(', ')}): ejecuta sql/centro-operativo.sql en Supabase › SQL Editor.` : '' }));
}
