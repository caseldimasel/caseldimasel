/* SIDONIA · Invitación a un evento para quien puja (la subasta del 600 SL: la inauguración de Arka).
 *
 * En la ficha de la subasta (Shopify) se rellenan los metacampos subasta.invitacion_evento, _fecha, _lugar y _texto.
 * El tema los manda firmados con la clave del motor junto a la sincronización (api/sincronizar), y se guardan en
 * subasta_invitaciones. La primera vez que alguien puja en esa subasta, le llega un email: «Gracias por pujar: te
 * invitamos a…». Una sola vez por persona y subasta (invitaciones_enviadas). Sin Resend o sin evento, no se manda nada.
 * Tablas: sql/invitaciones.sql.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { tablaAnuncios, esc, shopifyAdmin } from './circulo.mjs';
import { enviarCorreo, plantilla, P, datos } from './correos.mjs';

const tabla = (cfg, deps, n) => deps[n] || tablaAnuncios(cfg, deps.fetch, n);
const clip = (t, n) => String(t ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').trim().slice(0, n);

/** Lo que manda el tema: el JSON de la invitación, firmado con «inv|handle|json». null si no cuadra. */
export function leerInvitacion(handle, json, firma, clave) {
  if (!clave || !handle || typeof json !== 'string' || typeof firma !== 'string' || json.length > 4000) return null;
  const a = createHmac('sha256', clave).update(`inv|${handle}|${json}`).digest();
  const b = Buffer.from(firma.replace(/[^0-9a-f]/gi, ''), 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let d;
  try { d = JSON.parse(json); } catch { return null; }
  const inv = { evento: clip(d.evento, 160), fecha: clip(d.fecha, 160), lugar: clip(d.lugar, 240), texto: clip(d.texto, 2000) };
  return inv.evento ? inv : null;
}

/** Guarda (o pone al día) la invitación de una subasta */
export async function guardarInvitacion(cfg, deps, handle, inv, titulo = '') {
  await tabla(cfg, deps, 'subasta_invitaciones').guardar({ handle: String(handle), ...inv, titulo: clip(titulo, 300), actualizado: new Date().toISOString() }, 'handle');
}

/** El email de quien puja: el que dejó al registrarse o, si no, el de su cuenta de Shopify */
async function emailDe(cfg, deps, cliente, pujador) {
  if (pujador?.email) return String(pujador.email);
  if (!(deps.gql || (cfg.shopifyTienda && cfg.shopifyClientId))) return '';
  try {
    const gql = deps.gql || shopifyAdmin(cfg, deps.fetch);
    const d = await gql('query($id: ID!) { customer(id: $id) { email firstName } }', { id: `gid://shopify/Customer/${cliente}` });
    return d?.customer?.email || '';
  } catch (e) { console.error(e); return ''; }
}

export function correoInvitacion(cfg, { inv, alias, titulo, url }) {
  const filas = [['Evento', inv.evento], ...(inv.fecha ? [['Cuándo', inv.fecha]] : []), ...(inv.lugar ? [['Dónde', inv.lugar]] : [])];
  return {
    asunto: `Gracias por pujar: te invitamos a ${inv.evento}`,
    html: plantilla(cfg, null, {
      titulo: 'Gracias por pujar', previa: `Te invitamos a ${inv.evento} para que veas el coche en persona.`,
      cuerpo: P(`Hola${alias ? ` ${esc(alias)}` : ''}:`)
        + P(`Gracias por pujar por el <b>${esc(titulo || 'coche')}</b>. Por pujar, te invitamos a <b>${esc(inv.evento)}</b>: podrás ver el coche de cerca, conocer las instalaciones y vivir el final de la subasta en directo.`)
        + datos(filas)
        + (inv.texto ? inv.texto.split(/\n+/).filter((x) => x.trim()).map((x) => P(esc(x))).join('') : '')
        + P('Puedes seguir pujando desde la web hasta el último minuto, también el mismo día del evento.'),
      boton: 'Ver la subasta', enlace: url
    })
  };
}

/**
 * Tras una puja: si la subasta tiene invitación y a esa persona aún no se le ha mandado, se le manda.
 * No lanza nunca (una puja no puede fallar por el email). Devuelve 'enviada' | 'ya' | 'sin-invitacion' | 'sin-email' | 'off'.
 */
export async function invitarSiToca(cfg, deps, { handle, cliente }) {
  if (!cfg.resendKey || !handle || !cliente) return 'off';
  try {
    const [inv] = await tabla(cfg, deps, 'subasta_invitaciones').leer(`handle=eq.${encodeURIComponent(handle)}&limit=1`);
    if (!inv || !inv.evento) return 'sin-invitacion';
    const pujador = deps.db ? await deps.db('sidonia_pujador', { p_cliente: String(cliente) }).catch(() => null) : null;
    const email = await emailDe(cfg, deps, cliente, pujador);
    if (!email) return 'sin-email';
    // Se apunta antes de mandar: si ya estaba (o llegan dos pujas a la vez), no se manda otra vez
    const nueva = await tabla(cfg, deps, 'invitaciones_enviadas').apuntar({ handle: String(handle), cliente: String(cliente), email, enviado: new Date().toISOString() }, 'handle,cliente');
    if (!nueva) return 'ya';
    const { asunto, html } = correoInvitacion(cfg, { inv, alias: pujador?.alias || '', titulo: inv.titulo || '', url: `${cfg.tienda}/products/${encodeURIComponent(handle)}` });
    await enviarCorreo(cfg, email, asunto, html, deps.fetch || fetch);
    return 'enviada';
  } catch (e) { console.error('Sidonia · invitación', e); return 'error'; }
}
