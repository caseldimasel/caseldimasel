/* SIDONIA · «Pedir mejoras» antes de publicar un anuncio de la comunidad (en vez de rechazarlo).
 * En el panel (Por revisar y Aprobados) se marcan recomendaciones ya escritas (foto de portada de tres cuartos, historia
 * más larga, más fotos…) y, si se quiere, un texto propio. Al dueño le llega un email (y un aviso al móvil) con la lista
 * y el botón «Editar mi anuncio»; en la web lo ve en su anuncio. Cuando lo edita, el panel lo marca como «Ya lo ha
 * mejorado» y al equipo le llega un email. Se guarda en anuncios.mejoras (sql/circulo.sql).
 */
import { esc } from './circulo.mjs';
import { plantilla } from './correos.mjs';
import { bloqueGuiaCorreo } from './guia.mjs';

// Si se le pide algo de las fotos, el email lleva la guía con las siluetas
const DE_FOTOS = ['portada', 'luz', 'fondo', 'mas_fotos'];

export const MEJORAS = {
  portada: ['Foto de portada', 'Pon como primera foto el coche entero de tres cuartos (de frente y un poco de lado), con buena luz y un fondo limpio. Es la que se ve en Sidonia y la que hace que entren en tu anuncio.'],
  luz: ['Fotos con más luz', 'Haz las fotos de día, con luz natural y sin contraluces. Mejor a primera hora o al atardecer.'],
  fondo: ['Fondo limpio', 'Que solo salga lo que vendes: sin otros coches, gente ni cosas alrededor.'],
  mas_fotos: ['Más fotos', 'Añade más fotos: interior, salpicadero, motor, maletero, detalles y documentación.'],
  historia: ['Historia más larga', 'Cuéntanos más de su historia: de dónde viene, quién lo ha tenido, viajes, restauraciones, anécdotas… Es lo que más vende en Sidonia.'],
  mecanica: ['Estado y mecánica', 'Detalla su estado: revisiones, piezas cambiadas, puntos a mejorar. La gente confía más si lo cuentas todo.'],
  ficha: ['Ficha técnica completa', 'Completa la ficha técnica: año, kilómetros, motor, potencia, cambio, color…'],
  titulo: ['Título', 'Pon en el título la marca, el modelo y el año, sin todo en mayúsculas (por ejemplo «Mercedes-Benz 280 SL Pagoda 1969»).'],
  precio: ['Precio', 'Revisa el precio: está por encima de lo que suele pedirse por uno así y puede costar venderlo.']
};

/** Lo que llega del panel: { claves, texto } o null si no hay nada */
export function leerMejoras(b = {}) {
  const claves = [].concat(b.mejora || []).map(String).filter((k, i, l) => MEJORAS[k] && l.indexOf(k) === i);
  const texto = String(b.mejora_texto || '').replace(/\r\n?/g, '\n').trim().slice(0, 1500);
  return claves.length || texto ? { claves, texto } : null;
}

/** La lista para enseñar: [[título, texto], …] (con el texto propio al final) */
export const listaMejoras = (m) => [...(m?.claves || []).filter((k) => MEJORAS[k]).map((k) => MEJORAS[k]), ...(m?.texto ? [['Además', m.texto]] : [])];
export const pendientes = (m) => Boolean(m && m.pedido && !m.editado);

export function correoMejoras(cfg, a, m) {
  const p = (t) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#3a3833">${t}</p>`;
  const lista = listaMejoras(m).map(([t, x]) => `<li style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#3a3833"><b style="color:#1b1a18">${esc(t)}.</b> ${esc(x).replace(/\n/g, '<br>')}</li>`).join('');
  return {
    asunto: `Unas mejoras para tu anuncio: ${a.titulo}`,
    html: plantilla(cfg, a, {
      antetitulo: 'Antes de publicarlo',
      titulo: `${a.vendedor_nombre || 'Hola'}, nos encanta tu anuncio`,
      cuerpo: p(`Hemos revisado «${esc(a.titulo)}» y queremos que se vea como se merece. Antes de publicarlo, te recomendamos:`)
        + `<ul style="margin:0 0 16px;padding:14px 16px 2px 34px;border-radius:12px;background:#f6f5f2">${lista}</ul>`
        + (a.tipo !== 'casa' && a.tipo !== 'barco' && (m.claves || []).some((k) => DE_FOTOS.includes(k)) ? bloqueGuiaCorreo(cfg) : '')
        + p('Edítalo cuando puedas (tus fotos y textos siguen ahí) y lo revisamos de nuevo enseguida. Si tienes cualquier duda, contesta a este email o escríbenos por WhatsApp.'),
      boton: 'Editar mi anuncio', enlace: `${cfg.tienda}/pages/vende-con-nosotros?view=publicar&anuncio=${Number(a.id)}`
    })
  };
}

export const avisoMejoras = (a) => ({ titulo: 'Unas mejoras para tu anuncio', texto: `Antes de publicar «${a.titulo}», te recomendamos unos cambios. Míralos y edítalo.`, url: `/pages/vende-con-nosotros?view=publicar&anuncio=${Number(a.id)}` });

const fecha = (t) => (t ? new Date(t).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

/** En la tarjeta del panel: lo pedido (y si ya lo ha mejorado) y el formulario para pedir mejoras */
export function cajaMejoras(a) {
  const m = a.mejoras;
  const pedido = m?.pedido ? `<div class="mejoras-pedidas${m.editado ? ' hecho' : ''}">
    <p><b>${m.editado ? `Ya lo ha mejorado (${fecha(m.editado)})` : `Mejoras pedidas el ${fecha(m.pedido)} · aún sin editar`}</b></p>
    <ul>${listaMejoras(m).map(([t, x]) => `<li><b>${esc(t)}:</b> ${esc(x)}</li>`).join('')}</ul></div>` : '';
  return `${pedido}<details class="editar mejoras"><summary>${m?.pedido ? 'Pedir otras mejoras' : 'Pedir mejoras antes de publicar'}</summary>
    <form method="post">
      <input type="hidden" name="id" value="${a.id}">
      <p class="ayuda-m">En vez de rechazarlo: marca lo que le recomiendas. Le llega por email${a.email ? ` (${esc(a.email)})` : ' (no tenemos su email: avísale por WhatsApp)'} y al móvil, con el botón para editarlo. Si es algo de las fotos, el email lleva <a href="/tienda/guia" target="_blank" rel="noopener">la guía de fotos con las siluetas ›</a></p>
      <div class="opciones-m">${Object.entries(MEJORAS).map(([k, [t, x]]) => `<label title="${esc(x)}"><input type="checkbox" name="mejora" value="${k}"> <span><b>${esc(t)}</b><small>${esc(x)}</small></span></label>`).join('')}</div>
      <label>Algo más <small>(opcional, lo lee tal cual)</small><textarea name="mejora_texto" rows="2" placeholder="Por ejemplo: «¿Tienes alguna foto del coche en su época?»"></textarea></label>
      <div><button name="accion" value="mejoras" class="si">Enviar las recomendaciones</button></div>
    </form>
  </details>`;
}

export const CSS_MEJORAS = `
  .mejoras-pedidas { margin: 0 0 10px; padding: 10px 14px; border-radius: 12px; background: var(--amarillo-fondo); color: var(--texto); }
  .mejoras-pedidas.hecho { background: var(--verde-fondo); }
  .mejoras-pedidas p { margin: 0 0 6px; } .mejoras-pedidas ul { margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.5; color: var(--suave); }
  .mejoras .ayuda-m { margin: 0; font-size: 13px; color: var(--suave); }
  .opciones-m { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); }
  .opciones-m label { display: flex !important; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--linea); border-radius: 10px; background: var(--caja); cursor: pointer; color: var(--texto) !important; }
  .opciones-m label:has(input:checked) { border-color: var(--verde); background: var(--verde-fondo); }
  .opciones-m input { margin-top: 3px; width: auto !important; flex: 0 0 auto; min-height: 0; } .opciones-m span { display: grid; gap: 2px; } .opciones-m small { font-weight: 400; font-size: 12px; line-height: 1.4; color: var(--suave); }`;
