/* SIDONIA · Motor de Sidonia (anuncios, ofertas y pujas): la parte de servidor (sin dependencias).
 *
 * La web llama a sidonia.es/apps/sidonia/… y Shopify (proxy de la app) reenvía la petición aquí añadiendo quién es
 * el cliente (logged_in_customer_id) y una firma. Comprobamos la firma con el secreto de la app, así nadie puede pujar
 * en nombre de otro. Las pujas se resuelven en la base de datos (sql/esquema.sql), de una en una.
 *
 * Rutas (detrás de /apps/sidonia):
 *   GET  api/estado?h=a,b        → { ahora, subastas: [...] }
 *   POST api/pujar     { handle, importe, tipo, intento } (la primera puja de cada uno: la invitación al evento, invitaciones.mjs)
 *   POST api/comentar  { handle, texto, respuesta_a }
 *   POST api/seguir    { handle, on }
 *   POST api/sincronizar { datos, firma } → crea o pone al día la subasta con lo que pone en Shopify (ver abajo)
 *   GET  registro?return_url=    → página del registro (nombre de usuario y condiciones), dentro del tema
 *   POST registro                → guarda el nombre y lleva a Stripe a guardar la tarjeta
 *   GET  registro/vuelta?session_id=&return_url= → marca la tarjeta como guardada y vuelve a la ficha
 *   api/anuncio…                 → anuncios de dueños, gratis (ver circulo.mjs)
 *   POST api/push/registrar { token, plataforma } → el móvil de la app, para los avisos (ver avisos.mjs)
 *   api/alertas…                 → alertas de búsqueda «Avísame cuando entre uno así» (ver alertas.mjs)
 *   POST api/evento { tipo, … }  → estadísticas de la web: visitas, fichas vistas, contactos, me gusta… (estadisticas.mjs)
 *   POST api/oferta              → «Hacer una oferta»: al dueño o al equipo, y el resumen al comprador (ofertas.mjs)
 *   gestion?a=&f=                → «¿Lo vendemos nosotros?»: de anuncio de la comunidad a gestión de venta (gestion.mjs)
 *   pagar?a=&f=                  → pagar un anuncio de la comunidad con Stripe, renovación cada mes (comunidad.mjs)
 *   (directo) api/preventa/…, preventa/vuelta|cancelar → reservas sin cobro de la SIDONIA RD10 (preventa.mjs)
 */
import { contactarAlquiler, peticionesPublicas, recibirAlquiler } from './alquiler.mjs';
import { rutasGaraje } from './garaje.mjs';
import { rutasOpiniones } from './opiniones.mjs';
import { rutasLikes } from './likes.mjs';
import { revisarReservas, rutasPagoReserva, rutasReservas } from './reservas.mjs';
import { rutasCobros } from './cobros.mjs';
import { rutasChat } from './chat.mjs';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { rutasTienda, tablaAnuncios } from './circulo.mjs';
import { cuentaFirebase, registrarDispositivo } from './avisos.mjs';
import { revisarAlertas, rutasAlertas } from './alertas.mjs';
import { registrarEvento } from './estadisticas.mjs';
import { revisarComunidad, rutasPago } from './comunidad.mjs';
import { ofrecerGestion, rutasGestion } from './gestion.mjs';
import { recibirOferta } from './ofertas.mjs';
import { recibirVenta } from './venta.mjs';
import { fotoLugar } from './lugares.mjs';
import { guardarInvitacion, invitarSiToca, leerInvitacion } from './invitaciones.mjs';
import { rutasPreventa } from './preventa.mjs';
import { condicionesSubasta, paginaDocumento } from './contratos.mjs';

export const VERSION = '2026-11-13-mayusculas';

export function config(env = process.env) {
  return {
    secreto: env.SHOPIFY_APP_SECRET || '',          // secreto de la app de Shopify (firma del proxy)
    supabaseUrl: (env.SUPABASE_URL || '').replace(/\/$/, ''),
    supabaseKey: env.SUPABASE_SERVICE_KEY || '',     // clave de servicio (solo en el servidor)
    stripeKey: env.STRIPE_SECRET_KEY || '',
    // Alquiler: gratis, como los anuncios de la comunidad. Si algún día se cobra a través de Sidonia: ALQUILER_COBRAR=1
    // (con STRIPE_SECRET_KEY) y ALQUILER_COMISION (% de tarifa de servicio). Por defecto, ni cobro ni comisión.
    alquilerCobrar: env.ALQUILER_COBRAR === '1' && Boolean(env.STRIPE_SECRET_KEY),
    alquilerComision: Math.max(0, Math.min(50, Number(env.ALQUILER_COMISION ?? 0) || 0)),
    // La comisión va más IVA (ALQUILER_IVA, por defecto el 21 %)
    alquilerIva: Math.max(0, Math.min(30, Number(env.ALQUILER_IVA ?? 21))),
    // Los datos de Sidonia en las condiciones y los contratos del alquiler (no son secretos)
    razonSocial: env.SIDONIA_RAZON_SOCIAL || '', nif: env.SIDONIA_NIF || '', domicilio: env.SIDONIA_DOMICILIO || '', emailLegal: env.SIDONIA_EMAIL_LEGAL || '',
    stripeWebhook: env.STRIPE_WEBHOOK_SECRET || '',  // firma de los avisos de Stripe (pagos de los anuncios: api/stripe.js)
    // Este servidor (para los enlaces de pago): Vercel lo da solo; SERVIDOR_URL si se quiere otro
    servidor: (env.SERVIDOR_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '')).replace(/\/$/, ''),
    clave: env.SUBASTAS_CLAVE || '',                 // la misma que «Clave del motor» en los ajustes del tema
    tienda: (env.TIENDA_URL || 'https://sidonia.es').replace(/\/$/, ''),
    prefijo: env.PROXY_PREFIJO || '/apps/sidonia',
    shopifyTienda: (env.SHOPIFY_TIENDA || '').replace(/^https?:\/\//, '').replace(/\/$/, ''),   // xxxx.myshopify.com
    shopifyClientId: env.SHOPIFY_CLIENT_ID || '',    // ID de cliente de la app (para publicar fichas «Del dueño»)
    adminClave: env.ADMIN_CLAVE || '',               // contraseña del panel /admin
    adminPin: /^\d{4,8}$/.test(String(env.ADMIN_PIN || '').trim()) ? String(env.ADMIN_PIN).trim() : '',   // código corto para entrar al panel
    // Avisos por email al equipo (opcional, con Resend; las mismas claves que el servidor de ofertas)
    resendKey: env.RESEND_API_KEY || '',
    avisosEquipo: String(env.AVISOS_EQUIPO || env.OFERTAS_EQUIPO || '').split(',').map((x) => x.trim()).filter(Boolean),
    avisosRemitente: env.AVISOS_REMITENTE || env.OFERTAS_REMITENTE || 'Sidonia <avisos@sidonia.es>',
    avisosClientes: env.AVISOS_CLIENTES === '1',     // también un email cuando alguien entra por primera vez
    firebase: cuentaFirebase(env.FIREBASE_SERVICE_ACCOUNT),  // avisos al móvil de la app (lib/avisos.mjs)
    cronSecreto: env.CRON_SECRET || '',                      // el repaso diario de las alertas (lo manda el cron de Vercel)
    googleMapsKey: env.GOOGLE_MAPS_KEY || ''                 // fotos de Google Maps de talleres y eventos (lib/lugares.mjs)
  };
}

/* ---------------------------------------------------------------------------- Firma del proxy de Shopify */
// Shopify ordena los parámetros, une cada uno como «clave=valor» (listas con comas), lo junta todo sin separador y
// firma con HMAC-SHA256 (hexadecimal) usando el secreto de la app.
export function firmaProxy(query, secreto) {
  const texto = Object.keys(query)
    .filter((k) => k !== 'signature')
    .sort()
    .map((k) => `${k}=${Array.isArray(query[k]) ? query[k].join(',') : query[k]}`)
    .join('');
  return createHmac('sha256', secreto).update(texto).digest('hex');
}

export function comprobarProxy(query, secreto, ahora = Date.now()) {
  if (!secreto || !query.signature) return false;
  const a = Buffer.from(firmaProxy(query, secreto), 'hex');
  const b = Buffer.from(String(query.signature).replace(/[^0-9a-f]/gi, ''), 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const ts = Number(query.timestamp);
  return !ts || Math.abs(ahora / 1000 - ts) < 3600;   // firmas de hace más de una hora, fuera
}

/* ---------------------------------------------------------------------------- Subastas creadas desde Shopify */
// La ficha de una subasta (plantilla «subasta», metacampos subasta.*) lleva estos datos firmados por el tema con la
// «Clave del motor» (hmac_sha256 en Liquid, en el servidor de Shopify: la clave nunca llega al navegador):
//   v1|handle|t|inicio|fin|salida|reserva_cifrada|título      (t, inicio y fin en segundos)
// La reserva es secreta, así que va sumada a un número que solo conocen el tema y el motor: las cifras de
// hmac(clave, «handle|reserva|t»), las 9 primeras. t es cuándo se pintó la página: una versión más vieja no pisa
// a una más nueva (pestañas abiertas desde hace días, por ejemplo).
const mascara = (clave, handle, t) => Number(createHmac('sha256', clave).update(`${handle}|reserva|${t}`).digest('hex').replace(/[a-f]/g, '').slice(0, 9)) || 0;

export function firmarDatos(d, clave) {
  const datos = ['v1', d.handle, d.t, d.inicio, d.fin, d.salida, (d.reserva || 0) + mascara(clave, d.handle, d.t), d.titulo || ''].join('|');
  return { datos, firma: createHmac('sha256', clave).update(datos).digest('hex') };
}

export function leerDatos(datos, firma, clave, ahora = Date.now()) {
  if (!clave || typeof datos !== 'string' || typeof firma !== 'string') return null;
  const a = createHmac('sha256', clave).update(datos).digest();
  const b = Buffer.from(firma.replace(/[^0-9a-f]/gi, ''), 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [v, handle, t, inicio, fin, salida, resC, ...titulo] = datos.split('|');
  const n = (x) => (/^\d+$/.test(x || '') ? Number(x) : NaN);
  const d = { handle, t: n(t), inicio: n(inicio), fin: n(fin), salida: n(salida), titulo: titulo.join('|') };
  if (v !== 'v1' || !handle || ![d.t, d.inicio, d.fin, d.salida, n(resC)].every(Number.isFinite)) return null;
  if (d.t > ahora / 1000 + 600 || d.salida <= 0 || d.fin <= d.inicio) return null;
  const reserva = n(resC) - mascara(clave, handle, d.t);
  d.reserva = reserva > 0 ? reserva : null;
  return d;
}

/**
 * Cliente firmado por el tema: con las cuentas de cliente nuevas, Shopify no siempre pasa logged_in_customer_id por el
 * proxy. El tema (Liquid, en el servidor de Shopify) firma «<id>.<t>» con la clave del motor (SUBASTAS_CLAVE) y lo manda
 * como ?c=<id>&ct=<t>&cf=<firma>. Vale 7 días. Devuelve el id o null.
 */
export function clienteFirmado(q, clave, ahora = Date.now()) {
  const c = String(q.c || ''), t = String(q.ct || ''), f = String(q.cf || '');
  if (!clave || !/^\d{1,20}$/.test(c) || !/^\d{9,11}$/.test(t) || !/^[0-9a-f]{64}$/i.test(f)) return null;
  const a = createHmac('sha256', clave).update(`${c}.${t}`).digest();
  const b = Buffer.from(f, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const edad = ahora / 1000 - Number(t);
  return edad > -600 && edad < 7 * 86400 ? c : null;
}

/* ---------------------------------------------------------------------------- Base de datos (Supabase) */
export function supabase(cfg, fetchImpl = fetch) {
  return async (fn, args) => {
    const r = await fetchImpl(`${cfg.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      // Claves nuevas (sb_secret_…): solo en «apikey». Claves antiguas (service_role, un JWT): también como Bearer.
      headers: {
        apikey: cfg.supabaseKey,
        ...(cfg.supabaseKey.startsWith('sb_') ? {} : { Authorization: `Bearer ${cfg.supabaseKey}` }),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(8000)   // si Supabase no responde, mejor un error claro en segundos que la tienda esperando
    });
    if (!r.ok) throw new Error(`Supabase ${fn} ${r.status}: ${await r.text().catch(() => '')}`);
    return r.json();
  };
}

/* ---------------------------------------------------------------------------- Stripe (tarjeta guardada) */
export function stripe(cfg, fetchImpl = fetch) {
  const form = (o, pre = '') => Object.entries(o).flatMap(([k, v]) => {
    const key = pre ? `${pre}[${k}]` : k;
    return v && typeof v === 'object' ? form(v, key) : [[key, String(v)]];
  });
  return async (method, path, body) => {
    const r = await fetchImpl(`https://api.stripe.com/v1/${path}`, {
      method,
      headers: { Authorization: `Bearer ${cfg.stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body ? new URLSearchParams(form(body)).toString() : undefined
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Stripe ${path} ${r.status}: ${data.error?.message || ''}`);
    return data;
  };
}

/* ---------------------------------------------------------------------------- Rutas */
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (status, body) => ({ status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
const liquid = (body) => ({ status: 200, headers: { 'Content-Type': 'application/liquid' }, body });   // Shopify lo pinta dentro del tema
const redirect = (url) => ({ status: 302, headers: { Location: url, 'Cache-Control': 'no-store' }, body: '' });
const local = (u, def = '/') => (typeof u === 'string' && u.startsWith('/') && !u.startsWith('//') ? u : def);

function paginaRegistro({ error = '', alias = '', volver = '/', accion, condiciones = '' }) {
  const msg = { alias: 'El nombre de usuario debe tener al menos 3 letras o números.', alias_ocupado: 'Ese nombre ya lo usa otra persona. Prueba con otro.', condiciones: 'Acepta las condiciones para seguir.' }[error] || '';
  return `<div class="page-width" style="max-width:560px;margin:3rem auto;padding:0 1.25rem;font-family:inherit">
  <p style="font-size:.75rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;opacity:.55;margin:0">Subastas Sidonia</p>
  <h1 style="margin:.3rem 0 1rem">Regístrate para pujar</h1>
  <p style="opacity:.8;line-height:1.55">Elige tu nombre de usuario (es el que verán los demás en las pujas y los comentarios) y guarda una tarjeta con Stripe. Sidonia nunca ve el número de tu tarjeta: solo cobramos la comisión si ganas.</p>
  ${msg ? `<p role="alert" style="padding:.7rem .9rem;border-radius:10px;background:#fde8ea;color:#a2121f">${msg}</p>` : ''}
  <form method="post" action="${esc(accion)}" style="display:grid;gap:1rem;margin-top:1.25rem">
    <input type="hidden" name="return_url" value="${esc(volver)}">
    <label style="display:grid;gap:.35rem;font-weight:600">Nombre de usuario
      <input name="alias" value="${esc(alias)}" required minlength="3" maxlength="24" pattern="[A-Za-z0-9_.\\-áéíóúñÁÉÍÓÚÑ]+" style="min-height:3rem;padding:0 .9rem;border:1px solid #bbb;border-radius:12px;font:inherit">
    </label>
    <label style="display:flex;gap:.6rem;align-items:flex-start;font-size:.875rem;line-height:1.45">
      <input type="checkbox" name="condiciones" value="1" required style="margin-top:.2rem">
      <span>Acepto las ${condiciones ? `<a href="${esc(condiciones)}" target="_blank" rel="noopener" style="color:inherit">condiciones de las subastas</a>` : 'condiciones de las subastas'}: cada puja es un compromiso de compra si gano, pago el coche al vendedor en 7 días hábiles y la comisión indicada en la ficha a Sidonia.</span>
    </label>
    <button type="submit" style="min-height:3.3rem;border-radius:999px;background:#111;color:#fff;font-weight:700;font-size:1rem;border:0">Continuar y guardar mi tarjeta</button>
  </form>
</div>`;
}

/** Qué ha fallado, en una palabra que se puede enseñar (sin datos secretos): para el mensaje del formulario */
export function codigoError(e) {
  const m = String((e && e.message) || e);
  if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) return 'base-lenta';
  if (/sidonia_anuncio|relation "anuncios"|anuncios_/.test(m)) return 'anuncios-sql';
  if (/Storage|bucket/i.test(m)) return 'anuncios-fotos';
  if (/Supabase/.test(m)) return 'base-de-datos';
  return 'motor';
}

/** El cubo de fotos de los anuncios existe (Supabase Storage) */
async function cuboFotos(cfg, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(`${cfg.supabaseUrl}/storage/v1/bucket/anuncios`, {
      headers: { apikey: cfg.supabaseKey, ...(cfg.supabaseKey.startsWith('sb_') ? {} : { Authorization: `Bearer ${cfg.supabaseKey}` }) }
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

async function paginaConexion(query, cfg, { db, fetch: fetchImpl = fetch }) {
  const firma = comprobarProxy(query, cfg.secreto);
  let base = false;
  let anuncios = false;
  let fotos = false;
  if (firma) {
    try { base = Array.isArray((await db('sidonia_estado', { p_handles: [] }))?.subastas); } catch (e) { console.error(e); }
    try { anuncios = Array.isArray(await db('sidonia_anuncios_lista', { p_estado: 'ninguno' })); } catch (e) { console.error(e); }
    fotos = await cuboFotos(cfg, fetchImpl);
  }
  // Las columnas que necesitan el alquiler y la RD10 (si falta alguna, ese SQL no se ha ejecutado)
  const COLUMNAS = [
    ['perfiles', 'cliente,alq_legal,stripe_cuenta,cobros_ok', 'Alquiler: datos y cobros del dueño', 'sql/reservas.sql'],
    ['garaje', 'id,alq,bloqueos,alq_hasta', 'Alquiler: precio y calendario de cada coche', 'sql/reservas.sql'],
    ['gestiones', 'id,estado,datos,nota', 'Gestiones de venta en el panel', 'sql/gestiones.sql'],
    ['reservas', 'id,datos,contrato,firma_cliente,stripe_pi,tramos,horas,a_cuenta,resto,resto_pi,resto_pagado', 'Alquiler: reservas por horas y pago en dos partes', 'sql/reservas.sql'],
    ['chats', 'id', 'Chat de Sidonia', 'sql/chat.sql']
  ];
  const columnas = [];
  if (firma && cfg.supabaseUrl && cfg.supabaseKey) {
    for (const [t, cols, que, sql] of COLUMNAS) {
      let ok = false;
      try { await tablaAnuncios(cfg, fetchImpl, t).leer(`select=${cols}&limit=1`); ok = true; } catch (e) { console.error(t, e.message); }
      columnas.push({ ok, que, sql });
    }
  }
  const panel = Boolean(cfg.adminClave);
  const shopify = Boolean(cfg.shopifyTienda && cfg.shopifyClientId);
  const fila = (ok, si, no) => `<li style="margin:.5rem 0">${ok ? '✅' : '❌'} ${ok ? si : no}</li>`;
  const todo = firma && base && anuncios && fotos && columnas.every((c) => c.ok);
  return liquid(`<div class="page-width" style="max-width:600px;margin:3rem auto;padding:0 1.25rem">
  <p style="font-size:.75rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;opacity:.55;margin:0">Motor de Sidonia · ${VERSION}</p>
  <h1 style="margin:.3rem 0 1rem">${todo ? 'Todo conectado' : 'Al motor le falta algo'}</h1>
  <ul style="list-style:none;padding:0;line-height:1.5">
    ${fila(true, 'La tienda llega al motor (proxy de la app)', '')}
    ${fila(firma, 'La firma de Shopify es correcta (SHOPIFY_APP_SECRET)', 'La firma no cuadra: revisa SHOPIFY_APP_SECRET en Vercel y vuelve a desplegar')}
    ${firma ? fila(base, 'La base de datos responde (Supabase)', 'Supabase no responde: revisa SUPABASE_URL y SUPABASE_SERVICE_KEY') : ''}
    ${firma ? fila(anuncios, 'Anuncios gratis: la tabla está creada', 'Anuncios gratis: falta ejecutar sql/circulo.sql en Supabase › SQL Editor') : ''}
    ${firma ? fila(fotos, 'Anuncios gratis: el cubo de fotos está creado', 'Anuncios gratis: falta el cubo de fotos «anuncios» (se crea con sql/circulo.sql)') : ''}
    ${columnas.map((c) => fila(c.ok, `${c.que}: la base de datos está al día`, `${c.que}: falta ejecutar ${c.sql} en Supabase › SQL Editor (entero; se puede repetir sin problema)`)).join('')}
    ${fila(panel, 'Panel para revisar anuncios: tiene contraseña (ADMIN_CLAVE)', 'Panel para revisar anuncios: falta ADMIN_CLAVE en Vercel')}
    ${fila(Boolean(cfg.googleMapsKey), 'Fotos de Google Maps de talleres y eventos: configurado', 'Fotos de Google Maps de talleres y eventos: falta GOOGLE_MAPS_KEY en Vercel (opcional)')}
    ${fila(shopify, 'Publicar en Shopify desde el panel: configurado', 'Publicar en Shopify desde el panel: faltan SHOPIFY_TIENDA y SHOPIFY_CLIENT_ID en Vercel')}
    ${fila(Boolean(query.logged_in_customer_id), 'Has iniciado sesión', 'No has iniciado sesión (para anunciar o pujar hará falta)')}
  </ul>
</div>`);
}

/**
 * Atiende una petición ya recibida. req: { method, ruta, query, body }. Devuelve { status, headers, body }.
 * deps: { db(fn, args), stripe(method, path, body) } para poder probarlo sin servicios reales.
 */
export async function atender(req, cfg, deps) {
  // Página de comprobación: sidonia.es/apps/sidonia/conexion (no enseña nada secreto)
  if (String(req.ruta || '').replace(/^\/+|\/+$/g, '') === 'conexion') return paginaConexion(req.query, cfg, deps);
  const ruta = String(req.ruta || '').replace(/^\/+|\/+$/g, '');
  // Directo (sin el proxy de Shopify, /tienda/…): solo los anuncios de dueños, y quien es lo dice la firma del tema
  if (req.directo) {
    // Pagar un anuncio de la comunidad (enlace firmado, sin sesión): la página y la vuelta de Stripe
    if (ruta === 'pagar' || ruta === 'pagar/ok') return rutasPago({ ruta, method: req.method, query: req.query || {}, body: req.body || {} }, cfg, deps);
    // «¿Lo vendemos nosotros?» (enlace firmado del email, sin sesión): gestion.mjs
    // Pagar una reserva de alquiler (enlace firmado): a Stripe y la vuelta (reservas.mjs)
    if (/^alquiler\/(pagar|pagado|pagar-resto|resto-pagado|contrato|contrato-modelo|condiciones)$/.test(ruta)) return rutasPagoReserva({ ruta, query: req.query || {} }, cfg, deps);
    // Las condiciones de las subastas (las que se aceptan al registrarse para pujar)
    if (ruta === 'subastas/condiciones') return { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=600' }, body: paginaDocumento('Condiciones de las subastas', condicionesSubasta(cfg)) };
    // Fotos de Google Maps de los talleres y los eventos (lugares.mjs)
    if (ruta === 'foto') return fotoLugar(req.query || {}, cfg, deps);
    if (ruta === 'gestion') return rutasGestion({ method: req.method, query: req.query || {}, body: req.body || {} }, cfg, deps);
    // Reservas sin cobro (la SIDONIA RD10): el formulario, la vuelta de Stripe, cancelar y el contador (preventa.mjs)
    if (/^(api\/)?preventa\//.test(ruta)) return (await rutasPreventa({ ruta, method: req.method, query: req.query || {}, body: req.body || {} }, cfg, deps)) || json(404, { ok: false, error: 'ruta' });
    if (!/^api\/(anuncio|anuncios|visita|perfil|push|alertas|evento|comunidad|oferta|alquiler|garaje|opiniones|likes|chat|venta)(\/|$)/.test(ruta)) return json(404, { ok: false, error: 'ruta' });
  } else if (!comprobarProxy(req.query, cfg.secreto)) return json(401, { ok: false, error: 'firma' });
  const cliente = !req.directo && req.query.logged_in_customer_id ? String(req.query.logged_in_customer_id) : clienteFirmado(req.query, cfg.clave);
  // El tema mandó quién es, pero la firma no cuadra: la «Clave del motor» del tema no es la SUBASTAS_CLAVE de Vercel
  if (!cliente && req.query.cf) return json(200, { ok: false, error: 'clave', detalle: 'clave-del-motor' });
  const body = req.body || {};
  const { db } = deps;

  if (ruta === 'api/estado' && req.method === 'GET') {
    const handles = String(req.query.h || '').split(',').map((h) => h.trim()).filter(Boolean).slice(0, 60);
    return json(200, await db('sidonia_estado', { p_handles: handles, p_cliente: cliente }));
  }

  if (ruta === 'api/sincronizar' && req.method === 'POST') {
    const d = leerDatos(body.datos, body.firma, cfg.clave);
    if (!d) return json(400, { ok: false, error: 'datos' });
    // La invitación al evento para quien puja (si la ficha la tiene): lib/invitaciones.mjs
    const inv = body.invitacion ? leerInvitacion(d.handle, body.invitacion, body.invitacion_firma, cfg.clave) : null;
    if (inv) await guardarInvitacion(cfg, deps, d.handle, inv, d.titulo).catch((e) => console.error('Sidonia · invitación', e));
    return json(200, await db('sidonia_sincronizar', {
      p_handle: d.handle, p_titulo: d.titulo, p_inicio: new Date(d.inicio * 1000).toISOString(), p_fin: new Date(d.fin * 1000).toISOString(),
      p_salida: d.salida, p_reserva: d.reserva, p_version: d.t, p_cliente: cliente
    }));
  }

  // App: guardar el móvil para mandarle avisos (con o sin sesión)
  if (ruta === 'api/push/registrar' && req.method === 'POST') {
    return json(200, await registrarDispositivo(cfg, { fetch: deps.fetch || fetch, dispositivos: deps.dispositivos }, body, cliente));
  }

  // Estadísticas: lo que pasa en la web (con o sin sesión; nunca falla hacia la web)
  if (ruta === 'api/evento' && req.method === 'POST') {
    try {
      return json(200, await registrarEvento(db, body, cliente, req.headers || {}));
    } catch (e) {
      console.error(e);
      return json(200, { ok: false });
    }
  }

  // Alertas de búsqueda: el repaso diario (solo el cron de Vercel, con CRON_SECRET) y las del cliente
  if (ruta === 'api/alertas/revisar') {
    const auth = String((req.headers || {}).authorization || '');
    if (!cfg.cronSecreto || auth !== `Bearer ${cfg.cronSecreto}`) return json(401, { ok: false, error: 'cron' });
    return json(200, { ok: true, ...(await revisarAlertas(cfg, { fetch: deps.fetch || fetch, gql: deps.gql, alertas: deps.alertas, dispositivos: deps.dispositivos })) });
  }
  // «Hacer una oferta»: al dueño (comunidad) o al equipo (Sidonia), y el resumen al comprador (ofertas.mjs)
  // «Te ayudamos a venderlo»: la solicitud de gestión de venta con fotos (venta.mjs)
  if (ruta === 'api/venta' && req.method === 'POST') return json(200, await recibirVenta(body, cliente, cfg, deps));
  if (ruta === 'api/oferta' && req.method === 'POST') return json(200, await recibirOferta(body, cliente, cfg, deps));
  // Alquiler (próximamente): la lista de espera de «Alquila un coche con alma» (alquiler.mjs)
  if (ruta === 'api/alquiler' && req.method === 'POST') return json(200, await recibirAlquiler(body, cliente, cfg, deps));
  // Alquiler como Airbnb: buscar, ficha, reservar, reservas, mensajes y reseñas (reservas.mjs)
  if (ruta === 'api/alquiler/revisar') {
    const auth = String((req.headers || {}).authorization || '');
    if (!cfg.cronSecreto || auth !== `Bearer ${cfg.cronSecreto}`) return json(401, { ok: false, error: 'cron' });
    return json(200, { ok: true, ...(await revisarReservas(cfg, deps)) });
  }
  if (ruta.startsWith('api/alquiler/')) {
    const h = req.headers || {};
    const quien = { ip: String(h['x-forwarded-for'] || h['x-real-ip'] || '').split(',')[0].trim(), ua: String(h['user-agent'] || '') };
    const datosPeticion = { ruta, method: req.method, body: req.method === 'GET' ? { ...req.query } : body, ...quien };
    const r = (await rutasCobros(datosPeticion, cliente, cfg, deps)) || (await rutasReservas(datosPeticion, cliente, cfg, deps));
    if (r) return r;
  }
  // «Lo que busca la gente» (sin datos personales) y «Tengo uno así» / «Me interesa alquilarlo» (con su sesión)
  if (ruta === 'api/alquiler/peticiones' && req.method === 'GET') {
    try { return { ...json(200, { ok: true, peticiones: await peticionesPublicas(cfg, deps) }), headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' } }; } catch (e) { return json(200, { ok: false, error: 'sin-tabla', peticiones: [] }); }
  }
  if (ruta === 'api/alquiler/contactar' && req.method === 'POST') return json(200, await contactarAlquiler(body, cliente, cfg, deps));

  // Comunidad: el repaso diario (recordar el pago a quien le caduca y, si se quiere, retirar los caducados)
  if (ruta === 'api/comunidad/revisar') {
    const auth = String((req.headers || {}).authorization || '');
    if (!cfg.cronSecreto || auth !== `Bearer ${cfg.cronSecreto}`) return json(401, { ok: false, error: 'cron' });
    const gestion = await ofrecerGestion(cfg, deps);
    return json(200, { ok: true, ...(await revisarComunidad(cfg, deps)), gestion });
  }
  if (ruta === 'api/alertas' || ruta === 'api/alertas/borrar') {
    const r = await rutasAlertas({ ruta, method: req.method, body }, cliente, cfg, { fetch: deps.fetch || fetch, alertas: deps.alertas });
    if (r) return json(200, r);
  }

  // Mi garaje: sus coches, los de la comunidad y los «me gusta» (garaje.mjs)
  if (ruta.startsWith('api/garaje')) {
    const r = await rutasGaraje({ ruta, method: req.method, body: req.method === 'GET' ? { ...req.query } : body }, cliente, cfg, deps);
    if (r) return r;
  }

  // Mensajes dentro de Sidonia: venta de la comunidad, alquiler y peticiones (chat.mjs)
  if (ruta.startsWith('api/chat')) {
    const r = await rutasChat({ ruta, method: req.method, body: req.method === 'GET' ? { ...req.query } : body }, cliente, cfg, deps);
    if (r) return r;
  }
  // «Me gusta» de profesionales y eventos (likes.mjs)
  if (ruta === 'api/likes') return rutasLikes({ ruta, method: req.method, body: req.method === 'GET' ? { ...req.query } : body }, cliente, cfg, deps);
  // Profesionales: las opiniones de la comunidad sobre cada taller (opiniones.mjs)
  if (ruta.startsWith('api/opiniones')) {
    const r = await rutasOpiniones({ ruta, method: req.method, body: req.method === 'GET' ? { ...req.query } : body }, cliente, cfg, deps);
    if (r) return r;
  }

  // Del dueño: anuncios gratis de particulares
  if (ruta === 'api/anuncio' || ruta === 'api/anuncios' || ruta === 'api/visita' || ruta.startsWith('api/anuncio/') || ruta === 'api/perfil' || ruta === 'api/perfil/publico') {
    const r = await rutasTienda({ ruta, method: req.method, body: req.method === 'GET' ? { ...req.query } : body }, cliente, cfg, deps);
    if (r) return r;
  }

  if (ruta.startsWith('api/') && req.method === 'POST') {
    if (!cliente) return json(200, { ok: false, error: 'login' });
    if (ruta === 'api/pujar') {
      const importe = Math.round(Number(body.importe));
      if (!body.handle || !(importe > 0)) return json(400, { ok: false, error: 'datos' });
      const tipo = body.tipo === 'maxima' ? 'maxima' : 'directa';
      const intento = body.intento ? String(body.intento).slice(0, 80) : null;
      const r = await db('sidonia_pujar', { p_handle: String(body.handle), p_cliente: cliente, p_importe: importe, p_tipo: tipo, p_intento: intento });
      // Ha pujado (aunque otra máxima la supere al momento): si la subasta invita a un evento, el email (una vez)
      if (r && !r.repetida && (r.ok || r.error === 'superado')) await invitarSiToca(cfg, deps, { handle: String(body.handle), cliente });
      return json(200, r);
    }
    if (ruta === 'api/comentar') {
      const texto = String(body.texto || '').trim();
      if (!body.handle || texto.length < 2) return json(400, { ok: false, error: 'datos' });
      const resp = Number(body.respuesta_a) || null;
      return json(200, await db('sidonia_comentar', { p_handle: String(body.handle), p_cliente: cliente, p_texto: texto.slice(0, 2000), p_respuesta_a: resp }));
    }
    if (ruta === 'api/seguir') {
      if (!body.handle) return json(400, { ok: false, error: 'datos' });
      return json(200, await db('sidonia_seguir', { p_handle: String(body.handle), p_cliente: cliente, p_on: Boolean(body.on) }));
    }
  }

  if (ruta === 'registro' || ruta === 'registro/vuelta') {
    const volver = local(req.query.return_url || body.return_url, '/');
    if (!cliente) return redirect(`/account/login?return_url=${encodeURIComponent(`${cfg.prefijo}/registro?return_url=${encodeURIComponent(volver)}`)}`);
    const accion = `${cfg.prefijo}/registro`;

    if (ruta === 'registro' && req.method === 'GET') {
      const yo = await db('sidonia_pujador', { p_cliente: cliente });
      if (yo && yo.registrado) return redirect(volver);
      return liquid(paginaRegistro({ alias: yo?.alias || '', volver, accion, condiciones: cfg.servidor ? `${cfg.servidor}/tienda/subastas/condiciones` : "" }));
    }

    if (ruta === 'registro' && req.method === 'POST') {
      if (!body.condiciones) return liquid(paginaRegistro({ error: 'condiciones', alias: body.alias, volver, accion, condiciones: cfg.servidor ? `${cfg.servidor}/tienda/subastas/condiciones` : "" }));
      const r = await db('sidonia_registrar', { p_cliente: cliente, p_alias: String(body.alias || ''), p_email: body.email || null });
      if (!r.ok) return liquid(paginaRegistro({ error: r.error, alias: body.alias, volver, accion, condiciones: cfg.servidor ? `${cfg.servidor}/tienda/subastas/condiciones` : "" }));
      // Tarjeta con Stripe Checkout en modo «setup»: se guarda la tarjeta sin cobrar nada
      let stripeCliente = r.pujador.stripe_cliente;
      if (!stripeCliente) {
        const c = await deps.stripe('POST', 'customers', { metadata: { shopify_cliente: cliente, alias: r.pujador.alias } });
        stripeCliente = c.id;
        await db('sidonia_stripe_cliente', { p_cliente: cliente, p_stripe: stripeCliente });
      }
      const vuelta = `${cfg.tienda}${cfg.prefijo}/registro/vuelta?return_url=${encodeURIComponent(volver)}&session_id={CHECKOUT_SESSION_ID}`;
      const s = await deps.stripe('POST', 'checkout/sessions', {
        mode: 'setup', customer: stripeCliente, currency: 'eur', locale: 'es',
        'payment_method_types[0]': 'card',
        success_url: vuelta, cancel_url: `${cfg.tienda}${cfg.prefijo}/registro?return_url=${encodeURIComponent(volver)}`,
        metadata: { shopify_cliente: cliente }
      });
      return redirect(s.url);
    }

    if (ruta === 'registro/vuelta') {
      const id = String(req.query.session_id || '');
      if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return redirect(`${accion}?return_url=${encodeURIComponent(volver)}`);
      const s = await deps.stripe('GET', `checkout/sessions/${id}?expand[]=setup_intent.payment_method`);
      if (s.metadata?.shopify_cliente !== cliente || s.status !== 'complete') return redirect(`${accion}?return_url=${encodeURIComponent(volver)}`);
      const card = s.setup_intent?.payment_method?.card;
      const marca = card ? `${card.brand.charAt(0).toUpperCase()}${card.brand.slice(1)} •••• ${card.last4}` : 'Tarjeta guardada';
      await db('sidonia_registro_ok', { p_cliente: cliente, p_tarjeta: marca, p_stripe: s.customer });
      return redirect(volver);
    }
  }

  return json(404, { ok: false, error: 'ruta' });
}
