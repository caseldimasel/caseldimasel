/* SIDONIA · Alquiler (próximamente): la lista de espera, para medir cuánta gente lo quiere antes de abrirlo.
 * - En la web, la página «Alquila un coche con alma» (tema: sections/sidonia-rent.liquid) manda POST /tienda/api/alquiler
 *   con quién es y qué quiere: alquilar un coche (para qué, cuándo, dónde) o poner el suyo (cuál, dónde, con o sin él
 *   al volante).
 * - Se guarda en la tabla alquiler (sql/alquiler.sql; si aún no está, llega igual por email), al equipo le llega un
 *   aviso «[Alquiler] …» y a la persona, «Estás en la lista».
 * - En el panel › Clientes › Alquiler: la lista, cuántos quieren alquilar y cuántos ponen su coche, y para qué.
 * - Quien quiere alquilar puede dejar su petición a la vista («Lo que busca la gente», sin nombre ni contacto):
 *   GET api/alquiler/peticiones. Un dueño que tiene algo así contesta con «Tengo uno así» y quien quiere alquilar un coche
 *   de la comunidad pulsa «Me interesa alquilarlo»: POST api/alquiler/contactar (con su sesión). A la otra persona le
 *   llega un email con la propuesta y el contacto de quien escribe (lo da al enviarlo), y al equipo, copia.
 * - El equipo puede añadir la petición de un cliente que escribe por WhatsApp y ocultar o cerrar peticiones desde el panel.
 * Sin cobros ni seguro todavía.
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
    conductor: CONDUCTOR[b.conductor] ? b.conductor : '', coche: clip(b.coche, 200), mensaje: clip(b.mensaje, 2000),
    busca: clip(b.busca, 160), publico: b.rol !== 'poner' && (b.publico === true || b.publico === 'true' || b.publico === 'on' || b.publico === '1')
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
  ...(s.busca ? [['Busca', s.busca]] : []),
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
  try { await t.guardar({ ...s, cliente: cliente || '' }, 'id'); } catch (e) {
    // Sin las columnas nuevas (busca, publico) todavía: se guarda lo de siempre
    const { busca, publico, ...base } = s;
    try { await t.guardar({ ...base, cliente: cliente || '', mensaje: [busca && `Busca: ${busca}`, base.mensaje].filter(Boolean).join('\n') }, 'id'); } catch (e2) { console.error(e2); }
  }
  const enviar = (para, c, responder) => enviarCorreo(cfg, para, c.asunto, c.html, deps.fetch, responder).catch((e) => { console.error(e); return false; });
  const ce = correoAlquilerEquipo(cfg, s);
  for (const e of cfg.avisosEquipo || []) await enviar(e, ce, s.email);
  const cp = correoAlquilerPersona(cfg, s);
  return { ok: true, email_enviado: Boolean(await enviar(s.email, cp)) };
}

/* ---------------------------------------------------------------------------- Peticiones y contactos */
const DIAS_PETICION = 90;
/** Lo que se enseña de una petición: nada de quién es (solo la inicial) */
export const peticionPublica = (x) => ({ id: x.id, busca: x.busca || '', para: x.para || '', para_txt: PARA[x.para] || '', fecha: x.fecha || '', ciudad: x.ciudad || '', conductor: x.conductor || '', inicial: String(x.nombre || '').trim().charAt(0).toUpperCase(), creado: x.creado });

export async function peticionesPublicas(cfg, deps) {
  const t = deps.alquiler || tablaAnuncios(cfg, deps.fetch, 'alquiler');
  const desde = new Date(Date.now() - DIAS_PETICION * 864e5).toISOString();
  const l = await t.leer(`rol=eq.alquilar&publico=eq.true&estado=eq.abierta&creado=gte.${encodeURIComponent(desde)}&order=creado.desc&limit=60`);
  return l.map(peticionPublica);
}

function correoContacto(cfg, { titulo, previa, intro, filasDatos, quien, mensaje }) {
  const wa = quien.telefono ? `https://wa.me/${tel(quien.telefono)}` : '';
  return plantilla(cfg, null, {
    titulo, previa,
    cuerpo: P(intro) + datos(filasDatos) + (mensaje ? P(esc(mensaje)) : '')
      + P(`Para hablarlo, escribe a <b>${esc(quien.nombre)}</b>:`) + datos([['Email', quien.email], ...(quien.telefono ? [['Teléfono', quien.telefono]] : [])])
      + (wa ? P(`<a href="${esc(wa)}" style="color:#1a1a1a;font-weight:600">Escribirle por WhatsApp &rarr;</a>`) : '')
      + P('Sidonia todavía no gestiona el alquiler: acordadlo entre vosotros y, si queréis ayuda, respondednos a este email.'),
    boton: `Responder a ${quien.nombre.split(' ')[0]}`, enlace: `mailto:${quien.email}`, sinDudas: true
  });
}

/** POST api/alquiler/contactar { tipo: 'tengo', peticion, coche, ... } o { tipo: 'interes', coche_id, fecha, ... } */
export async function contactarAlquiler(body, cliente, cfg, deps) {
  if (!cliente) return { ok: false, error: 'login' };
  const q = { tipo: body.tipo === 'interes' ? 'interes' : 'tengo', nombre: clip(body.nombre, 120), email: clip(body.email, 200).toLowerCase(), telefono: clip(body.telefono, 40),
    coche: clip(body.coche, 200), fecha: clip(body.fecha, 60), mensaje: clip(body.mensaje, 2000), peticion: Number(body.peticion) || null, coche_id: Number(body.coche_id) || null };
  if (!q.nombre) return { ok: false, error: 'nombre' };
  if (!EMAIL.test(q.email)) return { ok: false, error: 'email' };
  if (q.tipo === 'tengo' && !q.coche) return { ok: false, error: 'coche' };
  const tA = deps.alquiler || tablaAnuncios(cfg, deps.fetch, 'alquiler');
  const tC = deps.alquiler_contactos || tablaAnuncios(cfg, deps.fetch, 'alquiler_contactos');
  const enviar = (para, asunto, html, responder) => enviarCorreo(cfg, para, asunto, html, deps.fetch, responder).catch((e) => { console.error(e); return false; });
  let para = '', asunto = '', html = '';
  try {
    // Como mucho 10 por hora por persona
    const hace = new Date(Date.now() - 3600e3).toISOString();
    if ((await tC.leer(`cliente=eq.${encodeURIComponent(cliente)}&creado=gte.${encodeURIComponent(hace)}&select=id`).catch(() => [])).length >= 10) return { ok: false, error: 'muchas' };
    if (q.tipo === 'tengo') {
      const [p] = await tA.leer(`id=eq.${q.peticion}&rol=eq.alquilar&limit=1`);
      if (!p || p.publico === false || p.estado === 'cerrada') return { ok: false, error: 'no-existe' };
      para = p.email;
      asunto = `Tienen un coche para ti: ${q.coche}`;
      html = correoContacto(cfg, { titulo: 'Un dueño tiene lo que buscas', previa: `${q.nombre} tiene un ${q.coche}.`,
        intro: `Hola ${esc(String(p.nombre || '').split(' ')[0])}: has pedido en Sidonia ${p.busca ? `<b>${esc(p.busca)}</b>` : 'un coche'}${p.ciudad ? ` en ${esc(p.ciudad)}` : ''}${p.fecha ? ` para ${esc(p.fecha)}` : ''}. Un miembro de la comunidad te propone el suyo:`,
        filasDatos: [['Coche', q.coche], ...(q.fecha ? [['Cuándo', q.fecha]] : [])], quien: q, mensaje: q.mensaje });
    } else {
      const tG = deps.garaje || tablaAnuncios(cfg, deps.fetch, 'garaje');
      const [c] = await tG.leer(`id=eq.${q.coche_id}&alquiler=eq.true&limit=1`);
      if (!c) return { ok: false, error: 'no-existe' };
      const titulo = [c.marca, c.modelo, c.anio].filter(Boolean).join(' ');
      q.coche = titulo;
      // El email del dueño: el que dejó al ponerlo en alquiler (alquiler, rol «poner»)
      const [d] = await tA.leer(`cliente=eq.${encodeURIComponent(c.cliente)}&rol=eq.poner&email=neq.&order=creado.desc&limit=1`).catch(() => []);
      para = d?.email || '';
      asunto = `Quieren alquilar tu ${titulo}`;
      html = correoContacto(cfg, { titulo: 'Quieren alquilar tu coche', previa: `${q.nombre} quiere alquilar tu ${titulo}.`,
        intro: `Hola${d?.nombre ? ` ${esc(d.nombre.split(' ')[0])}` : ''}: a <b>${esc(q.nombre)}</b> le interesa alquilar tu <b>${esc(titulo)}</b>, que tienes en Sidonia.`,
        filasDatos: [...(q.fecha ? [['Cuándo', q.fecha]] : [])], quien: q, mensaje: q.mensaje });
    }
    await tC.guardar({ ...q, cliente: String(cliente) }, 'id').catch((e) => console.error(e));
  } catch (e) {
    console.error(e);
    return { ok: false, error: /alquiler|relation|does not exist|42P01|column/.test(String(e.message)) ? 'sin-tabla' : 'motor' };
  }
  const enviado = para ? Boolean(await enviar(para, asunto, html, q.email)) : false;
  for (const e of cfg.avisosEquipo || []) await enviar(e, `[Alquiler] ${asunto}${para ? '' : ' (sin email del otro: escribidle vosotros)'}`, html, q.email);
  return { ok: true, enviado };
}

/** Panel: añadir la petición de un cliente (WhatsApp, teléfono…), ocultarla o cerrarla */
export async function accionPanelAlquiler(b, cfg, deps) {
  const t = deps.alquiler || tablaAnuncios(cfg, deps.fetch, 'alquiler');
  if (b.accion === 'peticion-nueva') {
    const s = { rol: 'alquilar', nombre: clip(b.nombre, 120) || 'Cliente', email: clip(b.email, 200).toLowerCase(), telefono: clip(b.telefono, 40), busca: clip(b.busca, 160),
      ciudad: clip(b.ciudad, 120), fecha: clip(b.fecha, 60), para: PARA[b.para] ? b.para : '', conductor: CONDUCTOR[b.conductor] ? b.conductor : '', mensaje: clip(b.mensaje, 2000), publico: true, estado: 'abierta', cliente: '' };
    if (!s.busca) return 'Dinos qué coche busca.';
    await t.guardar(s, 'id');
    return '';
  }
  const id = Number(b.id);
  if (!id) return '';
  if (b.accion === 'peticion-publico') await t.cambiar(id, { publico: String(b.valor) === '1' });
  if (b.accion === 'peticion-estado') await t.cambiar(id, { estado: b.valor === 'cerrada' ? 'cerrada' : 'abierta' });
  return '';
}

/* ---------------------------------------------------------------------------- Panel › Clientes › Alquiler */
export function paginaAlquiler(lista, { ver = 'todos', error = '', marco, contactos = [] }) {
  const filtros = { todos: 'Todos', alquilar: 'Quieren alquilar', poner: 'Ponen su coche' };
  const l = lista.filter((x) => ver === 'todos' || x.rol === ver);
  const fecha = (t) => new Date(t).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  const cuenta = (campo, dic) => Object.entries(dic).map(([k, t]) => [t, lista.filter((x) => x[campo] === k).length]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
  const filasHtml = l.map((x) => `<tr><td class="izq">${fecha(x.creado)}</td>
    <td class="izq"><b>${esc(x.nombre)}</b><span class="sub">${esc(x.email)}${x.telefono ? ` · ${esc(x.telefono)}` : ''}</span>
      <p class="contacto" style="margin-top:6px"><a href="mailto:${esc(x.email)}">Email</a>${x.telefono ? `<a href="https://wa.me/${tel(x.telefono)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</p></td>
    <td class="izq">${x.rol === 'poner' ? `Pone su coche<span class="sub">${esc(x.coche)}</span>` : `Quiere alquilar${x.busca ? `<span class="sub">${esc(x.busca)}</span>` : ''}
      ${'publico' in x ? `<span style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">${[['peticion-publico', x.publico ? '0' : '1', x.publico ? 'Ocultar de la web' : 'Publicar en la web'], ['peticion-estado', x.estado === 'cerrada' ? 'abierta' : 'cerrada', x.estado === 'cerrada' ? 'Reabrir' : 'Cerrar']]
        .map(([a, v, t]) => `<form method="post" action="?estado=alquiler&ver=${esc(ver)}"><input type="hidden" name="id" value="${Number(x.id)}"><input type="hidden" name="accion" value="${a}"><input type="hidden" name="valor" value="${v}"><button class="btn">${t}</button></form>`).join('')}</span>${x.publico && x.estado !== 'cerrada' ? '<span class="si" style="margin-top:4px;display:inline-block">En la web</span>' : ''}` : ''}`}</td>
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
<details class="card" style="padding:14px 18px;margin-bottom:14px"><summary style="cursor:pointer;font-weight:700">+ Añadir la petición de un cliente (WhatsApp, teléfono…)</summary>
  <form method="post" action="?estado=alquiler" style="display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-top:12px">
    <input type="hidden" name="accion" value="peticion-nueva">
    <label>Qué coche busca<input name="busca" required placeholder="Un clásico rojo descapotable"></label>
    <label>Dónde<input name="ciudad" placeholder="Madrid"></label>
    <label>Cuándo<input name="fecha" placeholder="Sábado 12 de junio de 2027"></label>
    <label>Para<select name="para"><option value="">—</option>${Object.entries(PARA).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
    <label>Nombre<input name="nombre"></label><label>Email (para avisarle)<input name="email" type="email"></label><label>Teléfono<input name="telefono"></label>
    <label style="grid-column:1/-1">Nota<input name="mensaje"></label>
    <button class="btn" style="justify-self:start">Publicar la petición en la web</button>
  </form><p class="nota" style="margin:8px 0 0">Sale en «Lo que busca la gente» sin nombre ni contacto. Si un dueño contesta, le llega a su email (y a vosotros, copia).</p></details>
<div class="per">${Object.entries(filtros).map(([k, t]) => `<a href="?estado=alquiler&ver=${k}" class="${k === ver ? 'on' : ''}">${t}</a>`).join('')}</div>
<div class="card"><div class="tabla"><table>
  <thead><tr><th class="izq">Cuándo</th><th class="izq">Quién</th><th class="izq">Quiere</th><th class="izq">Para</th><th class="izq">Dónde</th><th class="izq">Conductor</th><th class="izq">Mensaje</th></tr></thead>
  <tbody>${filasHtml || '<tr><td colspan="7" class="vacio">Aún no se ha apuntado nadie.</td></tr>'}</tbody>
</table></div></div>
${contactos.length ? `<h2 style="margin:22px 0 8px">Contactos entre la comunidad</h2><div class="card"><div class="tabla"><table>
  <thead><tr><th class="izq">Cuándo</th><th class="izq">Qué</th><th class="izq">Quién escribe</th><th class="izq">Mensaje</th></tr></thead>
  <tbody>${contactos.map((c) => `<tr><td class="izq">${fecha(c.creado)}</td><td class="izq">${c.tipo === 'tengo' ? `Tiene uno así (petición #${Number(c.peticion)})` : 'Quiere alquilarlo'}<span class="sub">${esc(c.coche)}${c.fecha ? ` · ${esc(c.fecha)}` : ''}</span></td>
    <td class="izq"><b>${esc(c.nombre)}</b><span class="sub">${esc(c.email)}${c.telefono ? ` · ${esc(c.telefono)}` : ''}</span></td><td class="izq"><span class="sub" style="white-space:normal;max-width:300px;display:block">${esc(c.mensaje || '—')}</span></td></tr>`).join('')}</tbody>
</table></div></div>` : ''}
<p class="nota">La lista de espera de «Alquila un coche con alma» (próximamente). Sirve para medir cuánta gente lo quiere antes de abrirlo: a cada uno le llega «Estás en la lista» y a vosotros un email «[Alquiler]».</p>`);
}
