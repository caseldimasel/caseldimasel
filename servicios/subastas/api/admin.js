/* SIDONIA · Panel «Del dueño»: https://<este-servidor>/admin (contraseña: ADMIN_CLAVE). Revisar, publicar y rechazar anuncios. */
import { config, supabase } from '../lib/motor.mjs';
import { atenderPanel } from '../lib/circulo.mjs';

export default async function handler(req, res) {
  const cfg = config();
  const url = new URL(req.url, 'https://x');
  let body = req.body || {};
  if (typeof body === 'string') {
    // Campos repetidos (las fotos a quitar) como lista
    const datos = {};
    for (const [k, v] of new URLSearchParams(body)) datos[k] = k in datos ? [].concat(datos[k], v) : v;
    body = datos;
  }
  try {
    const r = await atenderPanel({ method: req.method, query: Object.fromEntries(url.searchParams), body, headers: req.headers }, cfg, { db: supabase(cfg) });
    Object.entries(r.headers || {}).forEach(([k, v]) => res.setHeader(k, v));
    res.status(r.status).send(r.body);
  } catch (e) {
    console.error(e);
    res.status(500).send('Error del panel: ' + e.message);
  }
}
