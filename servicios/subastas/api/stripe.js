/* SIDONIA · Avisos de Stripe (webhook): https://<este-servidor>/api/stripe
 * Los pagos de los anuncios de la comunidad (lib/comunidad.mjs): cada factura pagada se apunta y alarga el anuncio;
 * impagos y cancelaciones quedan en el anuncio. La firma se comprueba con STRIPE_WEBHOOK_SECRET (Vercel).
 * En Stripe › Desarrolladores › Webhooks: esta URL y los eventos checkout.session.completed, invoice.paid,
 * invoice.payment_failed, customer.subscription.updated y customer.subscription.deleted.
 */
import { config, stripe, supabase } from '../lib/motor.mjs';
import { procesarStripe, verificarStripe } from '../lib/comunidad.mjs';

// Hace falta el cuerpo tal cual llega (la firma va sobre él)
export const config_ = { api: { bodyParser: false } };
export { config_ as config };

// Se lee el cuerpo de la petición directamente (sin tocar req.body, que lo convertiría en objeto)
async function crudo(req) {
  const trozos = [];
  for await (const t of req) trozos.push(Buffer.isBuffer(t) ? t : Buffer.from(t));
  return Buffer.concat(trozos).toString('utf8');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('POST');
  const cfg = config();
  const ev = verificarStripe(await crudo(req), req.headers['stripe-signature'], cfg.stripeWebhook);
  if (!ev) return res.status(400).json({ ok: false, error: 'firma' });
  try {
    const r = await procesarStripe(ev, cfg, { db: supabase(cfg), stripe: stripe(cfg) });
    console.log('stripe', ev.type, r);
    res.status(200).json({ ok: true, r });
  } catch (e) {
    console.error(e);
    // 500: Stripe lo reintenta
    res.status(500).json({ ok: false });
  }
}
