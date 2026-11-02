/* SIDONIA · Alquiler entre la comunidad, como Airbnb (sql/reservas.sql).
 * - El anuncio es el coche de «Mi coche en alquiler» (garaje, alquiler = true) con su alq: precio por día, fianza, km al
 *   día, quién conduce, ciudad, dónde se entrega (solo se ve al confirmar), normas, mínimo de días, reserva inmediata…
 *   y sus bloqueos (días que no lo alquila).
 * - Quien alquila elige fechas y manda una solicitud (o reserva al momento si el dueño tiene «reserva inmediata»).
 *   El dueño tiene 24 h para aceptar o rechazar; si no, caduca. Las aceptadas ocupan el calendario.
 * - Se hablan por mensajes dentro de Sidonia (con aviso por email). El teléfono, el email y dónde se entrega el coche
 *   solo se ven cuando la reserva está confirmada.
 * - Al acabar, cada uno deja su reseña: quien alquila, del coche y su dueño; el dueño, de quien lo alquiló.
 * - Sin cobros todavía: se enseña el precio y se paga al dueño en la entrega (la comisión de Sidonia está a 0).
 *
 * Público:  GET api/alquiler/coches?desde=&hasta=&ciudad=&conductor=   GET api/alquiler/coche?id=
 * Sesión:   POST api/alquiler/reservar   GET api/alquiler/reservas   POST api/alquiler/reserva { id, accion }
 *           GET/POST api/alquiler/mensajes   POST api/alquiler/resena { id, nota, texto }
 */
import { esc, perfilPublico, tablaAnuncios, urlFoto } from './circulo.mjs';
import { datos, enviarCorreo, P, plantilla } from './correos.mjs';
import { USOS } from './garaje.mjs';

export const PLAZO_H = 24;           // horas que tiene el dueño para responder
export const COMISION = 0;           // % de Sidonia (lanzamiento: 0)
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const clip = (t, n) => String(t ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
const tabla = (cfg, deps, n) => deps[n] || tablaAnuncios(cfg, deps.fetch, n);
const hoyISO = () => new Date(Date.now() + 3600e3).toISOString().slice(0, 10); // España, más o menos
export const diasEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;
const solapa = (a1, a2, b1, b2) => a1 <= b2 && b1 <= a2;
const titulo = (c) => [c.marca, c.modelo, c.anio].filter(Boolean).join(' ');
const fechaTxt = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' });
const CONDUCE = { con: 'Con su dueño al volante', sin: 'Sin conductor (lo conduces tú)', ambos: 'Con o sin conductor' };

/** El estado de verdad: las pendientes caducan a las 24 h y las aceptadas pasadas están completadas */
export function estadoActual(r, ahora = Date.now()) {
  if (r.estado === 'pendiente' && ahora - Date.parse(r.creado) > PLAZO_H * 3600e3) return 'caducada';
  if (r.estado === 'aceptada' && String(r.hasta) < new Date(ahora + 3600e3).toISOString().slice(0, 10)) return 'completada';
  return r.estado;
}
/** El precio, como en Airbnb: precio × días + comisión (0 por ahora) */
export function precio(alq, desde, hasta) {
  const dias = diasEntre(desde, hasta);
  const sub = (Number(alq.precio) || 0) * dias;
  const tarifa = Math.round((sub * COMISION) / 100);
  return { dias, precio_dia: Number(alq.precio) || 0, subtotal: sub, tarifa, total: sub + tarifa, fianza: Number(alq.fianza) || 0 };
}
const ocupadas = (rs) => rs.filter((r) => estadoActual(r) === 'aceptada').map((r) => [String(r.desde), String(r.hasta)]);
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
const anfitrion = (cfg, p) => (p ? { nombre: p.nombre || 'Anfitrión', foto: p.foto ? urlFoto(cfg, p.foto) : '', ciudad: p.ciudad || '', slug: p.slug || '', desde: p.creado || p.actualizado || '' } : { nombre: 'Anfitrión', foto: '', ciudad: '' });
const media = (l) => (l.length ? Math.round((l.reduce((s, x) => s + Number(x.nota), 0) / l.length) * 100) / 100 : 0);

/** La tarjeta de un anuncio */
function anuncio(cfg, c, p, resenas = [], liked = false) {
  const { entrega, ...alq } = c.alq || {};
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

/** Todas las rutas del alquiler tipo Airbnb (null si no es suya) */
export async function rutasReservas({ ruta, method, body }, cliente, cfg, deps) {
  const R = ['api/alquiler/coches', 'api/alquiler/coche', 'api/alquiler/reservar', 'api/alquiler/reservas', 'api/alquiler/reserva', 'api/alquiler/mensajes', 'api/alquiler/resena'];
  if (!R.includes(ruta)) return null;
  const json = (status, b, cache = 'no-store') => ({ status, headers: { 'Content-Type': 'application/json', 'Cache-Control': cache }, body: JSON.stringify(b) });
  const tG = tabla(cfg, deps, 'garaje'), tR = tabla(cfg, deps, 'reservas'), tM = tabla(cfg, deps, 'reservas_mensajes'), tS = tabla(cfg, deps, 'reservas_resenas');
  const falta = (e) => { console.error(e); return json(200, { ok: false, error: /reservas|alq|bloqueos|relation|does not exist|42P01|column/.test(String(e.message)) ? 'sin-tabla' : 'motor' }); };

  // ------------------------------------------------------------------ Buscar coches (como la portada de Airbnb)
  if (ruta === 'api/alquiler/coches' && method === 'GET') {
    try {
      const desde = DIA.test(body.desde) ? body.desde : '', hasta = DIA.test(body.hasta) ? body.hasta : desde;
      const ciudad = clip(body.ciudad, 60).toLowerCase(), conductor = ['con', 'sin'].includes(body.conductor) ? body.conductor : '';
      let coches = (await tG.leer('alquiler=eq.true&visible=eq.true&order=creado.desc&limit=200')).filter((c) => Number(c.alq?.precio) > 0);
      if (ciudad) coches = coches.filter((c) => String(c.alq?.ciudad || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(ciudad.normalize('NFD').replace(/[̀-ͯ]/g, '')));
      if (conductor) coches = coches.filter((c) => c.alq?.conductor === conductor || c.alq?.conductor === 'ambos');
      const ids = coches.map((c) => Number(c.id));
      const rs = ids.length ? await tR.leer(`coche_id=in.(${ids.join(',')})&estado=eq.aceptada&select=coche_id,desde,hasta,estado,creado`).catch(() => []) : [];
      if (desde) coches = coches.filter((c) => libre(c, rs.filter((r) => Number(r.coche_id) === Number(c.id)), desde, hasta) && diasEntre(desde, hasta) >= (Number(c.alq?.minimo) || 1));
      const res = ids.length ? await tS.leer(`coche_id=in.(${ids.join(',')})&rol=eq.huesped&select=coche_id,nota,rol`).catch(() => []) : [];
      const ps = await perfiles(cfg, deps, coches.map((c) => c.cliente));
      return json(200, { ok: true, coches: coches.map((c) => anuncio(cfg, c, ps[String(c.cliente)], res)), comision: COMISION }, cliente ? 'no-store' : 'public, max-age=30');
    } catch (e) { return falta(e); }
  }
  // ------------------------------------------------------------------ Un coche: ficha, calendario, reseñas y anfitrión
  if (ruta === 'api/alquiler/coche' && method === 'GET') {
    try {
      const [c] = await tG.leer(`id=eq.${Number(body.id)}&alquiler=eq.true&limit=1`);
      if (!c || c.visible === false) return json(404, { ok: false, error: 'no-existe' });
      const rs = await tR.leer(`coche_id=eq.${Number(c.id)}&select=desde,hasta,estado,creado`).catch(() => []);
      const res = await tS.leer(`coche_id=eq.${Number(c.id)}&order=creado.desc&limit=100`).catch(() => []);
      const ps = await perfiles(cfg, deps, [c.cliente]);
      const otros = (await tG.leer(`cliente=eq.${encodeURIComponent(c.cliente)}&alquiler=eq.true&visible=eq.true&select=id`).catch(() => [])).length;
      return json(200, { ok: true, coche: { ...anuncio(cfg, c, ps[String(c.cliente)], res), suyo: String(c.cliente) === String(cliente) },
        ocupado: [...(c.bloqueos || []), ...ocupadas(rs)], comision: COMISION, anfitrion_coches: otros,
        resenas: res.filter((r) => r.rol === 'huesped').map((r) => ({ nombre: r.nombre || 'Miembro de Sidonia', nota: r.nota, texto: r.texto, creado: r.creado })) }, cliente ? 'no-store' : 'public, max-age=30');
    } catch (e) { return falta(e); }
  }

  if (!cliente) return json(200, { ok: false, error: 'login' });

  // ------------------------------------------------------------------ Reservar (solicitud o reserva inmediata)
  if (ruta === 'api/alquiler/reservar' && method === 'POST') {
    const desde = String(body.desde || ''), hasta = String(body.hasta || body.desde || '');
    const q = { nombre: clip(body.nombre, 120), email: clip(body.email, 200).toLowerCase(), telefono: clip(body.telefono, 40), mensaje: clip(body.mensaje, 2000),
      para: USOS.includes(body.para) ? body.para : '', conductor: ['con', 'sin'].includes(body.conductor) ? body.conductor : '' };
    if (!DIA.test(desde) || !DIA.test(hasta) || hasta < desde) return json(400, { ok: false, error: 'fechas' });
    if (desde < hoyISO()) return json(400, { ok: false, error: 'pasado' });
    if (!q.nombre) return json(400, { ok: false, error: 'nombre' });
    if (!EMAIL.test(q.email)) return json(400, { ok: false, error: 'email' });
    if (q.mensaje.length < 10) return json(400, { ok: false, error: 'mensaje' });
    try {
      const [c] = await tG.leer(`id=eq.${Number(body.coche_id)}&alquiler=eq.true&limit=1`);
      if (!c || c.visible === false || !(Number(c.alq?.precio) > 0)) return json(404, { ok: false, error: 'no-existe' });
      if (String(c.cliente) === String(cliente)) return json(400, { ok: false, error: 'suyo' });
      const pr = precio(c.alq, desde, hasta);
      if (pr.dias < (Number(c.alq.minimo) || 1)) return json(400, { ok: false, error: 'minimo', minimo: Number(c.alq.minimo) });
      if (pr.dias > 60) return json(400, { ok: false, error: 'fechas' });
      const rs = await tR.leer(`coche_id=eq.${Number(c.id)}&select=desde,hasta,estado,creado`);
      if (!libre(c, rs, desde, hasta)) return json(200, { ok: false, error: 'ocupado' });
      const mias = await tR.leer(`cliente=eq.${encodeURIComponent(cliente)}&estado=eq.pendiente&select=id,creado`).catch(() => []);
      if (mias.filter((r) => estadoActual(r) === 'pendiente').length >= 5) return json(200, { ok: false, error: 'muchas' });
      const estado = c.alq.inmediata ? 'aceptada' : 'pendiente';
      const r = await tR.guardar({ coche_id: Number(c.id), dueno: String(c.cliente), cliente: String(cliente), desde, hasta, dias: pr.dias, precio_dia: pr.precio_dia, total: pr.total, estado,
        ...q, ...(estado === 'aceptada' ? { respondida: new Date().toISOString() } : {}) }, 'id');
      if (q.mensaje) await tM.guardar({ reserva_id: Number(r.id), de: String(cliente), texto: q.mensaje }, 'id').catch(() => null);
      // Emails: al dueño (solicitud o reserva hecha), a quien alquila (enviada o confirmada) y copia al equipo
      const d = await emailDueno(cfg, deps, c.cliente);
      const filas = [['Coche', titulo(c)], ['Fechas', `${fechaTxt(desde)} → ${fechaTxt(hasta)} (${pr.dias} ${pr.dias === 1 ? 'día' : 'días'})`], ['Total', `${pr.total} €`], ...(q.para ? [['Para', q.para]] : [])];
      const aDueno = { titulo: estado === 'aceptada' ? '¡Tienes una reserva!' : 'Te han pedido tu coche',
        previa: `${q.nombre} quiere tu ${titulo(c)}.`,
        cuerpo: P(`<b>${esc(q.nombre.split(' ')[0])}</b> ${estado === 'aceptada' ? 'ha reservado' : 'quiere alquilar'} tu <b>${esc(titulo(c))}</b>:`) + datos(filas) + P(esc(q.mensaje))
          + P(estado === 'aceptada' ? 'Tienes la reserva inmediata activada, así que ya está confirmada. Escríbele desde Sidonia para quedar.' : `Tienes <b>${PLAZO_H} horas</b> para aceptarla o rechazarla. Si no respondes, caduca.`),
        boton: estado === 'aceptada' ? 'Ver la reserva' : 'Responder a la solicitud', enlace: urlReservas(cfg) };
      await correo(cfg, d.email, estado === 'aceptada' ? `Reserva confirmada: tu ${titulo(c)}` : `Solicitud de reserva: tu ${titulo(c)}`, aDueno, deps);
      await correo(cfg, q.email, estado === 'aceptada' ? `Reserva confirmada: ${titulo(c)}` : `Solicitud enviada: ${titulo(c)}`, {
        titulo: estado === 'aceptada' ? '¡Reserva confirmada!' : 'Solicitud enviada', previa: `${titulo(c)}, del ${fechaTxt(desde)} al ${fechaTxt(hasta)}.`,
        cuerpo: P(estado === 'aceptada' ? 'Tu reserva está confirmada. En Sidonia tienes ya el contacto del dueño y dónde se entrega el coche.' : `El dueño tiene ${PLAZO_H} horas para responder. No se te cobra nada: el pago se acuerda con el dueño.`) + datos(filas),
        boton: 'Ver mi reserva', enlace: urlReservas(cfg) }, deps);
      for (const e of cfg.avisosEquipo || []) await correo(cfg, e, `[Alquiler] ${estado === 'aceptada' ? 'Reserva' : 'Solicitud'}: ${titulo(c)} · ${q.nombre}`, aDueno, deps, q.email);
      return json(200, { ok: true, reserva: { id: r.id, estado, ...pr } });
    } catch (e) { return falta(e); }
  }

  // ------------------------------------------------------------------ Mis reservas: como quien alquila (viajes) y como dueño (solicitudes)
  if (ruta === 'api/alquiler/reservas' && method === 'GET') {
    try {
      const yo = encodeURIComponent(cliente);
      const [comoCliente, comoDueno] = await Promise.all([tR.leer(`cliente=eq.${yo}&order=creado.desc&limit=100`), tR.leer(`dueno=eq.${yo}&order=creado.desc&limit=200`)]);
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
        const confirmada = estado === 'aceptada' || estado === 'completada';
        let otro;
        if (rol === 'cliente') {
          if (confirmada && !contactos[r.dueno]) contactos[r.dueno] = await emailDueno(cfg, deps, r.dueno);
          otro = { nombre: ps[String(r.dueno)]?.nombre || 'Anfitrión', ...(confirmada ? { email: contactos[r.dueno].email, telefono: contactos[r.dueno].telefono } : {}) };
        } else otro = { nombre: r.nombre || ps[String(r.cliente)]?.nombre || 'Cliente', ...(confirmada ? { email: r.email, telefono: r.telefono } : {}) };
        return { id: r.id, rol, estado, desde: r.desde, hasta: r.hasta, dias: r.dias, precio_dia: r.precio_dia, total: r.total, para: r.para, creado: r.creado,
          caduca: estado === 'pendiente' ? new Date(Date.parse(r.creado) + PLAZO_H * 3600e3).toISOString() : null,
          coche: { id: c.id, titulo: titulo(c), foto: (c.fotos || [])[0] ? urlFoto(cfg, c.fotos[0]) : '', ciudad: c.alq?.ciudad || '', ...(confirmada ? { entrega: c.alq?.entrega || '' } : {}) },
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
      await tR.cambiar(r.id, { estado: nuevo, respondida: new Date().toISOString() });
      const t = titulo(c || {});
      const TXT = { aceptada: ['¡Reserva confirmada!', `El dueño ha aceptado tu reserva del ${t}. Ya tienes su contacto y dónde se entrega el coche en Sidonia.`],
        rechazada: ['Solicitud no aceptada', `El dueño no puede alquilarte el ${t} esas fechas. Mira otros coches en Sidonia: seguro que hay uno para ti.`],
        cancelada: ['Reserva cancelada', `La reserva del ${t} (${fechaTxt(r.desde)} → ${fechaTxt(r.hasta)}) se ha cancelado.`] };
      const [tt, cuerpo] = TXT[nuevo];
      const d = await emailDueno(cfg, deps, r.dueno);
      const para = rol === 'dueno' ? r.email : d.email;
      await correo(cfg, para, `${tt}: ${t}`, { titulo: tt, previa: cuerpo, cuerpo: P(cuerpo), boton: 'Ver en Sidonia', enlace: urlReservas(cfg) }, deps);
      for (const e of cfg.avisosEquipo || []) await correo(cfg, e, `[Alquiler] ${tt}: ${t}`, { titulo: tt, previa: cuerpo, cuerpo: P(cuerpo), boton: 'Panel', enlace: `${cfg.servidor}/admin?estado=alquiler` }, deps);
      return json(200, { ok: true, estado: nuevo });
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
      if (estadoActual(s.r) !== 'completada') return json(400, { ok: false, error: 'estado' });
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

/* ---------------------------------------------------------------------------- Panel › Clientes › Alquiler: reservas */
export function tablaReservasPanel(reservas, coches = []) {
  if (!reservas.length) return '';
  const deC = Object.fromEntries(coches.map((c) => [Number(c.id), c]));
  const EST = { pendiente: 'Pendiente', aceptada: 'Confirmada', rechazada: 'Rechazada', cancelada: 'Cancelada', caducada: 'Caducada', completada: 'Completada' };
  return `<h2 style="margin:22px 0 8px">Reservas</h2><div class="card"><div class="tabla"><table>
  <thead><tr><th class="izq">Coche</th><th class="izq">Fechas</th><th>Total</th><th class="izq">Quien alquila</th><th class="izq">Estado</th></tr></thead>
  <tbody>${reservas.map((r) => `<tr><td class="izq"><b>${esc(titulo(deC[Number(r.coche_id)] || {}) || `#${Number(r.coche_id)}`)}</b></td>
    <td class="izq">${esc(String(r.desde))} → ${esc(String(r.hasta))}<span class="sub">${Number(r.dias)} días</span></td><td>${Number(r.total)} €</td>
    <td class="izq">${esc(r.nombre)}<span class="sub">${esc(r.email)}${r.telefono ? ` · ${esc(r.telefono)}` : ''}</span></td><td class="izq">${EST[estadoActual(r)] || esc(r.estado)}</td></tr>`).join('')}</tbody>
</table></div></div>`;
}
export { perfilPublico };
