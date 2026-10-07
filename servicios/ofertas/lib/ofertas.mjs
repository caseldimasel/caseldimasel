/* SIDONIA · Ofertas: comprobar la oferta, la firma del cliente y preparar los dos emails.
 * Sin dependencias: lo usa api/oferta.js (Vercel) y se prueba con node --test.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
export const fmtEur = (n) => eur.format(Math.round(Number(n) || 0));

export const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (t, n) => String(t ?? '').trim().slice(0, n);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const FIRMA_VALIDA_HORAS = 48;

/** Configuración desde las variables de entorno. */
export function config(env = process.env) {
  const lista = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
  return {
    resendKey: env.RESEND_API_KEY || '',
    remitente: env.OFERTAS_REMITENTE || 'Sidonia <ofertas@sidonia.es>',
    equipo: lista(env.OFERTAS_EQUIPO),
    origenes: lista(env.OFERTAS_ORIGENES || 'https://sidonia.es,https://www.sidonia.es'),
    clave: env.OFERTAS_CLAVE || '',
    soloFirmadas: env.OFERTAS_SOLO_FIRMADAS === '1',
    whatsapp: String(env.OFERTAS_WHATSAPP || '').replace(/[^\d]/g, ''),
    web: env.OFERTAS_WEB || 'https://sidonia.es'
  };
}

/** Limpia y comprueba la oferta. Devuelve { ok, oferta } o { ok: false, error }. */
export function validar(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'datos' };
  const o = {
    handle: clip(body.handle, 200),
    titulo: clip(body.titulo, 200),
    url: clip(body.url, 500),
    precio: Math.max(0, Math.round(Number(body.precio) || 0)),
    oferta: Math.round(Number(body.oferta) || 0),
    nombre: clip(body.nombre, 120),
    email: clip(body.email, 200).toLowerCase(),
    telefono: clip(body.telefono, 40),
    mensaje: clip(body.mensaje, 2000),
    contexto: body.contexto === 'subasta' ? 'subasta' : 'venta',
    cliente: body.cliente && body.cliente.id ? { id: String(body.cliente.id).slice(0, 40), ts: String(body.cliente.ts || ''), firma: String(body.cliente.firma || '') } : null
  };
  if (!o.titulo || !o.handle) return { ok: false, error: 'anuncio' };
  if (!(o.oferta > 0 && o.oferta < 1e9)) return { ok: false, error: 'oferta' };
  if (!o.nombre) return { ok: false, error: 'nombre' };
  if (!EMAIL.test(o.email)) return { ok: false, error: 'email' };
  if (o.url && !/^https?:\/\//.test(o.url)) o.url = '';
  return { ok: true, oferta: o };
}

/**
 * Firma del cliente con sesión iniciada (la calcula el tema con el filtro hmac_sha256):
 * HMAC-SHA256 en hexadecimal de «id:email:hora», con la clave compartida. La hora (segundos) vale 48 horas.
 */
export function firmar(id, email, ts, clave) {
  return createHmac('sha256', clave).update(`${id}:${String(email).toLowerCase()}:${ts}`).digest('hex');
}

export function comprobarFirma(o, cfg, ahora = Date.now()) {
  if (!o.cliente || !o.cliente.firma) return cfg.soloFirmadas ? 'sin_firma' : null;
  if (!cfg.clave) return null;
  const ts = Number(o.cliente.ts);
  if (!ts || Math.abs(ahora / 1000 - ts) > FIRMA_VALIDA_HORAS * 3600) return 'firma_caducada';
  const esperada = Buffer.from(firmar(o.cliente.id, o.email, o.cliente.ts, cfg.clave), 'hex');
  const recibida = Buffer.from(o.cliente.firma.replace(/[^0-9a-f]/gi, ''), 'hex');
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return 'firma';
  return null;
}

/* ------------------------------------------------------------------------------------------ Emails */
const marco = (contenido, web) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2;padding:32px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;">
<tr><td style="padding:28px 32px 8px;font-size:15px;font-weight:700;letter-spacing:.45em;">SIDONIA</td></tr>
<tr><td style="padding:8px 32px 32px;font-size:16px;line-height:1.55;">${contenido}</td></tr>
</table>
<p style="margin:18px 0 0;font-size:12px;color:#8a8a8a;"><a href="${esc(web)}" style="color:#8a8a8a;">${esc(web.replace(/^https?:\/\//, ''))}</a> · Coches, barcos y casas con alma</p>
</td></tr></table></body></html>`;

const fila = (k, v) => `<tr><td style="padding:10px 0;border-bottom:1px solid #eee;color:#6b6b6b;font-size:14px;">${k}</td><td align="right" style="padding:10px 0;border-bottom:1px solid #eee;font-size:14px;font-weight:600;">${v}</td></tr>`;

/** Email de gracias para el cliente. */
export function emailCliente(o, cfg) {
  const nombre = o.nombre.split(/\s+/)[0];
  const anuncio = o.url ? `<a href="${esc(o.url)}" style="color:#1a1a1a;">${esc(o.titulo)}</a>` : esc(o.titulo);
  const wa = cfg.whatsapp
    ? `<p style="margin:26px 0 0;"><a href="https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent(`Hola, os he hecho una oferta por ${o.titulo}`)}" style="display:inline-block;padding:13px 22px;border-radius:999px;background:#1f7a4d;color:#ffffff;font-weight:700;text-decoration:none;">¿Prisa? Escríbenos por WhatsApp</a></p>`
    : '';
  const html = marco(`
<h1 style="margin:12px 0 14px;font-size:24px;line-height:1.25;">¡Gracias por tu oferta, ${esc(nombre)}!</h1>
<p style="margin:0 0 18px;">Hemos recibido tu oferta de <strong>${fmtEur(o.oferta)}</strong> por ${anuncio}. La revisamos con el propietario y te responderemos lo antes posible.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;">
${fila('Anuncio', esc(o.titulo))}
${o.precio ? fila(o.contexto === 'subasta' ? 'Puja más alta' : 'Precio publicado', fmtEur(o.precio)) : ''}
${fila('Tu oferta', fmtEur(o.oferta))}
${o.telefono ? fila('Te llamamos al', esc(o.telefono)) : ''}
</table>
${o.mensaje ? `<p style="margin:16px 0 0;padding:14px 16px;border-radius:12px;background:#f4f4f2;font-size:14px;white-space:pre-line;">${esc(o.mensaje)}</p>` : ''}
<p style="margin:18px 0 0;font-size:14px;color:#6b6b6b;">Hacer una oferta no te compromete a nada hasta que el propietario y tú estéis de acuerdo. Si quieres cambiarla, responde a este email.</p>
${wa}
<p style="margin:26px 0 0;">Un abrazo,<br><strong>El equipo de Sidonia</strong></p>`, cfg.web);
  const text = [
    `¡Gracias por tu oferta, ${nombre}!`,
    '',
    `Hemos recibido tu oferta de ${fmtEur(o.oferta)} por ${o.titulo}. La revisamos con el propietario y te responderemos lo antes posible.`,
    o.url ? `Anuncio: ${o.url}` : '',
    o.precio ? `${o.contexto === 'subasta' ? 'Puja más alta' : 'Precio publicado'}: ${fmtEur(o.precio)}` : '',
    `Tu oferta: ${fmtEur(o.oferta)}`,
    o.mensaje ? `Tu mensaje: ${o.mensaje}` : '',
    '',
    'Hacer una oferta no te compromete a nada hasta que el propietario y tú estéis de acuerdo. Si quieres cambiarla, responde a este email.',
    '',
    'El equipo de Sidonia'
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
  return {
    from: cfg.remitente,
    to: [o.email],
    reply_to: cfg.equipo[0] || undefined,
    subject: `Hemos recibido tu oferta por ${o.titulo}`,
    html,
    text
  };
}

/** Aviso al equipo, para responder directamente al cliente. */
export function emailEquipo(o, cfg) {
  const pct = o.precio ? Math.round((o.oferta / o.precio) * 100) : null;
  const html = marco(`
<h1 style="margin:12px 0 14px;font-size:22px;line-height:1.25;">Nueva oferta: ${fmtEur(o.oferta)}</h1>
<p style="margin:0 0 14px;">${esc(o.nombre)} ofrece <strong>${fmtEur(o.oferta)}</strong>${pct ? ` (${pct} % del precio)` : ''} por <a href="${esc(o.url || cfg.web)}" style="color:#1a1a1a;">${esc(o.titulo)}</a>${o.contexto === 'subasta' ? ', una subasta que no llegó a la reserva' : ''}.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${fila('Nombre', esc(o.nombre))}
${fila('Email', `<a href="mailto:${esc(o.email)}" style="color:#1a1a1a;">${esc(o.email)}</a>`)}
${fila('Teléfono', o.telefono ? `<a href="tel:${esc(o.telefono.replace(/\s/g, ''))}" style="color:#1a1a1a;">${esc(o.telefono)}</a>` : '—')}
${o.precio ? fila(o.contexto === 'subasta' ? 'Puja más alta' : 'Precio publicado', fmtEur(o.precio)) : ''}
${fila('Oferta', fmtEur(o.oferta))}
${fila('Cliente con sesión', o.cliente ? `Sí (id ${esc(o.cliente.id)})` : 'No')}
</table>
${o.mensaje ? `<p style="margin:16px 0 0;padding:14px 16px;border-radius:12px;background:#f4f4f2;font-size:14px;white-space:pre-line;">${esc(o.mensaje)}</p>` : ''}
<p style="margin:18px 0 0;font-size:14px;color:#6b6b6b;">Responde a este email para escribir directamente a ${esc(o.nombre)}.</p>`, cfg.web);
  const text = [
    `Nueva oferta: ${fmtEur(o.oferta)} por ${o.titulo}`,
    o.url,
    `Nombre: ${o.nombre}`,
    `Email: ${o.email}`,
    `Teléfono: ${o.telefono || '—'}`,
    o.precio ? `Precio publicado: ${fmtEur(o.precio)}` : '',
    o.mensaje ? `Mensaje: ${o.mensaje}` : ''
  ].filter(Boolean).join('\n');
  return {
    from: cfg.remitente,
    to: cfg.equipo,
    reply_to: o.email,
    subject: `Nueva oferta: ${fmtEur(o.oferta)} por ${o.titulo}`,
    html,
    text
  };
}

/** Envía un email con Resend (https://resend.com). */
export async function enviar(email, cfg, fetchImpl = fetch) {
  const r = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(email)
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text().catch(() => '')}`);
  return r.json().catch(() => ({}));
}

/**
 * Atiende una oferta de principio a fin. Devuelve { status, body }.
 * Primero el aviso al equipo (si falla, el tema usa el formulario de contacto de Shopify); luego el email de gracias.
 */
export async function atender(body, cfg, { fetchImpl = fetch, ahora = Date.now(), log = console } = {}) {
  const v = validar(body);
  if (!v.ok) return { status: 400, body: { ok: false, error: v.error } };
  const o = v.oferta;
  const firma = comprobarFirma(o, cfg, ahora);
  if (firma) return { status: 401, body: { ok: false, error: firma } };
  if (!cfg.resendKey || !cfg.equipo.length) return { status: 503, body: { ok: false, error: 'sin_configurar' } };
  try {
    await enviar(emailEquipo(o, cfg), cfg, fetchImpl);
  } catch (e) {
    log.error?.('Aviso al equipo', e);
    return { status: 502, body: { ok: false, error: 'email_equipo' } };
  }
  let emailEnviado = true;
  try {
    await enviar(emailCliente(o, cfg), cfg, fetchImpl);
  } catch (e) {
    emailEnviado = false;
    log.error?.('Email de gracias', e);
  }
  return { status: 200, body: { ok: true, email_enviado: emailEnviado } };
}
