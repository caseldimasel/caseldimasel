/* SIDONIA · Anuncios de dueños: coches, motos, barcos y casas que publica su dueño (particular o profesional), gratis
 * y revisados por Sidonia. Salen en la web con el resto («Dueño particular» / «Dueño profesional»).
 *
 * Desde la tienda (proxy de la app, con la sesión del cliente; ver motor.mjs):
 *   GET  api/anuncio          → { ok, anuncio }   su anuncio activo (o el último), o null
 *   GET  api/anuncios         → { ok, anuncios }  todos los suyos (su perfil)
 *   POST api/anuncio/fotos    { tipos: ['image/jpeg', …] } → { ok, subidas: [{ ruta, url }] }   permisos para subir fotos
 *   POST api/anuncio          { tipo, titulo, precio, … }  → { ok, anuncio } | { ok: false, error, campo }
 *   GET  api/anuncio/editar   → { ok, anuncio }   su anuncio activo completo (con fotos_url) para editarlo
 *   POST api/anuncio/editar   { …lo mismo que al publicar } → { ok, revision }   por revisar: se cambia ya; aprobado o
 *                             publicado: los cambios quedan «por revisar» (panel › Cambios) hasta que el equipo los aprueba
 *   POST api/anuncio/eliminar → { ok }   lo retira (y archiva la ficha en Shopify): puede publicar otro
 *   GET  api/perfil           → { ok, perfil }   su perfil (nombre, tipo, descripción, foto)
 *   POST api/perfil           { nombre, tipo, descripcion, foto } → { ok, perfil }
 *   GET  api/perfil/publico?slug=…  → { ok, perfil }   sin sesión: lo que se enseña en su perfil público y sus anuncios
 *   POST api/anuncio/situacion { situacion: 'en_venta' | 'reservado' | 'vendido' } → { ok }   la etiqueta de la ficha;
 *                             vendido deja de contar como su anuncio gratis (puede publicar otro)
 * Panel del equipo (directo en Vercel, con contraseña): /admin → lista, editar, aprobar y publicar en Shopify, rechazar, retirar.
 * Al dueño le llegan emails (si hay Resend): recibido, publicado y no publicado con el motivo (lib/correos.mjs).
 *
 * Cada persona puede tener varios anuncios activos (hasta 25): el primero, gratis un mes; los demás se pagan por meses
 * (lib/comunidad.mjs). Editar, eliminar y reservado/vendido van al anuncio que se diga con «id» (si no, al último activo).
 */
import { CABECERA, ESTILO_PANEL, FAVICON, recursoPanel } from './marca.mjs';
import { createHash } from 'node:crypto';
import { rellenarPropietarios } from './propietarios.mjs';
import { rellenarUbicaciones } from './ubicaciones.mjs';
import { avisarCliente, avisarTodos, avisoCambios, avisoPublicado, avisoRechazado } from './avisos.mjs';
import { navPanel, paginaEstadisticas, ponerContadores } from './estadisticas.mjs';
import { rutasOperaciones } from './operaciones.mjs';
import { rutasFichas } from './fichas.mjs';
import { rutasCorreos } from './plantillas.mjs';
import { DETALLES, rutaDetalle } from './detalle.mjs';
import { avisoMejoras, cajaMejoras, correoMejoras, CSS_MEJORAS, leerMejoras, listaMejoras, pendientes } from './mejoras.mjs';
import { altaComunidad, cancelarRenovacion, enlacePago, leerTarifa, precioMes, rutasComunidad } from './comunidad.mjs';
import { cookieFuera, cookieSesion, intentarEntrar, paginaEntrar, sesionValida } from './acceso.mjs';
import { csvClientes, paginaAnuncio, paginaCliente, paginaClientesCrm } from './crm.mjs';
import { correoCambiosAprobados, correoCambiosRechazados, correoPublicado, correoRechazado, correoRecibido, enviarCorreo } from './correos.mjs';

export const TIPOS = ['coche', 'moto', 'barco', 'casa'];
export const VENDEDOR_TIPOS = ['particular', 'profesional'];
export const FOTOS_MIN = Number(process.env.CIRCULO_FOTOS_MIN || 8);
export const FOTOS_MAX = 30;
const ACTIVOS = ['pendiente', 'aprobado', 'publicado'];
export const MAX_ACTIVOS = 25;   // anuncios activos a la vez por persona (el primero gratis; los demás de pago)
const SITUACIONES = ['en_venta', 'reservado', 'vendido'];
// Lo que el dueño puede cambiar de su anuncio (el slug de su perfil y su email no)
export const CAMPOS_EDITABLES = ['tipo', 'titulo', 'precio', 'ubicacion', 'resumen', 'historia', 'mecanica', 'ficha', 'fotos', 'vendedor_nombre', 'vendedor_tipo', 'telefono', 'acepta_telefono'];
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
  const vendedor_tipo = String(b.vendedor_tipo || '');
  if (!VENDEDOR_TIPOS.includes(vendedor_tipo)) return fallo('vendedor_tipo');
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
      vendedor_nombre, vendedor_slug: slugVendedor(vendedor_nombre, cliente), vendedor_tipo, telefono: tel,
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
      body: '{}',
      signal: AbortSignal.timeout(8000)
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
  // Perfil público (sin sesión): foto, nombre, tipo y descripción de un vendedor, por el slug de sus anuncios
  if (ruta === 'api/perfil/publico' && method === 'GET') {
    const slug = String(body.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 80);
    if (!slug) return json(400, { ok: false, error: 'datos' });
    const [p] = await (deps.perfiles || tablaAnuncios(cfg, deps.fetch, 'perfiles')).leer(`slug=eq.${slug}&limit=1`).catch(() => []);
    return { ...json(200, { ok: true, perfil: perfilPublico(cfg, p) || null }), headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' } };
  }
  if (!cliente) return json(200, { ok: false, error: 'login' });
  const { db } = deps;
  const tablaA = () => deps.tabla || tablaAnuncios(cfg, deps.fetch);
  // Uno de sus anuncios activos, por su id
  const elegido = async (id) => {
    if (!Number(id)) return null;
    const [a] = await tablaA().leer(`id=eq.${Number(id)}&cliente=eq.${encodeURIComponent(cliente)}&estado=in.(${ACTIVOS.join(',')})&limit=1`);
    return a || null;
  };
  // Cuántos tiene activos y lo que costaría uno más (para avisarle antes de enviar otro)
  const cuenta = async () => {
    try {
      const activos = (await tablaA().leer(`cliente=eq.${encodeURIComponent(cliente)}&estado=in.(${ACTIVOS.join(',')})&select=id`)).length;
      const tarifa = await leerTarifa(deps.ajustes || tablaAnuncios(cfg, deps.fetch, 'ajustes'));
      // Sin cobrar a la comunidad: sin precio (la web no enseña nada de pago)
      return { activos, precio_siguiente: tarifa.cobrar ? precioMes(tarifa, activos + 1) : null, cobrar: tarifa.cobrar };
    } catch (e) { return { activos: null, precio_siguiente: null, cobrar: false }; }
  };
  if (ruta === 'api/anuncio' && method === 'GET') {
    if (Number(body.id)) {
      const a = await elegido(body.id);
      const c = await cuenta();
      return json(200, { ok: true, ...c, anuncio: a && { id: a.id, estado: a.estado, tipo: a.tipo, titulo: a.titulo, nota: a.nota, producto: a.producto, creado: a.creado, reservado: Boolean(a.reservado), pago_url: a.estado === 'publicado' && c.cobrar ? enlacePago(cfg, a.id) : '', mejoras: pendientes(a.mejoras) ? listaMejoras(a.mejoras) : null } });
    }
    const mio = await db('sidonia_anuncio_mio', { p_cliente: cliente });
    // Si está publicado: si lo tiene marcado como reservado (para sus botones)
    if (mio && mio.estado === 'publicado') {
      try { mio.reservado = Boolean((await (deps.tabla || tablaAnuncios(cfg, deps.fetch)).leer(`id=eq.${Number(mio.id)}&select=reservado`))[0]?.reservado); } catch (e) { /* sin la columna aún */ }
    }
    const c = await cuenta();
    if (mio && mio.estado === 'publicado' && c.cobrar) mio.pago_url = enlacePago(cfg, mio.id);
    // Mejoras que le hemos pedido y aún no ha hecho
    if (mio && ['pendiente', 'aprobado'].includes(mio.estado)) {
      try { const [x] = await tablaA().leer(`id=eq.${Number(mio.id)}&select=mejoras`); if (pendientes(x?.mejoras)) mio.mejoras = listaMejoras(x.mejoras); } catch (e) { /* sin la columna aún */ }
    }
    return json(200, { ok: true, anuncio: mio, ...c });
  }
  if (ruta === 'api/anuncios' && method === 'GET') {
    const lista = await db('sidonia_anuncios_mios', { p_cliente: cliente });
    // Cuáles están marcados como reservados (sus botones en «Mi perfil»)
    const reservados = new Set();
    try { (await tablaA().leer(`cliente=eq.${encodeURIComponent(cliente)}&reservado=eq.true&select=id`)).forEach((x) => reservados.add(Number(x.id))); } catch (e) { /* sin la columna aún */ }
    const conMejoras = new Set();
    try { (await tablaA().leer(`cliente=eq.${encodeURIComponent(cliente)}&mejoras=not.is.null&select=id,mejoras`)).filter((x) => pendientes(x.mejoras)).forEach((x) => conMejoras.add(Number(x.id))); } catch (e) { /* sin la columna aún */ }
    // Con el enlace para pagar (o gestionar la renovación) de cada anuncio activo
    const { cobrar } = await cuenta();
    return json(200, { ok: true, anuncios: (lista || []).map((a) => ({ ...a, portada: a.portada ? urlFoto(cfg, a.portada) : '', reservado: reservados.has(Number(a.id)), mejoras: conMejoras.has(Number(a.id)), pago_url: cobrar && ACTIVOS.includes(a.estado) ? enlacePago(cfg, a.id) : '' })) });
  }
  if (ruta === 'api/anuncio/fotos' && method === 'POST') {
    // Para uno nuevo, mientras no llegue al máximo de anuncios activos
    if (!body.editar) {
      const { activos } = await cuenta();
      if (activos >= MAX_ACTIVOS) return json(200, { ok: false, error: 'limite' });
    }
    return json(200, await (deps.subidas || permisosSubida)(cfg, cliente, body.tipos));
  }
  if (ruta === 'api/anuncio' && method === 'POST') {
    const v = validar(body, cliente);
    if (!v.ok) return json(400, v);
    const r = await db('sidonia_anuncio_nuevo', { p_cliente: cliente, p: v.datos });
    if (r && r.ok) {
      // ¿Es de pago? Si ya ha tenido un anuncio (pagos) o tiene otro activo. El enlace de pago le llega al publicarlo.
      try {
        const { activos, cobrar } = await cuenta();
        if (!cobrar) throw new Error('gratis');
        const previos = await (deps.pagos || tablaAnuncios(cfg, deps.fetch, 'pagos')).leer(`cliente=eq.${encodeURIComponent(cliente)}&select=id&limit=1`);
        r.de_pago = previos.length > 0 || activos > 1;
        if (r.de_pago) r.precio = precioMes(await leerTarifa(deps.ajustes || tablaAnuncios(cfg, deps.fetch, 'ajustes')), activos);
      } catch (e) { /* sin sql/comunidad.sql: como antes */ }
      await avisarEquipo(cfg, `Nuevo anuncio gratis: ${v.datos.titulo}`, emailAnuncio(cfg, v.datos), deps.fetch).catch((e) => console.error(e));
      const c = correoRecibido(cfg, v.datos);
      await enviarCorreo(cfg, v.datos.email, c.asunto, c.html, deps.fetch).catch((e) => console.error(e));
    }
    return json(200, r);
  }
  // Editar su anuncio
  if (ruta === 'api/anuncio/editar') {
    const tabla = tablaA();
    const [a] = Number(body.id) ? [await elegido(body.id)] : await tabla.leer(`cliente=eq.${encodeURIComponent(cliente)}&estado=in.(${ACTIVOS.join(',')})&order=creado.desc&limit=1`);
    if (!a) return json(200, { ok: false, error: 'sin-anuncio' });
    if (method === 'GET') {
      const actual = { ...a, ...(a.revision || {}) };
      return json(200, { ok: true, anuncio: { ...actual, id: a.id, estado: a.estado, producto: a.producto, revision: Boolean(a.revision), fotos_url: (actual.fotos || []).map((f) => urlFoto(cfg, f)) } });
    }
    const v = validar(body, cliente);
    if (!v.ok) return json(400, v);
    const cambios = Object.fromEntries(CAMPOS_EDITABLES.map((k) => [k, v.datos[k]]));
    // Por revisar: aún no se ve en la tienda, se cambia directamente. Aprobado o publicado: el equipo revisa los cambios.
    const revision = a.estado !== 'pendiente';
    // ¿Le habíamos pedido mejoras? Queda marcado como hecho (y el equipo lo sabe por el email)
    const mejorado = pendientes(a.mejoras) ? { mejoras: { ...a.mejoras, editado: new Date().toISOString() } } : {};
    await tabla.cambiar(a.id, revision ? { revision: cambios, revision_fecha: new Date().toISOString(), ...mejorado } : { ...cambios, revision: null, actualizado: new Date().toISOString(), ...mejorado });
    await avisarEquipo(cfg, mejorado.mejoras ? `Ha mejorado su anuncio: ${cambios.titulo}` : revision ? `Cambios por revisar: ${cambios.titulo}` : `Anuncio editado: ${cambios.titulo}`,
      `<p>${esc(a.vendedor_nombre)} ha editado su anuncio #${a.id}${revision ? '. Revisa los cambios en el panel › Cambios.' : ' (aún por revisar).'}</p>`, deps.fetch).catch((e) => console.error(e));
    return json(200, { ok: true, revision });
  }
  // Eliminar su anuncio: deja de verse y puede publicar otro
  if (ruta === 'api/anuncio/eliminar' && method === 'POST') {
    const mio = Number(body.id) ? await elegido(body.id) : await db('sidonia_anuncio_mio', { p_cliente: cliente });
    if (!mio || !ACTIVOS.includes(mio.estado)) return json(200, { ok: false, error: 'sin-anuncio' });
    await db('sidonia_anuncio_estado', { p_id: mio.id, p_estado: 'retirado', p_nota: 'Eliminado por el dueño', p_producto: null });
    await (deps.tabla || tablaAnuncios(cfg, deps.fetch)).cambiar(mio.id, { revision: null }).catch((e) => console.error(e));
    await cancelarRenovacion(cfg, deps, mio.id);
    let archivado = false;
    if (mio.producto && cfg.shopifyTienda && cfg.shopifyClientId) {
      try { archivado = await archivarEnShopify(mio.producto, deps.gql || shopifyAdmin(cfg, deps.fetch)); } catch (e) { console.error(e); }
    }
    await avisarEquipo(cfg, `Anuncio eliminado por su dueño: ${mio.titulo}`,
      `<p>El anuncio #${mio.id} «${esc(mio.titulo)}» lo ha eliminado su dueño.${mio.producto ? (archivado ? ' La ficha de Shopify se ha archivado.' : ' Archiva la ficha en Shopify › Productos.') : ''}</p>`, deps.fetch).catch((e) => console.error(e));
    return json(200, { ok: true, archivado });
  }
  // Su perfil: nombre (persona o negocio), particular o profesional, descripción breve y foto o logo
  if (ruta === 'api/perfil') {
    const perfiles = deps.perfiles || tablaAnuncios(cfg, deps.fetch, 'perfiles');
    const [actual] = await perfiles.leer(`cliente=eq.${encodeURIComponent(cliente)}&limit=1`);
    if (method === 'GET') return json(200, { ok: true, perfil: actual ? { ...perfilPublico(cfg, actual), ruta_foto: actual.foto } : null });
    const nombre = texto(body.nombre, 60).replace(/[<>]/g, '');
    if (nombre.length < 2) return json(400, { ok: false, error: 'datos', campo: 'nombre' });
    const foto = String(body.foto || '');
    const propia = new RegExp(`^${String(cliente).replace(/\W/g, '')}/[a-z0-9-]{8,64}\\.(jpg|png|webp)$`);
    if (foto && !propia.test(foto)) return json(400, { ok: false, error: 'datos', campo: 'foto' });
    // El slug: el de sus anuncios (para que su perfil público sea el mismo), o uno nuevo
    let slug = actual?.slug;
    if (!slug) {
      const [ultimo] = await (deps.tabla || tablaAnuncios(cfg, deps.fetch)).leer(`cliente=eq.${encodeURIComponent(cliente)}&select=vendedor_slug&order=creado.desc&limit=1`).catch(() => []);
      slug = ultimo?.vendedor_slug || slugVendedor(nombre, cliente);
    }
    const p = await perfiles.guardar({
      cliente, slug, nombre, tipo: body.tipo === 'profesional' ? 'profesional' : 'particular',
      descripcion: texto(body.descripcion, 600), foto, actualizado: new Date().toISOString()
    }, 'cliente');
    // Sus anuncios publicados llevan el nombre y el tipo nuevos (tarjetas, ficha y su perfil público)
    if (cfg.shopifyTienda && cfg.shopifyClientId) {
      try { await nombreEnSusAnuncios(cfg, cliente, p, deps); } catch (e) { console.error(e); }
    }
    return json(200, { ok: true, perfil: perfilPublico(cfg, p) });
  }
  // Reservado / vendido / otra vez en venta (solo un anuncio publicado)
  if (ruta === 'api/anuncio/situacion' && method === 'POST') {
    const situacion = String(body.situacion || '');
    if (!SITUACIONES.includes(situacion)) return json(400, { ok: false, error: 'datos' });
    const mio = Number(body.id) ? await elegido(body.id) : await db('sidonia_anuncio_mio', { p_cliente: cliente });
    if (!mio || mio.estado !== 'publicado' || !mio.producto) return json(200, { ok: false, error: 'sin-anuncio' });
    await marcarSituacion(cfg, mio, situacion, deps);
    if (situacion === 'vendido') await cancelarRenovacion(cfg, deps, mio.id);
    await avisarEquipo(cfg, `${situacion === 'vendido' ? 'Vendido' : situacion === 'reservado' ? 'Reservado' : 'Otra vez en venta'}: ${mio.titulo}`,
      `<p>El dueño del anuncio #${mio.id} «${esc(mio.titulo)}» lo ha marcado como ${situacion.replace('_', ' ')}.</p>`, deps.fetch).catch((e) => console.error(e));
    return json(200, { ok: true, situacion });
  }
  // Quién entra con su cuenta (una vez por sesión del navegador): para el panel y, si se quiere, un email al equipo
  if (ruta === 'api/visita' && method === 'POST') {
    const email = texto(body.email, 160);
    const nombre = texto(body.nombre, 80);
    const r = await db('sidonia_visita', { p_cliente: cliente, p_email: email, p_nombre: nombre });
    if (r && r.nuevo && cfg.avisosClientes) {
      await avisarEquipo(cfg, `Nuevo cliente en Sidonia: ${nombre || email || cliente}`, `<p><b>${esc(nombre || 'Sin nombre')}</b> · ${esc(email || 'sin email')} ha entrado por primera vez con su cuenta.</p>`, deps.fetch).catch((e) => console.error(e));
    }
    return json(200, { ok: true });
  }
  return null;
}

/* ---------------------------------------------------------------------------- Avisos por email (Resend) */
/** Email al equipo con Resend. Sin RESEND_API_KEY o sin AVISOS_EQUIPO no hace nada (el tema ya avisa por el formulario de contacto de Shopify). */
export async function avisarEquipo(cfg, asunto, html, fetchImpl = fetch) {
  if (!cfg.resendKey || !(cfg.avisosEquipo || []).length) return false;
  const r = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: cfg.avisosRemitente, to: cfg.avisosEquipo, subject: asunto, html }),
    signal: AbortSignal.timeout(5000)
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text().catch(() => '')}`);
  return true;
}

export function emailAnuncio(cfg, a) {
  const precio = a.precio ? `${Number(a.precio).toLocaleString('es-ES')} €` : 'A consultar';
  const panel = cfg.panelUrl || '';
  return `<div style="font-family:system-ui,sans-serif;max-width:620px">
<h2 style="margin:0 0 6px">${esc(a.titulo)} · ${esc(precio)}</h2>
<p style="margin:0 0 14px;color:#555">${esc(a.tipo)} · ${esc(a.ubicacion)} · ${(a.fotos || []).length} fotos</p>
<p><b>Lo vende:</b> ${esc(a.vendedor_nombre)} (${esc(a.vendedor_tipo || 'particular')}) · <a href="tel:${esc(a.telefono)}">${esc(a.telefono)}</a>${a.email ? ` · ${esc(a.email)}` : ''}</p>
<p>${esc(a.resumen)}</p>
<p>Revísalo y publícalo desde el panel: <b>/admin</b> del motor${panel ? ` (${esc(panel)})` : ''}.</p>
${(a.fotos || []).slice(0, 4).map((f) => `<img src="${esc(urlFoto(cfg, f))}" width="140" style="border-radius:8px;margin:0 6px 6px 0">`).join('')}
</div>`;
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

/* En la tienda, como las fichas de Sidonia: etiqueta de categoría en mayúsculas (COCHES, MOTOS, BARCOS, CASAS: así entran
 * en sus colecciones) y, además, «dueno» (anuncio de un dueño), «particular» o «profesional» y su perfil «vendedor-…». */
const CATEGORIA = { coche: ['COCHES', 'Cars'], moto: ['MOTOS', 'Motorcycles'], barco: ['BARCOS', 'Boats'], casa: ['CASAS', 'Real Estate'] };

export function productoShopify(cfg, a) {
  const [categoria, productType] = CATEGORIA[a.tipo] || CATEGORIA.coche;
  const vendedorTipo = a.vendedor_tipo === 'profesional' ? 'profesional' : 'particular';
  return {
    product: {
      title: a.titulo,
      descriptionHtml: descripcionHtml(a),
      vendor: a.vendedor_nombre,
      productType,
      tags: [categoria, 'dueno', vendedorTipo, `vendedor-${a.vendedor_slug}`],
      templateSuffix: 'cars',
      status: 'ACTIVE',
      metafields: [
        { namespace: 'custom', key: 'vendedor_nombre', type: 'single_line_text_field', value: a.vendedor_nombre },
        { namespace: 'custom', key: 'vendedor_slug', type: 'single_line_text_field', value: a.vendedor_slug },
        { namespace: 'custom', key: 'vendedor_telefono', type: 'single_line_text_field', value: a.telefono },
        { namespace: 'custom', key: 'vendedor_tipo', type: 'single_line_text_field', value: vendedorTipo },
        { namespace: 'custom', key: 'anuncio_id', type: 'single_line_text_field', value: String(a.id) }
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
  const pedir = async (query, variables) => {
    const r = await fetchImpl(`https://${cfg.shopifyTienda}/admin/api/2025-01/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await tokenOk() },
      body: JSON.stringify({ query, variables })
    });
    return { r, d: await r.json().catch(() => ({})) };
  };
  const denegado = (d) => JSON.stringify(d.errors || '').includes('ACCESS_DENIED');
  return async (query, variables = {}) => {
    let { r, d } = await pedir(query, variables);
    // Permisos nuevos aceptados hace poco: el token guardado aún es el viejo. Se pide otro y se repite una vez.
    if (denegado(d)) {
      tokenCache = null;
      ({ r, d } = await pedir(query, variables));
      if (denegado(d)) {
        throw new Error('La app de Shopify no tiene permiso para crear productos. En el Dev Dashboard, la versión activa tiene que tener los permisos write_products, read_publications y write_publications, y en Shopify admin › Apps › Sidonia Platform hay que aceptarlos.');
      }
    }
    if (!r.ok || d.errors) throw new Error(`Shopify ${r.status}: ${JSON.stringify(d.errors || d).slice(0, 400)}`);
    return d.data;
  };
}

/** Los metacampos de los filtros, sacados de la ficha técnica y la ubicación */
export function metacamposFiltros(a) {
  const ficha = Object.fromEntries((a.ficha || []).map(([k, v]) => [String(k).toLowerCase(), String(v)]));
  const out = [];
  const poner = (key, value) => { if (value) out.push({ namespace: 'custom', key, type: 'single_line_text_field', value: String(value).slice(0, 100) }); };
  poner('provincia', a.ubicacion);
  poner('marca', ficha.marca);
  poner('ano', (ficha['año'] || ficha.ano || '').match(/\d{4}/)?.[0]);
  poner('combustible', ficha.combustible && ficha.combustible.charAt(0).toUpperCase() + ficha.combustible.slice(1));
  return out;
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
  // Filtros de la tienda (marca, año, combustible, provincia): si los metacampos de la tienda tienen otro tipo, se deja
  try {
    const mf = metacamposFiltros(a).map((m) => ({ ...m, ownerId: p.id }));
    if (mf.length) await gql(`mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`, { m: mf });
  } catch (e) { /* no es imprescindible */ }
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

/** El producto de Shopify de un anuncio (por su handle): id, variante y fotos */
async function productoPorHandle(handle, gql) {
  const d = await gql(`query($q: String!) { products(first: 1, query: $q) { nodes { id handle variants(first: 1) { nodes { id } } media(first: 60) { nodes { id } } } } }`,
    { q: `handle:${handle}` });
  const p = d.products.nodes.find((n) => n.handle === handle);
  if (!p) throw new Error(`No encuentro en Shopify el producto «${handle}».`);
  return p;
}

/** Archiva la ficha (deja de verse en la tienda, se puede recuperar en Shopify › Productos) */
export async function archivarEnShopify(handle, gql) {
  const p = await productoPorHandle(handle, gql);
  const u = await gql(`mutation($product: ProductUpdateInput!) { productUpdate(product: $product) { userErrors { field message } } }`,
    { product: { id: p.id, status: 'ARCHIVED' } });
  const errs = u.productUpdate.userErrors;
  if (errs.length) throw new Error(`Shopify: ${errs.map((e) => e.message).join(' · ')}`);
  return true;
}

/** Reservado / vendido / en venta: la etiqueta de la ficha («reservado» o «vendido», como en los coches de Sidonia)
 *  y el anuncio (vendido deja de contar como su anuncio gratis). Primero Shopify: si falla, no se cambia nada. */
export async function marcarSituacion(cfg, a, situacion, deps) {
  const gql = deps.gql || shopifyAdmin(cfg, deps.fetch);
  const p = await productoPorHandle(a.producto, gql);
  await gql(`mutation($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { field message } } }`, { id: p.id, tags: ['reservado', 'vendido', 'Reservado', 'Vendido'] });
  if (situacion !== 'en_venta') {
    const t = await gql(`mutation($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }`, { id: p.id, tags: [situacion] });
    const errs = t.tagsAdd.userErrors;
    if (errs.length) throw new Error(`Shopify: ${errs.map((e) => e.message).join(' · ')}`);
  }
  const tabla = deps.tabla || tablaAnuncios(cfg, deps.fetch);
  if (situacion === 'vendido') await deps.db('sidonia_anuncio_estado', { p_id: a.id, p_estado: 'vendido', p_nota: '', p_producto: null });
  await tabla.cambiar(a.id, { reservado: situacion === 'reservado' });
}

/** Cambia el nombre del vendedor (y si es particular o profesional) en las fichas de sus anuncios publicados o vendidos */
async function nombreEnSusAnuncios(cfg, cliente, perfil, deps) {
  const tabla = deps.tabla || tablaAnuncios(cfg, deps.fetch);
  const suyos = await tabla.leer(`cliente=eq.${encodeURIComponent(cliente)}&estado=in.(publicado,vendido)&select=id,producto,vendedor_nombre,vendedor_tipo`);
  const gql = deps.gql || shopifyAdmin(cfg, deps.fetch);
  for (const a of suyos.filter((x) => x.producto)) {
    if (a.vendedor_nombre === perfil.nombre && a.vendedor_tipo === perfil.tipo) continue;
    const p = await productoPorHandle(a.producto, gql);
    await gql(`mutation($product: ProductUpdateInput!) { productUpdate(product: $product) { userErrors { field message } } }`, { product: { id: p.id, vendor: perfil.nombre } });
    await gql(`mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`, { m: [
      { ownerId: p.id, namespace: 'custom', key: 'vendedor_nombre', type: 'single_line_text_field', value: perfil.nombre },
      { ownerId: p.id, namespace: 'custom', key: 'vendedor_tipo', type: 'single_line_text_field', value: perfil.tipo }
    ] });
    await tabla.cambiar(a.id, { vendedor_nombre: perfil.nombre, vendedor_tipo: perfil.tipo });
  }
}

/** Aplica a la ficha publicada los cambios aprobados: textos, precio, metacampos y, si han cambiado, las fotos */
export async function actualizarEnShopify(cfg, a, fotosCambiadas, gql) {
  const p = await productoPorHandle(a.producto, gql);
  const { product, media } = productoShopify(cfg, a);
  delete product.status;
  const u = await gql(`mutation($product: ProductUpdateInput!) { productUpdate(product: $product) { userErrors { field message } } }`, { product: { ...product, id: p.id } });
  const errs = u.productUpdate.userErrors;
  if (errs.length) throw new Error(`Shopify: ${errs.map((e) => e.message).join(' · ')}`);
  const v = p.variants.nodes[0];
  if (v) {
    await gql(`mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } }
    }`, { productId: p.id, variants: [{ id: v.id, price: String(a.precio || 0) }] });
  }
  try {
    const mf = metacamposFiltros(a).map((m) => ({ ...m, ownerId: p.id }));
    if (mf.length) await gql(`mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`, { m: mf });
  } catch (e) { /* no es imprescindible */ }
  if (fotosCambiadas) {
    const viejas = p.media.nodes.map((m) => m.id);
    await gql(`mutation($productId: ID!, $media: [CreateMediaInput!]!) { productCreateMedia(productId: $productId, media: $media) { mediaUserErrors { field message } } }`, { productId: p.id, media });
    if (viejas.length) await gql(`mutation($productId: ID!, $mediaIds: [ID!]!) { productDeleteMedia(productId: $productId, mediaIds: $mediaIds) { mediaUserErrors { field message } } }`, { productId: p.id, mediaIds: viejas });
  }
  return { url: `${cfg.tienda}/products/${p.handle}` };
}

/* ---------------------------------------------------------------------------- Panel del equipo */
export const ESTADOS = { pendiente: 'Por revisar', aprobado: 'Aprobado', publicado: 'Publicado', vendido: 'Vendido', rechazado: 'Rechazado', retirado: 'Retirado' };

/** «Editar» en el panel: todos los textos, la ficha, el vendedor y las fotos (quitar y elegir portada) */
function formEditar(cfg, a) {
  const campo = (nombre, etiqueta, valor, extra = '') => `<label>${etiqueta}<input name="${nombre}" value="${esc(valor ?? '')}" ${extra}></label>`;
  const area = (nombre, etiqueta, valor, filas) => `<label>${etiqueta}<textarea name="${nombre}" rows="${filas}">${esc(valor ?? '')}</textarea></label>`;
  const opciones = (lista, actual, nombres) => lista.map((v) => `<option value="${v}"${v === actual ? ' selected' : ''}>${nombres[v] || v}</option>`).join('');
  const fotos = (a.fotos || []).map((f, i) => `<div class="efoto"><img src="${esc(urlFoto(cfg, f))}" alt="" loading="lazy">
      <span><input type="radio" name="portada" value="${i}"${i === 0 ? ' checked' : ''}> Portada</span>
      <span><input type="checkbox" name="quitar" value="${i}"> Quitar</span></div>`).join('');
  return `<details class="editar"><summary>Editar antes de publicar</summary>
    <form method="post">
      <input type="hidden" name="id" value="${a.id}">
      <div class="fila">
        <label>Tipo<select name="tipo">${opciones(TIPOS, a.tipo, { coche: 'Coche', moto: 'Moto', barco: 'Barco', casa: 'Casa' })}</select></label>
        ${campo('titulo', 'Título', a.titulo, 'required minlength="4" maxlength="120"')}
        ${campo('precio', 'Precio (€) <small>vacío = a consultar</small>', a.precio || '', 'inputmode="numeric"')}
        ${campo('ubicacion', 'Ubicación', a.ubicacion)}
      </div>
      ${area('resumen', 'Descripción breve', a.resumen, 2)}
      ${area('historia', 'Su historia', a.historia, 7)}
      ${area('mecanica', a.tipo === 'casa' ? 'Estado y reformas' : 'Mecánica y estado', a.mecanica, 4)}
      ${area('ficha', 'Ficha técnica <small>una línea por dato: «Año: 1987»</small>', (a.ficha || []).map(([k, v]) => `${k}: ${v}`).join('\n'), 6)}
      <div class="fila">
        ${campo('vendedor_nombre', 'Nombre del vendedor', a.vendedor_nombre)}
        <label>Vende como<select name="vendedor_tipo">${opciones(VENDEDOR_TIPOS, a.vendedor_tipo, { particular: 'Particular', profesional: 'Profesional' })}</select></label>
        ${campo('telefono', 'Teléfono', a.telefono)}
      </div>
      <label>Fotos <small>elige la portada o quita las que no valgan</small></label>
      <div class="efotos">${fotos}</div>
      <div><button name="accion" value="guardar" class="si">Guardar cambios</button></div>
    </form>
  </details>`;
}

export function paginaPanel(cfg, lista, { estado = 'pendiente', aviso = '' } = {}) {
  const fmt = (n) => (n ? `${Number(n).toLocaleString('es-ES')} €` : 'A consultar');
  const pestañas = navPanel(estado);
  if (estado === 'propietarios') return paginaPanelHtml(pestañas, aviso, paginaPropietarios(cfg, lista));
  if (estado === 'ubicaciones') return paginaPanelHtml(pestañas, aviso, paginaUbicaciones(cfg, lista));
  if (estado === 'cambios') return paginaPanelHtml(pestañas, aviso, lista.map((a) => tarjetaCambios(cfg, a)).join('') || '<p class="vacio">No hay cambios por revisar.</p>');
  const tarjetas = lista.map((a) => `
  <article class="a">
    <div class="fotos">${(a.fotos || []).map((f, i) => `<a href="${esc(urlFoto(cfg, f))}" target="_blank"><img src="${esc(urlFoto(cfg, f))}" alt="" loading="lazy">${i === 0 ? '<b>Portada</b>' : ''}</a>`).join('')}</div>
    <div class="cuerpo">
      <p class="meta">#${a.id} · ${esc(a.tipo)} · ${new Date(a.creado).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })} · <span class="est est-${esc(a.estado)}">${esc(ESTADOS[a.estado] || a.estado)}</span>${a.quiere_gestion ? ' · <span class="est est-gestion">Quiere que lo vendamos</span>' : ''}${a.mejoras?.pedido && ['pendiente', 'aprobado'].includes(a.estado) ? (a.mejoras.editado ? ' · <span class="est est-publicado">Ya lo ha mejorado</span>' : ' · <span class="est est-pendiente">Mejoras pedidas</span>') : ''}</p>
      <h2>${esc(a.titulo)} <small>${fmt(a.precio)} · ${esc(a.ubicacion)}</small></h2>
      <p class="vend">Lo vende <b>${esc(a.vendedor_nombre)}</b> (${a.vendedor_tipo === 'profesional' ? 'profesional' : 'particular'}) · <a href="tel:${esc(a.telefono)}">${esc(a.telefono)}</a>${a.email ? ` · ${esc(a.email)}` : ''} · ${(a.fotos || []).length} fotos</p>
      <p class="res">${esc(a.resumen)}</p>
      <details><summary>Historia, mecánica y ficha técnica</summary>
        <h3>Historia</h3>${parrafos(a.historia)}
        <h3>${a.tipo === 'casa' ? 'Estado y reformas' : 'Mecánica y estado'}</h3>${parrafos(a.mecanica)}
        <h3>Ficha técnica</h3><table>${(a.ficha || []).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
      </details>
      ${a.quiere_gestion ? `<p class="gestion-quiere">Pidió el ${new Date(a.quiere_gestion).toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'long' })} que Sidonia lo venda (gestión de venta): llámale al <a href="tel:${esc(a.telefono)}">${esc(a.telefono)}</a>.</p>` : ''}
      ${a.nota ? `<p class="nota">Nota: ${esc(a.nota)}</p>` : ''}
      ${a.producto ? `<p><a href="${esc(cfg.tienda)}/products/${esc(a.producto)}" target="_blank">Ver la ficha en la tienda →</a></p>` : ''}
      ${['pendiente', 'aprobado'].includes(a.estado) ? formEditar(cfg, a) + cajaMejoras(a) : ''}
      <form method="post" class="acc">
        <input type="hidden" name="id" value="${a.id}">
        ${['pendiente', 'aprobado'].includes(a.estado) ? '<button name="accion" value="publicar" class="si">Aprobar y publicar en Shopify</button>' : ''}
        ${a.estado === 'pendiente' ? '<textarea name="nota" rows="2" placeholder="Motivo si lo rechazas: le llega al dueño por email (p. ej. «Las fotos tienen poca luz: ¿puedes hacer otras de día?»)"></textarea><button name="accion" value="rechazar" class="no">Rechazar</button>' : ''}
        ${a.estado === 'publicado' ? `${a.reservado ? '<button name="accion" value="en_venta">Quitar «Reservado»</button>' : '<button name="accion" value="reservado">Reservado</button>'}<button name="accion" value="vendido">Vendido</button><button name="accion" value="retirar" class="no">Marcar como retirado</button>` : ''}
        ${['pendiente', 'aprobado'].includes(a.estado) ? `<label class="avisar"><input type="checkbox" name="avisar" value="1" checked> Avisar al dueño por email${a.email ? ` (${esc(a.email)})` : ' (no tenemos su email)'}</label>` : ''}
      </form>
    </div>
  </article>`).join('') || '<p class="vacio">No hay anuncios aquí.</p>';
  return paginaPanelHtml(pestañas, aviso, tarjetas);
}

/** Panel › Cambios: lo que el dueño ha editado de un anuncio aprobado o publicado, antes y ahora, para aprobarlo o no */
const ETIQUETAS = { tipo: 'Tipo', titulo: 'Título', precio: 'Precio', ubicacion: 'Ubicación', resumen: 'Descripción breve', historia: 'Su historia', mecanica: 'Mecánica y estado', ficha: 'Ficha técnica', vendedor_nombre: 'Nombre', vendedor_tipo: 'Vende como', telefono: 'Teléfono' };
function tarjetaCambios(cfg, a) {
  const r = a.revision || {};
  const ver = (k, v) => {
    if (k === 'precio') return v ? `${Number(v).toLocaleString('es-ES')} €` : 'A consultar';
    if (k === 'ficha') return (v || []).map(([x, y]) => `${esc(x)}: ${esc(y)}`).join('<br>');
    return esc(v ?? '').replace(/\n/g, '<br>');
  };
  const filas = Object.keys(ETIQUETAS).filter((k) => k in r && JSON.stringify(r[k] ?? null) !== JSON.stringify(a[k] ?? null))
    .map((k) => `<tr><th>${ETIQUETAS[k]}</th><td class="antes">${ver(k, a[k])}</td><td class="ahora">${ver(k, r[k])}</td></tr>`).join('');
  const tiras = (lista) => `<div class="fotos">${(lista || []).map((f, i) => `<a href="${esc(urlFoto(cfg, f))}" target="_blank"><img src="${esc(urlFoto(cfg, f))}" alt="" loading="lazy">${i === 0 ? '<b>Portada</b>' : ''}</a>`).join('')}</div>`;
  const fotos = JSON.stringify(r.fotos || []) !== JSON.stringify(a.fotos || []) ? `<h3>Fotos antes</h3>${tiras(a.fotos)}<h3>Fotos ahora</h3>${tiras(r.fotos)}` : '';
  return `
  <article class="a">
    <div class="cuerpo">
      <p class="meta">#${a.id} · ${esc(a.tipo)} · <span class="est est-${esc(a.estado)}">${esc(ESTADOS[a.estado] || a.estado)}</span> · cambios del ${a.revision_fecha ? new Date(a.revision_fecha).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }) : '—'}</p>
      <h2>${esc(a.titulo)} <small>· ${esc(a.vendedor_nombre)} · ${esc(a.email || '')}</small></h2>
      ${a.producto ? `<p><a href="${esc(cfg.tienda)}/products/${esc(a.producto)}" target="_blank">Ver la ficha en la tienda →</a></p>` : ''}
      ${filas ? `<table class="diff"><tr><th></th><th>Antes</th><th>Ahora</th></tr>${filas}</table>` : (fotos ? '' : '<p class="vacio">Sin cambios en los textos.</p>')}
      ${fotos}
      <form method="post" class="acc">
        <input type="hidden" name="id" value="${a.id}">
        <button name="accion" value="aplicar" class="si">Aprobar cambios${a.estado === 'publicado' ? ' y actualizar la ficha' : ''}</button>
        <textarea name="nota" rows="2" placeholder="Motivo si no los apruebas: le llega al dueño por email"></textarea><button name="accion" value="descartar" class="no">No aprobar</button>
        <label class="avisar"><input type="checkbox" name="avisar" value="1" checked> Avisar al dueño por email${a.email ? ` (${esc(a.email)})` : ' (no tenemos su email)'}</label>
      </form>
    </div>
  </article>`;
}

/** Panel › Propietarios: sacar de cada historia el nombre del dueño de los coches de Sidonia (metacampo custom.propietario) */
function paginaPropietarios(cfg, informe) {
  const admin = (h) => `https://admin.shopify.com/store/${esc(String(cfg.shopifyTienda || '').replace('.myshopify.com', ''))}/products?query=${encodeURIComponent(h)}`;
  const filas = (informe || []).map((r) => `<tr><td><a href="${esc(cfg.tienda)}/products/${esc(r.handle)}" target="_blank">${esc(r.titulo)}</a></td>
    <td>${r.nombre ? `<b>${esc(r.nombre)}</b>` : '<span class="vacio">— (no lo nombra)</span>'}</td>
    <td>${r.estado === 'nuevo' ? 'Puesto ahora' : r.estado === 'ya' ? 'Ya lo tenía' : `<a href="${admin(r.handle)}" target="_blank">Ponerlo a mano</a>`}</td></tr>`).join('');
  const cuenta = (e) => (informe || []).filter((r) => r.estado === e).length;
  return `<article class="a"><div class="cuerpo">
    <h2>Propietarios de los coches de Sidonia</h2>
    <p class="res">Lee la historia de cada producto de Sidonia y saca el nombre de su dueño («<i>Carlos</i> lleva toda la vida…»). Se lo pone
      a los que aún no lo tienen; sale en la ficha («Propietario: Carlos · Venta gestionada por Sidonia») y en la tarjeta.
      Si alguno no cuadra, cámbialo en Shopify › Productos › el coche › <b>Propietario</b>. Pásalo cuando subáis coches nuevos.</p>
    <form method="post" class="acc">
      <button name="accion" value="propietarios" class="si">Sacar los propietarios de las historias</button>
      <label class="avisar"><input type="checkbox" name="sobrescribir" value="1"> Volver a sacarlos también en los que ya tienen (cambia lo puesto a mano)</label>
    </form>
    ${informe ? `<p class="meta">${cuenta('nuevo')} puestos ahora · ${cuenta('ya')} ya lo tenían · ${cuenta('sin')} sin nombre en la historia</p>
      <table class="diff"><tr><th>Producto</th><th>Propietario</th><th></th></tr>${filas}</table>` : ''}
  </div></article>`;
}

/** Panel › Ubicaciones: la ubicación de cada producto sacada de su descripción, para la tarjeta y el filtro */
function paginaUbicaciones(cfg, informe) {
  const admin = (h) => `https://admin.shopify.com/store/${esc(String(cfg.shopifyTienda || '').replace('.myshopify.com', ''))}/products?query=${encodeURIComponent(h)}`;
  const filas = (informe || []).map((r) => `<tr><td><a href="${esc(cfg.tienda)}/products/${esc(r.handle)}" target="_blank">${esc(r.titulo)}</a></td>
    <td>${r.provincia ? `<b>${esc(r.provincia)}</b>${r.sitio && r.sitio !== r.provincia ? ` <small>(${esc(r.sitio)})</small>` : ''}` : '<span class="vacio">— (la descripción no lo dice)</span>'}</td>
    <td>${r.estado === 'nuevo' ? 'Puesta ahora' : r.estado === 'ya' ? 'Ya la tenía' : `<a href="${admin(r.handle)}" target="_blank">Ponerla a mano</a>`}</td></tr>`).join('');
  const cuenta = (e) => (informe || []).filter((r) => r.estado === e).length;
  return `<article class="a"><div class="cuerpo">
    <h2>Ubicación de cada anuncio</h2>
    <p class="res">Lee la descripción de cada producto («📍 Ubicación: Pozuelo de Alarcón») y saca la provincia (Madrid). Se la pone a los
      que aún no la tienen: sale en la tarjeta («📍 Madrid») y en el filtro «Localización», y se añade como etiqueta del producto.
      Si alguna no cuadra, cámbiala en Shopify › Productos › el anuncio › <b>Provincia</b>. Pásalo cuando subáis anuncios nuevos.</p>
    <form method="post" class="acc">
      <button name="accion" value="ubicaciones" class="si">Poner las ubicaciones</button>
      <label class="avisar"><input type="checkbox" name="etiqueta" value="1" checked> Ponerla también como etiqueta del producto (por ejemplo «Madrid»)</label>
      <label class="avisar"><input type="checkbox" name="sobrescribir" value="1"> Volver a sacarla también en los que ya la tienen (cambia lo puesto a mano)</label>
    </form>
    ${informe ? `<p class="meta">${cuenta('nuevo')} puestas ahora · ${cuenta('ya')} ya la tenían · ${cuenta('sin')} sin ubicación en la descripción</p>
      <table class="diff"><tr><th>Producto</th><th>Ubicación</th><th></th></tr>${filas}</table>` : ''}
  </div></article>`;
}

function paginaPanelHtml(pestañas, aviso, tarjetas) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Panel de Sidonia</title><meta name="robots" content="noindex">${FAVICON}
<style>${ESTILO_PANEL}
  /* Anuncios de los dueños */
  .a { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; margin: 0 0 14px; padding: 16px; border-radius: 16px; background: var(--caja); border: 1px solid var(--linea); box-shadow: var(--sombra); }
  .cuerpo { min-width: 0; display: grid; gap: 10px; }
  .fotos { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: thin; }
  .fotos a { position: relative; flex: none; }
  .fotos img { width: 150px; height: 112px; object-fit: cover; border-radius: 10px; display: block; }
  .fotos b { position: absolute; left: 6px; top: 6px; padding: 2px 8px; border-radius: 6px; background: var(--verde); color: var(--verde-tinta); font-size: 11px; font-weight: 800; }
  .a h2 { margin: 0; font-size: 20px; letter-spacing: 0; text-transform: none; color: var(--texto); } .a h2 small { color: var(--flojo); font-size: 14px; }
  .meta, .vend { margin: 0; font-size: 13px; color: var(--suave); } .res { margin: 0; }
  .est { padding: 2px 8px; border-radius: 6px; font-weight: 800; background: var(--caja-3); color: var(--suave); }
  .est-pendiente, .est-aprobado { background: var(--amarillo-fondo); color: var(--amarillo); } .est-publicado { background: var(--azul-fondo); color: var(--azul); }
  .est-vendido { background: var(--verde-fondo); color: var(--verde); } .est-rechazado, .est-retirado { background: var(--rojo-fondo); color: var(--rojo); }
  details summary { cursor: pointer; font-weight: 700; } details h3 { font-size: 14px; margin: 14px 0 4px; } details p { margin: 0 0 8px; line-height: 1.55; }
  .a table { width: auto; font-size: 14px; } .a th { position: static; text-align: left; padding: 3px 12px 3px 0; border: 0; background: none; } .a td { border: 0; padding: 3px 0; text-align: left; white-space: normal; }
  .a th:first-child, .a td:first-child { min-width: 0; position: static; box-shadow: none; }
  .nota { color: var(--rojo); }
  .acc { display: flex; gap: 8px; flex-wrap: wrap; }
  .acc textarea[name=nota] { flex: 1; min-width: 220px; resize: vertical; }
  .avisar { flex-basis: 100%; font-size: 13px; color: var(--suave); display: flex; gap: 6px; align-items: center; }
  .editar { border: 1px solid var(--linea); border-radius: 12px; padding: 10px 14px; background: var(--caja-2); }
  .editar summary { font-weight: 700; }
  .editar form { display: grid; gap: 12px; margin-top: 12px; }
  .editar .fila { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr)); }
  .editar label { display: grid; gap: 4px; font-size: 13px; font-weight: 600; color: var(--suave); }
  .editar textarea { resize: vertical; line-height: 1.45; }
  ${CSS_MEJORAS}
  .est-gestion { background: var(--lila-fondo); color: var(--lila); }
  .gestion-quiere { margin: 0 0 10px; padding: 10px 14px; border-radius: 12px; background: var(--lila-fondo); color: var(--texto); }
  .editar .efotos { display: flex; gap: 8px; flex-wrap: wrap; }
  .editar .efoto { width: 120px; font-weight: 400; font-size: 12px; }
  .editar .efoto img { width: 120px; height: 90px; object-fit: cover; border-radius: 8px; display: block; }
  .editar .efoto span { display: flex; gap: 4px; align-items: center; }
  .editar small { font-weight: 400; color: var(--flojo); }
  .diff { width: 100% !important; font-size: 14px; table-layout: fixed; overflow-wrap: anywhere; } .diff th, .diff td { vertical-align: top; padding: 8px 10px !important; border-top: 1px solid var(--linea) !important; text-align: left; white-space: normal; }
  .diff th:first-child { width: 130px; } .diff .antes { background: var(--rojo-fondo); color: var(--rojo); } .diff .ahora { background: var(--verde-fondo); color: var(--verde); }
  .a h3 { font-size: 14px; margin: 12px 0 6px; }
  .a .aviso { margin: 0; }
</style></head><body>
${CABECERA}
${aviso ? `<p class="aviso${aviso.startsWith('Error') ? ' mal' : ''}">${esc(aviso)}</p>` : ''}
${pestañas}
${tarjetas}
<script>document.querySelectorAll('form.acc').forEach((f) => f.addEventListener('submit', (e) => { const b = e.submitter; if (b && b.value === 'publicar' && !confirm('¿Aprobar y crear la ficha en Shopify?')) return e.preventDefault(); if (b && b.value === 'rechazar' && !confirm('¿Rechazar este anuncio?')) return e.preventDefault(); if (b && b.value === 'descartar' && !confirm('¿No aprobar estos cambios?')) return e.preventDefault(); if (b) setTimeout(() => { b.disabled = true; b.textContent = 'Un momento…'; }, 0); }));</script>
</body></html>`;
}

/** Contraseña del panel (usuario cualquiera, contraseña ADMIN_CLAVE) */
/** Panel › Clientes: quién se ha registrado y quién ha entrado, y cuándo */
export function paginaClientes(datos) {
  const d = datos || {};
  const fecha = (t) => (t ? new Date(t).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
  const filas = (d.lista || []).map((c) => `<tr><td><b>${esc(c.nombre || '—')}</b><br><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></td><td>${fecha(c.primera)}</td><td>${fecha(c.ultima)}</td><td>${Number(c.visitas) || 1}</td></tr>`).join('');
  const pestañas = navPanel('clientes');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Clientes · Panel de Sidonia</title><meta name="robots" content="noindex">${FAVICON}
<style>${ESTILO_PANEL}
  .tabla table th { position: static; }
</style></head><body>
${CABECERA}
${pestañas}
<div class="kpis">
  <div class="kpi"><b>${Number(d.nuevos_hoy) || 0}</b><span>Nuevos hoy</span></div>
  <div class="kpi"><b>${Number(d.semana) || 0}</b><span>Nuevos esta semana</span></div>
  <div class="kpi"><b>${Number(d.hoy) || 0}</b><span>Han entrado hoy</span></div>
  <div class="kpi"><b>${Number(d.total) || 0}</b><span>Clientes en total</span></div>
</div>
<div class="card"><div class="tabla"><table><thead><tr><th>Cliente</th><th>Primera vez (registro)</th><th>Última vez</th><th>Visitas</th></tr></thead><tbody>${filas || '<tr><td colspan="4">Aún no ha entrado nadie con su cuenta.</td></tr>'}</tbody></table></div></div>
<p class="nota">Son las personas con cuenta en Sidonia: «Primera vez» es cuando se registraron (o entraron por primera vez con su cuenta), «Última vez» cuando entraron por última vez y «Visitas» cuántas veces han entrado (una por sesión del navegador). Quien entra sin cuenta no sale aquí: eso está en <a href="?estado=estadisticas">Estadísticas</a>. La lista completa de clientes está en Shopify › Clientes.</p>
</body></html>`;
}

/** Panel › Herramientas: lo que se usa de vez en cuando */
function paginaHerramientas() {
  const h = (href, titulo, texto) => `<article class="a"><div class="cuerpo"><h2><a href="${href}" style="color:inherit">${titulo} ›</a></h2><p class="meta">${texto}</p></div></article>`;
  return h('?estado=ubicaciones', 'Ubicaciones', 'Pone a cada producto de la tienda su provincia (para la tarjeta y el filtro «Localización»), sacada de la descripción.')
    + h('?estado=propietarios', 'Propietario en las fichas', 'Saca de la historia de cada coche de Sidonia el nombre de su dueño, para enseñarlo en la ficha («Propietario: Carlos»).')
    + h('?estado=correos', 'Emails', 'Cómo se ve cada email que mandamos a los dueños (recibido, mejoras, publicado, pagos…) y mandarte una prueba.')
    + h('?estado=avisos', 'Avisos al móvil', 'Manda una notificación a todos los que tienen la app (un coche nuevo, una bajada de precio…).')
    + h('?salir=1', 'Cerrar sesión', 'Sale del panel en este dispositivo (la próxima vez pedirá el código).')
    + h('?estado=importar', 'Importar Excel de ventas', 'Mete en Ventas el Excel de coches vendidos, con precios y comisiones. Se puede repetir: lo que ya está se pone al día.');
}

/** Panel › Avisos: mandar un aviso al móvil a todos los que tienen la app (coche nuevo, bajada de precio…) */
export function paginaAvisos(cfg, aviso = '') {
  const pestañas = navPanel('avisos');
  const formulario = `<article class="a"><div class="cuerpo">
    <h2>Aviso a todos los que tienen la app</h2>
    <p class="meta">Les llega como notificación al móvil y, al tocarla, se abre la página del enlace. Úsalo con cabeza: un aviso a la semana como mucho.</p>
    ${cfg.firebase ? '' : '<p class="nota">Aún no se puede mandar: falta FIREBASE_SERVICE_ACCOUNT en Vercel (ver app/README.md).</p>'}
    <form method="post" class="editar" style="border:0;padding:0"><div class="fila" style="grid-template-columns:minmax(0,1fr)">
      <label>Título <input name="titulo" maxlength="120" required placeholder="Acaba de llegar: Alfa Romeo Giulia GT 1967"></label>
      <label>Texto <textarea name="texto" rows="2" maxlength="400" required placeholder="Rosso Alfa, restaurado y con toda su historia. Míralo antes que nadie."></textarea></label>
      <label>Enlace <input name="url" value="/" placeholder="/products/alfa-romeo-giulia-gt-1967"></label>
      <label>Foto (opcional) <small>la URL de una imagen, se ve en grande en la notificación</small><input name="imagen" placeholder="https://cdn.shopify.com/…"></label>
    </div><div><button class="si" onclick="return confirm('¿Mandar este aviso a todos los que tienen la app?')">Mandar aviso</button></div></form>
  </div></article>`;
  return paginaPanelHtml(pestañas, aviso, formulario);
}

export function panelAutorizado(headers, clave) {
  if (!clave) return false;
  const h = String(headers.authorization || '');
  if (!h.startsWith('Basic ')) return false;
  const [, pass = ''] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(/:(.*)/s);
  const a = createHash('sha256').update(pass).digest();
  const b = createHash('sha256').update(clave).digest();
  return a.equals(b);
}

/** Lo que el equipo cambia en «Editar» (solo anuncios por revisar o aprobados). Devuelve los campos o { error }. */
export function leerEdicion(b, a) {
  const tipo = TIPOS.includes(b.tipo) ? b.tipo : a.tipo;
  const titulo = texto(b.titulo, 120);
  if (titulo.length < 4) return { error: 'El título es demasiado corto.' };
  const precio = String(b.precio || '').replace(/\D/g, '');
  const ficha = texto(b.ficha, 3000).split('\n').map((l) => l.split(/:(.*)/s).map((x) => x.trim())).filter(([k, v]) => k && v).slice(0, 40).map(([k, v]) => [k.slice(0, 40), v.slice(0, 120)]);
  // Fotos: se pueden quitar y elegir la portada; nunca añadir rutas nuevas desde aquí
  const actuales = Array.isArray(a.fotos) ? a.fotos : [];
  const quitar = new Set([].concat(b.quitar || []).map(Number));
  let fotos = actuales.filter((_, i) => !quitar.has(i));
  const portada = actuales[Number(b.portada)];
  if (portada && fotos.includes(portada)) fotos = [portada, ...fotos.filter((f) => f !== portada)];
  if (!fotos.length) return { error: 'Tiene que quedar al menos una foto.' };
  const tel = texto(b.telefono, 30);
  if (tel.replace(/\D/g, '').length < 9) return { error: 'Revisa el teléfono.' };
  return {
    tipo, titulo, precio: precio ? Number(precio) : null, ubicacion: texto(b.ubicacion, 80), resumen: texto(b.resumen, 600),
    historia: texto(b.historia, 8000), mecanica: texto(b.mecanica, 5000), ficha, fotos,
    vendedor_nombre: texto(b.vendedor_nombre, 60) || a.vendedor_nombre, vendedor_tipo: VENDEDOR_TIPOS.includes(b.vendedor_tipo) ? b.vendedor_tipo : a.vendedor_tipo,
    telefono: tel, actualizado: new Date().toISOString()
  };
}

/** La tabla anuncios de Supabase por REST, con la clave de servicio: leer (filtro de PostgREST) y cambiar un anuncio */
export function tablaAnuncios(cfg, fetchImpl = fetch, nombreTabla = 'anuncios') {
  const cabeceras = { apikey: cfg.supabaseKey, ...(cfg.supabaseKey.startsWith('sb_') ? {} : { Authorization: `Bearer ${cfg.supabaseKey}` }), 'Content-Type': 'application/json' };
  const fallo = async (r) => {
    const t = (await r.text().catch(() => '')).slice(0, 200);
    // Falta la columna «revision» o las tablas «perfiles» o «dispositivos»: hay que volver a ejecutar sql/circulo.sql
    throw new Error(/revision|reservado|mejoras|perfiles|dispositivos|alertas/.test(t) ? 'Falta actualizar la base de datos: ejecuta otra vez sql/circulo.sql en Supabase › SQL Editor.' : `Supabase ${r.status}: ${t}`);
  };
  return {
    async leer(filtro) {
      const r = await fetchImpl(`${cfg.supabaseUrl}/rest/v1/${nombreTabla}?${/(^|&)select=/.test(filtro) ? '' : 'select=*&'}${filtro}`, { headers: cabeceras, signal: AbortSignal.timeout(8000) });
      if (!r.ok) await fallo(r);
      return r.json();
    },
    async cambiar(id, cambios) {
      const r = await fetchImpl(`${cfg.supabaseUrl}/rest/v1/${nombreTabla}?id=eq.${Number(id)}`, {
        method: 'PATCH', headers: { ...cabeceras, Prefer: 'return=minimal' }, body: JSON.stringify(cambios), signal: AbortSignal.timeout(8000)
      });
      if (!r.ok) await fallo(r);
    },
    async borrar(filtro) {
      const r = await fetchImpl(`${cfg.supabaseUrl}/rest/v1/${nombreTabla}?${filtro}`, { method: 'DELETE', headers: { ...cabeceras, Prefer: 'return=minimal' }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) await fallo(r);
    },
    // Crear o cambiar una fila por su clave (perfiles: cliente; dispositivos: token)
    async guardar(fila, clave) {
      const r = await fetchImpl(`${cfg.supabaseUrl}/rest/v1/${nombreTabla}?on_conflict=${clave}`, {
        method: 'POST', headers: { ...cabeceras, Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(fila), signal: AbortSignal.timeout(8000)
      });
      if (!r.ok) await fallo(r);
      return (await r.json())[0];
    }
  };
}

/** Lo público de un perfil: lo que se enseña en su página y en sus anuncios (sin el id del cliente) */
export const perfilPublico = (cfg, p) => p && ({
  slug: p.slug, nombre: p.nombre, tipo: p.tipo === 'profesional' ? 'profesional' : 'particular', descripcion: p.descripcion || '',
  foto: p.foto ? urlFoto(cfg, p.foto) : ''
});

/** Guarda los cambios de un anuncio (panel › Editar) */
export const guardarAnuncio = (cfg, id, cambios, fetchImpl = fetch) => tablaAnuncios(cfg, fetchImpl).cambiar(id, cambios);

export async function atenderPanel(req, cfg, deps) {
  const html = (body, status = 200) => ({ status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, body });
  // El icono y el manifiesto para la pantalla de inicio: el móvil los pide sin la contraseña
  if (req.query.recurso) return recursoPanel(String(req.query.recurso));
  // Entrar: con la sesión guardada (código de 5 cifras, lib/acceso.mjs) o con usuario y contraseña del navegador
  const sinCache = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
  if (req.query.salir) return { status: 302, headers: { Location: '?', 'Set-Cookie': cookieFuera(), 'Cache-Control': 'no-store' }, body: '' };
  if (!sesionValida(req.headers || {}, cfg.adminClave) && !panelAutorizado(req.headers || {}, cfg.adminClave)) {
    if (!cfg.adminClave) return { status: 401, headers: sinCache, body: paginaEntrar({ error: 'El panel aún no tiene contraseña: pon ADMIN_CLAVE (y ADMIN_PIN) en Vercel.' }) };
    if (req.method === 'POST' && req.body && req.body.codigo !== undefined) {
      const r = await intentarEntrar(req.body.codigo, req.headers || {}, cfg, deps);
      if (r.ok) {
        const vuelta = Object.entries(req.query || {}).filter(([k]) => k !== 'salir').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
        return { status: 303, headers: { Location: `?${vuelta}`, 'Set-Cookie': cookieSesion(cfg.adminClave), 'Cache-Control': 'no-store' }, body: '' };
      }
      return { status: 401, headers: sinCache, body: paginaEntrar({ error: r.error, largo: cfg.adminPin ? cfg.adminPin.length : 99 }) };
    }
    return { status: 401, headers: sinCache, body: paginaEntrar({ largo: cfg.adminPin ? cfg.adminPin.length : 99 }) };
  }
  const { db } = deps;
  // Cuántos anuncios hay por revisar: el número rojo de «Anuncios» y la lista de tareas de la portada
  ponerContadores({});
  const tareas = [];
  if (deps.tabla || cfg.supabaseUrl) {
    try {
      const filas = await (deps.tabla || tablaAnuncios(cfg, deps.fetch)).leer('select=estado,revision&limit=5000');
      const c = { pendiente: filas.filter((a) => a.estado === 'pendiente').length, cambios: filas.filter((a) => a.revision).length };
      ponerContadores(c);
      if (c.pendiente) tareas.push([`${c.pendiente} ${c.pendiente === 1 ? 'anuncio' : 'anuncios'} por revisar ›`, '?estado=pendiente']);
      if (c.cambios) tareas.push([`${c.cambios} ${c.cambios === 1 ? 'cambio' : 'cambios'} por revisar ›`, '?estado=cambios']);
    } catch (e) { console.error(e); }
    // Anunciantes que quieren que Sidonia venda su anuncio (gestion.mjs): sin la columna aún, nada
    try {
      const q = (await (deps.tabla || tablaAnuncios(cfg, deps.fetch)).leer('quiere_gestion=not.is.null&estado=eq.publicado&select=id')).length;
      if (q) tareas.push([`${q} ${q === 1 ? 'anunciante quiere' : 'anunciantes quieren'} que vendáis su anuncio ›`, '?estado=publicado']);
    } catch (e) { /* sin sql/gestion.sql */ }
  }
  // La portada del panel es el centro operativo: Ventas, una venta, Importar Excel y Propietarios (operaciones.mjs)
  const seccion = req.query.estado || (req.method === 'GET' ? 'ventas' : '');
  // Anuncios › En la web: todos los anuncios de la tienda y su editor (fichas.mjs)
  if (seccion === 'fichas' || seccion === 'ficha') return rutasFichas({ ...req, query: { ...req.query, estado: seccion } }, cfg, deps, html);
  if (['ventas', 'meses', 'ofertas', 'operacion', 'importar', 'duenos', 'enlazar'].includes(seccion)) {
    return rutasOperaciones({ ...req, query: { ...req.query, estado: seccion } }, cfg, { ...deps, tareas }, html);
  }
  // Anuncios › Cobros y Clientes › Anunciantes: los anuncios de la comunidad, lo que pagan y lo que llevan gastado (comunidad.mjs)
  if (['cobros', 'cobrar', 'tarifa', 'anunciantes', 'anunciante'].includes(seccion)) return rutasComunidad({ ...req, query: { ...req.query, estado: seccion } }, cfg, deps, html);
  // Herramientas › Emails: cómo se ve cada email y mandarse una prueba (plantillas.mjs)
  if (seccion === 'correos') return rutasCorreos(req, cfg, deps, html);
  if (seccion === 'herramientas') return html(paginaPanelHtml(navPanel('herramientas'), '', paginaHerramientas()));
  // Clientes (CRM): la lista con lo que hace cada uno, un cliente, o quién está interesado en un anuncio (crm.mjs)
  if (req.query.estado === 'clientes') {
    const dias = [7, 30, 90, 365, 3650].includes(Number(req.query.dias)) ? Number(req.query.dias) : 30;
    let crm = null;
    try { crm = await db('sidonia_crm_clientes', { p_dias: dias }); } catch (e) { console.error(e); }
    // Sin sql/estadisticas.sql todavía: la lista de siempre (quién se registra y cuándo entra)
    if (!crm || !Array.isArray(crm.lista)) return html(paginaClientes(await db('sidonia_clientes_lista', { p_limite: 300 })));
    if (req.query.csv) {
      return { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="clientes-sidonia-${dias}-dias.csv"`, 'Cache-Control': 'no-store' }, body: csvClientes(crm) };
    }
    return html(paginaClientesCrm(crm, { dias }));
  }
  if (req.query.estado === 'cliente' && req.query.id) {
    let d = null, error = '';
    try { d = await db('sidonia_crm_cliente', { p_cliente: String(req.query.id).slice(0, 30) }); } catch (e) { error = String(e.message || e); }
    // Lo que nos ha comprado (Ventas, por su email)
    if (d?.cliente?.email && (deps.operaciones || cfg.supabaseUrl)) {
      try { d.compras = await (deps.operaciones || tablaAnuncios(cfg, deps.fetch, 'operaciones')).leer(`comprador_email=ilike.${encodeURIComponent(d.cliente.email)}&select=id,titulo,precio_venta,fecha_venta`); } catch (e) { d.compras = []; }
    }
    return html(paginaCliente(d, { tienda: cfg.tienda, error }));
  }
  if (req.query.estado === 'anuncio' && req.query.h) {
    let d = null, error = '';
    try { d = await db('sidonia_crm_anuncio', { p_handle: String(req.query.h).slice(0, 160) }); } catch (e) { error = String(e.message || e); }
    return html(paginaAnuncio(d, { tienda: cfg.tienda, error }));
  }
  if (req.query.estado === 'estadisticas') {
    const dias = [1, 7, 30, 90, 365].includes(Number(req.query.dias)) ? Number(req.query.dias) : 30;
    // El detalle de una cajita (contactos: en qué anuncios y quién…)
    if (DETALLES[req.query.ver]) return rutaDetalle(req, cfg, deps, html, dias);
    let datos = null, error = '';
    try { datos = await db('sidonia_estadisticas', { p_dias: dias }); } catch (e) { error = String(e.message || e); }
    return html(paginaEstadisticas(datos, { dias, error, tienda: cfg.tienda }));
  }
  // Email al dueño: el aviso del panel dice si ha salido, si falta Resend o si ha fallado
  const correoAlDueno = async (a, avisar, c) => {
    if (!avisar) return '';
    if (!a.email) return ' Sin email del dueño: no se le ha avisado.';
    try {
      return (await enviarCorreo(cfg, a.email, c.asunto, c.html, deps.fetch)) ? ` Email enviado a ${a.email}.` : ' No se ha enviado el email: falta RESEND_API_KEY en Vercel.';
    } catch (e) {
      console.error(e);
      return ` El email no ha salido (${e.message}).`;
    }
  };
  // Aviso al móvil del dueño (si tiene la app): el texto que se añade al aviso del panel
  const avisoMovil = async (a, datos) => {
    if (!cfg.firebase || !a.cliente) return '';
    try {
      const n = await avisarCliente(cfg, { fetch: deps.fetch || fetch, dispositivos: deps.dispositivos }, a.cliente, datos);
      return n ? ` Aviso enviado a su móvil.` : '';
    } catch (e) {
      console.error(e);
      return '';
    }
  };
  if (req.query.estado === 'avisos') {
    let aviso = '';
    if (req.method === 'POST') {
      const titulo = texto(req.body.titulo, 120);
      const cuerpo = texto(req.body.texto, 400);
      const url = String(req.body.url || '/').trim();
      try {
        if (!cfg.firebase) throw new Error('Falta FIREBASE_SERVICE_ACCOUNT en Vercel.');
        if (!titulo || !cuerpo) throw new Error('Pon un título y un texto.');
        if (!/^(\/|https:\/\/(www\.)?sidonia\.es\/)/.test(url)) throw new Error('El enlace tiene que ser de sidonia.es (o empezar por /).');
        await avisarTodos(cfg, { fetch: deps.fetch || fetch }, { titulo, texto: cuerpo, url, imagen: String(req.body.imagen || '').trim() });
        aviso = `Aviso enviado a todos los que tienen la app: «${titulo}».`;
      } catch (e) {
        console.error(e);
        aviso = `Error: ${e.message}`;
      }
    }
    return html(paginaAvisos(cfg, aviso));
  }
  if (req.query.estado === 'propietarios') {
    let informe = null;
    let aviso = '';
    if (req.method === 'POST' && req.body.accion === 'propietarios') {
      try {
        if (!cfg.shopifyTienda || !cfg.shopifyClientId) throw new Error('Faltan SHOPIFY_TIENDA y SHOPIFY_CLIENT_ID en Vercel.');
        informe = await rellenarPropietarios(deps.gql || shopifyAdmin(cfg, deps.fetch), { sobrescribir: req.body.sobrescribir === '1' });
        aviso = `Listo: ${informe.filter((r) => r.estado === 'nuevo').length} propietarios puestos.`;
      } catch (e) {
        console.error(e);
        aviso = `Error: ${e.message}`;
      }
    }
    return html(paginaPanel(cfg, informe, { estado: 'propietarios', aviso }));
  }
  if (req.query.estado === 'ubicaciones') {
    let informe = null;
    let aviso = '';
    if (req.method === 'POST' && req.body.accion === 'ubicaciones') {
      try {
        if (!cfg.shopifyTienda || !cfg.shopifyClientId) throw new Error('Faltan SHOPIFY_TIENDA y SHOPIFY_CLIENT_ID en Vercel.');
        informe = await rellenarUbicaciones(deps.gql || shopifyAdmin(cfg, deps.fetch), { sobrescribir: req.body.sobrescribir === '1', etiqueta: req.body.etiqueta === '1' });
        aviso = `Listo: ${informe.filter((r) => r.estado === 'nuevo').length} ubicaciones puestas.`;
      } catch (e) {
        console.error(e);
        aviso = `Error: ${e.message}`;
      }
    }
    return html(paginaPanel(cfg, informe, { estado: 'ubicaciones', aviso }));
  }
  if (req.query.estado === 'cambios') {
    const tabla = deps.tabla || tablaAnuncios(cfg, deps.fetch);
    let aviso = '';
    if (req.method === 'POST') {
      try {
        const [a] = await tabla.leer(`id=eq.${Number(req.body.id)}`);
        if (!a || !a.revision) throw new Error('Ese anuncio ya no tiene cambios por revisar.');
        const avisar = req.body.avisar === '1';
        if (req.body.accion === 'aplicar') {
          const nuevo = { ...a, ...a.revision };
          let url = '';
          // Primero la ficha de Shopify: si falla, los cambios siguen por revisar
          if (a.estado === 'publicado' && a.producto) {
            url = (await actualizarEnShopify(cfg, nuevo, JSON.stringify(a.fotos) !== JSON.stringify(nuevo.fotos), deps.gql || shopifyAdmin(cfg, deps.fetch))).url;
          }
          await tabla.cambiar(a.id, { ...a.revision, revision: null, revision_fecha: null, actualizado: new Date().toISOString() });
          aviso = `Cambios aprobados en el anuncio #${a.id}${url ? ' y actualizada su ficha en la tienda' : ''}.` + await correoAlDueno(nuevo, avisar, correoCambiosAprobados(cfg, nuevo, url)) + (avisar ? await avisoMovil(nuevo, avisoCambios(nuevo, url)) : '');
        } else if (req.body.accion === 'descartar') {
          await tabla.cambiar(a.id, { revision: null, revision_fecha: null });
          aviso = `No aprobados los cambios del anuncio #${a.id}: sigue como estaba.` + await correoAlDueno(a, avisar, correoCambiosRechazados(cfg, a, texto(req.body.nota, 1500)));
        }
      } catch (e) {
        console.error(e);
        aviso = `Error: ${e.message}`;
      }
    }
    let lista = [];
    try { lista = await tabla.leer('revision=not.is.null&order=revision_fecha.desc'); } catch (e) { aviso = aviso || `Error: ${e.message}`; }
    return html(paginaPanel(cfg, lista, { estado: 'cambios', aviso }));
  }
  let aviso = '';
  let estado = ESTADOS[req.query.estado] || req.query.estado === 'cancelados' ? req.query.estado : 'pendiente';
  if (req.method === 'POST') {
    const id = Number(req.body.id);
    const accion = String(req.body.accion || '');
    const a = id ? await db('sidonia_anuncio_uno', { p_id: id }) : null;
    try {
      if (!a) throw new Error('No encuentro ese anuncio.');
      const correo = (c) => correoAlDueno(a, req.body.avisar === '1', c);
      const movil = async (x, datos) => (req.body.avisar === '1' ? avisoMovil(x, datos) : '');
      if (accion === 'guardar') {
        const cambios = leerEdicion(req.body, a);
        if (cambios.error) throw new Error(cambios.error);
        await (deps.guardar || guardarAnuncio)(cfg, id, cambios);
        aviso = `Guardados los cambios del anuncio #${id}.`;
      } else if (accion === 'publicar') {
        const p = await publicarEnShopify(cfg, a, deps.gql || shopifyAdmin(cfg));
        await db('sidonia_anuncio_estado', { p_id: id, p_estado: 'publicado', p_nota: '', p_producto: p.handle });
        aviso = `Publicado: ${p.url}.` + await altaComunidad(cfg, deps, a) + await correo(correoPublicado(cfg, a, p.url)) + await movil(a, avisoPublicado(a, p.url));
        estado = 'publicado';
      } else if (accion === 'mejoras') {
        // En vez de rechazar: recomendaciones al dueño (sigue por revisar)
        const m = leerMejoras(req.body);
        if (!m) throw new Error('Marca al menos una recomendación o escribe algo.');
        const mejoras = { ...m, pedido: new Date().toISOString(), editado: null };
        await (deps.guardar || guardarAnuncio)(cfg, id, { mejoras });
        aviso = `Recomendaciones enviadas a ${a.vendedor_nombre || 'su dueño'} (${listaMejoras(mejoras).length}).` + await correoAlDueno(a, true, correoMejoras(cfg, a, mejoras)) + await avisoMovil(a, avisoMejoras(a));
      } else if (accion === 'rechazar') {
        const motivo = texto(req.body.nota, 1500);
        await db('sidonia_anuncio_estado', { p_id: id, p_estado: 'rechazado', p_nota: motivo, p_producto: null });
        aviso = `Rechazado el anuncio #${id}.` + await correo(correoRechazado(cfg, a, motivo)) + await movil(a, avisoRechazado(a));
      } else if (SITUACIONES.includes(accion) && a.estado === 'publicado' && a.producto) {
        await marcarSituacion(cfg, a, accion, { ...deps, db });
        aviso = `Anuncio #${id}: ${accion === 'vendido' ? 'vendido' : accion === 'reservado' ? 'reservado' : 'otra vez en venta'} (también en la ficha de la tienda).`;
        if (accion === 'vendido' && await cancelarRenovacion(cfg, deps, id)) aviso += ' Cancelada su renovación: no se le volverá a cobrar.';
        if (accion === 'vendido') estado = 'vendido';
      } else if (accion === 'retirar') {
        await db('sidonia_anuncio_estado', { p_id: id, p_estado: 'retirado', p_nota: '', p_producto: null });
        aviso = `Retirado el anuncio #${id}. Recuerda archivar el producto en Shopify.`;
        if (await cancelarRenovacion(cfg, deps, id)) aviso += ' Cancelada su renovación: no se le volverá a cobrar.';
      }
    } catch (e) {
      console.error(e);
      aviso = `Error: ${e.message}`;
    }
  }
  // Cancelados: los rechazados y los retirados juntos
  const lista = estado === 'cancelados'
    ? [...(await db('sidonia_anuncios_lista', { p_estado: 'rechazado' }) || []), ...(await db('sidonia_anuncios_lista', { p_estado: 'retirado' }) || [])]
      .sort((a, b) => String(b.actualizado || b.creado).localeCompare(String(a.actualizado || a.creado)))
    : await db('sidonia_anuncios_lista', { p_estado: estado });
  return html(paginaPanel(cfg, lista || [], { estado, aviso }));
}
