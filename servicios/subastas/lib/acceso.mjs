/* SIDONIA · Entrar en el panel con un código de 5 cifras, y quedarse dentro.
 *
 * - El código es ADMIN_PIN (Vercel); también vale la contraseña de siempre (ADMIN_CLAVE).
 * - Al acertar, la sesión se guarda en ese navegador (una cookie firmada, 180 días): no hay que volver a escribirlo.
 *   «Cerrar sesión» (Herramientas) la borra en ese navegador.
 * - Contra quien pruebe códigos: tras 5 fallos desde la misma conexión, o 20 en total, en 15 minutos, se bloquea
 *   un rato (tabla panel_intentos, sql/operaciones.sql). Cada fallo además tarda un segundo.
 * - Sigue valiendo el acceso de antes (usuario y contraseña del navegador), por si acaso.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { tablaAnuncios } from './circulo.mjs';
import { CABECERA, ESTILO_PANEL, FAVICON } from './marca.mjs';

export const COOKIE = 'sidonia_panel';
export const DIAS = 180;
const MAX_IP = 5, MAX_TODOS = 20, VENTANA = 15 * 60 * 1000;

const igual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};
const firma = (clave, texto) => createHmac('sha256', `panel|${clave}`).update(texto).digest('hex');

/** La cookie de la sesión: «<caduca>.<firma>» (si cambia ADMIN_CLAVE, todas las sesiones dejan de valer) */
export function cookieSesion(clave, ahora = Date.now()) {
  const hasta = Math.floor(ahora / 1000) + DIAS * 86400;
  return `${COOKIE}=${hasta}.${firma(clave, String(hasta))}; Path=/; Max-Age=${DIAS * 86400}; HttpOnly; Secure; SameSite=Lax`;
}
export const cookieFuera = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

/** ¿Trae una sesión buena? */
export function sesionValida(headers, clave, ahora = Date.now()) {
  if (!clave) return false;
  const c = String(headers.cookie || '').split(/;\s*/).find((x) => x.startsWith(`${COOKIE}=`));
  const [hasta, sig] = (c ? c.slice(COOKIE.length + 1) : '').split('.');
  if (!/^\d{9,11}$/.test(hasta || '') || !/^[0-9a-f]{64}$/.test(sig || '')) return false;
  return Number(hasta) * 1000 > ahora && igual(sig, firma(clave, hasta));
}

/** ¿El código es bueno? (el PIN o la contraseña de siempre) */
export function codigoBueno(codigo, cfg) {
  const c = String(codigo || '').trim();
  if (!c) return false;
  return (cfg.adminPin && igual(c, cfg.adminPin)) || (cfg.adminClave && igual(c, cfg.adminClave));
}

const ipDe = (headers) => String(headers['x-forwarded-for'] || headers['x-real-ip'] || '').split(',')[0].trim().slice(0, 60) || 'desconocida';

/**
 * Intenta entrar. Devuelve { ok } o { error, bloqueado }. deps.intentos: la tabla (para las pruebas).
 * Si la tabla aún no existe, se deja entrar igual (con el segundo de espera en cada fallo).
 */
export async function intentarEntrar(codigo, headers, cfg, deps = {}, ahora = Date.now()) {
  const t = deps.intentos || (cfg.supabaseUrl ? tablaAnuncios(cfg, deps.fetch, 'panel_intentos') : null);
  const ip = ipDe(headers);
  let fallos = [];
  if (t) {
    try { fallos = await t.leer(`ok=eq.false&creado=gte.${encodeURIComponent(new Date(ahora - VENTANA).toISOString())}&select=ip`); } catch (e) { fallos = []; }
  }
  if (fallos.filter((f) => f.ip === ip).length >= MAX_IP || fallos.length >= MAX_TODOS) {
    return { error: 'Demasiados intentos. Espera 15 minutos y vuelve a probar.', bloqueado: true };
  }
  const ok = codigoBueno(codigo, cfg);
  if (t) await t.guardar({ ip, ok }, 'id').catch(() => {});
  if (!ok) {
    if (!deps.sinEspera) await new Promise((r) => setTimeout(r, 1000));
    const quedan = MAX_IP - fallos.filter((f) => f.ip === ip).length - 1;
    return { error: quedan > 0 ? `Código incorrecto. Te quedan ${quedan} ${quedan === 1 ? 'intento' : 'intentos'}.` : 'Código incorrecto. Espera 15 minutos.' };
  }
  return { ok: true };
}

/** La pantalla de entrar: el logo, «Código» y un teclado numérico (se envía solo al poner las 5 cifras) */
export function paginaEntrar({ error = '', largo = 5 } = {}) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Entrar · Panel de Sidonia</title><meta name="robots" content="noindex">${FAVICON}
<style>${ESTILO_PANEL}
  .entrar { min-height: 70vh; display: grid; place-items: center; padding: 24px 0; }
  .entrar form { width: min(100%, 360px); display: grid; gap: 14px; text-align: center; padding: 28px 22px; border-radius: 20px; background: var(--caja); border: 1px solid var(--linea); box-shadow: var(--sombra); }
  .entrar h2 { margin: 0; color: var(--texto); font-size: 18px; } .entrar p { margin: 0; color: var(--suave); font-size: 14px; }
  .entrar input { width: 100%; padding: 16px 12px; border: 1px solid var(--linea-2); border-radius: 14px; background: var(--fondo-2); color: var(--texto);
    font: inherit; font-size: 30px; font-weight: 800; letter-spacing: .5em; text-indent: .5em; text-align: center; }
  .entrar input:focus { outline: none; border-color: var(--verde); box-shadow: 0 0 0 3px var(--verde-fondo); }
  .entrar .aviso { margin: 0; }
</style></head><body>
${CABECERA}
<main class="entrar"><form method="post" autocomplete="on">
  <h2>Código del panel</h2>
  <p>Escríbelo una vez: este ${'dispositivo'} se queda dentro ${DIAS / 30} meses.</p>
  ${error ? `<p class="aviso mal">${error}</p>` : ''}
  <input type="hidden" name="usuario" value="sidonia" autocomplete="username">
  <input name="codigo" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="40" autocomplete="current-password" required autofocus aria-label="Código"
    oninput="if (/^[0-9]{${largo}}$/.test(this.value)) { this.form.requestSubmit ? this.form.requestSubmit() : this.form.submit(); }">
  <button class="boton" name="accion" value="entrar">Entrar</button>
</form></main>
</body></html>`;
}
