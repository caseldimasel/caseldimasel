/* SIDONIA · «Hacer una oferta» en cualquier anuncio: POST /tienda/api/oferta (el tema, assets/sidonia-offer.js).
 * - Anuncio de la comunidad (lo vende su dueño): la oferta le llega directamente al dueño por email (si responde, le
 *   contesta al comprador) y al móvil si tiene la app; al equipo, una copia.
 * - Anuncio de Sidonia (gestión de venta): le llega al equipo (si responde, le contesta al comprador).
 * - Al comprador: «Tu oferta está enviada», con la tarjeta del anuncio.
 * Se guarda en la tabla ofertas (sql/ofertas.sql; si aún no está, se manda igual) y se ve en el panel › Ventas › Ofertas.
 * A los dueños solo les llegan ofertas de gente con su cuenta iniciada (contra el spam); como mucho 10 por hora.
 */
import { avisarCliente } from './avisos.mjs';
import { esc, tablaAnuncios } from './circulo.mjs';
import { cita, datos, enviarCorreo, P, plantilla } from './correos.mjs';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const clip = (t, n) => String(t ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
export const eur = (x) => `${Math.round(Number(x) || 0).toLocaleString('es-ES')} €`;
const tel = (t) => String(t || '').replace(/\D/g, '').replace(/^(?=[6789]\d{8}$)/, '34');

/** Limpia la oferta: { ok, oferta } o { ok: false, error } */
export function leerOferta(b = {}) {
  const o = {
    handle: clip(b.handle, 160).toLowerCase(), titulo: clip(b.titulo, 200), url: clip(b.url, 500),
    precio: Math.max(0, Math.round(Number(b.precio) || 0)), oferta: Math.round(Number(String(b.oferta ?? '').replace(/[^\d]/g, '')) || 0),
    nombre: clip(b.nombre, 120), email: clip(b.email, 200).toLowerCase(), telefono: clip(b.telefono, 40), mensaje: clip(b.mensaje, 2000),
    imagen: /^https:\/\//.test(String(b.imagen || '')) ? clip(b.imagen, 600) : ''
  };
  if (!/^[a-z0-9][a-z0-9-]{0,159}$/.test(o.handle) || !o.titulo) return { ok: false, error: 'anuncio' };
  if (!(o.oferta > 0 && o.oferta < 1e9)) return { ok: false, error: 'oferta' };
  if (!o.nombre) return { ok: false, error: 'nombre' };
  if (!EMAIL.test(o.email)) return { ok: false, error: 'email' };
  if (o.url && !/^https:\/\//.test(o.url)) o.url = '';
  return { ok: true, oferta: o };
}

const diferencia = (o) => (o.precio ? Math.round(((o.oferta - o.precio) / o.precio) * 100) : null);
const filas = (o, conContacto) => [
  ['Oferta', eur(o.oferta)],
  ...(o.precio ? [['Precio publicado', eur(o.precio)], ['Diferencia', `${diferencia(o) > 0 ? '+' : ''}${diferencia(o)} %`]] : []),
  ['De', o.nombre],
  ...(conContacto ? [['Email', o.email], ...(o.telefono ? [['Teléfono', o.telefono]] : [])] : [])
];

/** Lo que se pinta como «así se ve en Sidonia»: el anuncio de la comunidad o, si es de Sidonia, lo que manda la web */
const anuncioDe = (o, a) => (a ? { ...a } : { titulo: o.titulo, precio: o.precio || null, foto: o.imagen, producto: o.handle, vendedor_nombre: 'Sidonia', vendedor_tipo: 'profesional' });

/** Al que vende (el dueño o el equipo): la oferta, con quién es y cómo responderle */
export function correoOfertaVendedor(cfg, o, a) {
  const asunto = `Oferta de ${eur(o.oferta)} por ${o.titulo}`;
  const wa = o.telefono ? `https://wa.me/${tel(o.telefono)}?text=${encodeURIComponent(`Hola ${o.nombre}, te escribo por tu oferta de ${eur(o.oferta)} por ${o.titulo} en Sidonia.`)}` : '';
  const responder = `mailto:${o.email}?subject=${encodeURIComponent(`Tu oferta por ${o.titulo}`)}`;
  return {
    asunto,
    html: plantilla(cfg, anuncioDe(o, a), {
      titulo: 'Tienes una oferta', previa: `${o.nombre} ofrece ${eur(o.oferta)}.`,
      cuerpo: P(a ? `Hola ${esc(a.vendedor_nombre || '')}:` : 'Nueva oferta en la web:') + P(`<b>${esc(o.nombre)}</b> ha hecho una oferta por ${a ? 'tu anuncio' : `<b>${esc(o.titulo)}</b>`}:`)
        + datos(filas(o, true)) + (o.mensaje ? cita(o.mensaje) : '')
        + P(a ? 'Para contestar, responde a este email (le llega directamente) o escríbele por WhatsApp. Tú decides: aceptarla, hacer una contraoferta o no seguir.' : 'Respondiendo a este email le contestáis directamente.')
        + (wa ? P(`<a href="${esc(wa)}" style="color:#1a1a1a;font-weight:600">Escribirle por WhatsApp &rarr;</a>`) : ''),
      boton: `Responder a ${o.nombre.split(' ')[0]}`, enlace: responder, sinDudas: true
    })
  };
}

/** Al comprador: «Tu oferta está enviada» */
export function correoOfertaComprador(cfg, o, a) {
  return {
    asunto: `Tu oferta por ${o.titulo}`,
    html: plantilla(cfg, anuncioDe(o, a), {
      titulo: 'Tu oferta está enviada', previa: `${eur(o.oferta)} por ${o.titulo}.`,
      cuerpo: P(`Hola ${esc(o.nombre.split(' ')[0])}:`)
        + P(a ? `Le hemos enviado tu oferta a <b>${esc(a.vendedor_nombre || 'su dueño')}</b>, que lo vende directamente. Te contestará a este email${o.telefono ? ' o a tu teléfono' : ''}.` : 'Hemos recibido tu oferta. La revisamos con el propietario y te contestamos lo antes posible.')
        + datos(filas(o, false)) + (o.mensaje ? cita(o.mensaje) : ''),
      boton: 'Ver el anuncio', enlace: o.url || `${cfg.tienda}/products/${o.handle}`
    })
  };
}

/** POST api/oferta */
export async function recibirOferta(body, cliente, cfg, deps) {
  const v = leerOferta(body);
  if (!v.ok) return v;
  const o = v.oferta;
  const t = (nombre) => deps[nombre] || tablaAnuncios(cfg, deps.fetch, nombre === 'tabla' ? 'anuncios' : nombre);
  // ¿Es de la comunidad? (su dueño lo vende)
  let a = null;
  try { [a] = await t('tabla').leer(`producto=eq.${encodeURIComponent(o.handle)}&estado=eq.publicado&select=*&limit=1`); } catch (e) { a = null; }
  if (a && !cliente) return { ok: false, error: 'login' };
  // Como mucho 10 ofertas por hora por persona
  const tO = t('ofertas');
  try {
    const hace = new Date(Date.now() - 3600e3).toISOString();
    if (cliente && (await tO.leer(`cliente=eq.${encodeURIComponent(cliente)}&creado=gte.${encodeURIComponent(hace)}&select=id`)).length >= 10) return { ok: false, error: 'muchas' };
  } catch (e) { /* sin la tabla aún */ }
  const r = { ok: true, para: a ? 'dueno' : 'sidonia', vendedor: a ? a.vendedor_nombre : 'Sidonia', email_enviado: false };
  const enviar = async (para, c) => enviarCorreo(cfg, para, c.asunto, c.html, deps.fetch, o.email).catch((e) => { console.error(e); return false; });
  // Al que vende
  const cv = correoOfertaVendedor(cfg, o, a);
  let alVendedor = false;
  if (a?.email) alVendedor = await enviar(a.email, cv);
  for (const e of cfg.avisosEquipo || []) await enviar(e, a ? { ...cv, asunto: `[Comunidad] ${cv.asunto} · para ${a.vendedor_nombre}` } : cv);
  if (a?.cliente && cfg.firebase) {
    await avisarCliente(cfg, { fetch: deps.fetch || fetch, dispositivos: deps.dispositivos }, a.cliente, { titulo: 'Tienes una oferta', texto: `${o.nombre} ofrece ${eur(o.oferta)} por ${a.titulo}. Míralo en tu email.`, url: o.url || '/' }).catch(() => {});
  }
  // Al comprador
  const cc = correoOfertaComprador(cfg, o, a);
  r.email_enviado = Boolean(await enviarCorreo(cfg, o.email, cc.asunto, cc.html, deps.fetch).catch(() => false));
  // Apuntarla
  try {
    await tO.guardar({ handle: o.handle, titulo: o.titulo, anuncio: a?.id || null, para: r.para, vendedor: r.vendedor, vendedor_email: a?.email || '', cliente: cliente || '', nombre: o.nombre, email: o.email, telefono: o.telefono, oferta: o.oferta, precio: o.precio || null, mensaje: o.mensaje, enviada: alVendedor || !a }, 'id');
  } catch (e) { console.error(e); }
  return r;
}

/* ---------------------------------------------------------------------------- Panel › Ventas › Ofertas */
export function paginaOfertas(lista, { ver = 'todas', error = '', marco, tienda = 'https://sidonia.es' }) {
  const filtros = { todas: 'Todas', sidonia: 'De Sidonia', dueno: 'De la comunidad' };
  const l = lista.filter((x) => ver === 'todas' || x.para === ver);
  const fecha = (t) => new Date(t).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  const filasHtml = l.map((x) => {
    const d = x.precio ? Math.round(((x.oferta - x.precio) / x.precio) * 100) : null;
    return `<tr><td class="izq">${fecha(x.creado)}</td>
      <td class="izq"><a href="?estado=anuncio&h=${encodeURIComponent(x.handle)}"><b>${esc(x.titulo)}</b></a><span class="sub"><a href="${esc(tienda)}/products/${esc(x.handle)}" target="_blank" rel="noopener">ver en la web</a></span></td>
      <td><b>${eur(x.oferta)}</b>${x.precio ? `<span class="sub">de ${eur(x.precio)} · ${d > 0 ? '+' : ''}${d} %</span>` : ''}</td>
      <td class="izq">${x.cliente ? `<a href="?estado=cliente&id=${encodeURIComponent(x.cliente)}">${esc(x.nombre)}</a>` : esc(x.nombre)}<span class="sub">${esc(x.email)}${x.telefono ? ` · ${esc(x.telefono)}` : ''}</span>
        <p class="contacto" style="margin-top:6px"><a href="mailto:${esc(x.email)}">Email</a>${x.telefono ? `<a href="https://wa.me/${tel(x.telefono)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</p></td>
      <td class="izq">${x.para === 'dueno' ? `${esc(x.vendedor || 'Su dueño')}<span class="sub">${x.enviada ? 'enviada a su email' : 'sin email: avísale tú'}</span>` : 'Sidonia'}</td>
      <td class="izq">${x.mensaje ? `<span class="sub" style="white-space:normal;max-width:280px;display:block">${esc(x.mensaje)}</span>` : '—'}</td></tr>`;
  }).join('');
  const total = l.length, media = l.filter((x) => x.precio).map((x) => x.oferta / x.precio);
  return marco('Ofertas', 'ofertas', `
${error ? `<p class="aviso mal">${esc(error)}</p>` : ''}
<div class="kpis">
  <div class="kpi"><span>Ofertas</span><b>${total}</b><small>${lista.filter((x) => Date.now() - Date.parse(x.creado) < 7 * 864e5).length} en los últimos 7 días</small></div>
  <div class="kpi"><span>De Sidonia</span><b>${lista.filter((x) => x.para === 'sidonia').length}</b><small>gestión de venta</small></div>
  <div class="kpi"><span>De la comunidad</span><b>${lista.filter((x) => x.para === 'dueno').length}</b><small>se le mandan al dueño</small></div>
  <div class="kpi"><span>Oferta media</span><b>${media.length ? `${Math.round((media.reduce((s, x) => s + x, 0) / media.length) * 100)} %` : '—'}</b><small>del precio publicado</small></div>
</div>
<div class="per">${Object.entries(filtros).map(([k, t]) => `<a href="?estado=ofertas&ver=${k}" class="${k === ver ? 'on' : ''}">${t}</a>`).join('')}</div>
<div class="card"><div class="tabla"><table>
  <thead><tr><th class="izq">Cuándo</th><th class="izq">Anuncio</th><th>Oferta</th><th class="izq">Quién</th><th class="izq">Para</th><th class="izq">Mensaje</th></tr></thead>
  <tbody>${filasHtml || '<tr><td colspan="6" class="vacio">Aún no hay ofertas.</td></tr>'}</tbody>
</table></div></div>
<p class="nota">Las de Sidonia os llegan por email (respondiendo, le contestáis al comprador). Las de la comunidad le llegan al dueño directamente; aquí tenéis una copia.</p>`);
}
