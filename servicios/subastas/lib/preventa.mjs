/* SIDONIA · Reservas sin cobro (preventa) de productos que se piden a fábrica según la demanda: la SIDONIA RD10.
 *
 * Quien reserva deja su nombre, email y teléfono y guarda su tarjeta en Stripe (Checkout en modo «setup»): NO se le
 * cobra nada. Si se hace el pedido a fábrica, se le cobra cuando su producto sale hacia su casa. Puede cancelar cuando
 * quiera con el enlace de su email. El contador de reservas sale en la web y la lista en el panel › Herramientas.
 * Tabla: sql/preventa.sql.
 *
 *   GET  api/preventa/contador?p=rd10   → { ok, reservas, personas }
 *   POST api/preventa/reservar { producto, nombre, email, telefono, cantidad, precio, acepto, volver } → { ok, url } (a Stripe)
 *   GET  preventa/vuelta?r=&f=&session_id=   → marca la reserva con su tarjeta, manda el email y vuelve a la web
 *   GET  preventa/cancelar?r=&f=            → cancela la reserva (enlace del email)
 *   GET  preventa/condiciones               → las condiciones de la reserva (enlazadas desde la web)
 *   GET  preventa/pagar?r=&f=               → si el cobro automático falló: pagar con Stripe (enlace del email)
 *   GET  preventa/pagado?r=&f=&session_id=  → vuelta de ese pago
 * Panel › Herramientas › Reservas RD10: «Ya la hemos pedido» (email a todas las reservas) y «Cobrar» (con la tarjeta
 * guardada, sin que la persona tenga que hacer nada; si su banco pide confirmarlo, le llega el enlace para pagar).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { tablaAnuncios, esc } from './circulo.mjs';
import { enviarCorreo, plantilla, P, datos, lista } from './correos.mjs';
import { paginaDocumento, sidonia } from './contratos.mjs';

export const PRODUCTOS = { rd10: { nombre: 'SIDONIA RD10', max: 3 } };

const tabla = (cfg, deps) => deps.preventas || tablaAnuncios(cfg, deps.fetch, 'preventas');
const clip = (t, n) => String(t ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const eur = (n) => `${Number(n).toLocaleString('es-ES', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 })} €`;
const firma = (clave, id) => createHmac('sha256', clave).update(`preventa|${id}`).digest('hex').slice(0, 32);
const firmaOk = (clave, id, f) => {
  if (!clave || !id || typeof f !== 'string' || f.length !== 32) return false;
  const a = Buffer.from(firma(clave, id)), b = Buffer.from(f);
  return a.length === b.length && timingSafeEqual(a, b);
};
const stripeDe = async (cfg, deps) => deps.stripe || (await import('./motor.mjs')).stripe(cfg, deps.fetch);
// Solo se vuelve a la tienda (nunca a otro sitio)
const volverA = (cfg, v) => {
  const t = cfg.tienda || 'https://sidonia.es';
  try { const u = new URL(String(v || ''), t); return u.origin === new URL(t).origin ? u.toString() : t; } catch { return t; }
};
const conParam = (url, k, v) => { const u = new URL(url); u.searchParams.set(k, v); return u.toString(); };

/** Valida lo que manda el formulario de la web */
export function leerReserva(b = {}) {
  const producto = String(b.producto || '').toLowerCase();
  if (!PRODUCTOS[producto]) return { ok: false, error: 'producto' };
  const r = {
    producto, nombre: clip(b.nombre, 120), email: clip(b.email, 160).toLowerCase(), telefono: clip(b.telefono, 30),
    cantidad: Math.round(Number(b.cantidad) || 1), precio: Math.round((Number(b.precio) || 0) * 100) / 100
  };
  if (r.nombre.length < 2) return { ok: false, error: 'nombre' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(r.email)) return { ok: false, error: 'email' };
  if (r.telefono && !/^\+?[\d\s]{9,15}$/.test(r.telefono)) return { ok: false, error: 'telefono' };
  if (r.cantidad < 1 || r.cantidad > PRODUCTOS[producto].max) return { ok: false, error: 'cantidad' };
  if (!(r.precio > 0 && r.precio < 10000)) return { ok: false, error: 'precio' };
  if (!b.acepto) return { ok: false, error: 'acepto' };
  return { ok: true, reserva: r };
}

export function correoReserva(cfg, r, cancelar) {
  const p = PRODUCTOS[r.producto];
  return {
    asunto: `Tienes reservada tu ${p.nombre}`,
    html: plantilla(cfg, null, {
      titulo: 'Reserva hecha', previa: 'No te hemos cobrado nada. Te avisamos antes de enviártela.',
      cuerpo: P(`Hola ${esc(r.nombre.split(/\s+/)[0])}:`)
        + P(`Gracias por reservar la <b>${esc(p.nombre)}</b>. No te hemos cobrado nada: solo has guardado tu tarjeta.`)
        + datos([['Producto', p.nombre], ['Unidades', String(r.cantidad)], ['Precio', `${eur(r.precio)} cada una, envío incluido`], ['Total', eur(r.precio * r.cantidad)], ...(r.tarjeta ? [['Tarjeta', r.tarjeta]] : [])])
        + lista([
          ['La pedimos a fábrica', 'Las radios se fabrican por encargo: según las reservas, decidimos cuántas pedimos.'],
          ['Te avisamos', 'Cuando hagamos el pedido te escribimos con la fecha estimada de entrega.'],
          ['Se cobra al enviarla', 'Solo te cobramos cuando tu radio sale hacia tu casa. Antes, nada.'],
          ['Cancela cuando quieras', 'Hasta que la enviemos, puedes cancelar la reserva sin coste con el botón de abajo.']
        ]),
      boton: 'Cancelar mi reserva', enlace: cancelar
    })
  };
}

export async function contarReservas(cfg, deps, producto) {
  const filas = await tabla(cfg, deps).leer(`producto=eq.${encodeURIComponent(producto)}&estado=eq.reservada&select=cantidad`);
  return { reservas: filas.reduce((s, f) => s + (Number(f.cantidad) || 1), 0), personas: filas.length };
}

const paginaSimple = (cfg, titulo, texto) => ({
  status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  body: `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(titulo)}</title></head>
<body style="margin:0;font-family:system-ui,sans-serif;background:#f4f4f2;color:#111"><main style="max-width:520px;margin:12vh auto;padding:28px;background:#fff;border-radius:18px">
<h1 style="margin:0 0 12px;font-size:24px">${esc(titulo)}</h1><p style="line-height:1.6;color:#444">${texto}</p>
<p><a href="${esc(cfg.tienda || 'https://sidonia.es')}" style="color:#111;font-weight:700">Volver a Sidonia</a></p></main></body></html>`
});

export async function rutasPreventa({ ruta, method, query = {}, body = {} }, cfg, deps) {
  const json = (status, b) => ({ status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(b) });
  const redirect = (url) => ({ status: 303, headers: { Location: url, 'Cache-Control': 'no-store' }, body: '' });
  const t = tabla(cfg, deps);
  try {
    if (ruta === 'api/preventa/contador') {
      const p = String(query.p || 'rd10').toLowerCase();
      if (!PRODUCTOS[p]) return json(400, { ok: false, error: 'producto' });
      return json(200, { ok: true, ...(await contarReservas(cfg, deps, p)) });
    }

    if (ruta === 'api/preventa/reservar' && method === 'POST') {
      const v = leerReserva(body);
      if (!v.ok) return json(400, v);
      if (!cfg.stripeKey) return json(200, { ok: false, error: 'sin-stripe' });
      const r = v.reserva;
      const volver = volverA(cfg, body.volver);
      // Una reserva activa por email y producto (para cambiar las unidades: cancelar y volver a reservar)
      const previas = await t.leer(`email=eq.${encodeURIComponent(r.email)}&producto=eq.${r.producto}&estado=eq.reservada&select=id`);
      if (previas.length) return json(200, { ok: false, error: 'ya' });
      const fila = await t.guardar({ ...r, estado: 'pendiente', token: randomBytes(12).toString('hex'), volver, creado: new Date().toISOString() }, 'token');
      const st = await stripeDe(cfg, deps);
      const c = await st('POST', 'customers', { email: r.email, name: r.nombre, ...(r.telefono ? { phone: r.telefono } : {}), metadata: { sidonia: 'preventa', producto: r.producto, reserva: String(fila.id) } });
      const f = firma(cfg.clave, fila.id);
      const s = await st('POST', 'checkout/sessions', {
        mode: 'setup', customer: c.id, currency: 'eur', locale: 'es', 'payment_method_types[0]': 'card',
        success_url: `${cfg.servidor}/tienda/preventa/vuelta?r=${fila.id}&f=${f}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: volver,
        'custom_text[submit][message]': `Reserva de ${PRODUCTOS[r.producto].nombre}: no se cobra nada ahora. Se cobrarán ${eur(r.precio * r.cantidad)} cuando tu pedido salga hacia tu casa. Puedes cancelar antes, sin coste.`,
        metadata: { sidonia: 'preventa', reserva: String(fila.id) },
        'setup_intent_data[metadata][reserva]': String(fila.id)
      });
      await t.cambiar(fila.id, { stripe_cliente: c.id });
      return json(200, { ok: true, url: s.url });
    }

    if (ruta === 'preventa/vuelta') {
      const id = Number(query.r);
      if (!firmaOk(cfg.clave, id, query.f)) return paginaSimple(cfg, 'Enlace no válido', 'Este enlace no es correcto. Si acabas de reservar, revisa tu email.');
      const [fila] = await t.leer(`id=eq.${id}&limit=1`);
      if (!fila) return paginaSimple(cfg, 'No encontramos la reserva', 'Escríbenos y lo miramos.');
      if (fila.estado === 'reservada') return redirect(conParam(fila.volver || cfg.tienda, 'reservada', '1'));
      const st = await stripeDe(cfg, deps);
      const sid = String(query.session_id || '');
      if (!/^cs_[A-Za-z0-9_]+$/.test(sid)) return redirect(fila.volver || cfg.tienda);
      const s = await st('GET', `checkout/sessions/${sid}?expand[]=setup_intent.payment_method`);
      if (s.status !== 'complete' || String(s.metadata?.reserva) !== String(id)) return redirect(fila.volver || cfg.tienda);
      const pm = s.setup_intent?.payment_method;
      const card = pm?.card;
      const tarjeta = card ? `${card.brand.charAt(0).toUpperCase()}${card.brand.slice(1)} •••• ${card.last4}` : 'Tarjeta guardada';
      await t.cambiar(id, { estado: 'reservada', metodo_pago: pm?.id || null, tarjeta, reservado: new Date().toISOString() });
      const cancelar = `${cfg.servidor}/tienda/preventa/cancelar?r=${id}&f=${firma(cfg.clave, id)}`;
      const m = correoReserva(cfg, { ...fila, tarjeta }, cancelar);
      await enviarCorreo(cfg, fila.email, m.asunto, m.html, deps.fetch || fetch).catch((e) => console.error(e));
      for (const e of cfg.avisosEquipo || []) {
        await enviarCorreo(cfg, e, `[Reserva] ${PRODUCTOS[fila.producto].nombre} · ${fila.cantidad} · ${fila.nombre}`, m.html, deps.fetch || fetch).catch(() => {});
      }
      return redirect(conParam(fila.volver || cfg.tienda, 'reservada', '1'));
    }

    if (ruta === 'preventa/cancelar') {
      const id = Number(query.r);
      if (!firmaOk(cfg.clave, id, query.f)) return paginaSimple(cfg, 'Enlace no válido', 'Este enlace no es correcto.');
      const [fila] = await t.leer(`id=eq.${id}&limit=1`);
      if (!fila) return paginaSimple(cfg, 'No encontramos la reserva', 'Escríbenos y lo miramos.');
      if (fila.estado === 'cobrada') return paginaSimple(cfg, 'Ya está enviada', 'Esta reserva ya se ha cobrado y enviado. Si quieres devolverla, tienes 14 días: escríbenos.');
      if (fila.estado !== 'cancelada') await t.cambiar(id, { estado: 'cancelada', cancelado: new Date().toISOString() });
      return paginaSimple(cfg, 'Reserva cancelada', `Hemos cancelado tu reserva de la ${esc(PRODUCTOS[fila.producto]?.nombre || 'radio')}. No se te ha cobrado nada.`);
    }
    if (ruta === 'preventa/condiciones') {
      return { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=600' }, body: paginaDocumento('Condiciones de la reserva', condicionesPreventa(cfg)) };
    }

    if (ruta === 'preventa/pagar' || ruta === 'preventa/pagado') {
      const id = Number(query.r);
      if (!firmaOk(cfg.clave, id, query.f)) return paginaSimple(cfg, 'Enlace no válido', 'Este enlace no es correcto.');
      const [fila] = await t.leer(`id=eq.${id}&limit=1`);
      if (!fila) return paginaSimple(cfg, 'No encontramos la reserva', 'Escríbenos y lo miramos.');
      if (fila.estado === 'cobrada') return paginaSimple(cfg, 'Ya está pagada', 'Tu SIDONIA RD10 ya está pagada. ¡Gracias!');
      if (fila.estado === 'cancelada') return paginaSimple(cfg, 'Reserva cancelada', 'Esta reserva está cancelada. Si quieres la radio, escríbenos.');
      const st = await stripeDe(cfg, deps);
      if (ruta === 'preventa/pagar') {
        const f = firma(cfg.clave, id);
        const s2 = await st('POST', 'checkout/sessions', {
          mode: 'payment', ...(fila.stripe_cliente ? { customer: fila.stripe_cliente } : { customer_email: fila.email }), locale: 'es', 'payment_method_types[0]': 'card',
          'line_items[0][quantity]': String(fila.cantidad || 1),
          'line_items[0][price_data][currency]': 'eur',
          'line_items[0][price_data][unit_amount]': String(Math.round(Number(fila.precio) * 100)),
          'line_items[0][price_data][product_data][name]': PRODUCTOS[fila.producto]?.nombre || 'SIDONIA RD10',
          success_url: `${cfg.servidor}/tienda/preventa/pagado?r=${id}&f=${f}&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: cfg.tienda || 'https://sidonia.es',
          metadata: { sidonia: 'preventa', reserva: String(id) }
        });
        return redirect(s2.url);
      }
      const sid = String(query.session_id || '');
      if (!/^cs_[A-Za-z0-9_]+$/.test(sid)) return paginaSimple(cfg, 'Falta el pago', 'No hemos recibido el pago. Prueba otra vez con el enlace de tu email.');
      const s3 = await st('GET', `checkout/sessions/${sid}`);
      if (s3.payment_status !== 'paid' || String(s3.metadata?.reserva) !== String(id)) return paginaSimple(cfg, 'Falta el pago', 'No hemos recibido el pago. Prueba otra vez con el enlace de tu email.');
      await t.cambiar(id, { estado: 'cobrada', pago_id: s3.payment_intent || sid, cobrado: new Date().toISOString(), error: null });
      const m = correoCobrada(cfg, fila);
      await enviarCorreo(cfg, fila.email, m.asunto, m.html, deps.fetch || fetch).catch(() => {});
      return paginaSimple(cfg, '¡Pagada!', `Tu ${esc(PRODUCTOS[fila.producto]?.nombre || 'radio')} está pagada. Te escribimos cuando salga hacia tu casa.`);
    }
    return null;
  } catch (e) {
    console.error('Sidonia · preventa', e);
    return json(200, { ok: false, error: /preventas|relation|column/.test(String(e.message)) ? 'sin-tabla' : 'motor' });
  }
}

/** Panel › Herramientas › Reservas: el contador, los botones «Ya la hemos pedido» y «Cobrar», y la lista */
export function paginaPreventas(cfg, filas = [], { vistas = null } = {}) {
  const res = filas.filter((f) => f.estado === 'reservada');
  const uds = res.reduce((s, f) => s + (Number(f.cantidad) || 1), 0);
  const ingresos = res.reduce((s, f) => s + (Number(f.cantidad) || 1) * (Number(f.precio) || 0), 0);
  const cobradas = filas.filter((f) => f.estado === 'cobrada');
  const fallidas = filas.filter((f) => f.estado === 'fallida');
  const sinAviso = res.filter((f) => !f.avisado).length;
  const est = { reservada: 'Reservada', pendiente: 'Sin terminar (no guardó la tarjeta)', cancelada: 'Cancelada', cobrada: 'Cobrada', fallida: 'Cobro fallido: tiene el enlace para pagar' };
  const tr = filas.map((f) => `<tr><td>${esc(new Date(f.creado).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }))}</td><td>${esc(f.nombre)}<br><small>${esc(f.email)}${f.telefono ? ` · ${esc(f.telefono)}` : ''}</small></td><td>${Number(f.cantidad) || 1}</td><td>${esc(eur(f.precio || 0))}</td><td>${esc(est[f.estado] || f.estado)}${f.tarjeta ? `<br><small>${esc(f.tarjeta)}</small>` : ''}${f.avisado && f.estado === 'reservada' ? '<br><small>Avisada del pedido</small>' : ''}${f.error ? `<br><small>${esc(f.error)}</small>` : ''}</td></tr>`).join('');
  const acciones = res.length ? `<form method="post" class="acc" style="margin:14px 0">
  <b>1 · Ya la hemos pedido a fábrica</b>
  <p class="nota">Manda un email a quienes tienen la radio reservada y aún no lo han recibido (${sinAviso}): que ya está pedida, la fecha estimada y el botón para cancelar. No se cobra nada.</p>
  <input name="entrega" required maxlength="80" placeholder="Entrega estimada, p. ej. «mediados de enero»" style="min-width:280px">
  <button name="accion" value="avisar" class="si">Mandar el email</button>
</form>
<form method="post" class="acc" style="margin:14px 0">
  <b>2 · Cobrar (cuando las radios estén aquí para enviarlas)</b>
  <p class="nota">Cobra con la tarjeta guardada de cada reserva y le manda un email. Si un banco pide confirmarlo, a esa persona le llega un enlace para pagar. Va de 25 en 25: si hay más, pulsa otra vez.</p>
  <label class="avisar"><input type="checkbox" name="confirmo" value="${res.length}" required> Sí, cobrar ahora ${res.length} ${res.length === 1 ? 'reserva' : 'reservas'} (${esc(eur(ingresos))})</label>
  <button name="accion" value="cobrar" class="no">Cobrar</button>
</form>` : '';
  return `<h2 style="margin:0 0 6px">SIDONIA RD10 · reservas</h2>
<p class="res"><b style="font-size:28px">${uds}</b> radios reservadas por ${res.length} ${res.length === 1 ? 'persona' : 'personas'} · si se cobran todas, ${esc(eur(ingresos))} (IVA incluido)</p>
${vistas != null ? `<p class="nota"><b>${vistas.vistas.toLocaleString('es-ES')}</b> visitas a la página de la RD10 de <b>${vistas.personas.toLocaleString('es-ES')}</b> personas${vistas.personas ? ` · reserva el ${(res.length / vistas.personas * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %` : ''} (desde que se cuentan)</p>` : ''}
${cobradas.length || fallidas.length ? `<p class="nota">${cobradas.length} cobradas · ${fallidas.length} con el cobro pendiente (tienen el enlace para pagar)</p>` : ''}
<p class="nota">Las reservas no se cobran: guardan la tarjeta y se cobra al enviar. «Sin terminar» son quienes empezaron y no guardaron la tarjeta. Para decidir el pedido de 500 nos fijamos en unas 150 reservas. <a href="${esc(cfg.servidor || '')}/tienda/preventa/condiciones" target="_blank">Condiciones de la reserva</a></p>
${acciones}
<div style="overflow-x:auto"><table><thead><tr><th>Cuándo</th><th>Quién</th><th>Uds.</th><th>Precio</th><th>Estado</th></tr></thead><tbody>${tr || '<tr><td colspan="5" class="vacio">Aún no hay reservas.</td></tr>'}</tbody></table></div>`;
}

/** Visitas a la página del producto (tabla eventos de las estadísticas: «vista» con su handle) */
export async function contarVistas(cfg, deps, handle) {
  const t = tablaAnuncios(cfg, deps.fetch, 'eventos');
  const filas = [];
  for (let pag = 0; pag < 30; pag += 1) { // Supabase da como mucho 1000 filas por llamada
    const trozo = await t.leer(`select=sesion&tipo=eq.vista&handle=eq.${encodeURIComponent(handle)}&order=id.asc&limit=1000&offset=${pag * 1000}`);
    filas.push(...trozo);
    if (trozo.length < 1000) break;
  }
  return { vistas: filas.length, personas: new Set(filas.map((f) => f.sesion || Math.random())).size };
}

/** Botones del panel. Devuelve el aviso a mostrar. */
export async function accionPanelPreventas(body = {}, cfg, deps, producto = 'rd10') {
  if (body.accion === 'avisar') {
    const entrega = clip(body.entrega, 80);
    if (!entrega) return 'Escribe la fecha estimada de entrega.';
    const r = await avisarPedido(cfg, deps, producto, entrega);
    return `Listo: ${r.avisadas} emails mandados.${r.faltan > 0 ? ` Faltan ${r.faltan}: pulsa otra vez.` : ''}`;
  }
  if (body.accion === 'cobrar') {
    const filas = await tabla(cfg, deps).leer(`producto=eq.${encodeURIComponent(producto)}&estado=eq.reservada&select=*&order=creado.asc`);
    if (String(body.confirmo) !== String(filas.length)) return 'No se ha cobrado nada: la lista ha cambiado. Revísala y vuelve a confirmar.';
    let ok = 0, mal = 0;
    for (const r of filas.slice(0, 25)) { const x = await cobrarReserva(cfg, deps, r); if (x.ok) ok += 1; else mal += 1; }
    const faltan = Math.max(0, filas.length - 25);
    return `Cobradas ${ok}.${mal ? ` ${mal} no se han podido cobrar: les ha llegado el enlace para pagar.` : ''}${faltan ? ` Faltan ${faltan}: confirma y pulsa otra vez.` : ''}`;
  }
  return '';
}

/* ---------------------------------------------------------------------------- Condiciones */
export function condicionesPreventa(cfg = {}) {
  const sd = sidonia(cfg);
  const dato = (v) => (v ? esc(v) : '<span class="hueco">pendiente</span>');
  return `<h1>Condiciones de la reserva</h1>
<p class="meta">SIDONIA RD10 · Versión 2026-11-12</p>
<h2>1. Quién vende</h2>
<p>${dato(sd.razon)} · NIF ${dato(sd.nif)} · ${dato(sd.domicilio)} · <a href="mailto:${esc(sd.email)}">${esc(sd.email)}</a> · ${esc(sd.web)}</p>
<h2>2. Qué es una reserva</h2>
<p>Reservar no es comprar todavía. Dejas tu nombre y tu email y guardas tu tarjeta con Stripe, nuestro proveedor de pagos. <b>Al reservar no se cobra nada.</b> Sidonia no ve ni guarda el número de tu tarjeta.</p>
<h2>3. Fabricación por encargo</h2>
<p>La SIDONIA RD10 se fabrica por encargo. Según las reservas, decidimos cuántas unidades pedimos a fábrica. Cuando hagamos el pedido te escribiremos con la fecha estimada de entrega. Si al final no se hace el pedido, te avisaremos, cancelaremos tu reserva y no se te cobrará nada.</p>
<h2>4. Precio</h2>
<p>Se te cobra el precio que aceptaste al reservar, por cada unidad reservada, con el IVA y el envío a la península incluidos. Si después sube el precio, a ti se te respeta el de tu reserva. Si baja antes de cobrarte, te cobramos el precio más bajo. Por ahora solo enviamos a la península; para Baleares, Canarias, Ceuta, Melilla o fuera de España, escríbenos antes de reservar.</p>
<h2>5. Cuándo se cobra</h2>
<p>Al reservar aceptas que, cuando tu radio esté lista para enviarse, se cobre el total en la tarjeta que guardaste, sin que tengas que hacer nada. Si el cobro no se puede hacer (por ejemplo, porque tu banco pide confirmarlo o la tarjeta ha caducado), te mandamos un enlace para pagar. Si no se paga en 7 días desde ese aviso, la reserva se cancela.</p>
<h2>6. Entrega</h2>
<p>Cuando hagamos el pedido a fábrica te diremos por email la fecha estimada de entrega. Si cuando te cobramos no podemos entregártela en 30 días, o si se retrasa más de lo que te dijimos, puedes cancelar y te devolvemos todo lo pagado enseguida, sin coste. El riesgo de la radio es nuestro hasta que la recibes.</p>
<h2>6 bis. Cancelar la reserva</h2>
<p>Puedes cancelarla cuando quieras antes de que se cobre, sin ningún coste, con el botón del email de tu reserva o escribiéndonos.</p>
<h2>7. Desistimiento y devolución</h2>
<p>Una vez recibida, tienes 14 días naturales para devolverla sin dar explicaciones, como marca la ley. Basta con decírnoslo por email a ${esc(sd.email)} (puedes usar, si quieres, este modelo: «Por la presente le comunico que desisto de mi contrato de venta de la SIDONIA RD10, pedida el …, recibida el …. Nombre, domicilio, firma y fecha»). Después envíala en los 14 días siguientes, con todos sus accesorios. El envío de la devolución lo pagas tú, salvo que la radio llegue con un defecto o no sea la que pediste. Te devolveremos todo lo que pagaste, incluido el envío, en un máximo de 14 días desde que nos comuniques que la devuelves, con el mismo medio de pago; podemos esperar a recibirla para hacerlo. Solo respondes de la pérdida de valor si la has usado más de lo necesario para probarla.</p>
<h2>8. Garantía</h2>
<p>La radio tiene la garantía legal de 3 años por falta de conformidad, de la que respondemos nosotros como vendedores. Si falla, escríbenos y lo solucionamos sin coste para ti: reparación o cambio y, si no es posible, rebaja del precio o devolución del dinero. La garantía no cubre los daños por una instalación mal hecha, golpes, agua o manipulaciones; te recomendamos que la instale un profesional.</p>
<h2>9. Compatibilidad</h2>
<p>La SIDONIA RD10 es una radio de tamaño 1 DIN. Comprueba que tu coche tiene hueco 1 DIN, o escríbenos antes de reservar. Algunos coches necesitan un marco o un cableado adaptador, que no se incluyen salvo que se indique.</p>
<h2>9 bis. Seguridad y reciclaje</h2>
<p>Responsable del producto en la Unión Europea: ${dato(sd.razon)}, ${dato(sd.domicilio)}, ${esc(sd.email)}. La radio lleva el marcado CE e instrucciones y advertencias en español. Es un aparato eléctrico: al final de su vida, llévala a un punto limpio o entrégala en la tienda al comprar otra parecida. Apple y CarPlay son marcas de Apple Inc.</p>
<h2>10. Tus datos</h2>
<p>Usamos tu nombre, tu email y, si nos lo das, tu teléfono solo para gestionar tu reserva, el cobro, el envío y la garantía. Stripe trata los datos de tu tarjeta según su propia política de privacidad. Puedes pedirnos ver, corregir o borrar tus datos escribiendo a ${esc(sd.email)}.</p>
<h2>11. Ley y contacto</h2>
<p>Se aplica la ley española de consumo. Para cualquier duda o reclamación, escríbenos a ${esc(sd.email)}. Si eres consumidor, son competentes los juzgados de tu domicilio y puedes acudir a los servicios de consumo de tu comunidad autónoma; tienes hojas de reclamaciones a tu disposición.</p>`;
}

/* ---------------------------------------------------------------------------- «Ya la hemos pedido» y cobrar */
export function correoPedido(cfg, r, entrega, cancelar) {
  const p = PRODUCTOS[r.producto];
  return {
    asunto: `Ya hemos pedido tu ${p.nombre}`,
    html: plantilla(cfg, null, {
      titulo: 'Ya está pedida', previa: `Entrega estimada: ${entrega}.`,
      cuerpo: P(`Hola ${esc(String(r.nombre || '').split(/\s+/)[0])}:`)
        + P(`Buenas noticias: hemos hecho el pedido a fábrica y tu <b>${esc(p.nombre)}</b> está en camino.`)
        + datos([['Entrega estimada', entrega], ['Unidades', String(r.cantidad)], ['Total', `${eur((Number(r.precio) || 0) * (Number(r.cantidad) || 1))} (se cobra al enviarla)`]])
        + P('Todavía no te hemos cobrado nada. Lo haremos cuando tu radio salga hacia tu casa, y te avisaremos.')
        + P('Si has cambiado de idea, aún puedes cancelar sin coste con el botón de abajo.'),
      boton: 'Cancelar mi reserva', enlace: cancelar
    })
  };
}
export function correoCobrada(cfg, r) {
  const p = PRODUCTOS[r.producto];
  return {
    asunto: `Tu ${p.nombre} sale hacia tu casa`,
    html: plantilla(cfg, null, {
      titulo: '¡Ya va de camino!', previa: 'Hemos cobrado tu reserva y la preparamos para enviarla.',
      cuerpo: P(`Hola ${esc(String(r.nombre || '').split(/\s+/)[0])}:`)
        + P(`Hemos cobrado tu reserva de la <b>${esc(p.nombre)}</b> y la preparamos para enviártela.`)
        + datos([['Unidades', String(r.cantidad)], ['Total cobrado', eur((Number(r.precio) || 0) * (Number(r.cantidad) || 1))], ...(r.tarjeta ? [['Tarjeta', r.tarjeta]] : [])])
        + P('Tienes 14 días desde que la recibas para devolverla si no te convence, y 3 años de garantía. Cualquier cosa, responde a este email.'),
      boton: 'Ver la SIDONIA RD10', enlace: `${cfg.tienda || 'https://sidonia.es'}/pages/sidonia-rd10`
    })
  };
}
export function correoPagoPendiente(cfg, r, pagar) {
  const p = PRODUCTOS[r.producto];
  return {
    asunto: `Falta el pago de tu ${p.nombre}`,
    html: plantilla(cfg, null, {
      titulo: 'Falta un paso', previa: 'No hemos podido cobrar con tu tarjeta guardada. Paga con el enlace.',
      cuerpo: P(`Hola ${esc(String(r.nombre || '').split(/\s+/)[0])}:`)
        + P(`Tu <b>${esc(p.nombre)}</b> está lista para enviarse, pero no hemos podido cobrarla con la tarjeta que guardaste (puede que tu banco pida confirmarlo o que la tarjeta haya caducado).`)
        + datos([['Total', eur((Number(r.precio) || 0) * (Number(r.cantidad) || 1))]])
        + P('Paga con el botón de abajo y te la enviamos. Si no se paga en 7 días, la reserva se cancelará.'),
      boton: 'Pagar mi radio', enlace: pagar
    })
  };
}

/** Avisa a todas las reservas de que ya está pedida. Devuelve cuántos emails se mandaron. */
export async function avisarPedido(cfg, deps, producto, entrega, max = 60) {
  const t = tabla(cfg, deps);
  const filas = await t.leer(`producto=eq.${encodeURIComponent(producto)}&estado=eq.reservada&select=*`);
  let n = 0;
  for (const r of filas) {
    if (r.avisado) continue;
    if (n >= max) break;
    const cancelar = `${cfg.servidor}/tienda/preventa/cancelar?r=${r.id}&f=${firma(cfg.clave, r.id)}`;
    const m = correoPedido(cfg, r, entrega, cancelar);
    const ok = await enviarCorreo(cfg, r.email, m.asunto, m.html, deps.fetch || fetch).catch((e) => { console.error(e); return false; });
    if (ok) { n += 1; await t.cambiar(r.id, { avisado: new Date().toISOString() }); }
  }
  return { avisadas: n, faltan: filas.filter((r) => !r.avisado).length - n };
}

/** Cobra una reserva con su tarjeta guardada (sin que la persona esté). Si no se puede, le manda el enlace para pagar. */
export async function cobrarReserva(cfg, deps, r) {
  const t = tabla(cfg, deps);
  const st = await stripeDe(cfg, deps);
  const total = Math.round((Number(r.precio) || 0) * (Number(r.cantidad) || 1) * 100);
  try {
    if (!r.stripe_cliente || !r.metodo_pago) throw new Error('sin tarjeta guardada');
    const pi = await st('POST', 'payment_intents', {
      amount: String(total), currency: 'eur', customer: r.stripe_cliente, payment_method: r.metodo_pago,
      off_session: 'true', confirm: 'true', description: `${PRODUCTOS[r.producto]?.nombre || 'Reserva'} · reserva ${r.id}`,
      metadata: { sidonia: 'preventa', reserva: String(r.id) }
    });
    if (pi.status !== 'succeeded') throw new Error(`estado ${pi.status}`);
    await t.cambiar(r.id, { estado: 'cobrada', pago_id: pi.id, cobrado: new Date().toISOString(), error: null });
    const m = correoCobrada(cfg, r);
    await enviarCorreo(cfg, r.email, m.asunto, m.html, deps.fetch || fetch).catch(() => {});
    return { ok: true };
  } catch (e) {
    const motivo = String(e.message || e).slice(0, 300);
    await t.cambiar(r.id, { estado: 'fallida', error: motivo });
    const pagar = `${cfg.servidor}/tienda/preventa/pagar?r=${r.id}&f=${firma(cfg.clave, r.id)}`;
    const m = correoPagoPendiente(cfg, r, pagar);
    await enviarCorreo(cfg, r.email, m.asunto, m.html, deps.fetch || fetch).catch(() => {});
    return { ok: false, error: motivo };
  }
}
