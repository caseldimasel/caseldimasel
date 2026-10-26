/* SIDONIA · Emails a los dueños de los anuncios: recibido, mejoras, publicado, no publicado, cambios (y los de pagos,
 * en comunidad.mjs). Con el estilo de la web: logo arriba, la foto de portada del anuncio con su título, ubicación y
 * precio (como una tarjeta de sidonia.es), títulos en mayúsculas espaciadas, esquinas rectas y botón negro.
 * Se mandan con Resend (RESEND_API_KEY y AVISOS_REMITENTE en Vercel; el dominio del remitente verificado en Resend).
 * Sin Resend no se manda nada y el panel lo dice. Se ven todos en el panel › Herramientas › Emails.
 */
import { esc, urlFoto } from './circulo.mjs';

const TIPO = { coche: 'Coche', moto: 'Moto', barco: 'Barco', casa: 'Casa' };
const EL = { coche: 'tu coche', moto: 'tu moto', barco: 'tu barco', casa: 'tu casa' };
const INSTAGRAM = 'https://www.instagram.com/sidoniagarage/';
const TEXTO = "font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const TITULAR = "font-family:Carlito,Calibri,'Helvetica Neue',Arial,sans-serif;text-transform:uppercase;letter-spacing:2px";

/** Envía un email con Resend. Devuelve true si salió, false si no hay Resend configurado; lanza si Resend falla. */
export async function enviarCorreo(cfg, para, asunto, html, fetchImpl = fetch) {
  if (!cfg.resendKey || !para) return false;
  const r = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: cfg.avisosRemitente, to: [para], reply_to: cfg.avisosEquipo?.[0] || undefined, subject: asunto, html }),
    signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return true;
}

/* ---------------------------------------------------------------------------- Piezas para el cuerpo */
/** Un párrafo (el texto ya escapado; se puede usar <b>) */
export const P = (t) => `<p style="margin:0 0 16px;${TEXTO};font-size:15px;line-height:1.65;color:#272727">${t}</p>`;
/** Texto del usuario o del equipo, escapado, en párrafos */
export const parrafos = (t) => String(t || '').split(/\n{2,}|\n/).filter((x) => x.trim()).map((x) => P(esc(x))).join('');
/** Lista numerada: [[título, texto], …] */
export const lista = (items) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px">${items.map(([t, x], i) => `<tr>
  <td valign="top" width="34" style="padding:14px 0;border-top:1px solid #e6e6e6;${TITULAR};font-size:15px;color:#272727">${String(i + 1).padStart(2, '0')}</td>
  <td valign="top" style="padding:14px 0;border-top:1px solid #e6e6e6;${TEXTO};font-size:15px;line-height:1.6;color:#272727"><b>${esc(t)}</b><br>${esc(x).replace(/\n/g, '<br>')}</td></tr>`).join('')}
  <tr><td colspan="2" style="border-top:1px solid #e6e6e6;font-size:0;line-height:0">&nbsp;</td></tr></table>`;
/** Una cita (el motivo de un rechazo…) */
export const cita = (t) => (t ? `<div style="margin:0 0 20px;padding:2px 0 2px 16px;border-left:2px solid #272727">${parrafos(t).replace(/margin:0 0 16px/g, 'margin:0 0 8px')}</div>` : '');
/** Datos en filas: [[«Cada mes», «12,90 €»], …] */
export const datos = (filas) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 20px">${filas.map(([k, v]) => `<tr>
  <td style="padding:12px 0;border-top:1px solid #e6e6e6;${TEXTO};font-size:14px;color:#6b6b6b">${esc(k)}</td>
  <td align="right" style="padding:12px 0;border-top:1px solid #e6e6e6;${TEXTO};font-size:15px;font-weight:600;color:#272727">${esc(v)}</td></tr>`).join('')}
  <tr><td colspan="2" style="border-top:1px solid #e6e6e6;font-size:0;line-height:0">&nbsp;</td></tr></table>`;

const precio = (a) => (a.precio ? `${Number(a.precio).toLocaleString('es-ES')} €` : 'Precio a consultar');

/** La tarjeta del anuncio: la portada y, debajo, tipo · ubicación, título y precio (como en la web) */
function tarjeta(cfg, a) {
  const foto = (a.fotos || [])[0] ? urlFoto(cfg, a.fotos[0]) : '';
  const meta = [TIPO[a.tipo], a.ubicacion].filter(Boolean).join(' · ');
  const enlace = a.producto ? `${cfg.tienda}/products/${a.producto}` : '';
  const img = foto ? `<img src="${esc(foto)}" width="600" alt="${esc(a.titulo)}" style="display:block;width:100%;max-width:600px;height:auto;border:0">` : '';
  return `<tr><td style="padding:0">${enlace && img ? `<a href="${esc(enlace)}">${img}</a>` : img}</td></tr>
    <tr><td style="padding:16px 32px 0">
      ${meta ? `<p style="margin:0 0 6px;${TEXTO};font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#8a8a8a">${esc(meta)}</p>` : ''}
      <p style="margin:0 0 4px;${TITULAR};font-size:18px;line-height:1.3;color:#000">${esc(a.titulo)}</p>
      <p style="margin:0;${TEXTO};font-size:15px;color:#272727">${esc(precio(a))}</p>
      <div style="margin:22px 0 0;border-top:1px solid #000;font-size:0;line-height:0">&nbsp;</div>
    </td></tr>`;
}

/**
 * La plantilla común. { titulo, cuerpo (HTML con P/lista/cita/datos), boton, enlace, previa (lo que se lee en la bandeja) }
 * Con la tarjeta del anuncio si es de un anuncio (a.titulo).
 */
export function plantilla(cfg, a, { titulo, cuerpo, boton, enlace, previa = '' }) {
  const wa = `https://wa.me/${cfg.whatsapp || '34675287095'}`;
  const logo = cfg.servidor
    ? `<img src="${esc(cfg.servidor)}/admin?recurso=logo" width="140" alt="SIDONIA" style="display:block;width:140px;height:auto;border:0;margin:0 auto">`
    : `<span style="${TITULAR};font-size:18px;letter-spacing:6px;color:#000">SIDONIA</span>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only">
<title>${esc(titulo)}</title>
<link href="https://fonts.googleapis.com/css2?family=Carlito&family=Inter:wght@400;600&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#ffffff;color:#272727">
${previa ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(previa)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff"><tr><td align="center" style="padding:28px 0 40px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
    <tr><td align="center" style="padding:0 32px 26px"><a href="${esc(cfg.tienda)}" style="text-decoration:none">${logo}</a></td></tr>
    ${a?.titulo ? tarjeta(cfg, a) : '<tr><td style="padding:0 32px"><div style="border-top:1px solid #000;font-size:0;line-height:0">&nbsp;</div></td></tr>'}
    <tr><td style="padding:28px 32px 8px">
      <h1 style="margin:0 0 18px;${TITULAR};font-size:22px;line-height:1.3;font-weight:400;color:#000">${esc(titulo)}</h1>
      ${cuerpo}
      ${boton ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 26px"><tr><td style="background:#272727"><a href="${esc(enlace)}" style="display:inline-block;padding:16px 30px;${TEXTO};font-size:13px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#ffffff;text-decoration:none">${esc(boton)}</a></td></tr></table>` : ''}
      ${P('Un saludo,<br><b>El equipo de Sidonia</b>')}
    </td></tr>
    <tr><td style="padding:12px 32px 0"><div style="border-top:1px solid #e6e6e6;font-size:0;line-height:0">&nbsp;</div>
      <p style="margin:16px 0 0;${TEXTO};font-size:12px;line-height:1.7;color:#8a8a8a">Coches, motos, barcos y casas con alma.<br>
      <a href="${esc(cfg.tienda)}" style="color:#272727">sidonia.es</a> &nbsp;·&nbsp; <a href="${wa}" style="color:#272727">WhatsApp</a> &nbsp;·&nbsp; <a href="${INSTAGRAM}" style="color:#272727">Instagram</a><br>
      ¿Dudas? Responde a este email y te contestamos.</p></td></tr>
  </table>
</td></tr></table></body></html>`;
}

const hola = (a) => P(`Hola${a.vendedor_nombre ? ` ${esc(a.vendedor_nombre)}` : ''}:`);
const perfil = (cfg) => `${cfg.tienda}/pages/vende-con-nosotros?view=perfil`;
const editar = (cfg, a) => `${cfg.tienda}/pages/vende-con-nosotros?view=publicar${a.id ? `&anuncio=${Number(a.id)}` : ''}`;

/** «Tenemos tu anuncio» */
export function correoRecibido(cfg, a) {
  return {
    asunto: `Tenemos tu anuncio: ${a.titulo}`,
    html: plantilla(cfg, a, {
      titulo: 'Tenemos tu anuncio', previa: 'Lo revisamos a mano y en menos de 48 horas te decimos algo.',
      cuerpo: hola(a) + P(`Ya tenemos ${EL[a.tipo] || 'tu anuncio'}. Lo revisamos a mano, uno a uno, y en menos de 48 horas te decimos algo: si está listo para publicar o si hay que retocar alguna cosa.`),
      boton: 'Ver mi anuncio', enlace: perfil(cfg)
    })
  };
}

/** «Ya está publicado» */
export function correoPublicado(cfg, a, url) {
  return {
    asunto: `Ya está en Sidonia: ${a.titulo}`,
    html: plantilla(cfg, { ...a, producto: a.producto || '' }, {
      titulo: 'Ya está publicado', previa: 'Ya se puede ver en Sidonia.',
      cuerpo: hola(a) + P(`${EL[a.tipo] ? EL[a.tipo].charAt(0).toUpperCase() + EL[a.tipo].slice(1) : 'Tu anuncio'} ya se puede ver en Sidonia. Los interesados te escribirán directamente.`)
        + P('Un consejo: compártelo con tus amigos y en tus redes. Cuanta más gente lo vea, antes se vende. Nosotros lo contaremos en nuestro Instagram.'),
      boton: 'Ver el anuncio', enlace: url
    })
  };
}

/** «Aún no podemos publicarlo» con el motivo */
export function correoRechazado(cfg, a, motivo) {
  return {
    asunto: `Sobre tu anuncio: ${a.titulo}`,
    html: plantilla(cfg, a, {
      titulo: 'Aún no podemos publicarlo', previa: 'Te contamos por qué y cómo arreglarlo.',
      cuerpo: hola(a) + P('Hemos revisado tu anuncio y, tal y como está, todavía no podemos publicarlo.') + cita(motivo)
        + P('Puedes corregirlo y volver a enviarlo cuando quieras. Si tienes cualquier duda, responde a este email y lo vemos juntos.'),
      boton: 'Volver a enviarlo', enlace: editar(cfg, {})
    })
  };
}

/** «Tus cambios ya se ven» (el equipo aprueba lo que el dueño editó) */
export function correoCambiosAprobados(cfg, a, url) {
  return {
    asunto: `Cambios publicados: ${a.titulo}`,
    html: plantilla(cfg, a, {
      titulo: 'Tus cambios ya se ven', previa: 'Hemos actualizado tu anuncio.',
      cuerpo: hola(a) + P('Hemos revisado lo que has cambiado y ya se ve en tu anuncio.'),
      boton: url ? 'Ver el anuncio' : 'Ver mi anuncio', enlace: url || perfil(cfg)
    })
  };
}

/** «No hemos aplicado tus cambios» con el motivo (el anuncio sigue como estaba) */
export function correoCambiosRechazados(cfg, a, motivo) {
  return {
    asunto: `Sobre tus cambios: ${a.titulo}`,
    html: plantilla(cfg, a, {
      titulo: 'No hemos aplicado tus cambios', previa: 'Tu anuncio sigue como estaba.',
      cuerpo: hola(a) + P('Hemos revisado lo que has cambiado y, de momento, no podemos aplicarlo. Tu anuncio sigue como estaba.') + cita(motivo)
        + P('Puedes volver a editarlo cuando quieras.'),
      boton: 'Editar mi anuncio', enlace: editar(cfg, a)
    })
  };
}
