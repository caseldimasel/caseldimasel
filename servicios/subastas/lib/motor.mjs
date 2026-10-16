/* SIDONIA · Motor de subastas: la parte de servidor (sin dependencias).
 *
 * La web llama a sidonia.es/apps/subastas/… y Shopify (proxy de la app) reenvía la petición aquí añadiendo quién es
 * el cliente (logged_in_customer_id) y una firma. Comprobamos la firma con el secreto de la app, así nadie puede pujar
 * en nombre de otro. Las pujas se resuelven en la base de datos (sql/esquema.sql), de una en una.
 *
 * Rutas (detrás de /apps/subastas):
 *   GET  api/estado?h=a,b        → { ahora, subastas: [...] }
 *   POST api/pujar     { handle, importe, tipo, intento }
 *   POST api/comentar  { handle, texto, respuesta_a }
 *   POST api/seguir    { handle, on }
 *   POST api/sincronizar { datos, firma } → crea o pone al día la subasta con lo que pone en Shopify (ver abajo)
 *   GET  registro?return_url=    → página del registro (nombre de usuario y condiciones), dentro del tema
 *   POST registro                → guarda el nombre y lleva a Stripe a guardar la tarjeta
 *   GET  registro/vuelta?session_id=&return_url= → marca la tarjeta como guardada y vuelve a la ficha
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export function config(env = process.env) {
  return {
    secreto: env.SHOPIFY_APP_SECRET || '',          // secreto de la app de Shopify (firma del proxy)
    supabaseUrl: (env.SUPABASE_URL || '').replace(/\/$/, ''),
    supabaseKey: env.SUPABASE_SERVICE_KEY || '',     // clave de servicio (solo en el servidor)
    stripeKey: env.STRIPE_SECRET_KEY || '',
    clave: env.SUBASTAS_CLAVE || '',                 // la misma que «Clave del motor» en los ajustes del tema
    tienda: (env.TIENDA_URL || 'https://sidonia.es').replace(/\/$/, ''),
    prefijo: env.PROXY_PREFIJO || '/apps/subastas'
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
      body: JSON.stringify(args)
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

function paginaRegistro({ error = '', alias = '', volver = '/', accion }) {
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
      <span>Acepto las condiciones de las subastas: cada puja es un compromiso de compra si gano, pago el coche al vendedor en 7 días hábiles y la comisión a Sidonia.</span>
    </label>
    <button type="submit" style="min-height:3.3rem;border-radius:999px;background:#111;color:#fff;font-weight:700;font-size:1rem;border:0">Continuar y guardar mi tarjeta</button>
  </form>
</div>`;
}

async function paginaConexion(query, cfg, { db }) {
  const firma = comprobarProxy(query, cfg.secreto);
  let base = false;
  if (firma) { try { base = Array.isArray((await db('sidonia_estado', { p_handles: [] }))?.subastas); } catch (e) { console.error(e); } }
  const fila = (ok, si, no) => `<li style="margin:.5rem 0">${ok ? '✅' : '❌'} ${ok ? si : no}</li>`;
  const todo = firma && base;
  return liquid(`<div class="page-width" style="max-width:560px;margin:3rem auto;padding:0 1.25rem">
  <p style="font-size:.75rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;opacity:.55;margin:0">Subastas Sidonia</p>
  <h1 style="margin:.3rem 0 1rem">${todo ? 'El motor de subastas está conectado' : 'Al motor le falta algo'}</h1>
  <ul style="list-style:none;padding:0;line-height:1.5">
    ${fila(true, 'La tienda llega al motor (proxy de la app)', '')}
    ${fila(firma, 'La firma de Shopify es correcta (SHOPIFY_APP_SECRET)', 'La firma no cuadra: revisa SHOPIFY_APP_SECRET en Vercel y vuelve a desplegar')}
    ${firma ? fila(base, 'La base de datos responde (Supabase)', 'Supabase no responde: revisa SUPABASE_URL y SUPABASE_SERVICE_KEY') : ''}
    ${fila(Boolean(query.logged_in_customer_id), 'Has iniciado sesión: tus pujas irán a tu nombre', 'No has iniciado sesión (para pujar hará falta)')}
  </ul>
</div>`);
}

/**
 * Atiende una petición ya recibida. req: { method, ruta, query, body }. Devuelve { status, headers, body }.
 * deps: { db(fn, args), stripe(method, path, body) } para poder probarlo sin servicios reales.
 */
export async function atender(req, cfg, deps) {
  // Página de comprobación: sidonia.es/apps/subastas/conexion (no enseña nada secreto)
  if (String(req.ruta || '').replace(/^\/+|\/+$/g, '') === 'conexion') return paginaConexion(req.query, cfg, deps);
  if (!comprobarProxy(req.query, cfg.secreto)) return json(401, { ok: false, error: 'firma' });
  const cliente = req.query.logged_in_customer_id ? String(req.query.logged_in_customer_id) : null;
  const ruta = String(req.ruta || '').replace(/^\/+|\/+$/g, '');
  const body = req.body || {};
  const { db } = deps;

  if (ruta === 'api/estado' && req.method === 'GET') {
    const handles = String(req.query.h || '').split(',').map((h) => h.trim()).filter(Boolean).slice(0, 60);
    return json(200, await db('sidonia_estado', { p_handles: handles, p_cliente: cliente }));
  }

  if (ruta === 'api/sincronizar' && req.method === 'POST') {
    const d = leerDatos(body.datos, body.firma, cfg.clave);
    if (!d) return json(400, { ok: false, error: 'datos' });
    return json(200, await db('sidonia_sincronizar', {
      p_handle: d.handle, p_titulo: d.titulo, p_inicio: new Date(d.inicio * 1000).toISOString(), p_fin: new Date(d.fin * 1000).toISOString(),
      p_salida: d.salida, p_reserva: d.reserva, p_version: d.t, p_cliente: cliente
    }));
  }

  if (ruta.startsWith('api/') && req.method === 'POST') {
    if (!cliente) return json(200, { ok: false, error: 'login' });
    if (ruta === 'api/pujar') {
      const importe = Math.round(Number(body.importe));
      if (!body.handle || !(importe > 0)) return json(400, { ok: false, error: 'datos' });
      const tipo = body.tipo === 'maxima' ? 'maxima' : 'directa';
      const intento = body.intento ? String(body.intento).slice(0, 80) : null;
      return json(200, await db('sidonia_pujar', { p_handle: String(body.handle), p_cliente: cliente, p_importe: importe, p_tipo: tipo, p_intento: intento }));
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
      return liquid(paginaRegistro({ alias: yo?.alias || '', volver, accion }));
    }

    if (ruta === 'registro' && req.method === 'POST') {
      if (!body.condiciones) return liquid(paginaRegistro({ error: 'condiciones', alias: body.alias, volver, accion }));
      const r = await db('sidonia_registrar', { p_cliente: cliente, p_alias: String(body.alias || ''), p_email: body.email || null });
      if (!r.ok) return liquid(paginaRegistro({ error: r.error, alias: body.alias, volver, accion }));
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
