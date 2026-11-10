/* SIDONIA · Panel › Estadísticas: quién contacta a quién.
 *
 *   - Contactos a Sidonia (los coches que vendemos: WhatsApp y llamadas) y entre la comunidad (los coches de sus dueños:
 *     llamadas y mensajes por el chat de Sidonia), desde la tabla «eventos» de las estadísticas.
 *   - Las conversaciones del chat de Sidonia (tablas «chats» y «chat_mensajes», sql/chat.sql): cuántas, cuántos mensajes
 *     y qué se han dicho, para ver si de verdad se hablan.
 *
 * Un anuncio es «de la comunidad» si es el producto de un anuncio de la tabla «anuncios» (lo publicó su dueño).
 */
import { esc, tablaAnuncios } from './circulo.mjs';

const tabla = (cfg, deps, n) => (deps.tablas && deps.tablas[n]) || tablaAnuncios(cfg, deps.fetch, n);
const fmt = (x) => (Number(x) || 0).toLocaleString('es-ES');
const fecha = (d) => new Date(d).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Lee todas las filas (Supabase da como mucho 1000 por llamada) */
async function todas(t, filtro, max = 30) {
  const filas = [];
  for (let pag = 0; pag < max; pag += 1) {
    const trozo = await t.leer(`${filtro}&limit=1000&offset=${pag * 1000}`);
    filas.push(...trozo);
    if (trozo.length < 1000) break;
  }
  return filas;
}

/** Los números: contactos a Sidonia y entre la comunidad, conversaciones y mensajes, y por coche */
export async function resumenContactos(cfg, deps, dias = 30) {
  const desde = new Date(Date.now() - dias * 864e5).toISOString();
  const [eventos, anuncios, chats, mensajes] = await Promise.all([
    todas(tabla(cfg, deps, 'eventos'), `select=handle,titulo,canal&tipo=eq.contacto&canal=neq.registro&creado=gte.${desde}&order=id.asc`),
    todas(tabla(cfg, deps, 'anuncios'), 'select=producto&producto=not.is.null&order=id.asc').catch(() => []),
    todas(tabla(cfg, deps, 'chats'), `select=id,tipo,titulo,url&creado=gte.${desde}&order=id.asc`).catch(() => []),
    todas(tabla(cfg, deps, 'chat_mensajes'), `select=chat_id&creado=gte.${desde}&order=id.asc`).catch(() => [])
  ]);
  const comunidad = new Set(anuncios.map((a) => a.producto));
  const r = {
    dias,
    sidonia: { total: 0, whatsapp: 0, llamar: 0, email: 0 },
    comunidad: { total: 0, chat: 0, llamar: 0, whatsapp: 0, email: 0 },
    conversaciones: chats.filter((c) => c.tipo === 'venta').length,
    conversaciones_alquiler: chats.filter((c) => c.tipo !== 'venta').length,
    mensajes: mensajes.length,
    coches: []
  };
  const porCoche = new Map();
  for (const e of eventos) {
    const deDueno = comunidad.has(e.handle) || e.canal === 'chat';
    const g = deDueno ? r.comunidad : r.sidonia;
    g.total += 1;
    if (e.canal in g) g[e.canal] += 1;
    if (!e.handle) continue;
    const c = porCoche.get(e.handle) || { handle: e.handle, titulo: e.titulo || e.handle, de: deDueno ? 'comunidad' : 'sidonia', total: 0, llamar: 0, whatsapp: 0, chat: 0, email: 0 };
    c.total += 1;
    if (e.canal in c) c[e.canal] += 1;
    porCoche.set(e.handle, c);
  }
  r.coches = [...porCoche.values()].sort((a, b) => b.total - a.total).slice(0, 15);
  return r;
}

/** La caja destacada de arriba de Estadísticas */
export function cajaContactos(r, { tienda = 'https://sidonia.es', dias = 30 } = {}) {
  if (!r) return '';
  const s = r.sidonia, c = r.comunidad;
  const det = (o, campos) => campos.filter(([k]) => o[k]).map(([k, t]) => `${fmt(o[k])} ${t}`).join(' · ') || 'Ninguno todavía';
  const filas = r.coches.map((x) => `<tr><td class="izq"><a href="${esc(tienda)}/products/${esc(x.handle)}" target="_blank" rel="noopener">${esc(x.titulo)}</a><br><small>${x.de === 'comunidad' ? 'De su dueño' : 'De Sidonia'}</small></td><td><b>${fmt(x.total)}</b></td><td>${fmt(x.llamar)}</td><td>${fmt(x.whatsapp)}</td><td>${fmt(x.chat)}</td></tr>`).join('');
  return `<div class="card destacada">
  <h2>Contactos</h2>
  <div class="contactos">
    <div><span>A Sidonia</span><b>${fmt(s.total)}</b><small>${det(s, [['whatsapp', 'WhatsApp'], ['llamar', 'llamadas'], ['email', 'emails']])}</small></div>
    <div><span>A los dueños</span><b>${fmt(c.total)}</b><small>${det(c, [['chat', 'por el chat'], ['llamar', 'llamadas'], ['whatsapp', 'WhatsApp'], ['email', 'emails']])}</small></div>
    <a href="?estado=conversaciones&dias=${dias}"><span>Conversaciones en el chat</span><b>${fmt(r.conversaciones)}</b><small>${fmt(r.mensajes)} mensajes · Leerlas ›</small></a>
  </div>
  ${filas ? `<details><summary>Por coche</summary><div class="tabla"><table><thead><tr><th class="izq">Coche</th><th>Total</th><th>Llamadas</th><th>WhatsApp</th><th>Chat</th></tr></thead><tbody>${filas}</tbody></table></div></details>` : ''}
</div>`;
}

export const CSS_CONTACTOS = `
  .destacada { border: 2px solid var(--texto, #111); }
  .contactos { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 0 0 10px; }
  @media (max-width: 700px) { .contactos { grid-template-columns: 1fr; } }
  .contactos > * { display: grid; gap: 2px; padding: 14px; border-radius: 14px; background: var(--fondo-2); color: inherit; text-decoration: none; }
  .contactos span { font-size: 13px; font-weight: 700; color: var(--suave); }
  .contactos b { font-size: 34px; line-height: 1.05; }
  .contactos small { color: var(--suave); }
  .contactos a:hover { outline: 1px solid var(--linea); }
  .hilo { display: grid; gap: 8px; max-width: 720px; }
  .msg { max-width: 85%; padding: 10px 12px; border-radius: 14px; background: var(--fondo-2); white-space: pre-wrap; }
  .msg.dueno { justify-self: end; background: var(--texto, #111); color: var(--caja, #fff); }
  .msg small { display: block; margin-bottom: 3px; font-size: 11px; font-weight: 700; opacity: .7; }
  .chats a.fila { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; padding: 12px 0; border-bottom: 1px solid var(--linea); color: inherit; text-decoration: none; }
  .chats a.fila small { color: var(--suave); }
`;

const TIPO = { venta: 'Venta', alquiler: 'Alquiler', peticion: 'Petición de alquiler' };

/** Panel › Estadísticas › Conversaciones: la lista */
export async function listaConversaciones(cfg, deps, dias = 30) {
  const desde = new Date(Date.now() - dias * 864e5).toISOString();
  const chats = await tabla(cfg, deps, 'chats').leer(`select=*&actualizado=gte.${desde}&order=actualizado.desc&limit=300`);
  const ids = chats.map((c) => c.id);
  const cuenta = {};
  if (ids.length) {
    const ms = await todas(tabla(cfg, deps, 'chat_mensajes'), `select=chat_id&chat_id=in.(${ids.join(',')})&order=id.asc`);
    for (const m of ms) cuenta[m.chat_id] = (cuenta[m.chat_id] || 0) + 1;
  }
  return chats.map((c) => ({ ...c, mensajes: cuenta[c.id] || 0 }));
}

export function paginaConversacionesHtml(lista, { dias = 30 } = {}) {
  const per = [[7, '7 días'], [30, '30 días'], [90, '3 meses'], [365, '1 año']].map(([k, t]) => `<a href="?estado=conversaciones&dias=${k}" class="${k === dias ? 'on' : ''}">${t}</a>`).join('');
  const filas = lista.map((c) => `<a class="fila" href="?estado=chat&id=${c.id}">
    <span><b>${esc(c.cliente_nombre || 'Alguien')}</b> → <b>${esc(c.dueno_nombre || 'el dueño')}</b> · ${esc(c.titulo)}<br><small>${esc(TIPO[c.tipo] || c.tipo)} · «${esc(String(c.ultimo || '').slice(0, 90))}»</small></span>
    <span style="text-align:right"><b>${fmt(c.mensajes)}</b> <small>mensajes</small><br><small>${fecha(c.actualizado)}</small></span></a>`).join('');
  return `<div class="per">${per}</div>
<div class="card chats"><h2>Conversaciones del chat de Sidonia</h2>
<p class="nota">Quién ha escrito a quién y cuántos mensajes. Pulsa una para leerla.</p>
${filas || '<p class="vacio">Nadie ha escrito por el chat en este tiempo.</p>'}</div>`;
}

/** Una conversación entera */
export async function leerConversacion(cfg, deps, id) {
  const [chat] = await tabla(cfg, deps, 'chats').leer(`select=*&id=eq.${Number(id)}&limit=1`);
  if (!chat) return null;
  const mensajes = await todas(tabla(cfg, deps, 'chat_mensajes'), `select=*&chat_id=eq.${Number(id)}&order=creado.asc`);
  return { chat, mensajes };
}

export function paginaConversacionHtml(d, { tienda = 'https://sidonia.es' } = {}) {
  if (!d) return '<p class="vacio">No encuentro esa conversación.</p>';
  const { chat: c, mensajes } = d;
  const quien = (de) => (String(de) === String(c.dueno) ? c.dueno_nombre || 'Dueño' : c.cliente_nombre || 'Interesado');
  const msgs = mensajes.map((m) => `<div class="msg${String(m.de) === String(c.dueno) ? ' dueno' : ''}"><small>${esc(quien(m.de))} · ${fecha(m.creado)}</small>${esc(m.texto)}</div>`).join('');
  return `<p><a href="?estado=conversaciones">‹ Todas las conversaciones</a></p>
<div class="card"><h2>${esc(c.titulo)}</h2>
<p class="nota">${esc(TIPO[c.tipo] || c.tipo)} · <b>${esc(c.cliente_nombre || 'Interesado')}</b>${c.cliente_email ? ` (${esc(c.cliente_email)})` : ''} escribe a <b>${esc(c.dueno_nombre || 'el dueño')}</b> · ${mensajes.length} mensajes${c.url ? ` · <a href="${esc(c.url.startsWith('http') ? c.url : tienda + c.url)}" target="_blank" rel="noopener">Ver el anuncio</a>` : ''}</p>
<div class="hilo">${msgs || '<p class="vacio">Sin mensajes.</p>'}</div></div>`;
}
