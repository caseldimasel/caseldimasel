/* SIDONIA · «Me gusta» de profesionales y eventos (sql/likes.sql). Los de los coches de alquiler: garaje.mjs.
 *   GET  api/likes?tipo=pro|evento  → { ok, n: { <ref>: cuántos }, mios: [refs] }   (mios, si ha entrado)
 *   POST api/likes { tipo, ref, on } → { ok, n, on }                                   (con su sesión)
 */
import { tablaAnuncios } from './circulo.mjs';
import { idPro } from './opiniones.mjs';

const TIPOS = ['pro', 'evento'];
export async function rutasLikes({ ruta, method, body }, cliente, cfg, deps) {
  if (ruta !== 'api/likes') return null;
  const json = (status, b, cache = 'no-store') => ({ status, headers: { 'Content-Type': 'application/json', 'Cache-Control': cache }, body: JSON.stringify(b) });
  const t = deps.likes || tablaAnuncios(cfg, deps.fetch, 'likes');
  const tipo = TIPOS.includes(body.tipo) ? body.tipo : '';
  if (!tipo) return json(400, { ok: false, error: 'datos' });
  const falta = (e) => json(200, { ok: false, error: /likes|relation|does not exist|42P01/.test(String(e.message)) ? 'sin-tabla' : 'motor' });
  if (method === 'GET') {
    try {
      const filas = await t.leer(`tipo=eq.${tipo}&select=ref,cliente&limit=50000`);
      const n = {};
      for (const f of filas) n[f.ref] = (n[f.ref] || 0) + 1;
      const mios = cliente ? filas.filter((f) => String(f.cliente) === String(cliente)).map((f) => f.ref) : [];
      return json(200, { ok: true, n, mios }, cliente ? 'no-store' : 'public, max-age=60');
    } catch (e) { return falta(e); }
  }
  if (method !== 'POST') return json(404, { ok: false, error: 'ruta' });
  if (!cliente) return json(200, { ok: false, error: 'login' });
  const ref = idPro(body.ref);
  if (ref.length < 2) return json(400, { ok: false, error: 'datos' });
  try {
    if (body.on) await t.guardar({ tipo, ref, cliente: String(cliente) }, 'tipo,ref,cliente');
    else await t.borrar(`tipo=eq.${tipo}&ref=eq.${ref}&cliente=eq.${encodeURIComponent(cliente)}`);
    const n = (await t.leer(`tipo=eq.${tipo}&ref=eq.${ref}&select=ref`)).length;
    return json(200, { ok: true, n, on: Boolean(body.on) });
  } catch (e) { return falta(e); }
}
