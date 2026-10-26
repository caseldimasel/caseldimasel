/* SIDONIA · Comprobación: /api/salud responde si el motor está publicado y tiene sus claves puestas (sin enseñarlas).
   /api/salud?prueba=1 además prueba Supabase (la tabla de anuncios, el cubo de fotos y la tabla de alertas) y dice cuánto tarda cada cosa. */
import { VERSION, codigoError, config, supabase } from '../lib/motor.mjs';
import { tablaAnuncios } from '../lib/circulo.mjs';

async function medir(fn) {
  const t = Date.now();
  try {
    await fn();
    return { ok: true, ms: Date.now() - t };
  } catch (e) {
    return { ok: false, ms: Date.now() - t, error: codigoError(e), detalle: String(e.message || e).slice(0, 160) };
  }
}

export default async function handler(req, res) {
  const tiene = (k) => Boolean(process.env[k]);
  res.setHeader('Cache-Control', 'no-store');
  const salida = {
    ok: true,
    servicio: 'sidonia-platform',
    version: VERSION,
    claves: {
      SUPABASE_URL: tiene('SUPABASE_URL'),
      SUPABASE_SERVICE_KEY: tiene('SUPABASE_SERVICE_KEY'),
      STRIPE_SECRET_KEY: tiene('STRIPE_SECRET_KEY'),
      SHOPIFY_APP_SECRET: tiene('SHOPIFY_APP_SECRET'),
      SUBASTAS_CLAVE: tiene('SUBASTAS_CLAVE'),
      TIENDA_URL: tiene('TIENDA_URL'),
      SHOPIFY_TIENDA: tiene('SHOPIFY_TIENDA'),
      SHOPIFY_CLIENT_ID: tiene('SHOPIFY_CLIENT_ID'),
      ADMIN_CLAVE: tiene('ADMIN_CLAVE'),
      FIREBASE_SERVICE_ACCOUNT: Boolean(config().firebase),  // avisos al móvil de la app (válida, no solo puesta)
      RESEND_API_KEY: tiene('RESEND_API_KEY'),
      CRON_SECRET: tiene('CRON_SECRET')                      // el repaso diario de las alertas de búsqueda
    }
  };
  if (new URL(req.url, 'https://x').searchParams.get('prueba')) {
    const cfg = config();
    const db = supabase(cfg);
    const proyecto = (cfg.supabaseUrl.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1] || 'desconocido';
    salida.supabase = {
      proyecto,
      anuncios: await medir(async () => { if (!Array.isArray(await db('sidonia_anuncios_lista', { p_estado: 'ninguno' }))) throw new Error('sidonia_anuncios_lista: respuesta rara'); }),
      fotos: await medir(async () => {
        const r = await fetch(`${cfg.supabaseUrl}/storage/v1/bucket/anuncios`, {
          headers: { apikey: cfg.supabaseKey, ...(cfg.supabaseKey.startsWith('sb_') ? {} : { Authorization: `Bearer ${cfg.supabaseKey}` }) },
          signal: AbortSignal.timeout(8000)
        });
        if (!r.ok) throw new Error(`Storage bucket ${r.status}`);
      }),
      // La tabla de las alertas de búsqueda (sql/circulo.sql)
      alertas: await medir(async () => { await tablaAnuncios(cfg, fetch, 'alertas').leer('select=id&limit=1'); }),
      // Las estadísticas de la web (sql/estadisticas.sql)
      estadisticas: await medir(async () => { await db('sidonia_estadisticas', { p_dias: 1 }); })
    };
    salida.ok = salida.supabase.anuncios.ok && salida.supabase.fotos.ok;
  }
  res.status(200).json(salida);
}
