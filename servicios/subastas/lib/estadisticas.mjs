/* SIDONIA · Estadísticas de la web: lo que pasa en sidonia.es y en la app, en el panel (/admin › Estadísticas).
 *
 * El tema (snippets/sidonia-estadisticas.liquid) apunta cada cosa con POST /tienda/api/evento:
 *   visita (una por sesión del navegador, con de dónde viene), vista (una ficha), contacto (WhatsApp, llamar, email, o
 *   «registro» si le pedimos la cuenta antes), like / unlike (el corazón), compartir, busqueda, alerta y oferta.
 * Sin datos personales: un número al azar por navegador y, si ha entrado con su cuenta, su id de cliente.
 * La base de datos: sql/estadisticas.sql (tabla eventos y la función que lo resume todo).
 */
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
const n = (x) => Number(x) || 0;
const fmt = (x) => n(x).toLocaleString('es-ES');
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

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
    return `<rect x="${x.toFixed(1)}" y="${(H - pad - h).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" rx="3" fill="#1a1a1a" opacity=".85"><title>${fecha}: ${fmt(d.visitantes)} visitantes · ${fmt(d.vistas)} fichas vistas · ${fmt(d.contactos)} contactos</title></rect>`;
  }).join('');
  const puntos = dias.map((d, i) => `${(pad + i * bw + bw / 2).toFixed(1)},${(H - pad - (n(d.contactos) / maxC) * (H - pad * 2)).toFixed(1)}`).join(' ');
  const primero = new Date(`${dias[0].dia}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  const ultimo = new Date(`${dias[dias.length - 1].dia}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  return `<svg viewBox="0 0 ${W} ${H}" class="graf" role="img" aria-label="Visitantes y contactos por día">
    <line x1="${pad}" x2="${W - pad}" y1="${H - pad}" y2="${H - pad}" stroke="#0002"/>
    ${barras}
    <polyline points="${puntos}" fill="none" stroke="#1f8a4c" stroke-width="2.5" stroke-linejoin="round"/>
    <text x="${pad}" y="${H - 4}" font-size="12" fill="#0008">${primero}</text>
    <text x="${W - pad}" y="${H - 4}" font-size="12" fill="#0008" text-anchor="end">${ultimo}</text>
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
  const pestañas = '<a href="?estado=estadisticas" class="on">Estadísticas</a>' + Object.entries(ESTADOS).map(([k, v]) => `<a href="?estado=${k}">${v}</a>`).join('')
    + '<a href="?estado=cambios">Cambios</a><a href="?estado=propietarios">Propietarios</a><a href="?estado=ubicaciones">Ubicaciones</a><a href="?estado=clientes">Clientes</a><a href="?estado=avisos">Avisos</a>';
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

  const filas = (d.anuncios || []).map((x) => `<tr><td>${link(x.handle, x.titulo)}</td><td>${fmt(x.vistas)}</td><td>${fmt(x.personas)}</td><td>${fmt(x.likes)}</td><td>${fmt(x.guardados)}</td><td>${fmt(x.contactos)}${n(x.contactos_registro) ? ` <small>(+${fmt(x.contactos_registro)} sin cuenta)</small>` : ''}</td><td>${pct(x.contactos, x.vistas).toLocaleString('es-ES')} %</td><td>${fmt(x.compartidos)}</td></tr>`).join('');
  const canales = Object.entries(d.canales || {}).map(([k, v]) => ({ nombre: NOMBRE_CANAL[k] || k, n: v })).sort((x, y) => y.n - x.n);
  const origenes = (d.origenes || []).map((x) => ({ nombre: NOMBRE_ORIGEN(x.origen), n: x.n }));
  const dispositivos = [
    { nombre: 'Móvil', n: n(d.movil) },
    { nombre: 'Ordenador', n: Math.max(0, visitantes - n(d.movil)) },
    { nombre: 'Desde la app', n: n(d.app) },
    { nombre: 'Con su cuenta', n: n(d.con_cuenta) }
  ];
  const top = (lista, campo, titulo) => (lista || []).length
    ? `<ol class="top">${lista.map((x) => `<li>${link(x.handle, x.titulo)}<b>${fmt(x[campo])}</b></li>`).join('')}</ol>`
    : `<p class="vacio">${titulo}</p>`;
  const busquedas = (d.busquedas || []).length
    ? `<div class="chips">${d.busquedas.map((x) => `<a href="${esc(tienda)}/search?q=${encodeURIComponent(x.q)}&type=product" target="_blank" rel="noopener">${esc(x.q)} <b>${fmt(x.n)}</b></a>`).join('')}</div>`
    : '<p class="vacio">Aún nadie ha buscado nada.</p>';

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Estadísticas · Panel de Sidonia</title><meta name="robots" content="noindex">
<style>
  :root { font-family: system-ui, -apple-system, Segoe UI, sans-serif; color: #1a1a1a; background: #f6f5f2; }
  body { max-width: 1180px; margin: 0 auto; padding: 24px 16px 80px; }
  h1 { margin: 0; letter-spacing: .2em; font-size: 18px; }
  h2 { margin: 0 0 12px; font-size: 17px; }
  nav { display: flex; gap: 6px; flex-wrap: wrap; margin: 18px 0; }
  nav a { padding: 8px 14px; border: 1px solid #0002; border-radius: 99px; color: inherit; text-decoration: none; font-size: 14px; background: #fff; }
  nav a.on { border-color: #1a1a1a; font-weight: 700; }
  .per { display: inline-flex; gap: 2px; padding: 3px; border-radius: 99px; background: #0000000d; margin: 0 0 16px; }
  .per a { padding: 6px 14px; border-radius: 99px; color: inherit; text-decoration: none; font-size: 13px; }
  .per a.on { background: #fff; font-weight: 700; box-shadow: 0 1px 3px #0002; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin-bottom: 14px; }
  .kpi { position: relative; padding: 16px 18px; border-radius: 18px; background: #fff; }
  .kpi b { display: block; font-size: 30px; letter-spacing: -.02em; }
  .kpi span { display: block; font-size: 13px; opacity: .65; }
  .kpi small { display: block; margin-top: 4px; font-size: 11.5px; opacity: .45; }
  .kpi em { position: absolute; top: 16px; right: 16px; font-style: normal; font-size: 12px; font-weight: 700; opacity: .5; }
  .kpi em.sube { color: #1f8a4c; opacity: 1; } .kpi em.baja { color: #b3261e; opacity: 1; }
  .card { padding: 18px 20px; border-radius: 18px; background: #fff; margin-bottom: 14px; }
  .grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; }
  .grid2 .card { margin: 0; }
  .embudo { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; }
  .embudo div b { display: block; font-size: 26px; } .embudo div span { font-size: 13px; opacity: .6; }
  .embudo i { font-style: normal; opacity: .3; font-size: 22px; }
  .embudo p { flex-basis: 100%; margin: 6px 0 0; font-size: 14px; opacity: .8; }
  .graf { width: 100%; height: auto; display: block; }
  .ley { margin: 6px 0 0; font-size: 12px; opacity: .7; display: flex; align-items: center; gap: 6px; }
  .ley span { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-left: 10px; } .c1 { background: #1a1a1a; } .c2 { background: #1f8a4c; }
  .bars { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .bars li { display: grid; grid-template-columns: 150px 1fr 56px; align-items: center; gap: 10px; font-size: 14px; }
  .bb { height: 8px; border-radius: 99px; background: #0000000d; overflow: hidden; } .bb i { display: block; height: 100%; border-radius: 99px; background: #1a1a1a; }
  .bars b { text-align: right; }
  .top { margin: 0; padding-left: 20px; display: grid; gap: 6px; font-size: 14px; } .top li b { float: right; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chips a { padding: 6px 12px; border-radius: 99px; background: #0000000a; color: inherit; text-decoration: none; font-size: 14px; } .chips b { opacity: .5; margin-left: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { padding: 9px 10px; border-bottom: 1px solid #0001; text-align: right; vertical-align: top; } th:first-child, td:first-child { text-align: left; }
  th { font-weight: 600; opacity: .6; font-size: 11.5px; text-transform: uppercase; letter-spacing: .06em; }
  td small { opacity: .5; } a { color: inherit; }
  .tabla { overflow-x: auto; }
  .vacio, .nota { font-size: 13px; opacity: .6; } .error { padding: 12px 16px; border-radius: 12px; background: #fdecea; color: #8a1c13; font-size: 14px; }
</style></head><body>
<header><h1>SIDONIA · PANEL</h1></header>
<nav>${pestañas}</nav>
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
