/* SIDONIA · Alquiler (próximamente): la lista de espera, para medir cuánta gente lo quiere antes de abrirlo.
 * - En la web, la página «Alquila un coche con alma» (tema: sections/sidonia-rent.liquid) manda POST /tienda/api/alquiler
 *   con quién es y qué quiere: alquilar un coche (para qué, cuándo, dónde) o poner el suyo (cuál, dónde, con o sin él
 *   al volante).
 * - Se guarda en la tabla alquiler (sql/alquiler.sql; si aún no está, llega igual por email), al equipo le llega un
 *   aviso «[Alquiler] …» y a la persona, «Estás en la lista».
 * - En el panel › Clientes › Alquiler: la lista, cuántos quieren alquilar y cuántos ponen su coche, y para qué.
 * Sin cobros ni seguro todavía: solo la lista.
 */
import { esc, tablaAnuncios } from './circulo.mjs';
import { datos, enviarCorreo, P, plantilla } from './correos.mjs';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const clip = (t, n) => String(t ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const tel = (t) => String(t || '').replace(/\D/g, '').replace(/^(?=[6789]\d{8}$)/, '34');

export const PARA = { boda: 'Boda o evento', rodaje: 'Rodaje o sesión de fotos', finde: 'Fin de semana o escapada', ruta: 'Una ruta o un día', otro: 'Otra cosa' };
export const CONDUCTOR = { con: 'Con el dueño al volante', sin: 'Sin conductor (lo conduzco yo)', igual: 'Me da igual' };

/** Limpia lo que llega: { ok, solicitud } o { ok: false, error } */
export function leerAlquiler(b = {}) {
  const s = {
    rol: b.rol === 'poner' ? 'poner' : 'alquilar',
    nombre: clip(b.nombre, 120), email: clip(b.email, 200).toLowerCase(), telefono: clip(b.telefono, 40),
    ciudad: clip(b.ciudad, 120), para: PARA[b.para] ? b.para : '', fecha: clip(b.fecha, 60),
    conductor: CONDUCTOR[b.conductor] ? b.conductor : '', coche: clip(b.coche, 200), mensaje: clip(b.mensaje, 2000)
  };
  if (clip(b.web, 10)) return { ok: false, error: 'spam' };
  if (!s.nombre) return { ok: false, error: 'nombre' };
  if (!EMAIL.test(s.email)) return { ok: false, error: 'email' };
  if (s.rol === 'poner' && !s.coche) return { ok: false, error: 'coche' };
  return { ok: true, solicitud: s };
}

const filas = (s) => [
  ['Quiere', s.rol === 'poner' ? 'Poner su coche en alquiler' : 'Alquilar un coche'],
  ...(s.coche ? [['Coche', s.coche]] : []),
  ...(s.para ? [['Para', PARA[s.para]]] : []),
  ...(s.fecha ? [['Cuándo', s.fecha]] : []),
  ...(s.ciudad ? [['Dónde', s.ciudad]] : []),
  ...(s.conductor ? [['Conductor', CONDUCTOR[s.conductor]]] : [])
];

/** Al equipo: quién es y cómo contestarle */
export function correoAlquilerEquipo(cfg, s) {
  const wa = s.telefono ? `https://wa.me/${tel(s.telefono)}` : '';
  return {
    asunto: `[Alquiler] ${s.nombre} ${s.rol === 'poner' ? `quiere poner su ${s.coche}` : 'quiere alquilar un coche'}`,
    html: plantilla(cfg, null, {
      titulo: s.rol === 'poner' ? 'Alguien quiere poner su coche' : 'Alguien quiere alquilar',
      previa: `${s.nombre} se ha apuntado a la lista de espera del alquiler.`,
      cuerpo: P(`<b>${esc(s.nombre)}</b> se ha apuntado a la lista de espera del alquiler:`) + datos([...filas(s), ['Email', s.email], ...(s.telefono ? [['Teléfono', s.telefono]] : [])])
        + (s.mensaje ? P(esc(s.mensaje)) : '') + (wa ? P(`<a href="${esc(wa)}" style="color:#1a1a1a;font-weight:600">Escribirle por WhatsApp &rarr;</a>`) : ''),
      boton: `Responder a ${s.nombre.split(' ')[0]}`, enlace: `mailto:${s.email}`, sinDudas: true
    })
  };
}

/** A la persona: «Estás en la lista» */
export function correoAlquilerPersona(cfg, s) {
  return {
    asunto: 'Estás en la lista del alquiler de Sidonia',
    html: plantilla(cfg, null, {
      titulo: 'Estás en la lista', previa: 'Te avisamos en cuanto abramos el alquiler.',
      cuerpo: P(`Hola ${esc(s.nombre.split(' ')[0])}:`)
        + P(s.rol === 'poner'
          ? `Gracias por querer poner tu <b>${esc(s.coche)}</b> en Sidonia. Estamos preparando el alquiler entre la comunidad y serás de los primeros en saberlo: te escribiremos para contarte cómo funciona antes de abrirlo.`
          : 'Estamos preparando el alquiler de coches con alma entre nuestra comunidad. Serás de los primeros en saberlo y, si podemos ayudarte antes con lo que buscas, te escribimos.')
        + datos(filas(s)),
      boton: 'Ir a Sidonia', enlace: cfg.tienda
    })
  };
}

/** POST api/alquiler */
export async function recibirAlquiler(body, cliente, cfg, deps) {
  const v = leerAlquiler(body);
  if (!v.ok) return v;
  const s = v.solicitud;
  const t = deps.alquiler || tablaAnuncios(cfg, deps.fetch, 'alquiler');
  // Como mucho 5 por hora con el mismo email (contra el spam)
  try {
    const hace = new Date(Date.now() - 3600e3).toISOString();
    if ((await t.leer(`email=eq.${encodeURIComponent(s.email)}&creado=gte.${encodeURIComponent(hace)}&select=id`)).length >= 5) return { ok: false, error: 'muchas' };
  } catch (e) { /* sin la tabla aún */ }
  try { await t.guardar({ ...s, cliente: cliente || '' }, 'id'); } catch (e) { console.error(e); }
  const enviar = (para, c, responder) => enviarCorreo(cfg, para, c.asunto, c.html, deps.fetch, responder).catch((e) => { console.error(e); return false; });
  const ce = correoAlquilerEquipo(cfg, s);
  for (const e of cfg.avisosEquipo || []) await enviar(e, ce, s.email);
  const cp = correoAlquilerPersona(cfg, s);
  return { ok: true, email_enviado: Boolean(await enviar(s.email, cp)) };
}

/* ---------------------------------------------------------------------------- Panel › Clientes › Alquiler */
export function paginaAlquiler(lista, { ver = 'todos', error = '', marco }) {
  const filtros = { todos: 'Todos', alquilar: 'Quieren alquilar', poner: 'Ponen su coche' };
  const l = lista.filter((x) => ver === 'todos' || x.rol === ver);
  const fecha = (t) => new Date(t).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  const cuenta = (campo, dic) => Object.entries(dic).map(([k, t]) => [t, lista.filter((x) => x[campo] === k).length]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
  const filasHtml = l.map((x) => `<tr><td class="izq">${fecha(x.creado)}</td>
    <td class="izq"><b>${esc(x.nombre)}</b><span class="sub">${esc(x.email)}${x.telefono ? ` · ${esc(x.telefono)}` : ''}</span>
      <p class="contacto" style="margin-top:6px"><a href="mailto:${esc(x.email)}">Email</a>${x.telefono ? `<a href="https://wa.me/${tel(x.telefono)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</p></td>
    <td class="izq">${x.rol === 'poner' ? `Pone su coche<span class="sub">${esc(x.coche)}</span>` : 'Quiere alquilar'}</td>
    <td class="izq">${esc(PARA[x.para] || '—')}${x.fecha ? `<span class="sub">${esc(x.fecha)}</span>` : ''}</td>
    <td class="izq">${esc(x.ciudad || '—')}</td>
    <td class="izq">${esc(CONDUCTOR[x.conductor] || '—')}</td>
    <td class="izq">${x.mensaje ? `<span class="sub" style="white-space:normal;max-width:260px;display:block">${esc(x.mensaje)}</span>` : '—'}</td></tr>`).join('');
  const para = cuenta('para', PARA), conductor = cuenta('conductor', CONDUCTOR);
  return marco('Alquiler · lista de espera', 'alquiler', `
${error ? `<p class="aviso mal">${esc(error)}</p>` : ''}
<div class="kpis">
  <div class="kpi"><span>Apuntados</span><b>${lista.length}</b><small>${lista.filter((x) => Date.now() - Date.parse(x.creado) < 7 * 864e5).length} en los últimos 7 días</small></div>
  <div class="kpi"><span>Quieren alquilar</span><b>${lista.filter((x) => x.rol === 'alquilar').length}</b><small>la demanda</small></div>
  <div class="kpi"><span>Ponen su coche</span><b>${lista.filter((x) => x.rol === 'poner').length}</b><small>los coches</small></div>
  <div class="kpi"><span>Para qué</span><b>${esc(para[0]?.[0] || '—')}</b><small>${para.slice(0, 3).map(([t, n]) => `${esc(t)}: ${n}`).join(' · ') || 'aún nada'}</small></div>
  <div class="kpi"><span>Conductor</span><b>${esc(conductor[0]?.[0] || '—')}</b><small>${conductor.map(([t, n]) => `${esc(t)}: ${n}`).join(' · ') || 'aún nada'}</small></div>
</div>
<div class="per">${Object.entries(filtros).map(([k, t]) => `<a href="?estado=alquiler&ver=${k}" class="${k === ver ? 'on' : ''}">${t}</a>`).join('')}</div>
<div class="card"><div class="tabla"><table>
  <thead><tr><th class="izq">Cuándo</th><th class="izq">Quién</th><th class="izq">Quiere</th><th class="izq">Para</th><th class="izq">Dónde</th><th class="izq">Conductor</th><th class="izq">Mensaje</th></tr></thead>
  <tbody>${filasHtml || '<tr><td colspan="7" class="vacio">Aún no se ha apuntado nadie.</td></tr>'}</tbody>
</table></div></div>
<p class="nota">La lista de espera de «Alquila un coche con alma» (próximamente). Sirve para medir cuánta gente lo quiere antes de abrirlo: a cada uno le llega «Estás en la lista» y a vosotros un email «[Alquiler]».</p>`);
}
