/* SIDONIA · Panel › Estadísticas web › el detalle de cada cajita (al pulsarla).
 *   ?estado=estadisticas&dias=<1|7|30|90|365>&ver=<visitantes|vistas|contactos|likes|compartidos|registros|busquedas|alertas|ofertas>
 * En qué anuncios ha pasado (y cuánta gente distinta), por canal en los contactos, y lo último que ha pasado con la hora y
 * quién (si ha entrado con su cuenta: nombre y email, con enlace a su ficha de Clientes).
 * Lee directamente las tablas eventos, clientes y alertas (sql/estadisticas.sql y sql/circulo.sql): no hace falta SQL nuevo.
 */
import { esc, tablaAnuncios } from './circulo.mjs';
import { fmt } from './estadisticas.mjs';
import { marco } from './operaciones.mjs';

export const DETALLES = {
  visitantes: ['Visitantes', 'visita', 'Personas distintas que han entrado en la web (por navegador).'],
  vistas: ['Fichas vistas', 'vista', 'Cada vez que alguien abre un anuncio.'],
  contactos: ['Contactos', 'contacto', 'WhatsApp, llamada o email al vendedor desde la ficha.'],
  likes: ['Me gusta', 'like', 'Corazones puestos en un anuncio.'],
  compartidos: ['Compartidos', 'compartir', 'Veces que se comparte un anuncio.'],
  registros: ['Registros nuevos', null, 'Cuentas nuevas en la web.'],
  busquedas: ['Búsquedas', 'busqueda', 'Lo que escribe la gente en el buscador.'],
  alertas: ['Alertas creadas', null, '«Avísame cuando entre uno así».'],
  ofertas: ['Ofertas', 'oferta', 'Veces que se abre «Hacer oferta» en un anuncio.']
};
const CANAL = { whatsapp: 'WhatsApp', llamar: 'Llamada', email: 'Email', registro: 'Sin cuenta (le pedimos registrarse)' };
const ORIGEN = { directo: 'Directo', instagram: 'Instagram', google: 'Google', facebook: 'Facebook', whatsapp: 'WhatsApp', tiktok: 'TikTok', youtube: 'YouTube', app: 'App', email: 'Email (alertas)' };
const hora = (t, dias) => new Date(t).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', ...(dias > 1 ? { day: '2-digit', month: '2-digit' } : {}), hour: '2-digit', minute: '2-digit' });
export const periodoTexto = (dias) => (dias === 1 ? 'las últimas 24 horas' : `los últimos ${fmt(dias)} días`);

/** Junta los eventos por anuncio: veces, personas distintas, con cuenta y (contactos) por canal */
export function porAnuncio(eventos) {
  const m = new Map();
  for (const e of eventos.filter((x) => x.handle)) {
    if (!m.has(e.handle)) m.set(e.handle, { handle: e.handle, titulo: e.titulo || e.handle, n: 0, personas: new Set(), cuentas: new Set(), canales: {} });
    const x = m.get(e.handle);
    x.n += 1;
    if (e.sesion) x.personas.add(e.sesion);
    if (e.cliente) x.cuentas.add(e.cliente);
    if (e.canal) x.canales[e.canal] = (x.canales[e.canal] || 0) + 1;
    if (e.titulo) x.titulo = e.titulo;
  }
  return [...m.values()].map((x) => ({ ...x, personas: x.personas.size, cuentas: x.cuentas.size })).sort((a, b) => b.n - a.n || b.personas - a.personas);
}

const barras = (items) => {
  const max = Math.max(1, ...items.map((x) => x.n));
  return items.length ? `<ul class="bars">${items.map((x) => `<li><span class="bl">${esc(x.nombre)}</span><span class="bb"><i style="width:${((x.n / max) * 100).toFixed(1)}%"></i></span><b>${fmt(x.n)}</b></li>`).join('')}</ul>` : '<p class="vacio">Sin datos en este periodo.</p>';
};
const cuenta = (lista, campo) => Object.entries(lista.reduce((o, e) => { const k = campo(e); if (k) o[k] = (o[k] || 0) + 1; return o; }, {})).map(([nombre, v]) => ({ nombre, n: v })).sort((a, b) => b.n - a.n);
const persona = (c, quien) => (c ? `<a href="?estado=cliente&id=${encodeURIComponent(c)}">${esc(quien[c]?.nombre || quien[c]?.email || `Cliente ${c}`)}</a>${quien[c]?.email && quien[c]?.nombre ? `<span class="sub">${esc(quien[c].email)}</span>` : ''}` : '<span class="sub">Sin cuenta</span>');

export function paginaDetalle(ver, { dias, eventos = [], antes = 0, quien = {}, registros = [], alertas = [], error = '', tienda = 'https://sidonia.es' }) {
  const [titulo, , ayuda] = DETALLES[ver];
  const periodos = [[1, '24 h'], [7, '7 días'], [30, '30 días'], [90, '3 meses'], [365, '1 año']].map(([k, t]) => `<a href="?estado=estadisticas&dias=${k}&ver=${ver}" class="${k === dias ? 'on' : ''}">${t}</a>`).join('');
  const total = ver === 'visitantes' ? new Set(eventos.map((e) => e.sesion).filter(Boolean)).size : ver === 'registros' ? registros.length : ver === 'alertas' ? alertas.length : eventos.length;
  const d = antes ? Math.round(((total - antes) / antes) * 100) : null;
  const cambio = d == null ? (total ? '<em class="sube">nuevo</em>' : '') : d ? `<em class="${d > 0 ? 'sube' : 'baja'}">${d > 0 ? '+' : '−'}${Math.abs(d)} %</em>` : '<em>=</em>';
  const personas = new Set(eventos.map((e) => e.sesion).filter(Boolean)).size;
  const conCuenta = new Set(eventos.map((e) => e.cliente).filter(Boolean)).size;
  const link = (h, t) => `<a href="?estado=anuncio&h=${encodeURIComponent(h)}">${esc(t)}</a><span class="sub"><a href="${esc(tienda)}/products/${esc(h)}" target="_blank" rel="noopener">ver en la web</a></span>`;
  let cuerpo = '';

  if (['vistas', 'contactos', 'likes', 'compartidos', 'ofertas'].includes(ver)) {
    const anuncios = porAnuncio(eventos);
    const filas = anuncios.map((x) => `<tr><td class="izq">${link(x.handle, x.titulo)}</td><td><b>${fmt(x.n)}</b></td><td>${fmt(x.personas)}</td><td>${fmt(x.cuentas)}</td>${ver === 'contactos' ? `<td class="izq">${Object.entries(x.canales).map(([k, v]) => `${esc(CANAL[k] || k)} ${fmt(v)}`).join(' · ') || '—'}</td>` : ''}</tr>`).join('');
    cuerpo += `<div class="card"><h2>Por anuncio</h2><div class="tabla"><table><thead><tr><th class="izq">Anuncio</th><th>${esc(titulo)}</th><th>Personas</th><th>Con cuenta</th>${ver === 'contactos' ? '<th class="izq">Cómo</th>' : ''}</tr></thead>
      <tbody>${filas || `<tr><td colspan="5" class="vacio">Sin datos en ${periodoTexto(dias)}.</td></tr>`}</tbody></table></div></div>`;
    if (ver === 'contactos') cuerpo += `<div class="card"><h2>Cómo contactan</h2>${barras(cuenta(eventos, (e) => CANAL[e.canal] || e.canal))}</div>`;
  }
  if (ver === 'visitantes') {
    const visitas = eventos.filter((e) => e.tipo === 'visita');
    cuerpo += `<div class="grid2"><div class="card"><h2>De dónde vienen</h2>${barras(cuenta(visitas, (e) => ORIGEN[e.origen || 'directo'] || e.origen))}</div>
      <div class="card"><h2>Desde dónde</h2>${barras([{ nombre: 'Móvil', n: visitas.filter((e) => e.movil).length }, { nombre: 'Ordenador', n: visitas.filter((e) => !e.movil).length }, { nombre: 'Desde la app', n: visitas.filter((e) => e.app).length }, { nombre: 'Con su cuenta', n: visitas.filter((e) => e.cliente).length }])}</div></div>`;
  }
  if (ver === 'busquedas') {
    cuerpo += `<div class="card"><h2>Lo que más buscan</h2>${barras(cuenta(eventos, (e) => e.q).slice(0, 40))}</div>`;
  }
  if (ver === 'registros') {
    const filas = registros.map((c) => `<tr><td class="izq"><a href="?estado=cliente&id=${encodeURIComponent(c.cliente)}"><b>${esc(c.nombre || 'Sin nombre')}</b></a><span class="sub">${esc(c.email || '')}</span></td><td class="izq">${hora(c.primera, 2)}</td><td>${fmt(c.visitas)}</td><td class="izq">${hora(c.ultima, 2)}</td></tr>`).join('');
    cuerpo += `<div class="card"><h2>Cuentas nuevas</h2><div class="tabla"><table><thead><tr><th class="izq">Quién</th><th class="izq">Se registró</th><th>Veces que ha entrado</th><th class="izq">Última vez</th></tr></thead>
      <tbody>${filas || `<tr><td colspan="4" class="vacio">Nadie nuevo en ${periodoTexto(dias)}.</td></tr>`}</tbody></table></div></div>`;
  }
  if (ver === 'alertas') {
    const filas = alertas.map((x) => `<tr><td class="izq"><b>${esc(x.nombre)}</b></td><td class="izq">${persona(x.cliente, quien)}${x.email ? `<span class="sub">${esc(x.email)}</span>` : ''}</td><td class="izq">${hora(x.creada, 2)}</td><td>${x.activa ? 'Activa' : 'Borrada'}</td></tr>`).join('');
    cuerpo += `<div class="card"><h2>Alertas</h2><div class="tabla"><table><thead><tr><th class="izq">Qué busca</th><th class="izq">Quién</th><th class="izq">Cuándo</th><th>Estado</th></tr></thead>
      <tbody>${filas || `<tr><td colspan="4" class="vacio">Ninguna en ${periodoTexto(dias)}.</td></tr>`}</tbody></table></div></div>`;
  }
  // Lo último que ha pasado, con la hora y quién
  if (eventos.length && ver !== 'registros' && ver !== 'alertas') {
    const ultimos = eventos.slice(0, 80).map((e) => `<tr><td class="izq">${hora(e.creado, dias)}</td>
      <td class="izq">${e.handle ? `<a href="?estado=anuncio&h=${encodeURIComponent(e.handle)}">${esc(e.titulo || e.handle)}</a>` : e.q ? `«${esc(e.q)}»` : esc(ORIGEN[e.origen || 'directo'] || e.origen || '—')}</td>
      <td class="izq">${e.canal ? esc(CANAL[e.canal] || e.canal) : e.app ? 'App' : e.movil ? 'Móvil' : 'Ordenador'}</td><td class="izq">${persona(e.cliente, quien)}</td></tr>`).join('');
    cuerpo += `<div class="card"><h2>Lo último</h2><div class="tabla"><table><thead><tr><th class="izq">Cuándo</th><th class="izq">${ver === 'busquedas' ? 'Búsqueda' : ver === 'visitantes' ? 'De dónde' : 'Anuncio'}</th><th class="izq">${ver === 'contactos' ? 'Cómo' : 'Desde'}</th><th class="izq">Quién</th></tr></thead><tbody>${ultimos}</tbody></table></div></div>`;
  }
  return marco(titulo, 'estadisticas', `
<p><a href="?estado=estadisticas&dias=${dias}">‹ Estadísticas web</a></p>
<div class="per">${periodos}</div>
${error ? `<p class="aviso mal">No se han podido leer los datos: ${esc(error)}</p>` : ''}
<div class="kpis">
  <div class="kpi"><span>${esc(titulo)}</span><b>${fmt(total)}</b>${cambio}<small>${esc(ayuda)}</small></div>
  ${['vistas', 'contactos', 'likes', 'compartidos', 'ofertas', 'busquedas'].includes(ver) ? `<div class="kpi"><span>Personas distintas</span><b>${fmt(personas)}</b><small>${fmt(conCuenta)} con su cuenta</small></div>` : ''}
  ${ver === 'contactos' ? `<div class="kpi"><span>Anuncios contactados</span><b>${fmt(porAnuncio(eventos).length)}</b></div>` : ''}
</div>
<p class="nota">En ${periodoTexto(dias)}; el % compara con el periodo de antes.</p>
${cuerpo}`, '.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 14px; margin: 0 0 14px; } .card { margin: 0 0 14px; }');
}

/** Lee lo que hace falta y pinta el detalle */
export async function rutaDetalle(req, cfg, deps, html, dias) {
  const ver = String(req.query.ver);
  const desde = new Date(Date.now() - dias * 864e5).toISOString();
  const antesDe = new Date(Date.now() - 2 * dias * 864e5).toISOString();
  const t = (nombre) => deps[nombre] || tablaAnuncios(cfg, deps.fetch, nombre);
  const datos = { dias, tienda: cfg.tienda };
  try {
    const tipo = DETALLES[ver][1];
    if (tipo) {
      const filtro = `tipo=eq.${tipo}${ver === 'contactos' ? '&canal=neq.registro' : ''}`;
      datos.eventos = await t('eventos').leer(`${filtro}&creado=gte.${encodeURIComponent(desde)}&select=tipo,handle,titulo,canal,q,sesion,cliente,app,movil,origen,creado&order=creado.desc&limit=10000`);
      const previos = await t('eventos').leer(`${filtro}&creado=gte.${encodeURIComponent(antesDe)}&creado=lt.${encodeURIComponent(desde)}&select=sesion&limit=10000`);
      datos.antes = ver === 'visitantes' ? new Set(previos.map((e) => e.sesion).filter(Boolean)).size : previos.length;
      // Contactos: también los que quisieron contactar sin cuenta (aparte)
      if (ver === 'contactos') datos.eventos = [...datos.eventos, ...(await t('eventos').leer(`tipo=eq.contacto&canal=eq.registro&creado=gte.${encodeURIComponent(desde)}&select=tipo,handle,titulo,canal,sesion,cliente,app,movil,creado&order=creado.desc&limit=5000`))].sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
    } else if (ver === 'registros') {
      datos.registros = await t('clientes').leer(`primera=gte.${encodeURIComponent(desde)}&select=cliente,nombre,email,primera,ultima,visitas&order=primera.desc&limit=2000`);
      datos.antes = (await t('clientes').leer(`primera=gte.${encodeURIComponent(antesDe)}&primera=lt.${encodeURIComponent(desde)}&select=cliente&limit=5000`)).length;
    } else if (ver === 'alertas') {
      datos.alertas = await t('alertas').leer(`creada=gte.${encodeURIComponent(desde)}&select=nombre,cliente,email,creada,activa&order=creada.desc&limit=2000`);
      datos.antes = (await t('alertas').leer(`creada=gte.${encodeURIComponent(antesDe)}&creada=lt.${encodeURIComponent(desde)}&select=id&limit=5000`)).length;
    }
    // Quién es cada cliente (nombre y email)
    const ids = [...new Set([...(datos.eventos || []), ...(datos.alertas || [])].map((e) => e.cliente).filter((c) => /^\d+$/.test(String(c || ''))))].slice(0, 300);
    if (ids.length) (await t('clientes').leer(`cliente=in.(${ids.join(',')})&select=cliente,nombre,email`)).forEach((c) => { datos.quien = { ...(datos.quien || {}), [c.cliente]: c }; });
  } catch (e) {
    datos.error = /eventos|relation|schema/.test(e.message) ? 'falta ejecutar sql/estadisticas.sql en Supabase › SQL Editor.' : e.message;
  }
  return html(paginaDetalle(ver, datos));
}

