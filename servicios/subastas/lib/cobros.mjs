/* SIDONIA · Cobros del dueño (alquiler con pago en la web) con Stripe Connect (cuentas Express).
 * - El dueño rellena sus datos para el contrato (nombre, DNI/NIE, domicilio, teléfono) y acepta las condiciones del
 *   servicio de alquiler. Se guardan en perfiles.alq_legal.
 * - Da de alta su cuenta de cobros en Stripe (identidad y cuenta bancaria; lo pide Stripe, no Sidonia). Se guarda
 *   perfiles.stripe_cuenta y, cuando Stripe la habilita, perfiles.cobros_ok.
 * - Cada pago se cobra «por cuenta» del dueño (on_behalf_of) y se le transfiere 24 h después del servicio.
 *
 * Sesión:  GET  api/alquiler/cobros                      → { cobrar, datos, cuenta, listo, version }
 *          POST api/alquiler/cobros { accion: 'datos', nombre, dni, domicilio, telefono, acepto }
 *          POST api/alquiler/cobros { accion: 'alta' }    → { url } (a Stripe para darse de alta)
 *          POST api/alquiler/cobros { accion: 'panel' }   → { url } (su panel de Stripe: pagos y banco)
 */
import { avisarEquipo, esc, slugVendedor, tablaAnuncios } from './circulo.mjs';
import { enviarCorreo, P, plantilla } from './correos.mjs';
import { VERSION_CONDICIONES } from './contratos.mjs';

const tabla = (cfg, deps, n) => deps[n] || tablaAnuncios(cfg, deps.fetch, n);
const clip = (t, n) => String(t ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const stripeDe = async (cfg, deps) => deps.stripe || (await import('./motor.mjs')).stripe(cfg, deps.fetch);

/** DNI o NIE español con su letra bien puesta */
export function dniValido(v) {
  const s = String(v || '').toUpperCase().replace(/[\s.-]/g, '');
  const m = s.match(/^([XYZ]?)(\d{7,8})([A-Z])$/);
  if (!m) return false;
  const num = Number(({ X: '0', Y: '1', Z: '2' }[m[1]] || '') + m[2]);
  return 'TRWAGMYFPDXBNJZSQVHLCKE'[num % 23] === m[3];
}
/** Documento de quien alquila: DNI/NIE (con su letra) o pasaporte */
export function documentoValido(v) {
  const s = String(v || '').toUpperCase().replace(/[\s.-]/g, '');
  if (/^[XYZ]?\d{7,8}[A-Z]$/.test(s)) return dniValido(s);
  return /^[A-Z0-9]{6,12}$/.test(s);
}
export const normDoc = (v) => String(v || '').toUpperCase().replace(/[\s.-]/g, '');

/** Lo del dueño para alquilar con cobro: su perfil con los datos legales y su cuenta */
export async function perfilCobros(cfg, deps, cliente) {
  const [p] = await tabla(cfg, deps, 'perfiles').leer(`cliente=eq.${encodeURIComponent(cliente)}&limit=1`).catch(() => []);
  return p || null;
}
/** Sus datos y la aceptación de la versión vigente de las condiciones (si cambian, tiene que volver a aceptarlas) */
// Firmó alguna versión: vale para publicar. Si las condiciones cambian, se le pide que acepte las nuevas (aviso en su
// garaje), pero su coche NO se oculta: antes, cada cambio escondía los coches de todos los dueños hasta que volvían a firmar.
export const datosListos = (p) => Boolean(p?.alq_legal?.nombre && p.alq_legal.dni && p.alq_legal.domicilio && p.alq_legal.acepto && p.alq_legal.version);
export const condicionesAlDia = (p) => datosListos(p) && p.alq_legal.version === VERSION_CONDICIONES;
export const cobrosListos = (p) => datosListos(p) && Boolean(p?.stripe_cuenta && p.cobros_ok);

/** Pregunta a Stripe si la cuenta ya puede cobrar y recibir pagos, y lo apunta */
export async function refrescarCuenta(cfg, deps, p) {
  if (!p?.stripe_cuenta || p.cobros_ok || !cfg.stripeKey) return p;
  try {
    const st = await stripeDe(cfg, deps);
    const a = await st('GET', `accounts/${encodeURIComponent(p.stripe_cuenta)}`);
    const ok = Boolean(a.charges_enabled && a.payouts_enabled);
    if (ok) {
      await tabla(cfg, deps, 'perfiles').guardar({ cliente: String(p.cliente), cobros_ok: true }, 'cliente');
      await avisarCochesListos(cfg, deps, p.cliente);
    }
    return { ...p, cobros_ok: ok };
  } catch (e) { console.error(e); return p; }
}

const urlPerfil = (cfg, extra = '') => `${cfg.tienda}/pages/vende-con-nosotros?view=perfil${extra}#mi-garaje`;

export async function rutasCobros({ ruta, method, body, ip }, cliente, cfg, deps) {
  if (ruta !== 'api/alquiler/cobros') return null;
  const json = (status, b) => ({ status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(b) });
  if (!cliente) return json(200, { ok: false, error: 'login' });
  try {
    let p = await perfilCobros(cfg, deps, cliente);
    if (!p) p = { cliente: String(cliente) };
    const tP = tabla(cfg, deps, 'perfiles');
    if (method === 'GET') {
      p = await refrescarCuenta(cfg, deps, p);
      const d = p.alq_legal || {};
      return json(200, { ok: true, cobrar: Boolean(cfg.alquilerCobrar), version: VERSION_CONDICIONES,
        datos: { nombre: d.nombre || '', dni: d.dni || '', domicilio: d.domicilio || '', telefono: d.telefono || '', acepto: Boolean(d.acepto), version: d.version || '' },
        datos_ok: datosListos(p), al_dia: condicionesAlDia(p), cuenta: Boolean(p.stripe_cuenta), listo: cobrosListos(p) });
    }
    const accion = String(body.accion || '');
    if (accion === 'datos') {
      const d = { nombre: clip(body.nombre, 120), dni: normDoc(body.dni), domicilio: clip(body.domicilio, 250), telefono: clip(body.telefono, 30), email: clip(body.email, 160) };
      if (d.nombre.split(/\s+/).length < 2) return json(400, { ok: false, error: 'nombre' });
      // DNI o NIE con su letra; quien no los tiene, su pasaporte
      if (!documentoValido(d.dni)) return json(400, { ok: false, error: 'dni' });
      if (d.domicilio.length < 8) return json(400, { ok: false, error: 'domicilio' });
      // El teléfono como lo escriba (+34 600 00 00 00, 600-000-000, (+34) 600…): cuentan las cifras
      const cifras = d.telefono.replace(/\D/g, '');
      if (!/^[\d\s()+.-]+$/.test(d.telefono) || cifras.length < 9 || cifras.length > 15) return json(400, { ok: false, error: 'telefono' });
      if (!body.acepto) return json(400, { ok: false, error: 'acepto' });
      try {
        // Sin perfil todavía (o sin nombre ni dirección pública): se le pone, para que su coche se vea con su nombre
        const extra = {};
        if (!p.slug) extra.slug = slugVendedor(d.nombre, cliente);
        if (!p.nombre) extra.nombre = d.nombre.split(/\s+/)[0];
        await tP.guardar({ cliente: String(cliente), ...extra, alq_legal: { ...d, acepto: new Date().toISOString(), version: VERSION_CONDICIONES, ip: clip(ip, 60) } }, 'cliente');
      } catch (e) {
        // Que el equipo se entere en el momento (y el dueño vea un mensaje claro)
        await avisarEquipo(cfg, 'Alquiler: un dueño no ha podido guardar sus datos', `<p>Error al guardar los datos de cobro del cliente ${esc(cliente)}: <b>${esc(String(e.message).slice(0, 300))}</b></p><p>Si dice «base de datos», ejecuta sql/reservas.sql en Supabase › SQL Editor. Comprueba todo en sidonia.es/apps/sidonia/conexion.</p>`, deps.fetch).catch(() => {});
        throw e;
      }
      await avisarCochesListos(cfg, deps, cliente, { email: d.email });
      return json(200, { ok: true });
    }
    if (accion === 'alta' || accion === 'panel') {
      if (!cfg.stripeKey) return json(200, { ok: false, error: 'sin-stripe' });
      if (!datosListos(p)) return json(400, { ok: false, error: 'datos' });
      const st = await stripeDe(cfg, deps);
      if (accion === 'panel' && p.stripe_cuenta && p.cobros_ok) {
        const l = await st('POST', `accounts/${encodeURIComponent(p.stripe_cuenta)}/login_links`);
        return json(200, { ok: true, url: l.url });
      }
      let cuenta = p.stripe_cuenta;
      if (!cuenta) {
        const [nombre, ...ap] = p.alq_legal.nombre.split(/\s+/);
        const a = await st('POST', 'accounts', {
          type: 'express', country: 'ES', business_type: 'individual',
          capabilities: { card_payments: { requested: 'true' }, transfers: { requested: 'true' } },
          business_profile: { mcc: '7512', product_description: 'Alquiler de vehículos entre particulares a través de Sidonia', url: cfg.tienda || 'https://sidonia.es' },
          individual: { first_name: nombre, last_name: ap.join(' ') || nombre },
          metadata: { cliente: String(cliente), sidonia: 'alquiler' }
        });
        cuenta = a.id;
        await tP.guardar({ cliente: String(cliente), stripe_cuenta: cuenta, cobros_ok: false }, 'cliente');
      }
      const l = await st('POST', 'account_links', { account: cuenta, type: 'account_onboarding',
        refresh_url: urlPerfil(cfg, '&cobros=reintentar'), return_url: urlPerfil(cfg, '&cobros=vuelta') });
      return json(200, { ok: true, url: l.url });
    }
    return json(400, { ok: false, error: 'accion' });
  } catch (e) {
    console.error(e);
    return json(200, { ok: false, error: /alq_legal|stripe_cuenta|cobros_ok|column|base de datos/.test(String(e.message)) ? 'sin-tabla' : 'motor' });
  }
}

/** Qué le falta a un coche para poder alquilarse con pago en la web (vacío: listo).
 *  precio · matricula · seguro (compañía, póliza, tipo y que cubra a quien alquila) · itv · vtc (con conductor) · datos · cobros */
/** Como los anuncios: lo que se sube para alquilar lo revisa Sidonia antes de publicarlo (alq.estado: pendiente →
 *  publicado, o rechazado). Los de antes de la revisión (sin estado) siguen publicados. */
export const enRevision = (c) => ['pendiente', 'rechazado'].includes(c?.alq?.estado);
export function faltaParaAlquilar(c, p, cobrar) {
  const a = (c && c.alq) || {};
  const f = [];
  if (enRevision(c)) f.push('revision');
  if (!tienePrecio(a)) f.push('precio');
  if (!cobrar) return f;
  // Sidonia solo intermedia (como Airbnb): el dueño declara que el seguro, el conductor, las licencias y la ITV son cosa suya
  if (!a.declara) f.push('declara');
  if (!datosListos(p)) f.push('datos');
  // El alta de cobros en Stripe NO hace falta para publicar: el coche sale en cuanto tiene precio, la declaración y sus
  // datos firmados. Sidonia cobra la reserva y le transfiere su parte cuando termine el alta (te avisamos por email).
  return f;
}
/** Los planes por horas que ofrece: [[clave, { hora, min }], …] */
export const planesDe = (a = {}) => Object.entries(a.planes || {}).filter(([, x]) => Number(x?.hora) > 0);
/** €/hora del coche: un precio para todo (los anuncios de antes, con un precio por plan, usan el del plan) */
export function precioHora(a = {}, plan) {
  if (Number(a.hora) > 0) return Number(a.hora);
  const x = (a.planes || {})[plan];
  return Number(x?.hora) > 0 ? Number(x.hora) : 0;
}
/** Mínimo de horas por día de reserva */
export const minHoras = (a = {}, plan) => Number(a.hora) > 0 ? Number(a.min_horas) || 1 : Number(a.planes?.[plan]?.min) || 1;
/** ¿Se alquila por horas? */
export const porHoras = (a = {}) => Number(a.hora) > 0 || planesDe(a).length > 0;
/** El precio por hora para las tarjetas (con los anuncios de antes, el plan más barato) */
export const desdeHora = (a = {}) => { if (Number(a.hora) > 0) return Number(a.hora); const l = planesDe(a).map(([, x]) => Number(x.hora)); return l.length ? Math.min(...l) : 0; };
/** Precio por día de cada servicio: 'sin' (lo conduce quien alquila) o 'con' (con conductor). Los anuncios antiguos
 *  «solo con conductor» tienen su precio en «precio». 0 = no se ofrece. */
export function precioDe(a = {}, modo = 'con') {
  if (modo !== 'con') return 0;
  return Number(a.precio_con) || Number(a.precio) || 0;
}
export const tienePrecio = (a = {}) => porHoras(a) || precioDe(a, 'sin') > 0 || precioDe(a, 'con') > 0;
/** En Sidonia el coche siempre lo conduce su dueño (o quien él ponga al volante bajo su responsabilidad): no hay alquiler sin conductor */
export const conductorEfectivo = () => 'con';

/* ---------------------------------------------------------------------------- «Tu coche ya se puede alquilar»
 * Cuando un coche del dueño pasa a estar listo (precio, declaración, sus datos y su cuenta de cobros) y visible, se le
 * manda un email y otro al equipo de Sidonia, una sola vez por coche (alq.aviso_listo). Se mira al guardar el coche, al
 * guardar sus datos y al volver de Stripe con la cuenta lista. Nunca rompe lo que lo llama.
 */
export async function avisarCochesListos(cfg, deps, cliente, { email = '' } = {}) {
  if (!cfg.alquilerCobrar || !cliente) return 0;
  try {
    const p = await perfilCobros(cfg, deps, cliente);
    if (!datosListos(p)) return 0;
    const sinCobros = !cobrosListos(p);
    const tG = tabla(cfg, deps, 'garaje');
    const coches = await tG.leer(`cliente=eq.${encodeURIComponent(cliente)}&alquiler=eq.true&order=id.asc`);
    const para = String(p.alq_legal?.email || email || '').trim();
    const nombre = String(p.alq_legal?.nombre || p.nombre || '').split(/\s+/)[0];
    const tienda = cfg.tienda || 'https://sidonia.es';
    let n = 0;
    for (const c of coches) {
      const a = c.alq || {};
      if (c.visible === false || a.aviso_listo || faltaParaAlquilar(c, p, true).length) continue;
      await tG.cambiar(c.id, { alq: { ...a, aviso_listo: new Date().toISOString() } });
      const titulo = [c.marca, c.modelo, c.anio].filter(Boolean).join(' ') || 'tu coche';
      const enlace = `${tienda}/pages/alquiler`;
      if (para) {
        const html = plantilla(cfg, null, { titulo: '¡Ya se puede alquilar!', previa: `Tu ${titulo} ya está en Alquiler.`,
          cuerpo: P(`Hola${nombre ? ` ${esc(nombre)}` : ''}:`) + P(`Tu <b>${esc(titulo)}</b> ya está publicado en <b>Alquiler</b> de Sidonia y se puede reservar.`)
            + P('Cuando alguien lo reserve te llegará un email. Recuerda: siempre lo conduces tú. Puedes cambiar el precio o bloquear días en tu garaje cuando quieras.')
            + (sinCobros ? P('<b>Para recibir tu dinero</b>, date de alta para cobrar en tu garaje (con Stripe, 5 minutos: tu identidad y tu cuenta bancaria). Puedes hacerlo ahora o cuando tengas tu primera reserva: te guardamos tu parte hasta entonces.') : ''),
          boton: 'Verlo en Alquiler', enlace });
        await enviarCorreo(cfg, para, `Tu ${titulo} ya se puede alquilar`, html, deps.fetch).catch((e) => console.error(e));
      }
      await avisarEquipo(cfg, `Nuevo coche en alquiler: ${titulo}`, `<p><b>${esc(p.alq_legal?.nombre || p.nombre || 'Un dueño')}</b>${para ? ` (${esc(para)})` : ''} ha puesto su <b>${esc(titulo)}</b> en alquiler a ${Number(a.hora) || '?'} €/hora (mínimo ${Number(a.min_horas) || 1} h)${a.ciudad ? `, en ${esc(a.ciudad)}` : ''}. Ya está visible.</p><p><a href="${esc(enlace)}">Ver Alquiler</a></p>`, deps.fetch).catch((e) => console.error(e));
      n += 1;
    }
    return n;
  } catch (e) { console.error(e); return 0; }
}
