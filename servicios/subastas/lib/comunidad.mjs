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
 * Al publicar un anuncio (panel › Por revisar › Publicar) se le da el mes gratis si es el primero; si no, queda por cobrar
 * y se le manda el enlace de pago.
 *
 * Pago con Stripe, renovación automática cada mes (una suscripción por anuncio):
 *   /tienda/pagar?a=<anuncio>&f=<firma>   el enlace de pago (va en los emails y se copia desde el panel): cuánto es y
 *                                         «Pagar con tarjeta» → Stripe Checkout. Si está en el mes gratis o ya pagado, no
 *                                         se cobra hasta que se acaba. Con la renovación ya activa: cambiar tarjeta o cancelar.
 *   /api/stripe                           los avisos de Stripe (STRIPE_WEBHOOK_SECRET): cada factura pagada se apunta en
 *                                         pagos y alarga el anuncio; impago y cancelación quedan en el anuncio.
 *   cron diario (api/comunidad/revisar)   recuerda el pago (con el enlace) a quien le caduca y, si la tarifa lo dice,
 *                                         retira los que llevan días caducados.
 * Al venderse o retirarse un anuncio se cancela su renovación (no se le vuelve a cobrar).
 * La base de datos: sql/comunidad.sql (pagos, ajustes y anuncios.caduca / stripe_*).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { archivarEnShopify, avisarEquipo, esc, shopifyAdmin, tablaAnuncios, urlFoto } from './circulo.mjs';
import { stripe } from './motor.mjs';
import { datos, enviarCorreo, P, plantilla } from './correos.mjs';
import { fmt, n } from './estadisticas.mjs';
import { marco, normal } from './operaciones.mjs';

// 12,90 € al mes por anuncio (el primero, un mes gratis). Se puede cambiar en el panel (Cobros › Tarifa).
export const TARIFA_BASE = { tramos: [{ desde: 1, precio: 12.9 }], meses_gratis: 1, aviso: 7, retirar: 0 };
export const METODOS = { bizum: 'Bizum', transferencia: 'Transferencia', tarjeta: 'Tarjeta', efectivo: 'Efectivo', otro: 'Otro', stripe: 'Tarjeta (Stripe)' };
export const AUTO = { activa: ['Renovación automática activa', 'vendido'], cancela: ['Dado de baja: no se renueva', 'reservado'], impago: ['El último cobro ha fallado', 'retirado'], cancelada: ['Suscripción terminada', ''] };
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
const fallo = (e) => (/caduca|gratis|pagos|ajustes|stripe_|avisado|schema cache|relation/.test(String(e?.message || e)) ? 'Falta ejecutar sql/comunidad.sql en Supabase › SQL Editor.' : String(e?.message || e));

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
  return { tramos, meses_gratis: meses, aviso: Math.min(30, Math.max(1, Math.round(n(v.aviso)) || 7)), retirar: Math.min(90, Math.max(0, Math.round(n(v.retirar)))) };
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
  // Con la renovación de Stripe activa, unos días de margen mientras Stripe cobra (o reintenta)
  if (t < ahora) return a.stripe_estado === 'activa' && ahora - t < 5 * DIA ? 'pronto' : 'caducado';
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
    const precio = precioMes(tarifa, activos.length);
    let enviado = false;
    if (a.email && enlacePago(cfg, a.id)) {
      const c = correoRenovar(cfg, { ...a, caduca: null }, precio);
      enviado = await enviarCorreo(cfg, a.email, c.asunto, c.html, deps.fetch).catch(() => false);
      if (enviado) await tA.cambiar(a.id, { avisado: new Date(ahora).toISOString() }).catch(() => {});
    }
    return ` No es su primer anuncio: queda por cobrar (${eur(precio)} al mes).${enviado ? ' Le hemos mandado el enlace de pago.' : ' Mándale el enlace de pago desde Anuncios › Cobros.'}`;
  } catch (e) {
    console.error(e);
    return '';
  }
}

/** El email de «activa tu anuncio» (cuando hay que pagar y aún no tiene la renovación) */
export function correoRenovar(cfg, a, precio) {
  const caducado = a.caduca && Date.parse(a.caduca) < Date.now();
  const pagar = enlacePago(cfg, a.id);
  const wa = `https://wa.me/${cfg.whatsapp || '34675287095'}?text=${encodeURIComponent(`Hola, quiero renovar mi anuncio «${a.titulo}» en Sidonia`)}`;
  return {
    asunto: caducado ? `Tu anuncio ha caducado: ${a.titulo}` : a.caduca ? `Tu anuncio caduca el ${dia(a.caduca)}: ${a.titulo}` : `Activa tu anuncio: ${a.titulo}`,
    html: plantilla(cfg, a, {
      titulo: caducado ? 'Tu anuncio ha caducado' : a.caduca ? `Caduca el ${dia(a.caduca)}` : 'Activa tu anuncio', previa: `${eur(precio)} al mes, sin permanencia.`,
      cuerpo: P(`Hola${a.vendedor_nombre ? ` ${esc(a.vendedor_nombre)}` : ''}:`) + P('Para que tu anuncio siga en Sidonia:')
        + datos([['Cada mes', eur(precio)], ['Primer cobro', a.caduca && !caducado ? dia(a.caduca) : 'Al activarlo'], ['Permanencia', 'Ninguna']])
        + (pagar ? P('Se paga con tarjeta y se renueva solo cada mes, hasta que te des de baja. Si ya no lo vendes, no hagas nada.')
          : P('Responde a este email o escríbenos por WhatsApp y te decimos cómo pagar. Si ya no lo vendes, no hagas nada.')),
      boton: pagar ? 'Activar mi anuncio' : 'Escribir por WhatsApp', enlace: pagar || wa
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
  form.op + form.op { margin-top: 12px; }
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
    <td class="izq">${pill(a.cobro)}${a.stripe_estado === 'activa' ? '<span class="sub">↻ automática</span>' : a.stripe_estado === 'impago' ? '<span class="sub">cobro fallido</span>' : ''}</td>
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
  <div class="kpi"><span>Renovación automática</span><b>${fmt(todos.filter(([a]) => a.stripe_estado === 'activa').length)}</b><small>anuncios que se cobran solos</small></div>
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

/** El cuadro de la renovación automática: cómo está y el enlace de pago para mandárselo */
function renovacion(cfg, a, x, precio) {
  const auto = AUTO[a.stripe_estado];
  const enlace = enlacePago(cfg, a.id);
  const falta = !cfg.stripeKey ? 'Falta STRIPE_SECRET_KEY en Vercel.' : !enlace ? 'Falta SUBASTAS_CLAVE en Vercel (firma los enlaces).' : '';
  const wa = enlace && x.telefono ? `https://wa.me/${tel(x.telefono)}?text=${encodeURIComponent(`Hola ${x.nombre || ''}, este es el enlace para pagar tu anuncio «${a.titulo}» en Sidonia (${eur(precio)} al mes, se renueva solo y lo cancelas cuando quieras): ${enlace}`)}` : '';
  return `<form class="op" method="post" action="?estado=cobrar&id=${a.id}"><section class="grupo"><h3>Pago con tarjeta · se renueva solo cada mes</h3>
  <p style="margin:0">${auto ? `<span class="pill ${auto[1]}">${auto[0]}</span>` : '<span class="pill">Sin activar</span>'} ${a.stripe_estado === 'activa' ? `Stripe cobra ${eur(precio)} cada mes (próximo cobro el ${dia(a.caduca)}) y el anuncio se alarga solo.` : a.stripe_estado === 'cancela' ? `No se renueva: sigue publicado hasta el ${dia(a.caduca)} y después se retira solo.` : 'Mándale el enlace: paga con tarjeta y, si aún le queda tiempo gratis o pagado, no se le cobra hasta que se acabe.'}</p>
  ${falta ? `<p class="aviso mal">${falta}</p>` : `<div class="fila"><label class="ancho">Enlace de pago<input readonly value="${esc(enlace)}" onclick="this.select()"></label></div>
  <div class="acc"><button type="button" class="boton claro" onclick="navigator.clipboard.writeText(${esc(JSON.stringify(enlace))}).then(()=>{this.textContent='Copiado ✓'})">Copiar el enlace</button>
    ${wa ? `<a class="boton claro" href="${esc(wa)}" target="_blank" rel="noopener">Mandar por WhatsApp</a>` : ''}
    ${x.email ? '<button class="boton claro" name="accion" value="recordar">Mandar por email</button>' : ''}
    ${['activa', 'impago'].includes(a.stripe_estado) ? '<button class="boton rojo" name="accion" value="cancelar_auto" onclick="return confirm(\'¿Darle de baja? No se le volverá a cobrar; el anuncio sigue hasta el final del mes pagado y después se retira solo.\')">Dar de baja</button>' : ''}</div>`}
</section></form>`;
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
${activo ? renovacion(cfg, a, x, precio) : ''}
${activo ? `<form class="op" method="post" action="?estado=cobrar&id=${a.id}">
  <section class="grupo"><h3>Apuntar un pago a mano</h3>
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
      <label>Retirar si lleva caducado (días)<input name="retirar" type="number" min="0" max="90" step="1" value="${tarifa.retirar}"><small>0 = no se retira solo.</small></label>
    </div>
    <small class="ayuda">Solo el primer anuncio de cada persona es gratis. Cada día se recuerda el pago (con el enlace) a quien le caduca pronto o ya ha caducado, como mucho una vez por semana.</small>
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
  return limpiarTarifa({ tramos, meses_gratis: b.meses_gratis, aviso: b.aviso, retirar: b.retirar });
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
    anuncios = await tA.leer('select=id,cliente,estado,tipo,titulo,precio,fotos,vendedor_nombre,vendedor_tipo,telefono,email,producto,creado,caduca,gratis,stripe_suscripcion,stripe_cliente,stripe_estado,avisado&order=creado.asc&limit=5000');
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
          const ok = await enviarCorreo(cfg, a.email, c.asunto, c.html, deps.fetch);
          if (ok) await tA.cambiar(a.id, { avisado: new Date().toISOString() });
          av = ok ? `Email enviado a ${a.email}${enlacePago(cfg, a.id) ? ', con el enlace de pago' : ''}.` : 'Error: no se ha enviado: falta RESEND_API_KEY en Vercel.';
        } else if (b.accion === 'cancelar_auto') {
          if (await cancelarRenovacion(cfg, deps, a.id)) {
            const email = await avisarDueno(cfg, deps, a, 'baja', { fecha: a.caduca });
            av = `Dado de baja: no se le volverá a cobrar y el anuncio sigue hasta el ${dia(a.caduca)} (después se retira solo).${email ? ' Le hemos mandado la confirmación por email.' : ''}`;
          } else av = 'Error: no se ha podido dar de baja en Stripe.';
        } else if (b.accion === 'retirar') {
          const archivado = await retirarCaducado(cfg, deps, a);
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

/* ---------------------------------------------------------------------------- Stripe: pagar, renovar solo y darse de baja */
const st = (cfg, deps) => deps.stripe || stripe(cfg, deps.fetch);
const seg = (t) => Math.floor(Date.parse(t) / 1000);
const VIVA = ['activa', 'impago', 'cancela'];   // suscripción que aún existe en Stripe
const susDe = (o) => { const x = o.subscription || o.parent?.subscription_details?.subscription || ''; return typeof x === 'string' ? x : x?.id || ''; };
const metaDe = (o) => o.subscription_details?.metadata || o.parent?.subscription_details?.metadata || o.lines?.data?.[0]?.metadata || {};

/** La firma del enlace de pago de un anuncio (con SUBASTAS_CLAVE): nadie puede inventarse el de otro */
export function firmaPago(cfg, id) {
  const k = cfg.clave || cfg.adminClave;
  return k && Number(id) ? createHmac('sha256', k).update(`pagar|${Number(id)}`).digest('hex').slice(0, 32) : '';
}
export const enlacePago = (cfg, id) => (cfg.servidor && firmaPago(cfg, id) ? `${cfg.servidor}/tienda/pagar?a=${Number(id)}&f=${firmaPago(cfg, id)}` : '');
const firmaBuena = (cfg, id, f) => {
  const b = firmaPago(cfg, id), x = String(f || '');
  return Boolean(b) && b.length === x.length && timingSafeEqual(Buffer.from(b), Buffer.from(x));
};

/** Los emails al dueño en cada paso: activada, aviso antes del cobro, cobrado, fallido, baja y fin */
export function correoPago(cfg, a, tipo, { precio = 0, fecha = null } = {}) {
  const gestion = enlacePago(cfg, a.id) || cfg.tienda;
  const C = {
    activada: [`Renovación activada: ${a.titulo}`, 'Renovación activada', `${eur(precio)} al mes, sin permanencia.`,
      P('Tu anuncio sigue en Sidonia. Así queda:') + datos([['Cada mes', eur(precio)], ['Próximo cobro', fecha ? dia(fecha) : 'Dentro de un mes'], ['Permanencia', 'Ninguna']])
      + P('Unos días antes de cada cobro te avisamos. Puedes darte de baja cuando quieras: el anuncio sigue hasta el final del mes pagado y no se te vuelve a cobrar.'), 'Gestionar o dar de baja', gestion],
    aviso: [`El ${dia(fecha)} se renueva tu anuncio`, `Se renueva el ${dia(fecha)}`, `Se cobrarán ${eur(precio)}.`,
      P(`El <b>${dia(fecha)}</b> se cobrarán <b>${eur(precio)}</b> para que tu anuncio siga otro mes en Sidonia. No tienes que hacer nada.`)
      + P('Si ya lo has vendido o no quieres seguir, date de baja antes de esa fecha y no se te cobrará.'), 'Dar de baja o cambiar la tarjeta', gestion],
    cobrado: [`Recibo: ${a.titulo}`, 'Recibo', `Hemos cobrado ${eur(precio)}.`,
      datos([['Importe', eur(precio)], ['Publicado hasta', dia(fecha)], ['Siguiente cobro', dia(fecha)]]) + P('Te avisaremos unos días antes del siguiente cobro. Puedes darte de baja cuando quieras.'), 'Gestionar o dar de baja', gestion],
    fallido: ['No hemos podido cobrar tu anuncio', 'No hemos podido cobrar', 'Revisa tu tarjeta para que tu anuncio siga publicado.',
      P(`No hemos podido cobrar los <b>${eur(precio)}</b> de este mes. Lo volveremos a intentar en los próximos días.`) + P('Para que tu anuncio no deje de verse, revisa o cambia tu tarjeta.'), 'Cambiar la tarjeta', gestion],
    baja: [`Baja confirmada: ${a.titulo}`, 'Te has dado de baja', 'No se te volverá a cobrar.',
      P(`No se te volverá a cobrar. Tu anuncio sigue publicado hasta el <b>${dia(fecha)}</b> y después deja de verse.`) + P('Si cambias de idea antes de esa fecha, puedes reactivarlo.'), 'Reactivar mi anuncio', gestion],
    fin: ['Tu anuncio ya no está publicado', 'Anuncio finalizado', 'Cuando quieras, puedes volver a publicarlo.',
      P('Tu anuncio ya no se ve en Sidonia porque se ha acabado su suscripción.') + P('Cuando quieras, puedes volver a publicarlo.'), 'Ir a Sidonia', cfg.tienda]
  }[tipo];
  return { asunto: C[0], html: plantilla(cfg, a, { titulo: C[1], previa: C[2], cuerpo: P(`Hola${a.vendedor_nombre ? ` ${esc(a.vendedor_nombre)}` : ''}:`) + C[3], boton: C[4], enlace: C[5] }) };
}
async function avisarDueno(cfg, deps, a, tipo, datos) {
  if (!a?.email) return false;
  const c = correoPago(cfg, a, tipo, datos);
  return enviarCorreo(cfg, a.email, c.asunto, c.html, deps.fetch).catch((e) => { console.error(e); return false; });
}
const precioDe = async (cfg, deps) => precioMes(await leerTarifa(deps.ajustes || tablaAnuncios(cfg, deps.fetch, 'ajustes')), 1);

/** La página que ve el dueño (fuera del tema: clara, como los emails). acciones: botones (HTML) */
export function paginaPago({ titulo, texto, boton = '', enlace = '', acciones = '', foto = '', status = 200 }) {
  const accion = acciones || (boton ? `<a class="b" href="${esc(enlace)}">${esc(boton)}</a>` : '');
  return { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, body: `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)} · Sidonia</title><meta name="robots" content="noindex">
<style>body{margin:0;background:#f6f5f2;color:#1b1a18;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}
main{max-width:520px;margin:0 auto;padding:32px 16px}.logo{text-align:center;font-weight:700;letter-spacing:.45em;margin:0 0 24px}
.c{background:#fff;border-radius:20px;overflow:hidden}.c img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover}.t{padding:26px 24px 28px}
h1{margin:0 0 14px;font-size:24px;line-height:1.25}p{margin:0 0 12px;font-size:16px;line-height:1.6;color:#3a3833}.precio{font-size:30px;font-weight:800;color:#1b1a18;margin:4px 0 14px}
.estado{display:inline-block;margin:0 0 14px;padding:5px 12px;border-radius:999px;font-size:13px;font-weight:700;background:#e7f5ec;color:#1d7a43}.estado.mal{background:#fde8ea;color:#a2121f}.estado.baja{background:#fdf3dc;color:#8a5a00}
.lista{margin:0 0 14px;padding:0;list-style:none}.lista li{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #eee;font-size:15px}.lista li span{color:#8a857b}
form{margin:0}.b,button{display:block;width:100%;box-sizing:border-box;margin-top:14px;padding:16px;border:0;border-radius:999px;background:#1b1a18;color:#fff;font:inherit;font-size:16px;font-weight:700;text-align:center;text-decoration:none;cursor:pointer}
.b.claro,button.claro{background:#fff;color:#1b1a18;border:1px solid #d8d4cc}button.rojo{background:#fff;color:#a2121f;border:1px solid #f0c4c9}
small{display:block;margin-top:14px;color:#8a857b;font-size:13px;line-height:1.5;text-align:center}</style></head>
<body><main><p class="logo">SIDONIA</p><div class="c">${foto ? `<img src="${esc(foto)}" alt="">` : ''}<div class="t"><h1>${esc(titulo)}</h1>${texto}${accion}</div></div>
<small>Pago seguro con Stripe. Sidonia no ve el número de tu tarjeta. Sin permanencia: te das de baja cuando quieras.</small></main></body></html>` };
}
const boton = (aqui, accion, texto, clase = '', confirmar = '') => `<form method="post" action="${esc(aqui)}"${confirmar ? ` onsubmit="return confirm(${esc(JSON.stringify(confirmar))})"` : ''}><input type="hidden" name="accion" value="${accion}"><button class="${clase}">${esc(texto)}</button></form>`;

/** Dar de baja (al final del mes pagado) o reactivar. Devuelve el estado nuevo. */
export async function cambiarBaja(cfg, deps, a, baja) {
  await st(cfg, deps)('POST', `subscriptions/${a.stripe_suscripcion}`, { cancel_at_period_end: baja ? 'true' : 'false' });
  const estado = baja ? 'cancela' : 'activa';
  await (deps.tabla || tablaAnuncios(cfg, deps.fetch)).cambiar(a.id, { stripe_estado: estado });
  return estado;
}

/** /tienda/pagar y /tienda/pagar/ok */
export async function rutasPago({ ruta, method, query, body }, cfg, deps) {
  const id = Number(query.a);
  if (!firmaBuena(cfg, id, query.f)) return paginaPago({ titulo: 'Enlace no válido', texto: '<p>Este enlace no es correcto. Escríbenos y te mandamos uno nuevo.</p>', status: 404 });
  if (!cfg.stripeKey) return paginaPago({ titulo: 'Aún no se puede pagar aquí', texto: '<p>Escríbenos y te decimos cómo pagar tu anuncio.</p>', status: 503 });
  const tA = deps.tabla || tablaAnuncios(cfg, deps.fetch);
  let [a] = await tA.leer(`id=eq.${id}&select=*`);
  if (!a) return paginaPago({ titulo: 'Anuncio no encontrado', texto: '<p>No encontramos este anuncio.</p>', status: 404 });
  const foto = (a.fotos || [])[0] ? urlFoto(cfg, a.fotos[0]) : '';
  const ver = a.producto ? `${cfg.tienda}/products/${a.producto}` : cfg.tienda;
  const aqui = enlacePago(cfg, id);
  const precio = await precioDe(cfg, deps);

  // Vuelta de Stripe: se apunta ya la suscripción (el pago y los emails los apuntan los avisos de Stripe)
  if (ruta === 'pagar/ok') {
    const sid = String(query.session_id || '');
    if (/^cs_[A-Za-z0-9_]+$/.test(sid)) {
      try {
        const s = await st(cfg, deps)('GET', `checkout/sessions/${sid}`);
        const otra = a.stripe_suscripcion && a.stripe_suscripcion !== s.subscription && VIVA.includes(a.stripe_estado);
        if (String(s.metadata?.anuncio) === String(id) && s.status === 'complete' && s.subscription && !otra) {
          await tA.cambiar(id, { stripe_suscripcion: String(s.subscription), stripe_cliente: String(s.customer || ''), stripe_estado: 'activa' });
        }
      } catch (e) { console.error(e); }
    }
    const proximo = a.caduca && Date.parse(a.caduca) > Date.now() ? a.caduca : sumarMeses(Date.now(), 1);
    return paginaPago({ titulo: '¡Listo! Tu anuncio se renueva solo', foto, texto: `<span class="estado">Renovación activada</span>
      <ul class="lista"><li>Cada mes<b>${eur(precio)}</b></li><li>Próximo cobro<b>${dia(proximo)}</b></li><li>Permanencia<b>Ninguna</b></li></ul>
      <p>Te avisamos por email unos días antes de cada cobro. Para darte de baja, vuelve a este mismo enlace (también está en tus emails y en «Mi perfil»).</p>`, boton: 'Ver mi anuncio', enlace: ver });
  }
  if (!ACTIVOS.includes(a.estado)) return paginaPago({ titulo: 'Este anuncio ya no está activo', foto, texto: `<p><b>${esc(a.titulo)}</b> ya no está publicado (vendido o retirado): no hay nada que pagar${VIVA.includes(a.stripe_estado) ? ' y no se te volverá a cobrar' : ''}.</p>`, boton: 'Ir a Sidonia', enlace: cfg.tienda });

  // Ya tiene suscripción: dar de baja, reactivar o cambiar la tarjeta
  if (a.stripe_suscripcion && VIVA.includes(a.stripe_estado)) {
    let nota = '';
    if (method === 'POST') {
      try {
        if (body.accion === 'portal' && a.stripe_cliente) {
          const p = await st(cfg, deps)('POST', 'billing_portal/sessions', { customer: a.stripe_cliente, return_url: aqui, locale: 'es' });
          return { status: 303, headers: { Location: p.url, 'Cache-Control': 'no-store' }, body: '' };
        }
        if (body.accion === 'baja' && a.stripe_estado !== 'cancela') {
          a = { ...a, stripe_estado: await cambiarBaja(cfg, deps, a, true) };
          await avisarDueno(cfg, deps, a, 'baja', { fecha: a.caduca });
          await avisarEquipo(cfg, `Baja: ${a.titulo}`, `<p>${esc(a.vendedor_nombre || '')} se ha dado de baja del anuncio #${a.id} «${esc(a.titulo)}». Sigue publicado hasta el ${dia(a.caduca)} y después se retira solo.</p>`, deps.fetch).catch(() => {});
          nota = '<p><b>Hecho.</b> Te hemos mandado la confirmación por email.</p>';
        }
        if (body.accion === 'reactivar' && a.stripe_estado === 'cancela') {
          a = { ...a, stripe_estado: await cambiarBaja(cfg, deps, a, false) };
          nota = '<p><b>Hecho.</b> Tu anuncio vuelve a renovarse cada mes.</p>';
        }
      } catch (e) {
        console.error(e);
        nota = '<p><b>No se ha podido hacer.</b> Vuelve a intentarlo en un momento o escríbenos.</p>';
      }
    }
    const filas = `<ul class="lista"><li>Cada mes<b>${eur(precio)}</b></li><li>${a.stripe_estado === 'cancela' ? 'Publicado hasta' : 'Próximo cobro'}<b>${dia(a.caduca)}</b></li></ul>`;
    const portal = a.stripe_cliente ? boton(aqui, 'portal', 'Cambiar la tarjeta', 'claro') : '';
    const bajaBtn = boton(aqui, 'baja', 'Dar de baja', 'rojo', `¿Darte de baja? Tu anuncio sigue publicado hasta el ${dia(a.caduca)} y no se te volverá a cobrar.`);
    if (a.stripe_estado === 'cancela') {
      return paginaPago({ titulo: a.titulo, foto, texto: `${nota}<span class="estado baja">Dado de baja</span>${filas}<p>No se te volverá a cobrar. El anuncio sigue publicado hasta el <b>${dia(a.caduca)}</b> y después deja de verse.</p>`, acciones: boton(aqui, 'reactivar', 'Reactivar la renovación') });
    }
    if (a.stripe_estado === 'impago') {
      return paginaPago({ titulo: a.titulo, foto, texto: `${nota}<span class="estado mal">El último cobro ha fallado</span>${filas}<p>Cambia la tarjeta para que tu anuncio siga publicado. Lo volvemos a intentar en los próximos días.</p>`, acciones: boton(aqui, 'portal', 'Cambiar la tarjeta') + bajaBtn });
    }
    return paginaPago({ titulo: a.titulo, foto, texto: `${nota}<span class="estado">Renovación activa</span>${filas}<p>Se renueva solo cada mes hasta que te des de baja. Te avisamos por email unos días antes de cada cobro. Si te das de baja, sigue publicado hasta el final del mes pagado.</p>`, acciones: portal + bajaBtn });
  }

  // Si aún le queda tiempo (mes gratis o pagado), no se cobra hasta entonces (Stripe pide al menos 48 h: si queda menos,
  // se le regala hasta las 48 h, así nunca pierde días)
  const prueba = a.caduca && Date.parse(a.caduca) > Date.now() ? Math.max(seg(a.caduca), Math.floor(Date.now() / 1000) + 49 * 3600) : null;
  if (!query.ir) {
    return paginaPago({ titulo: a.titulo, foto, texto: `<p>Para que tu anuncio siga en Sidonia:</p><p class="precio">${eur(precio)} <span style="font-size:16px;font-weight:600;color:#8a857b">al mes</span></p>
      <ul class="lista"><li>Primer cobro<b>${prueba ? dia(prueba * 1000) : 'Hoy'}</b></li><li>Después<b>Cada mes ese día</b></li><li>Permanencia<b>Ninguna</b></li></ul>
      <p>${prueba ? 'Hoy no se cobra nada: el primer cobro es cuando se acaba lo que ya tienes. ' : ''}Se renueva solo cada mes hasta que te des de baja, con un botón y sin llamadas. Te avisamos por email antes de cada cobro.</p>`,
    boton: prueba ? 'Activar con tarjeta' : 'Pagar con tarjeta', enlace: `${aqui}&ir=1` });
  }
  const suyos = await tA.leer(`cliente=eq.${encodeURIComponent(a.cliente)}&select=id,stripe_cliente`);
  const yaCliente = (suyos.find((x) => x.stripe_cliente) || {}).stripe_cliente;
  const meta = { anuncio: String(id), cliente: String(a.cliente) };
  const s = await st(cfg, deps)('POST', 'checkout/sessions', {
    mode: 'subscription', locale: 'es',
    ...(yaCliente ? { customer: yaCliente } : a.email ? { customer_email: a.email } : {}),
    line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: Math.round(precio * 100), recurring: { interval: 'month' }, product_data: { name: `Anuncio en Sidonia: ${a.titulo}`.slice(0, 250) } } }],
    subscription_data: { metadata: meta, ...(prueba ? { trial_end: prueba } : {}), description: `Anuncio #${id} en Sidonia` },
    metadata: meta,
    // La sesión caduca en 1 hora: menos riesgo de pagar dos veces el mismo anuncio con dos pestañas
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    custom_text: { submit: { message: `Se renueva cada mes por ${eur(precio)} hasta que te des de baja. Sin permanencia.` } },
    success_url: `${cfg.servidor}/tienda/pagar/ok?a=${id}&f=${firmaPago(cfg, id)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: aqui
  });
  return { status: 303, headers: { Location: s.url, 'Cache-Control': 'no-store' }, body: '' };
}

/** Comprueba la firma de un aviso de Stripe (cabecera Stripe-Signature: t=…,v1=…). Devuelve el evento o null. */
export function verificarStripe(crudo, cabecera, secreto, ahora = Date.now()) {
  if (!secreto || !cabecera) return null;
  const partes = String(cabecera).split(',').map((x) => x.split('='));
  const t = (partes.find(([k]) => k === 't') || [])[1];
  if (!/^\d+$/.test(t || '') || Math.abs(ahora / 1000 - Number(t)) > 300) return null;
  const esperada = Buffer.from(createHmac('sha256', secreto).update(`${t}.${crudo}`).digest('hex'));
  const ok = partes.filter(([k]) => k === 'v1').some(([, v]) => { const b = Buffer.from(String(v)); return b.length === esperada.length && timingSafeEqual(b, esperada); });
  if (!ok) return null;
  try { return JSON.parse(crudo); } catch (e) { return null; }
}

/** Qué anuncio es (por los datos de la suscripción o por la suscripción guardada) */
async function anuncioDe(cfg, deps, tA, suscripcion, meta) {
  if (Number(meta?.anuncio)) return (await tA.leer(`id=eq.${Number(meta.anuncio)}&select=*`))[0] || null;
  if (!suscripcion) return null;
  const [a] = await tA.leer(`stripe_suscripcion=eq.${encodeURIComponent(suscripcion)}&select=*`);
  if (a) return a;
  // Con versiones de la API que no traen los datos en la factura: se piden a Stripe
  const s = await st(cfg, deps)('GET', `subscriptions/${suscripcion}`).catch(() => null);
  return Number(s?.metadata?.anuncio) ? (await tA.leer(`id=eq.${Number(s.metadata.anuncio)}&select=*`))[0] || null : null;
}
// ¿Es otra suscripción distinta de la que ya tiene el anuncio (un pago doble)?
const esOtra = (a, sus) => Boolean(sus && a.stripe_suscripcion && a.stripe_suscripcion !== sus && VIVA.includes(a.stripe_estado));

/** Un aviso de Stripe: activada, factura pagada (se apunta y alarga el anuncio), impago, baja, fin. Devuelve qué ha hecho. */
export async function procesarStripe(ev, cfg, deps) {
  const tA = deps.tabla || tablaAnuncios(cfg, deps.fetch);
  const tP = deps.pagos || tablaAnuncios(cfg, deps.fetch, 'pagos');
  const o = ev?.data?.object || {};
  const precio = async () => (n(o.amount_due) || n(o.amount_paid) ? n(o.amount_due || o.amount_paid) / 100 : precioDe(cfg, deps));

  if (ev.type === 'checkout.session.completed') {
    if (o.mode !== 'subscription' || !Number(o.metadata?.anuncio)) return 'ignorado';
    const a = (await tA.leer(`id=eq.${Number(o.metadata.anuncio)}&select=*`))[0];
    if (!a) return 'sin-anuncio';
    // Ya tenía otra suscripción viva: esta sobra (dos pestañas, dos pagos). Se cancela y se avisa al equipo para devolverlo.
    if (esOtra(a, o.subscription)) {
      await st(cfg, deps)('DELETE', `subscriptions/${o.subscription}`).catch((e) => console.error(e));
      await avisarEquipo(cfg, `Pago doble cancelado: ${a.titulo}`, `<p>El anuncio #${a.id} ya tenía su suscripción; la nueva (${esc(o.subscription)}) se ha cancelado. Si se llegó a cobrar, devuélvelo en Stripe › Pagos.</p>`, deps.fetch).catch(() => {});
      return 'duplicada';
    }
    await tA.cambiar(a.id, { stripe_suscripcion: String(o.subscription), stripe_cliente: String(o.customer || ''), stripe_estado: 'activa' });
    const proximo = a.caduca && Date.parse(a.caduca) > Date.now() ? a.caduca : sumarMeses(Date.now(), 1);
    await avisarDueno(cfg, deps, a, 'activada', { precio: n(o.amount_total) ? n(o.amount_total) / 100 : await precioDe(cfg, deps), fecha: proximo });
    await avisarEquipo(cfg, `Renovación activada: ${a.titulo}`, `<p>${esc(a.vendedor_nombre || '')} ha activado el pago mensual del anuncio #${a.id} «${esc(a.titulo)}».</p>`, deps.fetch).catch(() => {});
    return 'suscripcion';
  }

  if (ev.type === 'invoice.paid' || ev.type === 'invoice.payment_succeeded') {
    const sus = susDe(o);
    const a = await anuncioDe(cfg, deps, tA, sus, metaDe(o));
    if (!a) return 'sin-anuncio';
    if (esOtra(a, sus)) return 'duplicada';
    const lineas = o.lines?.data || [];
    const fin = Math.max(0, ...lineas.map((l) => n(l.period?.end)));
    const inicio = Math.min(...lineas.map((l) => n(l.period?.start) || Infinity));
    const hasta = fin ? new Date(fin * 1000) : sumarMeses(Date.now(), 1);
    const cambios = { ...(sus ? { stripe_suscripcion: sus } : {}), ...(o.customer ? { stripe_cliente: String(o.customer) } : {}) };
    if (a.stripe_estado !== 'cancela') cambios.stripe_estado = 'activa';
    if (!a.caduca || hasta > new Date(a.caduca)) Object.assign(cambios, { caduca: hasta.toISOString(), gratis: n(o.amount_paid) ? false : a.gratis });
    await tA.cambiar(a.id, cambios);
    // 0 € (el periodo sin cobro hasta que se acaba lo gratis): no es un pago
    if (!n(o.amount_paid)) return 'sin-importe';
    if ((await tP.leer(`ref=eq.${encodeURIComponent(o.id)}&select=id`)).length) return 'repetido';
    const pagado = n(o.status_transitions?.paid_at) || n(o.created) || Date.now() / 1000;
    await tP.guardar({
      cliente: a.cliente, anuncio: a.id, titulo: a.titulo || '', nombre: a.vendedor_nombre || '', email: a.email || o.customer_email || '',
      concepto: o.billing_reason === 'subscription_create' ? 'alta' : 'renovacion', meses: 1, importe: n(o.amount_paid) / 100, metodo: 'stripe',
      fecha: new Date(pagado * 1000).toISOString().slice(0, 10), desde: Number.isFinite(inicio) ? new Date(inicio * 1000).toISOString() : null, hasta: hasta.toISOString(),
      nota: `Stripe${o.number ? ` · factura ${o.number}` : ''}`, ref: o.id
    }, 'id');
    // El recibo (el del alta ya va en «Renovación activada»)
    if (o.billing_reason !== 'subscription_create') await avisarDueno(cfg, deps, a, 'cobrado', { precio: n(o.amount_paid) / 100, fecha: hasta });
    return 'pago';
  }

  if (ev.type === 'invoice.payment_failed') {
    const sus = susDe(o);
    const a = await anuncioDe(cfg, deps, tA, sus, metaDe(o));
    if (!a) return 'sin-anuncio';
    if (esOtra(a, sus)) return 'duplicada';
    // Stripe reintenta varias veces: el email, solo la primera
    if (a.stripe_estado !== 'impago') {
      await tA.cambiar(a.id, { stripe_estado: 'impago' });
      await avisarDueno(cfg, deps, a, 'fallido', { precio: await precio() });
      await avisarEquipo(cfg, `Cobro fallido: ${a.titulo}`, `<p>Stripe no ha podido cobrar el anuncio #${a.id} «${esc(a.titulo)}» de ${esc(a.vendedor_nombre || '')}. Le hemos pedido que cambie la tarjeta; Stripe reintenta solo.</p>`, deps.fetch).catch(() => {});
    }
    return 'impago';
  }

  if (ev.type === 'customer.subscription.updated' || ev.type === 'customer.subscription.deleted') {
    const a = await anuncioDe(cfg, deps, tA, o.id, o.metadata);
    if (!a) return 'sin-anuncio';
    if (a.stripe_suscripcion && a.stripe_suscripcion !== o.id) return 'otra';   // la que sobraba de un pago doble
    const terminada = ev.type === 'customer.subscription.deleted' || o.status === 'canceled';
    const estado = terminada ? 'cancelada' : o.cancel_at_period_end || o.cancel_at ? 'cancela' : ['past_due', 'unpaid', 'incomplete'].includes(o.status) ? 'impago' : 'activa';
    if (estado === a.stripe_estado) return estado;
    await tA.cambiar(a.id, { stripe_estado: estado, stripe_suscripcion: o.id });
    // Baja desde el portal de Stripe (la de nuestro botón ya mandó su email)
    if (estado === 'cancela') {
      const fin = n(o.cancel_at) || n(o.current_period_end) || n(o.items?.data?.[0]?.current_period_end);
      await avisarDueno(cfg, deps, a, 'baja', { fecha: fin ? fin * 1000 : a.caduca });
    }
    // Se acabó (baja al final del mes o impago sin arreglar): el anuncio deja de verse
    if (terminada && ACTIVOS.includes(a.estado)) {
      await retirarCaducado(cfg, { ...deps, tabla: tA }, { ...a, stripe_estado: 'cancelada' }, 'Fin de la suscripción').catch((e) => console.error(e));
      await avisarDueno(cfg, deps, a, 'fin');
      return 'retirado';
    }
    return estado;
  }
  return 'ignorado';
}

/** Al venderse o retirarse: que no se le vuelva a cobrar (al final del periodo ya pagado). true si había renovación. */
export async function cancelarRenovacion(cfg, deps, id) {
  if (!cfg.stripeKey || !Number(id)) return false;
  try {
    const tA = deps.tabla || tablaAnuncios(cfg, deps.fetch);
    const [a] = await tA.leer(`id=eq.${Number(id)}&select=id,stripe_suscripcion,stripe_estado`);
    if (!a?.stripe_suscripcion || !['activa', 'impago'].includes(a.stripe_estado)) return false;
    await st(cfg, deps)('POST', `subscriptions/${a.stripe_suscripcion}`, { cancel_at_period_end: 'true' });
    await tA.cambiar(Number(id), { stripe_estado: 'cancela' });
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

/** Retira un anuncio: fuera de la web (ficha archivada) y sin renovación. Devuelve si se archivó. */
export async function retirarCaducado(cfg, deps, a, nota = 'Caducado sin renovar') {
  await deps.db('sidonia_anuncio_estado', { p_id: a.id, p_estado: 'retirado', p_nota: nota, p_producto: null });
  await cancelarRenovacion(cfg, deps, a.id);
  if (!a.producto || !cfg.shopifyTienda || !cfg.shopifyClientId) return false;
  return archivarEnShopify(a.producto, deps.gql || shopifyAdmin(cfg, deps.fetch)).catch(() => false);
}

/**
 * El repaso diario:
 *  - con renovación activa: el aviso «el día X se renueva por Y €» unos días antes de cada cobro (una vez por cobro)
 *  - dado de baja y pasado el mes: se retira (por si Stripe no avisó)
 *  - sin renovación: recordar el pago (como mucho una vez por semana) y, si la tarifa lo pide, retirar los caducados
 */
export const DIAS_AVISO_COBRO = 3;
export async function revisarComunidad(cfg, deps, ahora = Date.now()) {
  const tA = deps.tabla || tablaAnuncios(cfg, deps.fetch);
  const tP = deps.pagos || tablaAnuncios(cfg, deps.fetch, 'pagos');
  const tarifa = await leerTarifa(deps.ajustes || tablaAnuncios(cfg, deps.fetch, 'ajustes'));
  const anuncios = await tA.leer(`estado=in.(${ACTIVOS.join(',')})&select=*`);
  const pagos = await tP.leer('select=id,cliente,anuncio,importe,fecha&limit=10000');
  let recordados = 0, retirados = 0, avisos = 0;
  for (const x of anunciantes(anuncios, pagos, tarifa, ahora)) {
    for (const a of x.anuncios) {
      const caduca = a.caduca ? Date.parse(a.caduca) : 0;
      if (a.stripe_estado === 'activa') {
        const ya = a.avisado_renovacion && Date.parse(a.avisado_renovacion) > caduca - 20 * DIA;
        if (a.email && caduca > ahora && caduca - ahora <= DIAS_AVISO_COBRO * DIA && !ya) {
          if (await avisarDueno(cfg, deps, a, 'aviso', { precio: a.precio_mes, fecha: a.caduca })) {
            await tA.cambiar(a.id, { avisado_renovacion: new Date(ahora).toISOString() }).catch((e) => console.error(e));
            avisos += 1;
          }
        }
        continue;
      }
      if (a.stripe_estado === 'cancela') {
        if (caduca && caduca < ahora - DIA) {
          await retirarCaducado(cfg, { ...deps, tabla: tA }, a, 'Baja de la suscripción').catch((e) => console.error(e));
          retirados += 1;
        }
        continue;
      }
      if (a.cobro === 'caducado' && tarifa.retirar && caduca < ahora - tarifa.retirar * DIA) {
        await retirarCaducado(cfg, { ...deps, tabla: tA }, a).catch((e) => console.error(e));
        retirados += 1;
        continue;
      }
      if (!['pronto', 'caducado', 'por_cobrar'].includes(a.cobro) || !a.email) continue;
      if (a.avisado && ahora - Date.parse(a.avisado) < 7 * DIA) continue;
      const c = correoRenovar(cfg, a, a.precio_mes);
      if (await enviarCorreo(cfg, a.email, c.asunto, c.html, deps.fetch).catch((e) => { console.error(e); return false; })) {
        await tA.cambiar(a.id, { avisado: new Date(ahora).toISOString() });
        recordados += 1;
      }
    }
  }
  return { recordados, retirados, avisos };
}
