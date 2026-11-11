/* SIDONIA · Mi garaje: los coches y motos de cada persona, aunque no los venda (sql/garaje.sql).
 * Cada coche: tipo, marca, modelo, año, cómo lo llama, su historia, lo que le ha hecho, fotos, si lo alquilaría
 * (con él al volante o sin conductor: entra en la lista de espera del alquiler, lib/alquiler.mjs) y si se ve en público.
 * La comunidad les da «me gusta». El perfil (perfiles) suma ciudad, Instagram, foto de portada y qué quiere recibir
 * (eventos y quedadas, la tienda, coches como los suyos).
 *
 * Con su sesión (el tema firma quién es):
 *   GET  api/garaje               → { ok, coches, perfil }      los suyos (también los ocultos)
 *   POST api/garaje               { id?, tipo, marca, modelo, anio, apodo, historia, mods, fotos, alquiler, alquiler_como, visible }
 *   POST api/garaje/borrar        { id }
 *   POST api/garaje/like          { id, on } → { ok, likes, liked }
 * Sin sesión (público):
 *   GET  api/garaje/publico?slug= → { ok, perfil, coches }       su garaje (solo los visibles), con «me gusta»
 *   GET  api/garaje/recientes     → { ok, coches }               lo último de la comunidad (?alquiler=1: los que se alquilarán)
 * Las fotos se suben como las de los anuncios (POST api/anuncio/fotos) y se guardan sus rutas.
 */
import { esc, perfilPublico, slugVendedor, tablaAnuncios, urlFoto } from './circulo.mjs';

export const GARAJE_MAX = 20;          // coches por persona
const FOTOS = 12;                      // fotos por coche
const texto = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
const tabla = (cfg, deps, nombre) => deps[nombre] || tablaAnuncios(cfg, deps.fetch, nombre);

const ent = (v, min, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0; };
const DIA = /^\d{4}-\d{2}-\d{2}$/;
export const USOS = ['boda', 'rodaje', 'finde', 'ruta', 'evento'];
/** Los planes del alquiler por horas: el dueño pone «desde X €/hora» y un mínimo de horas en los que ofrece */
export const PLANES = { boda: 'Boda', rodaje: 'Rodaje o sesión de fotos', evento: 'Evento', ruta: 'Ruta o paseo', escapada: 'Escapada o día entero' };
export function leerPlanes(p = {}) {
  const o = {};
  for (const k of Object.keys(PLANES)) {
    const x = p && p[k];
    const hora = ent(x?.hora, 0, 5000);
    if (hora > 0) o[k] = { hora, min: ent(x?.min, 1, 24) || 1 };
  }
  return o;
}
export const SEGUROS = { terceros: 'a terceros', ampliado: 'a terceros ampliado', 'todo-riesgo-franquicia': 'a todo riesgo con franquicia', 'todo-riesgo': 'a todo riesgo' };
/** Lo del anuncio de alquiler que no se enseña en público (va solo en el contrato) */
export const alqPublico = (alq = {}) => { const { entrega, matricula, seguro_poliza, vtc, ...pub } = alq; return { ...pub, con_licencia: Boolean(vtc) }; };
/** El anuncio de alquiler (como en Airbnb): precio por día, fianza, km, quién conduce, dónde, normas, reserva inmediata… */
export function leerAlq(a = {}) {
  return {
    precio: ent(a.precio, 0, 20000), precio_con: ent(a.precio_con, 0, 20000), horas: ent(a.horas, 0, 24) || 8, hora_extra: ent(a.hora_extra, 0, 2000), fianza: ent(a.fianza, 0, 100000), km: ent(a.km, 0, 5000), minimo: ent(a.minimo, 1, 30) || 1,
    plazas: ent(a.plazas, 0, 9), cambio: ['manual', 'auto'].includes(a.cambio) ? a.cambio : '',
    // Siempre con su dueño al volante: en Sidonia nadie conduce el coche de otro (sin licencias ni seguros de alquiler sin conductor)
    conductor: 'con',
    ciudad: texto(a.ciudad, 80), entrega: texto(a.entrega, 300), normas: texto(a.normas, 2000),
    inmediata: Boolean(a.inmediata), usos: (Array.isArray(a.usos) ? a.usos : []).filter((u) => USOS.includes(u)),
    // Para el contrato (alquiler con pago en la web): el coche, su seguro y su ITV, y la autorización si es con conductor
    matricula: texto(a.matricula, 12).toUpperCase().replace(/[\s-]/g, ''),
    seguro_compania: texto(a.seguro_compania, 60), seguro_poliza: texto(a.seguro_poliza, 40),
    seguro_tipo: SEGUROS[a.seguro_tipo] ? a.seguro_tipo : '', seguro_cubre: Boolean(a.seguro_cubre),
    itv_hasta: DIA.test(a.itv_hasta) ? a.itv_hasta : '', vtc: texto(a.vtc, 40),
    km_extra: Math.min(10, Math.max(0, Math.round((Number(a.km_extra) || 0) * 100) / 100)),
    edad_min: ent(a.edad_min, 18, 99) || 25, carne_min: a.carne_min === undefined || a.carne_min === '' ? 3 : ent(a.carne_min, 0, 30),
    // Por horas (como Airbnb, pero por horas): «desde X €/hora» en cada plan, y lo que suma con conductor si ofrece los dos
    // Un precio por hora para todo (boda, rodaje, evento…) y un mínimo de horas por día de reserva
    hora: ent(a.hora, 0, 5000), min_horas: ent(a.min_horas, 1, 24) || 1,
    planes: leerPlanes(a.planes), extra_con: 0,
    // Declaración responsable del dueño: el seguro, el conductor, las licencias y la ITV son cosa suya (Sidonia solo intermedia)
    declara: Boolean(a.declara)
  };
}
export const leerBloqueos = (l) => (Array.isArray(l) ? l : []).filter((x) => Array.isArray(x) && DIA.test(x[0]) && DIA.test(x[1] || x[0])).map((x) => [x[0], x[1] || x[0]].sort()).slice(0, 200);

/** Limpia un coche: { ok, coche } o { ok: false, error, campo } */
export function leerCoche(b = {}, cliente = '') {
  const carpeta = String(cliente).replace(/\W/g, '');
  const propia = new RegExp(`^${carpeta}/[a-z0-9-]{8,64}\\.(jpg|png|webp)$`);
  const anio = Number(b.anio) || null;
  const c = {
    tipo: b.tipo === 'moto' ? 'moto' : 'coche',
    marca: texto(b.marca, 40), modelo: texto(b.modelo, 60), anio: anio && anio >= 1885 && anio <= new Date().getFullYear() + 1 ? anio : null,
    apodo: texto(b.apodo, 40), historia: texto(b.historia, 4000), mods: texto(b.mods, 2000),
    fotos: (Array.isArray(b.fotos) ? b.fotos : []).map(String).filter((f) => propia.test(f)).slice(0, FOTOS),
    alquiler: Boolean(b.alquiler), alquiler_como: b.alquiler ? 'con' : '',
    visible: b.visible !== false,
    ...(b.alq ? { alq: leerAlq(b.alq) } : {}), ...(b.bloqueos ? { bloqueos: leerBloqueos(b.bloqueos) } : {})
  };
  if (!c.marca) return { ok: false, error: 'datos', campo: 'marca' };
  if (!c.modelo) return { ok: false, error: 'datos', campo: 'modelo' };
  if (!c.fotos.length) return { ok: false, error: 'datos', campo: 'fotos' };
  return { ok: true, coche: c };
}

/** Lo que se enseña de un coche */
export const cochePublico = (cfg, c, dueno = null, liked = false) => ({
  id: c.id, tipo: c.tipo, marca: c.marca, modelo: c.modelo, anio: c.anio, apodo: c.apodo || '', historia: c.historia || '', mods: c.mods || '',
  titulo: [c.marca, c.modelo, c.anio].filter(Boolean).join(' '),
  fotos: (c.fotos || []).map((f) => urlFoto(cfg, f)), alquiler: Boolean(c.alquiler), alquiler_como: c.alquiler_como || '',
  likes: Number(c.likes) || 0, liked, creado: c.creado,
  alq: alqPublico(c.alq || {}), bloqueos: c.bloqueos || [],
  ...(dueno ? { dueno: { slug: dueno.slug, nombre: dueno.nombre, foto: dueno.foto ? urlFoto(cfg, dueno.foto) : '', ciudad: dueno.ciudad || '' } } : {})
});

/** El perfil con lo del garaje (ciudad, Instagram y portada ya van en perfilPublico) */
export const perfilGaraje = (cfg, p) => perfilPublico(cfg, p);

/** Lo que alguien ha dado «me gusta» (ids), para pintar los corazones */
async function misLikes(cfg, deps, cliente, ids) {
  if (!cliente || !ids.length) return new Set();
  try {
    const filas = await tabla(cfg, deps, 'garaje_likes').leer(`cliente=eq.${encodeURIComponent(cliente)}&coche=in.(${ids.map(Number).join(',')})&select=coche`);
    return new Set(filas.map((f) => Number(f.coche)));
  } catch (e) { return new Set(); }
}

/** Si lo alquilaría: a la lista de espera del alquiler, una vez por coche */
async function aLaListaDeAlquiler(cfg, deps, cliente, perfil, c, email) {
  try {
    const t = tabla(cfg, deps, 'alquiler');
    const coche = [c.marca, c.modelo, c.anio].filter(Boolean).join(' ');
    const ya = await t.leer(`cliente=eq.${encodeURIComponent(cliente)}&rol=eq.poner&coche=eq.${encodeURIComponent(coche)}&select=id&limit=1`).catch(() => []);
    if (ya.length) return;
    await t.guardar({ rol: 'poner', cliente, nombre: perfil?.nombre || '', email: email || '', ciudad: perfil?.ciudad || '', conductor: c.alquiler_como || '', coche, mensaje: 'Desde Mi garaje' }, 'id');
  } catch (e) { console.error(e); }
}

/** Las rutas del garaje: null si no es suya */
export async function rutasGaraje({ ruta, method, body }, cliente, cfg, deps) {
  if (!ruta.startsWith('api/garaje')) return null;
  const json = (status, b, cache = 'no-store') => ({ status, headers: { 'Content-Type': 'application/json', 'Cache-Control': cache }, body: JSON.stringify(b) });
  const tG = tabla(cfg, deps, 'garaje');
  const tP = tabla(cfg, deps, 'perfiles');
  const falta = (e) => json(200, { ok: false, error: /garaje|relation|does not exist|42P01/.test(String(e.message)) ? 'sin-tabla' : 'motor' });

  // Público: el garaje de alguien
  if (ruta === 'api/garaje/publico' && method === 'GET') {
    const slug = String(body.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 80);
    if (!slug) return json(400, { ok: false, error: 'datos' });
    try {
      const [p] = await tP.leer(`slug=eq.${slug}&limit=1`);
      if (!p) return json(200, { ok: true, perfil: null, coches: [] });
      const coches = await tG.leer(`cliente=eq.${encodeURIComponent(p.cliente)}&visible=eq.true&order=creado.desc&limit=${GARAJE_MAX}`);
      const mios = await misLikes(cfg, deps, cliente, coches.map((c) => c.id));
      return json(200, { ok: true, perfil: perfilGaraje(cfg, p), coches: coches.map((c) => cochePublico(cfg, c, null, mios.has(Number(c.id)))) }, cliente ? 'no-store' : 'public, max-age=30');
    } catch (e) { return falta(e); }
  }
  // Público: lo último de la comunidad
  if (ruta === 'api/garaje/recientes' && method === 'GET') {
    try {
      // ?alquiler=1: solo los que se podrán alquilar (la página «Alquiler»)
      const coches = await tG.leer(`visible=eq.true${String(body.alquiler) === '1' ? '&alquiler=eq.true' : ''}&order=creado.desc&limit=48`);
      const ids = [...new Set(coches.map((c) => c.cliente))];
      const perfiles = ids.length ? await tP.leer(`cliente=in.(${ids.map((x) => `"${String(x).replace(/"/g, '')}"`).join(',')})&select=cliente,slug,nombre,foto,ciudad`).catch(() => []) : [];
      const de = Object.fromEntries(perfiles.map((p) => [p.cliente, p]));
      const mios = await misLikes(cfg, deps, cliente, coches.map((c) => c.id));
      return json(200, { ok: true, coches: coches.filter((c) => de[c.cliente]?.slug).map((c) => cochePublico(cfg, c, de[c.cliente], mios.has(Number(c.id)))) }, cliente ? 'no-store' : 'public, max-age=30');
    } catch (e) { return falta(e); }
  }

  if (!cliente) return json(200, { ok: false, error: 'login' });

  // Los suyos (y su perfil, para su cabecera)
  if (ruta === 'api/garaje' && method === 'GET') {
    try {
      const coches = await tG.leer(`cliente=eq.${encodeURIComponent(cliente)}&order=creado.desc&limit=${GARAJE_MAX}`);
      const [p] = await tP.leer(`cliente=eq.${encodeURIComponent(cliente)}&limit=1`).catch(() => []);
      // Como en la venta: el primer anuncio de alquiler, gratis; los siguientes, de pago (si se cobra)
      const { leerTarifa, precioMes } = await import('./comunidad.mjs');
      const { cuotasAlquiler } = await import('./reservas.mjs');
      const tarifa = await leerTarifa(deps.ajustes || tablaAnuncios(cfg, deps.fetch, 'ajustes'));
      const cuotas = cuotasAlquiler(coches.filter((c) => c.alquiler && c.visible !== false), tarifa);
      // Alquiler con pago en la web: lo que le falta a cada coche para poder alquilarse (seguro, ITV, cobros…)
      const { faltaParaAlquilar } = await import('./cobros.mjs');
      return json(200, { ok: true, cobrar: Boolean(tarifa.cobrar), precio_siguiente: tarifa.cobrar ? precioMes(tarifa, cuotas.size + 1) : null, pago_web: Boolean(cfg.alquilerCobrar),
        coches: coches.map((c) => ({ ...cochePublico(cfg, c), alq: c.alq || {}, visible: c.visible !== false, rutas: c.fotos || [], cuota: cuotas.get(Number(c.id)) || null,
          falta: c.alquiler ? faltaParaAlquilar(c, p, cfg.alquilerCobrar) : [] })), perfil: perfilGaraje(cfg, p) || null });
    } catch (e) { return falta(e); }
  }
  // Añadir o cambiar un coche
  if (ruta === 'api/garaje' && method === 'POST') {
    const v = leerCoche(body, cliente);
    if (!v.ok) return json(400, v);
    try {
      let [p] = await tP.leer(`cliente=eq.${encodeURIComponent(cliente)}&limit=1`).catch(() => []);
      // Sin perfil todavía: uno con su nombre, para que su garaje tenga dirección pública
      if (!p) {
        const nombre = texto(body.nombre, 60) || 'Amante del motor';
        p = await tP.guardar({ cliente, slug: slugVendedor(nombre, cliente), nombre, tipo: 'particular', descripcion: '', foto: '', actualizado: new Date().toISOString() }, 'cliente');
      }
      const id = Number(body.id) || 0;
      let antes = null;
      if (id) {
        [antes] = await tG.leer(`id=eq.${id}&cliente=eq.${encodeURIComponent(cliente)}&limit=1`);
        if (!antes) return json(404, { ok: false, error: 'no-existe' });
        await tG.cambiar(id, { ...v.coche, actualizado: new Date().toISOString() });
      } else {
        if ((await tG.leer(`cliente=eq.${encodeURIComponent(cliente)}&select=id`)).length >= GARAJE_MAX) return json(200, { ok: false, error: 'maximo' });
        antes = await tG.guardar({ ...v.coche, cliente }, 'id');
      }
      // Lo alquilaría: a la lista de espera (solo la primera vez que lo marca)
      if (v.coche.alquiler && !(antes && antes.alquiler && id)) await aLaListaDeAlquiler(cfg, deps, cliente, p, v.coche, texto(body.email, 160));
      const [c] = await tG.leer(`id=eq.${id || Number(antes?.id)}&limit=1`).catch(() => []);
      return json(200, { ok: true, coche: c ? cochePublico(cfg, c) : null, slug: p.slug });
    } catch (e) { return falta(e); }
  }
  if (ruta === 'api/garaje/borrar' && method === 'POST') {
    const id = Number(body.id);
    if (!id) return json(400, { ok: false, error: 'datos' });
    try {
      await tG.borrar(`id=eq.${id}&cliente=eq.${encodeURIComponent(cliente)}`);
      return json(200, { ok: true });
    } catch (e) { return falta(e); }
  }
  // Me gusta (no a los suyos)
  if (ruta === 'api/garaje/like' && method === 'POST') {
    const id = Number(body.id);
    if (!id) return json(400, { ok: false, error: 'datos' });
    try {
      const [c] = await tG.leer(`id=eq.${id}&select=id,cliente&limit=1`);
      if (!c) return json(404, { ok: false, error: 'no-existe' });
      const tL = tabla(cfg, deps, 'garaje_likes');
      if (body.on) { if (String(c.cliente) !== String(cliente)) await tL.guardar({ coche: id, cliente }, 'coche,cliente'); } else await tL.borrar(`coche=eq.${id}&cliente=eq.${encodeURIComponent(cliente)}`);
      const likes = (await tL.leer(`coche=eq.${id}&select=coche`)).length;
      await tG.cambiar(id, { likes });
      return json(200, { ok: true, likes, liked: Boolean(body.on) && String(c.cliente) !== String(cliente) });
    } catch (e) { return falta(e); }
  }
  return json(404, { ok: false, error: 'ruta' });
}

/* ---------------------------------------------------------------------------- Panel › Clientes › Garajes */
export function paginaGarajes(coches, perfiles, { error = '', marco, tienda = 'https://sidonia.es' }) {
  const de = Object.fromEntries(perfiles.map((p) => [p.cliente, p]));
  const av = (k) => perfiles.filter((p) => p.avisos && p.avisos[k]).length;
  const fecha = (t) => new Date(t).toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: '2-digit' });
  const filas = coches.map((c) => {
    const p = de[c.cliente] || {};
    const foto = (c.fotos || [])[0];
    return `<tr><td class="izq">${foto ? `<img src="${esc(foto)}" alt="" style="width:64px;height:48px;object-fit:cover;border-radius:8px;vertical-align:middle;margin-right:10px">` : ''}<b>${esc([c.marca, c.modelo, c.anio].filter(Boolean).join(' '))}</b>${c.apodo ? `<span class="sub">«${esc(c.apodo)}»</span>` : ''}</td>
      <td class="izq">${p.slug ? `<a href="${esc(tienda)}/pages/vende-con-nosotros?view=garaje&u=${encodeURIComponent(p.slug)}" target="_blank" rel="noopener">${esc(p.nombre || '—')}</a>` : esc(p.nombre || '—')}${p.ciudad ? `<span class="sub">${esc(p.ciudad)}</span>` : ''}</td>
      <td>${Number(c.likes) || 0}</td><td>${c.alquiler ? (c.cuota ? (c.cuota.gratis ? '<span class="si">Gratis</span>' : `${c.cuota.activo ? '<span class="si">Activo</span>' : 'Sin pagar'}<span class="sub">${c.cuota.precio} €/mes${c.cuota.pagado_hasta ? ` · hasta ${fecha(c.cuota.pagado_hasta)}` : ''}</span><form method="post" action="?estado=garajes"><input type="hidden" name="accion" value="alq-mes"><input type="hidden" name="id" value="${Number(c.id)}"><button class="btn">+1 mes pagado</button></form>`) : '<span class="si">Sí</span>') : '—'}</td><td>${c.visible === false ? 'Oculto' : 'Público'}</td><td class="izq">${fecha(c.creado)}</td></tr>`;
  }).join('');
  return marco('Garajes', 'garajes', `
${error ? `<p class="aviso mal">${esc(error)}</p>` : ''}
<div class="kpis">
  <div class="kpi"><span>Coches en garajes</span><b>${coches.length}</b><small>${new Set(coches.map((c) => c.cliente)).size} personas</small></div>
  <div class="kpi"><span>Los alquilarían</span><b>${coches.filter((c) => c.alquiler).length}</b><small>entran en la lista del alquiler</small></div>
  <div class="kpi"><span>Me gusta</span><b>${coches.reduce((s, c) => s + (Number(c.likes) || 0), 0)}</b><small>de la comunidad</small></div>
  <div class="kpi"><span>Quieren eventos</span><b>${av('eventos')}</b><small>quedadas y rutas</small></div>
  <div class="kpi"><span>Quieren la tienda</span><b>${av('tienda')}</b><small>merchandising</small></div>
  <div class="kpi"><span>Quieren coches</span><b>${av('coches')}</b><small>avisos de coches como los suyos</small></div>
</div>
<div class="card"><div class="tabla"><table>
  <thead><tr><th class="izq">Coche</th><th class="izq">Dueño</th><th>Me gusta</th><th>Alquiler</th><th>Se ve</th><th class="izq">Añadido</th></tr></thead>
  <tbody>${filas || '<tr><td colspan="6" class="vacio">Aún nadie ha añadido su coche a su garaje.</td></tr>'}</tbody>
</table></div></div>
<p class="nota">Los coches que la comunidad enseña en «Mi garaje», aunque no los venda. Los que marcan «Lo alquilaría» entran también en Clientes › Alquiler.</p>`);
}
