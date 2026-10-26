/* SIDONIA · Alertas de búsqueda: «Avísame cuando entre uno así».
 *
 * En una búsqueda o una colección (con sus filtros), el botón «Crear alerta» guarda lo que está mirando. Hace falta
 * la cuenta iniciada (así la gente se registra y tenemos sus datos). Una vez al día (cron de Vercel, vercel.json) se
 * repasan los anuncios nuevos de la tienda y, a quien le encaje alguno, se le manda un email (Resend) y un aviso al
 * móvil si tiene la app (avisos.mjs).
 *
 * Rutas (/tienda/…, con el cliente firmado por el tema):
 *   GET  api/alertas                 → { ok, alertas: [...] } las suyas
 *   POST api/alertas  { nombre, filtros, email } → crea una (como mucho 20 por persona)
 *   POST api/alertas/borrar { id }
 *   GET  api/alertas/revisar          → el repaso diario (solo el cron: Authorization: Bearer CRON_SECRET)
 *
 * filtros: lo de la dirección de la búsqueda: q (texto), coleccion (handle) y los de los filtros del tema: tipo, marca,
 * combustible y localizacion (listas con comas), anio y precio («desde-hasta»).
 */
import { esc, shopifyAdmin, tablaAnuncios } from './circulo.mjs';
import { enviarCorreo } from './correos.mjs';
import { avisarCliente } from './avisos.mjs';

export const MAX_ALERTAS = 20;
const LISTAS = ['tipo', 'marca', 'combustible', 'localizacion'];
const RANGOS = ['anio', 'precio'];

const tabla = (cfg, deps) => deps.alertas || tablaAnuncios(cfg, deps.fetch, 'alertas');

/** Minúsculas y sin tildes, para comparar */
export const normal = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/** Solo lo que entendemos de los filtros, limpio y corto */
export function limpiarFiltros(f = {}) {
  const out = {};
  const q = String(f.q || '').trim().slice(0, 80);
  if (q) out.q = q;
  const col = String(f.coleccion || '').trim().toLowerCase();
  if (/^[a-z0-9][a-z0-9-]{0,80}$/.test(col) && col !== 'all') out.coleccion = col;
  for (const k of LISTAS) {
    const v = String(f[k] || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 12).join(',').slice(0, 200);
    if (v) out[k] = v;
  }
  for (const k of RANGOS) {
    const m = String(f[k] || '').match(/^(\d{0,9})-(\d{0,9})$/);
    if (m && (m[1] || m[2])) out[k] = `${m[1]}-${m[2]}`;
  }
  return out;
}

const rango = (v) => {
  const [a, b] = String(v).split('-');
  return [a === '' ? -Infinity : Number(a), b === '' || b === undefined ? Infinity : Number(b)];
};

/**
 * ¿Le encaja este producto a la alerta? p: { title, productType, vendor, tags, descripcion, provincia, precio, colecciones }
 * Texto: todas las palabras de la búsqueda tienen que salir (título, tipo, etiquetas, descripción o provincia).
 * Listas: alguna de las opciones (la marca, en el título). Año (del título) y precio, dentro del rango.
 */
export function encaja(f, p) {
  const titulo = normal(p.title);
  const todo = normal([p.title, p.productType, p.vendor, ...(p.tags || []), p.provincia, p.descripcion].join(' '));
  const sale = (texto, palabra) => new RegExp(`(^|[^a-z0-9])${palabra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(texto);
  if (f.coleccion && !(p.colecciones || []).includes(f.coleccion)) return false;
  if (f.q) {
    const palabras = normal(f.q).split(' ').filter((w) => w.length > 1);
    if (!palabras.every((w) => sale(todo, w))) return false;
  }
  for (const k of LISTAS) {
    if (!f[k]) continue;
    const donde = k === 'marca' ? titulo : todo;
    if (!f[k].split(',').some((v) => sale(donde, normal(v)))) return false;
  }
  if (f.precio) {
    const [a, b] = rango(f.precio);
    if (!(p.precio > 0) || p.precio < a || p.precio > b) return false;
  }
  if (f.anio) {
    const anios = (p.title.match(/\b(19[0-9]{2}|20[0-9]{2})\b/g) || []).map(Number);
    const [a, b] = rango(f.anio);
    if (!anios.some((x) => x >= a && x <= b)) return false;
  }
  return true;
}

/* ---------------------------------------------------------------------------- Rutas del cliente */
export async function rutasAlertas({ ruta, method, body }, cliente, cfg, deps) {
  if (!cliente) return { ok: false, error: 'login' };
  const t = tabla(cfg, deps);
  const quien = `cliente=eq.${encodeURIComponent(String(cliente))}`;
  if (ruta === 'api/alertas' && method === 'GET') {
    const alertas = await t.leer(`${quien}&activa=eq.true&select=id,nombre,filtros,creada,avisos&order=creada.desc`);
    return { ok: true, alertas };
  }
  if (ruta === 'api/alertas' && method === 'POST') {
    const filtros = limpiarFiltros(body.filtros);
    if (!Object.keys(filtros).length) return { ok: false, error: 'vacia' };
    const nombre = String(body.nombre || filtros.q || 'Mi búsqueda').replace(/\s+/g, ' ').trim().slice(0, 120);
    const email = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(String(body.email || '').trim()) ? String(body.email).trim().toLowerCase() : null;
    const suyas = await t.leer(`${quien}&activa=eq.true&select=id,filtros`);
    const igual = suyas.find((a) => JSON.stringify(limpiarFiltros(a.filtros)) === JSON.stringify(filtros));
    if (igual) return { ok: true, id: igual.id, ya: true };
    if (suyas.length >= MAX_ALERTAS) return { ok: false, error: 'max' };
    const fila = await t.guardar({ cliente: String(cliente), email, nombre, filtros }, 'id');
    return { ok: true, id: fila?.id };
  }
  if (ruta === 'api/alertas/borrar' && method === 'POST') {
    const id = Number(body.id);
    if (!(id > 0)) return { ok: false, error: 'datos' };
    await t.borrar(`id=eq.${id}&${quien}`);
    return { ok: true };
  }
  return null;
}

/* ---------------------------------------------------------------------------- El repaso diario */
const CONSULTA = `query($despues: String, $q: String) { products(first: 100, after: $despues, query: $q, sortKey: CREATED_AT, reverse: true) {
  nodes { handle title productType vendor tags createdAt status description(truncateAt: 1500)
    precio: priceRangeV2 { minVariantPrice { amount } } featuredImage { url }
    provincia: metafield(namespace: "custom", key: "provincia") { value }
    collections(first: 25) { nodes { handle } } }
  pageInfo { hasNextPage endCursor } } }`;

/** Los productos activos creados desde «desde» (ISO), como mucho 500 */
export async function productosNuevos(gql, desde) {
  const out = [];
  let despues = null;
  do {
    const d = await gql(CONSULTA, { despues, q: `status:active AND created_at:>'${desde}'` });
    for (const n of d.products.nodes) {
      if ((n.tags || []).some((x) => /^vendid/i.test(x))) continue;
      out.push({
        handle: n.handle, title: n.title, productType: n.productType, vendor: n.vendor, tags: n.tags || [], creado: n.createdAt,
        descripcion: n.description || '', provincia: n.provincia?.value || '', precio: Number(n.precio?.minVariantPrice?.amount) || 0,
        foto: n.featuredImage?.url || '', colecciones: (n.collections?.nodes || []).map((c) => c.handle)
      });
    }
    despues = d.products.pageInfo.hasNextPage && out.length < 500 ? d.products.pageInfo.endCursor : null;
  } while (despues);
  return out;
}

const precio = (n) => (n > 0 ? `${Math.round(n).toLocaleString('es-ES')} €` : 'Precio a consultar');

/** El email: «Ha entrado uno como buscas» con las fichas (foto, precio y título) */
export function correoAlerta(cfg, alerta, productos) {
  const lista = productos.slice(0, 6);
  const filas = lista.map((p) => {
    const url = `${cfg.tienda}/products/${p.handle}`;
    const foto = p.foto ? `${p.foto}${p.foto.includes('?') ? '&' : '?'}width=520` : '';
    return `<a href="${esc(url)}" style="display:block;margin:0 0 18px;color:#1b1a18;text-decoration:none">
      ${foto ? `<img src="${esc(foto)}" width="504" alt="${esc(p.title)}" style="display:block;width:100%;max-width:504px;height:auto;border:0;border-radius:14px">` : ''}
      <p style="margin:10px 0 2px;font-size:20px;font-weight:700">${esc(precio(p.precio))}</p>
      <p style="margin:0;font-size:15px;line-height:1.4;text-transform:uppercase">${esc(p.title)}</p></a>`;
  }).join('');
  const mas = productos.length > lista.length ? `<p style="margin:0 0 14px;font-size:15px;color:#3a3833">Y ${productos.length - lista.length} más.</p>` : '';
  const titulo = productos.length === 1 ? 'Ha entrado uno como buscas' : `Han entrado ${productos.length} como buscas`;
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title></head>
<body style="margin:0;padding:0;background:#f6f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1b1a18">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f2"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td align="center" style="padding:0 0 24px;font-size:15px;font-weight:700;letter-spacing:.45em">SIDONIA</td></tr>
    <tr><td style="background:#ffffff;border-radius:20px;padding:28px">
      <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#8a857b">Tu alerta · ${esc(alerta.nombre)}</p>
      <h1 style="margin:0 0 22px;font-size:26px;line-height:1.2">${esc(titulo)}</h1>
      ${filas}${mas}
      <a href="${esc(cfg.tienda)}/pages/vende-con-nosotros?view=perfil" style="display:inline-block;margin-top:6px;font-size:13px;color:#8a857b">Gestionar mis alertas</a>
    </td></tr>
    <tr><td align="center" style="padding:24px 8px 0;font-size:13px;line-height:1.6;color:#8a857b"><a href="${esc(cfg.tienda)}" style="color:#8a857b">sidonia.es</a> · Cosas con alma</td></tr>
  </table>
</td></tr></table></body></html>`;
  return { asunto: productos.length === 1 ? `Nuevo en Sidonia: ${productos[0].title}` : `${productos.length} nuevos en Sidonia para «${alerta.nombre}»`, html };
}

/**
 * Repasa todas las alertas con los anuncios nuevos desde la última vez. Devuelve el informe.
 * deps: { fetch, gql, alertas (tabla), dispositivos (tabla) } para poder probarlo.
 */
export async function revisarAlertas(cfg, deps, ahora = Date.now()) {
  const t = tabla(cfg, deps);
  const alertas = await t.leer('activa=eq.true&select=*');
  const informe = { alertas: alertas.length, productos: 0, avisadas: 0, emails: 0, moviles: 0 };
  if (!alertas.length) return informe;
  const semana = new Date(ahora - 7 * 864e5).toISOString();
  const desde = alertas.map((a) => a.revisada || a.creada).reduce((m, x) => (x < m ? x : m), new Date(ahora).toISOString());
  const gql = deps.gql || shopifyAdmin(cfg, deps.fetch);
  const productos = await productosNuevos(gql, desde > semana ? desde : semana);
  informe.productos = productos.length;
  const marca = new Date(ahora).toISOString();
  for (const a of alertas) {
    const corte = a.revisada || a.creada;
    const nuevos = productos.filter((p) => p.creado > corte && encaja(limpiarFiltros(a.filtros), p));
    if (nuevos.length) {
      informe.avisadas += 1;
      if (a.email) {
        const c = correoAlerta(cfg, a, nuevos);
        if (await enviarCorreo(cfg, a.email, c.asunto, c.html, deps.fetch).catch((e) => { console.error(e); return false; })) informe.emails += 1;
      }
      const p = nuevos[0];
      informe.moviles += await avisarCliente(cfg, deps, a.cliente, {
        titulo: nuevos.length === 1 ? 'Ha entrado uno como buscas' : `Han entrado ${nuevos.length} como buscas`,
        texto: nuevos.length === 1 ? p.title : `${p.title} y ${nuevos.length - 1} más`,
        url: `/products/${p.handle}`, imagen: p.foto
      }).catch(() => 0);
    }
    await t.cambiar(a.id, { revisada: marca, ...(nuevos.length ? { avisos: (a.avisos || 0) + nuevos.length } : {}) });
  }
  return informe;
}
