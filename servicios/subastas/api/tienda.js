/* SIDONIA · Entrada directa desde la tienda (sin el proxy de la app de Shopify): https://<este-servidor>/tienda/<ruta>.
 * Solo para «Anuncia gratis» (api/anuncio, api/anuncio/fotos, api/anuncios, api/visita). Quién es el cliente lo firma el
 * tema en Liquid con la «Clave del motor» (?c&ct&cf), que se comprueba con SUBASTAS_CLAVE. Sin cookies.
 */
import { atender, codigoError, config, supabase } from '../lib/motor.mjs';

// Desde dónde se puede llamar: la tienda (sidonia.es, *.myshopify.com, vista previa del editor) y el arnés local
const ORIGEN = /^(https:\/\/([a-z0-9-]+\.)*(sidonia\.es|myshopify\.com|shopifypreview\.com)|http:\/\/localhost(:\d+)?)$/i;

export default async function handler(req, res) {
  const origen = req.headers.origin || '';
  if (ORIGEN.test(origen)) {
    res.setHeader('Access-Control-Allow-Origin', origen);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  const cfg = config();
  const url = new URL(req.url, 'https://x');
  const query = Object.fromEntries(url.searchParams);
  const ruta = String(query.ruta || '').replace(/^\/+|\/+$/g, '');
  delete query.ruta;
  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  try {
    const r = await atender({ method: req.method, ruta, query, body, directo: true }, cfg, { db: supabase(cfg) });
    console.log('tienda', req.method, ruta, r.status);
    Object.entries(r.headers || {}).forEach(([k, v]) => res.setHeader(k, v));
    res.status(r.status).send(r.body);
  } catch (e) {
    console.error(e);
    res.status(200).json({ ok: false, error: 'servidor', detalle: codigoError(e) });
  }
}
