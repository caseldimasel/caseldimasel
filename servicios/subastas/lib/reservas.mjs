/* SIDONIA · Alquiler entre la comunidad, como Airbnb (sql/reservas.sql).
 * - El anuncio es el coche de «Mi coche en alquiler» (garaje, alquiler = true) con su alq: precio por día, fianza, km al
 *   día, quién conduce, ciudad, dónde se entrega (solo se ve al confirmar), normas, mínimo de días, reserva inmediata…
 *   y sus bloqueos (días que no lo alquila).
 * - Quien alquila elige fechas y manda una solicitud (o reserva al momento si el dueño tiene «reserva inmediata»).
 *   El dueño tiene 24 h para aceptar o rechazar; si no, caduca. Las aceptadas ocupan el calendario.
 * - Se hablan por mensajes dentro de Sidonia (con aviso por email). El teléfono, el email y dónde se entrega el coche
 *   solo se ven cuando la reserva está confirmada.
 * - Al acabar, cada uno deja su reseña: quien alquila, del coche y su dueño; el dueño, de quien lo alquiló.
 * - Gratis, como los anuncios de la comunidad: se paga al dueño en la entrega y Sidonia no cobra comisión.
 *   Preparado para cobrar a través de Sidonia si algún día se quiere (ALQUILER_COBRAR=1 con Stripe): entonces quien
 *   alquila paga el precio + la tarifa de servicio (ALQUILER_COMISION %) y hasta pagar no se ve el contacto.
 *
 * Público:  GET api/alquiler/coches?desde=&hasta=&ciudad=&conductor=   GET api/alquiler/coche?id=
 * Sesión:   POST api/alquiler/reservar   GET api/alquiler/reservas   POST api/alquiler/reserva { id, accion }
 *           GET/POST api/alquiler/mensajes   POST api/alquiler/resena { id, nota, texto }
 */
import { esc, perfilPublico, tablaAnuncios, urlFoto } from './circulo.mjs';
import { datos, enviarCorreo, P, plantilla } from './correos.mjs';
import { USOS, PLANES, alqPublico, bloqueosPublicos, SEGUROS } from './garaje.mjs';
import { leerTarifa, precioMes } from './comunidad.mjs';
import { alquilerPagado, conFirmas, condicionesAlquiler, contratoAlquiler, contratoParaFirmar, DIAS_RESTO, paginaDocumento, reembolso, SENAL_PCT, VERSION_CONDICIONES } from './contratos.mjs';
import { conductorEfectivo, cobrosListos, datosListos, desdeHora, documentoValido, faltaParaAlquilar, minHoras, normDoc, perfilCobros, planesDe, porHoras, precioDe, precioHora, refrescarCuenta, tienePrecio } from './cobros.mjs';

export const PLAZO_H = 24;           // horas que tiene el dueño para responder
import { createHmac } from 'node:crypto';
export const COMISION = 0;           // % de Sidonia si no se dice otra cosa (cfg.alquilerComision)
const comision = (cfg) => (cfg && Number.isFinite(cfg.alquilerComision) ? cfg.alquilerComision : COMISION);
const ivaDe = (cfg) => (cfg && Number.isFinite(cfg.alquilerIva) ? cfg.alquilerIva : 21);
/** La tarifa de servicio que paga quien alquila: la comisión de Sidonia más su IVA (15 % + 21 % = 18,15 % del alquiler) */
export const tarifaPct = (cfg) => Math.round(comision(cfg) * (1 + ivaDe(cfg) / 100) * 10000) / 10000;
const firmaR = (cfg, id) => createHmac('sha256', String(cfg.clave || cfg.secreto || 'sidonia')).update(`reserva.${Number(id)}`).digest('hex').slice(0, 32);
export const urlPagar = (cfg, id) => `${cfg.servidor}/tienda/alquiler/pagar?r=${Number(id)}&f=${firmaR(cfg, id)}`;
export const urlContrato = (cfg, id) => `${cfg.servidor}/tienda/alquiler/contrato?r=${Number(id)}&f=${firmaR(cfg, id)}`;
const stripeDe = async (cfg, deps) => deps.stripe || (await import('./motor.mjs')).stripe(cfg, deps.fetch);
const cent = (e) => Math.round(Number(e || 0) * 100);
/** Años cumplidos entre dos fechas AAAA-MM-DD */
export const anios = (de, a) => { const x = new Date(`${de}T12:00:00Z`), y = new Date(`${a}T12:00:00Z`); let n = y.getUTCFullYear() - x.getUTCFullYear(); if (y.getUTCMonth() < x.getUTCMonth() || (y.getUTCMonth() === x.getUTCMonth() && y.getUTCDate() < x.getUTCDate())) n--; return n; };
/** Lo que le corresponde al dueño de una reserva pagada (el alquiler menos lo devuelto de él) */
export const paraDueno = (r) => {
  const alquiler = alquilerPagado(r);
  const devueltoAlquiler = Math.max(0, (Number(r.reembolso) || 0) - (r.reembolso_tarifa ? Number(r.tarifa) || 0 : 0));
  return Math.max(0, Math.round((alquiler - devueltoAlquiler) * 100) / 100);
};
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const clip = (t, n) => String(t ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
const tabla = (cfg, deps, n) => deps[n] || tablaAnuncios(cfg, deps.fetch, n);
const hoyISO = () => new Date(Date.now() + 3600e3).toISOString().slice(0, 10); // España, más o menos
export const diasEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;
const solapa = (a1, a2, b1, b2) => a1 <= b2 && b1 <= a2;
const titulo = (c) => [c.marca, c.modelo, c.anio].filter(Boolean).join(' ');
const fechaTxt = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' });
const CONDUCE = { con: 'Con su dueño al volante', sin: 'Con su dueño al volante', ambos: 'Con su dueño al volante' };

/** El estado de verdad: las pendientes caducan a las 24 h y las aceptadas pasadas están completadas */
export function estadoActual(r, ahora = Date.now()) {
  // Con pago en la web: quien no termina de pagar en una hora no ha hecho la solicitud
  if (r.estado === 'pendiente' && r.pago === 'sin-pagar' && ahora - Date.parse(r.creado) > 3600e3) return 'caducada';
  if (r.estado === 'pendiente' && ahora - Date.parse(r.creado) > PLAZO_H * 3600e3) return 'caducada';
  // Aceptada pero sin pagar en 24 h: se libera
  if (r.estado === 'aceptada' && r.pago === 'pendiente' && ahora - Date.parse(r.respondida || r.creado) > PLAZO_H * 3600e3) return 'caducada';
  if (r.estado === 'aceptada' && String(r.hasta) < new Date(ahora + 3600e3).toISOString().slice(0, 10)) return 'completada';
  return r.estado;
}
/** El precio, como en Airbnb: precio por día del servicio (con o sin conductor) × días + tarifa de servicio */
export function precio(alq, desde, hasta, pct = COMISION, modo = 'con') {
  const dias = diasEntre(desde, hasta);
  const pd = precioDe(alq, 'con');
  const sub = pd * dias;
  const tarifa = Math.round((sub * pct) / 100);
  return { dias, precio_dia: pd, subtotal: sub, tarifa, total: sub + tarifa, fianza: 0 };
}
/* ------------------------------------------------------------------ Por horas
 * Cada reserva por horas lleva sus tramos: [{ dia: 'AAAA-MM-DD', de: '10:00', a: '14:00' }, …] (uno por día, de media
 * en media hora). Cada tramo se cobra como mínimo las horas mínimas del plan. */
const HORA = /^([01]\d|2[0-3]):(00|30)$/;
const minutos = (h) => { const [x, y] = String(h).split(':').map(Number); return x * 60 + y; };
export function leerTramos(l) {
  if (!Array.isArray(l)) return null;
  const t = l.map((x) => ({ dia: String(x?.dia || ''), de: String(x?.de || ''), a: String(x?.a || '') }))
    .filter((x) => DIA.test(x.dia) && HORA.test(x.de) && (HORA.test(x.a) || x.a === '24:00') && minutos(x.a) > minutos(x.de));
  const dias = new Set(t.map((x) => x.dia));
  if (!t.length || t.length !== l.length || dias.size !== t.length || t.length > 14) return null;
  return t.sort((x, y) => x.dia.localeCompare(y.dia));
}
export const horasTramo = (x) => (minutos(x.a) - minutos(x.de)) / 60;
/** El precio por horas: €/hora del coche × horas (cada día, al menos el mínimo) + tarifa de servicio */
export function precioHoras(alq, tramos, plan, pct = COMISION) {
  const ph = precioHora(alq, plan);
  const min = minHoras(alq, plan);
  const horas = tramos.reduce((n, x) => n + Math.max(horasTramo(x), min), 0);
  const sub = Math.round(ph * horas);
  const tarifa = Math.round((sub * pct) / 100);
  return { dias: tramos.length, horas, precio_hora: ph, min, precio_dia: ph, subtotal: sub, tarifa, total: sub + tarifa, fianza: 0 };
}
/** Las horas ya ocupadas de un coche (reservas por horas aceptadas): [{ dia, de, a }] */
export const horasOcupadas = (rs) => rs.filter((r) => estadoActual(r) === 'aceptada' && Array.isArray(r.tramos) && r.tramos.length).flatMap((r) => r.tramos);
/** ¿Están libres esas horas? Los días bloqueados y las reservas por días ocupan el día entero */
export function libreHoras(coche, reservas, tramos) {
  const dias = [...(coche.bloqueos || []), ...ocupadas(reservas)];
  const horas = horasOcupadas(reservas);
  return tramos.every((t) => !dias.some(([a, b]) => solapa(t.dia, t.dia, a, b))
    && !horas.some((h) => h.dia === t.dia && minutos(t.de) < minutos(h.a) && minutos(h.de) < minutos(t.a)));
}
const corto = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Madrid' });
/** Cuándo, en texto: «sáb 12 jun, 10:00–14:00 · dom 13 jun, 11:00–13:00 (6 h)» o «del 12 al 14 de junio (3 días)» */
export function cuandoTxt(r) {
  if (Array.isArray(r.tramos) && r.tramos.length) {
    const h = Number(r.horas) || r.tramos.reduce((n, x) => n + horasTramo(x), 0);
    return `${r.tramos.map((x) => `${corto(x.dia)}, ${x.de}–${x.a}`).join(' · ')} (${h.toLocaleString('es-ES')} h)`;
  }
  return `${fechaTxt(r.desde)} → ${fechaTxt(r.hasta)} (${r.dias} ${Number(r.dias) === 1 ? 'día' : 'días'})`;
}

/** La señal: si faltan más de 14 días, ahora se paga el 30 % del alquiler + la tarifa y el resto 14 días antes */
export function partes(total, tarifa, desde, ahora = Date.now()) {
  const alquiler = total - tarifa;
  const dias = (Date.parse(`${desde}T10:00:00+01:00`) - ahora) / 864e5;
  if (dias <= DIAS_RESTO + 1 || alquiler <= 0) return { a_cuenta: total, resto: 0 };
  const senal = Math.round((alquiler * SENAL_PCT) / 100);
  return { a_cuenta: senal + tarifa, resto: alquiler - senal };
}
export const urlPagarResto = (cfg, id) => `${cfg.servidor}/tienda/alquiler/pagar-resto?r=${Number(id)}&f=${firmaR(cfg, id)}`;
const fechaResto = (r) => { const d = new Date(`${String(r.desde).slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - DIAS_RESTO); return d.toISOString().slice(0, 10); };

/** El servicio que pide quien alquila: el que ofrece el coche, o el que elija si ofrece los dos */
const modoDe = () => 'con'; // siempre con su dueño al volante
/** Confirmada de verdad: aceptada y pagada (o sin pago en Sidonia) */
export const confirmada = (r) => { const e = estadoActual(r); return (e === 'aceptada' || e === 'completada') && !['pendiente', 'sin-pagar', 'autorizado'].includes(r.pago); };
const ocupadas = (rs) => rs.filter((r) => estadoActual(r) === 'aceptada' && !(Array.isArray(r.tramos) && r.tramos.length)).map((r) => [String(r.desde), String(r.hasta)]);
export function libre(coche, reservas, desde, hasta) {
  return ![...(coche.bloqueos || []), ...ocupadas(reservas)].some(([a, b]) => solapa(desde, hasta, a, b));
}

async function emailDueno(cfg, deps, dueno) {
  const [d] = await tabla(cfg, deps, 'alquiler').leer(`cliente=eq.${encodeURIComponent(dueno)}&rol=eq.poner&email=neq.&order=creado.desc&limit=1`).catch(() => []);
  return { email: d?.email || '', telefono: d?.telefono || '', nombre: d?.nombre || '' };
}
async function perfiles(cfg, deps, ids) {
  const l = [...new Set(ids.filter(Boolean).map(String))];
  if (!l.length) return {};
  const ps = await tabla(cfg, deps, 'perfiles').leer(`cliente=in.(${l.map((x) => `"${x.replace(/"/g, '')}"`).join(',')})&select=*`).catch(() => []);
  return Object.fromEntries(ps.map((p) => [String(p.cliente), p]));
}
const anfitrion = (cfg, p) => (p ? { nombre: p.nombre || 'Dueño', foto: p.foto ? urlFoto(cfg, p.foto) : '', ciudad: p.ciudad || '', slug: p.slug || '', tipo: p.tipo === 'profesional' ? 'profesional' : 'particular', desde: p.creado || p.actualizado || '' } : { nombre: 'Dueño', foto: '', ciudad: '', slug: '', tipo: 'particular' });

/** Anuncios de alquiler, como los de venta: el primero de cada persona gratis; los siguientes, de pago (la tarifa de
 *  Ajustes: tarifa.cobrar y sus tramos). Mientras no se cobre (tarifa.cobrar = false), todos se ven. Map id → info */
export function cuotasAlquiler(coches, tarifa, ahora = Date.now()) {
  const porDueno = {};
  for (const c of coches) (porDueno[c.cliente] ||= []).push(c);
  const info = new Map();
  for (const l of Object.values(porDueno)) {
    l.sort((a, b) => Date.parse(a.creado || 0) - Date.parse(b.creado || 0) || Number(a.id) - Number(b.id));
    l.forEach((c, i) => {
      const gratis = i === 0;
      const pagado = c.alq_hasta && Date.parse(c.alq_hasta) > ahora;
      info.set(Number(c.id), { gratis, precio: gratis ? 0 : precioMes(tarifa, i + 1), pagado_hasta: c.alq_hasta || null, activo: !tarifa.cobrar || gratis || Boolean(pagado) });
    });
  }
  return info;
}
const tarifaDe = (cfg, deps) => leerTarifa(deps.ajustes || tablaAnuncios(cfg, deps.fetch, 'ajustes'));

/** Lo que se sabe del dueño: reseñas de todos sus coches y cuántas veces ha alquilado */
async function statsDueno(cfg, deps, dueno, ids) {
  const tS = tabla(cfg, deps, 'reservas_resenas'), tR = tabla(cfg, deps, 'reservas');
  const res = ids.length ? await tS.leer(`coche_id=in.(${ids.join(',')})&rol=eq.huesped&order=creado.desc&limit=200`).catch(() => []) : [];
  const rs = await tR.leer(`dueno=eq.${encodeURIComponent(dueno)}&estado=eq.aceptada&select=desde,hasta,estado,creado,pago`).catch(() => []);
  return { resenas: res, nota: media(res), n: res.length, alquileres: rs.filter((r) => estadoActual(r) === 'completada').length };
}
const media = (l) => (l.length ? Math.round((l.reduce((s, x) => s + Number(x.nota), 0) / l.length) * 100) / 100 : 0);

/** La tarjeta de un anuncio */
function anuncio(cfg, c, p, resenas = [], liked = false) {
  const alq = { ...alqPublico(c.alq || {}), conductor: conductorEfectivo(c.alq || {}, cfg.alquilerCobrar) };
  // Precio por día de cada servicio que se ofrece de verdad (con conductor solo si se puede) y el «desde»
  const ps = { sin: alq.conductor === 'con' ? 0 : precioDe(c.alq || {}, 'sin'), con: alq.conductor === 'sin' ? 0 : precioDe(c.alq || {}, 'con') };
  alq.precios = ps; alq.precio = Math.min(...[ps.sin, ps.con].filter((x) => x > 0)) || 0;
  const rs = resenas.filter((r) => r.rol === 'huesped' && Number(r.coche_id) === Number(c.id));
  return { id: c.id, tipo: c.tipo, titulo: titulo(c), apodo: c.apodo || '', marca: c.marca, modelo: c.modelo, anio: c.anio,
    historia: c.historia || '', mods: c.mods || '', fotos: (c.fotos || []).map((f) => urlFoto(cfg, f)), alq, likes: Number(c.likes) || 0, liked,
    nota: media(rs), resenas: rs.length, anfitrion: anfitrion(cfg, p), creado: c.creado };
}

function correo(cfg, para, asunto, { titulo: t, previa, cuerpo, boton, enlace }, deps, responder) {
  if (!para) return Promise.resolve(false);
  return enviarCorreo(cfg, para, asunto, plantilla(cfg, null, { titulo: t, previa, cuerpo, boton, enlace, sinDudas: true }), deps.fetch, responder).catch((e) => { console.error(e); return false; });
}
const urlReservas = (cfg) => `${cfg.tienda}/pages/vende-con-nosotros?view=perfil#reservas`;

/* ---------------------------------------------------------------------------- Pago en la web (cfg.alquilerCobrar)
 * Como en Airbnb: al pedir el coche se RETIENE el importe en la tarjeta (Stripe, captura manual); si el dueño acepta en
 * 24 h, se cobra; si no, se libera. Se cobra «por cuenta» del dueño (on_behalf_of: él es el vendedor del cargo) y su
 * parte se le transfiere 24 h después del servicio. Sidonia se queda la tarifa de servicio.
 */
/** Los datos con los que se rellena el contrato. tapado: sin los datos privados del dueño ni del coche (vista previa) */
export function datosContrato(r, c, pD, emailD = '', tapado = false) {
  const a = c.alq || {}, l = (pD && pD.alq_legal) || {};
  const coche = { marca: c.marca, modelo: c.modelo, anio: c.anio, ...a };
  if (tapado) { coche.matricula = ''; coche.seguro_poliza = ''; coche.vtc = a.vtc ? 'la indicada al confirmar' : ''; }
  return {
    reserva: { id: r.id, desde: r.desde, hasta: r.hasta, dias: r.dias, tramos: r.tramos || null, horas: r.horas || null, precio_dia: r.precio_dia, total: r.total, tarifa: r.tarifa, para: r.para, conductor: r.conductor === 'con' ? 'con' : 'sin',
      lugar: r.conductor === 'con' ? (r.datos && r.datos.recogida) || '' : tapado ? a.ciudad : a.entrega || a.ciudad, pasajeros: (r.datos && r.datos.pasajeros) || '' },
    coche: { ...coche, seguro_tipo: SEGUROS[a.seguro_tipo] || a.seguro_tipo || '' },
    dueno: tapado ? { nombre: l.nombre } : { nombre: l.nombre, dni: l.dni, domicilio: l.domicilio, telefono: l.telefono, email: emailD },
    cliente: { nombre: r.nombre, email: r.email, telefono: r.telefono, ...(r.datos || {}) }
  };
}
const firmaInmediata = (pD, hash) => ({ nombre: pD.alq_legal.nombre, documento: pD.alq_legal.dni, fecha: new Date().toISOString(), ip: '', inmediata: true, autorizacion: pD.alq_legal.acepto, hash });

/** La sesión de pago de Stripe de una reserva (retiene, o cobra si es reserva inmediata) */
async function sesionPago(cfg, deps, r, c, pD) {
  const st = await stripeDe(cfg, deps);
  const t = titulo(c), inmediata = Boolean(c.alq && c.alq.inmediata), resto = Number(r.resto) || 0;
  const alquiler = Number(r.total) - Number(r.tarifa || 0) - resto;
  return st('POST', 'checkout/sessions', {
    mode: 'payment', locale: 'es', ...(r.email ? { customer_email: r.email } : {}),
    line_items: [
      { quantity: 1, price_data: { currency: 'eur', unit_amount: cent(alquiler), product_data: { name: `${resto ? `Señal (${SENAL_PCT} %) del alquiler` : 'Alquiler'}: ${t}`.slice(0, 250), description: `${cuandoTxt(r)}. Conduce ${pD.alq_legal.nombre.split(' ')[0]}.${resto ? ` El resto, ${resto} €, se cobra solo en esta tarjeta el ${fechaTxt(fechaResto(r))}.` : ''}`.slice(0, 500) } } },
      ...(Number(r.tarifa) > 0 ? [{ quantity: 1, price_data: { currency: 'eur', unit_amount: cent(r.tarifa), product_data: { name: `Tarifa de servicio de Sidonia (${comision(cfg)} % + IVA)` } } }] : [])
    ],
    metadata: { reserva: String(r.id) },
    ...(resto ? { customer_creation: 'always' } : {}),
    payment_intent_data: { capture_method: inmediata ? 'automatic' : 'manual', ...(cobrosListos(pD) ? { on_behalf_of: pD.stripe_cuenta } : {}), ...(resto ? { setup_future_usage: 'off_session' } : {}), transfer_group: `reserva-${Number(r.id)}`,
      metadata: { reserva: String(r.id) }, description: `Reserva #${Number(r.id)} · ${t}` },
    custom_text: { submit: { message: inmediata ? 'Reserva inmediata: se cobra ahora y queda confirmada.' : `Solo se retiene el importe: no se cobra hasta que el dueño acepte (tiene ${PLAZO_H} h). Si no acepta, se libera.` } },
    expires_at: Math.floor(Date.now() / 1000) + 1800,
    success_url: `${cfg.servidor}/tienda/alquiler/pagado?r=${Number(r.id)}&f=${firmaR(cfg, r.id)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: urlReservas(cfg)
  });
}

/** Vuelta de Stripe o aviso del webhook: la reserva queda retenida (solicitud) o pagada (inmediata) y se avisa a todos */
export async function confirmarPago(cfg, deps, id, sid) {
  const tR = tabla(cfg, deps, 'reservas'), tG = tabla(cfg, deps, 'garaje');
  const [r] = await tR.leer(`id=eq.${Number(id)}&limit=1`);
  if (!r || r.pago !== 'sin-pagar' || !/^cs_[A-Za-z0-9_]+$/.test(String(sid))) return r || null;
  const st = await stripeDe(cfg, deps);
  const s = await st('GET', `checkout/sessions/${sid}?expand[]=payment_intent`);
  if (String(s.metadata?.reserva) !== String(r.id) || s.status !== 'complete' || !s.payment_intent) return r;
  const pi = typeof s.payment_intent === 'string' ? await st('GET', `payment_intents/${s.payment_intent}`) : s.payment_intent;
  const pagado = pi.status === 'succeeded', retenido = pi.status === 'requires_capture';
  if (!pagado && !retenido) return r;
  const [c] = await tG.leer(`id=eq.${Number(r.coche_id)}&limit=1`);
  const pD = await perfilCobros(cfg, deps, r.dueno);
  const ahora = new Date().toISOString();
  const cambios = { stripe_pi: pi.id, stripe_sesion: sid, pago: pagado ? 'pagado' : 'autorizado',
    ...(pagado ? { pagado: ahora, estado: 'aceptada', respondida: ahora, firma_dueno: firmaInmediata(pD, r.contrato?.hash) } : {}) };
  await tR.cambiar(r.id, cambios);
  const rr = { ...r, ...cambios };
  const t = titulo(c || {}), d = await emailDueno(cfg, deps, r.dueno);
  const recordar = cobrosListos(pD) ? '' : P('<b>Para recibir tu dinero</b>, date de alta para cobrar en tu garaje (con Stripe, 5 minutos). Te guardamos tu parte hasta que esté.');
  const filas = [['Coche', t], ['Cuándo', cuandoTxt(r)], ['Total', `${Number(r.total)} €`], ...(r.para ? [['Para', r.para]] : []), ['Conductor', r.conductor === 'con' ? 'Con conductor' : 'Sin conductor']];
  const aDueno = pagado
    ? { titulo: '¡Tienes una reserva!', previa: `${r.nombre} ha reservado tu ${t}.`, cuerpo: P(`<b>${esc(r.nombre.split(' ')[0])}</b> ha reservado y pagado tu <b>${esc(t)}</b>. Tienes la reserva inmediata activada, así que está confirmada y el contrato firmado por los dos.`) + datos([...filas, ['Para ti', `${paraDueno(rr)} €`]]) + P('Escríbele desde Sidonia para quedar la hora de entrega. Te transferimos tu parte 24 horas después del servicio.') + recordar, boton: 'Ver la reserva y el contrato', enlace: urlReservas(cfg) }
    : { titulo: 'Te han pedido tu coche', previa: `${r.nombre} quiere tu ${t}.`, cuerpo: P(`<b>${esc(r.nombre.split(' ')[0])}</b> quiere alquilar tu <b>${esc(t)}</b>. El pago ya está retenido en su tarjeta.`) + datos([...filas, ['Para ti', `${paraDueno(rr)} €`]]) + (r.mensaje ? P(esc(r.mensaje)) : '') + P(`Tienes <b>${PLAZO_H} horas</b> para aceptarla (firmas el contrato y se cobra) o rechazarla. Si no respondes, caduca y se libera el pago.`) + recordar, boton: 'Responder a la solicitud', enlace: urlReservas(cfg) };
  await correo(cfg, d.email, pagado ? `Reserva confirmada: tu ${t}` : `Solicitud de reserva: tu ${t}`, aDueno, deps);
  await correo(cfg, r.email, pagado ? `Reserva confirmada: ${t}` : `Solicitud enviada: ${t}`, pagado
    ? { titulo: '¡Reserva confirmada!', previa: `${t}, del ${fechaTxt(r.desde)} al ${fechaTxt(r.hasta)}.`, cuerpo: P('Pago hecho: tu reserva está confirmada y el contrato firmado por los dos. En Sidonia tienes ya el contacto del dueño y dónde se recoge el coche.') + datos(filas), boton: 'Ver mi reserva y el contrato', enlace: urlReservas(cfg) }
    : { titulo: 'Solicitud enviada', previa: `${t}, del ${fechaTxt(r.desde)} al ${fechaTxt(r.hasta)}.`, cuerpo: P(`Hemos retenido ${Number(r.a_cuenta || r.total)} € en tu tarjeta${Number(r.resto) > 0 ? ` (la señal y la tarifa; el resto, ${Number(r.resto)} €, se cobra solo el ${fechaTxt(fechaResto(r))})` : ''}, pero <b>no se te cobra nada hasta que el dueño acepte</b>. Tiene ${PLAZO_H} horas; si no acepta, se libera la retención.`) + datos(filas), boton: 'Ver mi solicitud', enlace: urlReservas(cfg) }, deps);
  for (const e of cfg.avisosEquipo || []) await correo(cfg, e, `[Alquiler] ${pagado ? 'Reserva pagada' : 'Solicitud con pago retenido'}: ${t} · ${r.nombre}`, aDueno, deps, r.email);
  return rr;
}

/** Devuelve un importe: primero del resto (si se cobró) y luego de la señal */
async function devolver(st, r, importe, quien) {
  let falta = cent(importe);
  for (const id of [r.resto_pi, r.stripe_pi].filter(Boolean)) {
    if (falta <= 0) break;
    const max = id === r.resto_pi ? cent(r.resto) : cent(Number(r.total) - (Number(r.resto) || 0));
    const n = Math.min(falta, max);
    if (n > 0) { await st('POST', 'refunds', { payment_intent: id, amount: n, reason: 'requested_by_customer', metadata: { reserva: String(r.id), quien } }); falta -= n; }
  }
}

/** Lo que toca hacer con el dinero de una reserva según cómo esté: liberar la retención si caducó y transferir al dueño
 *  su parte 24 h después del servicio, y cobrar el resto 14 días antes. Lo llaman el repaso diario y la lista de reservas. */
export async function ponerAlDia(cfg, deps, r, ahora = Date.now()) {
  if (!cfg.alquilerCobrar || !r || !r.stripe_pi) return r;
  const tR = tabla(cfg, deps, 'reservas');
  try {
    const est = estadoActual(r, ahora);
    if (r.pago === 'autorizado' && est === 'caducada') {
      const st = await stripeDe(cfg, deps);
      await st('POST', `payment_intents/${r.stripe_pi}/cancel`, { cancellation_reason: 'abandoned' }).catch((e) => console.error(e));
      await tR.cambiar(r.id, { pago: 'liberado' });
      await correo(cfg, r.email, 'Tu solicitud ha caducado', { titulo: 'Solicitud caducada', previa: 'No se te ha cobrado nada.', cuerpo: P('El dueño no ha respondido a tiempo, así que la solicitud ha caducado y hemos liberado la retención de tu tarjeta: <b>no se te ha cobrado nada</b>. Mira otros coches en Sidonia: seguro que hay uno para ti.'), boton: 'Ver coches', enlace: `${cfg.tienda}/pages/vende-con-nosotros?view=alquiler` }, deps);
      return { ...r, pago: 'liberado' };
    }
    const hoy = new Date(ahora + 3600e3).toISOString().slice(0, 10);
    const st = await stripeDe(cfg, deps);
    // ---- El resto (pago en dos veces): se cobra solo 14 días antes; si falla, enlace para pagar y 48 h; si no, se cancela
    if (r.estado === 'aceptada' && r.pago === 'pagado' && Number(r.resto) > 0 && !r.resto_pagado && hoy >= fechaResto(r)) {
      if (r.resto_aviso && ahora - Date.parse(r.resto_aviso) > 48 * 3600e3) {
        const rb = reembolso(r, 'cliente', ahora);
        if (rb.importe > 0) await devolver(st, r, rb.importe, 'impago').catch((e) => console.error(e));
        const cambios = { estado: 'cancelada', cancelada_por: 'impago', respondida: new Date(ahora).toISOString(), reembolso: rb.importe, reembolso_tarifa: rb.tarifa, pago: rb.importe > 0 ? 'devuelto-parcial' : 'pagado' };
        await tR.cambiar(r.id, cambios);
        await correo(cfg, r.email, 'Reserva cancelada por falta de pago', { titulo: 'Reserva cancelada', previa: 'No hemos recibido el resto del pago.', cuerpo: P(`No hemos podido cobrar el resto de tu reserva (${Number(r.resto)} €) y no se ha pagado con el enlace, así que la reserva se ha cancelado. ${rb.motivo}`), boton: 'Ver mis reservas', enlace: urlReservas(cfg) }, deps);
        return { ...r, ...cambios };
      }
      if (!r.resto_aviso) {
        const pD = await perfilCobros(cfg, deps, r.dueno);
        try {
          const pi = await st('GET', `payment_intents/${r.stripe_pi}`);
          const pm = typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method?.id;
          const cus = typeof pi.customer === 'string' ? pi.customer : pi.customer?.id;
          if (!pm || !cus) throw new Error('sin tarjeta guardada');
          const p2 = await st('POST', 'payment_intents', { amount: cent(r.resto), currency: 'eur', customer: cus, payment_method: pm, off_session: 'true', confirm: 'true',
            ...(cobrosListos(pD) ? { on_behalf_of: pD.stripe_cuenta } : {}), transfer_group: `reserva-${Number(r.id)}`, description: `Reserva #${Number(r.id)} · resto`, metadata: { reserva: String(r.id), parte: 'resto' } });
          if (p2.status !== 'succeeded') throw new Error(`estado ${p2.status}`);
          const cambios = { resto_pi: p2.id, resto_pagado: new Date(ahora).toISOString(), resto_error: '' };
          await tR.cambiar(r.id, cambios);
          await correo(cfg, r.email, 'Reserva pagada del todo', { titulo: 'Reserva pagada', previa: `Hemos cobrado el resto: ${Number(r.resto)} €.`, cuerpo: P(`Hemos cobrado el resto de tu reserva, <b>${Number(r.resto)} €</b>, en la tarjeta que usaste. Ya está todo pagado. ¡A disfrutarlo!`), boton: 'Ver mi reserva', enlace: urlReservas(cfg) }, deps);
          return { ...r, ...cambios };
        } catch (e) {
          const cambios = { resto_aviso: new Date(ahora).toISOString(), resto_error: String(e.message || e).slice(0, 300) };
          await tR.cambiar(r.id, cambios);
          await correo(cfg, r.email, 'Falta el resto del pago de tu reserva', { titulo: 'Falta un paso', previa: 'No hemos podido cobrar el resto con tu tarjeta.', cuerpo: P(`No hemos podido cobrar el resto de tu reserva (<b>${Number(r.resto)} €</b>) en tu tarjeta. Págalo con el botón en las próximas <b>48 horas</b> o la reserva se cancelará.`), boton: `Pagar ${Number(r.resto)} €`, enlace: urlPagarResto(cfg, r.id) }, deps);
          return { ...r, ...cambios };
        }
      }
    }
    // ---- Al dueño, su parte: 24 h después del servicio (desde cada cobro, la señal y el resto)
    const fin = Date.parse(`${String(r.hasta).slice(0, 10)}T23:59:00+01:00`);
    const toca = r.estado === 'cancelada' ? String(r.desde) <= hoy : ahora >= fin + 24 * 3600e3;
    if (['pagado', 'devuelto-parcial'].includes(r.pago) && !r.stripe_transfer && toca && paraDueno(r) > 0 && ['aceptada', 'cancelada'].includes(r.estado)) {
      const pD = await refrescarCuenta(cfg, deps, await perfilCobros(cfg, deps, r.dueno));
      // Sin el alta de cobros terminada: se le guarda su parte y se le recuerda (el primer día que toca y luego cada semana)
      if (!cobrosListos(pD)) {
        const dias = Math.floor((ahora - (r.estado === 'cancelada' ? Date.parse(`${String(r.desde).slice(0, 10)}T00:00:00+01:00`) : fin + 24 * 3600e3)) / 864e5);
        if (dias % 7 === 0) {
          const d = await emailDueno(cfg, deps, r.dueno);
          await correo(cfg, d.email, 'Tienes dinero esperándote en Sidonia', { titulo: 'Date de alta para cobrar', previa: `Te guardamos ${paraDueno(r)} € de tu alquiler.`,
            cuerpo: P(`Tu parte de la reserva #${Number(r.id)} (<b>${paraDueno(r)} €</b>) ya está lista, pero aún no has terminado el alta para cobrar.`) + P('Entra en tu garaje y pulsa «Darme de alta para cobrar» (con Stripe, 5 minutos: tu identidad y tu cuenta bancaria). En cuanto esté, te la transferimos.'),
            boton: 'Darme de alta para cobrar', enlace: `${cfg.tienda}/pages/vende-con-nosotros?view=perfil#mi-garaje` }, deps).catch((e) => console.error(e));
        }
        return r;
      }
      let falta = cent(paraDueno(r));
      const cargos = [];
      // De la señal (o del pago entero), todo menos la tarifa de Sidonia; del resto, lo que falte
      const partesPago = [[r.stripe_pi, cent(Number(r.total) - (Number(r.resto) || 0) - (Number(r.tarifa) || 0))], [r.resto_pi, cent(r.resto)]];
      for (const [id, max] of partesPago) {
        if (!id) continue;
        const pi = await st('GET', `payment_intents/${id}`);
        cargos.push({ charge: pi.latest_charge, max });
      }
      const ids = [];
      for (const k of cargos) {
        const n = Math.min(falta, k.max);
        if (n <= 0) continue;
        const tr = await st('POST', 'transfers', { amount: n, currency: 'eur', destination: pD.stripe_cuenta, transfer_group: `reserva-${Number(r.id)}`,
          ...(k.charge ? { source_transaction: k.charge } : {}), metadata: { reserva: String(r.id) }, description: `Reserva #${Number(r.id)}` });
        ids.push(tr.id); falta -= n;
      }
      const cambios = { stripe_transfer: ids.join(','), transferido: new Date(ahora).toISOString(), pagado_dueno: new Date(ahora).toISOString() };
      await tR.cambiar(r.id, cambios);
      return { ...r, ...cambios };
    }
  } catch (e) { console.error(e); }
  return r;
}

/** El repaso diario (cron): retenciones caducadas y transferencias a los dueños */
export async function revisarReservas(cfg, deps) {
  if (!cfg.alquilerCobrar) return { revisadas: 0 };
  const l = await tabla(cfg, deps, 'reservas').leer('pago=in.(autorizado,pagado,devuelto-parcial)&stripe_transfer=eq.&order=desde.asc&limit=500');
  let hechas = 0;
  for (const r of l) { const x = await ponerAlDia(cfg, deps, r); if (x !== r) hechas++; }
  // Coches que ya están listos y aún no recibieron el «ya se puede alquilar» (p. ej., los que se quedaron atascados)
  try {
    const { avisarCochesListos } = await import('./cobros.mjs');
    const sin = (await tabla(cfg, deps, 'garaje').leer('alquiler=eq.true&visible=eq.true&select=cliente,alq&limit=500')).filter((c) => !c.alq?.aviso_listo);
    for (const cl of [...new Set(sin.map((c) => String(c.cliente)))]) await avisarCochesListos(cfg, deps, cl, { email: (await emailDueno(cfg, deps, cl)).email });
    // Y a quien le falta algo para publicarlo: un email (una vez por coche) con lo que le falta y el enlace a su garaje
    const tG = tabla(cfg, deps, 'garaje');
    const pend = (await tG.leer('alquiler=eq.true&visible=eq.true&limit=500')).filter((c) => !c.alq?.aviso_listo && !c.alq?.aviso_falta);
    const ps = await perfiles(cfg, deps, pend.map((c) => c.cliente));
    const QUE = { precio: 'el precio por hora', declara: 'marcar la declaración de responsabilidad (en «Editar»)', datos: 'tus datos para el contrato y aceptar las condiciones' };
    for (const c of pend) {
      const p = ps[String(c.cliente)];
      const f = faltaParaAlquilar(c, p, true);
      if (!f.length) continue;
      const para = String(p?.alq_legal?.email || (await emailDueno(cfg, deps, c.cliente)).email || '').trim();
      const t = titulo(c);
      if (para) {
        await correo(cfg, para, `Te falta muy poco para publicar tu ${t}`, { titulo: 'Casi listo', previa: `A tu ${t} solo le falta un paso.`,
          cuerpo: P(`Tu <b>${esc(t)}</b> está guardado, pero aún no sale en Alquiler porque falta:`) + `<ul>${f.map((x) => `<li>${esc(QUE[x] || x)}</li>`).join('')}</ul>` + P('Entra en tu garaje, complétalo y se publica al momento. Si algo no te deja, responde a este email y te ayudamos.'),
          boton: 'Ir a mi garaje', enlace: `${cfg.tienda}/pages/vende-con-nosotros?view=perfil#mi-garaje` }, deps).catch((e) => console.error(e));
      }
      for (const e of cfg.avisosEquipo || []) await correo(cfg, e, `[Alquiler] ${t}: atascado, falta ${f.join(', ')}`, { titulo: 'Coche de alquiler sin publicar', previa: t, cuerpo: P(`Cliente ${esc(String(c.cliente))}${para ? ` (${esc(para)})` : ' (sin email conocido)'}: su <b>${esc(t)}</b> no se publica porque falta: ${esc(f.join(', '))}.`), boton: 'Ver Alquiler', enlace: `${cfg.tienda}/pages/alquiler` }, deps).catch(() => {});
      await tG.cambiar(c.id, { alq: { ...(c.alq || {}), aviso_falta: new Date().toISOString() } });
    }
  } catch (e) { console.error(e); }
  return { revisadas: l.length, hechas };
}

/** Todas las rutas del alquiler tipo Airbnb (null si no es suya) */
export async function rutasReservas({ ruta, method, body, ip = '', ua = '' }, cliente, cfg, deps) {
  const R = ['api/alquiler/coches', 'api/alquiler/coche', 'api/alquiler/dueno', 'api/alquiler/reservar', 'api/alquiler/reservas', 'api/alquiler/reserva', 'api/alquiler/mensajes', 'api/alquiler/resena'];
  if (!R.includes(ruta)) return null;
  const json = (status, b, cache = 'no-store') => ({ status, headers: { 'Content-Type': 'application/json', 'Cache-Control': cache }, body: JSON.stringify(b) });
  const tG = tabla(cfg, deps, 'garaje'), tR = tabla(cfg, deps, 'reservas'), tM = tabla(cfg, deps, 'reservas_mensajes'), tS = tabla(cfg, deps, 'reservas_resenas');
  const falta = (e) => { console.error(e); return json(200, { ok: false, error: /reservas|alq|bloqueos|relation|does not exist|42P01|column/.test(String(e.message)) ? 'sin-tabla' : 'motor' }); };

  // ------------------------------------------------------------------ Buscar coches (como la portada de Airbnb)
  if (ruta === 'api/alquiler/coches' && method === 'GET') {
    try {
      const desde = DIA.test(body.desde) ? body.desde : '', hasta = DIA.test(body.hasta) ? body.hasta : desde;
      const ciudad = clip(body.ciudad, 60).toLowerCase(), conductor = ['con', 'sin'].includes(body.conductor) ? body.conductor : '';
      let coches = (await tG.leer('alquiler=eq.true&visible=eq.true&order=creado.desc&limit=500')).filter((c) => tienePrecio(c.alq || {}));
      const cuotas = cuotasAlquiler(coches, await tarifaDe(cfg, deps));
      coches = coches.filter((c) => cuotas.get(Number(c.id))?.activo !== false);
      if (cfg.alquilerCobrar) { const pp = await perfiles(cfg, deps, coches.map((c) => c.cliente)); coches = coches.filter((c) => !faltaParaAlquilar(c, pp[String(c.cliente)], true).length); }
      if (ciudad) coches = coches.filter((c) => String(c.alq?.ciudad || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(ciudad.normalize('NFD').replace(/[̀-ͯ]/g, '')));
      if (conductor) coches = coches.filter((c) => { const k = conductorEfectivo(c.alq || {}, cfg.alquilerCobrar); return k === conductor || k === 'ambos'; });
      const ids = coches.map((c) => Number(c.id));
      const rs = ids.length ? await tR.leer(`coche_id=in.(${ids.join(',')})&estado=eq.aceptada&select=coche_id,desde,hasta,estado,creado`).catch(() => []) : [];
      if (desde) coches = coches.filter((c) => libre(c, rs.filter((r) => Number(r.coche_id) === Number(c.id)), desde, hasta) && diasEntre(desde, hasta) >= (Number(c.alq?.minimo) || 1));
      const res = ids.length ? await tS.leer(`coche_id=in.(${ids.join(',')})&rol=eq.huesped&select=coche_id,nota,rol`).catch(() => []) : [];
      const ps = await perfiles(cfg, deps, coches.map((c) => c.cliente));
      return json(200, { ok: true, coches: coches.map((c) => anuncio(cfg, c, ps[String(c.cliente)], res)), comision: cfg.alquilerCobrar ? comision(cfg) : 0, iva: ivaDe(cfg), tarifa_pct: cfg.alquilerCobrar ? tarifaPct(cfg) : 0 }, cliente ? 'no-store' : 'public, max-age=30');
    } catch (e) { return falta(e); }
  }
  // ------------------------------------------------------------------ Un coche: ficha, calendario, reseñas y anfitrión
  if (ruta === 'api/alquiler/coche' && method === 'GET') {
    try {
      const [c] = await tG.leer(`id=eq.${Number(body.id)}&alquiler=eq.true&limit=1`);
      if (!c || c.visible === false) return json(404, { ok: false, error: 'no-existe' });
      const suyo = String(c.cliente) === String(cliente);
      const suyos = await tG.leer(`cliente=eq.${encodeURIComponent(c.cliente)}&alquiler=eq.true&visible=eq.true&select=id,cliente,creado,alq_hasta`).catch(() => [c]);
      if (!suyo && cuotasAlquiler(suyos, await tarifaDe(cfg, deps)).get(Number(c.id))?.activo === false) return json(404, { ok: false, error: 'no-existe' });
      const pD = cfg.alquilerCobrar ? await perfilCobros(cfg, deps, c.cliente) : null;
      const falta = cfg.alquilerCobrar ? faltaParaAlquilar(c, pD, true) : [];
      if (!suyo && falta.length) return json(404, { ok: false, error: 'no-existe' });
      const rs = await tR.leer(`coche_id=eq.${Number(c.id)}&select=desde,hasta,estado,creado,tramos`).catch(() => []);
      const res = await tS.leer(`coche_id=eq.${Number(c.id)}&order=creado.desc&limit=100`).catch(() => []);
      const ps = await perfiles(cfg, deps, [c.cliente]);
      const otros = suyos.length;
      const st = await statsDueno(cfg, deps, c.cliente, suyos.map((x) => Number(x.id)));
      return json(200, { ok: true, coche: { ...anuncio(cfg, c, ps[String(c.cliente)], res), suyo, ...(suyo ? { falta } : {}) }, cobrar: Boolean(cfg.alquilerCobrar),
        contrato_modelo: `${cfg.servidor}/tienda/alquiler/contrato-modelo?coche=${Number(c.id)}`, condiciones: `${cfg.servidor}/tienda/alquiler/condiciones`,
        dueno: { nota: st.nota, resenas: st.n, alquileres: st.alquileres, coches: otros },
        ocupado: [...bloqueosPublicos(c.bloqueos), ...ocupadas(rs)], ocupado_horas: horasOcupadas(rs), planes: PLANES, comision: cfg.alquilerCobrar ? comision(cfg) : 0, iva: ivaDe(cfg), tarifa_pct: cfg.alquilerCobrar ? tarifaPct(cfg) : 0, anfitrion_coches: otros,
        resenas: res.filter((r) => r.rol === 'huesped').map((r) => ({ nombre: r.nombre || 'Miembro de Sidonia', nota: r.nota, texto: r.texto, creado: r.creado })) }, cliente ? 'no-store' : 'public, max-age=30');
    } catch (e) { return falta(e); }
  }

  // ------------------------------------------------------------------ El perfil de un dueño: sus coches en alquiler y sus reseñas
  if (ruta === 'api/alquiler/dueno' && method === 'GET') {
    try {
      const slug = String(body.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 80);
      if (!slug) return json(400, { ok: false, error: 'datos' });
      const [p] = await tabla(cfg, deps, 'perfiles').leer(`slug=eq.${slug}&limit=1`);
      if (!p) return json(200, { ok: true, coches: [], resenas: [], nota: 0, n: 0, alquileres: 0 });
      let coches = (await tG.leer(`cliente=eq.${encodeURIComponent(p.cliente)}&alquiler=eq.true&visible=eq.true&order=creado.desc&limit=50`)).filter((c) => tienePrecio(c.alq || {}));
      const cuotas = cuotasAlquiler(coches, await tarifaDe(cfg, deps));
      coches = coches.filter((c) => cuotas.get(Number(c.id))?.activo !== false);
      const st = await statsDueno(cfg, deps, p.cliente, coches.map((c) => Number(c.id)));
      const deC = Object.fromEntries(coches.map((c) => [Number(c.id), titulo(c)]));
      return json(200, { ok: true, perfil: anfitrion(cfg, p), coches: coches.map((c) => anuncio(cfg, c, p, st.resenas)), nota: st.nota, n: st.n, alquileres: st.alquileres,
        resenas: st.resenas.slice(0, 20).map((r) => ({ nombre: r.nombre || 'Miembro de Sidonia', nota: r.nota, texto: r.texto, creado: r.creado, coche: deC[Number(r.coche_id)] || '' })) }, 'public, max-age=60');
    } catch (e) { return falta(e); }
  }

  if (!cliente) return json(200, { ok: false, error: 'login' });

  // ------------------------------------------------------------------ Reservar (solicitud o reserva inmediata)
  if (ruta === 'api/alquiler/reservar' && method === 'POST') {
    // Por horas: los tramos (uno por día); si no, por días (desde–hasta)
    const tramos = body.tramos === undefined ? null : leerTramos(body.tramos);
    if (body.tramos !== undefined && !tramos) return json(400, { ok: false, error: 'horas' });
    const desde = tramos ? tramos[0].dia : String(body.desde || ''), hasta = tramos ? tramos[tramos.length - 1].dia : String(body.hasta || body.desde || '');
    const q = { nombre: clip(body.nombre, 120), email: clip(body.email, 200).toLowerCase(), telefono: clip(body.telefono, 40), mensaje: clip(body.mensaje, 2000),
      para: USOS.includes(body.para) ? body.para : '', conductor: ['con', 'sin'].includes(body.conductor) ? body.conductor : '' };
    if (!DIA.test(desde) || !DIA.test(hasta) || hasta < desde) return json(400, { ok: false, error: 'fechas' });
    if (desde < hoyISO()) return json(400, { ok: false, error: 'pasado' });
    if (!q.nombre) return json(400, { ok: false, error: 'nombre' });
    if (!EMAIL.test(q.email)) return json(400, { ok: false, error: 'email' });
    if (q.mensaje.length < 10) return json(400, { ok: false, error: 'mensaje' });
    try {
      const [c] = await tG.leer(`id=eq.${Number(body.coche_id)}&alquiler=eq.true&limit=1`);
      if (!c || c.visible === false || !tienePrecio(c.alq || {})) return json(404, { ok: false, error: 'no-existe' });
      if (String(c.cliente) === String(cliente)) return json(400, { ok: false, error: 'suyo' });
      const modo = modoDe(c.alq, cfg.alquilerCobrar, q.conductor);
      q.conductor = modo;
      const plan = tramos && !(Number(c.alq.hora) > 0) ? String(body.plan || '') : '';
      if (tramos && !(precioHora(c.alq, plan) > 0)) return json(400, { ok: false, error: 'plan' });
      const pr = tramos ? precioHoras(c.alq, tramos, plan, cfg.alquilerCobrar ? tarifaPct(cfg) : 0) : precio(c.alq, desde, hasta, cfg.alquilerCobrar ? tarifaPct(cfg) : 0, modo);
      if (!(pr.precio_dia > 0)) return json(400, { ok: false, error: 'modo' });
      if (!tramos && pr.dias < (Number(c.alq.minimo) || 1)) return json(400, { ok: false, error: 'minimo', minimo: Number(c.alq.minimo) });
      if (pr.dias > 60) return json(400, { ok: false, error: 'fechas' });
      const rs = await tR.leer(`coche_id=eq.${Number(c.id)}&select=desde,hasta,estado,creado,tramos`);
      if (tramos ? !libreHoras(c, rs, tramos) : !libre(c, rs, desde, hasta)) return json(200, { ok: false, error: 'ocupado' });
      const conHoras = tramos ? { tramos, horas: pr.horas, plan, para: q.para || ({ boda: 'boda', rodaje: 'rodaje', evento: 'evento', ruta: 'ruta', escapada: 'finde' })[plan] || '' } : {};
      const mias = await tR.leer(`cliente=eq.${encodeURIComponent(cliente)}&estado=eq.pendiente&select=id,creado`).catch(() => []);
      if (mias.filter((r) => estadoActual(r) === 'pendiente').length >= 5) return json(200, { ok: false, error: 'muchas' });
      // ---- Con pago en la web: datos para el contrato, firma de quien alquila y a Stripe (retener o cobrar)
      if (cfg.alquilerCobrar) {
        const pD = await perfilCobros(cfg, deps, c.cliente);
        if (faltaParaAlquilar(c, pD, true).length) return json(200, { ok: false, error: 'no-disponible' });
        const conductor = modo;
        const x = { dni: normDoc(body.dni), nacimiento: DIA.test(body.nacimiento) ? body.nacimiento : '', domicilio: clip(body.domicilio, 250),
          carne_num: conductor === 'sin' ? clip(body.carne_num, 30).toUpperCase() : '', carne_fecha: conductor === 'sin' && DIA.test(body.carne_fecha) ? body.carne_fecha : '',
          ...(conductor === 'con' ? { pasajeros: Math.max(1, Math.min(Number(c.alq.plazas) ? Number(c.alq.plazas) - 1 : 8, Math.round(Number(body.pasajeros)) || 1)), recogida: clip(body.recogida, 300) } : {}) };
        if (conductor === 'con' && x.recogida.length < 5) return json(400, { ok: false, error: 'recogida' });
        if (q.nombre.split(/\s+/).length < 2) return json(400, { ok: false, error: 'nombre' });
        if (!/^\+?[\d\s]{9,15}$/.test(q.telefono)) return json(400, { ok: false, error: 'telefono' });
        if (!documentoValido(x.dni)) return json(400, { ok: false, error: 'dni' });
        if (!x.nacimiento || anios(x.nacimiento, hoyISO()) < 18) return json(400, { ok: false, error: 'nacimiento' });
        if (x.domicilio.length < 8) return json(400, { ok: false, error: 'domicilio' });
        if (conductor === 'sin') {
          if (anios(x.nacimiento, desde) < (Number(c.alq.edad_min) || 25)) return json(400, { ok: false, error: 'edad', edad_min: Number(c.alq.edad_min) || 25 });
          if (x.carne_num.length < 5) return json(400, { ok: false, error: 'carne' });
          if (!x.carne_fecha || x.carne_fecha > hoyISO()) return json(400, { ok: false, error: 'carne' });
          const cm = c.alq.carne_min === undefined ? 3 : Number(c.alq.carne_min);
          if (anios(x.carne_fecha, desde) < cm) return json(400, { ok: false, error: 'carne-antiguedad', carne_min: cm });
        }
        const igual = (a, b) => String(a).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ') === String(b).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
        if (!body.acepto) return json(400, { ok: false, error: 'acepto' });
        if (!igual(body.firma, q.nombre)) return json(400, { ok: false, error: 'firma' });
        const r = await tR.guardar({ coche_id: Number(c.id), dueno: String(c.cliente), cliente: String(cliente), desde, hasta, dias: pr.dias, precio_dia: pr.precio_dia, total: pr.total, tarifa: pr.tarifa, ...partes(pr.total, pr.tarifa, desde),
          pago: 'sin-pagar', estado: 'pendiente', ...q, ...conHoras, conductor, datos: x }, 'id');
        const d = await emailDueno(cfg, deps, c.cliente);
        const doc = contratoParaFirmar(cfg, datosContrato(r, c, pD, d.email));
        const firma_cliente = { nombre: q.nombre, documento: x.dni, fecha: new Date().toISOString(), ip: clip(ip, 60), ua: clip(ua, 200), hash: doc.hash, condiciones: VERSION_CONDICIONES };
        await tR.cambiar(r.id, { contrato: doc, firma_cliente });
        if (q.mensaje) await tM.guardar({ reserva_id: Number(r.id), de: String(cliente), texto: q.mensaje }, 'id').catch(() => null);
        const ses = await sesionPago(cfg, deps, { ...r, contrato: doc }, c, pD);
        return json(200, { ok: true, reserva: { id: r.id, estado: 'pendiente', ...pr, a_cuenta: r.a_cuenta, resto: r.resto }, pagar: ses.url });
      }
      const estado = c.alq.inmediata ? 'aceptada' : 'pendiente';
      const cobrar = false;
      const r = await tR.guardar({ coche_id: Number(c.id), dueno: String(c.cliente), cliente: String(cliente), desde, hasta, dias: pr.dias, precio_dia: pr.precio_dia, total: pr.total, tarifa: pr.tarifa,
        pago: cobrar && estado === 'aceptada' ? 'pendiente' : '', estado, ...q, ...conHoras, ...(estado === 'aceptada' ? { respondida: new Date().toISOString() } : {}) }, 'id');
      if (q.mensaje) await tM.guardar({ reserva_id: Number(r.id), de: String(cliente), texto: q.mensaje }, 'id').catch(() => null);
      // Emails: al dueño (solicitud o reserva hecha), a quien alquila (enviada o confirmada) y copia al equipo
      const d = await emailDueno(cfg, deps, c.cliente);
      const filas = [['Coche', titulo(c)], ['Cuándo', cuandoTxt({ desde, hasta, dias: pr.dias, ...conHoras })], ...(conHoras.plan ? [['Plan', PLANES[conHoras.plan]]] : []), ['Total', `${pr.total} €`], ...(q.para && !conHoras.plan ? [['Para', q.para]] : [])];
      const aDueno = { titulo: estado === 'aceptada' ? '¡Tienes una reserva!' : 'Te han pedido tu coche',
        previa: `${q.nombre} quiere tu ${titulo(c)}.`,
        cuerpo: P(`<b>${esc(q.nombre.split(' ')[0])}</b> ${estado === 'aceptada' ? 'ha reservado' : 'quiere alquilar'} tu <b>${esc(titulo(c))}</b>:`) + datos(filas) + P(esc(q.mensaje))
          + P(estado === 'aceptada' ? 'Tienes la reserva inmediata activada, así que ya está confirmada. Escríbele desde Sidonia para quedar.' : `Tienes <b>${PLAZO_H} horas</b> para aceptarla o rechazarla. Si no respondes, caduca.`),
        boton: estado === 'aceptada' ? 'Ver la reserva' : 'Responder a la solicitud', enlace: urlReservas(cfg) };
      await correo(cfg, d.email, estado === 'aceptada' ? `Reserva confirmada: tu ${titulo(c)}` : `Solicitud de reserva: tu ${titulo(c)}`, aDueno, deps);
      await correo(cfg, q.email, estado === 'aceptada' ? `Reserva confirmada: ${titulo(c)}` : `Solicitud enviada: ${titulo(c)}`, {
        titulo: estado === 'aceptada' ? '¡Reserva confirmada!' : 'Solicitud enviada', previa: `${titulo(c)}, del ${fechaTxt(desde)} al ${fechaTxt(hasta)}.`,
        cuerpo: P(estado === 'aceptada' ? (cobrar ? `Paga en las próximas ${PLAZO_H} horas para confirmarla: en cuanto pagues, verás el contacto del dueño y dónde se recoge.` : 'Tu reserva está confirmada. En Sidonia tienes ya el contacto del dueño y dónde se entrega el coche.') : `El dueño tiene ${PLAZO_H} horas para responder. Hasta que acepte no se te cobra nada.`) + datos(filas),
        boton: estado === 'aceptada' && cobrar ? 'Pagar y confirmar' : 'Ver mi reserva', enlace: estado === 'aceptada' && cobrar ? urlPagar(cfg, r.id) : urlReservas(cfg) }, deps);
      for (const e of cfg.avisosEquipo || []) await correo(cfg, e, `[Alquiler] ${estado === 'aceptada' ? 'Reserva' : 'Solicitud'}: ${titulo(c)} · ${q.nombre}`, aDueno, deps, q.email);
      return json(200, { ok: true, reserva: { id: r.id, estado, ...pr, ...(r.pago === 'pendiente' ? { pagar: urlPagar(cfg, r.id) } : {}) } });
    } catch (e) { return falta(e); }
  }

  // ------------------------------------------------------------------ Mis reservas: como quien alquila (viajes) y como dueño (solicitudes)
  if (ruta === 'api/alquiler/reservas' && method === 'GET') {
    try {
      const yo = encodeURIComponent(cliente);
      let [comoCliente, comoDueno] = await Promise.all([tR.leer(`cliente=eq.${yo}&order=creado.desc&limit=100`), tR.leer(`dueno=eq.${yo}&order=creado.desc&limit=200`)]);
      // El dueño no ve las solicitudes que aún no se han pagado; y lo pendiente con el dinero se pone al día
      comoDueno = comoDueno.filter((r) => r.pago !== 'sin-pagar');
      comoCliente = comoCliente.filter((r) => !(r.pago === 'sin-pagar' && estadoActual(r) === 'caducada'));
      if (cfg.alquilerCobrar) {
        const alDia = async (r) => (['autorizado', 'pagado', 'devuelto-parcial'].includes(r.pago) && !r.stripe_transfer ? ponerAlDia(cfg, deps, r) : r);
        [comoCliente, comoDueno] = await Promise.all([Promise.all(comoCliente.map(alDia)), Promise.all(comoDueno.map(alDia))]);
      }
      const todas = [...comoCliente, ...comoDueno];
      const ids = [...new Set(todas.map((r) => Number(r.coche_id)))];
      const coches = ids.length ? await tG.leer(`id=in.(${ids.join(',')})`) : [];
      const deC = Object.fromEntries(coches.map((c) => [Number(c.id), c]));
      const ps = await perfiles(cfg, deps, todas.flatMap((r) => [r.cliente, r.dueno]));
      const res = todas.length ? await tS.leer(`reserva_id=in.(${todas.map((r) => Number(r.id)).join(',')})&select=reserva_id,rol`).catch(() => []) : [];
      const contactos = {};
      const ver = async (r, rol) => {
        const c = deC[Number(r.coche_id)] || {};
        const estado = estadoActual(r);
        const conf = confirmada(r);
        let otro;
        if (rol === 'cliente') {
          if (conf && !contactos[r.dueno]) contactos[r.dueno] = await emailDueno(cfg, deps, r.dueno);
          otro = { nombre: ps[String(r.dueno)]?.nombre || 'Dueño', ...(conf ? { email: contactos[r.dueno].email, telefono: contactos[r.dueno].telefono } : {}) };
        } else otro = { nombre: r.nombre || ps[String(r.cliente)]?.nombre || 'Cliente', ...(conf ? { email: r.email, telefono: r.telefono } : {}) };
        return { id: r.id, rol, estado, desde: r.desde, hasta: r.hasta, dias: r.dias, tramos: r.tramos || null, horas: r.horas || null, plan: r.plan || '', precio_dia: r.precio_dia, total: r.total, tarifa: Number(r.tarifa) || 0, para: r.para, creado: r.creado,
          pago: r.pago || '', ...(rol === 'cliente' && estado === 'pendiente' && r.pago === 'sin-pagar' ? { pagar: urlPagar(cfg, r.id) } : {}),
          gana: cfg.alquilerCobrar ? paraDueno(r) : (Number(r.total) || 0) - (Number(r.tarifa) || 0), pagado_dueno: r.pagado_dueno || null,
          conductor: r.conductor || '', cobrar: Boolean(cfg.alquilerCobrar),
          ...(r.firma_cliente ? { contrato: urlContrato(cfg, r.id), firmado_dueno: Boolean(r.firma_dueno) } : {}),
          reembolso: Number(r.reembolso) || 0, cancelada_por: r.cancelada_por || '',
          ...(rol === 'cliente' && estado === 'aceptada' && r.pago === 'pagado' && String(r.desde) > hoyISO() ? { si_cancelo: reembolso(r, 'cliente') } : {}),
          caduca: estado === 'pendiente' ? new Date(Date.parse(r.creado) + PLAZO_H * 3600e3).toISOString() : null,
          coche: { id: c.id, titulo: titulo(c), foto: (c.fotos || [])[0] ? urlFoto(cfg, c.fotos[0]) : '', ciudad: c.alq?.ciudad || '', ...(conf ? { entrega: c.alq?.entrega || '' } : {}) },
          otro, resena_hecha: res.some((x) => Number(x.reserva_id) === Number(r.id) && x.rol === (rol === 'cliente' ? 'huesped' : 'anfitrion')) };
      };
      return json(200, { ok: true, viajes: await Promise.all(comoCliente.map((r) => ver(r, 'cliente'))), solicitudes: await Promise.all(comoDueno.map((r) => ver(r, 'dueno'))) });
    } catch (e) { return falta(e); }
  }

  // Una reserva de la que es parte (para responder, cancelar, escribir o reseñar)
  const suya = async (id) => {
    const [r] = await tR.leer(`id=eq.${Number(id)}&limit=1`);
    if (!r) return null;
    const rol = String(r.cliente) === String(cliente) ? 'cliente' : String(r.dueno) === String(cliente) ? 'dueno' : '';
    return rol ? { r, rol } : null;
  };

  // ------------------------------------------------------------------ Aceptar, rechazar o cancelar
  if (ruta === 'api/alquiler/reserva' && method === 'POST') {
    try {
      const s = await suya(body.id);
      if (!s) return json(404, { ok: false, error: 'no-existe' });
      const { r, rol } = s;
      const estado = estadoActual(r), accion = String(body.accion || '');
      const [c] = await tG.leer(`id=eq.${Number(r.coche_id)}&limit=1`);
      let nuevo = '';
      if (rol === 'dueno' && estado === 'pendiente' && accion === 'aceptar') {
        const rs = (await tR.leer(`coche_id=eq.${Number(r.coche_id)}&select=id,desde,hasta,estado,creado`)).filter((x) => Number(x.id) !== Number(r.id));
        if (!libre(c || {}, rs, String(r.desde), String(r.hasta))) return json(200, { ok: false, error: 'ocupado' });
        nuevo = 'aceptada';
      } else if (rol === 'dueno' && estado === 'pendiente' && accion === 'rechazar') nuevo = 'rechazada';
      else if (accion === 'cancelar' && (estado === 'pendiente' || (estado === 'aceptada' && String(r.desde) > hoyISO()))) nuevo = 'cancelada';
      else return json(400, { ok: false, error: 'estado' });
      // ---- Con pago en la web: aceptar = firmar y cobrar; rechazar o cancelar una solicitud = liberar; cancelar una reserva pagada = devolver según la política
      let pagoNuevo = {}, rb = null;
      if (cfg.alquilerCobrar && r.stripe_pi) {
        const st = await stripeDe(cfg, deps);
        const ahora = new Date().toISOString();
        if (nuevo === 'aceptada') {
          if (r.pago !== 'autorizado') return json(400, { ok: false, error: 'pago' });
          const pD = await perfilCobros(cfg, deps, r.dueno);
          if (!datosListos(pD)) return json(400, { ok: false, error: 'datos' });
          const igual = (a, b) => String(a).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ') === String(b).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
          if (!body.acepto) return json(400, { ok: false, error: 'acepto' });
          if (!igual(body.firma, pD.alq_legal.nombre)) return json(400, { ok: false, error: 'firma', nombre: pD.alq_legal.nombre });
          try { await st('POST', `payment_intents/${r.stripe_pi}/capture`); } catch (e) { console.error(e); return json(200, { ok: false, error: 'cobro' }); }
          pagoNuevo = { pago: 'pagado', pagado: ahora, firma_dueno: { nombre: pD.alq_legal.nombre, documento: pD.alq_legal.dni, fecha: ahora, ip: clip(ip, 60), ua: clip(ua, 200), hash: r.contrato?.hash || '' } };
        } else if (r.pago === 'autorizado') {
          await st('POST', `payment_intents/${r.stripe_pi}/cancel`, { cancellation_reason: 'requested_by_customer' }).catch((e) => console.error(e));
          pagoNuevo = { pago: 'liberado', cancelada_por: nuevo === 'cancelada' ? rol : '' };
        } else if (nuevo === 'cancelada' && r.pago === 'pagado') {
          rb = reembolso(r, rol === 'dueno' ? 'dueno' : 'cliente');
          if (rb.importe > 0) {
            try { await devolver(st, r, rb.importe, rol); }
            catch (e) { console.error(e); return json(200, { ok: false, error: 'devolucion' }); }
          }
          pagoNuevo = { pago: rb.importe >= alquilerPagado(r) + (Number(r.tarifa) || 0) ? 'devuelto' : rb.importe > 0 ? 'devuelto-parcial' : 'pagado', reembolso: rb.importe, reembolso_tarifa: rb.tarifa, cancelada_por: rol };
        }
      }
      await tR.cambiar(r.id, { estado: nuevo, respondida: new Date().toISOString(), ...pagoNuevo });
      const t = titulo(c || {});
      const cob = cfg.alquilerCobrar && r.stripe_pi;
      const TXT = { aceptada: ['¡Reserva confirmada!', `El dueño ha aceptado tu reserva del ${t}${cob ? ', ha firmado el contrato y se ha cobrado el pago' : ''}. Ya tienes su contacto y dónde se entrega el coche en Sidonia.`],
        rechazada: ['Solicitud no aceptada', `El dueño no puede alquilarte el ${t} esas fechas.${cob ? ' Hemos liberado la retención de tu tarjeta: no se te ha cobrado nada.' : ''} Mira otros coches en Sidonia: seguro que hay uno para ti.`],
        cancelada: ['Reserva cancelada', `La reserva del ${t} (${fechaTxt(r.desde)} → ${fechaTxt(r.hasta)}) se ha cancelado${rol === 'dueno' ? ' por el dueño' : ''}.${pagoNuevo.pago === 'liberado' ? ' No se ha cobrado nada.' : rb ? (rb.importe > 0 ? ` Se devuelven ${rb.importe} € a la tarjeta con la que se pagó (5 a 10 días hábiles).` : ' Según la política de cancelación, no se devuelve el importe.') : ''}`] };
      const [tt, cuerpo] = TXT[nuevo];
      const d = await emailDueno(cfg, deps, r.dueno);
      const para = rol === 'dueno' ? r.email : d.email;
      await correo(cfg, para, `${tt}: ${t}`, { titulo: tt, previa: cuerpo, cuerpo: P(cuerpo) + (nuevo === 'aceptada' && cob ? P(`El contrato firmado por los dos está aquí: <a href="${esc(urlContrato(cfg, r.id))}">ver el contrato</a>.`) : ''), boton: 'Ver en Sidonia', enlace: urlReservas(cfg) }, deps);
      // Al dueño, su copia cuando acepta (con el contrato) o cuando cancela quien alquila una reserva pagada
      if (nuevo === 'aceptada' && cob) await correo(cfg, d.email, `Reserva confirmada: tu ${t}`, { titulo: 'Reserva confirmada', previa: `Has aceptado la reserva de tu ${t}.`, cuerpo: P(`Has firmado el contrato y se ha cobrado la reserva. Te transferimos <b>${Number(r.total) - Number(r.tarifa || 0)} €</b> 24 horas después del servicio. Escríbele desde Sidonia para quedar la hora de entrega.`) + P(`<a href="${esc(urlContrato(cfg, r.id))}">Ver el contrato firmado</a>`), boton: 'Ver la reserva', enlace: urlReservas(cfg) }, deps);
      for (const e of cfg.avisosEquipo || []) await correo(cfg, e, `[Alquiler] ${tt}: ${t}`, { titulo: tt, previa: cuerpo, cuerpo: P(cuerpo), boton: 'Panel', enlace: `${cfg.servidor}/admin?estado=alquiler` }, deps);
      return json(200, { ok: true, estado: nuevo, ...(rb ? { reembolso: rb.importe } : {}) });
    } catch (e) { return falta(e); }
  }

  // ------------------------------------------------------------------ Mensajes de una reserva
  if (ruta === 'api/alquiler/mensajes') {
    try {
      const s = await suya(body.id);
      if (!s) return json(404, { ok: false, error: 'no-existe' });
      if (method === 'POST') {
        const texto = clip(body.texto, 2000);
        if (!texto) return json(400, { ok: false, error: 'texto' });
        await tM.guardar({ reserva_id: Number(s.r.id), de: String(cliente), texto }, 'id');
        const d = s.rol === 'cliente' ? (await emailDueno(cfg, deps, s.r.dueno)).email : s.r.email;
        await correo(cfg, d, 'Tienes un mensaje en Sidonia', { titulo: 'Nuevo mensaje', previa: texto.slice(0, 90), cuerpo: P(`${esc(s.rol === 'cliente' ? s.r.nombre || 'Quien alquila' : 'El dueño')} te ha escrito sobre la reserva:`) + P(esc(texto)), boton: 'Responder en Sidonia', enlace: urlReservas(cfg) }, deps);
      }
      const l = await tM.leer(`reserva_id=eq.${Number(s.r.id)}&order=creado.asc&limit=500`);
      return json(200, { ok: true, mensajes: l.map((m) => ({ id: m.id, mio: String(m.de) === String(cliente), texto: m.texto, creado: m.creado })) });
    } catch (e) { return falta(e); }
  }

  // ------------------------------------------------------------------ Reseña (al acabar)
  if (ruta === 'api/alquiler/resena' && method === 'POST') {
    try {
      const s = await suya(body.id);
      if (!s) return json(404, { ok: false, error: 'no-existe' });
      if (estadoActual(s.r) !== 'completada' || s.r.pago === 'pendiente') return json(400, { ok: false, error: 'estado' });
      const nota = Math.round(Number(body.nota)), texto = clip(body.texto, 1500);
      if (!(nota >= 1 && nota <= 5)) return json(400, { ok: false, error: 'nota' });
      if (texto.length < 10) return json(400, { ok: false, error: 'texto' });
      const ps = await perfiles(cfg, deps, [cliente]);
      const n = String(ps[String(cliente)]?.nombre || (s.rol === 'cliente' ? s.r.nombre : '') || '').trim().split(/\s+/);
      const nombre = n[0] ? `${n[0]}${n.length > 1 ? ` ${n[n.length - 1][0]}.` : ''}` : 'Miembro de Sidonia';
      await tS.guardar({ reserva_id: Number(s.r.id), coche_id: Number(s.r.coche_id), rol: s.rol === 'cliente' ? 'huesped' : 'anfitrion', autor: String(cliente), sobre: String(s.rol === 'cliente' ? s.r.dueno : s.r.cliente), nombre, nota, texto }, 'reserva_id,rol');
      return json(200, { ok: true });
    } catch (e) { return falta(e); }
  }
  return json(404, { ok: false, error: 'ruta' });
}

/* ---------------------------------------------------------------------------- Pagar (Stripe) */
const pagina = (cfg, titulo, texto, enlace, boton) => ({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  body: `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)} · SIDONIA</title>
<style>body{margin:0;font-family:Inter,system-ui,sans-serif;background:#f4f4f4;color:#1a1a1a;display:grid;place-items:center;min-height:100vh;padding:20px;box-sizing:border-box}main{max-width:440px;background:#fff;border-radius:22px;padding:30px;box-shadow:0 20px 50px -30px rgba(0,0,0,.4);text-align:center}h1{font-size:24px;margin:0 0 10px}p{color:#555;line-height:1.55}a{display:inline-block;margin-top:14px;padding:13px 22px;border-radius:999px;background:#1a1a1a;color:#fff;text-decoration:none;font-weight:700}.l{letter-spacing:6px;font-weight:700;margin-bottom:18px}</style></head>
<body><main><div class="l">SIDONIA</div><h1>${esc(titulo)}</h1><p>${texto}</p>${enlace ? `<a href="${esc(enlace)}">${esc(boton || 'Volver a Sidonia')}</a>` : ''}</main></body></html>` });

/** Páginas del alquiler (sin sesión):
 *   /tienda/alquiler/condiciones                   las condiciones del servicio de alquiler
 *   /tienda/alquiler/contrato-modelo?coche=&desde=&hasta=&conductor=   el contrato que se va a firmar (sin datos privados)
 *   /tienda/alquiler/contrato?r=&f=                el contrato de una reserva, con sus firmas (enlace firmado)
 *   /tienda/alquiler/pagar?r=&f=                   volver a Stripe si no se terminó de pagar
 *   /tienda/alquiler/pagado?r=&f=&session_id=      la vuelta de Stripe
 */
export async function rutasPagoReserva({ ruta, query }, cfg, deps) {
  const html = (body) => ({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }, body });
  const tR = tabla(cfg, deps, 'reservas'), tG = tabla(cfg, deps, 'garaje');
  if (ruta === 'alquiler/condiciones') return html(paginaDocumento('Condiciones del alquiler', condicionesAlquiler(cfg)));
  if (ruta === 'alquiler/contrato-modelo') {
    const [c] = Number(query.coche) ? await tG.leer(`id=eq.${Number(query.coche)}&alquiler=eq.true&limit=1`).catch(() => []) : [];
    const pD = c ? await perfilCobros(cfg, deps, c.cliente) : null;
    const desde = DIA.test(query.desde) ? query.desde : '', hasta = DIA.test(query.hasta) ? query.hasta : desde;
    const conductor = modoDe((c && c.alq) || {}, true, query.conductor);
    const pr = c && desde ? precio(c.alq || {}, desde, hasta, tarifaPct(cfg), conductor) : {};
    const d = datosContrato({ id: '', desde, hasta, dias: pr.dias, precio_dia: pr.precio_dia, total: pr.total, tarifa: pr.tarifa, para: '', conductor, nombre: '', email: '', telefono: '', datos: {} }, c || { alq: {} }, pD, '', true);
    return html(paginaDocumento('Contrato de alquiler', `<p class="meta"><b>Modelo para leer antes de reservar.</b> Al reservar se rellena con tus datos y con los del dueño (su documento, domicilio y contacto, la matrícula y la póliza del seguro se muestran al confirmarse la reserva), y lo firmáis los dos.</p>${contratoAlquiler(cfg, d)}`));
  }
  const id = Number(query.r);
  if (!id || query.f !== firmaR(cfg, id)) return pagina(cfg, 'Enlace no válido', 'Este enlace no es correcto. Entra en Sidonia › Mi perfil › Reservas.', urlReservas(cfg));
  const [r] = await tR.leer(`id=eq.${id}&limit=1`);
  if (!r) return pagina(cfg, 'Reserva no encontrada', 'No encontramos esta reserva.', urlReservas(cfg));
  const [c] = await tG.leer(`id=eq.${Number(r.coche_id)}&limit=1`).catch(() => []);
  const t = titulo(c || {});
  // El resto (si el cobro automático falló): pagarlo con Stripe y la vuelta
  if (ruta === 'alquiler/pagar-resto' || ruta === 'alquiler/resto-pagado') {
    if (r.resto_pagado) return pagina(cfg, 'Ya está pagada', 'Tu reserva está pagada del todo. ¡A disfrutarla!', urlReservas(cfg));
    if (r.estado !== 'aceptada' || !(Number(r.resto) > 0)) return pagina(cfg, 'No hay nada que pagar', 'Esta reserva no tiene pagos pendientes.', urlReservas(cfg));
    const st = await stripeDe(cfg, deps);
    if (ruta === 'alquiler/pagar-resto') {
      const pD = await perfilCobros(cfg, deps, r.dueno);
      const ses = await st('POST', 'checkout/sessions', { mode: 'payment', locale: 'es', ...(r.email ? { customer_email: r.email } : {}),
        line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: cent(r.resto), product_data: { name: `Resto del alquiler: ${t}`.slice(0, 250) } } }],
        metadata: { reserva: String(r.id), parte: 'resto' },
        payment_intent_data: { ...(cobrosListos(pD) ? { on_behalf_of: pD.stripe_cuenta } : {}), transfer_group: `reserva-${Number(r.id)}`, metadata: { reserva: String(r.id), parte: 'resto' } },
        success_url: `${cfg.servidor}/tienda/alquiler/resto-pagado?r=${Number(r.id)}&f=${firmaR(cfg, r.id)}&session_id={CHECKOUT_SESSION_ID}`, cancel_url: urlReservas(cfg) });
      return { status: 303, headers: { Location: ses.url, 'Cache-Control': 'no-store' }, body: '' };
    }
    const sid = String(query.session_id || '');
    if (!/^cs_[A-Za-z0-9_]+$/.test(sid)) return pagina(cfg, 'Falta el pago', 'No hemos recibido el pago. Prueba otra vez con el enlace de tu email.', urlReservas(cfg));
    const ses = await st('GET', `checkout/sessions/${sid}`);
    if (ses.payment_status !== 'paid' || String(ses.metadata?.reserva) !== String(r.id)) return pagina(cfg, 'Falta el pago', 'No hemos recibido el pago. Prueba otra vez con el enlace de tu email.', urlReservas(cfg));
    await tR.cambiar(r.id, { resto_pi: typeof ses.payment_intent === 'string' ? ses.payment_intent : ses.payment_intent?.id, resto_pagado: new Date().toISOString(), resto_error: '', resto_aviso: null });
    return pagina(cfg, '¡Pagada del todo!', `Tu reserva del ${t} está pagada. ¡A disfrutarla!`, urlReservas(cfg));
  }
  if (ruta === 'alquiler/contrato') {
    if (!r.contrato?.html) return pagina(cfg, 'Sin contrato', 'Esta reserva no tiene contrato.', urlReservas(cfg));
    const f = { cliente: r.firma_cliente || null, dueno: r.firma_dueno || null };
    const estado = f.dueno ? 'Firmado por las dos partes.' : 'Firmado por el arrendatario; pendiente de la firma del arrendador.';
    return html(paginaDocumento(`Contrato · ${t}`, conFirmas(r.contrato.html, f), { pie: `${estado} Modelo ${esc(r.contrato.version)} · Huella SHA-256 del texto firmado: ${esc(r.contrato.hash)} · Condiciones del servicio aceptadas: versión ${esc(r.firma_cliente?.condiciones || '')}.` }));
  }
  if (ruta === 'alquiler/pagado') {
    let rr = r;
    try { rr = (await confirmarPago(cfg, deps, id, String(query.session_id || ''))) || r; } catch (e) { console.error(e); }
    const ok = ['autorizado', 'pagado'].includes(rr.pago);
    return { status: 303, headers: { Location: `${urlReservas(cfg).replace('#reservas', `&reserva=${ok ? 'ok' : 'pendiente'}#reservas`)}`, 'Cache-Control': 'no-store' }, body: '' };
  }
  // alquiler/pagar: volver a Stripe para terminar el pago de una solicitud
  if (['autorizado', 'pagado'].includes(r.pago)) return pagina(cfg, 'Ya está hecho', `El pago de la reserva del ${esc(t)} ya está hecho.`, urlReservas(cfg), 'Ver mis reservas');
  if (r.pago !== 'sin-pagar' || estadoActual(r) !== 'pendiente') return pagina(cfg, 'No se puede pagar', 'Esta solicitud ya no está pendiente de pago (ha caducado o se ha cancelado). Vuelve a pedir el coche.', urlReservas(cfg), 'Ver mis reservas');
  if (!cfg.stripeKey) return pagina(cfg, 'Aún no se puede pagar aquí', 'Escríbenos y te ayudamos.', urlReservas(cfg));
  const pD = await perfilCobros(cfg, deps, r.dueno);
  if (!c || !datosListos(pD)) return pagina(cfg, 'No disponible', 'Este coche ya no se puede reservar.', urlReservas(cfg));
  const ses = await sesionPago(cfg, deps, r, c, pD);
  return { status: 303, headers: { Location: ses.url, 'Cache-Control': 'no-store' }, body: '' };
}

/** Panel › Garajes: un mes más pagado de un anuncio de alquiler (los de pago) */
export async function accionPanelGarajes(b, cfg, deps) {
  if (b.accion !== 'alq-mes' || !Number(b.id)) return '';
  const tG = tabla(cfg, deps, 'garaje');
  const [c] = await tG.leer(`id=eq.${Number(b.id)}&select=id,alq_hasta&limit=1`);
  if (!c) return '';
  const d = new Date(Math.max(c.alq_hasta ? Date.parse(c.alq_hasta) : 0, Date.now()));
  d.setMonth(d.getMonth() + 1);
  await tG.cambiar(c.id, { alq_hasta: d.toISOString() });
  return '';
}

/** Panel: marcar que ya se le ha pagado al dueño */
export async function accionPanelReservas(b, cfg, deps) {
  if (b.accion !== 'reserva-pagada-dueno' || !Number(b.id)) return '';
  await tabla(cfg, deps, 'reservas').cambiar(Number(b.id), { pagado_dueno: new Date().toISOString() });
  return '';
}

/* ---------------------------------------------------------------------------- Panel › Clientes › Alquiler: reservas */
const PAGO = { 'sin-pagar': 'Sin terminar de pagar', autorizado: 'Retenido (esperando al dueño)', pagado: '<span class="si">Pagado</span>', liberado: 'Retención liberada', devuelto: 'Devuelto', 'devuelto-parcial': 'Devuelto en parte', pendiente: 'Esperando el pago' };
export function tablaReservasPanel(reservas, coches = [], cfg = {}) {
  if (!reservas.length) return '';
  const deC = Object.fromEntries(coches.map((c) => [Number(c.id), c]));
  const EST = { pendiente: 'Pendiente', aceptada: 'Confirmada', rechazada: 'Rechazada', cancelada: 'Cancelada', caducada: 'Caducada', completada: 'Completada' };
  const pagadas = reservas.filter((r) => ['pagado', 'devuelto-parcial'].includes(r.pago));
  const ganado = pagadas.reduce((s, r) => s + (r.reembolso_tarifa ? 0 : Number(r.tarifa) || 0), 0), debe = pagadas.filter((r) => !r.pagado_dueno).reduce((s, r) => s + paraDueno(r), 0);
  return `<h2 style="margin:22px 0 8px">Reservas</h2><div class="kpis"><div class="kpi"><span>Reservas pagadas</span><b>${pagadas.length}</b><small>${reservas.length} en total</small></div><div class="kpi"><span>Comisión de Sidonia</span><b>${ganado} €</b><small>de las pagadas</small></div><div class="kpi"><span>Por pagar a dueños</span><b>${debe} €</b><small>se transfiere 24 h después del servicio</small></div></div><div class="card"><div class="tabla"><table>
  <thead><tr><th class="izq">Coche</th><th class="izq">Fechas</th><th>Total</th><th>Sidonia</th><th>Para el dueño</th><th class="izq">Quien alquila</th><th class="izq">Estado</th><th class="izq">Pago</th></tr></thead>
  <tbody>${reservas.map((r) => `<tr><td class="izq"><b>${esc(titulo(deC[Number(r.coche_id)] || {}) || `#${Number(r.coche_id)}`)}</b></td>
    <td class="izq">${esc(String(r.desde))} → ${esc(String(r.hasta))}<span class="sub">${Number(r.dias)} días</span></td><td>${Number(r.total)} €</td><td>${Number(r.tarifa || 0)} €</td><td>${Number(r.total) - Number(r.tarifa || 0)} €</td>
    <td class="izq">${esc(r.nombre)}<span class="sub">${esc(r.email)}${r.telefono ? ` · ${esc(r.telefono)}` : ''}</span></td><td class="izq">${EST[estadoActual(r)] || esc(r.estado)}</td>
    <td class="izq">${PAGO[r.pago] || 'En la entrega'}${Number(r.reembolso) ? `<span class="sub">Devuelto ${Number(r.reembolso)} €</span>` : ''}${r.stripe_transfer ? `<span class="sub">Transferido al dueño (${esc(String(r.transferido || '').slice(0, 10))})</span>` : ''}${r.firma_cliente ? `<span class="sub"><a href="${esc(urlContrato(cfg, r.id))}" target="_blank">Contrato</a>${r.firma_dueno ? ' · firmado' : ' · falta el dueño'}</span>` : ''}${['pagado', 'devuelto-parcial'].includes(r.pago) && !r.stripe_pi && !r.pagado_dueno ? `<form method="post" action="?estado=alquiler"><input type="hidden" name="accion" value="reserva-pagada-dueno"><input type="hidden" name="id" value="${Number(r.id)}"><button class="btn">Ya le pagamos al dueño</button></form>` : ''}</td></tr>`).join('')}</tbody>
</table></div></div>`;
}
export { perfilPublico };
