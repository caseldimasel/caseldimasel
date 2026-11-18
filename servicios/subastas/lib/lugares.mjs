/* SIDONIA · Fotos de Google Maps de los talleres y los eventos (Places API New, con la clave de Google en Vercel).
 *
 * GET /tienda/foto?q=<nombre y dónde>&w=<ancho>  (directo, sin sesión)
 *   → { ok, url, autor, autor_url }  la primera foto de la ficha de Google Maps de ese sitio y quién la hizo.
 *   Google pide enseñar de quién es la foto («Foto: <autor> · Google»), por eso va el autor.
 *   Sin clave (GOOGLE_MAPS_KEY) o sin foto → { ok: false } y la web deja su icono.
 *
 * No se guarda ninguna foto (lo prohíben las condiciones de Google): se pide cada vez, y la respuesta se guarda unas
 * horas en la caché de Vercel para no pedirla en cada visita (y gastar lo mínimo de la cuota de Google).
 */
const BASE = 'https://places.googleapis.com/v1';
const CACHE_OK = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400';

const json = (status, b, cache = 'no-store') => ({ status, headers: { 'Content-Type': 'application/json', 'Cache-Control': cache }, body: JSON.stringify(b) });

export async function fotoLugar(query, cfg, deps = {}) {
  const f = deps.fetch || fetch;
  const q = String(query.q || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const w = Math.max(200, Math.min(1600, Number(query.w) || 800));
  if (q.length < 3) return json(400, { ok: false, error: 'datos' });
  if (!cfg.googleMapsKey) return json(200, { ok: false, error: 'sin-clave' }, 'public, s-maxage=600');
  try {
    // 1 · El sitio (el primero que encuentra Google con ese nombre y dónde), solo con sus fotos
    const r = await f(`${BASE}/places:searchText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': cfg.googleMapsKey, 'X-Goog-FieldMask': 'places.id,places.displayName,places.photos' },
      body: JSON.stringify({ textQuery: q, languageCode: 'es', regionCode: 'ES', pageSize: 1 }),
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) throw new Error(`Places ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
    const sitio = ((await r.json()).places || [])[0];
    const foto = sitio && (sitio.photos || [])[0];
    if (!foto) return json(200, { ok: false, error: 'sin-foto' }, 'public, s-maxage=86400');
    // 2 · La dirección de la foto (sin redirigir: así se puede guardar unas horas en la caché)
    const m = await f(`${BASE}/${foto.name}/media?maxWidthPx=${w}&skipHttpRedirect=true&key=${encodeURIComponent(cfg.googleMapsKey)}`, { signal: AbortSignal.timeout(8000) });
    if (!m.ok) throw new Error(`Places foto ${m.status}`);
    const { photoUri } = await m.json();
    if (!photoUri) return json(200, { ok: false, error: 'sin-foto' }, 'public, s-maxage=86400');
    const a = (foto.authorAttributions || [])[0] || {};
    return json(200, { ok: true, url: photoUri, autor: a.displayName || '', autor_url: a.uri || '', sitio: sitio.displayName?.text || '' }, CACHE_OK);
  } catch (e) {
    console.error('Sidonia · foto de Google Maps', e);
    return json(200, { ok: false, error: 'google' }, 'public, s-maxage=300');
  }
}
