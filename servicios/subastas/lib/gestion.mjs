/* SIDONIA · «¿Quieres que lo vendamos nosotros?»: de anuncio de la comunidad (gratis) a gestión de venta (comisión).
 * - Al publicarlo, el email de «Ya está publicado» lo menciona (correos.mjs › correoPublicado).
 * - A los DIAS_OFRECER días, si sigue en venta (ni reservado ni vendido), le llega un email solo para esto
 *   (el repaso diario del cron, api/comunidad/revisar). Una vez por anuncio (anuncios.ofrecida_gestion).
 * - El enlace va firmado a /tienda/gestion?a=&f=: una página con lo que hacemos y el botón «Sí, quiero que lo vendáis».
 *   Al pulsarlo se guarda (anuncios.quiere_gestion), al equipo le llega un email y en el panel sale «Quiere gestión».
 * Columnas: sql/gestion.sql.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { avisarEquipo, esc, tablaAnuncios, urlFoto } from './circulo.mjs';
import { enviarCorreo, lista, P, plantilla } from './correos.mjs';
import { paginaPago as pagina } from './comunidad.mjs';

const PIE = 'Sin compromiso. Mientras tanto, tu anuncio sigue publicado.';
const paginaPago = (o) => pagina({ pie: PIE, ...o });

export const DIAS_OFRECER = 14;
const EL = { coche: 'tu coche', moto: 'tu moto', barco: 'tu barco', casa: 'tu casa' };
const el = (a) => EL[a.tipo] || 'tu anuncio';

// Lo que hace Sidonia cuando se encarga de la venta
export const QUE_HACEMOS = [
  ['Fotos y vídeo profesionales', 'Vamos a verlo y lo fotografiamos y grabamos como el resto de Sidonia.'],
  ['Lo movemos', 'Destacado en la web y en nuestro Instagram, y a la gente que nos ha pedido uno así.'],
  ['Nos encargamos de los interesados', 'Llamadas, visitas, ofertas y negociación: tú no tienes que atender a nadie.'],
  ['Papeles y pago seguros', 'Te acompañamos en el contrato, la transferencia y el cobro.']
];

export function firmaGestion(cfg, id) {
  const k = cfg.clave || cfg.adminClave;
  return k && Number(id) ? createHmac('sha256', k).update(`gestion|${Number(id)}`).digest('hex').slice(0, 32) : '';
}
export const enlaceGestion = (cfg, id) => (cfg.servidor && firmaGestion(cfg, id) ? `${cfg.servidor}/tienda/gestion?a=${Number(id)}&f=${firmaGestion(cfg, id)}` : '');
const firmaBuena = (cfg, id, f) => {
  const b = firmaGestion(cfg, id), x = String(f || '');
  return Boolean(b) && b.length === x.length && timingSafeEqual(Buffer.from(b), Buffer.from(x));
};

/** La línea del email de «Ya está publicado» */
export function lineaGestion(cfg, a) {
  const url = enlaceGestion(cfg, a.id);
  return url ? P(`¿Prefieres no tener que ocuparte de nada? <a href="${esc(url)}" style="color:#272727;font-weight:700">También podemos venderlo nosotros</a>: fotos y vídeo profesionales, interesados, visitas y papeles.`) : '';
}

/** El email de los DIAS_OFRECER días */
export function correoGestion(cfg, a) {
  return {
    asunto: `¿Quieres que vendamos ${el(a)} por ti?`,
    html: plantilla(cfg, a, {
      titulo: '¿Lo vendemos nosotros?', conFicha: true, previa: `Nos encargamos de todo: fotos, interesados, visitas y papeles.`,
      cuerpo: P(`Hola${a.vendedor_nombre ? ` ${esc(a.vendedor_nombre)}` : ''}:`)
        + P(`Tu anuncio lleva un par de semanas en Sidonia. Si prefieres no tener que ocuparte de nada, podemos encargarnos nosotros de venderlo, como hacemos con el resto de anuncios de Sidonia:`)
        + lista(QUE_HACEMOS)
        + P('No pagas nada por adelantado: solo cobramos si se vende. Si te interesa, pulsa el botón y te llamamos para contártelo sin compromiso.'),
      boton: 'Sí, quiero que lo vendáis', enlace: enlaceGestion(cfg, a.id)
    })
  };
}

/** /tienda/gestion?a=&f= : la página (GET) y el «Sí, quiero» (POST). Para los escáneres de email, solo el POST cuenta */
export async function rutasGestion({ method, query, body }, cfg, deps) {
  const id = Number(query.a || body.a);
  const f = String(query.f || body.f || '');
  if (!firmaBuena(cfg, id, f)) return paginaPago({ titulo: 'Enlace no válido', texto: '<p>Este enlace no es válido o está incompleto. Escríbenos y te ayudamos.</p>', pie: '', boton: 'Ir a Sidonia', enlace: cfg.tienda, status: 404 });
  const tabla = deps.tabla || tablaAnuncios(cfg, deps.fetch);
  const [a] = await tabla.leer(`id=eq.${id}&limit=1`);
  if (!a) return paginaPago({ titulo: 'No encontramos el anuncio', texto: '<p>Puede que ya no esté en Sidonia. Escríbenos y te ayudamos.</p>', pie: '', boton: 'Ir a Sidonia', enlace: cfg.tienda, status: 404 });
  const foto = (a.fotos || [])[0] ? urlFoto(cfg, a.fotos[0]) : '';
  const hechos = `<ul style="margin:0 0 16px;padding-left:18px">${QUE_HACEMOS.map(([t, x]) => `<li style="margin:0 0 8px"><b>${esc(t)}.</b> ${esc(x)}</li>`).join('')}</ul>`;
  if (a.quiere_gestion) {
    return paginaPago({ titulo: '¡Hecho!', foto, texto: `<p>Ya nos lo dijiste: te llamaremos muy pronto${a.telefono ? ` al ${esc(a.telefono)}` : ''} para hablar de «${esc(a.titulo)}».</p>`, boton: 'Ver mi anuncio', enlace: a.producto ? `${cfg.tienda}/products/${a.producto}` : cfg.tienda });
  }
  if (method !== 'POST') {
    return paginaPago({
      titulo: `¿Vendemos «${a.titulo}» por ti?`, foto,
      texto: `${hechos}<p>No pagas nada por adelantado: solo cobramos si se vende. Te llamamos y te lo contamos.</p>`,
      acciones: `<form method="post"><input type="hidden" name="a" value="${id}"><input type="hidden" name="f" value="${esc(f)}"><button class="b" type="submit">Sí, quiero que lo vendáis</button></form>`
    });
  }
  await tabla.cambiar(id, { quiere_gestion: new Date().toISOString() });
  try {
    await (deps.avisarEquipo || avisarEquipo)(cfg, `[Gestión] ${a.vendedor_nombre || 'Un anunciante'} quiere que vendáis «${a.titulo}»`,
      `<p><b>${esc(a.vendedor_nombre)}</b> (${a.vendedor_tipo === 'profesional' ? 'profesional' : 'particular'}) quiere que Sidonia venda su anuncio #${id}: <b>${esc(a.titulo)}</b>${a.precio ? ` · ${Number(a.precio).toLocaleString('es-ES')} €` : ''} · ${esc(a.ubicacion)}.</p>
       <p>Teléfono: <a href="tel:${esc(a.telefono)}">${esc(a.telefono)}</a>${a.email ? ` · Email: ${esc(a.email)}` : ''}</p>
       ${a.producto ? `<p><a href="${esc(cfg.tienda)}/products/${esc(a.producto)}">Ver el anuncio</a></p>` : ''}<p>Llámale para cerrar la gestión de venta.</p>`, deps.fetch || fetch);
  } catch (e) { console.error(e); }
  return paginaPago({ titulo: '¡Genial! Te llamamos', foto, texto: `<p>Nos ponemos en contacto contigo muy pronto${a.telefono ? ` (al ${esc(a.telefono)})` : ''} para hablar de «${esc(a.titulo)}». Mientras tanto, tu anuncio sigue publicado.</p>`, pie: '', boton: 'Ver mi anuncio', enlace: a.producto ? `${cfg.tienda}/products/${a.producto}` : cfg.tienda });
}

/** El repaso diario: a los publicados hace DIAS_OFRECER días, sin vender ni reservar, una vez */
export async function ofrecerGestion(cfg, deps, ahora = Date.now()) {
  const tabla = deps.tabla || tablaAnuncios(cfg, deps.fetch);
  const antes = new Date(ahora - DIAS_OFRECER * 864e5).toISOString();
  let filas;
  try {
    filas = await tabla.leer(`estado=eq.publicado&ofrecida_gestion=is.null&quiere_gestion=is.null&creado=lt.${antes}&limit=200`);
  } catch (e) { return { ofrecidos: 0, error: e.message }; }
  let ofrecidos = 0;
  for (const a of filas) {
    if (a.reservado || !a.email || !enlaceGestion(cfg, a.id)) continue;
    try {
      const c = correoGestion(cfg, a);
      await enviarCorreo(cfg, a.email, c.asunto, c.html, deps.fetch || fetch);
      await tabla.cambiar(a.id, { ofrecida_gestion: new Date(ahora).toISOString() });
      ofrecidos += 1;
    } catch (e) { console.error(e); }
  }
  return { ofrecidos };
}
