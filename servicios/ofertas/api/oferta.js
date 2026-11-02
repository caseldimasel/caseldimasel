/* SIDONIA · POST /api/oferta (función de Vercel).
 * Recibe la oferta que envía el tema (assets/sidonia-offer.js), avisa al equipo y manda al cliente el email de gracias.
 * Variables de entorno: ver ../README.md.
 */
import { atender, config } from '../lib/ofertas.mjs';

export default async function handler(req, res) {
  const cfg = config();
  const origen = req.headers.origin || '';
  if (cfg.origenes.includes(origen)) {
    res.setHeader('Access-Control-Allow-Origin', origen);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'metodo' });
  if (origen && !cfg.origenes.includes(origen)) return res.status(403).json({ ok: false, error: 'origen' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  const r = await atender(body, cfg);
  return res.status(r.status).json(r.body);
}
