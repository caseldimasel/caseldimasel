/* SIDONIA · Panel › Gestiones de venta y Alquileres.
 *
 * Gestiones de venta (?estado=gestiones): lo que llega desde «Te ayudamos a venderlo» (lib/venta.mjs) se guarda en la
 *   tabla «gestiones» (sql/gestiones.sql). Cada una con sus fotos, el coche, su historia y su ficha; un botón para
 *   escribirle por WhatsApp con el mensaje ya preparado; su estado (nueva, contactado, en gestión, vendido, descartada)
 *   y una nota. Las que llegan por otro lado (un email, una llamada) se pueden añadir a mano.
 *
 * Alquileres (?estado=alquileres): los vehículos que la gente pone en alquiler («Mi garaje»). Como los anuncios, no
 *   se publican solos: llegan «por revisar» (al dueño le llega «lo hemos recibido»), se editan si hace falta (datos,
 *   historia, fotos: quitar, añadir o elegir portada) y se aprueban (sale en Alquiler y le llega «ya está publicado») o
 *   se rechazan con el motivo (le llega por email; si lo cambia, vuelve aquí). Luego se pueden ocultar o borrar.
 */
import { avisarEquipo, esc, mayus, permisosSubida, tablaAnuncios, telefono as normTel, urlFoto } from './circulo.mjs';
import { enviarCorreo, P, plantilla } from './correos.mjs';
import { faltaParaAlquilar } from './cobros.mjs';

const tabla = (cfg, deps, n) => deps[n] || tablaAnuncios(cfg, deps.fetch, n);
const texto = (v, n) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
const fecha = (x) => (x ? new Date(x).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const titulo = (c) => mayus([c.marca, c.modelo, c.anio].filter(Boolean).join(' ')) || 'Vehículo';

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
  try { c.alquileres = (await tabla(cfg, deps, 'garaje').leer('alquiler=eq.true&select=id,alq')).filter(porRevisar).length; } catch (e) { /* sin garajes */ }
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
.estado-s.si { background: #e7f5ec; color: #1f7a4d; }
.fotos-ed-caja { margin: 10px 0 4px; padding: 12px; border: 1px solid var(--linea, rgba(255,255,255,.12)); border-radius: 14px; }
.fotos-ed-cab { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; margin-bottom: 8px; }
.fotos-ed-lista { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
.foto-ed { position: relative; border-radius: 12px; overflow: hidden; background: #000; cursor: grab; }
.foto-ed.arrastrando { opacity: .4; }
.foto-ed img { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; }
.foto-ed .portada, .foto-ed .num { position: absolute; left: 6px; top: 6px; padding: 1px 8px; border-radius: 99px; background: #111; color: #fff; font-size: 11px; font-weight: 700; }
.foto-ed .portada { background: var(--amarillo, #ffd23f); color: #111; }
.foto-bt { position: absolute; inset: auto 0 0; display: flex; justify-content: center; gap: 4px; padding: 6px; background: linear-gradient(transparent, rgba(0,0,0,.75)); }
.foto-bt button { width: 28px; height: 28px; padding: 0; border: 0; border-radius: 50%; background: rgba(255,255,255,.92); color: #111; font-size: 13px; line-height: 28px; cursor: pointer; }
.foto-bt button:disabled { opacity: .35; cursor: default; }
.foto-bt button[data-h="quitar"] { color: #b3261e; }
.ed-foto { width: min(1000px, 96vw); max-height: 94vh; padding: 16px; border: 0; border-radius: 18px; background: var(--caja, #141f1a); color: var(--texto, #eef4f0); }
.ed-foto::backdrop { background: rgba(0,0,0,.7); }
.ed-cab { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.ed-lienzo { position: relative; display: grid; place-items: center; background: #000; border-radius: 12px; overflow: hidden; }
.ed-lienzo canvas { display: block; max-width: 100%; max-height: 56vh; cursor: move; touch-action: none; }
.ed-lienzo [data-carga] { position: absolute; }
.ed-pista { margin: 6px 0 10px; }
.ed-ctl { display: grid; gap: 8px; }
.ed-fila { display: grid; grid-template-columns: 90px 1fr; gap: 10px; align-items: center; font-size: 13px; }
.ed-fila input[type=range] { width: 100%; }
.ed-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.ed-chips button { padding: 5px 12px; border: 1px solid rgba(127,127,127,.45) !important; border-radius: 99px; background: transparent !important; color: var(--texto, #eef4f0) !important; font: inherit; font-size: 13px; cursor: pointer; }
.fotos-ed-caja [hidden] { display: none !important; }
.ed-chips button.on { background: var(--verde, #2bd47d) !important; border-color: var(--verde, #2bd47d) !important; color: #111 !important; font-weight: 700; }
.ed-bts { display: flex; flex-wrap: wrap; gap: 8px; }
.ed-hueco { flex: 1; }
.pendiente-s { border: 2px solid var(--amarillo, #ffd23f) !important; }
.subir-s { cursor: pointer; }
.decidir-s { padding-top: 12px; border-top: 1px solid var(--linea, #eee); }
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
/** El editor de fotos del panel (en el navegador): ordenar, portada, quitar, añadir y editar (recortar, girar, luz) */
const FOTOS_JS = String.raw`(() => {
  const base = (document.querySelector('[data-foto-base]') || {}).dataset?.fotoBase || '';
  const url = (r) => (r.indexOf('blob:') === 0 ? r : base + r);
  const post = async (pares) => { const p = new URLSearchParams(); pares.forEach(([k, v]) => p.append(k, v)); const r = await fetch('?estado=alquileres', { method: 'POST', body: p, headers: { Accept: 'application/json' } }); return r.json(); };
  const reducir = (file) => new Promise((ok) => { const img = new Image(); img.onload = () => { const k = Math.min(1, 1600 / Math.max(img.width, img.height)); const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height); cv.toBlob((b) => ok(b || file), 'image/jpeg', 0.86); URL.revokeObjectURL(img.src); }; img.onerror = () => ok(file); img.src = URL.createObjectURL(file); });
  const subir = async (id, blobs, msg) => {
    const r = await post([['accion', 'alq-subir'], ['id', id], ['n', String(blobs.length)]]);
    if (!r.ok) throw new Error(r.error || 'permiso');
    for (let i = 0; i < blobs.length; i++) {
      msg('Subiendo ' + (i + 1) + ' de ' + blobs.length + '…');
      const s = await fetch(r.subidas[i].url, { method: 'PUT', body: blobs[i], headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'false' } });
      if (!s.ok) throw new Error('subida ' + s.status);
    }
    return r.subidas.map((x) => x.ruta);
  };

  /* El editor: formato (4:3 como la portada, 16:9, cuadrada u original), encuadre arrastrando, zoom, girar, luz, contraste y color */
  const editor = (src, alGuardar) => {
    let dlg = document.getElementById('ed-foto');
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'ed-foto'; dlg.className = 'ed-foto'; document.body.appendChild(dlg); }
    const FORMATOS = [['4:3', '4:3 · portada'], ['16:9', '16:9'], ['1:1', 'Cuadrada'], ['orig', 'Original']];
    dlg.innerHTML = '<div class="ed-cab"><b>Editar foto</b><button type="button" class="claro" data-x>Cerrar</button></div>'
      + '<div class="ed-lienzo"><canvas width="960" height="720"></canvas><p class="sub" data-carga>Cargando la foto…</p></div>'
      + '<p class="sub ed-pista">Arrastra la foto para encuadrarla. Lo que ves es exactamente lo que se guarda.</p>'
      + '<div class="ed-ctl"><div class="ed-fila"><span>Formato</span><div class="ed-chips">' + FORMATOS.map(([k, t]) => '<button type="button" data-f="' + k + '"' + (k === '4:3' ? ' class="on"' : '') + '>' + t + '</button>').join('') + '</div></div>'
      + '<label class="ed-fila"><span>Zoom</span><input type="range" min="1" max="3" step="0.01" value="1" data-v="z"></label>'
      + '<label class="ed-fila"><span>Luz</span><input type="range" min="50" max="170" value="100" data-v="b"></label>'
      + '<label class="ed-fila"><span>Contraste</span><input type="range" min="50" max="170" value="100" data-v="c"></label>'
      + '<label class="ed-fila"><span>Color</span><input type="range" min="0" max="200" value="100" data-v="s"></label>'
      + '<div class="ed-fila ed-bts"><button type="button" class="claro" data-g>↻ Girar</button><button type="button" class="claro" data-r>Deshacer cambios</button><span class="ed-hueco"></span><button type="button" class="si" data-ok>Guardar foto</button></div>'
      + '<p class="sub" data-m></p></div>';
    dlg.showModal();
    const cv = dlg.querySelector('canvas'), m = dlg.querySelector('[data-m]');
    const inicial = { f: '4:3', z: 1, b: 100, c: 100, s: 100, rot: 0, x: 0, y: 0 };
    let st = Object.assign({}, inicial);
    const img = new Image(); img.crossOrigin = 'anonymous';
    const dims = () => { const r = st.rot % 180 !== 0; const iw = r ? img.height : img.width, ih = r ? img.width : img.height; const asp = st.f === '4:3' ? 4 / 3 : st.f === '16:9' ? 16 / 9 : st.f === '1:1' ? 1 : iw / ih; return { iw, ih, asp }; };
    const rango = (W, H) => { const { iw, ih } = dims(); const k = Math.max(W / iw, H / ih) * st.z; return { k, mx: Math.max(0, (iw * k - W) / 2), my: Math.max(0, (ih * k - H) / 2) }; };
    const dibuja = (c) => {
      const W = c.width, H = c.height, g = c.getContext('2d'), { k, mx, my } = rango(W, H);
      g.save(); g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      g.filter = 'brightness(' + st.b + '%) contrast(' + st.c + '%) saturate(' + st.s + '%)';
      g.translate(W / 2 + st.x * mx, H / 2 + st.y * my); g.rotate(st.rot * Math.PI / 180);
      g.drawImage(img, -img.width * k / 2, -img.height * k / 2, img.width * k, img.height * k); g.restore();
    };
    const lienzo = () => { const { asp } = dims(); cv.width = 960; cv.height = Math.round(960 / asp); dibuja(cv); };
    const ctl = () => { dlg.querySelectorAll('[data-f]').forEach((b) => b.classList.toggle('on', b.dataset.f === st.f)); dlg.querySelectorAll('[data-v]').forEach((i) => { i.value = st[i.dataset.v]; }); };
    dlg.querySelector('[data-x]').onclick = () => dlg.close();
    dlg.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { st.f = b.dataset.f; st.x = 0; st.y = 0; ctl(); lienzo(); }; });
    dlg.querySelectorAll('[data-v]').forEach((i) => { i.oninput = () => { st[i.dataset.v] = Number(i.value); lienzo(); }; });
    dlg.querySelector('[data-g]').onclick = () => { st.rot = (st.rot + 90) % 360; st.x = 0; st.y = 0; lienzo(); };
    dlg.querySelector('[data-r]').onclick = () => { st = Object.assign({}, inicial); ctl(); lienzo(); };
    let arrastre = null;
    cv.addEventListener('pointerdown', (e) => { arrastre = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointerup', () => { arrastre = null; });
    cv.addEventListener('pointermove', (e) => {
      if (!arrastre) return;
      const esc = cv.width / cv.getBoundingClientRect().width, { mx, my } = rango(cv.width, cv.height);
      if (mx) st.x = Math.max(-1, Math.min(1, st.x + (e.clientX - arrastre.x) * esc / mx));
      if (my) st.y = Math.max(-1, Math.min(1, st.y + (e.clientY - arrastre.y) * esc / my));
      arrastre = { x: e.clientX, y: e.clientY }; lienzo();
    });
    dlg.querySelector('[data-ok]').onclick = () => {
      const { iw, asp } = dims(); const out = document.createElement('canvas');
      out.width = Math.min(1600, st.f === 'orig' ? iw : 1600); out.height = Math.round(out.width / asp); dibuja(out);
      try {
        out.toBlob(async (blob) => {
          if (!blob) { m.textContent = 'No se ha podido preparar la foto.'; return; }
          m.textContent = 'Guardando…';
          try { await alGuardar(blob); dlg.close(); } catch (e) { m.textContent = 'No se ha podido guardar (' + e.message + ').'; }
        }, 'image/jpeg', 0.88);
      } catch (e) { m.textContent = 'Esta foto no se puede editar desde aquí (el almacén no deja leerla). Descárgala, edítala y súbela con «Añadir fotos».'; }
    };
    img.onload = () => { const p = dlg.querySelector('[data-carga]'); if (p) p.remove(); lienzo(); };
    img.onerror = () => { const p = dlg.querySelector('[data-carga]'); if (p) p.textContent = 'No se ha podido cargar la foto.'; };
    img.src = src + (src.indexOf('?') > -1 ? '&' : '?') + 'ed=' + Date.now();
  };

  document.querySelectorAll('[data-fotos]').forEach((caja) => {
    const id = caja.dataset.fotos;
    let rutas = JSON.parse(caja.dataset.rutas || '[]'), guardadas = rutas.slice();
    const lista = caja.querySelector('[data-lista]'), bG = caja.querySelector('[data-guardar]'), bD = caja.querySelector('[data-deshacer]'), mEl = caja.querySelector('[data-msg]');
    const msg = (t) => { mEl.textContent = t; };
    const pinta = () => {
      lista.innerHTML = rutas.length ? '' : '<p class="vacio">Sin fotos.</p>';
      rutas.forEach((r, i) => {
        const d = document.createElement('div'); d.className = 'foto-ed'; d.draggable = true; d.dataset.i = i;
        d.innerHTML = '<img alt="Foto ' + (i + 1) + '" draggable="false">' + (i === 0 ? '<span class="portada">Portada</span>' : '<span class="num">' + (i + 1) + '</span>')
          + '<div class="foto-bt"><button type="button" data-h="izq" title="Mover a la izquierda"' + (i ? '' : ' disabled') + '>◀</button>'
          + '<button type="button" data-h="der" title="Mover a la derecha"' + (i < rutas.length - 1 ? '' : ' disabled') + '>▶</button>'
          + '<button type="button" data-h="portada" title="Poner de portada"' + (i ? '' : ' disabled') + '>★</button>'
          + '<button type="button" data-h="editar" title="Recortar, girar y ajustar la luz">✎</button>'
          + '<button type="button" data-h="quitar" title="Quitar">✕</button></div>';
        d.querySelector('img').src = url(r);
        lista.appendChild(d);
      });
      const cambio = rutas.join('|') !== guardadas.join('|');
      bG.hidden = !cambio; bD.hidden = !cambio;
    };
    const guarda = async (ok) => {
      msg('Guardando…');
      const d = await post([['accion', 'alq-fotos-orden'], ['id', id]].concat(rutas.map((r) => ['ruta', r])));
      if (!d.ok) { msg('No se ha podido guardar (' + (d.error || 'error') + ').'); return; }
      rutas = d.fotos.slice(); guardadas = d.fotos.slice(); pinta(); msg(ok || 'Guardado: así se ve ya en la web.');
    };
    lista.addEventListener('click', (e) => {
      const b = e.target.closest('[data-h]'); if (!b) return;
      const i = Number(b.closest('.foto-ed').dataset.i), h = b.dataset.h;
      if (h === 'editar') return editor(url(rutas[i]), async (blob) => { const [nueva] = await subir(id, [blob], msg); rutas[i] = nueva; await guarda('Foto editada y guardada.'); });
      if (h === 'izq' && i > 0) rutas.splice(i - 1, 2, rutas[i], rutas[i - 1]);
      if (h === 'der' && i < rutas.length - 1) rutas.splice(i, 2, rutas[i + 1], rutas[i]);
      if (h === 'portada') rutas = [rutas[i]].concat(rutas.filter((_, k) => k !== i));
      if (h === 'quitar') { if (rutas.length === 1) { msg('Tiene que quedar al menos una foto.'); return; } rutas = rutas.filter((_, k) => k !== i); }
      pinta(); msg('Cambios sin guardar.');
    });
    let desde = -1;
    lista.addEventListener('dragstart', (e) => { const d = e.target.closest('.foto-ed'); if (d) { desde = Number(d.dataset.i); d.classList.add('arrastrando'); } });
    lista.addEventListener('dragend', () => { lista.querySelectorAll('.arrastrando').forEach((x) => x.classList.remove('arrastrando')); });
    lista.addEventListener('dragover', (e) => { e.preventDefault(); });
    lista.addEventListener('drop', (e) => {
      e.preventDefault(); const d = e.target.closest('.foto-ed'); if (!d || desde < 0) return;
      const a = Number(d.dataset.i); const x = rutas.splice(desde, 1)[0]; rutas.splice(a, 0, x); desde = -1; pinta(); msg('Cambios sin guardar.');
    });
    bG.addEventListener('click', () => guarda());
    bD.addEventListener('click', () => { rutas = guardadas.slice(); pinta(); msg(''); });
    caja.querySelector('[data-subir]').addEventListener('change', async (ev) => {
      const files = Array.from(ev.target.files).filter((f) => f.type.indexOf('image/') === 0).slice(0, 20);
      ev.target.value = '';
      if (!files.length) return;
      try { const blobs = []; for (const f of files) blobs.push(await reducir(f)); const nuevas = await subir(id, blobs, msg); rutas = rutas.concat(nuevas); await guarda(nuevas.length === 1 ? 'Foto añadida.' : nuevas.length + ' fotos añadidas.'); }
      catch (e) { msg('No se han podido subir (' + e.message + ').'); }
    });
    pinta();
  });
})();
`;

/** Como los anuncios: pendiente (recibido, sin publicar) → publicado, o rechazado. Sin estado: de antes de la revisión. */
export const estadoAlq = (c) => {
  const e = c?.alq?.estado;
  if (e === 'pendiente' || e === 'rechazado' || e === 'publicado' || e === 'suspendido') return e;
  return c?.alq?.revisado ? 'publicado' : 'antiguo';
};
export const porRevisar = (c) => ['pendiente', 'antiguo'].includes(estadoAlq(c));
const ESTADO_ALQ = { suspendido: ['oculto', 'Suspendido por fallar a una reserva · no se ve'], pendiente: ['nueva', 'Por revisar · no se ve'], rechazado: ['oculto', 'Rechazado · no se ve'], antiguo: ['nueva', 'Publicado sin revisar'] };

function tarjetaAlquiler(cfg, c, p) {
  const a = c.alq || {};
  const rutas = c.fotos || [];
  const e = estadoAlq(c);
  const falta = faltaParaAlquilar(c, p, Boolean(cfg.alquilerCobrar)).filter((x) => x !== 'revision');
  const QUE = { precio: 'el precio', declara: 'su declaración', datos: 'sus datos para el contrato' };
  const legal = (p && p.alq_legal) || {};
  const estado = ESTADO_ALQ[e] || (c.visible === false ? ['oculto', 'Publicado · oculto'] : falta.length ? ['oculto', `Aprobado · no se ve: falta ${falta.map((x) => QUE[x] || x).join(', ')}`] : ['si', 'Publicado']);
  const tel = legal.telefono || '';
  const email = legal.email || a.contacto || '';
  const nombre = legal.nombre || p?.nombre || '';
  const sinVeh = ['matricula', 'itv_hasta', 'seguro_compania', 'seguro_poliza'].filter((k) => !a[k]);
  const datos = [['Precio', a.hora ? `${a.hora} €/hora · mínimo ${a.min_horas || 1} h` : ''], ['Matrícula', a.matricula], ['ITV hasta', a.itv_hasta], ['Seguro', [a.seguro_compania, a.seguro_poliza].filter(Boolean).join(' · ')], ['Ciudad', a.ciudad], ['Plazas', a.plazas],
    ['Para', (a.usos || []).map((u) => ({ boda: 'Bodas', rodaje: 'Rodajes y fotos', evento: 'Eventos', ruta: 'Rutas', finde: 'Escapadas' })[u] || u).join(', ')],
    ['Dueño', nombre], ['Teléfono', tel], ['Email', email], ['DNI', legal.dni || ''], ['Recibido', fecha(a.recibido || c.creado)], ['Publicado', fecha(a.publicado)]].filter(([, x]) => x);
  const f = (n, v, nom, extra = '') => `<label>${n}<input name="${nom}" value="${esc(v ?? '')}"${extra}></label>`;
  const id = Number(c.id);
  const waTxt = `Hola${nombre ? ` ${String(nombre).split(/\s+/)[0]}` : ''}, soy de Sidonia. Hemos recibido tu ${titulo(c)} para alquilar y antes de publicarlo queríamos comentarte una cosa: `;
  const waNum = String(tel).replace(/[^\d]/g, '').replace(/^(\d{9})$/, '34$1');
  return `<article class="card${porRevisar(c) ? ' pendiente-s' : ''}" id="a${id}">
  <div class="sol-cab"><h3>${esc(titulo(c))}</h3><span class="estado-s ${estado[0]}">${esc(estado[1])}</span></div>
  ${sinVeh.length ? `<p class="aviso">Le faltan datos del coche para el contrato (${sinVeh.join(', ')}). Se le piden al aceptar su primera reserva, o rellénalos en «Editar».</p>` : ''}
  ${e === 'suspendido' && a.suspendido ? `<p class="aviso mal">Suspendido el ${esc(fecha(a.suspendido.fecha))}: ${esc(a.suspendido.motivo || '')} (reserva #${Number(a.suspendido.reserva) || '—'}). Para levantarlo, pulsa «Publicar».</p>` : ''}
  ${a.rechazado && e === 'rechazado' ? `<p class="aviso mal">Motivo del rechazo: ${esc(a.rechazado)}</p>` : ''}
  ${a.rechazado_antes && e === 'pendiente' ? `<p class="aviso">Lo rechazasteis antes («${esc(a.rechazado_antes)}») y lo ha vuelto a mandar cambiado.</p>` : ''}
  <div class="fotos-ed-caja" data-fotos="${id}" data-rutas="${esc(JSON.stringify(rutas))}">
    <div class="fotos-ed-cab"><b>Fotos</b><span class="sub">La primera es la portada. Arrastra para ordenar, o usa los botones de cada foto. ✎ recorta, gira y ajusta la luz.</span></div>
    <div class="fotos-ed-lista" data-lista></div>
    <div class="acciones-s"><label class="boton claro subir-s">+ Añadir fotos<input type="file" accept="image/*" multiple data-subir hidden></label><button type="button" class="si" data-guardar hidden>Guardar cambios de fotos</button><button type="button" class="claro" data-deshacer hidden>Deshacer</button><span class="sub" data-msg></span></div>
  </div>
  <div class="datos-s">${datos.map(([k, x]) => `<div><span>${esc(k)}</span><b>${esc(x)}</b></div>`).join('')}</div>
  ${c.historia ? `<p class="historia-s"><b>Su historia:</b> ${esc(c.historia)}</p>` : '<p class="historia-s"><b>Su historia:</b> <i>sin escribir</i></p>'}
  ${a.normas ? `<p class="historia-s"><b>Normas:</b> ${esc(a.normas)}</p>` : ''}
  <div class="acciones-s">
    ${waNum ? `<a class="boton wa" href="https://wa.me/${esc(waNum)}?text=${encodeURIComponent(waTxt)}" target="_blank" rel="noopener">WhatsApp al dueño</a>` : ''}
    ${tel ? `<a class="boton claro" href="tel:${esc(tel)}">Llamar</a>` : ''}
    ${email ? `<a class="boton claro" href="mailto:${esc(email)}?subject=${encodeURIComponent(`Tu ${titulo(c)} en Sidonia`)}">Email</a>` : ''}
    ${['publicado', 'antiguo'].includes(e) && c.visible !== false ? `<a class="boton claro" href="${esc(cfg.tienda)}/pages/alquiler?coche=${id}" target="_blank" rel="noopener">Ver en la web</a>` : ''}
  </div>
  <details class="editar-s"${e === 'pendiente' ? ' open' : ''}><summary>Editar antes de publicar</summary>
  <form method="post" action="?estado=alquileres#a${id}">
    <input type="hidden" name="accion" value="alq-editar"><input type="hidden" name="id" value="${id}">
    <div class="fila">${f('Marca', c.marca, 'marca')}${f('Modelo', c.modelo, 'modelo')}${f('Año', c.anio, 'anio', ' inputmode="numeric"')}${f('Plazas', a.plazas, 'plazas', ' inputmode="numeric"')}</div>
    <div class="fila">${f('€/hora', a.hora, 'hora', ' inputmode="numeric"')}${f('Mínimo de horas', a.min_horas, 'min_horas', ' inputmode="numeric"')}${f('Ciudad', a.ciudad, 'ciudad')}</div>
    <div class="fila">${f('Matrícula', a.matricula, 'matricula')}${f('ITV hasta', a.itv_hasta, 'itv_hasta', ' type="date"')}${f('Compañía del seguro', a.seguro_compania, 'seguro_compania')}${f('N.º de póliza', a.seguro_poliza, 'seguro_poliza')}</div>
    <label>Su historia<textarea name="historia" rows="5">${esc(c.historia || '')}</textarea></label>
    <label>Normas<textarea name="normas" rows="2">${esc(a.normas || '')}</textarea></label>
    <button>Guardar cambios</button>
  </form></details>
  <form method="post" action="?estado=alquileres#a${id}" class="acciones-s decidir-s">
    <input type="hidden" name="id" value="${id}">
    ${e !== 'publicado' ? `<button name="accion" value="alq-publicar" class="si">${e === 'antiguo' ? 'Revisado: todo bien' : e === 'suspendido' ? 'Levantar la suspensión y publicar' : 'Aprobar y publicar'}</button>` : ''}
    ${e === 'publicado' || e === 'antiguo' ? (c.visible === false ? '<button name="accion" value="alq-mostrar" class="claro">Volver a enseñarlo</button>' : '<button name="accion" value="alq-ocultar" class="claro">Ocultarlo</button>') : ''}
    ${e !== 'rechazado' ? `<input name="motivo" placeholder="Motivo del rechazo (le llega por email)" style="flex:1;min-width:200px"><button name="accion" value="alq-rechazar" class="no">Rechazar</button>` : ''}
    <button name="accion" value="alq-borrar" class="no" data-confirmar="¿Borrarlo del todo? No se puede deshacer.">Borrar</button>
  </form>
</article>`;
}

function paginaAlquileres(cfg, coches, perfiles, { ver, error, aviso }) {
  const de = Object.fromEntries(perfiles.map((p) => [String(p.cliente), p]));
  const grupos = {
    revisar: coches.filter(porRevisar),
    publicados: coches.filter((c) => ['publicado', 'antiguo'].includes(estadoAlq(c)) && c.visible !== false),
    rechazados: coches.filter((c) => estadoAlq(c) === 'rechazado'),
    ocultos: coches.filter((c) => c.visible === false && estadoAlq(c) !== 'rechazado'),
    todos: coches
  };
  const nombres = { revisar: 'Por revisar', publicados: 'Publicados', rechazados: 'Rechazados', ocultos: 'Ocultos', todos: 'Todos' };
  return `${error ? `<p class="aviso mal">${esc(error)}</p>` : ''}${aviso ? `<p class="aviso">${esc(aviso)}</p>` : ''}
<div class="kpis">
  <div class="kpi"><span>Por revisar</span><b>${grupos.revisar.length}</b><small>no se publican hasta que los apruebes</small></div>
  <div class="kpi"><span>Publicados</span><b>${grupos.publicados.length}</b><small>en Alquiler</small></div>
  <div class="kpi"><span>Rechazados</span><b>${grupos.rechazados.length}</b><small>el dueño puede cambiarlo y volver a mandarlo</small></div>
</div>
<nav class="filtros-s">${Object.entries(nombres).map(([k, t]) => `<a href="?estado=alquileres&ver=${k}"${k === ver ? ' class="on"' : ''}>${t} (${grupos[k].length})</a>`).join('')}</nav>
<div class="sol" data-foto-base="${esc(urlFoto(cfg, ''))}">${grupos[ver].map((c) => tarjetaAlquiler(cfg, c, de[String(c.cliente)])).join('') || '<p class="vacio">No hay vehículos aquí.</p>'}</div>
<script>
document.querySelectorAll('[data-confirmar]').forEach((b) => b.addEventListener('click', (e) => { if (!confirm(b.dataset.confirmar)) e.preventDefault(); }));
document.querySelectorAll('form.decidir-s').forEach((f) => f.addEventListener('submit', (e) => {
  const b = e.submitter;
  if (b && b.value === 'alq-rechazar' && !f.motivo.value.trim() && !confirm('¿Rechazarlo sin decirle el motivo?')) return e.preventDefault();
  if (b && b.value === 'alq-publicar' && !confirm('¿Publicarlo en Alquiler? Le llega un email al dueño.')) return e.preventDefault();
  if (b) setTimeout(() => { b.disabled = true; b.textContent = 'Un momento…'; }, 0);
}));
</script>
<script>${FOTOS_JS}</script>`;
}

/** El email al dueño cuando Sidonia lo aprueba (si ya puede alquilarse) */
async function avisarPublicado(cfg, deps, c, p, para) {
  const t = titulo(c);
  const nombre = String(p?.alq_legal?.nombre || p?.nombre || '').split(/\s+/)[0];
  const html = plantilla(cfg, null, { titulo: '¡Ya está publicado!', previa: `Tu ${t} ya está en Alquiler.`,
    cuerpo: P(`Hola${nombre ? ` ${esc(nombre)}` : ''}:`) + P(`Hemos revisado tu <b>${esc(t)}</b> y ya está publicado en <b>Alquiler</b> de Sidonia: ya se puede reservar.`)
      + P('Cuando alguien lo reserve te llegará un email. Recuerda: siempre lo conduces tú. Puedes cambiar el precio o bloquear días en tu garaje cuando quieras.'),
    boton: 'Verlo en Alquiler', enlace: `${cfg.tienda || 'https://sidonia.es'}/pages/alquiler?coche=${Number(c.id)}` });
  await enviarCorreo(cfg, para, `Tu ${t} ya está en Alquiler`, html, deps.fetch);
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
    const json = (o) => ({ status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(o) });
    if (req.method === 'POST' && Number(b.id)) {
      try {
        const [c] = await tG.leer(`id=eq.${Number(b.id)}&limit=1`);
        if (!c && ['alq-subir', 'alq-fotos-orden'].includes(b.accion)) return json({ ok: false, error: 'no-existe' });
        if (c) {
          const alq = c.alq || {};
          const ahora = new Date().toISOString();
          const [p] = await tabla(cfg, deps, 'perfiles').leer(`cliente=eq.${encodeURIComponent(c.cliente)}&limit=1`).catch(() => []);
          const emailDe = async () => p?.alq_legal?.email || alq.contacto || (await (await import('./reservas.mjs')).emailDueno(cfg, deps, c.cliente).catch(() => ({}))).email || '';
          // Añadir fotos desde el panel: permisos para subirlas a su carpeta
          if (b.accion === 'alq-subir') {
            const n = Math.max(1, Math.min(20, Number(b.n) || 1));
            return json(await (deps.subidas || permisosSubida)(cfg, c.cliente, Array(n).fill('image/jpeg'), deps.fetch).catch((e) => ({ ok: false, error: String(e.message).slice(0, 120) })));
          }
          // El orden de las fotos (la primera es la portada), con las quitadas fuera y las nuevas o editadas dentro
          if (b.accion === 'alq-fotos-orden') {
            const carpeta = String(c.cliente).replace(/\W/g, '');
            const valida = (r) => (c.fotos || []).includes(r) || (r.startsWith(`${carpeta}/`) && /^[\w-]+\/[\w-]+\.(jpg|png|webp)$/.test(r));
            const fotos = [...new Set([].concat(b.ruta || []).map(String).filter(valida))].slice(0, 30);
            if (!fotos.length) return json({ ok: false, error: 'Tiene que quedar al menos una foto.' });
            await tG.cambiar(c.id, { fotos });
            return json({ ok: true, fotos });
          }
          if (b.accion === 'alq-fotos-nuevas') {
            const carpeta = String(c.cliente).replace(/\W/g, '');
            const nuevas = [].concat(b.ruta || []).map(String).filter((r) => r.startsWith(`${carpeta}/`) && /^[\w-]+\/[\w-]+\.(jpg|png|webp)$/.test(r));
            await tG.cambiar(c.id, { fotos: [...(c.fotos || []), ...nuevas].slice(0, 30) });
            aviso = `${nuevas.length} ${nuevas.length === 1 ? 'foto añadida' : 'fotos añadidas'}.`;
          }
          if (b.accion === 'alq-publicar') {
            const { rechazado, ...resto } = alq;
            const nuevo = { ...resto, estado: 'publicado', revisado: alq.revisado || ahora, publicado: alq.publicado || ahora };
            const listo = { ...c, visible: true, alq: nuevo };
            const falta = faltaParaAlquilar(listo, p, Boolean(cfg.alquilerCobrar));
            const para = await emailDe();
            if (!falta.length && !alq.aviso_listo && para) {
              await avisarPublicado(cfg, deps, listo, p, para).catch((e) => console.error(e));
              nuevo.aviso_listo = ahora;
            }
            await tG.cambiar(c.id, { visible: true, alq: nuevo });
            const QUE = { precio: 'el precio', declara: 'su declaración', datos: 'sus datos para el contrato' };
            aviso = falta.length ? `Aprobado, pero no se verá hasta que complete: ${falta.map((x) => QUE[x] || x).join(', ')}. Le avisamos por email; cuando lo complete se publica solo.`
              : `Publicado en Alquiler${nuevo.aviso_listo === ahora ? ' y avisado por email' : ''}.`;
          }
          if (b.accion === 'alq-ocultar') { await tG.cambiar(c.id, { visible: false }); aviso = 'Oculto: ya no se ve en la web.'; }
          if (b.accion === 'alq-mostrar') { await tG.cambiar(c.id, { visible: true }); aviso = 'Vuelve a verse en la web.'; }
          if (b.accion === 'alq-borrar') { await tG.borrar(`id=eq.${c.id}`); aviso = 'Borrado.'; }
          if (b.accion === 'alq-rechazar') {
            const motivo = texto(b.motivo, 400);
            await tG.cambiar(c.id, { alq: { ...alq, estado: 'rechazado', revisado: ahora, rechazado: motivo || 'sin motivo' } });
            const para = await emailDe();
            if (para) {
              await enviarCorreo(cfg, para, `Tu ${titulo(c)} todavía no está en Alquiler`, plantilla(cfg, null, { titulo: 'Necesitamos que lo revises', previa: `Sobre tu ${titulo(c)}.`,
                cuerpo: P(`Hemos revisado tu <b>${esc(titulo(c))}</b> y, tal y como está, todavía no podemos publicarlo en Alquiler${motivo ? ':' : '.'}`) + (motivo ? `<blockquote style="margin:0 0 16px;padding:10px 14px;border-left:3px solid #ddd;color:#333">${esc(motivo)}</blockquote>` : '')
                  + P('Cámbialo desde tu garaje y guárdalo: nos llega de nuevo y lo revisamos. Si tienes dudas, responde a este email.'),
                boton: 'Ir a mi garaje', enlace: `${cfg.tienda}/pages/vende-con-nosotros?view=perfil#mi-garaje` }), deps.fetch).catch((e) => console.error(e));
            }
            aviso = para ? 'Rechazado y avisado por email.' : 'Rechazado (no tenemos su email: escríbele por WhatsApp).';
          }
          if (b.accion === 'alq-editar') {
            const n = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
            await tG.cambiar(c.id, { marca: mayus(texto(b.marca, 40) || c.marca), modelo: mayus(texto(b.modelo, 60) || c.modelo), anio: Number(b.anio) || c.anio, historia: texto(b.historia, 6000),
              alq: { ...alq, hora: n(b.hora, 0, 5000) || alq.hora, min_horas: n(b.min_horas, 1, 24) || alq.min_horas, ciudad: texto(b.ciudad, 80), plazas: n(b.plazas, 0, 9) || alq.plazas, normas: texto(b.normas, 2000),
                matricula: texto(b.matricula, 12).toUpperCase().replace(/[\s-]/g, '') || alq.matricula || '', itv_hasta: /^\d{4}-\d{2}-\d{2}$/.test(b.itv_hasta) ? b.itv_hasta : alq.itv_hasta || '',
                seguro_compania: texto(b.seguro_compania, 60) || alq.seguro_compania || '', seguro_poliza: texto(b.seguro_poliza, 40) || alq.seguro_poliza || '' } });
            aviso = 'Cambios guardados.';
          }
          if (b.accion === 'alq-fotos') {
            let fotos = [...(c.fotos || [])];
            if (b.hacer === 'portada') { const i = Number(b.portada) || 0; if (fotos[i]) fotos = [fotos[i], ...fotos.filter((_, k) => k !== i)]; aviso = 'Portada cambiada.'; }
            else {
              const quitar = new Set([].concat(b.quitar || []).map(Number));
              const quedan = fotos.filter((_, i) => !quitar.has(i));
              if (!quitar.size) error = 'Marca las fotos que quieras quitar.';
              else if (!quedan.length) error = 'Tiene que quedar al menos una foto.'; else { fotos = quedan; aviso = `${quitar.size} ${quitar.size === 1 ? 'foto quitada' : 'fotos quitadas'}.`; }
            }
            if (!error) await tG.cambiar(c.id, { fotos });
          }
        }
      } catch (e) { console.error(e); if (['alq-subir', 'alq-fotos-orden'].includes(b.accion)) return json({ ok: false, error: 'motor' }); error = 'No se ha podido guardar.'; }
    }
    let coches = [], perfiles = [];
    try {
      coches = await tG.leer('alquiler=eq.true&select=*&order=creado.desc&limit=1000');
      const ids = [...new Set(coches.map((c) => String(c.cliente)))];
      perfiles = ids.length ? await tabla(cfg, deps, 'perfiles').leer(`cliente=in.(${ids.map((x) => `"${x.replace(/"/g, '')}"`).join(',')})&select=*`) : [];
    } catch (e) { error = error || 'Los alquileres se ven aquí desde que ejecutes sql/garaje.sql y sql/reservas.sql en Supabase.'; }
    const ver = ['revisar', 'publicados', 'rechazados', 'ocultos', 'todos'].includes(req.query.ver) ? req.query.ver : (coches.some(porRevisar) ? 'revisar' : 'publicados');
    return html(marco('Alquileres', 'alquileres', paginaAlquileres(cfg, coches, perfiles, { ver, error, aviso }), CSS));
  }
  return null;
}
