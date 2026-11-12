/* SIDONIA · Panel › Gestiones de venta y Alquileres.
 *
 * Gestiones de venta (?estado=gestiones): lo que llega desde «Te ayudamos a venderlo» (lib/venta.mjs) se guarda en la
 *   tabla «gestiones» (sql/gestiones.sql). Cada una con sus fotos, el coche, su historia y su ficha; un botón para
 *   escribirle por WhatsApp con el mensaje ya preparado; su estado (nueva, contactado, en gestión, vendido, descartada)
 *   y una nota. Las que llegan por otro lado (un email, una llamada) se pueden añadir a mano.
 *
 * Alquileres (?estado=alquileres): los vehículos que la gente pone en alquiler («Mi garaje»). Se publican solos; aquí se
 *   revisan: marcarlo como revisado, ocultarlo o volver a enseñarlo, rechazarlo (con un email al dueño), cambiar sus
 *   datos y sus fotos (quitar o elegir portada) o borrarlo.
 */
import { avisarEquipo, esc, tablaAnuncios, telefono as normTel, urlFoto } from './circulo.mjs';
import { enviarCorreo, P, plantilla } from './correos.mjs';
import { faltaParaAlquilar } from './cobros.mjs';

const tabla = (cfg, deps, n) => deps[n] || tablaAnuncios(cfg, deps.fetch, n);
const texto = (v, n) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
const fecha = (x) => (x ? new Date(x).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const titulo = (c) => [c.marca, c.modelo, c.anio].filter(Boolean).join(' ') || 'Vehículo';

export const ESTADOS_GESTION = { nueva: 'Nueva', contactado: 'Contactado', en_gestion: 'En gestión', vendido: 'Vendido', descartada: 'Descartada' };

/** Guarda una solicitud de gestión de venta (desde la web o a mano). Nunca rompe a quien la llama. */
export async function guardarGestion(cfg, deps, cliente, datos) {
  try {
    return await tabla(cfg, deps, 'gestiones').guardar({ cliente: String(cliente || ''), estado: 'nueva', datos, nota: '', actualizado: new Date().toISOString() }, 'id');
  } catch (e) { console.error('Sidonia · guardar gestión', e); return null; }
}

/** Cuántas hay por mirar (para el número rojo del menú y las tareas de la portada del panel) */
export async function contarSolicitudes(cfg, deps) {
  const c = { gestiones: 0, alquileres: 0 };
  try { c.gestiones = (await tabla(cfg, deps, 'gestiones').leer('estado=eq.nueva&select=id')).length; } catch (e) { /* sin la tabla aún */ }
  try { c.alquileres = (await tabla(cfg, deps, 'garaje').leer('alquiler=eq.true&select=id,alq')).filter((x) => !x.alq?.revisado).length; } catch (e) { /* sin garajes */ }
  return c;
}

const wa = (tel, nombre, coche) => {
  const t = String(tel || '').replace(/[^\d]/g, '');
  const msg = `Hola${nombre ? ` ${String(nombre).split(/\s+/)[0]}` : ''}, soy de Sidonia. Hemos visto que quieres que te ayudemos a vender tu ${coche}. ¿Te viene bien que hablemos un momento para contarte cómo lo haríamos?`;
  return t ? `https://wa.me/${t}?text=${encodeURIComponent(msg)}` : '';
};

const CSS = `
.sol { display: grid; gap: 14px; }
.sol .card { margin: 0; }
.sol-cab { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: baseline; justify-content: space-between; }
.sol-cab h3 { margin: 0; font-size: 1.2rem; }
.sol-cab .sub { color: var(--flojo, #777); font-size: 13px; }
.fotos-s { display: flex; gap: 6px; overflow-x: auto; margin: 10px 0; padding-bottom: 4px; }
.fotos-s a, .fotos-s label { position: relative; flex: none; }
.fotos-s img { width: 150px; height: 104px; object-fit: cover; border-radius: 10px; display: block; }
.fotos-s .portada { position: absolute; left: 6px; top: 6px; padding: 1px 6px; border-radius: 99px; background: #111; color: #fff; font-size: 11px; }
.fotos-s .quitar { position: absolute; right: 6px; top: 6px; display: flex; gap: 4px; align-items: center; padding: 2px 6px; border-radius: 99px; background: rgba(255,255,255,.92); font-size: 11px; font-weight: 600; }
.datos-s { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px 14px; margin: 8px 0; }
.datos-s div span { display: block; color: var(--flojo, #777); font-size: 12px; }
.datos-s div b { font-size: 14px; }
.historia-s { margin: 8px 0; white-space: pre-line; line-height: 1.5; }
.acciones-s { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; }
.boton.wa { background: #1f7a4d; color: #fff !important; border-color: #1f7a4d; }
.estado-s { padding: 2px 10px; border-radius: 99px; background: #f1f1f1; font-size: 12px; font-weight: 700; }
.estado-s.nueva { background: #111; color: #fff; }
.estado-s.oculto, .estado-s.descartada { background: #fbeeee; color: #a4161a; }
.editar-s { margin-top: 10px; border-top: 1px solid var(--linea, #eee); padding-top: 10px; }
.editar-s summary { cursor: pointer; font-weight: 700; }
.editar-s form { display: grid; gap: 10px; margin-top: 10px; }
.editar-s .fila { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr)); }
.editar-s label { display: grid; gap: 4px; font-size: 13px; font-weight: 600; }
.filtros-s { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 12px; }
.filtros-s a { padding: 6px 12px; border-radius: 99px; border: 1px solid var(--linea, #ddd); font-size: 13px; text-decoration: none; color: inherit; }
.filtros-s a.on { background: #111; color: #fff; border-color: #111; }
`;

/* ------------------------------------------------------------------ Gestiones de venta */
function tarjetaGestion(cfg, g) {
  const d = g.datos || {};
  const coche = [d.marca, d.modelo, d.anio].filter(Boolean).join(' ') || d.coche || 'Vehículo';
  const fotos = (d.fotos || []).map((f) => (/^https?:/.test(f) ? f : urlFoto(cfg, f)));
  const datos = [['Kilómetros', d.km ? `${d.km} km` : ''], ['Precio que le gustaría', d.precio ? `${d.precio} €` : ''], ['Dónde está', d.ubicacion], ['Nombre', d.nombre], ['Teléfono', d.telefono], ['Email', d.email], ['Llegó', fecha(g.creado)], ['Por', d.origen || 'la web']].filter(([, x]) => x);
  const enlaceWa = wa(d.telefono, d.nombre, coche);
  return `<article class="card" id="g${Number(g.id)}">
  <div class="sol-cab"><h3>${esc(coche)}</h3><span class="estado-s ${esc(g.estado)}">${esc(ESTADOS_GESTION[g.estado] || g.estado)}</span></div>
  ${fotos.length ? `<div class="fotos-s">${fotos.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Foto ${i + 1}" loading="lazy"></a>`).join('')}</div>` : ''}
  <div class="datos-s">${datos.map(([k, x]) => `<div><span>${esc(k)}</span><b>${esc(x)}</b></div>`).join('')}</div>
  ${d.historia ? `<p class="historia-s"><b>Su historia:</b> ${esc(d.historia)}</p>` : ''}
  ${(d.ficha || []).length ? `<p class="historia-s"><b>Ficha:</b> ${(d.ficha || []).map(([k, x]) => `${esc(k)}: ${esc(x)}`).join(' · ')}</p>` : ''}
  ${d.mecanica ? `<p class="historia-s"><b>Mecánica:</b> ${esc(d.mecanica)}</p>` : ''}
  <div class="acciones-s">
    ${enlaceWa ? `<a class="boton wa" href="${esc(enlaceWa)}" target="_blank" rel="noopener">Escribirle por WhatsApp</a>` : ''}
    ${d.telefono ? `<a class="boton claro" href="tel:${esc(String(d.telefono).replace(/\s/g, ''))}">Llamar</a>` : ''}
    ${d.email ? `<a class="boton claro" href="mailto:${esc(d.email)}?subject=${encodeURIComponent(`Tu ${coche} en Sidonia`)}">Email</a>` : ''}
  </div>
  <form method="post" action="?estado=gestiones#g${Number(g.id)}" class="acciones-s">
    <input type="hidden" name="accion" value="gestion"><input type="hidden" name="id" value="${Number(g.id)}">
    <select name="estado">${Object.entries(ESTADOS_GESTION).map(([k, t]) => `<option value="${k}"${k === g.estado ? ' selected' : ''}>${t}</option>`).join('')}</select>
    <input name="nota" value="${esc(g.nota || '')}" placeholder="Nota (quién le llamó, qué dijo…)" style="flex:1;min-width:200px">
    <button>Guardar</button>
  </form>
</article>`;
}

function paginaGestiones(cfg, lista, { ver, error, aviso }) {
  const cuenta = (k) => lista.filter((g) => g.estado === k).length;
  const vistas = ver === 'todas' ? lista : lista.filter((g) => g.estado === ver);
  return `${error ? `<p class="aviso mal">${esc(error)}</p>` : ''}${aviso ? `<p class="aviso">${esc(aviso)}</p>` : ''}
<div class="kpis">
  <div class="kpi"><span>Nuevas</span><b>${cuenta('nueva')}</b><small>sin contestar</small></div>
  <div class="kpi"><span>En marcha</span><b>${cuenta('contactado') + cuenta('en_gestion')}</b><small>contactados o en gestión</small></div>
  <div class="kpi"><span>Vendidos</span><b>${cuenta('vendido')}</b><small>de ${lista.length} solicitudes</small></div>
</div>
<nav class="filtros-s">${[['todas', 'Todas'], ...Object.entries(ESTADOS_GESTION)].map(([k, t]) => `<a href="?estado=gestiones&ver=${k}"${k === ver ? ' class="on"' : ''}>${t}${k === 'todas' ? ` (${lista.length})` : ` (${cuenta(k)})`}</a>`).join('')}</nav>
<div class="sol">${vistas.map((g) => tarjetaGestion(cfg, g)).join('') || '<p class="vacio">No hay solicitudes aquí.</p>'}</div>
<details class="card editar-s" style="margin-top:14px"><summary>Añadir una a mano (llegó por email, por teléfono…)</summary>
<form method="post" action="?estado=gestiones">
  <input type="hidden" name="accion" value="gestion-nueva">
  <div class="fila"><label>Marca<input name="marca" required></label><label>Modelo<input name="modelo" required></label><label>Año<input name="anio" inputmode="numeric"></label><label>Kilómetros<input name="km"></label></div>
  <div class="fila"><label>Nombre<input name="nombre" required></label><label>Teléfono<input name="telefono" type="tel" required></label><label>Email<input name="email" type="email"></label><label>Dónde está<input name="ubicacion"></label></div>
  <div class="fila"><label>Precio que le gustaría (€)<input name="precio" inputmode="numeric"></label><label>Llegó por<input name="origen" placeholder="Email, teléfono, Instagram…"></label></div>
  <label>Su historia / lo que contó<textarea name="historia" rows="3"></textarea></label>
  <button>Añadir</button>
</form></details>`;
}

/* ------------------------------------------------------------------ Alquileres */
function tarjetaAlquiler(cfg, c, p) {
  const a = c.alq || {};
  const rutas = c.fotos || [];
  const falta = faltaParaAlquilar(c, p, true);
  const legal = (p && p.alq_legal) || {};
  const estado = c.visible === false ? ['oculto', 'Oculto'] : falta.length ? ['oculto', `No se ve: falta ${falta.join(', ')}`] : a.revisado ? ['', 'Publicado · revisado'] : ['nueva', 'Publicado · sin revisar'];
  const tel = legal.telefono || '';
  const datos = [['Precio', a.hora ? `${a.hora} €/hora · mínimo ${a.min_horas || 1} h` : ''], ['Ciudad', a.ciudad], ['Plazas', a.plazas], ['Dueño', legal.nombre || p?.nombre || ''], ['Teléfono', tel], ['Email', legal.email || ''], ['DNI', legal.dni || ''], ['Subido', fecha(c.creado)]].filter(([, x]) => x);
  const f = (n, v, extra = '') => `<label>${n}<input name="${extra || n.toLowerCase()}" value="${esc(v ?? '')}"></label>`;
  return `<article class="card" id="a${Number(c.id)}">
  <div class="sol-cab"><h3>${esc(titulo(c))}</h3><span class="estado-s ${estado[0]}">${esc(estado[1])}</span></div>
  ${rutas.length ? `<form method="post" action="?estado=alquileres#a${Number(c.id)}"><input type="hidden" name="accion" value="alq-fotos"><input type="hidden" name="id" value="${Number(c.id)}">
    <div class="fotos-s">${rutas.map((r, i) => `<label><a href="${esc(urlFoto(cfg, r))}" target="_blank" rel="noopener"><img src="${esc(urlFoto(cfg, r))}" alt="Foto ${i + 1}" loading="lazy"></a>${i === 0 ? '<span class="portada">Portada</span>' : ''}<span class="quitar"><input type="checkbox" name="quitar" value="${i}"> Quitar</span></label>`).join('')}</div>
    <div class="acciones-s"><button class="claro">Quitar las marcadas</button><label style="font-size:13px">Portada: <select name="portada">${rutas.map((_, i) => `<option value="${i}">Foto ${i + 1}</option>`).join('')}</select></label><button class="claro" name="hacer" value="portada">Poner de portada</button></div></form>` : ''}
  <div class="datos-s">${datos.map(([k, x]) => `<div><span>${esc(k)}</span><b>${esc(x)}</b></div>`).join('')}</div>
  ${c.historia ? `<p class="historia-s"><b>Su historia:</b> ${esc(c.historia)}</p>` : ''}
  ${a.normas ? `<p class="historia-s"><b>Normas:</b> ${esc(a.normas)}</p>` : ''}
  <div class="acciones-s">
    <a class="boton claro" href="${esc(cfg.tienda)}/pages/alquiler?coche=${Number(c.id)}" target="_blank" rel="noopener">Ver en la web</a>
    ${tel ? `<a class="boton wa" href="https://wa.me/${esc(String(tel).replace(/[^\d]/g, '').replace(/^(?!34)(\d{9})$/, '34$1'))}" target="_blank" rel="noopener">WhatsApp al dueño</a>` : ''}
  </div>
  <form method="post" action="?estado=alquileres#a${Number(c.id)}" class="acciones-s">
    <input type="hidden" name="id" value="${Number(c.id)}">
    ${a.revisado ? '' : '<button name="accion" value="alq-revisado" class="si">Revisado: todo bien</button>'}
    ${c.visible === false ? '<button name="accion" value="alq-mostrar">Volver a enseñarlo</button>' : '<button name="accion" value="alq-ocultar" class="claro">Ocultarlo</button>'}
    <input name="motivo" placeholder="Motivo del rechazo (le llega por email)" style="flex:1;min-width:200px">
    <button name="accion" value="alq-rechazar" class="no">Rechazar</button>
    <button name="accion" value="alq-borrar" class="no" onclick="return confirm('¿Borrarlo del todo? No se puede deshacer.')">Borrar</button>
  </form>
  <details class="editar-s"><summary>Editar sus datos</summary>
  <form method="post" action="?estado=alquileres#a${Number(c.id)}">
    <input type="hidden" name="accion" value="alq-editar"><input type="hidden" name="id" value="${Number(c.id)}">
    <div class="fila">${f('Marca', c.marca)}${f('Modelo', c.modelo)}${f('Año', c.anio, 'anio')}${f('Plazas', a.plazas)}</div>
    <div class="fila">${f('€/hora', a.hora, 'hora')}${f('Mínimo de horas', a.min_horas, 'min_horas')}${f('Ciudad', a.ciudad)}</div>
    <label>Su historia<textarea name="historia" rows="4">${esc(c.historia || '')}</textarea></label>
    <label>Normas<input name="normas" value="${esc(a.normas || '')}"></label>
    <button>Guardar cambios</button>
  </form></details>
</article>`;
}

function paginaAlquileres(cfg, coches, perfiles, { ver, error, aviso }) {
  const de = Object.fromEntries(perfiles.map((p) => [String(p.cliente), p]));
  const sinRevisar = coches.filter((c) => !c.alq?.revisado);
  const vistos = ver === 'sin-revisar' ? sinRevisar : ver === 'ocultos' ? coches.filter((c) => c.visible === false) : coches;
  return `${error ? `<p class="aviso mal">${esc(error)}</p>` : ''}${aviso ? `<p class="aviso">${esc(aviso)}</p>` : ''}
<div class="kpis">
  <div class="kpi"><span>Sin revisar</span><b>${sinRevisar.length}</b><small>se publican solos: revísalos</small></div>
  <div class="kpi"><span>En alquiler</span><b>${coches.filter((c) => c.visible !== false).length}</b><small>visibles</small></div>
  <div class="kpi"><span>Ocultos</span><b>${coches.filter((c) => c.visible === false).length}</b><small>no se ven en la web</small></div>
</div>
<nav class="filtros-s">${[['sin-revisar', `Sin revisar (${sinRevisar.length})`], ['todos', `Todos (${coches.length})`], ['ocultos', 'Ocultos']].map(([k, t]) => `<a href="?estado=alquileres&ver=${k}"${k === ver ? ' class="on"' : ''}>${t}</a>`).join('')}</nav>
<div class="sol">${vistos.map((c) => tarjetaAlquiler(cfg, c, de[String(c.cliente)])).join('') || '<p class="vacio">No hay vehículos aquí.</p>'}</div>`;
}

/* ------------------------------------------------------------------ Rutas */
export async function rutasSolicitudes(req, cfg, deps, html, marco) {
  const s = req.query.estado;
  const b = req.body || {};
  let error = '', aviso = '';
  if (s === 'gestiones') {
    const tG = tabla(cfg, deps, 'gestiones');
    if (req.method === 'POST') {
      try {
        if (b.accion === 'gestion' && Number(b.id) && ESTADOS_GESTION[b.estado]) { await tG.cambiar(Number(b.id), { estado: b.estado, nota: texto(b.nota, 500), actualizado: new Date().toISOString() }); aviso = 'Guardado.'; }
        if (b.accion === 'gestion-nueva') {
          const d = { marca: texto(b.marca, 40), modelo: texto(b.modelo, 60), anio: texto(b.anio, 4), km: texto(b.km, 20), precio: texto(b.precio, 20), ubicacion: texto(b.ubicacion, 120),
            historia: texto(b.historia, 4000), nombre: texto(b.nombre, 80), telefono: normTel(b.telefono) || texto(b.telefono, 30), email: texto(b.email, 160), origen: texto(b.origen, 60) || 'a mano', fotos: [] };
          if (!d.marca || !d.nombre) error = 'Faltan la marca y el nombre.';
          else { await tG.guardar({ cliente: '', estado: 'nueva', datos: d, nota: '', actualizado: new Date().toISOString() }, 'id'); aviso = 'Añadida.'; }
        }
      } catch (e) { error = 'No se ha podido guardar: ejecuta sql/gestiones.sql en Supabase › SQL Editor.'; }
    }
    let lista = [];
    try { lista = await tG.leer('select=*&order=creado.desc&limit=2000'); } catch (e) { error = error || 'Las gestiones se guardan desde que ejecutes sql/gestiones.sql en Supabase › SQL Editor (mientras, os llegan por email).'; }
    const ver = ['todas', ...Object.keys(ESTADOS_GESTION)].includes(req.query.ver) ? req.query.ver : 'todas';
    return html(marco('Gestiones de venta', 'gestiones', paginaGestiones(cfg, lista, { ver, error, aviso }), CSS));
  }
  if (s === 'alquileres') {
    const tG = tabla(cfg, deps, 'garaje');
    if (req.method === 'POST' && Number(b.id)) {
      try {
        const [c] = await tG.leer(`id=eq.${Number(b.id)}&limit=1`);
        if (c) {
          const alq = c.alq || {};
          if (b.accion === 'alq-revisado') { await tG.cambiar(c.id, { alq: { ...alq, revisado: new Date().toISOString() } }); aviso = 'Marcado como revisado.'; }
          if (b.accion === 'alq-ocultar') { await tG.cambiar(c.id, { visible: false }); aviso = 'Oculto: ya no se ve en la web.'; }
          if (b.accion === 'alq-mostrar') { await tG.cambiar(c.id, { visible: true, alq: { ...alq, revisado: alq.revisado || new Date().toISOString() } }); aviso = 'Vuelve a verse en la web.'; }
          if (b.accion === 'alq-borrar') { await tG.borrar(`id=eq.${c.id}`); aviso = 'Borrado.'; }
          if (b.accion === 'alq-rechazar') {
            await tG.cambiar(c.id, { visible: false, alq: { ...alq, revisado: new Date().toISOString(), rechazado: texto(b.motivo, 400) || 'sí' } });
            const [p] = await tabla(cfg, deps, 'perfiles').leer(`cliente=eq.${encodeURIComponent(c.cliente)}&limit=1`).catch(() => []);
            const para = p?.alq_legal?.email || '';
            if (para) {
              const motivo = texto(b.motivo, 400);
              await enviarCorreo(cfg, para, `Tu ${titulo(c)} no está en Alquiler`, plantilla(cfg, null, { titulo: 'Necesitamos que lo revises', previa: `Hemos ocultado tu ${titulo(c)}.`,
                cuerpo: P(`Hemos revisado tu <b>${esc(titulo(c))}</b> y de momento no lo publicamos en Alquiler${motivo ? `: ${esc(motivo)}` : '.'}`) + P('Puedes cambiarlo desde tu garaje y escribirnos para que lo volvamos a revisar.'),
                boton: 'Ir a mi garaje', enlace: `${cfg.tienda}/pages/vende-con-nosotros?view=perfil#mi-garaje` }), deps.fetch).catch((e) => console.error(e));
            }
            aviso = para ? 'Rechazado y avisado por email.' : 'Rechazado (no tenemos su email para avisarle).';
          }
          if (b.accion === 'alq-editar') {
            const n = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
            await tG.cambiar(c.id, { marca: texto(b.marca, 40) || c.marca, modelo: texto(b.modelo, 60) || c.modelo, anio: Number(b.anio) || c.anio, historia: texto(b.historia, 4000),
              alq: { ...alq, hora: n(b.hora, 0, 5000) || alq.hora, min_horas: n(b.min_horas, 1, 24) || alq.min_horas, ciudad: texto(b.ciudad, 80), plazas: n(b.plazas, 0, 9) || alq.plazas, normas: texto(b.normas, 300) } });
            aviso = 'Cambios guardados.';
          }
          if (b.accion === 'alq-fotos') {
            let fotos = [...(c.fotos || [])];
            if (b.hacer === 'portada') { const i = Number(b.portada) || 0; if (fotos[i]) fotos = [fotos[i], ...fotos.filter((_, k) => k !== i)]; aviso = 'Portada cambiada.'; }
            else {
              const quitar = new Set([].concat(b.quitar || []).map(Number));
              const quedan = fotos.filter((_, i) => !quitar.has(i));
              if (!quedan.length) error = 'Tiene que quedar al menos una foto.'; else { fotos = quedan; aviso = `${quitar.size} ${quitar.size === 1 ? 'foto quitada' : 'fotos quitadas'}.`; }
            }
            if (!error) await tG.cambiar(c.id, { fotos });
          }
        }
      } catch (e) { console.error(e); error = 'No se ha podido guardar.'; }
    }
    let coches = [], perfiles = [];
    try {
      coches = await tG.leer('alquiler=eq.true&select=*&order=creado.desc&limit=1000');
      const ids = [...new Set(coches.map((c) => String(c.cliente)))];
      perfiles = ids.length ? await tabla(cfg, deps, 'perfiles').leer(`cliente=in.(${ids.map((x) => `"${x.replace(/"/g, '')}"`).join(',')})&select=*`) : [];
    } catch (e) { error = error || 'Los alquileres se ven aquí desde que ejecutes sql/garaje.sql y sql/reservas.sql en Supabase.'; }
    const ver = ['sin-revisar', 'todos', 'ocultos'].includes(req.query.ver) ? req.query.ver : (coches.some((c) => !c.alq?.revisado) ? 'sin-revisar' : 'todos');
    return html(marco('Alquileres', 'alquileres', paginaAlquileres(cfg, coches, perfiles, { ver, error, aviso }), CSS));
  }
  return null;
}
