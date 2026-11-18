/* SIDONIA · Avisos al móvil (notificaciones push) de la app de Sidonia, con Firebase Cloud Messaging (FCM, API v1).
 *
 * - La app (Capacitor, carpeta app/ del repositorio) pide permiso, saca su token de Firebase y lo manda aquí:
 *     POST api/push/registrar { token, plataforma }   → se guarda en la tabla «dispositivos» (sql/circulo.sql), con el
 *     cliente si ha iniciado sesión (firma del tema). Además la app se apunta al tema «novedades».
 * - Desde el servidor: avisarCliente (a los móviles de un cliente: «Tu anuncio ya está publicado») y avisarTodos (al
 *   tema «novedades»: lo manda el equipo desde el panel › Avisos).
 * Variables en Vercel: FIREBASE_SERVICE_ACCOUNT (el JSON de la cuenta de servicio de Firebase, tal cual o en base64).
 * Sin ella no se manda nada y el panel lo dice. Sin dependencias: el token de Google se firma con node:crypto.
 */
import { createSign } from 'node:crypto';
import { tablaAnuncios } from './circulo.mjs';

export const TEMA_TODOS = 'novedades';
const PLATAFORMAS = ['ios', 'android'];

/** La cuenta de servicio de Firebase (JSON o JSON en base64), o null si no está */
export function cuentaFirebase(valor = process.env.FIREBASE_SERVICE_ACCOUNT) {
  if (!valor) return null;
  try {
    const texto = String(valor).trim().startsWith('{') ? String(valor) : Buffer.from(String(valor), 'base64').toString('utf8');
    const c = JSON.parse(texto);
    return c.client_email && c.private_key && c.project_id ? c : null;
  } catch (e) {
    return null;
  }
}

const b64url = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');

/** JWT firmado (RS256) para pedir a Google el token de acceso de FCM */
export function jwtGoogle(cuenta, ahora = Date.now()) {
  const iat = Math.floor(ahora / 1000);
  const cuerpo = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
    iss: cuenta.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600
  })}`;
  const firma = createSign('RSA-SHA256').update(cuerpo).sign(cuenta.private_key).toString('base64url');
  return `${cuerpo}.${firma}`;
}

let cache = null;   // { email, token, hasta }
async function tokenAcceso(cuenta, fetchImpl) {
  if (cache && cache.email === cuenta.client_email && cache.hasta > Date.now() + 60_000) return cache.token;
  const r = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwtGoogle(cuenta) }).toString(),
    signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) throw new Error(`Google ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  const d = await r.json();
  cache = { email: cuenta.client_email, token: d.access_token, hasta: Date.now() + (Number(d.expires_in) || 3600) * 1000 };
  return cache.token;
}

/** El mensaje de FCM: título, texto, foto opcional y la página que abre al tocarlo */
export function mensaje(destino, { titulo, texto, url = '/', imagen = '' }) {
  const m = {
    ...destino,
    notification: { title: String(titulo).slice(0, 120), body: String(texto || '').slice(0, 400), ...(imagen ? { image: imagen } : {}) },
    data: { url: String(url || '/') },
    android: { priority: 'high', notification: { sound: 'default', color: '#1a1a1a' } },
    apns: { payload: { aps: { sound: 'default' } }, ...(imagen ? { fcm_options: { image: imagen } } : {}) }
  };
  return { message: m };
}

/**
 * Manda un aviso a un token o a un tema. Devuelve 'ok', 'caducado' (el token ya no vale: hay que borrarlo) o lanza.
 * Sin FIREBASE_SERVICE_ACCOUNT devuelve 'sin-firebase'.
 */
export async function enviarAviso(cfg, destino, datos, fetchImpl = fetch) {
  const cuenta = cfg.firebase;
  if (!cuenta) return 'sin-firebase';
  const r = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${cuenta.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await tokenAcceso(cuenta, fetchImpl)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(mensaje(destino, datos)),
    signal: AbortSignal.timeout(8000)
  });
  if (r.ok) return 'ok';
  const t = await r.text().catch(() => '');
  if (destino.token && (r.status === 404 || /UNREGISTERED|registration-token-not-registered|INVALID_ARGUMENT/.test(t))) return 'caducado';
  throw new Error(`FCM ${r.status}: ${t.slice(0, 200)}`);
}

const tabla = (cfg, deps) => deps.dispositivos || tablaAnuncios(cfg, deps.fetch, 'dispositivos');

/** POST api/push/registrar: guarda (o pone al día) el móvil, con el cliente si ha iniciado sesión */
export async function registrarDispositivo(cfg, deps, body, cliente) {
  const token = String(body.token || '').trim();
  if (!/^[\w:.-]{20,4096}$/.test(token)) return { ok: false, error: 'datos' };
  const fila = { token, plataforma: PLATAFORMAS.includes(body.plataforma) ? body.plataforma : 'otra', visto: new Date().toISOString() };
  // Sin sesión no se borra el cliente que ya tuviera ese móvil
  if (cliente) fila.cliente = String(cliente);
  await tabla(cfg, deps).guardar(fila, 'token');
  return { ok: true };
}

/** A todos los móviles de un cliente. Devuelve cuántos han salido; borra los tokens caducados. */
export async function avisarCliente(cfg, deps, cliente, datos) {
  if (!cfg.firebase || !cliente) return 0;
  const t = tabla(cfg, deps);
  const moviles = await t.leer(`cliente=eq.${encodeURIComponent(String(cliente))}&select=token`).catch(() => []);
  let enviados = 0;
  for (const { token } of moviles) {
    try {
      const r = await enviarAviso(cfg, { token }, datos, deps.fetch);
      if (r === 'ok') enviados += 1;
      if (r === 'caducado') await t.borrar(`token=eq.${encodeURIComponent(token)}`).catch(() => {});
    } catch (e) {
      console.error(e);
    }
  }
  return enviados;
}

/** A todos los que tienen la app (tema «novedades») */
export const avisarTodos = (cfg, deps, datos) => enviarAviso(cfg, { topic: TEMA_TODOS }, datos, deps.fetch);

/** Los avisos que se mandan al dueño de un anuncio */
export const avisoPublicado = (a, url) => ({ titulo: '¡Enhorabuena! Ya está publicado', texto: `«${a.titulo}» ya se puede ver en Sidonia.`, url });
export const avisoRechazado = (a) => ({ titulo: 'Sobre tu anuncio', texto: `Aún no podemos publicar «${a.titulo}». Te hemos escrito un email con el motivo.`, url: '/pages/vende-con-nosotros?view=perfil' });
export const avisoCambios = (a, url) => ({ titulo: 'Tus cambios ya se ven', texto: `Hemos actualizado «${a.titulo}».`, url: url || '/pages/vende-con-nosotros?view=perfil' });
