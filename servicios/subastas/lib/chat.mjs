/* SIDONIA · Mensajes dentro de Sidonia (sql/chat.sql): quien pregunta y el dueño se hablan aquí, sin ver el teléfono del
 * otro. Sirve para los coches en venta de la comunidad, los coches en alquiler (antes de reservar) y las peticiones de
 * alquiler («Busco un clásico rojo descapotable…»). A cada uno le llega un aviso por email si tiene mensajes sin leer.
 * «Hacer oferta» en un anuncio de la comunidad también llega aquí, como un mensaje con la oferta (ofertas.mjs).
 * Si algún día el alquiler se cobra a través de Sidonia (ALQUILER_COBRAR=1), hasta la reserva pagada los teléfonos y
 * emails que se escriban en el alquiler se tapan (como en Airbnb). Ahora, como en la venta, no se tapa nada.
 *
 *   POST api/chat/abrir     { tipo: venta|alquiler|peticion, ref, texto, nombre, email } → { ok, chat }
 *   GET  api/chat           → { ok, chats, sin_leer }
 *   GET  api/chat/mensajes?id=      → { ok, chat, mensajes }   (y lo marca como leído)
 *   POST api/chat/mensajes  { id, texto }
 */
import { esc, tablaAnuncios, urlFoto } from './circulo.mjs';
import { enviarCorreo, P, plantilla } from './correos.mjs';

const clip = (t, n) => String(t ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
const tabla = (cfg, deps, n) => deps[n] || tablaAnuncios(cfg, deps.fetch, n);
const TIPOS = ['venta', 'alquiler', 'peticion'];

/** En el alquiler, sin reserva pagada: los teléfonos, emails y enlaces de WhatsApp se tapan */
export function tapar(t) {
  return String(t)
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email oculto]')
    .replace(/(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com)\/\S*/gi, '[enlace oculto]')
    .replace(/\+?\d(?:[\s.-]?\d){8,}/g, '[teléfono oculto]');
}

/** El dueño y lo que se enseña de cada cosa */
async function deQuien(cfg, deps, tipo, ref) {
  if (tipo === 'venta') {
    const [a] = await (deps.anuncios || deps.tabla || tabla(cfg, deps, 'anuncios')).leer(`id=eq.${Number(ref)}&select=id,cliente,titulo,fotos,producto,vendedor_nombre,email,estado&limit=1`);
    if (!a || !['publicado', 'aprobado'].includes(a.estado)) return null;
    return { dueno: String(a.cliente), dueno_nombre: a.vendedor_nombre || '', titulo: a.titulo, foto: (a.fotos || [])[0] ? urlFoto(cfg, a.fotos[0]) : '', url: a.producto ? `/products/${a.producto}` : '', email: a.email || '' };
  }
  if (tipo === 'alquiler') {
    const [c] = await tabla(cfg, deps, 'garaje').leer(`id=eq.${Number(ref)}&alquiler=eq.true&limit=1`);
    if (!c) return null;
    const [p] = await tabla(cfg, deps, 'perfiles').leer(`cliente=eq.${encodeURIComponent(c.cliente)}&select=nombre&limit=1`).catch(() => []);
    const [d] = await tabla(cfg, deps, 'alquiler').leer(`cliente=eq.${encodeURIComponent(c.cliente)}&rol=eq.poner&email=neq.&order=creado.desc&limit=1`).catch(() => []);
    return { dueno: String(c.cliente), dueno_nombre: p?.nombre || d?.nombre || '', titulo: [c.marca, c.modelo, c.anio].filter(Boolean).join(' '), foto: (c.fotos || [])[0] ? urlFoto(cfg, c.fotos[0]) : '', url: `?coche=${c.id}`, email: d?.email || '' };
  }
  const [r] = await tabla(cfg, deps, 'alquiler').leer(`id=eq.${Number(ref)}&rol=eq.alquilar&limit=1`);
  if (!r || !r.cliente || r.estado === 'cerrada') return null;
  return { dueno: String(r.cliente), dueno_nombre: r.nombre || '', titulo: `Busca: ${r.busca || 'un coche'}`, foto: '', url: '', email: r.email || '' };
}

/** ¿Hay una reserva pagada entre los dos? (entonces ya no se tapa nada) */
async function reservaPagada(cfg, deps, a, b) {
  try {
    const l = await tabla(cfg, deps, 'reservas').leer(`or=(and(dueno.eq.${encodeURIComponent(a)},cliente.eq.${encodeURIComponent(b)}),and(dueno.eq.${encodeURIComponent(b)},cliente.eq.${encodeURIComponent(a)}))&pago=eq.pagado&select=id&limit=1`);
    return l.length > 0;
  } catch (e) { return false; }
}

const vista = (c, yo) => {
  const soyDueno = String(c.dueno) === String(yo);
  const leido = soyDueno ? c.leido_dueno : c.leido_cliente;
  return { id: c.id, tipo: c.tipo, ref: c.ref, titulo: c.titulo, foto: c.foto, url: c.url, ultimo: c.ultimo, actualizado: c.actualizado,
    rol: soyDueno ? 'dueno' : 'cliente', otro: soyDueno ? (c.cliente_nombre || 'Interesado') : (c.dueno_nombre || 'Dueño'),
    sin_leer: Boolean(c.ultimo_de && String(c.ultimo_de) !== String(yo) && (!leido || Date.parse(leido) < Date.parse(c.actualizado))) };
};

async function avisar(cfg, deps, para, nombreDe, c, texto, enlace) {
  if (!para) return;
  await enviarCorreo(cfg, para, `${nombreDe} te ha escrito en Sidonia`, plantilla(cfg, null, {
    titulo: 'Tienes un mensaje', previa: texto.slice(0, 90),
    cuerpo: P(`<b>${esc(nombreDe)}</b> te ha escrito sobre <b>${esc(c.titulo)}</b>:`) + P(`«${esc(texto.slice(0, 600))}»`) + P('Contesta desde el chat de Sidonia: así nadie ve tu teléfono hasta que tú quieras.'),
    boton: 'Responder', enlace, sinDudas: true
  }), deps.fetch).catch((e) => console.error(e));
}

const tapa = (cfg, tipo) => tipo !== 'venta' && cfg.alquilerCobrar;

/** Escribir a un dueño (lo usa «abrir» y «Hacer oferta»): crea la conversación si no la hay. { ok, chat } o { ok: false, error } */
export async function escribirEnChat(cfg, deps, { tipo, ref, cliente, nombre, email, texto }) {
  tipo = TIPOS.includes(tipo) ? tipo : '';
  texto = clip(texto, 2000);
  if (!tipo || !String(ref || '').match(/^\d+$/)) return { ok: false, error: 'datos' };
  if (texto.length < 2) return { ok: false, error: 'texto' };
  const yo = String(cliente);
  const tC = tabla(cfg, deps, 'chats'), tM = tabla(cfg, deps, 'chat_mensajes');
  const d = await deQuien(cfg, deps, tipo, ref);
  if (!d) return { ok: false, error: 'no-existe' };
  if (d.dueno === yo) return { ok: false, error: 'suyo' };
  let [c] = await tC.leer(`tipo=eq.${tipo}&ref=eq.${Number(ref)}&cliente=eq.${encodeURIComponent(yo)}&limit=1`);
  const ahora = new Date().toISOString();
  nombre = clip(nombre, 60) || 'Interesado';
  if (!c) c = await tC.guardar({ tipo, ref: String(Number(ref)), dueno: d.dueno, cliente: yo, dueno_nombre: d.dueno_nombre, cliente_nombre: nombre.split(' ')[0], cliente_email: clip(email, 200).toLowerCase(), titulo: d.titulo, foto: d.foto, url: d.url }, 'tipo,ref,cliente');
  const limpio = tapa(cfg, tipo) && !(await reservaPagada(cfg, deps, d.dueno, yo)) ? tapar(texto) : texto;
  await tM.guardar({ chat_id: Number(c.id), de: yo, texto: limpio }, 'id');
  const yaAvisado = c.ultimo_de === yo && (!c.leido_dueno || Date.parse(c.leido_dueno) < Date.parse(c.actualizado));
  await tC.cambiar(c.id, { ultimo: limpio.slice(0, 200), ultimo_de: yo, actualizado: ahora, leido_cliente: ahora });
  if (!yaAvisado) await avisar(cfg, deps, d.email, nombre.split(' ')[0], c, limpio, `${cfg.tienda}/pages/vende-con-nosotros?view=perfil#mensajes`);
  return { ok: true, chat: vista({ ...c, ultimo: limpio, ultimo_de: yo, actualizado: ahora, leido_cliente: ahora }, yo) };
}

export async function rutasChat({ ruta, method, body }, cliente, cfg, deps) {
  if (!ruta.startsWith('api/chat')) return null;
  const json = (status, b) => ({ status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(b) });
  if (!cliente) return json(200, { ok: false, error: 'login' });
  const tC = tabla(cfg, deps, 'chats'), tM = tabla(cfg, deps, 'chat_mensajes');
  const falta = (e) => { console.error(e); return json(200, { ok: false, error: /chats|chat_mensajes|relation|does not exist|42P01|column/.test(String(e.message)) ? 'sin-tabla' : 'motor' }); };
  const enlace = `${cfg.tienda}/pages/vende-con-nosotros?view=perfil#mensajes`;
  const yo = String(cliente);

  // Escribir por primera vez (o seguir la conversación que ya hay)
  if (ruta === 'api/chat/abrir' && method === 'POST') {
    try {
      const r = await escribirEnChat(cfg, deps, { tipo: body.tipo, ref: body.ref, cliente: yo, nombre: body.nombre, email: body.email, texto: body.texto });
      return json(r.ok ? 200 : r.error === 'no-existe' ? 404 : 400, r);
    } catch (e) { return falta(e); }
  }

  if (ruta === 'api/chat' && method === 'GET') {
    try {
      const [a, b] = await Promise.all([tC.leer(`dueno=eq.${encodeURIComponent(yo)}&order=actualizado.desc&limit=100`), tC.leer(`cliente=eq.${encodeURIComponent(yo)}&order=actualizado.desc&limit=100`)]);
      const l = [...a, ...b].sort((x, y) => Date.parse(y.actualizado) - Date.parse(x.actualizado)).map((c) => vista(c, yo));
      return json(200, { ok: true, chats: l, sin_leer: l.filter((c) => c.sin_leer).length });
    } catch (e) { return falta(e); }
  }

  if (ruta === 'api/chat/mensajes') {
    try {
      const [c] = await tC.leer(`id=eq.${Number(body.id)}&limit=1`);
      if (!c || (String(c.dueno) !== yo && String(c.cliente) !== yo)) return json(404, { ok: false, error: 'no-existe' });
      const soyDueno = String(c.dueno) === yo;
      const ahora = new Date().toISOString();
      if (method === 'POST') {
        const texto = clip(body.texto, 2000);
        if (!texto) return json(400, { ok: false, error: 'texto' });
        const limpio = tapa(cfg, c.tipo) && !(await reservaPagada(cfg, deps, c.dueno, c.cliente)) ? tapar(texto) : texto;
        await tM.guardar({ chat_id: Number(c.id), de: yo, texto: limpio }, 'id');
        const otroLeido = soyDueno ? c.leido_cliente : c.leido_dueno;
        const yaAvisado = c.ultimo_de === yo && (!otroLeido || Date.parse(otroLeido) < Date.parse(c.actualizado));
        await tC.cambiar(c.id, { ultimo: limpio.slice(0, 200), ultimo_de: yo, actualizado: ahora, [soyDueno ? 'leido_dueno' : 'leido_cliente']: ahora });
        if (!yaAvisado) {
          let para = soyDueno ? c.cliente_email : '';
          if (!soyDueno) para = (await deQuien(cfg, deps, c.tipo, c.ref).catch(() => null))?.email || '';
          await avisar(cfg, deps, para, soyDueno ? (c.dueno_nombre || 'El dueño').split(' ')[0] : c.cliente_nombre || 'Interesado', c, limpio, enlace);
        }
      } else await tC.cambiar(c.id, { [soyDueno ? 'leido_dueno' : 'leido_cliente']: ahora });
      const l = await tM.leer(`chat_id=eq.${Number(c.id)}&order=creado.asc&limit=500`);
      return json(200, { ok: true, chat: vista(c, yo), mensajes: l.map((m) => ({ id: m.id, mio: String(m.de) === yo, texto: m.texto, creado: m.creado })) });
    } catch (e) { return falta(e); }
  }
  return json(404, { ok: false, error: 'ruta' });
}
