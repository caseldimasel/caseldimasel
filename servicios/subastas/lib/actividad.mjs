/* SIDONIA · Estadísticas web › «Ahora en la web»: lo último que hace cada persona en sidonia.es y en la app
 * (entra, busca, ve anuncios, escribe al vendedor, guarda, hace una oferta…), agrupado por persona (navegador) y con
 * su nombre y email si ha entrado con su cuenta. Cada anuncio con la foto de su portada en Shopify, para ubicarlo.
 * Lee la tabla eventos (sql/estadisticas.sql) y clientes (sql/circulo.sql); las fotos, de Shopify (fotosDe).
 */
import { esc, shopifyAdmin, tablaAnuncios } from './circulo.mjs';

const ORIGEN = { instagram: 'Instagram', google: 'Google', facebook: 'Facebook', whatsapp: 'WhatsApp', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn', x: 'X', bing: 'Bing', app: 'la app', email: 'un email de alertas' };
const CONTACTO = { whatsapp: 'Escribió por WhatsApp por', llamar: 'Llamó por', email: 'Mandó un email por', registro: 'Quiso contactar (le pedimos registrarse) por' };

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

export function cajaActividad(lista, fotos = {}, { tienda = 'https://sidonia.es', ahora = Date.now(), visibles = 6 } = {}) {
  if (!lista.length) return '<div class="vivo" data-vivo><p class="vacio">Aún no hay actividad.</p></div>';
  const enHora = lista.filter((g) => ahora - new Date(g.ultima) < 3600e3).length;
  const minuscula = (t) => t.charAt(0).toLowerCase() + t.slice(1);
  const anuncioDe = (e, grande) => (e.handle
    ? `<a class="vivo-an" href="${esc(tienda)}/products/${esc(e.handle)}" target="_blank" rel="noopener">${miniFoto(fotos[e.handle], e.titulo).replace('class="mini-foto', `class="mini-foto${grande ? '' : ' mini-foto--s'}`)}<span>${esc(e.titulo || e.handle)}</span></a>`
    : '');
  const persona = (g) => {
    const nombre = g.cliente ? (g.nombre || g.email || `Cliente ${g.cliente}`) : 'Alguien sin cuenta';
    const inicial = g.cliente ? esc(nombre.trim().charAt(0).toUpperCase() || '·') : '?';
    const [ultima, ...resto] = g.acciones;
    const [t, conAnuncio] = frase(ultima);
    const reciente = ahora - new Date(g.ultima) < 300e3;
    const detalle = resto.map((e) => { const [x, c] = frase(e); return `<li><span>${esc(x)}${e.veces > 1 ? ` <small>×${e.veces}</small>` : ''}</span>${c ? anuncioDe(e) : ''}<time>${hace(e.creado, ahora)}</time></li>`; }).join('');
    return `<details class="vivo-p${reciente ? ' es-ahora' : ''}"><summary>
      <span class="vivo-av${g.cliente ? ' con-cuenta' : ''}" aria-hidden="true">${inicial}</span>
      <span class="vivo-txt"><b>${esc(nombre)}</b> ${esc(minuscula(t))}${conAnuncio ? '' : ''}${ultima.veces > 1 ? ` <small>×${ultima.veces}</small>` : ''}${conAnuncio ? anuncioDe(ultima, false) : ''}</span>
      <span class="vivo-meta"><time>${hace(g.ultima, ahora)}</time>${resto.length ? `<i>+${resto.length}</i>` : ''}</span></summary>
      <div class="vivo-mas-info">${g.cliente ? `<p><a href="?estado=cliente&id=${encodeURIComponent(g.cliente)}">${esc(g.email || 'Ver cliente')} ›</a> · ${g.app ? 'App' : g.movil ? 'Móvil' : 'Ordenador'}</p>` : `<p>${g.app ? 'App' : g.movil ? 'Móvil' : 'Ordenador'} · sin cuenta</p>`}${detalle ? `<ul>${detalle}</ul>` : '<p class="vivo-solo">No ha hecho nada más.</p>'}</div>
    </details>`;
  };
  const primeros = lista.slice(0, visibles).map(persona).join('');
  const mas = lista.slice(visibles);
  return `<div class="vivo" data-vivo>
    <p class="vivo-cab"><span class="vivo-punto" aria-hidden="true"></span><b>En vivo</b> · ${enHora === 1 ? '1 persona' : `${enHora} personas`} en la última hora</p>
    <div class="vivo-lista">${primeros}</div>
    ${mas.length ? `<details class="vivo-otros"><summary>Ver ${mas.length} más</summary><div class="vivo-lista">${mas.map(persona).join('')}</div></details>` : ''}
  </div>`;
}

/** Que se actualice solo (cada 20 s), sin cerrar lo que esté abierto */
export const SCRIPT_VIVO = `<script>(() => {
  const caja = () => document.querySelector('[data-vivo]');
  setInterval(async () => {
    const c = caja();
    if (!c || document.hidden || c.querySelector('details[open]')) return;
    try {
      const u = new URL(location.href); u.searchParams.set('vivo', '1');
      const r = await fetch(u, { credentials: 'same-origin', headers: { Accept: 'text/html' } });
      if (r.ok) { const t = await r.text(); if (t.includes('data-vivo')) c.outerHTML = t; }
    } catch (e) { /* sin conexión: se intenta luego */ }
  }, 20000);
})();</script>`;

export const CSS_ACTIVIDAD = `
  .vivo-cab { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; font-size: 13px; color: var(--suave); }
  .vivo-cab b { color: var(--texto); }
  .vivo-punto { width: 9px; height: 9px; border-radius: 50%; background: var(--verde); box-shadow: 0 0 0 0 var(--verde); animation: vivo 1.8s infinite; }
  @keyframes vivo { 0% { box-shadow: 0 0 0 0 rgba(43,212,125,.55); } 70% { box-shadow: 0 0 0 8px rgba(43,212,125,0); } 100% { box-shadow: 0 0 0 0 rgba(43,212,125,0); } }
  .vivo-lista { display: grid; gap: 6px; }
  .vivo-p { border: 1px solid var(--linea); border-radius: 12px; background: var(--caja-2, var(--caja)); }
  .vivo-p.es-ahora { border-color: rgba(43,212,125,.45); }
  .vivo-p summary { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; padding: 8px 12px; cursor: pointer; list-style: none; }
  .vivo-p summary::-webkit-details-marker { display: none; }
  .vivo-av { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--caja-3, #2a2a2a); color: var(--suave); font-size: 13px; font-weight: 800; }
  .vivo-av.con-cuenta { background: var(--verde-fondo); color: var(--verde); }
  .vivo-txt { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; font-size: 13.5px; line-height: 1.35; min-width: 0; }
  .vivo-meta { display: flex; gap: 8px; align-items: center; font-size: 11.5px; color: var(--suave); white-space: nowrap; }
  .vivo-meta i { font-style: normal; padding: 1px 7px; border-radius: 99px; background: var(--caja-3, #2a2a2a); }
  .vivo-an { display: inline-flex; align-items: center; gap: 6px; color: inherit; text-decoration: none; font-weight: 700; min-width: 0; }
  .vivo-an span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 34ch; }
  .vivo-an:hover span { text-decoration: underline; }
  .vivo-mas-info { padding: 0 12px 10px 52px; font-size: 13px; color: var(--suave); }
  .vivo-mas-info p { margin: 0 0 6px; } .vivo-mas-info ul { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
  .vivo-mas-info li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; color: var(--texto); }
  .vivo-mas-info time { margin-left: auto; color: var(--suave); font-size: 11px; }
  .vivo-otros { margin-top: 8px; } .vivo-otros > summary { cursor: pointer; font-size: 13px; color: var(--suave); padding: 6px 2px; }
  .vivo-otros .vivo-lista { margin-top: 6px; }
  .mini-foto { flex: none; width: 44px; height: 44px; border-radius: 8px; object-fit: cover; background: var(--caja-3, #2a2a2a); vertical-align: middle; }
  .mini-foto--s { width: 26px; height: 26px; border-radius: 6px; }
  .mini-foto--vacia { display: inline-block; }
  td .mini-foto, .top .mini-foto { width: 40px; height: 40px; margin-right: 8px; }
  .con-foto { display: flex; align-items: center; gap: 8px; }
  @media (max-width: 600px) { .vivo-p summary { grid-template-columns: auto 1fr; } .vivo-meta { grid-column: 2; } .vivo-mas-info { padding-left: 12px; } }`;
