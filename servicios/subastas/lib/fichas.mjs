/* SIDONIA · Panel › Anuncios › En la web: todos los anuncios de la tienda (los de Sidonia y los de los dueños), con su
 * venta del centro operativo, y un editor para cambiarlos sin entrar en Shopify.
 *
 *   ?estado=fichas[&de=gestion|comunidad][&ver=en_venta|reservado|vendido|oculto|todo]   la lista
 *   ?estado=ficha&h=<handle>                                     editar uno: título, precio, precio anterior, en venta /
 *                                                                reservado / vendido, visible u oculto, tipo, ubicación,
 *                                                                propietario, etiquetas y descripción
 * Al guardar se cambia en Shopify y, si tiene venta en el centro operativo, también su estado allí.
 */
import { agotado, esc, fotoProducto, shopifyAdmin, situacionTienda, tablaAnuncios } from './circulo.mjs';
import { fmt, n } from './estadisticas.mjs';
import { enlazar, marco, normal } from './operaciones.mjs';

const euros = (x) => (x == null || x === '' || !Number(x) ? '—' : `${Math.round(Number(x)).toLocaleString('es-ES')} €`);
export const SITUACION = { en_venta: 'En venta', reservado: 'Reservado', vendido: 'Vendido', oculto: 'Oculto' };

/** Cómo está en la web (circulo.mjs: vendido también si no le quedan unidades, como lo marca Sidonia en Shopify) */
export const situacion = situacionTienda;

const CONSULTA = `query($despues: String) { products(first: 100, after: $despues, sortKey: CREATED_AT, reverse: true) {
  nodes { id handle title status productType vendor tags createdAt descriptionHtml
    featuredImage { url } featuredMedia { preview { image { url } } } media(first: 10) { nodes { mediaContentType preview { image { url } } } }
    variants(first: 1) { nodes { id price compareAtPrice availableForSale } }
    provincia: metafield(namespace: "custom", key: "provincia") { value }
    propietario: metafield(namespace: "custom", key: "propietario") { value }
    vendedor: metafield(namespace: "custom", key: "vendedor_nombre") { value }
    anuncio: metafield(namespace: "custom", key: "anuncio_id") { value } }
  pageInfo { hasNextPage endCursor } } }`;

/** Todos los anuncios de la tienda, ya listos para el panel */
export async function leerFichas(gql) {
  const out = [];
  let despues = null;
  do {
    const d = await gql(CONSULTA, { despues });
    for (const p of d.products.nodes) {
      const v = p.variants?.nodes?.[0] || {};
      out.push({
        id: p.id, handle: p.handle, titulo: p.title, status: p.status, tipo: p.productType || '', vendor: p.vendor || '', tags: p.tags || [], creado: p.createdAt,
        descripcion: p.descriptionHtml || '', foto: fotoProducto(p), fotos: (p.media?.nodes || []).map((m) => m.preview?.image?.url).filter(Boolean), videos: (p.media?.nodes || []).filter((m) => m.mediaContentType === 'VIDEO').length,
        variante: v.id || '', agotado: agotado(p), precio: Number(v.price) || 0, precio_antes: Number(v.compareAtPrice) || 0,
        provincia: p.provincia?.value || '', propietario: p.propietario?.value || p.vendedor?.value || '', situacion: situacion(p),
        // De la comunidad (lo puso su dueño: se cobra por meses) o de gestión de venta (Sidonia, con comisión)
        comunidad: (p.tags || []).some((t) => String(t).toLowerCase() === 'dueno') || Boolean(p.anuncio?.value), anuncio: Number(p.anuncio?.value) || null
      });
    }
    despues = d.products.pageInfo.hasNextPage && out.length < 2000 ? d.products.pageInfo.endCursor : null;
  } while (despues);
  return out;
}

/** La venta del centro operativo de un anuncio de Sidonia (con lo que dice su ficha) */
export const ventaDeFicha = (f) => {
  const t = String(f.tipo || '').toLowerCase();
  const tipo = /moto/.test(t) ? 'moto' : /barco|boat/.test(t) ? 'barco' : /casa|house/.test(t) ? 'casa' : 'coche';
  return { titulo: f.titulo, handle: f.handle, tipo, modalidad: 'gestion', estado: f.situacion === 'oculto' ? 'retirado' : f.situacion,
    precio_anunciado: f.precio || null, fecha_alta: f.creado ? String(f.creado).slice(0, 10) : null, propietario_nombre: f.propietario || null, origen: 'tienda' };
};
/** Todos los anuncios en CSV (; y BOM, para Excel): cada uno con su estado, sus números y su venta */
export function csvFichas(fichas, ops, numeros, tienda = 'https://sidonia.es') {
  const celda = (v) => { const t = String(v ?? ''); return /[;"\n\r]/.test(t) || /^[=+\-@]/.test(t) ? `"${t.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : t; };
  const ventas = new Map(ops.filter((o) => o.handle).map((o) => [o.handle, o]));
  const cab = ['handle', 'titulo', 'estado_web', 'origen', 'tipo', 'provincia', 'propietario', 'precio', 'en_la_web_desde', 'vistas', 'personas', 'contactos', 'guardados', 'venta_id', 'venta_estado', 'comision', 'comprador', 'fecha_venta', 'url'];
  const filas = fichas.map((f) => { const nn = (numeros && numeros[f.handle]) || {}, v = ventas.get(f.handle) || {};
    return [f.handle, f.titulo, SITUACION[f.situacion] || f.situacion, f.comunidad ? 'Comunidad' : 'Gestión de venta', f.tipo, f.provincia, f.propietario || v.propietario_nombre || '', f.precio || '', String(f.creado || '').slice(0, 10),
      nn.vistas ?? '', nn.personas ?? '', nn.contactos ?? '', nn.guardados ?? '', v.id ?? '', v.estado ?? '', v.comision ?? '', v.comprador_nombre ?? '', v.fecha_venta ?? '', `${tienda}/products/${f.handle}`].map(celda).join(';'); });
  return `\ufeff${[cab.join(';'), ...filas].join('\r\n')}\r\n`;
}
const foto = (url, w = 160) => (url ? `${url}${url.includes('?') ? '&' : '?'}width=${w}` : '');
const pill = (s) => `<span class="pill ${s === 'oculto' ? 'retirado' : s}">${esc(SITUACION[s] || s)}</span>`;
const CSS = `
  .mini { width: 64px; height: 48px; border-radius: 8px; object-fit: cover; display: block; background: var(--caja-3); }
  td.foto { width: 64px; padding-right: 0; } .fila-ficha td:nth-child(2) { white-space: normal; min-width: 220px; }
  .fotos-ficha { display: flex; gap: 8px; overflow-x: auto; margin: 0 0 4px; } .fotos-ficha img { height: 96px; border-radius: 10px; display: block; }
  form.op textarea[name=descripcion] { min-height: 260px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; line-height: 1.5; }
  .venta-caja { display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center; justify-content: space-between; }
  @media (max-width: 700px) { td.foto { position: static !important; box-shadow: none !important; } .fila-ficha td:nth-child(2) { position: sticky; left: 0; background: var(--caja); } }`;

/* ---------------------------------------------------------------------------- La lista */
export function paginaFichas(todas, ops, { ver = 'todo', de = 'todos', aviso = '', error = '', tienda = 'https://sidonia.es', numeros = null, orden = 'reciente' } = {}) {
  const nu = (h) => (numeros && numeros[h]) || {};
  const ventas = new Map(ops.filter((o) => o.handle).map((o) => [o.handle, o]));
  const fichas = todas.filter((f) => de === 'todos' || (de === 'comunidad') === f.comunidad);
  const cuenta = (k) => (k === 'todo' ? fichas.length : k === 'sinventa' ? fichas.filter((f) => !f.comunidad && !ops.some((o) => o.handle === f.handle)).length : fichas.filter((f) => f.situacion === k).length);
  const sinVenta = (f) => !f.comunidad && !ventas.has(f.handle);
  const lista = fichas.filter((f) => ver === 'todo' || (ver === 'sinventa' ? sinVenta(f) : f.situacion === ver));
  if (orden !== 'reciente' && numeros) lista.sort((a, b) => n(nu(b.handle)[orden]) - n(nu(a.handle)[orden]) || n(nu(b.handle).vistas) - n(nu(a.handle).vistas));
  const origenes = { todos: ['Todos', todas.length], gestion: ['Gestión de venta', todas.filter((f) => !f.comunidad).length], comunidad: ['Comunidad', todas.filter((f) => f.comunidad).length] };
  const filtros = { todo: 'Todos', en_venta: 'En venta', reservado: 'Reservados', vendido: 'Vendidos', oculto: 'Ocultos', ...(de !== 'comunidad' ? { sinventa: 'Gestión sin venta' } : {}) };
  const filas = lista.map((f) => {
    const v = ventas.get(f.handle);
    const q = normal(`${f.titulo} ${f.propietario} ${f.provincia} ${f.tipo} ${v?.comprador_nombre || ''}`);
    return `<tr class="fila-ficha" data-q="${esc(q)}" onclick="if(!event.target.closest('a'))location.href='?estado=ficha&h=${encodeURIComponent(f.handle)}'">
      <td class="foto">${f.foto ? `<img class="mini" src="${esc(foto(f.foto))}" alt="" loading="lazy">` : '<span class="mini" title="Sin fotos ni vídeo en Shopify"></span>'}${f.videos ? '<span class="sub">▶ vídeo</span>' : ''}</td>
      <td class="izq"><b>${esc(f.titulo)}</b><span class="sub">${esc([f.tipo, f.provincia].filter(Boolean).join(' · ') || '—')} · <a href="${esc(tienda)}/products/${esc(f.handle)}" target="_blank" rel="noopener">ver en la web</a></span></td>
      <td class="izq">${pill(f.situacion)}<span class="sub">${f.comunidad ? 'Comunidad' : 'Gestión de venta'}</span></td>
      <td class="izq">${esc(f.propietario || v?.propietario_nombre || '—')}</td>
      ${numeros ? `<td><a href="?estado=anuncio&h=${encodeURIComponent(f.handle)}">${fmt(nu(f.handle).vistas)}</a>${n(nu(f.handle).personas) ? `<span class="sub">${fmt(nu(f.handle).personas)} personas</span>` : ''}</td><td>${fmt(nu(f.handle).contactos)}</td><td>${fmt(nu(f.handle).guardados)}</td>` : ''}
      <td>${euros(f.precio)}${f.precio_antes > f.precio ? `<span class="sub" style="text-decoration:line-through">${euros(f.precio_antes)}</span>` : ''}</td>
      <td class="izq">${v ? `<a href="?estado=expediente&id=${v.id}">${esc(v.expediente?.propietario?.nombre || v.propietario_nombre || 'Su ficha')} ›</a><span class="sub">${v.expediente?.contrato?.firma ? '<span style="color:var(--verde)">✓ contrato firmado</span>' : v.expediente?.contrato?.enviado ? 'contrato enviado' : 'sin contrato'}${v.estado === 'vendido' ? ` · vendido${v.comision ? ` · ${euros(v.comision)}` : ''}` : ''}</span>` : f.comunidad ? (f.anuncio ? `<a href="?estado=cobrar&id=${f.anuncio}">Cobros ›</a>` : '<span class="sub">Comunidad</span>') : `<a href="?estado=ligar&h=${encodeURIComponent(f.handle)}" style="color:#f0b400">Ligar con su propietario ›</a>`}</td>
      <td><a href="?estado=ficha&h=${encodeURIComponent(f.handle)}">Editar ›</a></td></tr>`;
  }).join('');
  return marco('Anuncios en la web', 'fichas', `
${aviso ? `<p class="aviso${/^Error/.test(aviso) ? ' mal' : ''}">${esc(aviso)}</p>` : ''}
${error ? `<p class="aviso mal">No se han podido leer los anuncios de la tienda: ${esc(error)}</p>` : ''}
<div class="kpis">
  <div class="kpi"><span>En la web</span><b>${fmt(fichas.length)}</b><small>anuncios en Shopify</small></div>
  <div class="kpi"><span>En venta</span><b>${fmt(cuenta('en_venta'))}</b><small>${euros(fichas.filter((f) => f.situacion === 'en_venta').reduce((s, f) => s + n(f.precio), 0))} en total</small></div>
  <div class="kpi"><span>Reservados</span><b>${fmt(cuenta('reservado'))}</b></div>
  <div class="kpi"><span>Vendidos</span><b>${fmt(cuenta('vendido'))}</b></div>
  <div class="kpi"><span>Gestión sin venta</span><b>${fmt(fichas.filter((f) => !f.comunidad && !ventas.has(f.handle)).length)}</b><small>sin ficha en el centro operativo</small></div>
</div>
<div class="per">${Object.entries(origenes).map(([k, [t, c]]) => `<a href="?estado=fichas&de=${k}" class="${k === de ? 'on' : ''}">${t} <small>${fmt(c)}</small></a>`).join('')}</div>
<div class="barra">
  <div class="per" style="margin:0">${Object.entries(filtros).map(([k, t]) => `<a href="?estado=fichas&de=${de}&ver=${k}" class="${k === ver ? 'on' : ''}">${t} <small>${fmt(cuenta(k))}</small></a>`).join('')}</div>
  <a class="boton claro" href="?estado=fichas&csv=1">Descargar CSV</a>
  <input type="search" placeholder="Buscar coche, propietario, provincia…" oninput="const q=this.value.trim().toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'');document.querySelectorAll('tr[data-q]').forEach((tr)=>{tr.hidden=q&&!tr.dataset.q.includes(q)})">
</div>
<div class="card"><div class="tabla"><table>
  <thead><tr><th class="izq"></th><th class="izq">Anuncio</th><th class="izq">Estado</th><th class="izq">Propietario</th>${numeros ? `${['vistas', 'contactos', 'guardados'].map((k) => `<th><a href="?estado=fichas&de=${de}&ver=${ver}&orden=${orden === k ? 'reciente' : k}" title="Ordenar">${{ vistas: 'Vistas', contactos: 'Contactos', guardados: 'Guardados' }[k]}${orden === k ? ' ↓' : ''}</a></th>`).join('')}` : ''}<th>Precio</th><th class="izq">Propietario y contrato</th><th></th></tr></thead>
  <tbody>${filas || `<tr><td colspan="${numeros ? 10 : 7}" class="vacio">No hay anuncios aquí.</td></tr>`}</tbody>
</table></div></div>
${numeros ? '<p class="nota">Vistas, contactos y guardados: desde siempre (pulsa en el título de la columna para ordenar; en las vistas, para ver quién está interesado).</p>' : '<p class="nota">Para ver las vistas, contactos y guardados de cada anuncio aquí, ejecuta otra vez <b>sql/estadisticas.sql</b> en Supabase › SQL Editor.</p>'}
${!numeros || de === 'comunidad' || !cuenta('sinventa') ? '' : `<form method="post" action="?estado=fichas&de=gestion&ver=sinventa" onsubmit="return confirm('¿Crear la venta de los ${cuenta('sinventa')} anuncios de Sidonia que aún no tienen? Se crean en Ventas con el título, el precio, la fecha en que se anunció y su estado (en venta, reservado o vendido). Luego completas propietario, comprador y comisión.')"><button class="boton claro" name="accion" value="crear_ventas">Crear la venta de los ${cuenta('sinventa')} anuncios de Sidonia sin venta</button></form>`}
<p class="nota">Pulsa en uno para cambiarlo (título, precio, reservado o vendido, ubicación, propietario, descripción…). Los cambios se ven en la web al momento. Gestión de venta: los que vende Sidonia con comisión (Ventas). Comunidad: los que pone cada dueño y paga por meses (Cobros comunidad).</p>`, CSS);
}

/* ---------------------------------------------------------------------------- Editar uno */
export function paginaFicha(f, venta, { aviso = '', tienda = 'https://sidonia.es', tiendaAdmin = '' } = {}) {
  if (!f) return marco('Anuncio', 'fichas', '<p class="aviso mal">No encuentro ese anuncio en la tienda.</p><p><a href="?estado=fichas">‹ Anuncios</a></p>', CSS);
  const sel = (k, v, opciones) => `<select name="${k}">${Object.entries(opciones).map(([a, b]) => `<option value="${a}"${v === a ? ' selected' : ''}>${b}</option>`).join('')}</select>`;
  const idNum = String(f.id).split('/').pop();
  const etiquetas = f.tags.filter((t) => !/^(vendid|reservad)/i.test(t)).join(', ');
  return marco(f.titulo, 'fichas', `
<p><a href="?estado=fichas">‹ Anuncios</a></p>
${aviso ? `<p class="aviso${/^Error/.test(aviso) ? ' mal' : ''}">${esc(aviso)}</p>` : ''}
<div class="card cab"><div><h2>${esc(f.titulo)} ${pill(f.situacion)}</h2>
  <p><a href="${esc(tienda)}/products/${esc(f.handle)}" target="_blank" rel="noopener">Ver en la web ›</a> · <a href="?estado=anuncio&h=${encodeURIComponent(f.handle)}">Quién está interesado ›</a>${tiendaAdmin ? ` · <a href="https://admin.shopify.com/store/${esc(tiendaAdmin)}/products/${esc(idNum)}" target="_blank" rel="noopener">Fotos y más en Shopify ›</a>` : ''}</p></div>
  <div class="venta-caja">${venta ? `<a class="boton claro" href="?estado=operacion&id=${venta.id}">Ver la venta${venta.comision ? ` · ${euros(venta.comision)}` : ''}</a>` : `<a class="boton claro" href="?estado=operacion&de=${encodeURIComponent(f.handle)}">+ Crear la venta</a>`}</div></div>
${f.fotos.length ? `<div class="fotos-ficha">${f.fotos.map((u) => `<img src="${esc(foto(u, 300))}" alt="" loading="lazy">`).join('')}</div>` : ''}
<form class="op" method="post" action="?estado=ficha&h=${encodeURIComponent(f.handle)}">
  <fieldset><legend>El anuncio</legend>
    <label class="ancho">Título<input name="titulo" required value="${esc(f.titulo)}"></label>
    <label>Estado en la web${sel('situacion', f.situacion === 'oculto' ? 'en_venta' : f.situacion, { en_venta: 'En venta', reservado: 'Reservado', vendido: 'Vendido' })}</label>
    <label>Visible${sel('status', f.status, { ACTIVE: 'Sí, publicado', DRAFT: 'No (borrador)', ARCHIVED: 'No (archivado)' })}</label>
    <label>Tipo<input name="tipo" value="${esc(f.tipo)}" placeholder="Coches, Motos, Barcos, Casas…"></label>
  </fieldset>
  <fieldset><legend>Precio</legend>
    <label>Precio (€)<input name="precio" type="number" min="0" step="any" value="${f.precio || ''}" placeholder="0 = a consultar"></label>
    <label>Precio anterior (€)<input name="precio_antes" type="number" min="0" step="any" value="${f.precio_antes || ''}"><small>Si es mayor que el precio, sale tachado y la tarjeta dice «Ha bajado de precio».</small></label>
  </fieldset>
  <fieldset><legend>Dónde y de quién</legend>
    <label>Ubicación (provincia)<input name="provincia" value="${esc(f.provincia)}" placeholder="Madrid"></label>
    <label>Propietario<input name="propietario" value="${esc(f.propietario)}" placeholder="Carlos"><small>Sale en la ficha («Propietario: Carlos»).</small></label>
    <label class="ancho">Etiquetas<input name="etiquetas" value="${esc(etiquetas)}" placeholder="Separadas por comas"></label>
  </fieldset>
  <fieldset><legend>Descripción</legend>
    <label class="ancho">Texto de la ficha (HTML)<textarea name="descripcion">${esc(f.descripcion)}</textarea><small>Los apartados (Historia, Ficha técnica, Ubicación…) son títulos &lt;h3&gt;; cada línea, un &lt;p&gt;.</small></label>
  </fieldset>
  <div class="acc"><button class="boton" name="accion" value="guardar">Guardar en la web</button><a class="boton claro" href="?estado=fichas">Cancelar</a></div>
</form>`, CSS);
}

/** Lo que se cambia de verdad (solo lo que ha cambiado). { cambios, error } */
export function leerFicha(body, f) {
  const titulo = String(body.titulo || '').replace(/\s+/g, ' ').trim();
  if (titulo.length < 2) return { error: 'Falta el título.' };
  const precio = String(body.precio ?? '').trim() === '' ? 0 : Number(String(body.precio).replace(',', '.'));
  const antes = String(body.precio_antes ?? '').trim() === '' ? 0 : Number(String(body.precio_antes).replace(',', '.'));
  if (!(precio >= 0) || !(antes >= 0)) return { error: 'El precio no es un número.' };
  const situacionNueva = ['en_venta', 'reservado', 'vendido'].includes(body.situacion) ? body.situacion : 'en_venta';
  const status = ['ACTIVE', 'DRAFT', 'ARCHIVED'].includes(body.status) ? body.status : f.status;
  const propias = String(body.etiquetas || '').split(',').map((t) => t.trim()).filter((t) => t && !/^(vendid|reservad)/i.test(t));
  const tags = [...new Set([...propias, ...(situacionNueva === 'en_venta' ? [] : [situacionNueva])])];
  const c = {};
  if (titulo !== f.titulo) c.titulo = titulo;
  if (status !== f.status) c.status = status;
  const tipo = String(body.tipo ?? f.tipo).trim();
  if (tipo !== f.tipo) c.tipo = tipo;
  if (String(body.descripcion ?? f.descripcion) !== f.descripcion) c.descripcion = String(body.descripcion);
  if (JSON.stringify([...tags].sort()) !== JSON.stringify([...f.tags].sort())) c.tags = tags;
  if (precio !== f.precio) c.precio = precio;
  if (antes !== f.precio_antes) c.precio_antes = antes;
  // Estaba vendido por no quedarle unidades y se vuelve a poner en venta (o reservado): se puede volver a comprar
  if (situacionNueva !== 'vendido' && f.agotado) c.disponible = true;
  for (const k of ['provincia', 'propietario']) {
    const v = String(body[k] ?? f[k]).replace(/\s+/g, ' ').trim().slice(0, 100);
    if (v !== f[k]) c[k] = v;
  }
  return { cambios: c, situacion: situacionNueva };
}

/** Guarda en Shopify lo que ha cambiado */
export async function guardarFicha(gql, f, c) {
  const errores = (r, k) => { const e = r?.[k]?.userErrors || []; if (e.length) throw new Error(`Shopify: ${e.map((x) => x.message).join(' · ')}`); };
  const producto = { id: f.id };
  if (c.titulo !== undefined) producto.title = c.titulo;
  if (c.status !== undefined) producto.status = c.status;
  if (c.tipo !== undefined) producto.productType = c.tipo;
  if (c.descripcion !== undefined) producto.descriptionHtml = c.descripcion;
  if (c.tags !== undefined) producto.tags = c.tags;
  if (Object.keys(producto).length > 1) errores(await gql(`mutation($product: ProductUpdateInput!) { productUpdate(product: $product) { userErrors { field message } } }`, { product: producto }), 'productUpdate');
  if ((c.precio !== undefined || c.precio_antes !== undefined || c.disponible) && f.variante) {
    const v = { id: f.variante };
    if (c.disponible) v.inventoryPolicy = 'CONTINUE';
    if (c.precio !== undefined) v.price = String(c.precio);
    if (c.precio_antes !== undefined) v.compareAtPrice = c.precio_antes ? String(c.precio_antes) : null;
    errores(await gql(`mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } } }`,
      { productId: f.id, variants: [v] }), 'productVariantsBulkUpdate');
  }
  const poner = [], quitar = [];
  for (const k of ['provincia', 'propietario']) {
    if (c[k] === undefined) continue;
    if (c[k]) poner.push({ ownerId: f.id, namespace: 'custom', key: k, type: 'single_line_text_field', value: c[k] });
    else quitar.push({ ownerId: f.id, namespace: 'custom', key: k });
  }
  if (poner.length) errores(await gql(`mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`, { m: poner }), 'metafieldsSet');
  if (quitar.length) await gql(`mutation($m: [MetafieldIdentifierInput!]!) { metafieldsDelete(metafields: $m) { userErrors { field message } } }`, { m: quitar }).catch(() => null);
}

/* ---------------------------------------------------------------------------- Rutas */
export async function rutasFichas(req, cfg, deps, html) {
  const gql = deps.gql || shopifyAdmin(cfg, deps.fetch);
  const tOps = deps.operaciones || tablaAnuncios(cfg, deps.fetch, 'operaciones');
  const leerOps = async () => { try { return await tOps.leer('select=*&limit=5000'); } catch (e) { return []; } };
  const tiendaAdmin = (cfg.shopifyTienda || '').replace(/\.myshopify\.com$/, '');
  let fichas = [], error = '';
  try { fichas = await leerFichas(gql); } catch (e) { error = e.message; }
  if (req.query.estado === 'ficha') {
    let f = fichas.find((x) => x.handle === req.query.h) || null;
    const ops = await leerOps();
    let venta = f ? ops.find((o) => o.handle === f.handle) : null;
    let aviso = error ? `Error: ${error}` : '';
    if (f && req.method === 'POST' && req.body?.accion === 'guardar') {
      const { cambios, error: mal, situacion: s } = leerFicha(req.body, f);
      if (mal) aviso = `Error: ${mal}`;
      else {
        try {
          await guardarFicha(gql, f, cambios);
          // La venta del centro operativo, al día con la web
          if (venta) {
            const ahora = { en_venta: 'en_venta', reservado: 'reservado', vendido: 'vendido' }[s];
            const cv = {};
            if (venta.estado !== ahora && venta.estado !== 'retirado') cv.estado = ahora;
            if (ahora === 'vendido' && !venta.fecha_venta) cv.fecha_venta = new Date().toISOString().slice(0, 10);
            if (cambios.propietario && !venta.propietario_nombre) cv.propietario_nombre = cambios.propietario;
            if (Object.keys(cv).length) await tOps.cambiar(venta.id, { ...cv, actualizado: new Date().toISOString() });
          }
          aviso = Object.keys(cambios).length ? 'Guardado en la web.' : 'No había nada que cambiar.';
          f = (await leerFichas(gql)).find((x) => x.handle === f.handle) || f;
          venta = (await leerOps()).find((o) => o.handle === f.handle) || venta;
        } catch (e) {
          aviso = `Error: ${e.message}`;
        }
      }
    }
    return html(paginaFicha(f, venta, { aviso, tienda: cfg.tienda, tiendaAdmin }));
  }
  const ver = ['todo', 'en_venta', 'reservado', 'vendido', 'oculto', 'sinventa'].includes(req.query.ver) ? req.query.ver : 'todo';
  const de = ['todos', 'gestion', 'comunidad'].includes(req.query.de) ? req.query.de : 'todos';
  const orden = ['vistas', 'contactos', 'guardados'].includes(req.query.orden) ? req.query.orden : 'reciente';
  let aviso = '';
  // Crear de una vez la venta (centro operativo) de los anuncios de Sidonia que no la tienen
  if (req.method === 'POST' && req.body?.accion === 'crear_ventas' && fichas.length) {
    // Antes, las ventas que ya existen (del Excel o a mano) se enlazan con su anuncio, para no duplicarlas
    let enlazadas = 0;
    try { enlazadas = await enlazar(cfg, deps, tOps, await tOps.leer('select=*&limit=5000')); } catch (e) { console.error(e); }
    const ops = await leerOps();
    const con = new Set(ops.map((o) => o.handle).filter(Boolean));
    let hechas = 0;
    try {
      for (const f of fichas.filter((x) => !x.comunidad && !con.has(x.handle))) {
        await tOps.guardar(ventaDeFicha(f), 'id');
        hechas += 1;
      }
      aviso = `${enlazadas ? `Enlazadas ${enlazadas} ventas que ya existían con su anuncio. ` : ''}Creadas ${hechas} ventas nuevas, ya enlazadas con su anuncio. Complétalas en Ventas (propietario, comprador, comisión).`;
    } catch (e) { aviso = `Error: ${e.message}${hechas ? ` (se crearon ${hechas})` : ''}`; }
  }
  let numeros = null;
  if (deps.db) { try { const r = await deps.db('sidonia_por_anuncio', { p_dias: null }); numeros = r && typeof r === 'object' && !Array.isArray(r) ? r : null; } catch (e) { numeros = null; } }
  if (req.query.csv) return { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="anuncios-sidonia.csv"', 'Cache-Control': 'no-store' }, body: csvFichas(fichas, await leerOps(), numeros, cfg.tienda) };
  return html(paginaFichas(fichas, await leerOps(), { ver, de, error, aviso, tienda: cfg.tienda, numeros, orden }));
}
