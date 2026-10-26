/* SIDONIA · Anuncios de la comunidad: los que pone cada dueño en Sidonia sin gestión de venta (no hay comisión).
 * El primero de cada persona es gratis un mes; después cada anuncio se paga por meses, con un precio por anuncio que
 * depende de cuántos tenga a la vez (la tarifa). Cada pago queda apuntado: lo que se ha gastado cada uno con nosotros.
 * Los de gestión de venta (comisión) siguen en Ventas.
 *
 *   ?estado=cobros[&ver=…]        Anuncios › Cobros: lo que entra cada mes, lo que hay por cobrar y cada anuncio
 *   ?estado=cobrar&id=<anuncio>   cobrar o renovar un anuncio, recordárselo por email, retirarlo, sus pagos
 *   ?estado=tarifa                los precios
 *   ?estado=anunciantes           Clientes › Anunciantes: cada persona, sus anuncios y lo que lleva gastado
 *   ?estado=anunciante&id=<cli>   uno: sus anuncios y su histórico de pagos
 * Al publicar un anuncio (panel › Por revisar › Publicar) se le da el mes gratis si es el primero; si no, queda por cobrar.
 * La base de datos: sql/comunidad.sql (pagos, ajustes y anuncios.caduca).
 */
import { archivarEnShopify, esc, shopifyAdmin, tablaAnuncios, urlFoto } from './circulo.mjs';
import { enviarCorreo, plantilla } from './correos.mjs';
import { fmt, n } from './estadisticas.mjs';
import { marco, normal } from './operaciones.mjs';

export const TARIFA_BASE = { tramos: [{ desde: 1, precio: 14.9 }, { desde: 2, precio: 12.9 }, { desde: 4, precio: 9.9 }, { desde: 10, precio: 7.9 }], meses_gratis: 1, aviso: 7 };
export const METODOS = { bizum: 'Bizum', transferencia: 'Transferencia', tarjeta: 'Tarjeta', efectivo: 'Efectivo', otro: 'Otro' };
const CONCEPTOS = { gratis: 'Mes gratis', alta: 'Alta', renovacion: 'Renovación', otro: 'Otro' };
// Cómo va cada anuncio: [texto, clase de la píldora]. De peor a mejor (el anunciante lleva el peor de los suyos).
export const COBRO = { por_cobrar: ['Por cobrar', 'retirado'], caducado: ['Caducado', 'retirado'], pronto: ['Caduca pronto', 'reservado'], al_dia: ['Pagado', 'vendido'], gratis: ['Mes gratis', 'en_venta'], inactivo: ['Sin anuncio activo', ''] };
const ORDEN = Object.keys(COBRO);
const ACTIVOS = ['aprobado', 'publicado'];
const DIA = 864e5;

export const eur = (x) => {
  const v = Math.round(n(x) * 100) / 100;
  return `${v.toLocaleString('es-ES', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })} €`;
};
const dia = (t) => (t ? new Date(t).toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');
const pill = (k) => `<span class="pill ${COBRO[k]?.[1] || ''}">${COBRO[k]?.[0] || esc(k)}</span>`;
const fallo = (e) => (/caduca|gratis|pagos|ajustes|schema cache|relation/.test(String(e?.message || e)) ? 'Falta ejecutar sql/comunidad.sql en Supabase › SQL Editor.' : String(e?.message || e));

/** La tarifa limpia: tramos ordenados (el primero desde 1 anuncio), meses gratis y días de aviso */
export function limpiarTarifa(v = {}) {
  const tramos = (Array.isArray(v.tramos) ? v.tramos : [])
    .map((t) => ({ desde: Math.max(1, Math.round(n(t.desde))), precio: Math.max(0, Math.round(n(String(t.precio).replace(',', '.')) * 100) / 100) }))
    .filter((t) => t.desde && String(t.precio) !== 'NaN')
    .sort((a, b) => a.desde - b.desde)
    .filter((t, i, l) => !i || t.desde !== l[i - 1].desde);
  if (!tramos.length) return limpiarTarifa(TARIFA_BASE);
  tramos[0].desde = 1;
  const meses = Number.isFinite(Number(v.meses_gratis)) ? Math.min(12, Math.max(0, Math.round(Number(v.meses_gratis)))) : 1;
  return { tramos, meses_gratis: meses, aviso: Math.min(30, Math.max(1, Math.round(n(v.aviso)) || 7)) };
}

/** Precio al mes de cada anuncio para quien tiene «cuantos» activos */
export function precioMes(tarifa, cuantos) {
  const t = limpiarTarifa(tarifa).tramos.filter((x) => x.desde <= Math.max(1, cuantos));
  return t[t.length - 1].precio;
}

export function sumarMeses(fecha, m) {
  const d = new Date(fecha);
  const dia0 = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + m);
  if (d.getUTCDate() < dia0) d.setUTCDate(0);
  return d;
}

/** Cómo va el pago de un anuncio */
export function estadoCobro(a, ahora = Date.now(), aviso = 7) {
  if (!ACTIVOS.includes(a.estado)) return 'inactivo';
  if (!a.caduca) return 'por_cobrar';
  const t = Date.parse(a.caduca);
  if (t < ahora) return 'caducado';
  if (t - ahora < aviso * DIA) return 'pronto';
  return a.gratis ? 'gratis' : 'al_dia';
}

/** Cada anunciante con sus anuncios (con cómo va cada uno y su precio) y sus pagos */
export function anunciantes(anuncios, pagos, tarifa, ahora = Date.now()) {
  const g = new Map();
  const de = (cliente, x) => {
    if (!g.has(cliente)) g.set(cliente, { cliente, nombre: x.nombre || '', email: x.email || '', telefono: x.telefono || '', tipo: x.tipo || 'particular', anuncios: [], pagos: [], gastado: 0, desde: x.creado || null });
    return g.get(cliente);
  };
  for (const a of [...anuncios].sort((x, y) => String(x.creado).localeCompare(String(y.creado)))) {
    const x = de(a.cliente, { nombre: a.vendedor_nombre, email: a.email, telefono: a.telefono, tipo: a.vendedor_tipo, creado: a.creado });
    Object.assign(x, { nombre: a.vendedor_nombre || x.nombre, email: a.email || x.email, telefono: a.telefono || x.telefono, tipo: a.vendedor_tipo || x.tipo });
    x.anuncios.push({ ...a });
  }
  for (const p of pagos) {
    const x = de(p.cliente, { nombre: p.nombre, email: p.email, creado: p.creado });
    x.pagos.push(p);
    x.gastado += n(p.importe);
  }
  const t = limpiarTarifa(tarifa);
  return [...g.values()].map((x) => {
    const activos = x.anuncios.filter((a) => ACTIVOS.includes(a.estado));
    const precio = precioMes(t, activos.length);
    for (const a of x.anuncios) {
      a.cobro = estadoCobro(a, ahora, t.aviso);
      a.precio_mes = ACTIVOS.includes(a.estado) ? precio : 0;
      a.gastado = x.pagos.filter((p) => Number(p.anuncio) === Number(a.id)).reduce((s, p) => s + n(p.importe), 0);
    }
    x.pagos.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || n(b.id) - n(a.id));
    const pagados = x.pagos.filter((p) => n(p.importe) > 0);
    const caducas = activos.map((a) => a.caduca).filter(Boolean).sort();
    return {
      ...x, activos: activos.length, precio_mes: precio,
      mensual: activos.filter((a) => !enGratis({ ...a, cobro: estadoCobro(a, ahora, t.aviso) })).length * precio,
      ultimo_pago: pagados[0]?.fecha || null, proximo: caducas[0] || null,
      estado: activos.length ? ORDEN.find((k) => activos.some((a) => a.cobro === k)) : 'inactivo'
    };
  }).sort((a, b) => ORDEN.indexOf(a.estado) - ORDEN.indexOf(b.estado) || b.gastado - a.gastado || String(a.nombre).localeCompare(String(b.nombre)));
}

/** Lo que entra: por mes (los 12 últimos), este mes, el anterior, el año, todo; y lo que está por venir */
export function metricas(lista, pagos, ahora = Date.now()) {
  const mesDe = (d) => String(d || '').slice(0, 7);
  const hoy = new Date(ahora);
  const meses = Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 11 + i, 1)); return d.toISOString().slice(0, 7); });
  const porMes = Object.fromEntries(meses.map((m) => [m, 0]));
  let total = 0;
  for (const p of pagos) {
    total += n(p.importe);
    if (mesDe(p.fecha) in porMes) porMes[mesDe(p.fecha)] += n(p.importe);
  }
  const activos = lista.flatMap((x) => x.anuncios.filter((a) => ACTIVOS.includes(a.estado)));
  const cuenta = (k) => activos.filter((a) => a.cobro === k);
  const pagadores = lista.filter((x) => x.gastado > 0);
  return {
    meses: meses.map((m) => [m, porMes[m]]), total,
    este_mes: porMes[meses[11]], mes_anterior: porMes[meses[10]], ano: meses.reduce((s, m) => s + porMes[m], 0),
    activos: activos.length, de_pago: activos.filter((a) => !a.gratis && a.caduca).length, gratis: activos.filter(enGratis).length,
    por_cobrar: [...cuenta('por_cobrar'), ...cuenta('caducado')], pronto: cuenta('pronto'),
    mensual: activos.filter((a) => !enGratis(a)).reduce((s, a) => s + n(a.precio_mes), 0),
    anunciantes: lista.length, con_activo: lista.filter((x) => x.activos).length, pagadores: pagadores.length,
    medio: pagadores.length ? pagadores.reduce((s, x) => s + x.gastado, 0) / pagadores.length : 0
  };
}

/* ---------------------------------------------------------------------------- Base de datos */
export async function leerTarifa(t) {
  try { return limpiarTarifa((await t.leer('clave=eq.tarifa&select=valor'))[0]?.valor || TARIFA_BASE); } catch (e) { return limpiarTarifa(TARIFA_BASE); }
}

/** Cobra (o renueva) un anuncio: «meses» más desde que caduca (o desde hoy si ya ha caducado o no tenía) */
export async function registrarPago(tA, tP, a, { meses = 1, importe = 0, metodo = '', fecha = '', nota = '' }, ahora = Date.now()) {
  const desde = new Date(Math.max(a.caduca ? Date.parse(a.caduca) : 0, ahora));
  const hasta = sumarMeses(desde, meses);
  const pago = {
    cliente: a.cliente, anuncio: a.id, titulo: a.titulo || '', nombre: a.vendedor_nombre || '', email: a.email || '',
    concepto: a.caduca ? 'renovacion' : 'alta', meses, importe, metodo, fecha: fecha || new Date(ahora).toISOString().slice(0, 10),
    desde: desde.toISOString(), hasta: hasta.toISOString(), nota
  };
  await tP.guardar(pago, 'id');
  await tA.cambiar(a.id, { caduca: hasta.toISOString(), gratis: false });
  return { ...pago, hasta };
}

/** Al publicar: el primer anuncio de cada persona, gratis; los demás quedan por cobrar. Devuelve el texto para el aviso. */
export async function altaComunidad(cfg, deps, a, ahora = Date.now()) {
  if (!a?.cliente || a.caduca) return '';
  try {
    const tA = deps.tabla || tablaAnuncios(cfg, deps.fetch);
    const tP = deps.pagos || tablaAnuncios(cfg, deps.fetch, 'pagos');
    const tarifa = await leerTarifa(deps.ajustes || tablaAnuncios(cfg, deps.fetch, 'ajustes'));
    const previos = await tP.leer(`cliente=eq.${encodeURIComponent(a.cliente)}&select=id&limit=1`);
    if (!previos.length && tarifa.meses_gratis > 0) {
      const hasta = sumarMeses(ahora, tarifa.meses_gratis);
      await tP.guardar({ cliente: a.cliente, anuncio: a.id, titulo: a.titulo || '', nombre: a.vendedor_nombre || '', email: a.email || '', concepto: 'gratis', meses: tarifa.meses_gratis, importe: 0, fecha: new Date(ahora).toISOString().slice(0, 10), desde: new Date(ahora).toISOString(), hasta: hasta.toISOString(), nota: 'Su primer anuncio' }, 'id');
      await tA.cambiar(a.id, { caduca: hasta.toISOString(), gratis: true });
      return ` Es su primer anuncio: gratis hasta el ${dia(hasta)}.`;
    }
    const activos = await tA.leer(`cliente=eq.${encodeURIComponent(a.cliente)}&estado=in.(${ACTIVOS.join(',')})&select=id`);
    return ` No es su primer anuncio: queda por cobrar (${eur(precioMes(tarifa, activos.length))} al mes) en Anuncios › Cobros.`;
  } catch (e) {
    console.error(e);
    return '';
  }
}

/** El email de «renueva tu anuncio» */
export function correoRenovar(cfg, a, precio) {
  const caducado = a.caduca && Date.parse(a.caduca) < Date.now();
  const wa = `https://wa.me/${cfg.whatsapp || '34675287095'}?text=${encodeURIComponent(`Hola, quiero renovar mi anuncio «${a.titulo}» en Sidonia`)}`;
  const p = (t) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#3a3833">${t}</p>`;
  return {
    asunto: caducado ? `Tu anuncio «${a.titulo}» ha caducado` : a.caduca ? `Tu anuncio «${a.titulo}» caduca el ${dia(a.caduca)}` : `Activa tu anuncio «${a.titulo}» en Sidonia`,
    html: plantilla(cfg, a, {
      antetitulo: 'Tu anuncio en Sidonia',
      titulo: caducado ? 'Tu anuncio ha caducado' : a.caduca ? `Caduca el ${dia(a.caduca)}` : 'Activa tu anuncio',
      cuerpo: p(`Hola ${esc(a.vendedor_nombre || '')}:`) + p(`Para que <b>${esc(a.titulo)}</b> siga en Sidonia otro mes son <b>${eur(precio)}</b>.`) + p('Contesta a este email o escríbenos por WhatsApp y te decimos cómo pagar (Bizum o transferencia). Si ya no lo vendes, no hagas nada.'),
      boton: 'Renovar por WhatsApp', enlace: wa
    })
  };
}

/* ---------------------------------------------------------------------------- Páginas */
const CSS = `
  .mini { width: 56px; height: 42px; border-radius: 8px; object-fit: cover; display: block; background: var(--caja-3); }
  td.foto { width: 56px; padding-right: 0; }
  .barras { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 6px; align-items: end; padding: 8px 2px 0; }
  .barras div { display: flex; flex-direction: column; justify-content: flex-end; gap: 4px; text-align: center; min-width: 0; }
  .barras i { display: block; border-radius: 6px 6px 2px 2px; background: var(--verde); min-height: 2px; }
  .barras small { font-size: 11px; color: var(--flojo); white-space: nowrap; overflow: hidden; } .barras b { font-size: 11px; color: var(--suave); white-space: nowrap; overflow: hidden; }
  .tramos { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; } .tramos span { padding: 8px 12px; border-radius: 10px; background: var(--fondo-2); font-size: 14px; }
  .tramos b { color: var(--verde); }
  table.pagos td { white-space: nowrap; }
  table.pagos button.enlace { background: none; border: 0; padding: 0; box-shadow: none; color: var(--rojo); font: inherit; font-weight: 700; cursor: pointer; }
  @media (max-width: 700px) { .barras { gap: 3px; } .barras b { display: none; } td.foto, th.foto { display: none; } }`;

const aviso = (t) => (t ? `<p class="aviso${/^Error/.test(t) ? ' mal' : ''}">${esc(t)}</p>` : '');
const quedan = (a, ahora = Date.now()) => {
  if (!a.caduca) return 'sin pagar';
  const d = Math.ceil((Date.parse(a.caduca) - ahora) / DIA);
  return d < 0 ? `hace ${-d} ${d === -1 ? 'día' : 'días'}` : d === 0 ? 'hoy' : `quedan ${d} ${d === 1 ? 'día' : 'días'}`;
};
const buscador = (ph) => `<input type="search" placeholder="${ph}" oninput="const q=this.value.trim().toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');document.querySelectorAll('tr[data-q]').forEach((tr)=>{tr.hidden=q&&!tr.dataset.q.includes(q)})">`;
const tel = (t) => String(t || '').replace(/\D/g, '').replace(/^(?=[6789]\d{8}$)/, '34');
const contacto = (t, e) => (t || e ? `<p class="contacto">${t ? `<a href="https://wa.me/${tel(t)}" target="_blank" rel="noopener">WhatsApp</a><a href="tel:+${tel(t)}">Llamar</a>` : ''}${e ? `<a href="mailto:${esc(e)}">Email</a>` : ''}</p>` : '');

const rango = (t, sig) => (sig ? (sig.desde - 1 === t.desde ? `${t.desde}` : `${t.desde}–${sig.desde - 1}`) : `${t.desde} o más`);
const enGratis = (a) => a.gratis && a.caduca && a.cobro !== 'caducado';

function grafica(meses) {
  const max = Math.max(1, ...meses.map(([, v]) => v));
  const nombre = (m) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('es-ES', { month: 'short' }).replace('.', '');
  return `<div class="barras">${meses.map(([m, v]) => `<div title="${m}: ${eur(v)}"><b>${v ? eur(Math.round(v)) : ''}</b><i style="height:${Math.max(2, Math.round((v / max) * 110))}px"></i><small>${nombre(m)}</small></div>`).join('')}</div>`;
}

function filaAnuncio(cfg, a, x, { conAnunciante = true } = {}) {
  const f = (a.fotos || [])[0];
  return `<tr data-q="${esc(normal(`${a.titulo} ${x.nombre} ${x.email} ${x.telefono}`))}" onclick="if(!event.target.closest('a'))location.href='?estado=cobrar&id=${a.id}'">
    <td class="foto">${f ? `<img class="mini" src="${esc(urlFoto(cfg, f))}" alt="" loading="lazy">` : '<span class="mini"></span>'}</td>
    <td class="izq"><b>${esc(a.titulo)}</b><span class="sub">#${a.id}${a.producto ? ` · <a href="${esc(cfg.tienda)}/products/${esc(a.producto)}" target="_blank" rel="noopener">ver en la web</a>` : ''}</span></td>
    ${conAnunciante ? `<td class="izq"><a href="?estado=anunciante&id=${encodeURIComponent(x.cliente)}">${esc(x.nombre || '—')}</a><span class="sub">${x.activos} ${x.activos === 1 ? 'anuncio' : 'anuncios'}</span></td>` : ''}
    <td class="izq">${pill(a.cobro)}</td>
    <td class="izq">${dia(a.caduca)}<span class="sub">${quedan(a)}</span></td>
    <td>${a.precio_mes ? eur(a.precio_mes) : '—'}</td>
    <td>${a.gastado ? eur(a.gastado) : '—'}</td>
    <td><a href="?estado=cobrar&id=${a.id}">${a.cobro === 'inactivo' ? 'Ver' : 'Cobrar'} ›</a></td></tr>`;
}

export function paginaCobros(cfg, lista, pagos, tarifa, { ver = 'todo', aviso: av = '', error = '' } = {}) {
  const m = metricas(lista, pagos);
  const todos = lista.flatMap((x) => x.anuncios.filter((a) => a.cobro !== 'inactivo').map((a) => [a, x]));
  const filtros = { todo: 'Todos', cobrar: 'Por cobrar', pronto: 'Caducan pronto', al_dia: 'Pagados', gratis: 'Mes gratis' };
  const encaja = (a) => ver === 'todo' || (ver === 'cobrar' ? ['por_cobrar', 'caducado'].includes(a.cobro) : a.cobro === ver);
  const cuantos = (k) => todos.filter(([a]) => (k === 'todo' ? true : k === 'cobrar' ? ['por_cobrar', 'caducado'].includes(a.cobro) : a.cobro === k)).length;
  const filas = todos.filter(([a]) => encaja(a)).sort(([a], [b]) => ORDEN.indexOf(a.cobro) - ORDEN.indexOf(b.cobro) || String(a.caduca || '').localeCompare(String(b.caduca || ''))).map(([a, x]) => filaAnuncio(cfg, a, x)).join('');
  const porCobrar = m.por_cobrar.reduce((s, a) => s + n(a.precio_mes), 0);
  const cambio = m.mes_anterior ? Math.round(((m.este_mes - m.mes_anterior) / m.mes_anterior) * 100) : null;
  const ultimos = pagos.filter((p) => n(p.importe) > 0).slice(0, 8);
  return marco('Cobros de la comunidad', 'cobros', `
${aviso(av)}${error ? `<p class="aviso mal">${esc(error)}</p>` : ''}
<div class="kpis">
  <div class="kpi"><span>Este mes</span><b>${eur(m.este_mes)}</b><small>${cambio == null ? 'cobrado a la comunidad' : (cambio ? `<em class="${cambio > 0 ? 'sube' : 'baja'}">${cambio > 0 ? '+' : '−'}${Math.abs(cambio)} %</em>` : '<em>=</em>') + ' frente al mes pasado'}</small></div>
  <div class="kpi"><span>Al mes, previsto</span><b>${eur(m.mensual)}</b><small>si renuevan todos los de pago</small></div>
  <div class="kpi"><span>Últimos 12 meses</span><b>${eur(m.ano)}</b><small>${eur(m.total)} desde el principio</small></div>
  <div class="kpi"><span>Por cobrar</span><b>${fmt(m.por_cobrar.length)}</b><small>${porCobrar ? `${eur(porCobrar)} al mes` : 'nada pendiente'}</small></div>
  <div class="kpi"><span>Caducan pronto</span><b>${fmt(m.pronto.length)}</b><small>en ${tarifa.aviso} días o menos</small></div>
  <div class="kpi"><span>Anuncios activos</span><b>${fmt(m.activos)}</b><small>${fmt(m.de_pago)} de pago · ${fmt(m.gratis)} gratis</small></div>
  <div class="kpi"><span>Anunciantes que pagan</span><b>${fmt(m.pagadores)}</b><small>de ${fmt(m.anunciantes)} (${m.anunciantes ? Math.round((m.pagadores / m.anunciantes) * 100) : 0} %) · ${eur(Math.round(m.medio))} de media</small></div>
</div>
<div class="card"><h3>Lo que entra cada mes</h3>${grafica(m.meses)}</div>
<div class="card"><div class="cab" style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><h3 style="margin:0">Tarifa · por anuncio y mes</h3><a class="boton claro" href="?estado=tarifa">Cambiar la tarifa</a></div>
  <p class="tramos">${tarifa.tramos.map((t, i, l) => { const r = rango(t, l[i + 1]); return `<span>${r} ${r === '1' ? 'anuncio' : 'anuncios'}: <b>${eur(t.precio)}</b></span>`; }).join('')}<span>El primero: <b>${tarifa.meses_gratis ? `${tarifa.meses_gratis} ${tarifa.meses_gratis === 1 ? 'mes' : 'meses'} gratis` : 'sin mes gratis'}</b></span></p></div>
<div class="barra">
  <div class="per" style="margin:0">${Object.entries(filtros).map(([k, t]) => `<a href="?estado=cobros&ver=${k}" class="${k === ver ? 'on' : ''}">${t} <small>${fmt(cuantos(k))}</small></a>`).join('')}</div>
  ${buscador('Buscar anuncio o anunciante…')}
</div>
<div class="card"><div class="tabla"><table>
  <thead><tr><th class="izq foto"></th><th class="izq">Anuncio</th><th class="izq">Anunciante</th><th class="izq">Pago</th><th class="izq">Hasta</th><th>Al mes</th><th>Pagado</th><th></th></tr></thead>
  <tbody>${filas || '<tr><td colspan="8" class="vacio">No hay anuncios de la comunidad aquí.</td></tr>'}</tbody>
</table></div></div>
${ultimos.length ? `<div class="card"><h3>Últimos cobros</h3><div class="tabla"><table class="pagos"><thead><tr><th class="izq">Fecha</th><th class="izq">Anunciante</th><th class="izq">Anuncio</th><th class="izq">Cómo</th><th>Importe</th></tr></thead><tbody>
  ${ultimos.map((p) => `<tr><td class="izq">${dia(p.fecha)}</td><td class="izq"><a href="?estado=anunciante&id=${encodeURIComponent(p.cliente)}">${esc(p.nombre || '—')}</a></td><td class="izq">${esc(p.titulo)}</td><td class="izq">${esc(METODOS[p.metodo] || p.metodo || '—')}</td><td>${eur(p.importe)}</td></tr>`).join('')}
</tbody></table></div></div>` : ''}
<p class="nota">Solo los anuncios de la comunidad (los que pone cada dueño). Los de gestión de venta, con su comisión, están en Ventas. Pulsa en un anuncio para cobrarlo o renovarlo.</p>`, CSS);
}

export function paginaCobrar(cfg, a, x, tarifa, { aviso: av = '' } = {}) {
  if (!a) return marco('Cobrar', 'cobros', `<p><a href="?estado=cobros">‹ Cobros</a></p><p class="aviso mal">No encuentro ese anuncio.</p>`, CSS);
  const pagosA = x.pagos.filter((p) => Number(p.anuncio) === Number(a.id));
  const precio = a.precio_mes || precioMes(tarifa, x.activos || 1);
  const desde = new Date(Math.max(a.caduca ? Date.parse(a.caduca) : 0, Date.now()));
  const activo = ACTIVOS.includes(a.estado);
  return marco(`Cobrar · ${a.titulo}`, 'cobros', `
<p><a href="?estado=cobros">‹ Cobros</a> · <a href="?estado=anunciante&id=${encodeURIComponent(x.cliente)}">${esc(x.nombre || 'Anunciante')} ›</a></p>
${aviso(av)}
<div class="card cab"><div><h2>${esc(a.titulo)} ${pill(a.cobro)}</h2>
  <p>${activo ? (a.caduca ? `${a.gratis ? 'Gratis' : 'Pagado'} hasta el <b>${dia(a.caduca)}</b> (${quedan(a)})` : 'Publicado <b>sin pagar</b>') : 'Ya no está activo'}${a.producto ? ` · <a href="${esc(cfg.tienda)}/products/${esc(a.producto)}" target="_blank" rel="noopener">ver en la web</a>` : ''}</p>
  <p class="sub">${esc(x.nombre)} · ${x.activos} ${x.activos === 1 ? 'anuncio activo' : 'anuncios activos'}: ${eur(precio)} al mes cada uno · lleva gastado ${eur(x.gastado)}</p></div>
  ${contacto(x.telefono, x.email)}</div>
${activo ? `<form class="op" method="post" action="?estado=cobrar&id=${a.id}">
  <section class="grupo"><h3>Cobrar</h3>
    <div class="fila c3">
      <label>Meses<select name="meses">${[1, 2, 3, 6, 12].map((m) => `<option value="${m}">${m} ${m === 1 ? 'mes' : 'meses'}</option>`).join('')}</select></label>
      <label>Importe (€)<input name="importe" type="number" step="any" min="0" inputmode="decimal" value="${precio}" data-precio="${precio}"></label>
      <div class="dato"><span>Quedará hasta</span><b data-hasta>${dia(sumarMeses(desde, 1))}</b></div>
    </div>
    <div class="fila c3">
      <label>Cómo ha pagado<select name="metodo">${Object.entries(METODOS).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
      <label>Fecha del pago<input name="fecha" type="date" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label>Nota<input name="nota" placeholder="Opcional"></label>
    </div>
    <small class="ayuda">Se suma desde que caduca (o desde hoy si ya ha caducado). Importe 0 = un mes de regalo.</small>
    <div class="acc"><button class="boton" name="accion" value="cobrar">Apuntar el pago</button>
      ${x.email ? '<button class="boton claro" name="accion" value="recordar">Recordárselo por email</button>' : ''}
      ${a.cobro === 'caducado' || a.cobro === 'por_cobrar' ? '<button class="boton rojo" name="accion" value="retirar" onclick="return confirm(\'¿Retirar el anuncio de la web?\')">Retirar de la web</button>' : ''}</div>
  </section>
  <script>
    (() => {
      const f = document.currentScript.closest('form');
      const desde = new Date(${JSON.stringify(desde.toISOString())});
      const pinta = () => {
        const m = Number(f.meses.value) || 1, d = new Date(desde), dd = d.getUTCDate();
        d.setUTCMonth(d.getUTCMonth() + m); if (d.getUTCDate() < dd) d.setUTCDate(0);
        f.querySelector('[data-hasta]').textContent = d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
      };
      f.meses.addEventListener('change', () => { f.importe.value = Math.round(Number(f.importe.dataset.precio) * Number(f.meses.value) * 100) / 100; pinta(); });
    })();
  </script>
</form>` : ''}
<div class="card"><h3>Pagos de este anuncio</h3>${tablaPagos(pagosA, { anuncio: a.id })}</div>`, CSS);
}

function tablaPagos(pagos, { anuncio = null, conAnuncio = false } = {}) {
  if (!pagos.length) return '<p class="vacio">Aún no hay pagos.</p>';
  return `<div class="tabla"><table class="pagos"><thead><tr><th class="izq">Fecha</th>${conAnuncio ? '<th class="izq">Anuncio</th>' : ''}<th class="izq">Concepto</th><th class="izq">Cubre</th><th class="izq">Cómo</th><th>Importe</th>${anuncio ? '<th></th>' : ''}</tr></thead><tbody>
  ${pagos.map((p) => `<tr><td class="izq">${dia(p.fecha)}</td>${conAnuncio ? `<td class="izq"><a href="?estado=cobrar&id=${p.anuncio}">${esc(p.titulo || `#${p.anuncio}`)}</a></td>` : ''}<td class="izq">${esc(CONCEPTOS[p.concepto] || p.concepto)}${p.nota ? `<span class="sub">${esc(p.nota)}</span>` : ''}</td>
    <td class="izq">${p.hasta ? `${dia(p.desde)} → ${dia(p.hasta)}` : `${p.meses} ${p.meses === 1 ? 'mes' : 'meses'}`}</td><td class="izq">${esc(METODOS[p.metodo] || p.metodo || '—')}</td><td>${eur(p.importe)}</td>
    ${anuncio ? `<td><form method="post" action="?estado=cobrar&id=${anuncio}" onsubmit="return confirm('¿Borrar este pago? La fecha de caducidad se recalcula.')"><input type="hidden" name="pago" value="${p.id}"><button class="enlace" name="accion" value="borrar_pago">Borrar</button></form></td>` : ''}</tr>`).join('')}
</tbody></table></div>`;
}

export function paginaTarifa(tarifa, { aviso: av = '' } = {}) {
  const filas = [...tarifa.tramos, ...Array(Math.max(0, 6 - tarifa.tramos.length)).fill({ desde: '', precio: '' })];
  return marco('Tarifa', 'cobros', `
<p><a href="?estado=cobros">‹ Cobros</a></p>
${aviso(av)}
<form class="op" method="post" action="?estado=tarifa">
  <section class="grupo"><h3>Precio por anuncio y mes</h3>
    <small class="ayuda">Cada anuncio paga según cuántos tiene activos esa persona a la vez. Ejemplo: «desde 2 anuncios, 12,90 €» = quien tiene 2 o 3 paga 12,90 € al mes por cada uno.</small>
    ${filas.map((t, i) => `<div class="fila c3"><label>Desde (anuncios)<input name="desde_${i}" type="number" min="1" step="1" value="${i === 0 ? 1 : esc(t.desde)}"${i === 0 ? ' readonly' : ''}></label><label>€ al mes cada uno<input name="precio_${i}" type="number" min="0" step="any" inputmode="decimal" value="${esc(t.precio)}"></label><div class="dato"><span>${i === 0 ? 'Su primer anuncio (tras el mes gratis)' : 'Vacío = sin este tramo'}</span></div></div>`).join('')}
  </section>
  <section class="grupo"><h3>Mes gratis y avisos</h3>
    <div class="fila c3">
      <label>Meses gratis del primer anuncio<input name="meses_gratis" type="number" min="0" max="12" step="1" value="${tarifa.meses_gratis}"></label>
      <label>Avisar cuando falten (días)<input name="aviso" type="number" min="1" max="30" step="1" value="${tarifa.aviso}"></label>
      <div class="dato"><span>Solo el primer anuncio de cada persona es gratis.</span></div>
    </div>
  </section>
  <div class="acc"><button class="boton" name="accion" value="guardar">Guardar la tarifa</button><a class="boton claro" href="?estado=cobros">Cancelar</a></div>
</form>`, CSS);
}

export function leerFormTarifa(b) {
  const tramos = [];
  for (let i = 0; i < 12; i += 1) {
    if (b[`precio_${i}`] === undefined) break;
    if (String(b[`precio_${i}`]).trim() === '' || (i && String(b[`desde_${i}`] ?? '').trim() === '')) continue;
    tramos.push({ desde: i ? b[`desde_${i}`] : 1, precio: b[`precio_${i}`] });
  }
  return limpiarTarifa({ tramos, meses_gratis: b.meses_gratis, aviso: b.aviso });
}

export function paginaAnunciantes(cfg, lista, pagos, { error = '' } = {}) {
  const m = metricas(lista, pagos);
  const filas = lista.map((x) => `<tr data-q="${esc(normal(`${x.nombre} ${x.email} ${x.telefono} ${x.anuncios.map((a) => a.titulo).join(' ')}`))}" onclick="if(!event.target.closest('a'))location.href='?estado=anunciante&id=${encodeURIComponent(x.cliente)}'">
    <td class="izq"><b>${esc(x.nombre || '—')}</b><span class="sub">${esc(x.tipo === 'profesional' ? 'Profesional' : 'Particular')}${x.email ? ` · ${esc(x.email)}` : ''}</span></td>
    <td class="izq">${pill(x.estado)}</td>
    <td>${fmt(x.activos)}<span class="sub">de ${fmt(x.anuncios.length)}</span></td>
    <td>${x.activos ? eur(x.precio_mes) : '—'}</td>
    <td class="izq">${dia(x.proximo)}</td>
    <td><b>${eur(x.gastado)}</b><span class="sub">${x.ultimo_pago ? `último ${dia(x.ultimo_pago)}` : 'sin pagos'}</span></td>
    <td><a href="?estado=anunciante&id=${encodeURIComponent(x.cliente)}">Ver ›</a></td></tr>`).join('');
  return marco('Anunciantes', 'anunciantes', `
${error ? `<p class="aviso mal">${esc(error)}</p>` : ''}
<div class="kpis">
  <div class="kpi"><span>Anunciantes</span><b>${fmt(m.anunciantes)}</b><small>${fmt(m.con_activo)} con anuncio activo</small></div>
  <div class="kpi"><span>Pagan</span><b>${fmt(m.pagadores)}</b><small>${m.anunciantes ? Math.round((m.pagadores / m.anunciantes) * 100) : 0} % de los anunciantes</small></div>
  <div class="kpi"><span>Gastado en total</span><b>${eur(m.total)}</b><small>${eur(Math.round(m.medio))} de media por quien paga</small></div>
  <div class="kpi"><span>Al mes, previsto</span><b>${eur(m.mensual)}</b></div>
</div>
<div class="barra">${buscador('Buscar anunciante, email, teléfono o anuncio…')}</div>
<div class="card"><div class="tabla"><table>
  <thead><tr><th class="izq">Anunciante</th><th class="izq">Pago</th><th>Anuncios</th><th>Al mes, cada uno</th><th class="izq">Próximo vencimiento</th><th>Gastado</th><th></th></tr></thead>
  <tbody>${filas || '<tr><td colspan="7" class="vacio">Aún no hay anunciantes: llegan con el formulario «Anuncia gratis» de la web.</td></tr>'}</tbody>
</table></div></div>
<p class="nota">Quien pone sus anuncios en Sidonia sin gestión de venta. Los propietarios de las ventas gestionadas (con comisión) están en Clientes › Propietarios.</p>`, CSS);
}

export function paginaAnunciante(cfg, x, { aviso: av = '' } = {}) {
  if (!x) return marco('Anunciante', 'anunciantes', '<p><a href="?estado=anunciantes">‹ Anunciantes</a></p><p class="aviso mal">No encuentro a ese anunciante.</p>', CSS);
  return marco(x.nombre || 'Anunciante', 'anunciantes', `
<p><a href="?estado=anunciantes">‹ Anunciantes</a></p>
${aviso(av)}
<div class="card cab"><div><h2>${esc(x.nombre || '—')} ${pill(x.estado)}</h2>
  <p class="sub">${esc(x.tipo === 'profesional' ? 'Profesional' : 'Particular')}${x.email ? ` · ${esc(x.email)}` : ''}${x.telefono ? ` · ${esc(x.telefono)}` : ''} · anuncia desde el ${dia(x.desde)} · <a href="?estado=cliente&id=${encodeURIComponent(x.cliente)}">lo que hace en la web ›</a></p></div>
  ${contacto(x.telefono, x.email)}</div>
<div class="kpis">
  <div class="kpi"><span>Lleva gastado</span><b>${eur(x.gastado)}</b><small>${fmt(x.pagos.filter((p) => n(p.importe) > 0).length)} pagos</small></div>
  <div class="kpi"><span>Anuncios activos</span><b>${fmt(x.activos)}</b><small>de ${fmt(x.anuncios.length)} en total</small></div>
  <div class="kpi"><span>Paga al mes</span><b>${eur(x.mensual)}</b><small>${x.activos ? `${eur(x.precio_mes)} por anuncio` : '—'}</small></div>
  <div class="kpi"><span>Próximo vencimiento</span><b>${x.proximo ? dia(x.proximo) : '—'}</b></div>
</div>
<div class="card"><h3>Sus anuncios</h3><div class="tabla"><table>
  <thead><tr><th class="izq foto"></th><th class="izq">Anuncio</th><th class="izq">Pago</th><th class="izq">Hasta</th><th>Al mes</th><th>Pagado</th><th></th></tr></thead>
  <tbody>${[...x.anuncios].reverse().map((a) => filaAnuncio(cfg, a, x, { conAnunciante: false })).join('')}</tbody>
</table></div></div>
<div class="card"><h3>Lo que ha pagado</h3>${tablaPagos(x.pagos, { conAnuncio: true })}</div>`, CSS);
}

/* ---------------------------------------------------------------------------- Rutas */
export async function rutasComunidad(req, cfg, deps, html) {
  const estado = req.query.estado;
  const tA = deps.tabla || tablaAnuncios(cfg, deps.fetch);
  const tP = deps.pagos || tablaAnuncios(cfg, deps.fetch, 'pagos');
  const tAj = deps.ajustes || tablaAnuncios(cfg, deps.fetch, 'ajustes');
  const b = req.body || {};
  let av = '', error = '';
  let tarifa = await leerTarifa(tAj);

  if (estado === 'tarifa') {
    if (req.method === 'POST' && b.accion === 'guardar') {
      try {
        tarifa = leerFormTarifa(b);
        await tAj.guardar({ clave: 'tarifa', valor: tarifa, actualizado: new Date().toISOString() }, 'clave');
        av = 'Tarifa guardada.';
      } catch (e) { av = `Error: ${fallo(e)}`; }
    }
    return html(paginaTarifa(tarifa, { aviso: av }));
  }

  let anuncios = [], pagos = [];
  const cargar = async () => {
    anuncios = await tA.leer('select=id,cliente,estado,tipo,titulo,precio,fotos,vendedor_nombre,vendedor_tipo,telefono,email,producto,creado,caduca,gratis&order=creado.asc&limit=5000');
    pagos = await tP.leer('select=*&order=fecha.desc,id.desc&limit=10000');
  };
  try { await cargar(); } catch (e) { error = fallo(e); }

  if (estado === 'cobrar') {
    const id = Number(req.query.id);
    let a = anuncios.find((x) => Number(x.id) === id);
    if (a && req.method === 'POST') {
      try {
        const lista0 = anunciantes(anuncios, pagos, tarifa);
        const x0 = lista0.find((x) => x.cliente === a.cliente);
        const a0 = x0.anuncios.find((y) => Number(y.id) === id);
        if (b.accion === 'cobrar') {
          const meses = [1, 2, 3, 6, 12].includes(Number(b.meses)) ? Number(b.meses) : 1;
          const importe = Math.max(0, Math.round(n(String(b.importe ?? '').replace(',', '.')) * 100) / 100);
          const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(b.fecha || '')) ? b.fecha : '';
          const p = await registrarPago(tA, tP, a, { meses, importe, metodo: METODOS[b.metodo] ? b.metodo : 'otro', fecha, nota: String(b.nota || '').trim().slice(0, 300) });
          av = `Apuntado: ${eur(importe)} · ${meses} ${meses === 1 ? 'mes' : 'meses'}. Pagado hasta el ${dia(p.hasta)}.`;
        } else if (b.accion === 'recordar') {
          const c = correoRenovar(cfg, a, a0.precio_mes);
          av = (await enviarCorreo(cfg, a.email, c.asunto, c.html, deps.fetch)) ? `Email enviado a ${a.email}.` : 'Error: no se ha enviado: falta RESEND_API_KEY en Vercel.';
        } else if (b.accion === 'retirar') {
          await deps.db('sidonia_anuncio_estado', { p_id: a.id, p_estado: 'retirado', p_nota: 'Caducado sin renovar', p_producto: null });
          let archivado = false;
          if (a.producto && cfg.shopifyTienda && cfg.shopifyClientId) archivado = await archivarEnShopify(a.producto, deps.gql || shopifyAdmin(cfg, deps.fetch)).catch(() => false);
          av = `Retirado.${a.producto ? (archivado ? ' La ficha de la web está archivada.' : ' Archiva la ficha en Shopify › Productos.') : ''}`;
        } else if (b.accion === 'borrar_pago' && Number(b.pago)) {
          await tP.borrar(`id=eq.${Number(b.pago)}&anuncio=eq.${a.id}`);
          const quedan = pagos.filter((p) => Number(p.anuncio) === a.id && Number(p.id) !== Number(b.pago) && p.hasta).sort((x, y) => String(y.hasta).localeCompare(String(x.hasta)));
          await tA.cambiar(a.id, { caduca: quedan[0]?.hasta || null, gratis: quedan[0]?.concepto === 'gratis' });
          av = 'Pago borrado.';
        }
        await cargar();
        a = anuncios.find((x) => Number(x.id) === id);
      } catch (e) { av = `Error: ${fallo(e)}`; }
    }
    const lista = anunciantes(anuncios, pagos, tarifa);
    const x = a && lista.find((y) => y.cliente === a.cliente);
    return html(paginaCobrar(cfg, x?.anuncios.find((y) => Number(y.id) === id), x, tarifa, { aviso: av || (error ? `Error: ${error}` : '') }));
  }

  const lista = anunciantes(anuncios, pagos, tarifa);
  if (estado === 'anunciante') return html(paginaAnunciante(cfg, lista.find((x) => x.cliente === String(req.query.id || '')), { aviso: error ? `Error: ${error}` : '' }));
  if (estado === 'anunciantes') return html(paginaAnunciantes(cfg, lista, pagos, { error }));
  const ver = ['todo', 'cobrar', 'pronto', 'al_dia', 'gratis'].includes(req.query.ver) ? req.query.ver : 'todo';
  return html(paginaCobros(cfg, lista, pagos, tarifa, { ver, error }));
}
