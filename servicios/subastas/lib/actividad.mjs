/* SIDONIA · Estadísticas web › «Ahora en la web»: lo último que hace cada persona en sidonia.es y en la app
 * (entra, busca, ve anuncios, escribe al vendedor, guarda, hace una oferta…), agrupado por persona (navegador) y con
 * su nombre y email si ha entrado con su cuenta. Cada anuncio con la foto de su portada en Shopify, para ubicarlo.
 * Lee la tabla eventos (sql/estadisticas.sql) y clientes (sql/circulo.sql); las fotos, de Shopify (fotosDe).
 */
import { esc, shopifyAdmin, tablaAnuncios } from './circulo.mjs';

const ORIGEN = { instagram: 'Instagram', google: 'Google', facebook: 'Facebook', whatsapp: 'WhatsApp', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn', x: 'X', bing: 'Bing', app: 'la app', email: 'un email de alertas' };
const CONTACTO = { whatsapp: 'Escribió por WhatsApp por', llamar: 'Llamó por', email: 'Mandó un email por', registro: 'Quiso contactar sin cuenta (le pedimos registrarse) por' };

/** Lo que ha hecho, en una frase: [texto, anuncio?] */
export function frase(e) {
  switch (e.tipo) {
    case 'visita': return [`Entró en la web${ORIGEN[e.origen] ? ` desde ${ORIGEN[e.origen]}` : e.origen && e.origen !== 'directo' ? ` desde ${e.origen}` : ''}`];
    case 'vista': return ['Vio', true];
    case 'busqueda': return [`Buscó «${e.q || ''}»`];
    case 'contacto': return [CONTACTO[e.canal] || 'Contactó por', true];
    case 'like': return ['Le dio me gusta a', true];
    case 'unlike': return ['Quitó el me gusta de', true];
    case 'compartir': return ['Compartió', true];
    case 'alerta': return ['Creó una alerta «Avísame cuando entre uno así»'];
    case 'oferta': return ['Abrió «Hacer oferta» en', true];
    default: return [e.tipo];
  }
}

// Las portadas de Shopify, guardadas un rato (cambian poco)
const cacheFotos = new Map();
const HORA = 3600e3;

/** { handle: url de la portada (pequeña) } de los anuncios que se piden, desde Shopify */
export async function fotosDe(cfg, deps, handles) {
  const out = {};
  const faltan = [];
  for (const h of new Set(handles.filter(Boolean))) {
    const c = cacheFotos.get(h);
    if (c && c.hasta > Date.now()) out[h] = c.url;
    else faltan.push(h);
  }
  if (!faltan.length || !(deps.gql || (cfg.shopifyTienda && cfg.shopifyClientId))) return out;
  const gql = deps.gql || shopifyAdmin(cfg, deps.fetch);
  for (let i = 0; i < faltan.length; i += 50) {
    const lote = faltan.slice(i, i + 50);
    try {
      const d = await gql(`query($q: String!) { products(first: 50, query: $q) { nodes { handle featuredImage { url(transform: { maxWidth: 200, maxHeight: 200 }) } } } }`,
        { q: lote.map((h) => `handle:${h}`).join(' OR ') });
      for (const p of d?.data?.products?.nodes || d?.products?.nodes || []) {
        const url = p.featuredImage?.url || '';
        out[p.handle] = url;
        cacheFotos.set(p.handle, { url, hasta: Date.now() + HORA });
      }
    } catch (e) { console.error(e); }
  }
  return out;
}

/** Lo último que ha pasado, agrupado por persona: [{ sesion, cliente, quien, email, movil, app, ultima, acciones: [...] }] */
export async function leerActividad(cfg, deps, { eventos = 300, personas = 25 } = {}) {
  const filas = await (deps.eventos || tablaAnuncios(cfg, deps.fetch, 'eventos')).leer(`select=tipo,handle,titulo,canal,q,sesion,cliente,app,movil,origen,creado&order=creado.desc&limit=${eventos}`);
  const grupos = new Map();
  for (const e of filas) {
    const k = e.cliente ? `c:${e.cliente}` : `s:${e.sesion || 'x'}`;
    if (!grupos.has(k)) grupos.set(k, { clave: k, cliente: e.cliente || '', sesion: e.sesion || '', movil: e.movil, app: e.app, ultima: e.creado, acciones: [] });
    const g = grupos.get(k);
    if (e.cliente && !g.cliente) g.cliente = e.cliente;
    // Seguidas e iguales (ver dos veces la misma ficha) cuentan una vez
    const prev = g.acciones[g.acciones.length - 1];
    if (prev && prev.tipo === e.tipo && prev.handle === e.handle && prev.q === e.q && prev.canal === e.canal) { prev.veces += 1; continue; }
    if (g.acciones.length < 12) g.acciones.push({ ...e, veces: 1 });
  }
  const lista = [...grupos.values()].slice(0, personas);
  // Quién es (si ha entrado con su cuenta)
  const ids = [...new Set(lista.map((g) => g.cliente).filter(Boolean))];
  if (ids.length) {
    try {
      const cs = await (deps.clientes || tablaAnuncios(cfg, deps.fetch, 'clientes')).leer(`cliente=in.(${ids.map((x) => encodeURIComponent(x)).join(',')})&select=cliente,email,nombre`);
      const por = new Map(cs.map((c) => [String(c.cliente), c]));
      for (const g of lista) { const c = por.get(String(g.cliente)); if (c) { g.nombre = c.nombre || ''; g.email = c.email || ''; } }
    } catch (e) { console.error(e); }
  }
  return lista;
}

const hace = (t, ahora = Date.now()) => {
  const s = Math.max(0, Math.round((ahora - new Date(t)) / 1000));
  if (s < 60) return 'ahora mismo';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return new Date(t).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

/** Una foto pequeña de la portada (o un hueco gris si no hay) */
export const miniFoto = (url, alt = '') => (url
  ? `<img class="mini-foto" src="${esc(url)}" alt="${esc(alt)}" loading="lazy" width="44" height="44">`
  : '<span class="mini-foto mini-foto--vacia" aria-hidden="true"></span>');

export function cajaActividad(lista, fotos = {}, { tienda = 'https://sidonia.es', ahora = Date.now() } = {}) {
  if (!lista.length) return '<p class="vacio">Aún no hay actividad.</p>';
  const persona = (g) => {
    const quien = g.cliente
      ? `<a href="?estado=cliente&id=${encodeURIComponent(g.cliente)}"><b>${esc(g.nombre || g.email || `Cliente ${g.cliente}`)}</b></a>${g.email && g.nombre ? ` <small>${esc(g.email)}</small>` : ''}`
      : `<b>Visitante sin cuenta</b> <small>#${esc(String(g.sesion).slice(-4) || '—')}</small>`;
    const dispositivo = g.app ? 'App' : g.movil ? 'Móvil' : 'Ordenador';
    const acciones = g.acciones.map((e) => {
      const [t, conAnuncio] = frase(e);
      const anuncio = conAnuncio && e.handle
        ? `<a class="act-anuncio" href="${esc(tienda)}/products/${esc(e.handle)}" target="_blank" rel="noopener">${miniFoto(fotos[e.handle], e.titulo)}<span>${esc(e.titulo || e.handle)}</span></a>`
        : '';
      return `<li><span class="act-texto">${esc(t)}${e.veces > 1 ? ` <small>×${e.veces}</small>` : ''}</span>${anuncio}<time>${hace(e.creado, ahora)}</time></li>`;
    }).join('');
    return `<article class="act-persona"><header>${quien}<span class="act-disp">${dispositivo} · ${hace(g.ultima, ahora)}</span></header><ul>${acciones}</ul></article>`;
  };
  return `<div class="act">${lista.map(persona).join('')}</div>`;
}

export const CSS_ACTIVIDAD = `
  .act { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); }
  .act-persona { padding: 12px 14px; border: 1px solid var(--linea); border-radius: 14px; background: var(--caja-2, var(--caja)); }
  .act-persona header { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; margin: 0 0 8px; }
  .act-persona header small, .act-disp { color: var(--suave); font-size: 12px; } .act-disp { margin-left: auto; }
  .act-persona ul { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
  .act-persona li { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; align-items: center; font-size: 13px; line-height: 1.35; }
  .act-persona li time { color: var(--flojo, var(--suave)); font-size: 11px; white-space: nowrap; }
  .act-anuncio { grid-column: 1 / -1; display: flex; gap: 8px; align-items: center; color: inherit; text-decoration: none; }
  .act-anuncio span { font-weight: 600; } .act-anuncio:hover span { text-decoration: underline; }
  .mini-foto { flex: none; width: 44px; height: 44px; border-radius: 8px; object-fit: cover; background: var(--caja-3, #2a2a2a); vertical-align: middle; }
  .mini-foto--vacia { display: inline-block; }
  td .mini-foto, .top .mini-foto { width: 40px; height: 40px; margin-right: 8px; }
  .con-foto { display: flex; align-items: center; gap: 8px; }`;
