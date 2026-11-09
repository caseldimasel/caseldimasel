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
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { tablaAnuncios, esc } from './circulo.mjs';
import { enviarCorreo, plantilla, P, datos, lista } from './correos.mjs';

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
    return null;
  } catch (e) {
    console.error('Sidonia · preventa', e);
    return json(200, { ok: false, error: /preventas|relation|column/.test(String(e.message)) ? 'sin-tabla' : 'motor' });
  }
}

/** Panel › Herramientas › Reservas: el contador y la lista */
export function paginaPreventas(cfg, filas = []) {
  const res = filas.filter((f) => f.estado === 'reservada');
  const uds = res.reduce((s, f) => s + (Number(f.cantidad) || 1), 0);
  const ingresos = res.reduce((s, f) => s + (Number(f.cantidad) || 1) * (Number(f.precio) || 0), 0);
  const est = { reservada: 'Reservada', pendiente: 'Sin terminar (no guardó la tarjeta)', cancelada: 'Cancelada', cobrada: 'Cobrada' };
  const tr = filas.map((f) => `<tr><td>${esc(new Date(f.creado).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }))}</td><td>${esc(f.nombre)}<br><small>${esc(f.email)}${f.telefono ? ` · ${esc(f.telefono)}` : ''}</small></td><td>${Number(f.cantidad) || 1}</td><td>${esc(eur(f.precio || 0))}</td><td>${esc(est[f.estado] || f.estado)}${f.tarjeta ? `<br><small>${esc(f.tarjeta)}</small>` : ''}</td></tr>`).join('');
  return `<h2 style="margin:0 0 6px">SIDONIA RD10 · reservas</h2>
<p class="res"><b style="font-size:28px">${uds}</b> radios reservadas por ${res.length} ${res.length === 1 ? 'persona' : 'personas'} · si se cobran todas, ${esc(eur(ingresos))} (IVA incluido)</p>
<p class="nota">No se ha cobrado nada a nadie: guardan la tarjeta y se cobra al enviar. «Sin terminar» son quienes empezaron y no guardaron la tarjeta. Para decidir el pedido de 500 nos fijamos en unas 150 reservas.</p>
<div style="overflow-x:auto"><table><thead><tr><th>Cuándo</th><th>Quién</th><th>Uds.</th><th>Precio</th><th>Estado</th></tr></thead><tbody>${tr || '<tr><td colspan="5" class="vacio">Aún no hay reservas.</td></tr>'}</tbody></table></div>`;
}
