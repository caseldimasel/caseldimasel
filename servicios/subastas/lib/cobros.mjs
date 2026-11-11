/* SIDONIA · Cobros del dueño (alquiler con pago en la web) con Stripe Connect (cuentas Express).
 * - El dueño rellena sus datos para el contrato (nombre, DNI/NIE, domicilio, teléfono) y acepta las condiciones del
 *   servicio de alquiler. Se guardan en perfiles.alq_legal.
 * - Da de alta su cuenta de cobros en Stripe (identidad y cuenta bancaria; lo pide Stripe, no Sidonia). Se guarda
 *   perfiles.stripe_cuenta y, cuando Stripe la habilita, perfiles.cobros_ok.
 * - Cada pago se cobra «por cuenta» del dueño (on_behalf_of) y se le transfiere el día que empieza el alquiler.
 *
 * Sesión:  GET  api/alquiler/cobros                      → { cobrar, datos, cuenta, listo, version }
 *          POST api/alquiler/cobros { accion: 'datos', nombre, dni, domicilio, telefono, acepto }
 *          POST api/alquiler/cobros { accion: 'alta' }    → { url } (a Stripe para darse de alta)
 *          POST api/alquiler/cobros { accion: 'panel' }   → { url } (su panel de Stripe: pagos y banco)
 */
import { tablaAnuncios } from './circulo.mjs';
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
export const datosListos = (p) => Boolean(p?.alq_legal?.nombre && p.alq_legal.dni && p.alq_legal.domicilio && p.alq_legal.acepto);
export const cobrosListos = (p) => datosListos(p) && Boolean(p?.stripe_cuenta && p.cobros_ok);

/** Pregunta a Stripe si la cuenta ya puede cobrar y recibir pagos, y lo apunta */
export async function refrescarCuenta(cfg, deps, p) {
  if (!p?.stripe_cuenta || p.cobros_ok || !cfg.stripeKey) return p;
  try {
    const st = await stripeDe(cfg, deps);
    const a = await st('GET', `accounts/${encodeURIComponent(p.stripe_cuenta)}`);
    const ok = Boolean(a.charges_enabled && a.payouts_enabled);
    if (ok) await tabla(cfg, deps, 'perfiles').guardar({ cliente: String(p.cliente), cobros_ok: true }, 'cliente');
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
        datos_ok: datosListos(p), cuenta: Boolean(p.stripe_cuenta), listo: cobrosListos(p) });
    }
    const accion = String(body.accion || '');
    if (accion === 'datos') {
      const d = { nombre: clip(body.nombre, 120), dni: normDoc(body.dni), domicilio: clip(body.domicilio, 250), telefono: clip(body.telefono, 30) };
      if (d.nombre.split(/\s+/).length < 2) return json(400, { ok: false, error: 'nombre' });
      if (!dniValido(d.dni)) return json(400, { ok: false, error: 'dni' });
      if (d.domicilio.length < 8) return json(400, { ok: false, error: 'domicilio' });
      if (!/^\+?[\d\s]{9,15}$/.test(d.telefono)) return json(400, { ok: false, error: 'telefono' });
      if (!body.acepto) return json(400, { ok: false, error: 'acepto' });
      await tP.guardar({ cliente: String(cliente), alq_legal: { ...d, acepto: new Date().toISOString(), version: VERSION_CONDICIONES, ip: clip(ip, 60) } }, 'cliente');
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
    return json(200, { ok: false, error: /alq_legal|stripe_cuenta|cobros_ok|column/.test(String(e.message)) ? 'sin-tabla' : 'motor' });
  }
}

/** Qué le falta a un coche para poder alquilarse con pago en la web (vacío: listo).
 *  precio · matricula · seguro (compañía, póliza, tipo y que cubra a quien alquila) · itv · vtc (con conductor) · datos · cobros */
export function faltaParaAlquilar(c, p, cobrar) {
  const a = (c && c.alq) || {};
  const f = [];
  if (!tienePrecio(a)) f.push('precio');
  if (!cobrar) return f;
  // Sidonia solo intermedia (como Airbnb): el dueño declara que el seguro, el conductor, las licencias y la ITV son cosa suya
  if (!a.declara) f.push('declara');
  if (!datosListos(p)) f.push('datos');
  if (!cobrosListos(p)) f.push('cobros');
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
