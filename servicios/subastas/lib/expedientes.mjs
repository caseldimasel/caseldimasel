/* SIDONIA · Centro operativo: el expediente de cada coche que vende Sidonia, de principio a fin.
 *
 *   1. Captado      llega por el formulario (Gestiones de venta › «Abrir expediente») o en persona / por teléfono
 *                   («+ Nuevo coche»): los datos del propietario, del coche y las condiciones (comisión, exclusividad…)
 *   2. Contrato     el contrato de intermediación y exclusividad, con sus datos: se envía por email o WhatsApp con un
 *                   enlace; el propietario lo lee, completa lo que falte (DNI, domicilio) y lo firma (firma electrónica
 *                   simple: nombre, fecha, IP, dispositivo y huella SHA-256 del texto)
 *   3. En venta     firmado: se enlaza con su anuncio de la web
 *   4. Vendido      precio final, fecha y comprador
 *   5. Facturado    la factura de la comisión: % sobre el precio final (editable), a nombre del propietario o de otra
 *                   persona o empresa, forma de pago; se envía por email o WhatsApp (enlace a la factura, para PDF)
 *   6. Cobrado      fecha y forma de cobro. En efectivo, solo por debajo de 1.000 € (Ley 7/2012, art. 7)
 *
 * Se guarda en la venta (tabla operaciones, columna expediente) y la factura en facturas (con su venta). Los datos del
 * emisor de las facturas y las condiciones por defecto, en ajustes (clave «facturacion»), editables en el panel.
 * Base de datos: sql/centro-operativo.sql. Páginas públicas (enlace firmado): /tienda/intermediacion y /tienda/factura.
 */
import { createHash, createHmac } from 'node:crypto';
import { esc, shopifyAdmin, tablaAnuncios } from './circulo.mjs';
import { documentoValido, normDoc } from './cobros.mjs';
import { enviarCorreo, P, plantilla } from './correos.mjs';
import { fmt as fmtN, importe, n } from './estadisticas.mjs';
import { marco, normal as normalTexto, parecido } from './operaciones.mjs';

export const VERSION_INTERMEDIACION = '2026-11-17';
export const LIMITE_EFECTIVO = 1000;
/** Las ventas sin factura hasta este día se cobraron en efectivo (las nuevas, con su factura) */
export const CORTE_EFECTIVO = '2026-11-18';
export const FORMAS_PAGO = { transferencia: 'Transferencia', bizum: 'Bizum', tarjeta: 'Tarjeta', efectivo: 'Efectivo' };
/** Los pasos de cada coche de Sidonia (y «hecho»: cobrado, retirado o una venta de antes) */
export const PASOS = [['solicitud', 'Solicitudes'], ['venta', 'En cartera'], ['factura', 'Por facturar'], ['cobro', 'Por cobrar'], ['hecho', 'Cerrados']];
const ORIGENES = { persona: 'En persona', llamada: 'Por teléfono', web: 'Formulario de la web', recomendacion: 'Recomendación', otro: 'Otro' };
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const hoyISO = () => new Date().toISOString().slice(0, 10);
const t = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
/** Un texto largo (descripción, pactos): conserva los saltos de línea */
const largo = (v, max) => String(v ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const num = importe;
const r2 = (x) => Math.round(n(x) * 100) / 100;
export const eur = (x) => `${n(x).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' })} €`;
const eur0 = (x) => `${Math.round(n(x)).toLocaleString('es-ES', { useGrouping: 'always' })} €`;
const fechaCorta = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'Europe/Madrid' }) : '');
const fechaTxt = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' }) : '');

/* ---------------------------------------------------------------------------- Ajustes: el emisor de las facturas */
export const EMISOR_VACIO = { nombre: '', nif: '', direccion: '', email: '', telefono: '', iban: '', marca: 'Sidonia', comision_pct: 5, comision_min: 0, exclusividad_meses: 3, iva_pct: 21 };
export const leerEmisor = (v) => ({ ...EMISOR_VACIO, ...(v || {}) });
export const emisorCompleto = (e) => Boolean(e.nombre && e.nif && e.direccion);
export function leerAjustesForm(b) {
  const e = { nombre: t(b.nombre, 120), nif: normDoc(b.nif).slice(0, 20), direccion: t(b.direccion, 250), email: t(b.email, 160), telefono: t(b.telefono, 40), iban: t(b.iban, 40).toUpperCase(), marca: t(b.marca, 60) || 'Sidonia',
    comision_pct: num(b.comision_pct) ?? 5, comision_min: num(b.comision_min) ?? 0, exclusividad_meses: Math.max(1, Math.min(24, Math.round(num(b.exclusividad_meses) ?? 3))), iva_pct: num(b.iva_pct) ?? 21 };
  if (!(e.comision_pct >= 0 && e.comision_pct <= 50)) return { error: 'La comisión por defecto no es válida.' };
  return { emisor: e };
}

/* ---------------------------------------------------------------------------- Enlaces firmados (sin sesión) */
const firma = (cfg, tipo, id) => createHmac('sha256', String(cfg.clave || cfg.secreto || 'sidonia')).update(`${tipo}.${Number(id)}`).digest('hex').slice(0, 32);
export const urlIntermediacion = (cfg, id) => `${cfg.servidor}/tienda/intermediacion?o=${Number(id)}&f=${firma(cfg, 'intermediacion', id)}`;
export const urlFactura = (cfg, id) => `${cfg.servidor}/tienda/factura?n=${Number(id)}&f=${firma(cfg, 'factura', id)}`;
export const firmaOk = (cfg, tipo, id, f) => Boolean(Number(id)) && String(f || '') === firma(cfg, tipo, id);

/* ---------------------------------------------------------------------------- El expediente */
/**
 * El paso en el que está un coche: contrato → anuncio → venta → factura → cobro → hecho.
 * prod: su anuncio en la tienda (catalogoTienda); undefined si no se sabe (sin Shopify), null si ya no está.
 */
export function pasoDe(o, factura = null, prod = undefined, hoy = new Date()) {
  const x = o.expediente || {};
  const deAntes = !Object.keys(x).length && o.estado !== 'captado';
  if (o.estado === 'retirado') return 'hecho';
  if (factura && factura.estado !== 'anulada') return factura.cobrada ? 'hecho' : 'cobro';
  if (x.cobro && (o.estado === 'vendido' || prod?.situacion === 'vendido')) return 'hecho';
  if (o.estado === 'vendido' || prod?.situacion === 'vendido') {
    // Las ventas de años anteriores sin expediente ya están cerradas (se facturaron fuera del panel)
    return deAntes && String(o.fecha_venta || '').slice(0, 4) < String(hoy.getFullYear()) ? 'hecho' : 'factura';
  }
  // Archivado en Shopify: ya no está en cartera
  if (prod?.status === 'ARCHIVED') return 'hecho';
  return 'venta';
}
/**
 * En qué lista de Anuncios va: solicitud, próximamente (dado de alta, aún sin publicar), disponible (en la web) o
 * vendido. Fuera (null): los retirados, los archivados, los borradores de Shopify que no son de una ficha y las ventas
 * de antes que nunca se ligaron con su anuncio.
 */
export function grupoDe({ o, prod, g, sinFicha }) {
  if (g) return 'solicitud';
  if (sinFicha) return prod.situacion === 'vendido' ? 'vendido' : prod.status === 'ACTIVE' ? 'disponible' : prod.status === 'DRAFT' ? 'proximamente' : null;
  if (o.estado === 'vendido' || prod?.situacion === 'vendido') return 'vendido';
  if (o.estado === 'retirado' || prod?.status === 'ARCHIVED') return null;
  const deAntes = !Object.keys(o.expediente || {}).length && o.estado !== 'captado';
  const sc = situacionCartera(o, prod);
  if (sc.anuncio === 'en_web') return 'disponible';
  return deAntes ? null : 'proximamente';
}
/** Cómo va un coche en cartera: el contrato y el anuncio */
export function situacionCartera(o, prod) {
  const ct = o.expediente?.contrato || {}, deAntes = !Object.keys(o.expediente || {}).length;
  const contrato = ct.firma ? 'firmado' : ct.enviado ? 'enviado' : deAntes ? 'antes' : 'sin_enviar';
  const anuncio = !o.handle ? 'sin_anuncio' : prod === undefined ? 'en_web' : !prod ? 'sin_anuncio' : prod.status === 'ACTIVE' ? 'en_web' : 'borrador';
  return { contrato, anuncio };
}
export const nombrePaso = (k) => (PASOS.find(([p]) => p === k) || [, k])[1];
/** El anuncio en Shopify, en el panel de Shopify */
export const adminShopify = (cfg, o) => {
  const tienda = String(cfg.shopifyTienda || '').replace(/\.myshopify\.com$/, '');
  const id = String(o.expediente?.shopify_id || '').split('/').pop();
  return tienda ? `https://admin.shopify.com/store/${tienda}/products${id ? `/${id}` : `?query=${encodeURIComponent(o.handle || o.titulo || '')}`}` : '';
};

/** La descripción del anuncio (párrafos) con los datos del coche al final */
export function descripcionAnuncio(c = {}) {
  const ps = String(c.descripcion || '').split(/\n{2,}/).map((x) => x.trim()).filter(Boolean).map((x) => `<p>${esc(x).replace(/\n/g, '<br>')}</p>`);
  return ps.join('');
}
/** El texto de una descripción de Shopify (HTML → párrafos) */
export const textoDeHtml = (h) => String(h || '').replace(/<\/p>\s*<p[^>]*>/gi, '\n\n').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(li|h\d|div|ul|ol)>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const Q_PRODUCTO = 'query($q: String!) { products(first: 1, query: $q) { nodes { id handle title status descriptionHtml variants(first: 1) { nodes { id price } } } } }';
/** El producto de Shopify de un coche (por su handle), o null */
export async function productoDe(gql, handle) {
  const d = await gql(Q_PRODUCTO, { q: `handle:${handle}` });
  return ((d?.data?.products || d?.products)?.nodes || []).find((x) => x.handle === handle) || null;
}
/** Lo que han cambiado en Shopify (título, descripción, precio): los cambios para la ficha, o null */
export function cambiosDeShopify(o, p) {
  if (!p) return null;
  const x = o.expediente || {}, c = x.coche || {}, k = x.condiciones || {};
  const desc = textoDeHtml(p.descriptionHtml), precio = Number(p.variants?.nodes?.[0]?.price) || null;
  const qué = [];
  const exp = { ...x };
  const cambios = {};
  if (p.title && p.title !== o.titulo) { cambios.titulo = p.title; qué.push('título'); }
  if (p.descriptionHtml != null && desc !== String(c.descripcion || '').trim() && (desc || c.descripcion)) { exp.coche = { ...c, descripcion: desc }; qué.push('descripción'); }
  if (precio && precio !== n(k.precio_salida ?? o.precio_anunciado)) { exp.condiciones = { ...k, precio_salida: precio }; cambios.precio_anunciado = precio; qué.push('precio'); }
  if (p.id && x.shopify_id !== p.id) exp.shopify_id = p.id;
  if (!qué.length && exp.shopify_id === x.shopify_id) return null;
  return { cambios: { ...cambios, expediente: exp }, qué };
}
/** Lleva a Shopify lo cambiado en la ficha (título, descripción, precio, filtros) */
export async function llevarAShopify(gql, o, { titulo = false, descripcion = false, precio = false } = {}) {
  const p = await productoDe(gql, o.handle);
  if (!p) return false;
  const c = o.expediente?.coche || {}, k = o.expediente?.condiciones || {};
  const product = { id: p.id, ...(titulo ? { title: o.titulo } : {}), ...(descripcion ? { descriptionHtml: descripcionAnuncio(c) } : {}) };
  if (Object.keys(product).length > 1) {
    const r = await gql('mutation($product: ProductUpdateInput!) { productUpdate(product: $product) { userErrors { field message } } }', { product });
    const errs = r.productUpdate?.userErrors || [];
    if (errs.length) throw new Error(`Shopify: ${errs.map((e) => e.message).join(' · ')}`);
  }
  const v = p.variants?.nodes?.[0];
  if (precio && v && n(k.precio_salida)) {
    await gql('mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } } }', { productId: p.id, variants: [{ id: v.id, price: String(n(k.precio_salida)) }] });
  }
  try {
    const mf = [['provincia', c.ubicacion], ['marca', c.marca], ['ano', String(c.anio || '').match(/\d{4}/)?.[0]]].filter(([, val]) => val).map(([key, value]) => ({ ownerId: p.id, namespace: 'custom', key, type: 'single_line_text_field', value: String(value).slice(0, 100) }));
    if (mf.length) await gql('mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }', { m: mf });
  } catch (e) { console.error(e); }
  return true;
}
/** Crea su anuncio en Shopify como borrador (título, precio, Sidonia) ya ligado a la ficha. Devuelve { id, handle } */
export async function crearBorrador(gql, o) {
  const c = o.expediente?.coche || {}, k = o.expediente?.condiciones || {};
  const titulo = o.titulo || tituloCoche(c);
  const r = await gql(`mutation($product: ProductCreateInput!) { productCreate(product: $product) { product { id handle variants(first: 1) { nodes { id } } } userErrors { field message } } }`,
    { product: { title: titulo, status: 'DRAFT', vendor: 'Sidonia', productType: 'Coches', templateSuffix: 'cars', descriptionHtml: descripcionAnuncio(c) } });
  const errs = r.productCreate?.userErrors || [];
  if (errs.length) throw new Error(`Shopify: ${errs.map((e) => e.message).join(' · ')}`);
  const p = r.productCreate.product;
  const precio = n(k.precio_salida ?? o.precio_anunciado);
  const v = p.variants?.nodes?.[0];
  if (v && precio) {
    await gql(`mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } } }`,
      { productId: p.id, variants: [{ id: v.id, price: String(precio), inventoryPolicy: 'CONTINUE' }] }).catch((e) => console.error(e));
  }
  // Los filtros de la tienda (provincia, marca, año): si la tienda los tiene de otro tipo, se deja
  try {
    const mf = [['provincia', c.ubicacion], ['marca', c.marca], ['ano', String(c.anio || '').match(/\d{4}/)?.[0]]].filter(([, v]) => v).map(([key, value]) => ({ ownerId: p.id, namespace: 'custom', key, type: 'single_line_text_field', value: String(value).slice(0, 100) }));
    if (mf.length) await gql('mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }', { m: mf });
  } catch (e) { console.error(e); }
  // En la tienda online: así, cuando lo pongáis «Activo» en Shopify, ya se ve en la web
  try {
    const pubs = await gql('{ publications(first: 20) { nodes { id name } } }');
    const tienda = pubs.publications.nodes.find((x) => /online store|tienda online/i.test(x.name)) || pubs.publications.nodes[0];
    if (tienda) await gql('mutation($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { field message } } }', { id: p.id, input: [{ publicationId: tienda.id }] });
  } catch (e) { console.error(e); }
  return { id: p.id, handle: p.handle };
}

/** Las fichas firmadas sin anuncio que se ligan solas con el anuncio de Shopify que es suyo: [{ id, handle, titulo }] */
export function ligarSolos(ops, catalogo) {
  const ligados = new Set(ops.map((o) => o.handle).filter(Boolean));
  const libres = [...catalogo.values()].filter((p) => !p.comunidad && !ligados.has(p.handle) && p.situacion !== 'vendido');
  const hechos = [];
  for (const o of ops) {
    if (o.handle || o.modalidad === 'encargo' || ['vendido', 'retirado'].includes(o.estado) || !Object.keys(o.expediente || {}).length) continue;
    const desde = o.creado ? new Date(o.creado).getTime() - 864e5 : 0;
    const [mejor] = libres.filter((p) => !ligados.has(p.handle) && (!p.creado || new Date(p.creado).getTime() >= desde))
      .map((p) => [parecido(o.titulo, p.titulo, { anioDistinto: 0.25 }), p]).filter(([x]) => x >= 0.9).sort((a, b) => b[0] - a[0]);
    if (!mejor) continue;
    ligados.add(mejor[1].handle);
    hechos.push({ id: Number(o.id), handle: mejor[1].handle, titulo: mejor[1].titulo });
  }
  return hechos;
}
export const tituloCoche = (c = {}) => [c.marca, c.modelo, c.anio].filter(Boolean).join(' ').toUpperCase();

/** Lee el formulario del expediente: { op, error } (op: las columnas de la venta + expediente) */
export function leerExpediente(b, antes = {}) {
  const x = antes.expediente || {};
  const propietario = { nombre: t(b.p_nombre, 120), dni: normDoc(b.p_dni).slice(0, 20), direccion: t(b.p_direccion, 250), email: t(b.p_email, 160).toLowerCase(), telefono: t(b.p_telefono, 40) };
  const coche = { marca: t(b.c_marca, 40), modelo: t(b.c_modelo, 80), anio: t(b.c_anio, 4), matricula: t(b.c_matricula, 15).toUpperCase().replace(/[\s-]/g, ''), bastidor: t(b.c_bastidor, 20).toUpperCase(), km: t(b.c_km, 20), ubicacion: t(b.c_ubicacion, 60), descripcion: largo(b.c_descripcion, 6000) };
  const condiciones = { comision_pct: num(b.k_pct), comision_min: num(b.k_min), precio_salida: num(b.k_salida), precio_minimo: num(b.k_minimo), exclusividad_meses: Math.max(1, Math.min(24, Math.round(num(b.k_meses) ?? 3))), comercial_pct: num(b.k_comercial), especiales: largo(b.k_especiales, 2000) };
  if (!coche.marca || !coche.modelo) return { error: 'Pon la marca y el modelo.' };
  if (!propietario.nombre) return { error: 'Pon el nombre del propietario.' };
  if (propietario.dni && !documentoValido(propietario.dni)) return { error: 'Revisa el DNI, NIE o CIF del propietario.' };
  if (propietario.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(propietario.email)) return { error: 'Revisa el email del propietario.' };
  if (condiciones.comision_pct == null || condiciones.comision_pct < 0 || condiciones.comision_pct > 50) return { error: 'Pon la comisión (%).' };
  const exp = { ...x, origen: ORIGENES[b.origen] ? b.origen : x.origen || 'persona', propietario, coche, condiciones, notas: t(b.notas, 1000) };
  // Si cambian los datos del contrato después de enviarlo (y antes de firmarlo), hay que volver a enviarlo
  if (x.contrato?.enviado && !x.contrato?.firma && JSON.stringify([x.propietario, x.coche, x.condiciones]) !== JSON.stringify([propietario, coche, condiciones])) exp.contrato = { ...x.contrato, cambiado: true };
  return { op: { titulo: t(b.c_titulo, 150).toUpperCase() || tituloCoche(coche), tipo: antes.tipo || 'coche', modalidad: 'gestion', comercial: t(b.comercial, 60) || null,
    ...(!antes.id && b.handle ? { handle: String(b.handle).replace(/[^a-z0-9-]/g, '').slice(0, 160) || null } : {}), propietario_nombre: propietario.nombre, propietario_email: propietario.email || null, propietario_telefono: propietario.telefono || null,
    precio_anunciado: condiciones.precio_salida, expediente: exp } };
}
/** «PORSCHE 911 CARRERA 3.2 1986» → { marca: 'Porsche', modelo: '911 Carrera 3.2', anio: '1986' } */
const DOBLES = ['land rover', 'range rover', 'aston martin', 'alfa romeo', 'rolls royce', 'austin healey', 'mercedes benz', 'de tomaso'];
export function cocheDeTitulo(titulo) {
  const s = String(titulo || '').replace(/\s+/g, ' ').trim();
  const anio = (s.match(/\b(19|20)\d{2}\b(?!.*\b(19|20)\d{2}\b)/) || [''])[0];
  const sin = s.replace(anio, '').trim();
  const bajo = sin.toLowerCase().replace(/-/g, ' ');
  const doble = DOBLES.find((d) => bajo.startsWith(`${d} `));
  const partes = sin.split(' ');
  const n = doble && partes[0].toLowerCase().replace(/-/g, ' ') !== doble ? doble.split(' ').length : 1;
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  return { marca: partes.slice(0, n).map((w) => w.split('-').map(cap).join('-')).join(' '), modelo: partes.slice(n).join(' '), anio, matricula: '', bastidor: '', km: '' };
}
const conHistorial = (exp, texto) => ({ ...exp, historial: [...(exp.historial || []), { fecha: new Date().toISOString(), texto }].slice(-80) });

/* ---------------------------------------------------------------------------- El contrato de intermediación */
const hueco = (v, txt = '______________') => (v || v === 0 ? esc(v) : `<span class="hueco">${txt}</span>`);
/** El contrato (HTML): con los datos del expediente; firmado, con su bloque de firmas */
export function contratoIntermediacion(o, emisor, { firmado = null } = {}) {
  const x = o.expediente || {}, p = { ...(x.propietario || {}), ...(firmado ? { nombre: firmado.nombre, dni: firmado.dni, direccion: firmado.direccion || x.propietario?.direccion } : {}) }, c = x.coche || {}, k = x.condiciones || {};
  const e = leerEmisor(emisor);
  const cl = (() => { let i = 0; return (titulo, ...ps) => `<h3>${++i}. ${titulo}</h3>${ps.filter(Boolean).map((q) => (q.startsWith('<') ? q : `<p>${q}</p>`)).join('')}`; })();
  const veh = [c.marca, c.modelo, c.anio].filter(Boolean).join(' ');
  // Un ejemplo con sus números: si se vende por el precio de salida
  const pct = Number(k.comision_pct), ej = Number(k.precio_salida) > 0 && pct >= 0 ? Math.max(Number(k.precio_salida) * pct / 100, Number(k.comision_min) || 0) : 0;
  const ivaPct = Number(e.iva_pct) || 21;
  const ejemplo = ej ? `Por ejemplo: si el Vehículo se vende por ${eur0(k.precio_salida)}, los honorarios serían ${eur(ej)} más ${eur(ej * ivaPct / 100)} de IVA (${eur(ej * (1 + ivaPct / 100))} en total).` : '';
  const marca = esc(e.marca || 'Sidonia');
  return `<h1>Contrato de intermediación y exclusividad de venta</h1>
<p class="meta">Expediente n.º ${Number(o.id) || '—'} · Modelo ${VERSION_INTERMEDIACION}</p>
<div class="nota"><b>Lo importante, en claro</b> (resumen informativo; lo que vale es el texto de las cláusulas):
<ul style="margin:8px 0 0">
<li><b>Qué hace ${marca}:</b> anuncia y vende tu ${hueco(veh)} por ti (fotos y vídeo, web y redes, interesados, visitas, negociación y papeles). No compra el coche: lo vendes tú al comprador y tú decides si aceptas cada oferta.</li>
<li><b>Exclusiva ${hueco(k.exclusividad_meses, '__')} meses:</b> durante ese tiempo solo lo vende ${marca}; no lo anuncias ni lo vendes por otro lado.</li>
<li><b>Cuánto cuesta:</b> el ${hueco(k.comision_pct, '__')} % del precio final de venta${k.comision_min ? ` (mínimo ${eur0(k.comision_min)})` : ''} + IVA, y solo si se vende. Si no se vende, no pagas nada. ${ejemplo}</li>
<li><b>Puedes echarte atrás:</b> tienes 14 días desde que firmas para desistir sin dar explicaciones y sin coste (tienes el formulario al final).</li>
<li><b>Firma:</b> firmas desde el móvil; te llega una copia por email y queda registrada con fecha, hora y huella digital.</li></ul></div>
<h2>Reunidos</h2>
<p><b>De una parte</b>, ${hueco(e.nombre)}, con NIF ${hueco(e.nif)} y domicilio en ${hueco(e.direccion, '______________________________')}${e.email ? `, email ${esc(e.email)}` : ''}${e.telefono ? ` y teléfono ${esc(e.telefono)}` : ''}, que actúa con la marca comercial «${marca}» (en adelante, «Sidonia»).</p>
<p><b>De otra parte</b>, D./D.ª ${hueco(p.nombre)}, con DNI/NIE/CIF ${hueco(p.dni)}, con domicilio en ${hueco(p.direccion, '______________________________')}, teléfono ${hueco(p.telefono)} y email ${hueco(p.email)}, que actúa en su propio nombre o en representación de la sociedad indicada (en adelante, «el Propietario»).</p>
<p>Ambas partes se reconocen capacidad legal para contratar y</p>
<h2>Exponen</h2>
<p>I. Que el Propietario es titular del vehículo <b>${hueco(veh)}</b>, matrícula ${hueco(c.matricula)}, número de bastidor ${hueco(c.bastidor)}${c.km ? `, con ${esc(c.km)} km` : ''} (en adelante, «el Vehículo»), y que puede venderlo libremente, sin cargas, embargos ni reservas de dominio, salvo los que comunique por escrito a Sidonia antes de firmar.</p>
<p>II. Que Sidonia se dedica a la intermediación en la compraventa de vehículos clásicos y especiales, y que el Propietario le encarga la venta del Vehículo con arreglo a las siguientes</p>
<h2>Cláusulas</h2>
${cl('Objeto y naturaleza', 'El Propietario encarga a Sidonia, que acepta, la intermediación para la venta del Vehículo: hacer fotos y vídeo, anunciarlo en sidonia.es y en sus redes y canales, atender a los interesados, enseñar el Vehículo, transmitir y negociar las ofertas y acompañar a las partes hasta la firma de la compraventa y el cambio de titularidad.', 'Es un contrato de mediación o corretaje (artículo 1255 del Código Civil): Sidonia no compra el Vehículo, no lo vende en su nombre ni es parte de la compraventa, que se celebra directamente entre el Propietario y el comprador. El Propietario decide siempre si acepta o no cada oferta. Sidonia pone los medios para venderlo, pero no garantiza que se venda ni en qué plazo.')}
${cl('Precio', `El precio de salida es de <b>${k.precio_salida ? eur0(k.precio_salida) : hueco('', '________ €')}</b>${k.precio_minimo ? ` y el Propietario acepta vender a partir de <b>${eur0(k.precio_minimo)}</b>` : ''}. Sidonia consultará al Propietario cualquier oferta por debajo de ese precio y no cerrará ninguna venta sin su conformidad. Las partes pueden cambiar el precio de común acuerdo por escrito (por email o WhatsApp).`)}
${cl('Exclusividad y duración', `Este encargo se hace <b>en exclusiva</b> durante <b>${hueco(k.exclusividad_meses, '__')} meses</b> desde su firma. Durante ese plazo, el Propietario no venderá el Vehículo por sí mismo ni a través de otros intermediarios, ni lo anunciará en otros medios (portales, redes, concesionarios), salvo que Sidonia lo autorice por escrito.`, 'Al terminar el plazo, el encargo seguirá sin exclusividad mientras ninguna de las partes lo dé por terminado por escrito, con un preaviso de 7 días. Las partes pueden prorrogar la exclusividad de común acuerdo por escrito.')}
${cl('Honorarios de Sidonia', `Por su intermediación, Sidonia cobrará el <b>${hueco(k.comision_pct, '__')} %</b> del precio final de venta${k.comision_min ? `, con un mínimo de <b>${eur0(k.comision_min)}</b>` : ''}, más el IVA correspondiente (hoy, el ${ivaPct} %). ${ejemplo}`, 'Los honorarios se ganan cuando se firma la compraventa del Vehículo con un comprador presentado o atendido por Sidonia, y se pagan cuando el Propietario cobra el precio, contra la factura de Sidonia, por transferencia, Bizum o tarjeta (o en efectivo si el total es inferior a 1.000 €, como exige la Ley 7/2012). La factura puede ir a nombre de otra persona o empresa si el Propietario lo pide.', 'También se deben si, durante la exclusividad, el Propietario vende el Vehículo por su cuenta o por otro medio, o si en los 6 meses siguientes al fin del encargo lo vende a un comprador que conoció a través de Sidonia.', '<b>Si el Vehículo no se vende, el Propietario no paga nada a Sidonia</b>, salvo los gastos extraordinarios que hubiera autorizado antes por escrito.')}
${cl('Gastos', 'Los gastos de anuncio, fotografía, vídeo y gestión ordinaria de la venta corren a cargo de Sidonia. Los del cambio de titularidad, la ITV, las reparaciones, la limpieza a fondo, el transporte y cualquier otro gasto del Vehículo corren a cargo del Propietario, salvo que se acuerde otra cosa por escrito.')}
${cl('Fotos, vídeo y anuncio', 'El Propietario autoriza a Sidonia a hacer fotos y vídeos del Vehículo y a publicarlos en su web, sus redes y otros canales mientras dure el encargo. Las fotos y los vídeos son de Sidonia, que podrá seguir usándolos después para dar a conocer su trabajo (por ejemplo, «vendido por Sidonia»), sin mostrar la matrícula ni datos personales del Propietario.')}
${cl('Obligaciones del Propietario', 'El Propietario garantiza que los datos del Vehículo son ciertos y se compromete a: tener en regla y facilitar su documentación (permiso de circulación, ficha técnica, ITV y, si las hay, facturas de mantenimiento); informar a Sidonia y a los interesados de cualquier defecto, siniestro o carga que conozca; mantener el Vehículo asegurado y en buen estado mientras esté en venta; facilitar que los interesados lo vean y lo prueben en las condiciones que acuerden las partes; y avisar a Sidonia de inmediato si recibe una oferta por otro medio.', 'El Propietario responde frente al comprador de lo que diga la compraventa (estado del Vehículo, vicios ocultos y documentación). Sidonia responde de su propia actuación como intermediario.')}
${cl('El Vehículo bajo la custodia de Sidonia', 'Si el Propietario deja el Vehículo o sus llaves a Sidonia (para fotos, vídeo o visitas), Sidonia lo cuidará con diligencia y solo lo moverá para esos fines. El seguro del Vehículo sigue siendo el del Propietario. Las condiciones de un depósito prolongado se acordarán por escrito.')}
${cl('Desistimiento', 'Si el Propietario actúa como consumidor y firma este contrato a distancia o fuera de un establecimiento de Sidonia, puede desistir de él en un plazo de <b>14 días naturales</b> desde su firma, sin indicar el motivo y sin ningún coste. Para hacerlo, basta con comunicarlo a Sidonia de forma inequívoca por email o WhatsApp, o con el formulario del final. Si pide que Sidonia empiece a anunciar el Vehículo durante ese plazo y después desiste, no tendrá que pagar nada.', 'Pasado ese plazo, si el Propietario termina el encargo antes de acabar la exclusividad sin causa imputable a Sidonia, abonará a Sidonia los gastos extraordinarios que hubiera autorizado por escrito y que estén justificados.')}
${cl('Protección de datos', `Responsable: ${hueco(e.nombre)} (${marca}). Sidonia trata los datos del Propietario y del Vehículo para cumplir este contrato, anunciar el Vehículo (sin datos personales en los anuncios) y cumplir sus obligaciones legales y fiscales (como emitir la factura), con base en el propio contrato y en esas obligaciones. No los cede salvo al comprador, en lo necesario para la compraventa, a la gestoría y a la Administración cuando la ley lo exija. Los conserva mientras dure el contrato y los plazos legales. El Propietario puede ejercer sus derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a ${hueco(e.email)}, y reclamar ante la Agencia Española de Protección de Datos.`)}
${cl('Firma electrónica', 'Las partes firman este contrato electrónicamente mediante firma electrónica simple (Reglamento (UE) n.º 910/2014 y Ley 6/2020), con plena validez. Sidonia conserva el texto firmado, su huella digital (SHA-256) y el registro de la fecha, la hora, la dirección IP y el dispositivo de la firma, y envía una copia al Propietario.')}
${cl('Comunicaciones y reclamaciones', `Las partes se comunican por email o WhatsApp en los datos de este contrato. Cualquier queja o reclamación puede dirigirse a ${hueco(e.email)}; Sidonia responderá en el plazo más breve posible y, como máximo, en un mes.`)}
${k.especiales ? cl('Pactos particulares', ...String(k.especiales).split(/\n+/).filter(Boolean).map((q) => esc(q))) : ''}
${cl('Ley aplicable', 'Este contrato se rige por la ley española. Si el Propietario es consumidor, son competentes los juzgados de su domicilio; en los demás casos, los que correspondan según la ley.')}
<section id="firmas"><h2>Firmas</h2><div class="firmas">
  <div class="firma"><b>Sidonia</b><span>${esc(e.nombre || '')}</span><small>Ofrece el contrato a la firma el ${fechaTxt(x.contrato?.enviado || hoyISO())}</small></div>
  <div class="firma"><b>El Propietario</b>${firmado ? `<span>${esc(firmado.nombre)} · ${esc(firmado.dni)}</span><small>Firmado electrónicamente el ${esc(new Date(firmado.fecha).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }))}${firmado.ip ? ` · IP ${esc(firmado.ip)}` : ''}</small>` : '<span class="hueco">Pendiente de firma</span>'}</div>
</div></section>
<h2>Anexo · Formulario de desistimiento</h2>
<p class="meta">Solo debe rellenarlo y enviarlo si desea desistir del contrato.</p>
<p>A la atención de ${hueco(e.nombre)} (${marca}), ${hueco(e.direccion, '______________________________')}, ${hueco(e.email)}:</p>
<p>Por la presente le comunico que desisto de mi contrato de intermediación para la venta del vehículo ${hueco(veh)}, matrícula ${hueco(c.matricula)}, firmado el __________. Nombre del Propietario: __________________. Domicilio: __________________. Firma (solo si se presenta en papel) y fecha: __________________.</p>`;
}
const huella = (html) => createHash('sha256').update(String(html), 'utf8').digest('hex');

/* ---------------------------------------------------------------------------- La factura */
/** El siguiente número de factura del año: «2026-021» */
export function siguienteNumero(facturas, fecha = hoyISO()) {
  const ano = String(fecha).slice(0, 4);
  const max = facturas.map((f) => String(f.numero).match(new RegExp(`^${ano}-(\\d+)$`))).filter(Boolean).reduce((m, x) => Math.max(m, Number(x[1])), 0);
  return `${ano}-${String(max + 1).padStart(3, '0')}`;
}
/** La factura propuesta para una venta: % sobre el precio final (con el mínimo), a nombre del propietario */
export function facturaPropuesta(o, emisor, facturas) {
  const x = o.expediente || {}, k = x.condiciones || {}, e = leerEmisor(emisor);
  const precio = n(o.precio_venta);
  // Las ventas de antes (sin condiciones): la comisión que tenían apuntada
  const viejo = k.comision_pct == null && n(o.comision) > 0;
  const pct = viejo ? (precio ? Math.round((n(o.comision) / precio) * 10000) / 100 : null) : k.comision_pct ?? e.comision_pct;
  const base = viejo ? r2(o.comision) : r2(Math.max(precio * n(pct) / 100, n(k.comision_min)));
  const c = x.coche || {};
  return { numero: siguienteNumero(facturas), fecha: hoyISO(), pct, precio_venta: precio, base: base || n(o.comision) || 0, iva_pct: e.iva_pct,
    concepto: `Gestión de Venta ${[c.marca, c.modelo].filter(Boolean).join(' ') || o.titulo}${c.matricula ? ` ${c.matricula}` : ''}`.trim(),
    destinatario: { nombre: x.propietario?.nombre || o.propietario_nombre || '', nif: x.propietario?.dni || '', direccion: x.propietario?.direccion || '' }, forma_pago: 'transferencia' };
}
/** Lee el formulario de la factura: { factura, error } */
export function leerFacturaForm(b, o) {
  const numero = t(b.numero, 30), fecha = String(b.fecha || '');
  if (!numero) return { error: 'Pon el número de factura.' };
  if (!DIA.test(fecha)) return { error: 'Pon la fecha de la factura.' };
  const base = num(b.base), pct = num(b.iva_pct) ?? 21;
  if (base == null || base < 0) return { error: 'La base (nuestra comisión, sin IVA) no es un número.' };
  const destinatario = { nombre: t(b.d_nombre, 160), nif: normDoc(b.d_nif).slice(0, 20), direccion: t(b.d_direccion, 250) };
  if (!destinatario.nombre) return { error: 'Pon a nombre de quién va la factura.' };
  if (destinatario.nif && !documentoValido(destinatario.nif)) return { error: 'Revisa el NIF de la factura.' };
  const forma = FORMAS_PAGO[b.forma_pago] ? b.forma_pago : 'transferencia';
  const iva = r2(base * pct / 100), total = r2(base + iva);
  if (forma === 'efectivo' && total >= LIMITE_EFECTIVO) return { error: `En efectivo solo se puede cobrar si el total es menor de ${eur0(LIMITE_EFECTIVO)} (Ley 7/2012: el límite es para la operación entera, no se puede partir). Esta factura es de ${eur(total)}: cobradla por transferencia, Bizum o tarjeta.` };
  return { factura: { numero, fecha, cliente: destinatario.nombre, nif: destinatario.nif, concepto: t(b.concepto, 300) || 'Gestión de venta', base: r2(base), iva, total, operacion_id: Number(o.id), forma_pago: forma, estado: 'emitida',
    datos: { destinatario, pct: num(b.pct), precio_venta: num(b.precio_venta), iva_pct: pct } } };
}
/** La factura (HTML para ver, imprimir o guardar en PDF), con el diseño de las facturas de Sidonia */
export function facturaHTML(cfg, f, emisor) {
  const e = leerEmisor(f.datos?.emisor || emisor), d = f.datos?.destinatario || { nombre: f.cliente, nif: f.nif };
  const logo = cfg.servidor ? `<img src="${esc(cfg.servidor)}/admin?recurso=logo" alt="SIDONIA" class="logo" onerror="this.outerHTML='<div class=&quot;logo-t&quot;>SIDONIA</div>'">` : '<div class="logo-t">SIDONIA</div>';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Factura ${esc(f.numero)} · SIDONIA</title>
<style>
body{margin:0;background:#f2f2f2;color:#2b2b2b;font:15px/1.5 Montserrat,Inter,system-ui,-apple-system,sans-serif}
.hoja{max-width:794px;margin:24px auto;background:#fff;padding:56px 70px 40px;box-shadow:0 20px 50px -30px rgba(0,0,0,.35);min-height:1000px;display:flex;flex-direction:column}
.logo{display:block;width:280px;margin:0 auto 54px}.logo-t{text-align:center;font:600 54px/1 Georgia,serif;letter-spacing:4px;margin-bottom:54px}
.cab{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}.cab h1{margin:0;color:#a3171b;font-size:40px;letter-spacing:1px}
.cab .n{text-align:right;font-size:16px}.cab .n b{font-weight:700}
.emisor{margin:26px 0 34px;font-size:16px}.cliente h2{margin:0 0 4px;font-size:16px;letter-spacing:1px}.cliente{font-size:16px;margin-bottom:34px}
table{width:100%;border-collapse:collapse;font-size:16px}th{text-align:left;padding:12px 2px;border-top:2px solid #a3171b;border-bottom:2px solid #a3171b}th:last-child,td:last-child{text-align:right;width:140px}
td{padding:22px 2px;border-bottom:2px solid #a3171b}
.tot{margin:18px 0 0 auto;width:300px;font-size:16px}.tot div{display:flex;justify-content:space-between;padding:4px 0}.tot .t{border-top:2px solid #a3171b;border-bottom:2px solid #a3171b;margin-top:8px;padding:10px 0;font-size:21px;font-weight:700}
.pago{margin-top:auto;text-align:center;font-size:14px;padding-top:60px}.pago b{font-weight:700}.gracias{text-align:center;font-size:20px;font-weight:700;margin:40px 0 0;padding-bottom:12px;border-bottom:3px solid #a3171b}
.nota{max-width:794px;margin:0 auto;color:#666;font-size:12px;padding:0 16px}
.acc{display:flex;gap:10px;justify-content:flex-end;max-width:794px;margin:18px auto 0;padding:0 16px}.acc button{border:0;border-radius:999px;background:#1a1a1a;color:#fff;padding:11px 18px;font-weight:700;cursor:pointer;font:inherit}
.anulada{color:#a3171b;font-weight:700;text-align:center;font-size:22px;border:3px solid #a3171b;padding:8px;margin-bottom:20px}
@media print{body{background:#fff}.hoja{box-shadow:none;margin:0;padding:40px 50px;min-height:0;height:100vh;box-sizing:border-box}.acc,.nota{display:none}}
@media (max-width:640px){.hoja{padding:32px 20px}.logo{width:200px;margin-bottom:30px}.cab h1{font-size:30px}}
</style></head><body><div class="acc"><button onclick="print()">Imprimir o guardar en PDF</button></div>
<div class="hoja">${logo}
${f.estado === 'anulada' ? '<div class="anulada">FACTURA ANULADA</div>' : ''}
<div class="cab"><h1>FACTURA</h1><div class="n">Fecha: <b>${esc(new Date(`${String(f.fecha).slice(0, 10)}T12:00:00Z`).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Madrid' }))}</b><br>Factura n.º <b>${esc(f.numero)}</b></div></div>
<div class="emisor">${esc(e.nombre)}<br>${esc(e.nif)}<br>${esc(e.direccion)}</div>
<div class="cliente"><h2>CLIENTE</h2>${esc(d.nombre || '')}${d.nif ? `<br>${esc(d.nif)}` : ''}${d.direccion ? `<br>${esc(d.direccion)}` : ''}</div>
<table><thead><tr><th>Servicio</th><th>Total</th></tr></thead><tbody><tr><td>${esc(f.concepto)}${f.datos?.precio_venta && f.datos?.pct ? `<br><small style="color:#777">${esc(String(f.datos.pct).replace('.', ','))} % sobre el precio de venta de ${eur(f.datos.precio_venta)}</small>` : ''}</td><td>${eur(f.base)}</td></tr></tbody></table>
<div class="tot"><div><span>Base imponible:</span><span>${eur(f.base)}</span></div><div><span>I.V.A. ${esc(String(f.datos?.iva_pct ?? (n(f.base) ? Math.round((n(f.iva) / n(f.base)) * 100) : 21)))} %:</span><span>${eur(f.iva)}</span></div><div class="t"><span>Total:</span><span>${eur(f.total)}</span></div></div>
<div class="pago">Forma de pago: <b>${esc(FORMAS_PAGO[f.forma_pago] || 'Transferencia')}</b>${(f.forma_pago || 'transferencia') === 'transferencia' && e.iban ? `<br>N.º de cuenta: ${esc(e.iban)}` : ''}</div>
<div class="gracias">¡Gracias por tu confianza!</div></div>
<p class="nota">Factura de ${esc(e.marca || 'Sidonia')}. Guárdala en PDF con el botón de arriba.</p></body></html>`;
}

/* ---------------------------------------------------------------------------- WhatsApp y email */
const telWa = (tel) => { const d = String(tel || '').replace(/[^\d+]/g, '').replace(/^\+/, '').replace(/^00/, ''); return d.length === 9 ? `34${d}` : d; };
export const enlaceWa = (tel, texto) => (telWa(tel) ? `https://wa.me/${telWa(tel)}?text=${encodeURIComponent(texto)}` : '');
const primerNombre = (s) => (/\b(s\.?\s?l\.?|s\.?\s?a\.?|sociedad|slu)\b/i.test(String(s || '')) ? String(s) : String(s || '').split(' ')[0]);
export const textoWaContrato = (cfg, o) => `Hola ${primerNombre(o.expediente?.propietario?.nombre)}, soy de Sidonia. Aquí tienes el contrato de intermediación para la venta de tu ${tituloCoche(o.expediente?.coche)}: léelo, completa tus datos y fírmalo desde el móvil en un minuto: ${urlIntermediacion(cfg, o.id)}`;
export const textoWaFactura = (cfg, o, f) => `Hola ${primerNombre(f.datos?.destinatario?.nombre || o.propietario_nombre)}, ¡enhorabuena por la venta de tu ${o.titulo}! Aquí tienes nuestra factura ${f.numero} (${eur(f.total)}): ${urlFactura(cfg, f.id)}`;

/* ---------------------------------------------------------------------------- Páginas del panel */
const CSS = `
  .fs input, .fs select, .fs textarea { width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--linea-2); background: var(--caja); color: var(--texto); font: inherit; font-size: 15px; }
  .fs input:focus, .fs select:focus, .fs textarea:focus { outline: none; border-color: var(--verde); box-shadow: 0 0 0 3px var(--verde-fondo); }
  .fs label small { font-weight: 400; color: var(--flojo); }
  .exp-cab { display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: center; }
  .exp-cab h2 { margin: 0 0 4px; font-size: 22px; } .exp-cab p { margin: 2px 0; color: var(--suave); }
  .pasos { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin: 14px 0 16px; counter-reset: p; }
  .pasos li { list-style: none; padding: 10px 10px 10px 36px; position: relative; border-radius: 12px; background: var(--caja); border: 1px solid var(--linea); font-size: 13px; font-weight: 700; color: var(--flojo); }
  .pasos li::before { counter-increment: p; content: counter(p); position: absolute; left: 10px; top: 50%; transform: translateY(-50%); width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; background: var(--caja-3); color: var(--suave); font-size: 11px; }
  .pasos li.ok { color: var(--texto); } .pasos li.ok::before { content: '✓'; background: var(--verde); color: var(--verde-tinta); }
  .pasos li.on { color: var(--texto); border-color: var(--verde); box-shadow: 0 0 0 1px var(--verde) inset; } .pasos li.on::before { background: var(--verde); color: var(--verde-tinta); }
  .bloque { border-left: 3px solid var(--linea-2); } .bloque.on { border-left-color: var(--verde); } .bloque.hecho { opacity: .92; }
  .bloque h2 { display: flex; gap: 10px; align-items: center; } .bloque h2 small { font-size: 12px; font-weight: 600; color: var(--suave); letter-spacing: 0; text-transform: none; }
  .chip { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 800; background: var(--caja-3); color: var(--suave); }
  .chip.si { background: var(--verde-fondo); color: var(--verde); } .chip.am { background: rgba(255,196,0,.14); color: #f0b400; } .chip.no { background: var(--rojo-fondo); color: var(--rojo); }
  .acc-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; }
  .acc-row .boton { padding: 9px 14px; font-size: 14px; } .boton.wa { background: #25d366; color: #04150c !important; }
  .g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; } .g3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 14px; }
  .g2 label, .g3 label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--suave); } .g2 .ancho { grid-column: 1 / -1; }
  fieldset.fs { border: 1px solid var(--linea); border-radius: 14px; padding: 12px 14px 14px; margin: 0 0 12px; } fieldset.fs legend { padding: 0 6px; font-weight: 800; font-size: 13px; }
  .resumen-f { display: grid; grid-template-columns: repeat(4, auto); gap: 6px 22px; justify-content: start; font-size: 14px; } .resumen-f span { color: var(--suave); }
  .aviso-ef { margin: 8px 0 0; font-size: 13px; color: #f0b400; }
  .check { list-style: none; padding: 0; margin: 0 0 12px; display: flex; flex-wrap: wrap; gap: 8px 18px; font-size: 14px; } .check li { display: flex; align-items: center; gap: 8px; color: var(--suave); }
  .check li::before { content: ''; width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--linea-2); flex: none; } .check li.ok { color: var(--texto); } .check li.ok::before { background: var(--verde); border-color: var(--verde); }
  .check .mini { padding: 5px 10px; font-size: 12px; }
  .anu { display: grid; grid-template-columns: 96px 1fr auto; gap: 12px; align-items: center; padding: 10px; border: 1px solid var(--linea); border-radius: 14px; margin: 0 0 8px; background: var(--caja-2); }
  .anu img, .anu .anu-f { width: 96px; height: 72px; object-fit: cover; border-radius: 10px; display: block; background: var(--caja-3); } .anu b { display: block; } .anu span { font-size: 12px; color: var(--suave); }
  .hist { list-style: none; padding: 0; margin: 0; font-size: 13px; } .hist li { padding: 6px 0; border-bottom: 1px solid var(--linea); } .hist time { color: var(--flojo); margin-right: 8px; }
  .kanban { display: grid; grid-template-columns: repeat(7, minmax(170px, 1fr)); gap: 10px; overflow-x: auto; padding-bottom: 6px; }
  .col { background: var(--caja); border: 1px solid var(--linea); border-radius: 16px; padding: 10px; min-height: 120px; }
  .col h3 { margin: 2px 4px 10px; font-size: 13px; display: flex; justify-content: space-between; } .col h3 b { color: var(--suave); }
  .tarj { display: block; background: var(--caja-2); border: 1px solid var(--linea); border-radius: 12px; padding: 10px; margin-bottom: 8px; text-decoration: none; color: inherit; }
  .tarj:hover { border-color: var(--verde); } .tarj b { display: block; font-size: 13px; line-height: 1.3; } .tarj span { display: block; font-size: 12px; color: var(--suave); margin-top: 3px; }
  .tarj .dinero { color: var(--verde); font-weight: 800; }
  @media (max-width: 800px) { .pasos { grid-template-columns: repeat(3, 1fr); } .g2, .g3 { grid-template-columns: 1fr; } .exp-cab { grid-template-columns: 1fr; } .resumen-f { grid-template-columns: auto auto; } }`;

const campo = (etq, nombre, valor, extra = '') => `<label>${etq}<input name="${nombre}" value="${esc(valor ?? '')}"${extra}></label>`;
function formExpediente(o = {}, emisor = {}, { accion = 'guardar', boton = 'Guardar' } = {}) {
  const x = o.expediente || {}, p = x.propietario || {}, c = x.coche || {}, k = x.condiciones || {}, e = leerEmisor(emisor);
  const area = (etq, nombre, valor, filas, extra = '') => `<label class="ancho">${etq}<textarea name="${nombre}" rows="${filas}"${extra}>${esc(valor ?? '')}</textarea></label>`;
  return `<form method="post" action="?estado=expediente${o.id ? `&id=${Number(o.id)}` : ''}" class="fx">
  <fieldset class="fs"><legend>El propietario <small>para el contrato y la factura</small></legend><div class="g2">
    ${campo('Nombre y apellidos (o empresa)', 'p_nombre', p.nombre || o.propietario_nombre, ' required')}${campo('DNI / NIE / CIF', 'p_dni', p.dni, ' placeholder="Si no lo tienes, lo pone al firmar"')}
    ${campo('Teléfono', 'p_telefono', p.telefono || o.propietario_telefono, ' inputmode="tel"')}${campo('Email', 'p_email', p.email || o.propietario_email, ' type="email"')}
    <label class="ancho">Domicilio<input name="p_direccion" value="${esc(p.direccion || '')}" placeholder="Calle, n.º, CP y ciudad"></label></div></fieldset>
  <fieldset class="fs"><legend>El coche <small>sale así en el borrador de Shopify</small></legend><div class="g3">
    <label class="ancho" style="grid-column:1/-1">Título del anuncio <small>si lo dejas vacío: marca, modelo y año</small><input name="c_titulo" value="${esc(o.id ? o.titulo || '' : '')}" placeholder="PORSCHE 911 CARRERA 3.2 1986" style="text-transform:uppercase"></label>
    ${campo('Marca', 'c_marca', c.marca, ' required')}${campo('Modelo', 'c_modelo', c.modelo, ' required')}${campo('Año', 'c_anio', c.anio, ' inputmode="numeric" maxlength="4"')}
    ${campo('Kilómetros', 'c_km', c.km, ' inputmode="numeric"')}${campo('Matrícula', 'c_matricula', c.matricula, ' style="text-transform:uppercase"')}${campo('N.º de bastidor', 'c_bastidor', c.bastidor, ' style="text-transform:uppercase"')}
    ${campo('Precio de venta (€)', 'k_salida', k.precio_salida ?? o.precio_anunciado, ' inputmode="decimal"')}${campo('Precio mínimo que acepta (€, opcional)', 'k_minimo', k.precio_minimo, ' inputmode="decimal"')}${campo('Provincia', 'c_ubicacion', c.ubicacion, ' placeholder="Madrid"')}</div>
    <div class="g2" style="margin-top:10px">${area('Descripción del anuncio <small>la historia, el estado, la mecánica, el equipamiento…</small>', 'c_descripcion', c.descripcion, 7)}</div></fieldset>
  <fieldset class="fs"><legend>Condiciones <small>salen en el contrato</small></legend><div class="g3">
    ${campo('Comisión de Sidonia (%)', 'k_pct', k.comision_pct ?? e.comision_pct, ' inputmode="decimal" required')}${campo('Comisión mínima (€, opcional)', 'k_min', k.comision_min ?? (e.comision_min || ''), ' inputmode="decimal"')}${campo('Exclusividad (meses)', 'k_meses', k.exclusividad_meses ?? e.exclusividad_meses, ' inputmode="numeric"')}
    <label>Lo lleva<input name="comercial" value="${esc(o.comercial ?? 'Hugo')}" placeholder="Hugo"></label>${campo('Para el comercial (% del beneficio de Sidonia)', 'k_comercial', k.comercial_pct, ' inputmode="decimal" placeholder="Ej.: 30"')}
    <label>Cómo llegó<select name="origen">${Object.entries(ORIGENES).map(([a, b]) => `<option value="${a}"${(x.origen || 'persona') === a ? ' selected' : ''}>${b}</option>`).join('')}</select></label></div>
    <div class="g2" style="margin-top:10px">${area('Pactos particulares <small>opcional: salen como una cláusula más del contrato</small>', 'k_especiales', k.especiales, 3)}<label class="ancho">Notas internas <small>(no salen en el contrato)</small><input name="notas" value="${esc(x.notas || '')}"></label></div>
    ${o.handle ? `<input type="hidden" name="handle" value="${esc(o.handle)}">` : ''}</fieldset>
  <button class="boton grande" name="accion" value="${accion}">${boton}</button></form>`;
}

/** Un expediente: los 6 pasos, cada uno con lo que se puede hacer */
export function paginaExpediente(cfg, o, { factura = null, facturas = [], emisor = {}, aviso = '', anuncios = [], ligados = new Set() } = {}) {
  const x0 = o.expediente || {};
  // Los coches de antes (sin ficha aún): el coche sale del título y el propietario de la venta
  const x = { ...x0, coche: x0.coche && Object.keys(x0.coche).length ? x0.coche : cocheDeTitulo(o.titulo), propietario: { nombre: o.propietario_nombre || '', telefono: o.propietario_telefono || '', email: o.propietario_email || '', ...(x0.propietario || {}) },
    condiciones: { precio_salida: o.precio_anunciado ?? null, ...(x0.condiciones || {}) } };
  o = { ...o, expediente: x };
  const p = x.propietario, c = x.coche, k = x.condiciones, e = leerEmisor(emisor);
  const enWeb = o.handle ? anuncios.find((a) => a.handle === o.handle) || null : null;
  const paso = pasoDe(o, factura, anuncios.length ? enWeb : undefined);
  // Lo hecho de cada coche (el contrato y el anuncio van a la vez: no hay que esperar a uno para el otro)
  const hechos = [Boolean(x0.contrato?.firma), Boolean(enWeb ? enWeb.status === 'ACTIVE' || enWeb.situacion === 'vendido' : o.handle && !anuncios.length), o.estado === 'vendido', Boolean(factura || x0.cobro), Boolean(factura?.cobrada || x0.cobro)];
  const PC = [['Contrato firmado'], ['En la web'], ['Vendido'], ['Facturado'], ['Cobrado']];
  // Lo que toca ahora: el contrato y el anuncio a la vez; luego, la venta, la factura y el cobro, por orden
  const activo = (j) => !hechos[j] && (j < 2 || (j === 2 ? hechos[1] || o.estado === 'vendido' : hechos.slice(2, j).every(Boolean)));
  const pasos = `<ol class="pasos">${PC.map(([nombre], j) => `<li class="${hechos[j] ? 'ok' : ''}${activo(j) ? ' on' : ''}">${nombre}</li>`).join('')}</ol>`;
  const blq = (j, titulo, estado, cuerpo, ancla = '') => `<div class="card bloque${hechos[j] ? ' hecho' : activo(j) ? ' on' : ''}"${ancla ? ` id="${ancla}"` : ''}><h2>${titulo} ${estado}</h2>${cuerpo}</div>`;
  const id = Number(o.id);
  const f = (accion, txt, clase = 'boton claro', extra = '') => `<form method="post" action="?estado=expediente&id=${id}" style="display:inline"><button class="${clase}" name="accion" value="${accion}"${extra}>${txt}</button></form>`;
  const faltanContrato = [!emisorCompleto(e) && 'los datos de Sidonia (Finanzas › Datos de facturación)', !c.matricula && 'la matrícula', !k.comision_pct && k.comision_pct !== 0 && 'la comisión'].filter(Boolean);
  const ct = x.contrato || {};
  const contrato = ct.firma
    ? `<p>Firmado por <b>${esc(ct.firma.nombre)}</b> (${esc(ct.firma.dni)}) el ${esc(new Date(ct.firma.fecha).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }))} · IP ${esc(ct.firma.ip || '—')}.</p><div class="acc-row"><a class="boton" href="${esc(urlIntermediacion(cfg, id))}" target="_blank" rel="noopener">Ver el contrato firmado</a></div>`
    : `${faltanContrato.length ? `<p class="aviso">Antes de enviarlo, completa ${faltanContrato.join(', ')}.</p>` : ''}${ct.cambiado ? '<p class="aviso">Has cambiado datos después de enviarlo: vuelve a enviárselo.</p>' : ''}
      <p>${ct.enviado ? `Enviado el ${esc(fechaTxt(ct.enviado))} por ${esc(ct.via || '—')}. Aún no lo ha firmado.` : 'El propietario lo recibe con un enlace: lo lee, completa sus datos (DNI y domicilio) y lo firma desde el móvil.'}</p>
      <div class="acc-row"><a class="boton claro" href="${esc(urlIntermediacion(cfg, id))}" target="_blank" rel="noopener">Ver el contrato</a>
        ${p.email ? f('contrato-email', `Enviar por email${ct.enviado ? ' otra vez' : ''}`, 'boton') : '<span class="sub">Sin email</span>'}
        ${p.telefono ? `<a class="boton wa" href="?estado=expediente&id=${id}&wa=contrato" target="_blank" rel="noopener">Enviar por WhatsApp</a>` : '<span class="sub">Sin teléfono</span>'}
        ${!ct.enviado ? f('contrato-firmado-papel', 'Lo ha firmado en papel', 'boton claro', ' onclick="return confirm(\'¿Lo ha firmado en papel? Guarda el papel firmado.\')"') : ''}</div>`;
  const chipC = ct.firma ? '<span class="chip si">Firmado</span>' : ct.enviado ? '<span class="chip am">Enviado</span>' : '<span class="chip">Sin enviar</span>';
  const venta = o.estado === 'vendido'
    ? `<div class="resumen-f"><span>Vendido por</span><b>${eur0(o.precio_venta)}</b><span>Fecha</span><b>${esc(fechaTxt(o.fecha_venta))}</b><span>Comprador</span><b>${esc(o.comprador_nombre || '—')}</b><span>Comisión</span><b>${o.comision ? eur(o.comision) : '—'}</b></div>
       <details style="margin-top:10px"><summary>Cambiar la venta</summary>${formVenta(o)}</details>`
    : formVenta(o);
  // 3. Su anuncio: se crea desde aquí en Shopify (borrador, ya ligado); allí se sube el vídeo y las fotos y se publica
  const sugeridos = o.handle ? [] : anuncios.filter((a) => !a.comunidad && !ligados.has(a.handle)).map((a) => ({ ...a, puntos: parecido(o.titulo || tituloCoche(c), a.titulo, { anioDistinto: 0.25 }) })).filter((a) => a.puntos >= 0.45).sort((a, b) => b.puntos - a.puntos).slice(0, 3);
  const tarjAnuncio = (a, boton) => `<div class="anu">${a.foto ? `<img src="${esc(a.foto)}" alt="">` : '<span class="anu-f"></span>'}<div><b>${esc(a.titulo)}</b><span>${a.situacion === 'vendido' ? 'Vendido en la web' : a.status === 'DRAFT' ? 'Borrador en Shopify' : a.situacion === 'oculto' ? 'Oculto en la web' : 'En venta en la web'}${a.puntos ? ` · se parece un ${Math.round(a.puntos * 100)} %` : ''}</span></div>${boton}</div>`;
  const enShopify = adminShopify(cfg, o);
  const borrador = enWeb && enWeb.status !== 'ACTIVE' && enWeb.situacion !== 'vendido';
  const anuncio = `${enWeb ? tarjAnuncio(enWeb, `<div class="acc-row" style="margin:0">${borrador ? `<a class="boton" href="${esc(enShopify)}" target="_blank" rel="noopener">Abrir en Shopify</a>` : `<a class="boton claro" href="${esc(cfg.tienda)}/products/${esc(o.handle)}" target="_blank" rel="noopener">Ver en la web</a><a class="boton claro" href="?estado=anuncio&h=${encodeURIComponent(o.handle)}">Sus números</a><a class="boton claro" href="?estado=ficha&h=${encodeURIComponent(o.handle)}">Editar</a>`}</div>`)
      : o.handle ? `<p>Ligado con <b>${esc(o.handle)}</b>${anuncios.length ? ' (ya no está en la tienda)' : ''}.</p>` : ''}
    ${borrador ? '<p class="aviso">Está en Shopify como <b>borrador</b>: sube allí el vídeo y las fotos, revisa la descripción y ponlo en <b>Activo</b>. En cuanto lo publiques, aquí pasa solo a «En venta».</p>' : ''}
    ${enWeb && enWeb.situacion === 'vendido' && o.estado !== 'vendido' ? '<p class="aviso">En la web ya está vendido: ponle abajo el precio final para hacer la factura.</p>' : ''}
    ${!o.handle ? `<p>${ct.firma ? 'Contrato firmado: ¡a por el anuncio!' : 'Puedes ir preparándolo mientras firma el contrato.'} Se crea en Shopify como <b>borrador</b>, ya ligado a esta ficha, con su título y su precio. Allí subís el vídeo y las fotos y lo publicáis.</p>
      <div class="acc-row">${f('crear-anuncio', 'Crear su anuncio en Shopify', ct.firma ? 'boton' : 'boton claro')}</div>
      ${sugeridos.length ? `<p style="margin-top:14px">¿Ya lo habéis subido? Es alguno de estos:</p>${sugeridos.map((a) => tarjAnuncio(a, `<form method="post" action="?estado=expediente&id=${id}"><input type="hidden" name="handle" value="${esc(a.handle)}"><button class="boton" name="accion" value="anuncio">Es este, ligar</button></form>`)).join('')}` : ''}` : ''}
    <details><summary>${o.handle ? 'Cambiar el anuncio' : 'Buscar otro anuncio de la web'}</summary><form method="post" action="?estado=expediente&id=${id}" class="acc-row"><input name="handle" list="anuncios-web" value="${esc(o.handle || '')}" placeholder="Busca su anuncio…" style="min-width:280px"><button class="boton claro" name="accion" value="anuncio">Ligar</button></form>
    <datalist id="anuncios-web">${anuncios.filter((a) => !a.comunidad).map((a) => `<option value="${esc(a.handle)}">${esc(a.titulo)}</option>`).join('')}</datalist></details>`;
  const prop = facturaPropuesta(o, e, facturas);
  const fact = factura
    ? `<div class="resumen-f"><span>Factura</span><b>${esc(factura.numero)}</b><span>Total</span><b>${eur(factura.total)}</b><span>A nombre de</span><b>${esc(factura.cliente)}</b><span>Pago</span><b>${esc(FORMAS_PAGO[factura.forma_pago] || '—')}</b></div>
      <p>${factura.datos?.enviada ? `Enviada el ${esc(fechaTxt(factura.datos.enviada.fecha))} por ${esc(factura.datos.enviada.via)}.` : 'Aún no se ha enviado.'}</p>
      <div class="acc-row"><a class="boton claro" href="${esc(urlFactura(cfg, factura.id))}" target="_blank" rel="noopener">Ver / PDF</a>
        ${(factura.datos?.destinatario?.email || p.email) ? f('factura-email', 'Enviar por email', 'boton') : ''}
        ${p.telefono ? `<a class="boton wa" href="?estado=expediente&id=${id}&wa=factura" target="_blank" rel="noopener">Enviar por WhatsApp</a>` : ''}
        ${f('factura-anular', 'Anular', 'boton claro', ' onclick="return confirm(\'¿Anular la factura? Queda como anulada (no se borra) y puedes hacer otra.\')"')}</div>`
    : o.estado !== 'vendido' ? '<p class="sub">Cuando lo marques como vendido, aquí harás la factura.</p>'
    : x.cobro ? `<p class="aviso">Comisión cobrada en <b>efectivo</b> el ${esc(fechaTxt(x.cobro.fecha))}, <b>sin factura</b>.</p><p class="sub">Toda venta tiene que llevar su factura, y en efectivo solo se puede cobrar por debajo de ${eur0(LIMITE_EFECTIVO)}. Hablad con la gestoría para regularizarla; la factura se puede hacer igualmente aquí:</p>
      <details><summary>Hacer la factura</summary>${formFactura(prop, e, id)}</details><div class="acc-row">${f('efectivo-deshacer', 'Deshacer «cobrada en efectivo»')}</div>`
    : `${formFactura(prop, e, id)}<div class="acc-row" style="margin-top:14px;padding-top:12px;border-top:1px solid var(--linea)"><span class="sub">¿Ya os pagó la comisión en efectivo sin factura?</span>${f('efectivo', 'Apuntar: cobrada en efectivo', 'boton claro', ' onclick="return confirm(\'¿Apuntar que la comisión ya se cobró en efectivo, sin factura? Recuerda: toda venta debe facturarse y en efectivo solo por debajo de 1.000 €.\')"')}</div>`;
  const cobro = factura
    ? factura.cobrada ? `<p>Cobrada el <b>${esc(fechaTxt(factura.cobrada))}</b> por ${esc(FORMAS_PAGO[factura.forma_pago] || '—')}.</p>${f('cobro-deshacer', 'Deshacer el cobro')}`
      : `<form method="post" action="?estado=expediente&id=${id}" class="acc-row"><label>Fecha<input type="date" name="cobrada" value="${hoyISO()}"></label><label>Cómo<select name="forma_pago">${Object.entries(FORMAS_PAGO).map(([a, b]) => `<option value="${a}"${factura.forma_pago === a ? ' selected' : ''}>${b}</option>`).join('')}</select></label><button class="boton" name="accion" value="cobrada">Marcar como cobrada</button></form>
        ${n(factura.total) >= LIMITE_EFECTIVO ? `<p class="aviso-ef">Esta factura es de ${eur0(LIMITE_EFECTIVO)} o más: no se puede cobrar en efectivo (Ley 7/2012).</p>` : ''}`
    : x.cobro && o.estado === 'vendido' ? `<p>Cobrada en efectivo el <b>${esc(fechaTxt(x.cobro.fecha))}</b> (sin factura).</p>` : '<p class="sub">Primero, la factura.</p>';
  const hist = (x.historial || []).slice().reverse().map((h) => `<li><time>${esc(new Date(h.fecha).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }))}</time>${esc(h.texto)}</li>`).join('');
  const tel = p.telefono || '', wa = telWa(tel);
  const dato = (t, v) => `<div><dt>${t}</dt><dd>${v || '<span class="sub">—</span>'}</dd></div>`;
  const docs = [
    ct.firma ? ['Contrato de intermediación y exclusividad', `Firmado ${ct.firma.papel ? 'en papel' : 'electrónicamente'} el ${fechaTxt(ct.firma.fecha)}${ct.hash ? ` · huella ${ct.hash.slice(0, 10)}…` : ''}`, urlIntermediacion(cfg, id), 'ok']
      : ['Contrato de intermediación y exclusividad', ct.enviado ? `Enviado el ${fechaTxt(ct.enviado)}: sin firmar` : 'Borrador: aún sin enviar', urlIntermediacion(cfg, id), ct.enviado ? 'am' : ''],
    ...facturas.filter((fa) => Number(fa.operacion_id) === id).map((fa) => [`Factura ${fa.numero}`, `${eur(fa.total)} · ${fa.estado === 'anulada' ? 'anulada' : fa.cobrada ? `cobrada el ${fechaTxt(fa.cobrada)}` : 'sin cobrar'}`, urlFactura(cfg, fa.id), fa.estado === 'anulada' ? 'no' : fa.cobrada ? 'ok' : 'am'])];
  const chipF = factura ? (factura.cobrada ? '<span class="chip si">Cobrada</span>' : '<span class="chip am">Emitida</span>') : x.cobro ? '<span class="chip no">Efectivo · sin factura</span>' : '';
  return marco(o.titulo || 'Coche', 'sidonia', `
<p class="migas"><a href="?estado=sidonia">‹ Coches de Sidonia</a></p>
${aviso ? `<p class="aviso${/^Error/.test(aviso) ? ' mal' : ''}">${esc(aviso)}</p>` : ''}
<div class="card fc-cab">
  ${enWeb?.foto ? `<img src="${esc(enWeb.foto)}" alt="">` : '<span class="fc-sin"></span>'}
  <div class="fc-t"><h1>${esc(o.titulo || tituloCoche(c))}</h1>
    <p>${esc([c.matricula, c.anio, c.km && `${c.km} km`, o.comercial && `lo lleva ${o.comercial}`].filter(Boolean).join(' · ')) || '&nbsp;'}</p>
    <div class="fc-chips"><span class="chip si">${esc({ venta: 'En cartera', factura: 'Por facturar', cobro: 'Por cobrar', hecho: 'Cerrado' }[paso] || nombrePaso(paso))}</span>${chipC}${enWeb && !borrador ? '<span class="chip si">En la web</span>' : borrador ? '<span class="chip am">Borrador en Shopify</span>' : ''}${chipF}</div></div>
  <div class="fc-precio">${o.estado === 'vendido' && o.precio_venta ? `<span>Vendido por</span><b>${eur0(o.precio_venta)}</b>` : `<span>Precio</span><b>${k.precio_salida ? eur0(k.precio_salida) : '—'}</b>`}<small>comisión ${esc(String(k.comision_pct ?? e.comision_pct).replace('.', ','))} %${o.comision ? ` · ${eur(o.comision)}` : ''}</small>
    <div class="acc-row">${o.handle ? `<a class="boton claro" href="${esc(cfg.tienda)}/products/${esc(o.handle)}" target="_blank" rel="noopener">Ver en la web</a><a class="boton claro" href="?estado=ficha&h=${encodeURIComponent(o.handle)}">Editar anuncio</a>` : ''}</div></div>
</div>
${pasos}
<div class="fc-grid">
  <div class="fc-izq">
    <div class="card"><div class="fc-h"><h2>Propietario</h2>${wa ? `<a class="boton wa peq" href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</div>
      <dl class="fc-dl">${dato('Nombre', esc(p.nombre))}${dato('DNI / NIE / CIF', esc(p.dni))}${dato('Teléfono', tel ? `<a href="tel:${esc(tel)}">${esc(tel)}</a>` : '')}${dato('Email', p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : '')}<div class="ancho"><dt>Domicilio</dt><dd>${esc(p.direccion) || '<span class="sub">—</span>'}</dd></div></dl></div>
    <div class="card"><h2>Coche y condiciones</h2>
      <dl class="fc-dl">${dato('Marca', esc(c.marca))}${dato('Modelo', esc(c.modelo))}${dato('Año', esc(c.anio))}${dato('Kilómetros', esc(c.km))}${dato('Matrícula', esc(c.matricula))}${dato('Bastidor', esc(c.bastidor))}
        ${dato('Precio de salida', k.precio_salida ? eur0(k.precio_salida) : '')}${dato('Precio mínimo', k.precio_minimo ? eur0(k.precio_minimo) : '')}${dato('Comisión', k.comision_pct != null ? `${esc(String(k.comision_pct).replace('.', ','))} %${k.comision_min ? ` (mín. ${eur0(k.comision_min)})` : ''}` : '')}${dato('Exclusividad', k.exclusividad_meses ? `${k.exclusividad_meses} meses` : '')}${dato('Cómo llegó', esc(ORIGENES[x0.origen] || (Object.keys(x0).length ? '' : 'Antes del panel')))}${dato('Lo lleva', esc(o.comercial))}</dl>
      ${x.notas ? `<p class="sub">${esc(x.notas)}</p>` : ''}</div>
    <div class="card"><details${p.nombre && c.matricula ? '' : ' open'} class="fc-ed"><summary>Editar la ficha (propietario, coche y condiciones)</summary>${formExpediente(o, e)}</details></div>
    <div class="card"><h2>Documentos</h2><ul class="fc-docs">${docs.map(([t, sub, url, cl]) => `<li><span class="doc-i ${cl}"></span><div><b>${esc(t)}</b><small>${esc(sub)}</small></div><a class="boton claro peq" href="${esc(url)}" target="_blank" rel="noopener">Ver / PDF</a></li>`).join('')}</ul>
      <p class="sub">El contrato firmado se guarda en esta ficha tal cual se firmó (con la fecha, la IP y su huella); «Ver / PDF» lo abre para imprimirlo o guardarlo en PDF.</p></div>
    ${hist ? `<div class="card"><h2>Historial</h2><ul class="hist">${hist}</ul></div>` : ''}
  </div>
  <div class="fc-der">
${blq(0, '1. Contrato de intermediación y exclusividad', chipC, contrato, 'contrato')}
${blq(1, '2. Su anuncio en la web', enWeb && !borrador ? '<span class="chip si">En la web</span>' : borrador ? '<span class="chip am">Borrador en Shopify</span>' : '', anuncio, 'anuncio')}
${blq(2, '3. Vendido', o.estado === 'vendido' ? '<span class="chip si">Vendido</span>' : '', venta, 'venta')}
${blq(3, '4. Factura', chipF, fact, 'factura')}
${blq(4, '5. Cobro', factura?.cobrada || x.cobro ? '<span class="chip si">Cobrada</span>' : factura ? '<span class="chip am">Pendiente</span>' : '', cobro, 'cobro')}
  </div>
</div>`, CSS + CSS_FICHA);
}
const CSS_FICHA = `
  .migas { margin: 4px 0 10px; font-size: 14px; } .migas a { color: var(--suave); text-decoration: none; } .migas a:hover { color: var(--texto); }
  .fc-cab { display: grid; grid-template-columns: 132px 1fr auto; gap: 20px; align-items: center; }
  .fc-cab > img, .fc-sin { width: 132px; height: 99px; border-radius: 14px; object-fit: cover; background: var(--caja-3); display: block; }
  .fc-t h1 { margin: 0; font-size: 24px; letter-spacing: -.01em; } .fc-t p { margin: 4px 0 10px; color: var(--suave); }
  .fc-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .fc-precio { text-align: right; } .fc-precio span { display: block; font-size: 12px; color: var(--suave); } .fc-precio b { display: block; font-size: 28px; letter-spacing: -.02em; } .fc-precio small { color: var(--suave); }
  .fc-precio .acc-row { justify-content: flex-end; }
  .fc-grid { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 16px; align-items: start; }
  .fc-izq .card, .fc-der .card { margin: 0 0 14px; }
  .fc-h { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 14px; } .fc-h h2 { margin: 0; } .fc-h .boton { flex: none; white-space: nowrap; }
  .fc-der .g3, .fc-der .g2 { grid-template-columns: 1fr 1fr; } .fc-grid input, .fc-grid select { width: 100%; min-width: 0; } .fc-der .acc-row input, .fc-der .acc-row select { width: auto; }
  .fc-dl { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; margin: 0; } .fc-dl dt { font-size: 12px; color: var(--suave); } .fc-dl dd { margin: 2px 0 0; font-weight: 600; word-break: break-word; } .fc-dl .ancho { grid-column: 1 / -1; }
  .fc-ed summary { cursor: pointer; font-weight: 700; } .fc-ed[open] summary { margin-bottom: 12px; }
  .fc-ed .g3 { grid-template-columns: 1fr 1fr; }
  .fc-docs { list-style: none; margin: 0 0 10px; padding: 0; } .fc-docs li { display: flex; gap: 12px; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--linea); }
  .fc-docs li div { flex: 1; min-width: 0; } .fc-docs b { display: block; font-size: 14px; } .fc-docs small { color: var(--suave); font-size: 12px; }
  .doc-i { flex: none; width: 32px; height: 40px; border-radius: 6px; background: var(--caja-3); position: relative; } .doc-i::after { content: ''; position: absolute; left: 7px; right: 7px; top: 10px; height: 2px; background: var(--linea-2); box-shadow: 0 6px 0 var(--linea-2), 0 12px 0 var(--linea-2); }
  .doc-i.ok { background: var(--verde-fondo); } .doc-i.am { background: var(--amarillo-fondo); } .doc-i.no { background: var(--rojo-fondo); }
  .boton.grande { padding: 14px 22px; font-size: 16px; } .fs legend small { font-weight: 400; color: var(--suave); } .fx textarea { width: 100%; font: inherit; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--linea-2); background: var(--caja); color: var(--texto); }
  .boton.peq { padding: 6px 12px; font-size: 13px; }
  @media (max-width: 1000px) { .fc-grid { grid-template-columns: 1fr; } .fc-cab { grid-template-columns: 96px 1fr; } .fc-cab > img, .fc-sin { width: 96px; height: 72px; } .fc-precio { grid-column: 1 / -1; text-align: left; } .fc-precio .acc-row { justify-content: flex-start; } }`;
function formVenta(o) {
  return `<form method="post" action="?estado=expediente&id=${Number(o.id)}"><div class="g3">
    ${campo('Precio final de venta (€)', 'precio_venta', o.precio_venta, ' inputmode="decimal" required')}<label>Fecha de venta<input type="date" name="fecha_venta" value="${esc(String(o.fecha_venta || hoyISO()).slice(0, 10))}" required></label>${campo('Comprador', 'comprador_nombre', o.comprador_nombre)}
    ${campo('Teléfono del comprador', 'comprador_telefono', o.comprador_telefono)}${campo('Email del comprador', 'comprador_email', o.comprador_email)}</div>
    <div class="acc-row"><button class="boton" name="accion" value="vendido">${o.estado === 'vendido' ? 'Guardar' : 'Marcar como vendido'}</button></div></form>`;
}
function formFactura(pr, e, id) {
  return `<form method="post" action="?estado=expediente&id=${Number(id)}" class="factura-f">
  <fieldset class="fs"><legend>A nombre de</legend><p class="sub" style="margin-top:0">Por defecto, el propietario. Cámbialo si la quiere a nombre de otra persona o empresa.</p><div class="g2">
    ${campo('Nombre o empresa', 'd_nombre', pr.destinatario.nombre, ' required')}${campo('NIF / CIF', 'd_nif', pr.destinatario.nif)}
    <label class="ancho">Domicilio<input name="d_direccion" value="${esc(pr.destinatario.direccion)}"></label></div></fieldset>
  <fieldset class="fs"><legend>Importe</legend><div class="g3">
    ${campo('Precio final de venta (€)', 'precio_venta', pr.precio_venta, ' inputmode="decimal" data-pv')}${campo('Nuestra comisión (%)', 'pct', pr.pct, ' inputmode="decimal" data-pct')}${campo('Base: nuestra comisión sin IVA (€)', 'base', pr.base, ' inputmode="decimal" required data-base')}
    ${campo('IVA (%)', 'iva_pct', pr.iva_pct, ' inputmode="decimal" data-iva')}<label>Total con IVA<input data-total readonly></label>
    <label>Forma de pago<select name="forma_pago" data-forma>${Object.entries(FORMAS_PAGO).map(([a, b]) => `<option value="${a}">${b}</option>`).join('')}</select></label></div>
    <p class="aviso-ef" data-ef hidden>En efectivo solo si el total es menor de ${eur0(LIMITE_EFECTIVO)} (Ley 7/2012). Si es más, por transferencia, Bizum o tarjeta.</p></fieldset>
  <fieldset class="fs"><legend>Factura</legend><div class="g3">${campo('N.º de factura', 'numero', pr.numero, ' required')}<label>Fecha<input type="date" name="fecha" value="${esc(pr.fecha)}" required></label>${campo('Concepto', 'concepto', pr.concepto)}</div></fieldset>
  ${!emisorCompleto(e) ? '<p class="aviso mal">Faltan los datos de Sidonia para la factura: Finanzas › Datos de facturación.</p>' : ''}
  <button class="boton" name="accion" value="factura">Crear la factura</button></form>
  <script>(() => { const f = document.querySelector('.factura-f'); const q = (s) => f.querySelector(s); const nn = (v) => { const s = String(v || '').replace(/\\s|€|%/g, ''); return Number(/,\\d{1,2}$/.test(s) ? s.replace(/\\./g, '').replace(',', '.') : s.replace(/,/g, '')) || 0; };
    const fmt = (x) => x.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
    const tot = () => { const t = nn(q('[data-base]').value) * (1 + nn(q('[data-iva]').value) / 100); q('[data-total]').value = fmt(t); q('[data-ef]').hidden = !(q('[data-forma]').value === 'efectivo' && t >= ${LIMITE_EFECTIVO}); };
    const base = () => { const b = Math.round(nn(q('[data-pv]').value) * nn(q('[data-pct]').value)) / 100; if (b) q('[data-base]').value = String(b).replace('.', ','); tot(); };
    q('[data-pv]').addEventListener('input', base); q('[data-pct]').addEventListener('input', base); ['[data-base]', '[data-iva]', '[data-forma]'].forEach((s) => q(s).addEventListener('input', tot)); tot(); })();</script>`;
}

/** Anuncios › De Sidonia: cada coche que vende Sidonia, con su foto, el paso en el que está y lo siguiente que hay que hacer */
const CSS_SD = `
  .sd-cab { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; margin: 4px 0 14px; }
  .sd-cab h1 { margin: 0; font-size: 26px; letter-spacing: -.02em; } .sd-cab p { margin: 2px 0 0; color: var(--suave); font-size: 14px; }
  .sd-cab .boton { padding: 12px 18px; font-size: 15px; }
  .sd-aviso { display: flex; gap: 12px; align-items: center; justify-content: space-between; padding: 12px 16px; border-radius: 14px; margin: 0 0 12px; background: rgba(240,180,0,.1); border: 1px solid rgba(240,180,0,.35); font-size: 14px; }
  .sd-flujo { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin: 0 0 12px; }
  .sd-flujo a { position: relative; display: block; text-decoration: none; color: inherit; padding: 12px 14px; border-radius: 16px; background: var(--caja); border: 1px solid var(--linea); }
  .sd-flujo a:hover { border-color: var(--linea-2); } .sd-flujo a.on { border-color: var(--verde); box-shadow: 0 0 0 1px var(--verde) inset; }
  .sd-flujo small { display: block; font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--suave); }
  .sd-flujo b { display: block; font-size: 28px; line-height: 1.15; } .sd-flujo span { font-size: 12px; color: var(--flojo); }
  .sd-flujo a:not(:last-child):not(.otro)::after { content: '›'; position: absolute; right: -8px; top: 50%; transform: translateY(-50%); color: var(--flojo); font-weight: 800; z-index: 1; }
  .sd-flujo a.otro { display: flex; flex-direction: column; justify-content: center; }
  .sd-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 0 0 14px; }
  .sd-bar input[type=search] { flex: 1; min-width: 220px; }
  .sd-lista { background: var(--caja); border: 1px solid var(--linea); border-radius: 16px; box-shadow: var(--sombra); overflow: hidden; }
  .sd-r { display: grid; grid-template-columns: 64px minmax(0, 2.2fr) minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1.6fr) minmax(0, 2.4fr); gap: 14px; align-items: center; padding: 10px 16px; border-bottom: 1px solid var(--linea); }
  .sd-r:last-child { border-bottom: 0; } .sd-r:not(.sd-th):hover { background: var(--caja-2); }
  .sd-th { padding: 10px 16px; font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--flojo); background: var(--caja-2); }
  .sd-m img, .sd-m span { display: block; width: 64px; height: 48px; border-radius: 10px; object-fit: cover; background: var(--caja-3); }
  .sd-r b { display: block; font-size: 14px; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; } .sd-co a { text-decoration: none; color: inherit; } .sd-co a:hover b { color: var(--verde); }
  .sd-r small { display: block; font-size: 12px; color: var(--suave); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sd-es { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; } .sd-es .e { font-size: 12px; color: var(--suave); line-height: 1.3; } .sd-es .e.am { color: var(--amarillo); } .sd-es .e.no { color: var(--rojo); }
  .sd-p { padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 800; background: var(--caja-3); color: var(--suave); white-space: nowrap; }
  .sd-p.solicitud { background: rgba(236,72,153,.12); color: #db2777; } .sd-p.contrato { background: var(--amarillo-fondo); color: var(--amarillo); } .sd-p.anuncio { background: var(--azul-fondo); color: var(--azul); }
  .sd-p.venta { background: var(--verde-fondo); color: var(--verde); } .sd-p.factura { background: rgba(249,115,22,.12); color: #ea580c; } .sd-p.cobro { background: var(--lila-fondo); color: var(--lila); } .sd-p.sinf { background: var(--rojo-fondo); color: var(--rojo); }
  .sd-a { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; justify-content: flex-end; } .sd-a form { display: contents; }
  .sd-a .boton { padding: 7px 12px; font-size: 13px; } .sd-a .boton.wa { background: #25d366; color: #04150c !important; }
  .sd-ir { display: inline-flex; gap: 2px; margin-left: 4px; } .sd-ir .ic { padding: 6px 8px; border-radius: 8px; font-size: 12px; font-weight: 700; color: var(--suave); text-decoration: none; } .sd-ir .ic:hover { background: var(--caja-3); color: var(--texto); }
  .sd-a .ic-b { all: unset; cursor: pointer; padding: 6px 8px; border-radius: 8px; font-size: 12px; font-weight: 700; color: var(--suave); } .sd-a .ic-b:hover { background: var(--caja-3); color: var(--rojo); }
  .mcs { display: flex; flex-wrap: wrap; gap: 4px; } .mc { padding: 2px 8px; border-radius: 6px; font-size: 11.5px; font-weight: 700; background: var(--caja-3); color: var(--suave); white-space: nowrap; }
  .mc.ok { background: var(--verde-fondo); color: var(--verde); } .mc.am { background: var(--amarillo-fondo); color: var(--amarillo); } .mc.no { background: var(--rojo-fondo); color: var(--rojo); } .mc.az { background: var(--azul-fondo); color: var(--azul); }
  .boton.az { background: var(--azul); color: #fff !important; }
  .sd-flujo { grid-template-columns: repeat(4, 1fr) !important; }
  .sd-subs { display: flex; flex-wrap: wrap; gap: 6px; margin: -4px 0 12px; } .sd-subs a { padding: 6px 12px; border-radius: 999px; border: 1px solid var(--linea); background: var(--caja); font-size: 13px; font-weight: 700; text-decoration: none; color: var(--suave); }
  .sd-subs a.on { border-color: var(--verde); color: var(--verde); background: var(--verde-fondo); }
  .sd-masivo { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; padding: 12px 16px; margin: 0 0 12px; border-radius: 14px; background: var(--amarillo-fondo); font-size: 14px; }
  .sd-bar .boton.on { border-color: var(--verde); color: var(--verde); }
  @media (max-width: 1250px) { .sd-r { grid-template-columns: 56px minmax(0, 2fr) minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1.5fr); } .sd-a { grid-column: 2 / -1; justify-content: flex-start; } .sd-m img, .sd-m span { width: 56px; height: 42px; } }
  @media (max-width: 760px) { .sd-th { display: none; } .sd-r { grid-template-columns: 56px 1fr auto; } .sd-pr, .sd-es { grid-column: 2 / -1; } .sd-pz { grid-column: 3; grid-row: 1; text-align: right; } .sd-a { grid-column: 1 / -1; } }
  .sd-vacio { padding: 40px 20px; text-align: center; color: var(--suave); border: 1px dashed var(--linea-2); border-radius: 18px; }
  @media (max-width: 900px) { .sd-flujo { grid-template-columns: repeat(3, 1fr); } .sd-flujo a::after { display: none; } }
  @media (max-width: 520px) { .sd-flujo { grid-template-columns: 1fr 1fr; } .sd-grid { grid-template-columns: 1fr 1fr; gap: 10px; } .sd-a .boton { flex: 1; text-align: center; } }`;

export function paginaSidonia(cfg, items, { ver = 'disponible', sub = '', aviso = '', gestiones = 0, emisor = {} } = {}) {
  const subf = { sinfactura: (x) => x.paso === 'factura', sincobrar: (x) => x.paso === 'cobro', efectivo: (x) => Boolean(x.o?.expediente?.cobro && !x.f) };
  const de = (k) => items.filter((x) => (k === 'todo' ? x.grupo === 'disponible' || x.grupo === 'vendido' : x.grupo === k));
  const cuenta = (k) => de(k).length;
  // Del más reciente al más antiguo: por cuándo se anunció (o se dio de alta); los vendidos, por cuándo se vendieron
  const fecha = (x) => String((x.grupo === 'vendido' && x.o?.fecha_venta) || x.prod?.creado || x.o?.fecha_alta || x.o?.creado || x.g?.creado || '');
  const lista = de(ver).filter((x) => ver !== 'vendido' || !sub || subf[sub](x)).sort((a, b) => fecha(b).localeCompare(fecha(a)));
  const listoContrato = (o) => emisorCompleto(leerEmisor(emisor)) && o.expediente?.coche?.matricula;
  const tarjeta = ({ o, prod, f, paso, sinFicha, g }) => {
    const x = o?.expediente || {}, p = x.propietario || {}, ct = x.contrato || {};
    const gd = g?.datos || {};
    const titulo = g ? ([gd.marca, gd.modelo, gd.anio].filter(Boolean).join(' ') || 'Vehículo').toUpperCase() : prod?.titulo || o?.titulo || '';
    const enlace = g ? `?estado=gestiones#g${Number(g.id)}` : o ? `?estado=expediente&id=${Number(o.id)}` : `?estado=ligar&h=${encodeURIComponent(prod.handle)}`;
    const precio = !o ? '' : o?.estado === 'vendido' && o.precio_venta ? `vendido por ${eur0(o.precio_venta)}` : n(x.condiciones?.precio_salida ?? o?.precio_anunciado) ? eur0(x.condiciones?.precio_salida ?? o.precio_anunciado) : '';
    const quien = g ? [gd.nombre, gd.precio && `pide ${gd.precio} €`, gd.km && `${gd.km} km`].filter(Boolean).join(' · ') : [p.nombre || o?.propietario_nombre, precio].filter(Boolean).join(' · ');
    const post = (accion, txt, clase = 'boton') => `<form method="post" action="?estado=expediente&id=${Number(o.id)}"><input type="hidden" name="volver" value="sidonia"><button class="${clase}" name="accion" value="${accion}">${txt}</button></form>`;
    let estado = '', acc = '';
    if (g) {
      const d = g.datos || {};
      const tel = String(d.telefono || '').replace(/[^\d]/g, '');
      const coche = [d.marca, d.modelo, d.anio].filter(Boolean).join(' ') || 'su coche';
      const wa = tel ? `https://wa.me/${tel.length === 9 ? `34${tel}` : tel}?text=${encodeURIComponent(`Hola ${String(d.nombre || '').split(' ')[0]}, soy Hugo de Sidonia. Hemos visto que quieres vender tu ${coche}. ¿Te viene bien que hablemos un momento y te cuento cómo lo hacemos?`)}` : '';
      estado = `<span class="e am">${g.creado ? `Llegó el ${esc(fechaTxt(g.creado))}` : 'Nueva'}${g.estado === 'contactado' ? ' · ya contactado' : ''}</span>`;
      acc = `${wa ? `<a class="boton wa" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}<form method="post" action="?estado=expediente"><input type="hidden" name="gestion" value="${Number(g.id)}"><button class="boton${wa ? ' claro' : ''}" name="accion" value="desde-gestion">Crear ficha y contrato</button></form>
        <form method="post" action="?estado=sidonia&ver=solicitud"><input type="hidden" name="gestion" value="${Number(g.id)}"><button class="ic-b" name="accion" value="descartar" onclick="return confirm('¿Descartar esta solicitud?')">Descartar</button></form>`;
    } else if (sinFicha) {
      estado = '<span class="e am">Sin ficha de propietario ni contrato</span>';
      acc = `<a class="boton" href="${enlace}">Añadir su propietario</a>`;
    } else if (paso === 'venta') {
      const sc = situacionCartera(o, prod);
      const tel = p.telefono || o.propietario_telefono;
      const chips = { firmado: '<span class="mc ok">Contrato firmado</span>', enviado: `<span class="mc am">Contrato enviado el ${esc(fechaCorta(ct.enviado))}</span>`, sin_enviar: '<span class="mc no">Contrato sin enviar</span>', antes: '<span class="mc">Sin contrato en el panel</span>' }[sc.contrato]
        + ({ en_web: '<span class="mc ok">En la web</span>', borrador: '<span class="mc az">Borrador: falta el vídeo</span>', sin_anuncio: '<span class="mc no">Sin anuncio</span>' }[sc.anuncio]);
      estado = `<span class="mcs">${chips}</span>`;
      const contratoAcc = ['sin_enviar', 'enviado'].includes(sc.contrato)
        ? (!listoContrato(o) ? `<a class="boton claro" href="${enlace}#contrato">Completar el contrato</a>` : `${tel ? `<a class="boton wa" href="?estado=expediente&id=${Number(o.id)}&wa=contrato" target="_blank" rel="noopener">${sc.contrato === 'enviado' ? 'Reenviar' : 'Enviar'} contrato</a>` : ''}${p.email ? post('contrato-email', sc.contrato === 'enviado' ? 'Reenviar email' : 'Por email', 'boton claro') : ''}`) : '';
      const anuncioAcc = sc.anuncio === 'sin_anuncio' ? post('crear-anuncio', 'Crear borrador en Shopify', 'boton') : sc.anuncio === 'borrador' ? `<a class="boton az" href="${esc(adminShopify(cfg, o))}" target="_blank" rel="noopener">Subir el vídeo en Shopify</a>` : '';
      acc = `${contratoAcc}${anuncioAcc}${sc.anuncio === 'en_web' ? `<a class="boton claro" href="${enlace}#venta">Vendido</a>` : ''}`;
    } else if (paso === 'factura') {
      estado = `<span class="e am">${o?.estado === 'vendido' ? 'Vendido: falta la factura' : 'Vendido en la web: pon el precio final'}</span>`;
      acc = `<a class="boton" href="${enlace}#${o?.estado === 'vendido' ? 'factura' : 'venta'}">${o?.estado === 'vendido' ? 'Hacer la factura' : 'Poner el precio'}</a>${o?.estado === 'vendido' ? `<form method="post" action="?estado=expediente&id=${Number(o.id)}"><input type="hidden" name="volver" value="sidonia"><button class="boton claro" name="accion" value="efectivo" onclick="return confirm('¿Apuntar que la comisión ya se cobró en efectivo, sin factura?')">Cobrada en efectivo</button></form>` : ''}`;
    } else if (paso === 'cobro') {
      estado = `<span class="e am">Factura ${esc(f.numero)} · ${eur(f.total)} sin cobrar</span>`;
      acc = `<a class="boton" href="${enlace}#cobro">Marcar cobrada</a>${p.telefono || o.propietario_telefono ? `<a class="boton claro" href="?estado=expediente&id=${Number(o.id)}&wa=factura" target="_blank" rel="noopener">Reenviar</a>` : ''}`;
    } else {
      estado = x.cobro && !f ? '<span class="e no">Cobrada en efectivo · sin factura</span>' : `<span class="e">${o?.estado === 'retirado' ? 'Retirado' : f ? `Cobrado · factura ${esc(f.numero)}` : 'Vendido'}</span>`;
      acc = `<a class="boton claro" href="${enlace}">Ver</a>`;
    }
    const foto = g ? (gd.fotos || []).map((u) => (/^https?:/.test(u) ? u : `${cfg.supabaseUrl}/storage/v1/object/public/anuncios/${u}`))[0] : prod?.foto;
    const c = x.coche || {};
    const q = normalTexto(`${titulo} ${gd.nombre || ''} ${p.nombre || o?.propietario_nombre || ''} ${o?.comercial || ''} ${c.matricula || ''} ${p.telefono || o?.propietario_telefono || gd.telefono || ''}`);
    const nombre = g ? gd.nombre : p.nombre || o?.propietario_nombre;
    const telefono = g ? gd.telefono : p.telefono || o?.propietario_telefono;
    const detalle = g ? [gd.km && `${gd.km} km`, gd.ubicacion].filter(Boolean).join(' · ') : [c.matricula, o?.comercial && `lleva ${o.comercial}`].filter(Boolean).join(' · ');
    const importe = g ? (gd.precio ? `${esc(String(gd.precio))} €` : '') : o?.estado === 'vendido' && o.precio_venta ? eur0(o.precio_venta) : prod?.precio ? eur0(prod.precio) : n(x.condiciones?.precio_salida ?? o?.precio_anunciado) ? eur0(x.condiciones?.precio_salida ?? o.precio_anunciado) : prod?.precio ? eur0(prod.precio) : '';
    const bajo = g ? 'lo que pide' : o?.estado === 'vendido' ? (o.comision ? `vendido · comisión ${eur0(o.comision)}` : 'vendido') : importe ? 'precio' : '';
    const ir = [o && `<a class="ic" href="?estado=expediente&id=${Number(o.id)}" title="Ficha del coche">Ficha</a>`, (o?.handle || prod?.handle) && `<a class="ic" href="?estado=ficha&h=${encodeURIComponent(o?.handle || prod.handle)}" title="Editar el anuncio">Editar</a>`,
      (o?.handle || prod?.handle) && (!o || situacionCartera(o, prod).anuncio === 'en_web') && `<a class="ic" href="${esc(cfg.tienda)}/products/${esc(o?.handle || prod.handle)}" target="_blank" rel="noopener" title="Ver en la web">Web ↗</a>`].filter(Boolean).join('');
    return `<div class="sd-r" data-q="${esc(q)}">
    <a class="sd-m" href="${enlace}">${foto ? `<img src="${esc(foto)}" alt="" loading="lazy">` : '<span></span>'}</a>
    <div class="sd-co"><a href="${enlace}"><b>${esc(titulo)}</b></a><small>${esc(detalle) || '&nbsp;'}</small></div>
    <div class="sd-pr">${nombre ? `<b>${esc(nombre)}</b>` : '<span class="sub">Sin propietario</span>'}<small>${telefono ? esc(telefono) : '&nbsp;'}</small></div>
    <div class="sd-pz"><b>${importe || '—'}</b><small>${esc(bajo)}</small></div>
    <div class="sd-es">${paso === 'venta' && o && !sinFicha ? '' : `<span class="sd-p ${paso}${sinFicha ? ' sinf' : ''}">${esc(sinFicha ? 'Sin propietario' : g ? 'Solicitud' : { venta: 'En cartera', factura: 'Por facturar', cobro: 'Por cobrar', hecho: o?.estado === 'retirado' || prod?.status === 'ARCHIVED' ? 'Archivado' : 'Cerrado' }[paso])}</span>`}${estado}</div>
    <div class="sd-a">${acc}<span class="sd-ir">${ir}</span></div></div>`;
  };
  const T = [['solicitud', 'Solicitudes', 'quieren que vendamos su coche'], ['proximamente', 'Próximamente', 'dados de alta, aún sin publicar'], ['disponible', 'Disponibles', 'a la venta en la web'], ['vendido', 'Vendidos', 'desde el principio']];
  const flujo = T.map(([k, t, ayuda]) => `<a href="?estado=sidonia&ver=${k}" class="${ver === k ? 'on' : ''}"><small>${t}</small><b>${fmtN(cuenta(k))}</b><span>${ayuda}</span></a>`).join('');
  const nSub = (k) => de('vendido').filter(subf[k]).length;
  const subs = ver === 'vendido' ? `<div class="sd-subs"><a href="?estado=sidonia&ver=vendido" class="${!sub ? 'on' : ''}">Todos · ${fmtN(cuenta('vendido'))}</a>${[['sinfactura', 'Sin factura'], ['sincobrar', 'Factura sin cobrar'], ['efectivo', 'Efectivo sin factura']].filter(([k]) => nSub(k)).map(([k, t]) => `<a href="?estado=sidonia&ver=vendido&f=${k}" class="${sub === k ? 'on' : ''}">${t} · ${fmtN(nSub(k))}</a>`).join('')}</div>` : '';
  const sinFact = de('vendido').filter((x) => x.paso === 'factura' && x.o?.estado === 'vendido').length;
  return marco('Coches de Sidonia', 'sidonia', `
${aviso ? `<p class="aviso${/^Error/.test(aviso) ? ' mal' : ''}">${esc(aviso)}</p>` : ''}
<div class="sd-cab"><div><h1>Coches de Sidonia</h1><p>Se han anunciado <b>${fmtN(cuenta('todo'))}</b> coches: <b>${fmtN(cuenta('disponible'))}</b> a la venta y <b>${fmtN(cuenta('vendido'))}</b> vendidos.</p></div><a class="boton" href="?estado=expediente&nuevo=1">+ Nuevo coche</a></div>
<div class="sd-flujo">${flujo}</div>
<div class="sd-bar"><input type="search" placeholder="Buscar coche, propietario, matrícula, teléfono…" oninput="const q=this.value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');document.querySelectorAll('.sd-r[data-q]').forEach((c)=>{c.hidden=q&&!c.dataset.q.includes(q)})"></div>
${subs}
${ver === 'vendido' && sub === 'sinfactura' && sinFact ? `<form method="post" action="?estado=sidonia&ver=vendido&f=sinfactura" class="sd-masivo"><span>¿Las comisiones de estas ventas ya se cobraron en efectivo, sin factura? Apúntalo de una vez (se pueden facturar luego igualmente).</span><button class="boton claro" name="accion" value="efectivo-todas" onclick="return confirm('¿Apuntar como cobradas en efectivo, sin factura, las ${fmtN(sinFact)} ventas sin factura? Recordad: toda venta debe facturarse y en efectivo solo por debajo de 1.000 €. Hablad con la gestoría para regularizarlas.')">Marcar todas como cobradas en efectivo</button></form>` : ''}
${lista.length ? `<div class="sd-lista"><div class="sd-r sd-th"><span></span><span>Coche</span><span>Propietario</span><span>Precio</span><span>Estado</span><span></span></div>${lista.map(tarjeta).join('')}</div>` : `<div class="sd-vacio">${{ solicitud: 'No hay solicitudes nuevas.', proximamente: 'Nada pendiente de subir. Da de alta un coche con «+ Nuevo coche».', disponible: 'No hay coches a la venta.', vendido: 'Nada aquí.' }[ver] || 'Nada aquí.'}</div>`}
<p class="nota"><b>Solicitudes:</b> los del formulario de la web; «Crear ficha y contrato» los pasa a Próximamente. <b>Próximamente:</b> los que Hugo da de alta con «+ Nuevo coche» (se crea su borrador en Shopify y el contrato) o se crean como borrador en Shopify: cuando subís el vídeo y lo activáis en Shopify, pasa solo a <b>Disponibles</b>. Al venderse, «Vendido» con el precio final, y en <b>Vendidos</b> la factura y el cobro. En Próximamente salen todos los borradores de Shopify (los creados aquí y allí); los archivados no salen. Lo que se cambie en Shopify (título, descripción, precio) pasa a la ficha, y al revés.</p>`, CSS + CSS_SD);
}

/** Finanzas › Datos de facturación */
export function paginaAjustes(emisor, { aviso = '' } = {}) {
  const e = leerEmisor(emisor);
  return marco('Datos de facturación', 'facturacion', `
${aviso ? `<p class="aviso${/^Error/.test(aviso) ? ' mal' : ''}">${esc(aviso)}</p>` : ''}
<div class="card"><h2>Quién emite las facturas y los contratos</h2><p class="sub">Salen en cada factura y en el contrato de intermediación. Cuando tengáis la sociedad, cambiad aquí el nombre, el CIF y la dirección: las facturas ya hechas no cambian.</p>
<form method="post" action="?estado=facturacion"><div class="g2">
  ${campo('Nombre o razón social', 'nombre', e.nombre, ' required')}${campo('NIF / CIF', 'nif', e.nif, ' required')}
  <label class="ancho">Domicilio fiscal<input name="direccion" value="${esc(e.direccion)}" required placeholder="Calle, n.º, CP y ciudad"></label>
  ${campo('Email', 'email', e.email)}${campo('Teléfono', 'telefono', e.telefono)}
  ${campo('IBAN (para cobrar por transferencia)', 'iban', e.iban)}${campo('Marca comercial', 'marca', e.marca)}</div>
  <h3 style="margin:18px 0 8px">Condiciones por defecto de los coches nuevos</h3><div class="g3">
  ${campo('Comisión (%)', 'comision_pct', e.comision_pct, ' inputmode="decimal"')}${campo('Comisión mínima (€)', 'comision_min', e.comision_min || '', ' inputmode="decimal"')}${campo('Exclusividad (meses)', 'exclusividad_meses', e.exclusividad_meses, ' inputmode="numeric"')}
  ${campo('IVA (%)', 'iva_pct', e.iva_pct, ' inputmode="decimal"')}</div>
  <div class="acc-row"><button class="boton" name="accion" value="guardar">Guardar</button></div></form></div>`, CSS);
}

/* ---------------------------------------------------------------------------- Rutas del panel */
const AJUSTE = 'facturacion';
export async function leerAjuste(tA) { try { return leerEmisor((await tA.leer(`clave=eq.${AJUSTE}&limit=1`))[0]?.valor); } catch (e) { return leerEmisor(); } }

export async function rutasExpedientes(req, cfg, deps, html) {
  const estado = req.query.estado, b = req.body || {};
  const tO = deps.operaciones || tablaAnuncios(cfg, deps.fetch, 'operaciones');
  const tF = deps.facturas || tablaAnuncios(cfg, deps.fetch, 'facturas');
  const tA = deps.ajustes || tablaAnuncios(cfg, deps.fetch, 'ajustes');
  const tG = deps.gestiones || tablaAnuncios(cfg, deps.fetch, 'gestiones');
  const emisor = await leerAjuste(tA);
  const errorSql = (e) => (/expediente|ajustes|facturas|column|relation|schema/.test(String(e.message || e)) ? `Error: a la base de datos le falta algo (${String(e.message || e).slice(0, 200)}). Mira Herramientas › Base de datos: dice qué SQL ejecutar.` : `Error: ${e.message || e}`);
  const leerFacturas = async () => { try { return (await tF.leer('select=*&order=fecha.asc&limit=5000')).map((f) => ({ ...f, fecha: String(f.fecha).slice(0, 10), base: n(f.base), iva: n(f.iva), total: n(f.total), datos: f.datos || {} })); } catch (e) { return []; } };

  if (estado === 'facturacion') {
    let aviso = '';
    if (req.method === 'POST') {
      const { emisor: nuevo, error } = leerAjustesForm(b);
      if (error) aviso = `Error: ${error}`;
      else { try { await tA.guardar({ clave: AJUSTE, valor: nuevo, actualizado: new Date().toISOString() }, 'clave'); aviso = 'Guardado.'; } catch (e) { aviso = errorSql(e); } }
    }
    return html(paginaAjustes(req.method === 'POST' && !/^Error/.test(aviso) ? leerAjustesForm(b).emisor : emisor, { aviso }));
  }

  // Ligar un anuncio de la web con la ficha de su propietario (desde Anuncios › En la web)
  if (estado === 'ligar') {
    const h = String(req.query.h || '').replace(/[^a-z0-9-]/g, '').slice(0, 160);
    let ficha = null, ops = [];
    try { const { catalogoTienda } = await import('./actividad.mjs'); ficha = (await catalogoTienda(cfg, deps)).get(h) || null; } catch (e) { ficha = null; }
    try { ops = await tO.leer('select=*&order=id.desc&limit=5000'); } catch (e) { ops = []; }
    if (req.method === 'POST' && Number(b.id) && h) {
      const [o] = ops.filter((x) => Number(x.id) === Number(b.id));
      if (o) {
        await tO.cambiar(Number(o.id), { handle: h, expediente: conHistorial(o.expediente || {}, `Ligado con su anuncio de la web (${ficha?.titulo || h})`), actualizado: new Date().toISOString() });
        return { status: 303, headers: { Location: `?estado=expediente&id=${Number(o.id)}`, 'Cache-Control': 'no-store' }, body: '' };
      }
    }
    const ya = ops.find((x) => x.handle === h);
    const cand = ops.filter((x) => !x.handle && x.modalidad !== 'encargo' && x.estado !== 'retirado').map((x) => ({ ...x, puntos: ficha ? parecido(x.titulo, ficha.titulo, { anioDistinto: 0.25 }) : 0 }))
      .sort((a, b) => b.puntos - a.puntos || Number(Boolean(b.expediente?.contrato?.firma)) - Number(Boolean(a.expediente?.contrato?.firma))).slice(0, 12);
    return html(marco('Ligar con su propietario', 'sidonia', `<p><a href="?estado=sidonia">‹ Coches de Sidonia</a></p>
<div class="card">${ficha ? `<div class="anu">${ficha.foto ? `<img src="${esc(ficha.foto)}" alt="">` : '<span class="anu-f"></span>'}<div><b>${esc(ficha.titulo)}</b><span>Anuncio de la web</span></div><span></span></div>` : `<p>${esc(h)}</p>`}
${ya ? `<p>Ya está ligado con la ficha de <b>${esc(ya.propietario_nombre || ya.titulo)}</b>. <a href="?estado=expediente&id=${Number(ya.id)}">Abrir su ficha ›</a></p>` : `<h3>¿De quién es? Elige su ficha</h3>
${cand.map((x) => `<form method="post" action="?estado=ligar&h=${encodeURIComponent(h)}" class="anu"><span class="anu-f"></span><div><b>${esc(x.titulo)}</b><span>${esc(x.expediente?.propietario?.nombre || x.propietario_nombre || 'Sin propietario')}${x.expediente?.contrato?.firma ? ' · contrato firmado' : x.expediente?.contrato?.enviado ? ' · contrato enviado' : ''}${x.puntos ? ` · se parece un ${Math.round(x.puntos * 100)} %` : ''}</span></div><input type="hidden" name="id" value="${Number(x.id)}"><button class="boton">Es esta, ligar</button></form>`).join('') || '<p class="sub">No hay fichas sin anuncio.</p>'}
<div class="acc-row"><a class="boton" href="?estado=expediente&nuevo=1&h=${encodeURIComponent(h)}">+ Crear su ficha (propietario y contrato)</a></div>`}</div>`, CSS));
  }

  if (estado === 'expedientes' || estado === 'sidonia') {
    let ops = [], aviso = String(req.query.aviso || '').slice(0, 300), catalogo = null, gestiones = 0;
    try { ops = await tO.leer('select=*&order=id.desc&limit=5000'); } catch (e) { aviso = errorSql(e); }
    try { const { catalogoTienda } = await import('./actividad.mjs'); catalogo = await catalogoTienda(cfg, deps); } catch (e) { catalogo = null; }
    if (req.method === 'POST' && b.accion === 'efectivo-todas') {
      let hechas = 0;
      try {
        const todas = await tO.leer('select=*&order=id.desc&limit=5000');
        const conFactura = new Set((await leerFacturas()).filter((f) => f.operacion_id && f.estado !== 'anulada').map((f) => Number(f.operacion_id)));
        for (const o of todas.filter((x) => x.estado === 'vendido' && !conFactura.has(Number(x.id)) && !x.expediente?.cobro)) {
          await tO.cambiar(Number(o.id), { expediente: conHistorial({ ...(o.expediente || {}), cobro: { fecha: String(o.fecha_venta || new Date().toISOString()).slice(0, 10), forma: 'efectivo', sin_factura: true } }, 'Comisión cobrada en efectivo, sin factura'), actualizado: new Date().toISOString() });
          hechas += 1;
        }
        aviso = `Apuntadas ${hechas} ventas como cobradas en efectivo, sin factura. Están en «Efectivo sin factura»: hablad con la gestoría para regularizarlas.`;
      } catch (e) { aviso = errorSql(e); }
    }
    if (req.method === 'POST' && b.accion === 'descartar' && Number(b.gestion)) {
      try { await tG.cambiar(Number(b.gestion), { estado: 'descartada', actualizado: new Date().toISOString() }); aviso = 'Solicitud descartada.'; } catch (e) { aviso = errorSql(e); }
    }
    let solicitudes = [];
    try { solicitudes = (await tG.leer('select=*&order=id.desc&limit=500')).filter((g) => ['nueva', 'contactado'].includes(g.estado) && !/Expediente n\.º \d+/.test(g.nota || '')); } catch (e) { solicitudes = []; }
    gestiones = solicitudes.length;
    // Las fichas que ya tienen su anuncio en Shopify (subido allí a mano) se ligan solas
    if (catalogo?.size) {
      for (const l of ligarSolos(ops, catalogo)) {
        const o = ops.find((x) => Number(x.id) === l.id);
        try { await tO.cambiar(l.id, { handle: l.handle, expediente: conHistorial(o.expediente || {}, `Ligado solo con su anuncio de Shopify (${l.titulo})`), actualizado: new Date().toISOString() }); o.handle = l.handle; } catch (e) { console.error(e); }
      }
    }
    const facturas = await leerFacturas();
    // Las ventas de antes sin factura: su comisión se cobró en efectivo (se apunta sola, una vez; se ve en «Efectivo sin factura»)
    const conFactura = new Set(facturas.filter((f) => f.operacion_id && f.estado !== 'anulada').map((f) => Number(f.operacion_id)));
    for (const o of ops.filter((x) => x.estado === 'vendido' && !conFactura.has(Number(x.id)) && !x.expediente?.cobro && String(x.fecha_venta || '') <= CORTE_EFECTIVO)) {
      const exp = conHistorial({ ...(o.expediente || {}), cobro: { fecha: o.fecha_venta ? String(o.fecha_venta).slice(0, 10) : null, forma: 'efectivo', sin_factura: true, auto: true } }, 'Comisión cobrada en efectivo, sin factura (venta de antes)');
      try { await tO.cambiar(Number(o.id), { expediente: exp }); o.expediente = exp; } catch (e) { console.error(e); break; }
    }
    const facDe = new Map(facturas.filter((f) => f.operacion_id && f.estado !== 'anulada').map((f) => [Number(f.operacion_id), f]));
    const items = ops.filter((o) => o.modalidad !== 'encargo').map((o) => { const prod = o.handle && catalogo ? catalogo.get(o.handle) || (catalogo.size ? null : undefined) : undefined; const f = facDe.get(Number(o.id)) || null; return { o, prod, f, paso: pasoDe(o, f, prod) }; });
    const ligados = new Set(ops.map((o) => o.handle).filter(Boolean));
    for (const p of catalogo?.values() || []) {
      if (p.comunidad || ligados.has(p.handle) || p.status === 'ARCHIVED') continue;
      items.push({ prod: p, sinFicha: true, paso: p.situacion === 'vendido' ? 'hecho' : 'venta' });
    }
    for (const g of solicitudes) items.push({ g, paso: 'solicitud' });
    for (const x of items) x.grupo = grupoDe(x);
    // Los enlaces de antes (Finanzas): venta, factura, cobro y efectivo
    const antes = { venta: ['disponible'], cartera: ['disponible'], factura: ['vendido', 'sinfactura'], cobro: ['vendido', 'sincobrar'], efectivo: ['vendido', 'efectivo'], hecho: ['vendido'] }[req.query.ver];
    const ver = antes ? antes[0] : ['solicitud', 'proximamente', 'disponible', 'vendido', 'todo'].includes(req.query.ver) ? req.query.ver : 'disponible';
    const sub = antes?.[1] || (['sinfactura', 'sincobrar', 'efectivo'].includes(req.query.f) ? req.query.f : '');
    return html(paginaSidonia(cfg, items.filter((x) => x.grupo), { ver, sub, aviso, gestiones, emisor }));
  }

  // estado === 'expediente'
  const id = Number(req.query.id) || 0;
  // Nuevo: a mano o desde una gestión de venta (el formulario de la web)
  if (!id) {
    if (req.method === 'POST' && b.accion === 'desde-gestion' && Number(b.gestion)) {
      try {
        const [g] = await tG.leer(`id=eq.${Number(b.gestion)}&limit=1`);
        if (!g) return html(paginaSidonia(cfg, [], { aviso: 'Error: no encuentro esa gestión.' }));
        const d = g.datos || {};
        const exp = conHistorial({ origen: 'web', gestion_id: Number(g.id), propietario: { nombre: t(d.nombre, 120), email: t(d.email, 160).toLowerCase(), telefono: t(d.telefono, 40), dni: '', direccion: '' },
          coche: { marca: t(d.marca, 40), modelo: t(d.modelo, 80), anio: t(d.anio, 4), km: t(d.km, 20), matricula: '', bastidor: '' },
          condiciones: { comision_pct: emisor.comision_pct, comision_min: emisor.comision_min || null, exclusividad_meses: emisor.exclusividad_meses, precio_salida: num(d.precio), precio_minimo: null } }, 'Expediente abierto desde el formulario de la web');
        const o = await tO.guardar({ titulo: tituloCoche(exp.coche) || 'VEHÍCULO', tipo: 'coche', estado: 'captado', modalidad: 'gestion', propietario_nombre: exp.propietario.nombre, propietario_email: exp.propietario.email || null,
          propietario_telefono: exp.propietario.telefono || null, precio_anunciado: exp.condiciones.precio_salida, origen: 'panel', expediente: exp }, 'id');
        await tG.cambiar(Number(g.id), { estado: g.estado === 'nueva' || g.estado === 'contactado' ? 'en_gestion' : g.estado, nota: `${g.nota ? `${g.nota} · ` : ''}Expediente n.º ${o.id}`, actualizado: new Date().toISOString() }).catch(() => null);
        return { status: 303, headers: { Location: `?estado=expediente&id=${Number(o.id)}`, 'Cache-Control': 'no-store' }, body: '' };
      } catch (e) { return html(paginaSidonia(cfg, [], { aviso: errorSql(e) })); }
    }
    let aviso = '';
    if (req.method === 'POST' && b.accion === 'crear') {
      const { op, error } = leerExpediente(b);
      if (error) aviso = `Error: ${error}`;
      else {
        try {
          let o = await tO.guardar({ ...op, estado: 'captado', origen: 'panel', expediente: conHistorial(op.expediente, `Coche dado de alta (${ORIGENES[op.expediente.origen]})`) }, 'id');
          // A la vez, su borrador en Shopify (con título, descripción y precio), ya ligado: solo falta subir el vídeo
          let nota = '';
          if (!o.handle && (deps.gql || (cfg.shopifyTienda && cfg.shopifyClientId))) {
            try {
              const r = await crearBorrador(deps.gql || shopifyAdmin(cfg, deps.fetch), o);
              const exp = conHistorial({ ...o.expediente, shopify_id: r.id }, `Borrador creado en Shopify (${r.handle})`);
              await tO.cambiar(Number(o.id), { handle: r.handle, expediente: exp });
              try { const { olvidarCatalogo } = await import('./actividad.mjs'); olvidarCatalogo(); } catch (e) { /* nada */ }
              nota = 'Creado: su borrador ya está en Shopify (solo falta el vídeo) y el contrato, listo para enviar.';
            } catch (e) { console.error(e); nota = `Error: el coche está creado, pero no se ha podido crear su borrador en Shopify (${e.message}). Prueba con «Crear borrador en Shopify».`; }
          } else nota = 'Creado. El contrato está listo para enviar.';
          return { status: 303, headers: { Location: `?estado=expediente&id=${Number(o.id)}&aviso=${encodeURIComponent(nota)}`, 'Cache-Control': 'no-store' }, body: '' };
        } catch (e) { aviso = errorSql(e); }
      }
    }
    // Desde un anuncio de la web (Anuncios › En la web › «Ligar con su propietario» › «Crear su ficha»): con su coche
    let base = aviso ? { comercial: b.comercial, handle: b.handle, expediente: { propietario: { nombre: b.p_nombre, dni: b.p_dni, telefono: b.p_telefono, email: b.p_email, direccion: b.p_direccion }, coche: { marca: b.c_marca, modelo: b.c_modelo, anio: b.c_anio, matricula: b.c_matricula, bastidor: b.c_bastidor, km: b.c_km } } } : {};
    let deLaWeb = null;
    if (!aviso && req.query.h) {
      try { const { catalogoTienda } = await import('./actividad.mjs'); deLaWeb = (await catalogoTienda(cfg, deps)).get(String(req.query.h)) || null; } catch (e) { deLaWeb = null; }
      if (deLaWeb) base = { handle: deLaWeb.handle, expediente: { coche: cocheDeTitulo(deLaWeb.titulo) } };
    }
    return html(marco('Nuevo coche', 'sidonia', `<p><a href="?estado=sidonia">‹ Coches de Sidonia</a></p>${aviso ? `<p class="aviso mal">${esc(aviso)}</p>` : ''}
<div class="card"><h2>Nuevo coche: su ficha</h2><p class="sub">${deLaWeb ? `Para el anuncio <b>${esc(deLaWeb.titulo)}</b> de la web: pon los datos de su propietario y se quedan ligados.` : 'Rellena el propietario, el coche (como en Shopify: precio y descripción) y las condiciones. Al crearlo se hace a la vez <b>su borrador en Shopify</b> (solo faltará subir el vídeo y activarlo) y <b>el contrato de intermediación y exclusividad</b>, listo para enviar por WhatsApp o email.'}</p>${formExpediente(base, emisor, { accion: 'crear', boton: deLaWeb ? 'Crear su ficha' : 'Crear el coche: borrador en Shopify y contrato' })}</div>`, CSS));
  }

  let [o] = await tO.leer(`id=eq.${id}&select=*&limit=1`).catch(() => []);
  if (!o) return html(marco('Expediente', 'sidonia', '<p class="aviso mal">No encuentro ese coche.</p><p><a href="?estado=sidonia">‹ Coches de Sidonia</a></p>'));
  o.expediente = o.expediente || {};
  let facturas = await leerFacturas();
  let factura = facturas.filter((f) => Number(f.operacion_id) === id && f.estado !== 'anulada').pop() || null;
  const guardar = async (cambios, texto) => {
    const exp = texto ? conHistorial(cambios.expediente || o.expediente, texto) : (cambios.expediente || o.expediente);
    await tO.cambiar(id, { ...cambios, expediente: exp, actualizado: new Date().toISOString() });
    o = { ...o, ...cambios, expediente: exp };
  };
  const p = o.expediente.propietario || {};
  let aviso = req.method === 'GET' ? String(req.query.aviso || '').slice(0, 400) : '';

  // WhatsApp: se apunta como enviado y se abre WhatsApp con el mensaje y el enlace
  if (req.method === 'GET' && (req.query.wa === 'contrato' || req.query.wa === 'factura')) {
    const tel = p.telefono || o.propietario_telefono;
    if (req.query.wa === 'contrato') {
      if (!o.expediente.contrato?.firma) await guardar({ expediente: { ...o.expediente, contrato: { ...(o.expediente.contrato || {}), enviado: new Date().toISOString(), via: 'WhatsApp', cambiado: false } } }, 'Contrato enviado por WhatsApp').catch(() => null);
      return { status: 302, headers: { Location: enlaceWa(tel, textoWaContrato(cfg, o)) || '?estado=expediente&id=' + id, 'Cache-Control': 'no-store' }, body: '' };
    }
    if (factura) {
      await tF.cambiar(factura.id, { datos: { ...factura.datos, enviada: { fecha: new Date().toISOString(), via: 'WhatsApp' } } }).catch(() => null);
      await guardar({}, `Factura ${factura.numero} enviada por WhatsApp`).catch(() => null);
      return { status: 302, headers: { Location: enlaceWa(tel, textoWaFactura(cfg, o, factura)) || '?estado=expediente&id=' + id, 'Cache-Control': 'no-store' }, body: '' };
    }
  }

  if (req.method === 'POST') {
    try {
      const a = b.accion;
      if (a === 'guardar') {
        const { op, error } = leerExpediente(b, o);
        if (error) aviso = `Error: ${error}`;
        else {
          const antes = { titulo: o.titulo, descripcion: String(o.expediente.coche?.descripcion || ''), precio: n(o.expediente.condiciones?.precio_salida ?? o.precio_anunciado) };
          await guardar(op, 'Datos cambiados'); aviso = 'Guardado.';
          // Y en su anuncio de Shopify: lo que ha cambiado (título, descripción, precio)
          const cambia = { titulo: op.titulo !== antes.titulo, descripcion: String(op.expediente.coche?.descripcion || '') !== antes.descripcion, precio: n(op.expediente.condiciones?.precio_salida) !== antes.precio };
          if (o.handle && (cambia.titulo || cambia.descripcion || cambia.precio) && (deps.gql || (cfg.shopifyTienda && cfg.shopifyClientId))) {
            try {
              if (await llevarAShopify(deps.gql || shopifyAdmin(cfg, deps.fetch), o, cambia)) { aviso = 'Guardado, también en Shopify.'; try { const { olvidarCatalogo } = await import('./actividad.mjs'); olvidarCatalogo(); } catch (e) { /* nada */ } }
            } catch (e) { console.error(e); aviso = `Guardado aquí, pero no en Shopify (${e.message}).`; }
          }
        }
      } else if (a === 'contrato-email') {
        if (!p.email) aviso = 'Error: el propietario no tiene email.';
        else {
          const cuerpo = P(`Hola ${esc(primerNombre(p.nombre))},`) + P(`Aquí tienes el <b>contrato de intermediación y exclusividad</b> para la venta de tu <b>${esc(o.titulo)}</b> con Sidonia. Léelo, completa tus datos y fírmalo desde el móvil: es un minuto.`) + P('Cualquier duda, responde a este email o escríbenos por WhatsApp.');
          const ok = await enviarCorreo(cfg, p.email, `Tu contrato con Sidonia: ${o.titulo}`, plantilla(cfg, null, { titulo: 'Tu contrato con Sidonia', previa: `Firma el contrato para vender tu ${o.titulo}.`, cuerpo, boton: 'Leer y firmar el contrato', enlace: urlIntermediacion(cfg, id), sinDudas: true }), deps.fetch).catch((e) => { console.error(e); return false; });
          if (!ok) aviso = 'Error: no se ha podido enviar el email (revisa RESEND_API_KEY en Vercel).';
          else { await guardar({ expediente: { ...o.expediente, contrato: { ...(o.expediente.contrato || {}), enviado: new Date().toISOString(), via: 'email', cambiado: false } } }, `Contrato enviado por email a ${p.email}`); aviso = `Enviado a ${p.email}.`; }
        }
      } else if (a === 'contrato-firmado-papel') {
        await guardar({ estado: o.estado === 'captado' ? 'en_venta' : o.estado, expediente: { ...o.expediente, contrato: { ...(o.expediente.contrato || {}), enviado: new Date().toISOString(), via: 'en papel', firma: { nombre: p.nombre, dni: p.dni, fecha: new Date().toISOString(), ip: '', papel: true } } } }, 'Contrato firmado en papel');
        aviso = 'Apuntado: firmado en papel. Guarda el original.';
      } else if (a === 'crear-anuncio') {
        if (o.handle) aviso = 'Error: ya tiene su anuncio.';
        else {
          const r = await crearBorrador(deps.gql || shopifyAdmin(cfg, deps.fetch), o);
          await guardar({ handle: r.handle, expediente: { ...o.expediente, shopify_id: r.id } }, `Anuncio creado en Shopify como borrador (${r.handle})`);
          try { const { olvidarCatalogo } = await import('./actividad.mjs'); olvidarCatalogo(); } catch (e) { /* nada */ }
          aviso = `Creado en Shopify como borrador: ${o.titulo}. Ábrelo allí, sube el vídeo y las fotos y ponlo en Activo.`;
        }
      } else if (a === 'video') {
        await guardar({ expediente: { ...o.expediente, video: new Date().toISOString() } }, 'Vídeo hecho'); aviso = '¡Vídeo hecho! Ahora, a subirlo a Shopify y ligarlo aquí.';
      } else if (a === 'anuncio') {
        const h = String(b.handle || '').replace(/^.*\/products\//, '').replace(/[?#].*$/, '').trim().toLowerCase();
        await guardar({ handle: h || null }, h ? `Enlazado con su anuncio (${h})` : 'Quitado el anuncio'); aviso = 'Guardado.';
      } else if (a === 'vendido') {
        const precio = num(b.precio_venta), fecha = String(b.fecha_venta || '');
        if (!(precio > 0)) aviso = 'Error: pon el precio final de venta.';
        else if (!DIA.test(fecha)) aviso = 'Error: pon la fecha de venta.';
        else {
          const k = o.expediente.condiciones || {};
          const comision = r2(Math.max(precio * n(k.comision_pct ?? emisor.comision_pct) / 100, n(k.comision_min)));
          const pc = n(k.comercial_pct);
          await guardar({ estado: 'vendido', precio_venta: precio, fecha_venta: fecha, comprador_nombre: t(b.comprador_nombre, 120) || null, comprador_telefono: t(b.comprador_telefono, 40) || null, comprador_email: t(b.comprador_email, 160) || null,
            ...(factura ? {} : { comision, ...(pc ? { comision_comercial: r2(comision * pc / 100) } : {}) }) }, `Vendido por ${eur0(precio)}`);
          aviso = factura ? 'Guardado.' : `¡Vendido! Ahora, la factura (comisión prevista: ${eur(comision)} + IVA).`;
        }
      } else if (a === 'factura') {
        if (!emisorCompleto(emisor)) aviso = 'Error: faltan los datos de Sidonia para la factura (Finanzas › Datos de facturación).';
        else if (factura) aviso = 'Error: ya tiene factura. Anúlala antes para hacer otra.';
        else {
          const { factura: nueva, error } = leerFacturaForm(b, o);
          if (error) aviso = `Error: ${error}`;
          else if (facturas.some((f) => f.numero === nueva.numero)) aviso = `Error: ya hay una factura ${nueva.numero}.`;
          else {
            nueva.datos = { ...nueva.datos, emisor, destinatario: { ...nueva.datos.destinatario, email: p.email || '' } };
            const g = await tF.guardar(nueva, 'id');
            // La comisión de la venta, la de la factura (por si se ha bajado)
            const pc = n(o.expediente.condiciones?.comercial_pct);
            await guardar({ comision: nueva.base, ...(pc ? { comision_comercial: r2(nueva.base * pc / 100) } : {}) }, `Factura ${nueva.numero} de ${eur(nueva.total)} a nombre de ${nueva.cliente}`);
            facturas = await leerFacturas(); factura = facturas.find((f) => Number(f.id) === Number(g.id)) || { ...nueva, id: g.id };
            aviso = `Factura ${nueva.numero} creada. Envíasela por email o WhatsApp.`;
          }
        }
      } else if (a === 'factura-email' && factura) {
        const para = factura.datos?.destinatario?.email || p.email;
        const cuerpo = P(`Hola ${esc(primerNombre(factura.datos?.destinatario?.nombre || p.nombre))},`) + P(`¡Enhorabuena por la venta de tu <b>${esc(o.titulo)}</b>! Te enviamos nuestra factura <b>${esc(factura.numero)}</b> por <b>${eur(factura.total)}</b>.`) + P(factura.forma_pago === 'transferencia' && emisor.iban ? `Puedes pagarla por transferencia a la cuenta ${esc(emisor.iban)}.` : `Forma de pago: ${esc(FORMAS_PAGO[factura.forma_pago] || '')}.`) + P('Gracias por confiar en Sidonia.');
        const ok = await enviarCorreo(cfg, para, `Factura ${factura.numero} · Sidonia`, plantilla(cfg, null, { titulo: `Factura ${factura.numero}`, previa: `${eur(factura.total)} · venta de tu ${o.titulo}`, cuerpo, boton: 'Ver la factura (PDF)', enlace: urlFactura(cfg, factura.id), sinDudas: true }), deps.fetch).catch((e) => { console.error(e); return false; });
        if (!ok) aviso = 'Error: no se ha podido enviar el email.';
        else { await tF.cambiar(factura.id, { datos: { ...factura.datos, enviada: { fecha: new Date().toISOString(), via: `email (${para})` } } }); factura.datos = { ...factura.datos, enviada: { fecha: new Date().toISOString(), via: `email (${para})` } }; await guardar({}, `Factura ${factura.numero} enviada por email a ${para}`); aviso = `Enviada a ${para}.`; }
      } else if (a === 'factura-anular' && factura) {
        await tF.cambiar(factura.id, { estado: 'anulada' }); await guardar({}, `Factura ${factura.numero} anulada`);
        factura = null; facturas = await leerFacturas(); aviso = 'Factura anulada. Puedes hacer otra.';
      } else if (a === 'cobrada' && factura) {
        const forma = FORMAS_PAGO[b.forma_pago] ? b.forma_pago : factura.forma_pago;
        if (forma === 'efectivo' && n(factura.total) >= LIMITE_EFECTIVO) aviso = `Error: una factura de ${eur(factura.total)} no se puede cobrar en efectivo (límite de ${eur0(LIMITE_EFECTIVO)}, Ley 7/2012).`;
        else {
          const fecha = DIA.test(String(b.cobrada || '')) ? String(b.cobrada) : hoyISO();
          await tF.cambiar(factura.id, { cobrada: fecha, forma_pago: forma }); factura = { ...factura, cobrada: fecha, forma_pago: forma };
          await guardar({}, `Cobrada la factura ${factura.numero} (${FORMAS_PAGO[forma]})`); aviso = '¡Cobrada!';
        }
      } else if (a === 'efectivo') {
        if (factura) aviso = 'Error: ya tiene factura: márcala como cobrada.';
        else if (o.estado !== 'vendido') aviso = 'Error: primero, márcalo como vendido.';
        else { await guardar({ expediente: { ...o.expediente, cobro: { fecha: String(o.fecha_venta || hoyISO()).slice(0, 10), forma: 'efectivo', sin_factura: true } } }, 'Comisión cobrada en efectivo, sin factura'); aviso = 'Apuntado: comisión cobrada en efectivo, sin factura.'; }
      } else if (a === 'efectivo-deshacer') {
        const { cobro, ...resto } = o.expediente; await guardar({ expediente: resto }, 'Deshecho «cobrada en efectivo»'); aviso = 'Deshecho.';
      } else if (a === 'cobro-deshacer' && factura) {
        await tF.cambiar(factura.id, { cobrada: null }); factura = { ...factura, cobrada: null }; await guardar({}, `Deshecho el cobro de la factura ${factura.numero}`); aviso = 'Deshecho.';
      }
    } catch (e) { aviso = /Shopify|gql|GraphQL/i.test(String(e.message)) ? `Error: ${e.message}` : errorSql(e); }
    // Desde la lista de coches: se vuelve a la lista con el aviso
    if (b.volver === 'sidonia') return { status: 303, headers: { Location: `?estado=sidonia&aviso=${encodeURIComponent(aviso)}`, 'Cache-Control': 'no-store' }, body: '' };
  }
  // Lo cambiado en Shopify (título, descripción, precio) pasa a la ficha
  if (req.method === 'GET' && o.handle && (deps.gql || (cfg.shopifyTienda && cfg.shopifyClientId))) {
    try {
      const r = cambiosDeShopify(o, await productoDe(deps.gql || shopifyAdmin(cfg, deps.fetch), o.handle));
      if (r) await guardar(r.cambios, r.qué.length ? `Cambiado en Shopify: ${r.qué.join(', ')}` : '');
    } catch (e) { console.error(e); }
  }
  let anuncios = [];
  try { const { catalogoTienda } = await import('./actividad.mjs'); anuncios = [...(await catalogoTienda(cfg, deps)).values()]; } catch (e) { anuncios = []; }
  let ligados = new Set();
  try { ligados = new Set((await tO.leer('select=id,handle&limit=5000')).filter((x) => x.handle && Number(x.id) !== id).map((x) => x.handle)); } catch (e) { ligados = new Set(); }
  return html(paginaExpediente(cfg, o, { factura, facturas, emisor, aviso, anuncios, ligados }));
}

/* ---------------------------------------------------------------------------- Páginas públicas (enlace firmado) */
const pagina = (titulo, cuerpo) => ({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }, body: cuerpo });
export async function rutasDocumentos({ ruta, method = 'GET', query = {}, body = {}, ip = '', ua = '' }, cfg, deps) {
  const { paginaDocumento } = await import('./contratos.mjs');
  const tO = deps.operaciones || tablaAnuncios(cfg, deps.fetch, 'operaciones');
  const tF = deps.facturas || tablaAnuncios(cfg, deps.fetch, 'facturas');
  const tA = deps.ajustes || tablaAnuncios(cfg, deps.fetch, 'ajustes');
  const mal = (texto) => pagina('Enlace no válido', paginaDocumento('Enlace no válido', `<h1>Enlace no válido</h1><p>${esc(texto)}</p>`));
  if (ruta === 'factura') {
    if (!firmaOk(cfg, 'factura', query.n, query.f)) return mal('Este enlace no es correcto. Pídenos la factura otra vez.');
    const [f] = await tF.leer(`id=eq.${Number(query.n)}&limit=1`).catch(() => []);
    if (!f) return mal('No encontramos esta factura.');
    return pagina(`Factura ${f.numero}`, facturaHTML(cfg, { ...f, datos: f.datos || {} }, await leerAjuste(tA)));
  }
  // ruta === 'intermediacion'
  if (!firmaOk(cfg, 'intermediacion', query.o, query.f)) return mal('Este enlace no es correcto. Pídenos el contrato otra vez.');
  const [o] = await tO.leer(`id=eq.${Number(query.o)}&select=*&limit=1`).catch(() => []);
  if (!o) return mal('No encontramos este contrato.');
  o.expediente = o.expediente || {};
  const emisor = await leerAjuste(tA);
  const x = o.expediente, p = x.propietario || {};
  let error = '';
  if (method === 'POST' && !x.contrato?.firma) {
    const nombre = t(body.nombre, 120), dni = normDoc(body.dni), direccion = t(body.direccion, 250) || p.direccion || '';
    if (nombre.length < 4) error = 'Escribe tu nombre y apellidos.';
    else if (!documentoValido(dni)) error = 'Revisa tu DNI, NIE o CIF (con su letra).';
    else if (direccion.length < 8) error = 'Escribe tu domicilio completo.';
    else if (!body.acepto) error = 'Marca la casilla para aceptar el contrato.';
    else {
      const fecha = new Date().toISOString();
      const firmado = { nombre, dni, direccion, fecha, ip: String(ip || '').slice(0, 60), ua: String(ua || '').slice(0, 200) };
      const expediente = { ...x, propietario: { ...p, nombre, dni, direccion } };
      const html = contratoIntermediacion({ ...o, expediente }, emisor, { firmado });
      const contrato = { ...(x.contrato || {}), enviado: x.contrato?.enviado || fecha, firma: firmado, version: VERSION_INTERMEDIACION, html, hash: huella(html) };
      const hist = [...(x.historial || []), { fecha, texto: `Contrato firmado por ${nombre} (${dni})` }];
      await tO.cambiar(Number(o.id), { estado: o.estado === 'captado' ? 'en_venta' : o.estado, propietario_nombre: nombre, expediente: { ...expediente, contrato, historial: hist }, actualizado: fecha });
      o.expediente = { ...expediente, contrato, historial: hist };
      for (const e of cfg.avisosEquipo || []) await enviarCorreo(cfg, e, `[Sidonia] Contrato firmado: ${o.titulo}`, plantilla(cfg, null, { titulo: 'Contrato firmado', previa: `${nombre} ha firmado el contrato de intermediación.`, cuerpo: P(`<b>${esc(nombre)}</b> (${esc(dni)}) ha firmado el contrato de intermediación y exclusividad del <b>${esc(o.titulo)}</b>.`), boton: 'Abrir el expediente', enlace: `${cfg.servidor}/admin?estado=expediente&id=${Number(o.id)}`, sinDudas: true }), deps.fetch).catch(() => null);
      if (p.email) await enviarCorreo(cfg, p.email, `Tu contrato firmado: ${o.titulo}`, plantilla(cfg, null, { titulo: '¡Contrato firmado!', previa: 'Tu copia del contrato.', cuerpo: P(`Gracias, ${esc(primerNombre(nombre))}. Ya está firmado el contrato para vender tu <b>${esc(o.titulo)}</b>. Aquí tienes tu copia; guárdala en PDF desde el enlace.`), boton: 'Ver mi contrato', enlace: urlIntermediacion(cfg, o.id), sinDudas: true }), deps.fetch).catch(() => null);
    }
  }
  const ct = o.expediente.contrato || {};
  if (ct.firma) {
    const cuerpo = ct.html || contratoIntermediacion(o, emisor, { firmado: ct.firma });
    return pagina('Contrato firmado', paginaDocumento('Contrato de intermediación', `${method === 'POST' ? '<div class="nota"><b>¡Firmado!</b> Te hemos enviado una copia. Puedes guardarla en PDF con el botón de arriba.</div>' : ''}${cuerpo}`, { pie: ct.hash ? `Firmado electrónicamente. Modelo ${esc(ct.version || VERSION_INTERMEDIACION)} · Huella SHA-256 del texto firmado: ${esc(ct.hash)}` : 'Firmado en papel.' }));
  }
  const form = `<form method="post" class="firmar"><h2>Firma el contrato</h2>
  <label>Nombre y apellidos (o empresa)<input name="nombre" required value="${esc(body.nombre || p.nombre || '')}" autocomplete="name"></label>
  <label>DNI / NIE / CIF<input name="dni" required value="${esc(body.dni || p.dni || '')}" autocomplete="off"></label>
  <label>Domicilio<input name="direccion" required value="${esc(body.direccion || p.direccion || '')}" placeholder="Calle, n.º, CP y ciudad" autocomplete="street-address"></label>
  <label class="chk"><input type="checkbox" name="acepto" value="1" required> He leído el contrato y lo acepto. Firmo electrónicamente.</label>
  ${error ? `<p class="err">${esc(error)}</p>` : ''}<button>Firmar el contrato</button></form>
  <style>.firmar{margin-top:28px;padding:20px;border-radius:16px;background:#f6f4ef}.firmar label{display:flex;flex-direction:column;gap:4px;margin:0 0 12px;font-weight:600;font-size:14px}.firmar input:not([type=checkbox]){font:inherit;padding:11px 12px;border:1px solid #ccc;border-radius:10px}.firmar .chk{flex-direction:row;align-items:flex-start;gap:10px;font-weight:500}.firmar .chk input{width:18px;height:18px;margin-top:2px}.firmar button{width:100%;border:0;border-radius:999px;background:#1a1a1a;color:#fff;padding:14px;font:700 16px/1 inherit;cursor:pointer}.err{color:#b00020;font-weight:700}</style>`;
  return pagina('Contrato de intermediación', paginaDocumento('Contrato de intermediación', `<div class="nota">Lee el contrato y fírmalo abajo. Comprueba tus datos y completa lo que falte.</div>${contratoIntermediacion(o, emisor)}${form}`));
}
