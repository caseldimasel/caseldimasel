/* SIDONIA · Círculo: anuncios de la comunidad (coches, barcos y casas), revisados por Sidonia.
 *
 * Desde la tienda (proxy de la app, con la sesión del cliente; ver motor.mjs):
 *   GET  api/anuncio          → { ok, anuncio }   su anuncio activo (o el último), o null
 *   POST api/anuncio/fotos    { tipos: ['image/jpeg', …] } → { ok, subidas: [{ ruta, url }] }   permisos para subir fotos
 *   POST api/anuncio          { tipo, titulo, precio, … }  → { ok, anuncio } | { ok: false, error, campo }
 * Panel del equipo (directo en Vercel, con contraseña): /admin → lista, aprobar y publicar en Shopify, rechazar, retirar.
 *
 * Un anuncio activo gratis por persona (lo garantiza la base de datos: sql/circulo.sql).
 */
import { createHash } from 'node:crypto';

export const TIPOS = ['coche', 'barco', 'casa'];
export const FOTOS_MIN = Number(process.env.CIRCULO_FOTOS_MIN || 8);
export const FOTOS_MAX = 30;
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const texto = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
export const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** El perfil público del vendedor: «enrique-4f2a» (nombre + 4 letras fijas por cliente, para que no se repitan) */
export function slugVendedor(nombre, cliente) {
  const base = String(nombre).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'vendedor';
  return `${base}-${createHash('sha256').update(`sidonia:${cliente}`).digest('hex').slice(0, 4)}`;
}

/** Teléfono: solo dígitos y «+» delante; España por defecto (9 cifras → +34) */
export function telefono(v) {
  let t = String(v ?? '').replace(/[^\d+]/g, '');
  if (t.startsWith('00')) t = `+${t.slice(2)}`;
  if (/^[6789]\d{8}$/.test(t)) t = `+34${t}`;
  return /^\+\d{9,15}$/.test(t) ? t : '';
}

/** Revisa la solicitud. Devuelve { ok: true, datos } o { ok: false, error, campo } */
export function validar(b, cliente) {
  const fallo = (campo, error = 'datos') => ({ ok: false, error, campo });
  const tipo = String(b.tipo || '');
  if (!TIPOS.includes(tipo)) return fallo('tipo');
  const titulo = texto(b.titulo, 120);
  if (titulo.length < 4) return fallo('titulo');
  let precio = null;
  if (b.precio !== '' && b.precio != null && !b.precio_consultar) {
    precio = Math.round(Number(String(b.precio).replace(/[.\s€]/g, '').replace(',', '.')));
    if (!(precio > 0) || precio > 1e9) return fallo('precio');
  }
  const ubicacion = texto(b.ubicacion, 120);
  if (ubicacion.length < 2) return fallo('ubicacion');
  const resumen = texto(b.resumen, 600);
  if (resumen.length < 20) return fallo('resumen');
  const historia = texto(b.historia, 8000);
  if (historia.length < 150) return fallo('historia');
  const mecanica = texto(b.mecanica, 6000);
  if (mecanica.length < 40) return fallo('mecanica');
  const ficha = (Array.isArray(b.ficha) ? b.ficha : [])
    .map((f) => [texto(Array.isArray(f) ? f[0] : '', 40), texto(Array.isArray(f) ? f[1] : '', 160)])
    .filter(([k, v]) => k && v).slice(0, 40);
  if (ficha.length < 3) return fallo('ficha');
  const fotos = (Array.isArray(b.fotos) ? b.fotos : []).map(String);
  const propia = new RegExp(`^${String(cliente).replace(/\W/g, '')}/[a-z0-9-]{8,64}\\.(jpg|png|webp)$`);
  if (fotos.length < FOTOS_MIN || fotos.length > FOTOS_MAX || !fotos.every((f) => propia.test(f)) || new Set(fotos).size !== fotos.length) return fallo('fotos');
  const vendedor_nombre = texto(b.vendedor_nombre, 40).replace(/[<>]/g, '');
  if (vendedor_nombre.length < 2) return fallo('vendedor_nombre');
  const tel = telefono(b.telefono);
  if (!tel) return fallo('telefono');
  if (!b.acepta_telefono) return fallo('acepta_telefono');
  if (!b.condiciones) return fallo('condiciones');
  return {
    ok: true,
    datos: {
      tipo, titulo, precio, ubicacion, resumen, historia, mecanica, ficha, fotos,
      vendedor_nombre, vendedor_slug: slugVendedor(vendedor_nombre, cliente), telefono: tel,
      email: texto(b.email, 160), acepta_telefono: true
    }
  };
}

/* ---------------------------------------------------------------------------- Fotos (Supabase Storage) */
export const urlFoto = (cfg, ruta) => `${cfg.supabaseUrl}/storage/v1/object/public/anuncios/${ruta}`;

/** Permisos para subir: una dirección firmada por foto, dentro de la carpeta del cliente */
export async function permisosSubida(cfg, cliente, tipos, fetchImpl = fetch) {
  const lista = (Array.isArray(tipos) ? tipos : []).slice(0, FOTOS_MAX);
  if (!lista.length || !lista.every((t) => EXT[t])) return { ok: false, error: 'tipo' };
  const carpeta = String(cliente).replace(/\W/g, '');
  const subidas = await Promise.all(lista.map(async (t) => {
    const ruta = `${carpeta}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.${EXT[t]}`;
    const r = await fetchImpl(`${cfg.supabaseUrl}/storage/v1/object/upload/sign/anuncios/${ruta}`, {
      method: 'POST',
      headers: { apikey: cfg.supabaseKey, ...(cfg.supabaseKey.startsWith('sb_') ? {} : { Authorization: `Bearer ${cfg.supabaseKey}` }), 'Content-Type': 'application/json' },
      body: '{}'
    });
    if (!r.ok) throw new Error(`Storage ${r.status}: ${await r.text().catch(() => '')}`);
    const d = await r.json();
    return { ruta, url: `${cfg.supabaseUrl}/storage/v1${d.url}` };
  }));
  return { ok: true, subidas };
}

/* ---------------------------------------------------------------------------- Rutas de la tienda */
export async function rutasTienda({ ruta, method, body }, cliente, cfg, deps) {
  const json = (status, b) => ({ status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(b) });
  if (!cliente) return json(200, { ok: false, error: 'login' });
  const { db } = deps;
  if (ruta === 'api/anuncio' && method === 'GET') return json(200, { ok: true, anuncio: await db('sidonia_anuncio_mio', { p_cliente: cliente }) });
  if (ruta === 'api/anuncio/fotos' && method === 'POST') {
    const mio = await db('sidonia_anuncio_mio', { p_cliente: cliente });
    if (mio && ['pendiente', 'aprobado', 'publicado'].includes(mio.estado)) return json(200, { ok: false, error: 'limite', anuncio: mio });
    return json(200, await (deps.subidas || permisosSubida)(cfg, cliente, body.tipos));
  }
  if (ruta === 'api/anuncio' && method === 'POST') {
    const v = validar(body, cliente);
    if (!v.ok) return json(400, v);
    return json(200, await db('sidonia_anuncio_nuevo', { p_cliente: cliente, p: v.datos }));
  }
  return null;
}

/* ---------------------------------------------------------------------------- Ficha en Shopify */
const parrafos = (t) => t.split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('');

/** La descripción con el formato de las fichas de Sidonia (historia, ficha técnica y ubicación) */
export function descripcionHtml(a) {
  const mec = a.tipo === 'casa' ? 'Estado y reformas' : 'Mecánica y estado';
  return [
    parrafos(a.resumen),
    '<h3>Historia</h3>', parrafos(a.historia),
    `<h3>${mec}</h3>`, parrafos(a.mecanica),
    '<h3>Ficha técnica</h3>', `<ul>${(a.ficha || []).map(([k, v]) => `<li>${esc(k)}: ${esc(v)}</li>`).join('')}</ul>`,
    '<h3>Ubicación</h3>', `<p>${esc(a.ubicacion)}</p>`
  ].join('\n');
}

export function productoShopify(cfg, a) {
  const tipoTag = { coche: 'coche', barco: 'barco', casa: 'casa' }[a.tipo];
  return {
    product: {
      title: a.titulo,
      descriptionHtml: descripcionHtml(a),
      vendor: 'Círculo Sidonia',
      productType: 'Cars',
      tags: ['circulo', tipoTag, `vendedor-${a.vendedor_slug}`],
      templateSuffix: 'cars',
      status: 'ACTIVE',
      metafields: [
        { namespace: 'custom', key: 'vendedor_nombre', type: 'single_line_text_field', value: a.vendedor_nombre },
        { namespace: 'custom', key: 'vendedor_slug', type: 'single_line_text_field', value: a.vendedor_slug },
        { namespace: 'custom', key: 'vendedor_telefono', type: 'single_line_text_field', value: a.telefono },
        { namespace: 'custom', key: 'circulo_id', type: 'single_line_text_field', value: String(a.id) }
      ]
    },
    media: (a.fotos || []).map((f, i) => ({ originalSource: urlFoto(cfg, f), mediaContentType: 'IMAGE', alt: i === 0 ? a.titulo : `${a.titulo} · foto ${i + 1}` }))
  };
}

/** Admin API de Shopify con la app de Sidonia (Dev Dashboard): token por «client credentials», dura 24 h */
let tokenCache = null;
export function shopifyAdmin(cfg, fetchImpl = fetch) {
  const tokenOk = async () => {
    if (tokenCache && tokenCache.hasta > Date.now() + 60e3 && tokenCache.tienda === cfg.shopifyTienda) return tokenCache.token;
    const r = await fetchImpl(`https://${cfg.shopifyTienda}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.shopifyClientId, client_secret: cfg.secreto }).toString()
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.access_token) throw new Error(`Shopify token ${r.status}: ${JSON.stringify(d).slice(0, 300)}`);
    tokenCache = { token: d.access_token, hasta: Date.now() + (Number(d.expires_in) || 3600) * 1000, tienda: cfg.shopifyTienda };
    return d.access_token;
  };
  return async (query, variables = {}) => {
    const r = await fetchImpl(`https://${cfg.shopifyTienda}/admin/api/2025-01/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await tokenOk() },
      body: JSON.stringify({ query, variables })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.errors) throw new Error(`Shopify ${r.status}: ${JSON.stringify(d.errors || d).slice(0, 400)}`);
    return d.data;
  };
}

/** Crea la ficha en Shopify (producto activo, con fotos, precio y en la tienda online). Devuelve { handle, url } */
export async function publicarEnShopify(cfg, a, gql) {
  const { product, media } = productoShopify(cfg, a);
  const c = await gql(`mutation($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
    productCreate(product: $product, media: $media) { product { id handle onlineStoreUrl variants(first: 1) { nodes { id } } } userErrors { field message } }
  }`, { product, media });
  const errs = c.productCreate.userErrors;
  if (errs.length) throw new Error(`Shopify: ${errs.map((e) => e.message).join(' · ')}`);
  const p = c.productCreate.product;
  const v = p.variants.nodes[0];
  if (v) {
    const u = await gql(`mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } }
    }`, { productId: p.id, variants: [{ id: v.id, price: String(a.precio || 0), inventoryPolicy: 'CONTINUE' }] });
    const ue = u.productVariantsBulkUpdate.userErrors;
    if (ue.length) throw new Error(`Shopify precio: ${ue.map((e) => e.message).join(' · ')}`);
  }
  // En la tienda online (canal de venta)
  const pubs = await gql('{ publications(first: 20) { nodes { id name } } }');
  const tienda = pubs.publications.nodes.find((n) => /online store|tienda online/i.test(n.name)) || pubs.publications.nodes[0];
  if (tienda) {
    const pr = await gql(`mutation($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { field message } } }`,
      { id: p.id, input: [{ publicationId: tienda.id }] });
    const pe = pr.publishablePublish.userErrors;
    if (pe.length) throw new Error(`Shopify canal: ${pe.map((e) => e.message).join(' · ')}`);
  }
  return { handle: p.handle, url: `${cfg.tienda}/products/${p.handle}` };
}

/* ---------------------------------------------------------------------------- Panel del equipo */
const ESTADOS = { pendiente: 'Por revisar', aprobado: 'Aprobado', publicado: 'Publicado', rechazado: 'Rechazado', retirado: 'Retirado' };

export function paginaPanel(cfg, lista, { estado = 'pendiente', aviso = '' } = {}) {
  const fmt = (n) => (n ? `${Number(n).toLocaleString('es-ES')} €` : 'A consultar');
  const pestañas = Object.entries(ESTADOS).map(([k, v]) => `<a href="?estado=${k}" class="${k === estado ? 'on' : ''}">${v}</a>`).join('');
  const tarjetas = lista.map((a) => `
  <article class="a">
    <div class="fotos">${(a.fotos || []).map((f, i) => `<a href="${esc(urlFoto(cfg, f))}" target="_blank"><img src="${esc(urlFoto(cfg, f))}" alt="" loading="lazy">${i === 0 ? '<b>Portada</b>' : ''}</a>`).join('')}</div>
    <div class="cuerpo">
      <p class="meta">#${a.id} · ${esc(a.tipo)} · ${new Date(a.creado).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })} · <span class="est est-${esc(a.estado)}">${esc(ESTADOS[a.estado] || a.estado)}</span></p>
      <h2>${esc(a.titulo)} <small>${fmt(a.precio)} · ${esc(a.ubicacion)}</small></h2>
      <p class="vend">Lo vende <b>${esc(a.vendedor_nombre)}</b> · <a href="tel:${esc(a.telefono)}">${esc(a.telefono)}</a>${a.email ? ` · ${esc(a.email)}` : ''} · ${(a.fotos || []).length} fotos</p>
      <p class="res">${esc(a.resumen)}</p>
      <details><summary>Historia, mecánica y ficha técnica</summary>
        <h3>Historia</h3>${parrafos(a.historia)}
        <h3>${a.tipo === 'casa' ? 'Estado y reformas' : 'Mecánica y estado'}</h3>${parrafos(a.mecanica)}
        <h3>Ficha técnica</h3><table>${(a.ficha || []).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
      </details>
      ${a.nota ? `<p class="nota">Nota: ${esc(a.nota)}</p>` : ''}
      ${a.producto ? `<p><a href="${esc(cfg.tienda)}/products/${esc(a.producto)}" target="_blank">Ver la ficha en la tienda →</a></p>` : ''}
      <form method="post" class="acc">
        <input type="hidden" name="id" value="${a.id}">
        ${['pendiente', 'aprobado'].includes(a.estado) ? '<button name="accion" value="publicar" class="si">Aprobar y publicar en Shopify</button>' : ''}
        ${a.estado === 'pendiente' ? '<input name="nota" placeholder="Motivo si lo rechazas (lo verá el vendedor)"><button name="accion" value="rechazar" class="no">Rechazar</button>' : ''}
        ${a.estado === 'publicado' ? '<button name="accion" value="retirar" class="no">Marcar como retirado</button>' : ''}
      </form>
    </div>
  </article>`).join('') || '<p class="vacio">No hay anuncios aquí.</p>';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Círculo · Panel de Sidonia</title><meta name="robots" content="noindex">
<style>
  :root { color-scheme: light; font-family: system-ui, -apple-system, Segoe UI, sans-serif; color: #1a1a1a; background: #f6f5f2; }
  body { max-width: 1100px; margin: 0 auto; padding: 24px 16px 80px; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
  h1 { margin: 0; letter-spacing: .2em; font-size: 18px; }
  nav { display: flex; gap: 6px; flex-wrap: wrap; margin: 18px 0; }
  nav a { padding: 8px 14px; border: 1px solid #0002; border-radius: 99px; color: inherit; text-decoration: none; font-size: 14px; background: #fff; }
  nav a.on { border-color: #1a1a1a; font-weight: 700; }
  .aviso { padding: 12px 16px; border-radius: 12px; background: #e6f4ec; color: #1f7a4d; font-weight: 600; }
  .aviso.mal { background: #fde8ea; color: #a2121f; }
  .a { display: grid; gap: 14px; margin: 18px 0; padding: 16px; border-radius: 18px; background: #fff; box-shadow: 0 1px 2px #0000000d; }
  .fotos { display: flex; gap: 8px; overflow-x: auto; }
  .fotos a { position: relative; flex: none; }
  .fotos img { width: 150px; height: 112px; object-fit: cover; border-radius: 10px; display: block; }
  .fotos b { position: absolute; left: 6px; top: 6px; padding: 2px 8px; border-radius: 99px; background: #fff; font-size: 11px; }
  h2 { margin: 0; font-size: 20px; } h2 small { font-weight: 400; opacity: .6; font-size: 14px; }
  .meta, .vend { margin: 0; font-size: 13px; opacity: .75; } .res { margin: 0; }
  .est { padding: 1px 8px; border-radius: 99px; background: #eee; } .est-pendiente { background: #fff3cd; } .est-publicado { background: #e6f4ec; } .est-rechazado { background: #fde8ea; }
  details summary { cursor: pointer; font-weight: 600; } details h3 { font-size: 14px; margin: 14px 0 4px; } details p { margin: 0 0 8px; line-height: 1.5; }
  table { border-collapse: collapse; font-size: 14px; } th { text-align: left; padding: 3px 12px 3px 0; opacity: .6; font-weight: 400; }
  .nota { color: #a2121f; }
  .acc { display: flex; gap: 8px; flex-wrap: wrap; }
  .acc input[name=nota] { flex: 1; min-width: 200px; padding: 10px 12px; border: 1px solid #0003; border-radius: 10px; font: inherit; }
  button { padding: 10px 16px; border-radius: 99px; border: 1px solid #1a1a1a; background: #fff; font: inherit; font-weight: 700; cursor: pointer; }
  button.si { background: #1a1a1a; color: #fff; } button.no { border-color: #a2121f; color: #a2121f; }
  .vacio { opacity: .6; }
</style></head><body>
<header><h1>SIDONIA · CÍRCULO</h1><span>Panel del equipo</span></header>
${aviso ? `<p class="aviso${aviso.startsWith('Error') ? ' mal' : ''}">${esc(aviso)}</p>` : ''}
<nav>${pestañas}</nav>
${tarjetas}
<script>document.querySelectorAll('form.acc').forEach((f) => f.addEventListener('submit', (e) => { const b = e.submitter; if (b && b.value === 'publicar' && !confirm('¿Aprobar y crear la ficha en Shopify?')) e.preventDefault(); if (b) setTimeout(() => { b.disabled = true; b.textContent = 'Un momento…'; }, 0); }));</script>
</body></html>`;
}

/** Contraseña del panel (usuario cualquiera, contraseña ADMIN_CLAVE) */
export function panelAutorizado(headers, clave) {
  if (!clave) return false;
  const h = String(headers.authorization || '');
  if (!h.startsWith('Basic ')) return false;
  const [, pass = ''] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(/:(.*)/s);
  const a = createHash('sha256').update(pass).digest();
  const b = createHash('sha256').update(clave).digest();
  return a.equals(b);
}

export async function atenderPanel(req, cfg, deps) {
  const html = (body, status = 200) => ({ status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, body });
  if (!panelAutorizado(req.headers || {}, cfg.adminClave)) {
    return { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Sidonia"', 'Content-Type': 'text/plain; charset=utf-8' }, body: 'Hace falta la contraseña del panel.' };
  }
  const { db } = deps;
  let aviso = '';
  let estado = ESTADOS[req.query.estado] ? req.query.estado : 'pendiente';
  if (req.method === 'POST') {
    const id = Number(req.body.id);
    const accion = String(req.body.accion || '');
    const a = id ? await db('sidonia_anuncio_uno', { p_id: id }) : null;
    try {
      if (!a) throw new Error('No encuentro ese anuncio.');
      if (accion === 'publicar') {
        const p = await publicarEnShopify(cfg, a, deps.gql || shopifyAdmin(cfg));
        await db('sidonia_anuncio_estado', { p_id: id, p_estado: 'publicado', p_nota: '', p_producto: p.handle });
        aviso = `Publicado: ${p.url}`;
        estado = 'publicado';
      } else if (accion === 'rechazar') {
        await db('sidonia_anuncio_estado', { p_id: id, p_estado: 'rechazado', p_nota: texto(req.body.nota, 300), p_producto: null });
        aviso = `Rechazado el anuncio #${id}.`;
      } else if (accion === 'retirar') {
        await db('sidonia_anuncio_estado', { p_id: id, p_estado: 'retirado', p_nota: '', p_producto: null });
        aviso = `Retirado el anuncio #${id}. Recuerda archivar el producto en Shopify.`;
      }
    } catch (e) {
      console.error(e);
      aviso = `Error: ${e.message}`;
    }
  }
  const lista = await db('sidonia_anuncios_lista', { p_estado: estado });
  return html(paginaPanel(cfg, lista || [], { estado, aviso }));
}
