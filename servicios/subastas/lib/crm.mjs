/* SIDONIA · Clientes (CRM) en el panel: quién es quién y qué hace cada uno.
 *   ?estado=clientes[&dias=30]   → la lista: cada cliente con cuenta, con lo que ha hecho y lo «caliente» que está
 *   ?estado=clientes&csv=1       → la misma lista en CSV (Excel, Mailchimp…)
 *   ?estado=cliente&id=…         → un cliente: lo que ha mirado, guardado, contactado y buscado, y su historial
 *   ?estado=anuncio&h=…          → un anuncio: quién está interesado (con su email)
 * Lo que hace la gente lo apunta la web (estadisticas.mjs); quién es, la pestaña Clientes de siempre (tabla clientes).
 * Lo que hizo alguien antes de entrar con su cuenta, en el mismo navegador, también se le cuenta.
 * La base de datos: sql/estadisticas.sql (sidonia_crm_*).
 */
import { CABECERA, FAVICON } from './marca.mjs';
import { esc } from './circulo.mjs';
import { ESTILO, fmt, n, navPanel } from './estadisticas.mjs';

const fecha = (t, hora = true) => (t ? new Date(t).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: '2-digit', ...(hora ? { hour: '2-digit', minute: '2-digit' } : {}) }) : '—');

/** Hace cuánto: «hace 3 h», «hace 2 días» */
export function hace(t, ahora = Date.now()) {
  if (!t) return '—';
  const s = Math.max(0, (ahora - new Date(t).getTime()) / 1000);
  if (s < 3600) return `hace ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86400);
  return d < 60 ? `hace ${d} ${d === 1 ? 'día' : 'días'}` : fecha(t, false);
}

/**
 * Lo «caliente» que está: Caliente (ha contactado, ofertado o querido contactar en los últimos 14 días, o muchos puntos),
 * Templado (mira, guarda, busca) o Frío.
 */
export function temperatura(c, ahora = Date.now()) {
  const reciente = c.ultimo_contacto && ahora - new Date(c.ultimo_contacto).getTime() < 14 * 864e5;
  if (reciente || n(c.puntos) >= 25) return ['caliente', 'Caliente'];
  if (n(c.puntos) >= 6) return ['templado', 'Templado'];
  return ['frio', 'Frío'];
}

const marco = (titulo, on, cuerpo) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)} · Panel de Sidonia</title><meta name="robots" content="noindex">${FAVICON}
<style>${ESTILO}
  .temp { display: inline-block; padding: 3px 9px; border-radius: 99px; font-size: 12px; font-weight: 700; white-space: nowrap; }
  .temp.caliente { background: #fde8e4; color: #b3261e; } .temp.templado { background: #fff3d6; color: #8a5a00; } .temp.frio { background: #eceae5; color: #5f5b53; }
  .cli b { display: block; } .cli a { font-size: 13px; }
  td.izq, th.izq { text-align: left; } td .sub { display: block; font-size: 12px; opacity: .55; }
  .filtros { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 0 0 14px; }
  .filtros input { padding: 9px 14px; border: 1px solid #0002; border-radius: 99px; font: inherit; font-size: 14px; min-width: 240px; background: #fff; }
  .boton { display: inline-block; padding: 9px 16px; border-radius: 99px; background: #1a1a1a; color: #fff !important; text-decoration: none; font-size: 14px; font-weight: 600; }
  .boton.claro { background: #fff; color: #1a1a1a !important; border: 1px solid #0002; }
  .cab { display: flex; flex-wrap: wrap; gap: 14px 24px; align-items: center; justify-content: space-between; }
  .cab h2 { font-size: 26px; margin: 0 0 4px; } .cab p { margin: 0; opacity: .65; font-size: 14px; }
  .hist { list-style: none; margin: 0; padding: 0; font-size: 14px; } .hist li { display: flex; gap: 12px; padding: 7px 0; border-bottom: 1px solid #0001; }
  .hist time { flex: none; width: 118px; opacity: .55; font-size: 13px; }
  .si { color: #1f8a4c; font-weight: 700; }
  tr[data-q] { cursor: pointer; } tr[data-q]:hover td { background: #00000005; }
</style></head><body>
${CABECERA}
${navPanel(on)}
${cuerpo}
</body></html>`;

const errorSql = (error) => (error ? `<p class="error">No se han podido leer los datos: ${esc(/sidonia_crm|function|eventos/.test(error) ? 'falta ejecutar otra vez sql/estadisticas.sql en Supabase › SQL Editor.' : error)}</p>` : '');

/* ---------------------------------------------------------------------------- La lista */
export function paginaClientesCrm(datos, { dias = 30, error = '', ahora = Date.now() } = {}) {
  const d = datos || {};
  const lista = d.lista || [];
  const temps = lista.map((c) => temperatura(c, ahora)[0]);
  const cuenta = (t) => temps.filter((x) => x === t).length;
  const periodos = [[7, '7 días'], [30, '30 días'], [90, '3 meses'], [365, '1 año']].map(([k, t]) => `<a href="?estado=clientes&dias=${k}" class="${k === dias ? 'on' : ''}">${t}</a>`).join('');
  const filas = lista.map((c, i) => {
    const [tk, tt] = temperatura(c, ahora);
    const buscar = `${c.email || ''} ${c.nombre || ''} ${c.le_interesa || ''}`.toLowerCase();
    return `<tr data-q="${esc(buscar)}" data-t="${tk}" onclick="if(!event.target.closest('a'))location.href='?estado=cliente&id=${encodeURIComponent(c.cliente)}'">
      <td class="izq cli"><b>${esc(c.nombre || '—')}</b><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></td>
      <td class="izq"><span class="temp ${tk}">${tt}</span></td>
      <td>${fmt(c.vistas)}<span class="sub">${fmt(c.anuncios)} anuncios</span></td>
      <td>${fmt(c.likes)}</td>
      <td>${fmt(c.contactos)}${n(c.quiso_contactar) ? `<span class="sub">+${fmt(c.quiso_contactar)} sin cuenta</span>` : ''}</td>
      <td>${fmt(c.ofertas)}</td><td>${fmt(c.busquedas)}</td><td>${fmt(c.alertas)}</td>
      <td class="izq">${c.le_interesa_handle ? `<a href="?estado=anuncio&h=${encodeURIComponent(c.le_interesa_handle)}">${esc(c.le_interesa || c.le_interesa_handle)}</a>` : '<span class="sub">—</span>'}</td>
      <td>${hace(c.actividad, ahora)}<span class="sub">alta ${fecha(c.primera, false)}</span></td>
      <td><a href="?estado=cliente&id=${encodeURIComponent(c.cliente)}">Ver ›</a></td></tr>`;
  }).join('');
  return marco('Clientes', 'clientes', `
<div class="per">${periodos}</div>
${errorSql(error)}
<div class="kpis">
  <div class="kpi"><b>${fmt(d.total)}</b><span>Clientes con cuenta</span><small>desde siempre</small></div>
  <div class="kpi"><b>${fmt(d.nuevos)}</b><span>Nuevos</span><small>en el periodo</small></div>
  <div class="kpi"><b>${fmt(d.activos)}</b><span>Activos</span><small>han hecho algo en el periodo</small></div>
  <div class="kpi"><b>${fmt(cuenta('caliente'))}</b><span>Calientes</span><small>han contactado u ofertado hace poco</small></div>
  <div class="kpi"><b>${fmt(cuenta('templado'))}</b><span>Templados</span><small>miran, guardan y buscan</small></div>
</div>
<div class="filtros">
  <input type="search" placeholder="Buscar por email, nombre o anuncio" oninput="filtrar()" id="q">
  <a class="boton claro" href="#" onclick="return ver('')">Todos</a>
  <a class="boton claro" href="#" onclick="return ver('caliente')">Calientes</a>
  <a class="boton claro" href="#" onclick="return ver('templado')">Templados</a>
  <a class="boton" href="?estado=clientes&dias=${dias}&csv=1">Descargar CSV</a>
</div>
<div class="card"><div class="tabla"><table>
  <thead><tr><th class="izq">Cliente</th><th class="izq">Interés</th><th>Fichas vistas</th><th>Me gusta</th><th>Contactos</th><th>Ofertas</th><th>Búsquedas</th><th>Alertas</th><th class="izq">Lo que más le interesa</th><th>Última actividad</th><th></th></tr></thead>
  <tbody>${filas || '<tr><td colspan="11" class="vacio">Aún no hay clientes con cuenta.</td></tr>'}</tbody>
</table></div></div>
<p class="nota">Los ${fmt(d.dias || dias)} últimos días. Solo salen las personas con cuenta (quien no se registra es anónimo: está en Estadísticas). Lo que alguien hizo antes de entrar con su cuenta, en el mismo navegador, también se le cuenta. «Interés»: Caliente si ha contactado, ofertado o querido contactar en las últimas 2 semanas.</p>
<script>
  let tFiltro = '';
  function ver(t) { tFiltro = t; filtrar(); return false; }
  function filtrar() {
    const q = document.getElementById('q').value.trim().toLowerCase();
    document.querySelectorAll('tr[data-q]').forEach((tr) => { tr.hidden = (q && !tr.dataset.q.includes(q)) || (tFiltro && tr.dataset.t !== tFiltro); });
  }
</script>`);
}

/** La lista en CSV (con ; y BOM, para que Excel lo abra bien) */
export function csvClientes(datos, ahora = Date.now()) {
  const cab = ['email', 'nombre', 'interes', 'fichas_vistas', 'anuncios_vistos', 'me_gusta', 'contactos', 'quiso_contactar_sin_cuenta', 'ofertas', 'busquedas', 'alertas', 'le_interesa', 'ultima_actividad', 'alta'];
  const celda = (v) => {
    const t = String(v ?? '');
    return /[;"\n\r]/.test(t) || /^[=+\-@]/.test(t) ? `"${t.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : t;
  };
  const filas = (datos?.lista || []).map((c) => [c.email, c.nombre, temperatura(c, ahora)[1], n(c.vistas), n(c.anuncios), n(c.likes), n(c.contactos), n(c.quiso_contactar), n(c.ofertas), n(c.busquedas), n(c.alertas), c.le_interesa || '', c.actividad || '', c.primera || ''].map(celda).join(';'));
  return `﻿${[cab.join(';'), ...filas].join('\r\n')}\r\n`;
}

/* ---------------------------------------------------------------------------- Un cliente */
const QUE = {
  visita: () => 'Entró en la web', vista: (e) => `Vio ${e.titulo ? `«${e.titulo}»` : 'un anuncio'}`, like: () => 'Le dio a me gusta', unlike: () => 'Quitó el me gusta',
  contacto: (e) => ({ whatsapp: 'Escribió por WhatsApp', llamar: 'Llamó', email: 'Escribió un email', registro: 'Quiso contactar (le pedimos la cuenta)' }[e.canal] || 'Contactó'),
  compartir: () => 'Compartió', busqueda: (e) => `Buscó «${e.q || ''}»`, alerta: () => 'Creó una alerta', oferta: () => 'Abrió «Hacer oferta»'
};

export function paginaCliente(datos, { tienda = 'https://sidonia.es', error = '', ahora = Date.now() } = {}) {
  const d = datos || {};
  const c = d.cliente || {};
  const r = d.resumen || {};
  if (!c.cliente && !error) return marco('Cliente', 'clientes', '<p class="vacio">No hemos encontrado a este cliente.</p><p><a href="?estado=clientes">‹ Volver a Clientes</a></p>');
  const anuncios = d.anuncios || [];
  const puntos = n(r.contactos) * 6 + n(r.quiso_contactar) * 5 + n(r.ofertas) * 8 + (d.alertas || []).length * 4 + n(r.likes) * 3 + n(r.busquedas) + n(r.vistas);
  const ultimoContacto = (d.historial || []).find((e) => e.tipo === 'contacto' || e.tipo === 'oferta')?.creado;
  const [tk, tt] = temperatura({ puntos, ultimo_contacto: ultimoContacto }, ahora);
  const nombre = c.nombre || (c.email || '').split('@')[0] || 'Cliente';
  const asunto = encodeURIComponent(anuncios[0]?.titulo ? `Sobre el ${anuncios[0].titulo}` : 'Desde Sidonia');
  const linkAnuncio = (h, t) => `<a href="${esc(tienda)}/products/${esc(h)}" target="_blank" rel="noopener">${esc(t || h)}</a>`;
  const filas = anuncios.map((a) => `<tr><td class="izq">${linkAnuncio(a.handle, a.titulo)}<span class="sub"><a href="?estado=anuncio&h=${encodeURIComponent(a.handle)}">Ver todos los interesados ›</a></span></td>
    <td>${fmt(a.vistas)}</td><td>${a.like ? '<span class="si">Sí</span>' : '—'}</td><td>${fmt(a.contactos)}${n(a.quiso_contactar) ? `<span class="sub">+${fmt(a.quiso_contactar)} sin cuenta</span>` : ''}</td><td>${fmt(a.ofertas)}</td><td>${hace(a.ultima, ahora)}</td></tr>`).join('');
  const busq = (d.busquedas || []).length ? `<div class="chips">${d.busquedas.map((b) => `<a href="${esc(tienda)}/search?q=${encodeURIComponent(b.q)}&type=product" target="_blank" rel="noopener">${esc(b.q)} <b>${fmt(b.n)}</b></a>`).join('')}</div>` : '<p class="vacio">No ha buscado nada.</p>';
  const alertas = (d.alertas || []).length ? `<ul class="hist">${d.alertas.map((a) => `<li><time>${fecha(a.creada, false)}</time><span>${esc(a.nombre)} <span class="sub">${fmt(a.avisos)} avisos enviados</span></span></li>`).join('')}</ul>` : '<p class="vacio">No tiene alertas.</p>';
  const hist = (d.historial || []).length ? `<ul class="hist">${d.historial.map((e) => `<li><time>${fecha(e.creado)}</time><span>${esc((QUE[e.tipo] || (() => e.tipo))(e))}${e.handle && e.tipo !== 'vista' ? ` · ${linkAnuncio(e.handle, e.titulo)}` : e.handle ? ` <a href="${esc(tienda)}/products/${esc(e.handle)}" target="_blank" rel="noopener">›</a>` : ''}</span></li>`).join('')}</ul>` : '<p class="vacio">Aún no ha hecho nada en la web.</p>';
  return marco(nombre, 'clientes', `
<p><a href="?estado=clientes">‹ Clientes</a></p>
${errorSql(error)}
<div class="card cab">
  <div><h2>${esc(nombre)} <span class="temp ${tk}">${tt}</span></h2>
    <p>${esc(c.email || '')} · cliente desde ${fecha(c.primera, false)} · ${fmt(c.visitas)} visitas con su cuenta · última actividad ${hace(r.ultima || c.ultima, ahora)}</p></div>
  <div><a class="boton" href="mailto:${esc(c.email)}?subject=${asunto}">Escribirle</a></div>
</div>
<div class="kpis">
  <div class="kpi"><b>${fmt(r.vistas)}</b><span>Fichas vistas</span><small>${fmt(anuncios.length)} anuncios distintos</small></div>
  <div class="kpi"><b>${fmt(r.likes)}</b><span>Me gusta</span></div>
  <div class="kpi"><b>${fmt(r.contactos)}</b><span>Contactos</span>${n(r.quiso_contactar) ? `<small>+${fmt(r.quiso_contactar)} antes de tener cuenta</small>` : ''}</div>
  <div class="kpi"><b>${fmt(r.ofertas)}</b><span>Ofertas</span></div>
  <div class="kpi"><b>${fmt(r.busquedas)}</b><span>Búsquedas</span></div>
  <div class="kpi"><b>${fmt((d.alertas || []).length)}</b><span>Alertas</span></div>
</div>
<div class="card"><h2>Lo que le interesa</h2><div class="tabla"><table>
  <thead><tr><th class="izq">Anuncio</th><th>Vistas</th><th>Me gusta</th><th>Contactos</th><th>Ofertas</th><th>Última vez</th></tr></thead>
  <tbody>${filas || '<tr><td colspan="6" class="vacio">Aún no ha mirado ningún anuncio.</td></tr>'}</tbody></table></div></div>
<div class="grid2">
  <div class="card"><h2>Lo que busca</h2>${busq}</div>
  <div class="card"><h2>Sus alertas</h2>${alertas}</div>
</div>
${(d.compras || []).length ? `<div class="card" style="margin-top:14px"><h2>Lo que nos ha comprado</h2><ul class="hist">${d.compras.map((o) => `<li><time>${o.fecha_venta ? fecha(o.fecha_venta, false) : '—'}</time><span><a href="?estado=operacion&id=${o.id}">${esc(o.titulo)}</a> · ${o.precio_venta ? `${fmt(Math.round(o.precio_venta))} €` : ''}</span></li>`).join('')}</ul></div>` : ''}
<div class="card" style="margin-top:14px"><h2>Historial</h2>${hist}</div>`);
}

/* ---------------------------------------------------------------------------- Un anuncio: quién está interesado */
export function paginaAnuncio(datos, { tienda = 'https://sidonia.es', error = '', ahora = Date.now() } = {}) {
  const d = datos || {};
  const t = d.total || {};
  const lista = d.interesados || [];
  const emails = lista.map((x) => x.email).filter(Boolean);
  const filas = lista.map((x) => `<tr onclick="if(!event.target.closest('a'))location.href='?estado=cliente&id=${encodeURIComponent(x.cliente)}'" data-q="1">
    <td class="izq cli"><b>${esc(x.nombre || '—')}</b><a href="mailto:${esc(x.email)}?subject=${encodeURIComponent(`Sobre el ${d.titulo || ''}`)}">${esc(x.email || '')}</a></td>
    <td>${fmt(x.vistas)}</td><td>${x.like ? '<span class="si">Sí</span>' : '—'}</td><td>${fmt(x.contactos)}${n(x.quiso_contactar) ? `<span class="sub">+${fmt(x.quiso_contactar)} sin cuenta</span>` : ''}</td><td>${fmt(x.ofertas)}</td><td>${hace(x.ultima, ahora)}</td>
    <td><a href="?estado=cliente&id=${encodeURIComponent(x.cliente)}">Ver ›</a></td></tr>`).join('');
  return marco(d.titulo || d.handle || 'Anuncio', 'estadisticas', `
<p><a href="?estado=estadisticas">‹ Estadísticas</a></p>
${errorSql(error)}
<div class="card cab">
  <div><h2>${esc(d.titulo || d.handle || '')}</h2><p><a href="${esc(tienda)}/products/${esc(d.handle || '')}" target="_blank" rel="noopener">Ver la ficha en sidonia.es ›</a></p></div>
  ${emails.length ? `<div><a class="boton" href="mailto:?bcc=${encodeURIComponent(emails.join(','))}&subject=${encodeURIComponent(`Sobre el ${d.titulo || ''}`)}">Escribir a los ${fmt(emails.length)} interesados</a></div>` : ''}
</div>
<div class="kpis">
  <div class="kpi"><b>${fmt(t.vistas)}</b><span>Vistas</span><small>${fmt(t.personas)} personas</small></div>
  <div class="kpi"><b>${fmt(t.likes)}</b><span>Me gusta</span></div>
  <div class="kpi"><b>${fmt(t.contactos)}</b><span>Contactos</span>${n(t.quiso_contactar) ? `<small>+${fmt(t.quiso_contactar)} quisieron sin cuenta</small>` : ''}</div>
  <div class="kpi"><b>${fmt(t.ofertas)}</b><span>Ofertas</span></div>
  <div class="kpi"><b>${fmt(lista.length)}</b><span>Interesados con cuenta</span><small>con su email, abajo</small></div>
</div>
<div class="card"><h2>Interesados</h2><div class="tabla"><table>
  <thead><tr><th class="izq">Cliente</th><th>Vistas</th><th>Me gusta</th><th>Contactos</th><th>Ofertas</th><th>Última vez</th><th></th></tr></thead>
  <tbody>${filas || '<tr><td colspan="7" class="vacio">Aún nadie con cuenta ha mirado este anuncio.</td></tr>'}</tbody></table></div></div>
<p class="nota">Los que más interés han mostrado arriba (ofertas, contactos y me gusta pesan más que mirar). Las vistas de gente sin cuenta cuentan en los totales, pero no se sabe quién es.</p>`);
}
