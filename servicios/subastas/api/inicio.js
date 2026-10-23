/* SIDONIA · Portada del motor: es lo que enseña Shopify al abrir la app «Sidonia Subastas» desde Apps (la URL de la app
   apunta a la raíz). Sin ella, Vercel daba «404 · This page doesn't exist» y parecía que la app no estaba instalada. */
import { VERSION } from '../lib/motor.mjs';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sidonia · Motor de anuncios</title>
<style>
  body { margin: 0; font: 16px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1b1a18; background: #f6f5f2; }
  main { max-width: 560px; margin: 8vh auto; padding: 32px 24px; background: #fff; border-radius: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p { margin: 0 0 16px; color: #555; }
  a.btn { display: inline-block; padding: 12px 20px; border-radius: 999px; background: #1b1a18; color: #fff; text-decoration: none; font-weight: 600; }
  small { display: block; margin-top: 24px; color: #999; }
</style></head>
<body><main>
  <h1>✅ Motor de Sidonia conectado</h1>
  <p>La app está instalada. Aquí llegan los anuncios gratis que publica la gente en la web; desde el panel los revisas y los publicas en la tienda.</p>
  <a class="btn" href="/admin" target="_blank" rel="noopener">Abrir el panel de anuncios</a>
  <small>Versión ${VERSION}</small>
</main></body></html>`);
}
