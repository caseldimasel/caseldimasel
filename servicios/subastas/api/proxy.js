/* SIDONIA · Punto de entrada en Vercel. vercel.json manda /proxy/<ruta> aquí (?ruta=<ruta>).
 * En la app de Shopify, el proxy es: prefijo «apps», subruta «subastas», URL https://<este-servidor>/proxy
 */
import { atender, codigoError, config, stripe, supabase } from '../lib/motor.mjs';

export default async function handler(req, res) {
  const cfg = config();
  const url = new URL(req.url, 'https://x');
  const query = Object.fromEntries(url.searchParams);
  const ruta = query.ruta || '';
  delete query.ruta;
  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = Object.fromEntries(new URLSearchParams(body)); }
  }
  try {
    const r = await atender({ method: req.method, ruta, query, body }, cfg, { db: supabase(cfg), stripe: stripe(cfg) });
    console.log(req.method, ruta, r.status);
    Object.entries(r.headers || {}).forEach(([k, v]) => res.setHeader(k, v));
    res.status(r.status).send(r.body);
  } catch (e) {
    console.error(e);
    // 200 con ok:false: si se responde 500, Shopify (proxy de la app) cambia la respuesta por su página de error y la
    // tienda no ve qué ha fallado. Así el formulario enseña el motivo (p. ej. «anuncios-sql»).
    res.status(200).json({ ok: false, error: 'servidor', detalle: codigoError(e) });
  }
}
