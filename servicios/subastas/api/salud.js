/* SIDONIA · Comprobación: /api/salud responde si el motor está publicado y tiene sus claves puestas (sin enseñarlas). */
export default function handler(req, res) {
  const tiene = (k) => Boolean(process.env[k]);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    servicio: 'sidonia-subastas',
    claves: {
      SUPABASE_URL: tiene('SUPABASE_URL'),
      SUPABASE_SERVICE_KEY: tiene('SUPABASE_SERVICE_KEY'),
      STRIPE_SECRET_KEY: tiene('STRIPE_SECRET_KEY'),
      SHOPIFY_APP_SECRET: tiene('SHOPIFY_APP_SECRET'),
      TIENDA_URL: tiene('TIENDA_URL')
    }
  });
}
