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
/** replyTo: a quién se contesta (por defecto, al equipo; en las ofertas, al comprador) */
export async function enviarCorreo(cfg, para, asunto, html, fetchImpl = fetch, replyTo = '') {
  if (!cfg.resendKey || !para) return false;
  const r = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: cfg.avisosRemitente, to: [para], reply_to: replyTo || cfg.avisosEquipo?.[0] || undefined, subject: asunto, html }),
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

/**
 * «Así se verá en Sidonia»: la tarjeta del anuncio igual que en la web (foto con esquinas redondeadas, la etiqueta
 * Particular/Profesional y «Nuevo» arriba, el corazón, la ubicación sobre la foto; debajo el precio, el título y quién
 * lo vende), dentro de una ventana de navegador de sidonia.es.
 */
function tarjeta(cfg, a) {
  // La portada: la del anuncio de la comunidad o, si es de Sidonia, la que manda la web
  const foto = a.foto || ((a.fotos || [])[0] ? urlFoto(cfg, a.fotos[0]) : '');
  const enlace = a.producto ? `${cfg.tienda}/products/${a.producto}` : '';
  const pro = a.vendedor_tipo === 'profesional';
  const chip = (t, estilo) => `<span style="display:inline-block;margin:0 0 6px;padding:4px 10px;border-radius:999px;${TEXTO};font-size:12px;line-height:1.4;font-weight:700;${estilo}">${t}</span>`;
  const sobreFoto = `<table role="presentation" width="100%" height="300" cellpadding="0" cellspacing="0"><tr>
      <td valign="top" style="padding:12px">${chip(pro ? 'Profesional' : 'Particular', `background:rgba(255,255,255,.92);color:${pro ? '#2b3a67' : '#1f5e3d'}`)}<br>${chip('<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#1f9d5c;margin:0 6px 1px 0;vertical-align:middle"></span>Nuevo', 'background:rgba(255,255,255,.9);color:#1a1a1a;font-weight:500')}</td>
      <td valign="top" align="right" style="padding:10px"><span style="display:inline-block;width:36px;height:36px;border-radius:50%;background:rgba(0,0,0,.28);color:#fff;font-size:18px;line-height:36px;text-align:center">&#9825;</span></td></tr>
    <tr><td colspan="2" valign="bottom" style="padding:0 12px 10px;${TEXTO};font-size:13px;font-weight:600;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.6)">${a.ubicacion ? `&#9906;&nbsp;${esc(a.ubicacion)}` : ''}</td></tr></table>`;
  const media = foto
    ? `<td height="300" valign="top" style="height:300px;border-radius:16px;background-color:#d9d9d6;background-image:url('${esc(foto)}');background-size:cover;background-position:center">${sobreFoto}</td>`
    : `<td height="300" style="height:300px;border-radius:16px;background:#e9e8e4">${sobreFoto}</td>`;
  const tarjetaHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:400px;margin:0 auto">
      <tr>${enlace ? media.replace('">', `"><a href="${esc(enlace)}" style="display:block;text-decoration:none">`).replace(/<\/td>$/, '</a></td>') : media}</tr>
      <tr><td style="padding:12px 2px 2px">
        <p style="margin:0 0 4px;font-family:Carlito,Calibri,'Helvetica Neue',Arial,sans-serif;font-size:21px;line-height:1.2;color:#1a1a1a">${esc(precio(a))}</p>
        <p style="margin:0 0 4px;${TEXTO};font-size:15px;line-height:1.35;color:#1a1a1a">${esc(a.titulo)}</p>
        <p style="margin:0;${TEXTO};font-size:13px;line-height:1.35;color:#8a8a8a">${esc([a.ubicacion, a.vendedor_nombre].filter(Boolean).join(' · '))}</p>
      </td></tr></table>`;
  // La ventana del navegador (tres puntos y la dirección): «así se verá»
  return `<tr><td style="padding:0 24px">
    <p style="margin:0 0 10px;${TEXTO};font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#8a8a8a">${a.producto ? 'Así se ve en Sidonia' : 'Así se verá en Sidonia'}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e3e0;border-radius:14px;background:#ffffff">
      <tr><td style="padding:10px 14px;border-bottom:1px solid #ececea;background:#f6f6f4;border-radius:14px 14px 0 0">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#d6d6d2;margin-right:5px"></span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#d6d6d2;margin-right:5px"></span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#d6d6d2;margin-right:14px"></span>
        <span style="display:inline-block;padding:3px 12px;border-radius:999px;background:#ffffff;border:1px solid #e3e3e0;${TEXTO};font-size:11px;color:#6b6b6b;vertical-align:1px">sidonia.es${a.producto ? `/products/${esc(String(a.producto).slice(0, 26))}` : ''}</span></td></tr>
      <tr><td style="padding:22px 20px 24px">${tarjetaHtml}</td></tr>
    </table></td></tr>`;
}

/** El estado del anuncio en tres pasos: Recibido · En revisión (o Mejoras pedidas / No publicado) · Publicado */
function pasos(paso) {
  if (!paso) return '';
  const medio = { mejoras: ['Mejoras pedidas', '#b7791f'], rechazado: ['No publicado', '#a4161a'] }[paso] || ['En revisión', '#1a1a1a'];
  const hecho = (i) => (paso === 'publicado' ? true : i === 0);
  const actual = (i) => (paso === 'publicado' ? i === 2 : i === 1);
  const items = [['Recibido', '#1f9d5c'], medio, ['Publicado', '#1f9d5c']];
  const celda = ([t, c], i) => {
    const on = hecho(i) || actual(i);
    const color = actual(i) ? c : hecho(i) ? '#1f9d5c' : '#c9c9c4';
    return `<td width="33%" valign="top" style="padding:0 4px">
      <div style="height:3px;border-radius:2px;background:${color};font-size:0;line-height:0">&nbsp;</div>
      <p style="margin:8px 0 0;${TEXTO};font-size:12px;font-weight:${actual(i) ? 700 : 500};letter-spacing:.3px;color:${on ? color : '#9a9a96'}">${hecho(i) && !actual(i) ? '&#10003; ' : ''}${t}</p></td>`;
  };
  return `<tr><td style="padding:26px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${items.map(celda).join('')}</tr></table></td></tr>`;
}

/** Su ficha técnica, en rejilla (lo que ha puesto él) */
function ficha(a) {
  const filas = (a.ficha || []).filter(([k, v]) => k && v).slice(0, 8);
  if (!filas.length) return '';
  const celda = ([k, v]) => `<td width="50%" valign="top" style="padding:10px 0;border-top:1px solid #ececea"><p style="margin:0;${TEXTO};font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8a8a8a">${esc(k)}</p><p style="margin:2px 0 0;${TEXTO};font-size:14px;font-weight:600;color:#1a1a1a">${esc(v)}</p></td>`;
  const pares = [];
  for (let i = 0; i < filas.length; i += 2) pares.push(`<tr>${celda(filas[i])}${filas[i + 1] ? celda(filas[i + 1]) : '<td></td>'}</tr>`);
  return `<p style="margin:8px 0 6px;${TEXTO};font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#8a8a8a">Ficha técnica</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px">${pares.join('')}<tr><td colspan="2" style="border-top:1px solid #ececea;font-size:0;line-height:0">&nbsp;</td></tr></table>`;
}

/**
 * La plantilla común. { titulo, cuerpo (HTML con P/lista/cita/datos), boton, enlace, previa (lo que se lee en la bandeja),
 * paso (el estado: recibido · mejoras · publicado · rechazado), conFicha }. Con «así se verá en Sidonia» si es de un anuncio.
 */
export function plantilla(cfg, a, { titulo, cuerpo, boton, enlace, previa = '', paso = '', conFicha = false }) {
  const wa = `https://wa.me/${cfg.whatsapp || '34675287095'}`;
  const logo = cfg.servidor
    ? `<img src="${esc(cfg.servidor)}/admin?recurso=logo" width="120" alt="SIDONIA" style="display:block;width:120px;height:auto;border:0">`
    : `<span style="${TITULAR};font-size:18px;letter-spacing:6px;color:#000">SIDONIA</span>`;
  const ref = a?.id ? `Anuncio nº ${Number(a.id)}` : '';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only">
<title>${esc(titulo)}</title>
<link href="https://fonts.googleapis.com/css2?family=Carlito&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>@import url('https://fonts.googleapis.com/css2?family=Carlito&family=Inter:wght@400;500;600;700&display=swap');</style></head>
<body style="margin:0;padding:0;background:#f2f2f0;color:#272727">
${previa ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(previa)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f0"><tr><td align="center" style="padding:24px 12px 40px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:18px">
    <tr><td style="padding:22px 28px;border-bottom:1px solid #ececea"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><a href="${esc(cfg.tienda)}" style="text-decoration:none">${logo}</a></td>
      <td align="right" style="${TEXTO};font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#8a8a8a">${ref}</td></tr></table></td></tr>
    ${pasos(paso)}
    <tr><td style="padding:26px 28px 6px">
      <h1 style="margin:0 0 16px;${TITULAR};font-size:24px;line-height:1.25;font-weight:400;color:#000">${esc(titulo)}</h1>
      ${cuerpo}
      ${boton ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 28px"><tr><td style="background:#1a1a1a;border-radius:999px"><a href="${esc(enlace)}" style="display:inline-block;padding:15px 30px;${TEXTO};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none">${esc(boton)} &rarr;</a></td></tr></table>` : ''}
    </td></tr>
    ${a?.titulo ? tarjeta(cfg, a) : ''}
    ${a?.titulo && conFicha ? `<tr><td style="padding:22px 28px 0">${ficha(a)}</td></tr>` : ''}
    <tr><td style="padding:24px 28px 26px">${P('Un saludo,<br><b>El equipo de Sidonia</b>').replace('margin:0 0 16px', 'margin:0')}</td></tr>
  </table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px"><tr><td align="center" style="padding:20px 28px 0;${TEXTO};font-size:12px;line-height:1.8;color:#8a8a8a">
    Coches, motos, barcos y casas con alma<br>
    <a href="${esc(cfg.tienda)}" style="color:#1a1a1a;text-decoration:none;font-weight:600">sidonia.es</a> &nbsp;·&nbsp; <a href="${wa}" style="color:#1a1a1a;text-decoration:none;font-weight:600">WhatsApp</a> &nbsp;·&nbsp; <a href="${INSTAGRAM}" style="color:#1a1a1a;text-decoration:none;font-weight:600">Instagram</a><br>
    ¿Dudas? Responde a este email y te contestamos.</td></tr></table>
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
      titulo: 'Tenemos tu anuncio', paso: 'recibido', conFicha: true, previa: 'Lo revisamos a mano y en menos de 48 horas te decimos algo.',
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
      titulo: 'Ya está publicado', paso: 'publicado', previa: 'Ya se puede ver en Sidonia.',
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
      titulo: 'Aún no podemos publicarlo', paso: 'rechazado', previa: 'Te contamos por qué y cómo arreglarlo.',
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
