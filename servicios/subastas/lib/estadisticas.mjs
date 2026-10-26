/* SIDONIA · Estadísticas de la web: lo que pasa en sidonia.es y en la app, en el panel (/admin › Estadísticas).
 *
 * El tema (snippets/sidonia-estadisticas.liquid) apunta cada cosa con POST /tienda/api/evento:
 *   visita (una por sesión del navegador, con de dónde viene), vista (una ficha), contacto (WhatsApp, llamar, email, o
 *   «registro» si le pedimos la cuenta antes), like / unlike (el corazón), compartir, busqueda, alerta y oferta.
 * Sin datos personales: un número al azar por navegador y, si ha entrado con su cuenta, su id de cliente.
 * La base de datos: sql/estadisticas.sql (tabla eventos y la función que lo resume todo).
 */
import { CABECERA, ESTILO_PANEL, FAVICON } from './marca.mjs';
import { ESTADOS, esc } from './circulo.mjs';

export const TIPOS = ['visita', 'vista', 'contacto', 'like', 'unlike', 'compartir', 'busqueda', 'alerta', 'oferta'];
const CANALES = ['whatsapp', 'llamar', 'email', 'registro'];
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse/i;

const corto = (v, n) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, n));

/** POST api/evento: lo apunta (sin fallar nunca hacia la web) */
export async function registrarEvento(db, body, cliente, headers = {}) {
  const tipo = String(body.tipo || '');
  if (!TIPOS.includes(tipo)) return { ok: false, error: 'tipo' };
  if (BOT.test(String(headers['user-agent'] || ''))) return { ok: true, bot: true };
  const origen = corto(body.origen, 40).toLowerCase().replace(/[^a-z0-9.-]/g, '');
  const evento = {
    tipo,
    handle: /^[a-z0-9][a-z0-9-]{0,159}$/.test(String(body.handle || '')) ? String(body.handle) : '',
    titulo: corto(body.titulo, 160),
    canal: CANALES.includes(body.canal) ? body.canal : '',
    q: tipo === 'busqueda' ? corto(body.q, 80) : '',
    sesion: /^[a-z0-9]{6,40}$/i.test(String(body.sesion || '')) ? String(body.sesion) : '',
    cliente: cliente ? String(cliente) : '',
    app: Boolean(body.app), movil: Boolean(body.movil),
    origen: tipo === 'visita' ? origen : ''
  };
  return db('sidonia_evento', { p: evento });
}

/* ---------------------------------------------------------------------------- La página del panel */
/**
 * Las pestañas del panel: arriba las secciones y, en la sección abierta, sus apartados (con cuántos hay por revisar).
 *   Ventas (centro operativo) · Anuncios (en la web, cobros de la comunidad y los de los dueños) · Clientes (interesados,
 *   anunciantes de la comunidad y propietarios de las ventas gestionadas) · Estadísticas web · Herramientas
 */
export const SECCIONES = [
  ['ventas', 'Ventas', [['ventas', 'Ventas'], ['enlazar', 'Enlazar a mano'], ['importar', 'Importar Excel']], ['operacion']],
  ['fichas', 'Anuncios', [['fichas', 'En la web'], ['cobros', 'Cobros comunidad'], ['pendiente', 'Por revisar'], ['cambios', 'Cambios'], ['aprobado', 'Aprobados'], ['publicado', 'Publicados'], ['vendido', 'Vendidos'], ['cancelados', 'Cancelados']], ['ficha', 'rechazado', 'retirado', 'cobrar', 'tarifa']],
  ['clientes', 'Clientes', [['clientes', 'Interesados'], ['anunciantes', 'Anunciantes · comunidad'], ['duenos', 'Propietarios · gestión']], ['cliente', 'anunciante']],
  ['estadisticas', 'Estadísticas web', [], ['anuncio']],
  ['herramientas', 'Herramientas', [['ubicaciones', 'Ubicaciones'], ['propietarios', 'Propietario en las fichas'], ['avisos', 'Avisos al móvil'], ['correos', 'Emails']], []]
];
let contadores = {};
/** Cuántos hay por revisar (para el número rojo de «Anuncios», «Por revisar» y «Cambios») */
export function ponerContadores(c) { contadores = c || {}; }

export function navPanel(on) {
  const seccion = SECCIONES.find(([k, , subs, otros]) => k === on || subs.some(([s]) => s === on) || otros.includes(on)) || SECCIONES[0];
  const num = (x) => (x ? ` <b class="num">${x}</b>` : '');
  const arriba = SECCIONES.map(([k, t]) => `<a href="?estado=${k}"${k === seccion[0] ? ' class="on"' : ''}>${t}${k === 'fichas' ? num((contadores.pendiente || 0) + (contadores.cambios || 0)) : ''}</a>`).join('');
  const subOn = { rechazado: 'cancelados', retirado: 'cancelados', operacion: 'ventas', ficha: 'fichas', cobrar: 'cobros', tarifa: 'cobros', cliente: 'clientes', anunciante: 'anunciantes' }[on] || on;
  const abajo = seccion[2].length ? `<nav class="sub">${seccion[2].map(([k, t]) => `<a href="?estado=${k}"${k === subOn ? ' class="on"' : ''}>${t}${k === 'pendiente' || k === 'cambios' ? num(contadores[k]) : ''}</a>`).join('')}</nav>` : '';
  return `<nav class="main">${arriba}</nav>${abajo}`;
}

/** El estilo de las páginas de Estadísticas y Clientes */
export const ESTILO = ESTILO_PANEL;
export const n = (x) => Number(x) || 0;
export const fmt = (x) => n(x).toLocaleString('es-ES');
export const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

/** «+12 %» en verde, «−5 %» en rojo, frente al periodo anterior */
function cambio(ahora, antes) {
  if (!n(antes)) return n(ahora) ? '<em class="sube">nuevo</em>' : '';
  const d = Math.round(((n(ahora) - n(antes)) / n(antes)) * 100);
  if (!d) return '<em>=</em>';
  return `<em class="${d > 0 ? 'sube' : 'baja'}">${d > 0 ? '+' : '−'}${Math.abs(d)} %</em>`;
}

/** Barras por día (visitantes) con los contactos encima: SVG sencillo, sin librerías */
function grafica(dias) {
  if (!dias.length) return '';
  const W = 1000, H = 220, pad = 24;
  const max = Math.max(1, ...dias.map((d) => n(d.visitantes)));
  const maxC = Math.max(1, ...dias.map((d) => n(d.contactos)));
  const bw = (W - pad * 2) / dias.length;
  const barras = dias.map((d, i) => {
    const h = (n(d.visitantes) / max) * (H - pad * 2);
    const x = pad + i * bw + bw * 0.15;
    const fecha = new Date(`${d.dia}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    return `<rect x="${x.toFixed(1)}" y="${(H - pad - h).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" rx="3" class="g-bar"><title>${fecha}: ${fmt(d.visitantes)} visitantes · ${fmt(d.vistas)} fichas vistas · ${fmt(d.contactos)} contactos</title></rect>`;
  }).join('');
  const puntos = dias.map((d, i) => `${(pad + i * bw + bw / 2).toFixed(1)},${(H - pad - (n(d.contactos) / maxC) * (H - pad * 2)).toFixed(1)}`).join(' ');
  const primero = new Date(`${dias[0].dia}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  const ultimo = new Date(`${dias[dias.length - 1].dia}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  return `<svg viewBox="0 0 ${W} ${H}" class="graf" role="img" aria-label="Visitantes y contactos por día">
    <line x1="${pad}" x2="${W - pad}" y1="${H - pad}" y2="${H - pad}" class="g-eje"/>
    ${barras}
    <polyline points="${puntos}" fill="none" class="g-linea" stroke-width="2.5" stroke-linejoin="round"/>
    <text x="${pad}" y="${H - 4}" font-size="12">${primero}</text>
    <text x="${W - pad}" y="${H - 4}" font-size="12" text-anchor="end">${ultimo}</text>
  </svg>
  <p class="ley"><span class="c1"></span>Visitantes por día (máx. ${fmt(max)}) <span class="c2"></span>Contactos (máx. ${fmt(maxC)})</p>`;
}

/** Lista con barra (canales, de dónde vienen…) */
function barras(items) {
  const max = Math.max(1, ...items.map((x) => n(x.n)));
  return items.length
    ? `<ul class="bars">${items.map((x) => `<li><span class="bl">${esc(x.nombre)}</span><span class="bb"><i style="width:${((n(x.n) / max) * 100).toFixed(1)}%"></i></span><b>${fmt(x.n)}</b></li>`).join('')}</ul>`
    : '<p class="vacio">Aún sin datos.</p>';
}

const NOMBRE_CANAL = { whatsapp: 'WhatsApp', llamar: 'Llamada', email: 'Email', registro: 'Les pedimos la cuenta', otro: 'Otro' };
const NOMBRE_ORIGEN = (o) => ({ directo: 'Directo / sin origen', 'instagram': 'Instagram', 'google': 'Google', 'facebook': 'Facebook', 'whatsapp': 'WhatsApp', 'tiktok': 'TikTok', 'youtube': 'YouTube', 'linkedin': 'LinkedIn', 'x': 'X (Twitter)', 'bing': 'Bing', 'app': 'App de Sidonia', 'email': 'Email (alertas)' }[o] || o);

export function paginaEstadisticas(datos, { dias = 30, error = '', tienda = 'https://sidonia.es' } = {}) {
  const d = datos || {};
  const a = d.actual || {};
  const b = d.anterior || {};
  const pestañas = navPanel('estadisticas');
  const periodos = [[7, '7 días'], [30, '30 días'], [90, '3 meses'], [365, '1 año']].map(([k, t]) => `<a href="?estado=estadisticas&dias=${k}" class="${k === dias ? 'on' : ''}">${t}</a>`).join('');
  const kpi = (valor, antes, titulo, ayuda) => `<div class="kpi"><b>${fmt(valor)}</b>${cambio(valor, antes)}<span>${titulo}</span>${ayuda ? `<small>${ayuda}</small>` : ''}</div>`;
  const link = (h, t) => `<a href="${esc(tienda)}/products/${esc(h)}" target="_blank" rel="noopener">${esc(t || h)}</a>`;

  const visitantes = n(a.visitantes);
  const conFicha = n(a.vistas);
  const contactos = n(a.contactos);
  const embudo = `<div class="embudo">
    <div><b>${fmt(visitantes)}</b><span>visitantes</span></div><i>→</i>
    <div><b>${fmt(conFicha)}</b><span>fichas vistas</span></div><i>→</i>
    <div><b>${fmt(contactos)}</b><span>contactos</span></div>
    <p>De cada 100 fichas vistas, <b>${pct(contactos, conFicha).toLocaleString('es-ES')}</b> acaban en un contacto.${n(a.contactos_registro) ? ` Además, <b>${fmt(a.contactos_registro)}</b> veces quisieron contactar sin cuenta y les pedimos registrarse.` : ''}</p>
  </div>`;

  const filas = (d.anuncios || []).map((x) => `<tr><td>${link(x.handle, x.titulo)}<br><a href="?estado=anuncio&h=${encodeURIComponent(x.handle)}" style="font-size:12px;opacity:.6">Quién está interesado ›</a></td><td>${fmt(x.vistas)}</td><td>${fmt(x.personas)}</td><td>${fmt(x.likes)}</td><td>${fmt(x.guardados)}</td><td>${fmt(x.contactos)}${n(x.contactos_registro) ? ` <small>(+${fmt(x.contactos_registro)} sin cuenta)</small>` : ''}</td><td>${pct(x.contactos, x.vistas).toLocaleString('es-ES')} %</td><td>${fmt(x.compartidos)}</td></tr>`).join('');
  const canales = Object.entries(d.canales || {}).map(([k, v]) => ({ nombre: NOMBRE_CANAL[k] || k, n: v })).sort((x, y) => y.n - x.n);
  const origenes = (d.origenes || []).map((x) => ({ nombre: NOMBRE_ORIGEN(x.origen), n: x.n }));
  const dispositivos = [
    { nombre: 'Móvil', n: n(d.movil) },
    { nombre: 'Ordenador', n: Math.max(0, visitantes - n(d.movil)) },
    { nombre: 'Desde la app', n: n(d.app) },
    { nombre: 'Con su cuenta', n: n(d.con_cuenta) }
  ];
  const top = (lista, campo, titulo) => (lista || []).length
    ? `<ol class="top">${lista.map((x) => `<li><a href="?estado=anuncio&h=${encodeURIComponent(x.handle)}">${esc(x.titulo || x.handle)}</a><b>${fmt(x[campo])}</b></li>`).join('')}</ol>`
    : `<p class="vacio">${titulo}</p>`;
  const busquedas = (d.busquedas || []).length
    ? `<div class="chips">${d.busquedas.map((x) => `<a href="${esc(tienda)}/search?q=${encodeURIComponent(x.q)}&type=product" target="_blank" rel="noopener">${esc(x.q)} <b>${fmt(x.n)}</b></a>`).join('')}</div>`
    : '<p class="vacio">Aún nadie ha buscado nada.</p>';

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Estadísticas web · Panel de Sidonia</title><meta name="robots" content="noindex">${FAVICON}
<style>${ESTILO}</style></head><body>
${CABECERA}
${pestañas}
<div class="per">${periodos}</div>
${error ? `<p class="error">No se han podido leer las estadísticas: ${esc(/eventos|sidonia_estadisticas|function/.test(error) ? 'falta ejecutar sql/estadisticas.sql en Supabase › SQL Editor.' : error)}</p>` : ''}
<div class="kpis">
  ${kpi(a.visitantes, b.visitantes, 'Visitantes', 'personas distintas (por navegador)')}
  ${kpi(a.vistas, b.vistas, 'Fichas vistas', 'veces que se ha abierto un anuncio')}
  ${kpi(a.contactos, b.contactos, 'Contactos', 'WhatsApp, llamada o email al vendedor')}
  ${kpi(a.likes, b.likes, 'Me gusta', 'corazones puestos')}
  ${kpi(a.compartidos, b.compartidos, 'Compartidos', '')}
  ${kpi(d.registros, d.registros_antes, 'Registros nuevos', 'cuentas nuevas')}
  ${kpi(a.busquedas, b.busquedas, 'Búsquedas', '')}
  ${kpi(a.alertas, b.alertas, 'Alertas creadas', '«Avísame cuando entre uno así»')}
  ${kpi(a.ofertas, b.ofertas, 'Ofertas', 'veces que se abre «Hacer oferta»')}
</div>
<p class="nota">Los últimos ${fmt(d.dias || dias)} días; el % compara con los ${fmt(d.dias || dias)} días de antes.</p>
<div class="card"><h2>Del vistazo al contacto</h2>${embudo}</div>
<div class="card"><h2>Día a día</h2>${grafica(d.por_dia || [])}</div>
<div class="grid2">
  <div class="card"><h2>Cómo contactan</h2>${barras(canales)}</div>
  <div class="card"><h2>De dónde vienen</h2>${barras(origenes)}</div>
  <div class="card"><h2>Desde dónde</h2>${barras(dispositivos)}</div>
</div>
<div class="card" style="margin-top:14px"><h2>Anuncios</h2><div class="tabla"><table>
  <thead><tr><th>Anuncio</th><th>Vistas</th><th>Personas</th><th>Me gusta</th><th>Guardados ahora</th><th>Contactos</th><th>% contacto</th><th>Compartidos</th></tr></thead>
  <tbody>${filas || '<tr><td colspan="8" class="vacio">Aún sin datos: se empieza a contar desde que se activa.</td></tr>'}</tbody>
</table></div></div>
<div class="grid2">
  <div class="card"><h2>Los más contactados</h2>${top(d.mas_contactados, 'contactos', 'Aún nadie ha contactado.')}</div>
  <div class="card"><h2>Los más guardados</h2>${top(d.mas_guardados, 'n', 'Aún nadie ha guardado nada.')}</div>
</div>
<div class="card" style="margin-top:14px"><h2>Lo que más busca la gente</h2>${busquedas}</div>
<p class="nota">Se cuenta desde que se activó (sin datos personales: un número al azar por navegador). «Guardados ahora» es desde siempre. Quién se registra, con su email, está en <a href="?estado=clientes">Clientes</a>.</p>
</body></html>`;
}
