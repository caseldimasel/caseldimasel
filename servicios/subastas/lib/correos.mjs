/* SIDONIA · Emails al dueño de un anuncio gratis: recibido, publicado (enhorabuena) y no publicado (con el motivo).
 * Se mandan con Resend (RESEND_API_KEY y AVISOS_REMITENTE en Vercel; el dominio del remitente verificado en Resend).
 * Sin Resend no se manda nada y el panel lo dice.
 */
import { esc, urlFoto } from './circulo.mjs';

const TIPO = { coche: 'coche', moto: 'moto', barco: 'barco', casa: 'casa' };
const EL = { coche: 'tu coche', moto: 'tu moto', barco: 'tu barco', casa: 'tu casa' };

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

const parrafos = (t) => String(t || '').split(/\n{2,}|\n/).filter((x) => x.trim()).map((x) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#3a3833">${esc(x)}</p>`).join('');

/** La plantilla común: logo, foto de portada, título, texto, botón y pie con WhatsApp */
export function plantilla(cfg, a, { antetitulo, titulo, cuerpo, boton, enlace }) {
  const foto = (a.fotos || [])[0] ? urlFoto(cfg, a.fotos[0]) : '';
  const wa = `https://wa.me/${cfg.whatsapp || '34675287095'}`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title></head>
<body style="margin:0;padding:0;background:#f6f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1b1a18">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f2"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td align="center" style="padding:0 0 24px;font-size:15px;font-weight:700;letter-spacing:.45em;color:#1b1a18">${cfg.servidor ? `<img src="${esc(cfg.servidor)}/admin?recurso=logo" width="150" alt="SIDONIA" style="display:block;width:150px;height:auto;border:0">` : 'SIDONIA'}</td></tr>
    <tr><td style="background:#ffffff;border-radius:20px;overflow:hidden">
      ${foto ? `<img src="${esc(foto)}" width="560" alt="${esc(a.titulo)}" style="display:block;width:100%;max-width:560px;height:auto;border:0">` : ''}
      <div style="padding:28px 28px 8px">
        <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#8a857b">${esc(antetitulo)}</p>
        <h1 style="margin:0 0 18px;font-size:26px;line-height:1.2;font-weight:700;color:#1b1a18">${esc(titulo)}</h1>
        ${cuerpo}
      </div>
      ${boton ? `<div style="padding:8px 28px 32px"><a href="${esc(enlace)}" style="display:inline-block;padding:14px 26px;border-radius:999px;background:#1b1a18;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none">${esc(boton)}</a></div>` : '<div style="height:16px"></div>'}
    </td></tr>
    <tr><td align="center" style="padding:24px 8px 0;font-size:13px;line-height:1.6;color:#8a857b">
      ¿Dudas? Escríbenos por <a href="${wa}" style="color:#1b1a18;font-weight:600">WhatsApp</a> o responde a este email.<br>
      <a href="${esc(cfg.tienda)}" style="color:#8a857b">sidonia.es</a> · Coches, motos, barcos y casas con alma
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

/** «Hemos recibido tu anuncio» (al enviarlo desde la web) */
export function correoRecibido(cfg, a) {
  return {
    asunto: `Hemos recibido tu anuncio: ${a.titulo}`,
    html: plantilla(cfg, a, {
      antetitulo: 'Anuncio recibido',
      titulo: `¡Gracias, ${a.vendedor_nombre}!`,
      cuerpo: parrafos(`Ya tenemos el anuncio de ${EL[a.tipo] || 'tu anuncio'}, «${a.titulo}».\nLo revisamos a mano para que se vea como se merece. En menos de 48 horas te escribimos con lo que sea: si está listo para publicar o si hace falta retocar algo.`),
      boton: 'Ver mi perfil', enlace: `${cfg.tienda}/pages/vende-con-nosotros?view=perfil`
    })
  };
}

/** «Enhorabuena, ya está publicado» */
export function correoPublicado(cfg, a, url) {
  return {
    asunto: `¡Enhorabuena! ${a.titulo} ya está en Sidonia`,
    html: plantilla(cfg, a, {
      antetitulo: 'Publicado',
      titulo: `${a.vendedor_nombre}, ${EL[a.tipo] || 'tu anuncio'} ya está publicado`,
      cuerpo: parrafos(`«${a.titulo}» ya se puede ver en Sidonia, junto al resto de ${TIPO[a.tipo] === 'casa' ? 'casas' : `${TIPO[a.tipo] || 'coche'}s`} de la web.\nLos interesados te contactarán directamente a tu teléfono. Un consejo: compártelo con tus amigos y en tus redes, cuanta más gente lo vea, antes se vende.\nY lo contaremos en nuestras historias de Instagram.`),
      boton: 'Ver mi anuncio', enlace: url
    })
  };
}

/** «No lo hemos publicado» con el motivo */
export function correoRechazado(cfg, a, motivo) {
  return {
    asunto: `Sobre tu anuncio en Sidonia: ${a.titulo}`,
    html: plantilla(cfg, a, {
      antetitulo: 'Tu anuncio',
      titulo: `${a.vendedor_nombre}, aún no podemos publicarlo`,
      cuerpo: parrafos(`Hemos revisado «${a.titulo}» y, de momento, no podemos publicarlo tal y como está.`)
        + (motivo ? `<div style="margin:0 0 16px;padding:14px 16px;border-radius:12px;background:#f6f5f2">${parrafos(motivo)}</div>` : '')
        + parrafos('Puedes corregirlo y volver a enviarlo cuando quieras. Si tienes cualquier duda, escríbenos y lo vemos juntos.'),
      boton: 'Volver a enviarlo', enlace: `${cfg.tienda}/pages/vende-con-nosotros?view=publicar`
    })
  };
}

/** «Tus cambios ya se ven» (el equipo aprueba lo que el dueño editó) */
export function correoCambiosAprobados(cfg, a, url) {
  return {
    asunto: `Tus cambios ya están en Sidonia: ${a.titulo}`,
    html: plantilla(cfg, a, {
      antetitulo: 'Cambios aprobados',
      titulo: `${a.vendedor_nombre}, ya hemos actualizado tu anuncio`,
      cuerpo: parrafos(`Hemos revisado los cambios de «${a.titulo}» y ya se ven en tu anuncio.`),
      boton: url ? 'Ver mi anuncio' : 'Ver mi perfil', enlace: url || `${cfg.tienda}/pages/vende-con-nosotros?view=perfil`
    })
  };
}

/** «No hemos aplicado tus cambios» con el motivo (el anuncio sigue como estaba) */
export function correoCambiosRechazados(cfg, a, motivo) {
  return {
    asunto: `Sobre los cambios de tu anuncio: ${a.titulo}`,
    html: plantilla(cfg, a, {
      antetitulo: 'Tus cambios',
      titulo: `${a.vendedor_nombre}, no hemos aplicado tus cambios`,
      cuerpo: parrafos(`Hemos revisado los cambios de «${a.titulo}» y, de momento, no podemos aplicarlos. Tu anuncio sigue como estaba.`)
        + (motivo ? `<div style="margin:0 0 16px;padding:14px 16px;border-radius:12px;background:#f6f5f2">${parrafos(motivo)}</div>` : '')
        + parrafos('Puedes volver a editarlo cuando quieras. Si tienes cualquier duda, escríbenos.'),
      boton: 'Editar mi anuncio', enlace: `${cfg.tienda}/pages/vende-con-nosotros?view=publicar`
    })
  };
}
