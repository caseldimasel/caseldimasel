/* SIDONIA · Opiniones de los profesionales (sql/opiniones.sql): la comunidad puntúa (1 a 5) y cuenta qué tal le fue
 * con cada taller de «Profesionales». Una por persona y profesional; si vuelve a opinar, se cambia la suya.
 *
 * Sin sesión (público):
 *   GET  api/opiniones/resumen      → { ok, pros: { <pro>: { media, n } } }        las notas de todos (para las fichas)
 *   GET  api/opiniones?pro=<id>     → { ok, opiniones, media, n, mia }             las de uno (y la suya, si ha entrado)
 * Con su sesión (el tema firma quién es):
 *   POST api/opiniones              { pro, nota, texto, servicio, coche, nombre }  → { ok, opinion }
 *   POST api/opiniones/borrar       { pro }
 * El equipo las ve y oculta en el panel › Clientes › Opiniones.
 */
import { esc, tablaAnuncios } from './circulo.mjs';

const texto = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
const tabla = (cfg, deps) => deps.opiniones_pro || tablaAnuncios(cfg, deps.fetch, 'opiniones_pro');
export const idPro = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);

/** «Lucía Martín» → «Lucía M.» */
export function firma(nombre) {
  const p = texto(nombre, 60).split(/\s+/).filter(Boolean);
  if (!p.length) return 'Miembro de Sidonia';
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0].toUpperCase()}.` : p[0];
}

/** Limpia una opinión: { ok, opinion } o { ok: false, error, campo } */
export function leerOpinion(b = {}) {
  const o = { pro: idPro(b.pro), nota: Math.round(Number(b.nota)), texto: texto(b.texto, 1500), servicio: texto(b.servicio, 80), coche: texto(b.coche, 80) };
  if (o.pro.length < 2) return { ok: false, error: 'datos', campo: 'pro' };
  if (!(o.nota >= 1 && o.nota <= 5)) return { ok: false, error: 'datos', campo: 'nota' };
  if (o.texto.length < 10) return { ok: false, error: 'datos', campo: 'texto' };
  return { ok: true, opinion: o };
}

const publica = (o, cliente) => ({ id: o.id, nombre: o.nombre || 'Miembro de Sidonia', nota: o.nota, texto: o.texto, servicio: o.servicio || '', coche: o.coche || '', creado: o.creado, mia: Boolean(cliente) && String(o.cliente) === String(cliente) });
const media = (l) => (l.length ? Math.round((l.reduce((s, o) => s + Number(o.nota), 0) / l.length) * 10) / 10 : 0);

export async function rutasOpiniones({ ruta, method, body }, cliente, cfg, deps) {
  if (!ruta.startsWith('api/opiniones')) return null;
  const json = (status, b, cache = 'no-store') => ({ status, headers: { 'Content-Type': 'application/json', 'Cache-Control': cache }, body: JSON.stringify(b) });
  const t = tabla(cfg, deps);
  const falta = (e) => json(200, { ok: false, error: /opiniones_pro|relation|does not exist|42P01/.test(String(e.message)) ? 'sin-tabla' : 'motor' });

  if (ruta === 'api/opiniones/resumen' && method === 'GET') {
    try {
      const filas = await t.leer('visible=eq.true&select=pro,nota&limit=20000');
      const pros = {};
      for (const f of filas) (pros[f.pro] ||= []).push(f);
      return json(200, { ok: true, pros: Object.fromEntries(Object.entries(pros).map(([k, l]) => [k, { media: media(l), n: l.length }])) }, 'public, max-age=60');
    } catch (e) { return falta(e); }
  }
  if (ruta === 'api/opiniones' && method === 'GET') {
    const pro = idPro(body.pro);
    if (pro.length < 2) return json(400, { ok: false, error: 'datos' });
    try {
      const filas = await t.leer(`pro=eq.${pro}&visible=eq.true&order=creado.desc&limit=200`);
      const mia = cliente ? (await t.leer(`pro=eq.${pro}&cliente=eq.${encodeURIComponent(cliente)}&limit=1`).catch(() => []))[0] : null;
      return json(200, { ok: true, opiniones: filas.map((o) => publica(o, cliente)), media: media(filas), n: filas.length, mia: mia ? publica(mia, cliente) : null }, cliente ? 'no-store' : 'public, max-age=30');
    } catch (e) { return falta(e); }
  }

  if (!cliente) return json(200, { ok: false, error: 'login' });

  if (ruta === 'api/opiniones' && method === 'POST') {
    const v = leerOpinion(body);
    if (!v.ok) return json(400, v);
    try {
      // La firma: la de su perfil de Sidonia si lo tiene; si no, la que manda el tema (su nombre de cliente)
      const [p] = await (deps.perfiles || tablaAnuncios(cfg, deps.fetch, 'perfiles')).leer(`cliente=eq.${encodeURIComponent(cliente)}&select=nombre&limit=1`).catch(() => []);
      const fila = { ...v.opinion, cliente: String(cliente), nombre: firma(p?.nombre || body.nombre), actualizado: new Date().toISOString() };
      const o = await t.guardar(fila, 'pro,cliente');
      return json(200, { ok: true, opinion: publica({ ...fila, ...(o || {}) }, cliente) });
    } catch (e) { return falta(e); }
  }
  if (ruta === 'api/opiniones/borrar' && method === 'POST') {
    const pro = idPro(body.pro);
    if (pro.length < 2) return json(400, { ok: false, error: 'datos' });
    try {
      await t.borrar(`pro=eq.${pro}&cliente=eq.${encodeURIComponent(cliente)}`);
      return json(200, { ok: true });
    } catch (e) { return falta(e); }
  }
  return json(404, { ok: false, error: 'ruta' });
}

/* ---------------------------------------------------------------------------- Panel › Clientes › Opiniones */
export function paginaOpiniones(lista, { error = '', marco, tienda = 'https://sidonia.es' }) {
  const fecha = (x) => new Date(x).toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: '2-digit' });
  const estrellas = (n) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
  const visibles = lista.filter((o) => o.visible !== false);
  const filas = lista.map((o) => `<tr${o.visible === false ? ' style="opacity:.5"' : ''}>
    <td class="izq"><a href="${esc(tienda)}/pages/profesionales?p=${encodeURIComponent(o.pro)}" target="_blank" rel="noopener"><b>${esc(o.pro)}</b></a></td>
    <td style="color:#b7791f;white-space:nowrap">${estrellas(Number(o.nota) || 0)}</td>
    <td class="izq">${esc(o.texto)}${o.servicio || o.coche ? `<span class="sub">${esc([o.servicio, o.coche].filter(Boolean).join(' · '))}</span>` : ''}</td>
    <td class="izq">${esc(o.nombre || '—')}</td><td class="izq">${fecha(o.creado)}</td>
    <td><form method="post" action="?estado=opiniones"><input type="hidden" name="accion" value="opinion"><input type="hidden" name="id" value="${Number(o.id)}"><input type="hidden" name="visible" value="${o.visible === false ? '1' : '0'}"><button class="btn">${o.visible === false ? 'Mostrar' : 'Ocultar'}</button></form></td></tr>`).join('');
  return marco('Opiniones', 'opiniones', `
${error ? `<p class="aviso mal">${esc(error)}</p>` : ''}
<div class="kpis">
  <div class="kpi"><span>Opiniones</span><b>${visibles.length}</b><small>${lista.length - visibles.length} ocultas</small></div>
  <div class="kpi"><span>Nota media</span><b>${visibles.length ? media(visibles).toString().replace('.', ',') : '—'}</b><small>de 5</small></div>
  <div class="kpi"><span>Profesionales con opiniones</span><b>${new Set(visibles.map((o) => o.pro)).size}</b><small>en «Profesionales»</small></div>
</div>
<div class="card"><div class="tabla"><table>
  <thead><tr><th class="izq">Profesional</th><th>Nota</th><th class="izq">Opinión</th><th class="izq">De</th><th class="izq">Fecha</th><th></th></tr></thead>
  <tbody>${filas || '<tr><td colspan="6" class="vacio">Aún nadie ha opinado de un profesional.</td></tr>'}</tbody>
</table></div></div>
<p class="nota">Lo que cuenta la comunidad de cada taller en «Profesionales». «Ocultar» la quita de la web (no se borra).</p>`);
}
