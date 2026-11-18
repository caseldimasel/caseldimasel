/* SIDONIA · Panel › Herramientas › Emails: cómo se ve cada email que Sidonia manda a los dueños, con los datos de un
 * anuncio de verdad (o de ejemplo), y «Mandarme una prueba» para verlo en el móvil o en Gmail.
 *   ?estado=correos[&ver=<plantilla>][&id=<anuncio>]
 * Lo que de verdad se ha enviado a cada persona está en Resend › Emails (resend.com).
 */
import { esc, tablaAnuncios } from './circulo.mjs';
import { correoBienvenida, correoCambiosAprobados, correoCambiosRechazados, correoPublicado, correoRechazado, correoRecibido, enviarCorreo } from './correos.mjs';
import { correoMejoras } from './mejoras.mjs';
import { correoPago, correoRenovar } from './comunidad.mjs';
import { marco } from './operaciones.mjs';

const EJEMPLO = { id: 0, tipo: 'coche', titulo: 'BMW M3 E30 1988', vendedor_nombre: 'Carlos', email: '', fotos: [], producto: '', caduca: new Date(Date.now() + 20 * 864e5).toISOString() };
const MOTIVO = 'Las fotos tienen poca luz y en la portada no se ve el coche entero. ¿Puedes hacer otras de día?';

// [clave, grupo, nombre, cuándo se manda, (cfg, a) => { asunto, html }]
export const PLANTILLAS = [
  ['bienvenida', 'Clientes', 'Bienvenida', 'La primera vez que alguien entra con su cuenta en Sidonia.', (cfg, a) => correoBienvenida(cfg, a.vendedor_nombre || 'Carlos')],
  ['recibido', 'Anuncios', 'Anuncio recibido', 'Nada más enviar su anuncio desde la web.', (cfg, a) => correoRecibido(cfg, a)],
  ['mejoras', 'Anuncios', 'Pedir mejoras', 'Al pulsar «Enviar las recomendaciones» en Por revisar.', (cfg, a) => correoMejoras(cfg, a, a.mejoras?.pedido ? a.mejoras : { claves: ['portada', 'historia'], texto: '' })],
  ['publicado', 'Anuncios', 'Publicado', 'Al aprobarlo y publicarlo en la tienda.', (cfg, a) => correoPublicado(cfg, a, a.producto ? `${cfg.tienda}/products/${a.producto}` : cfg.tienda)],
  ['rechazado', 'Anuncios', 'No publicado', 'Al rechazarlo, con el motivo que escribáis.', (cfg, a) => correoRechazado(cfg, a, a.nota || MOTIVO)],
  ['cambios_si', 'Anuncios', 'Cambios aprobados', 'Al aprobar lo que ha editado de un anuncio publicado.', (cfg, a) => correoCambiosAprobados(cfg, a, a.producto ? `${cfg.tienda}/products/${a.producto}` : '')],
  ['cambios_no', 'Anuncios', 'Cambios no aprobados', 'Al no aprobar lo que ha editado, con el motivo.', (cfg, a) => correoCambiosRechazados(cfg, a, MOTIVO)],
  ['renovar', 'Pagos', 'Activa tu anuncio', 'Cuando hay que pagar: al publicar el segundo anuncio y antes de que caduque (sin renovación).', (cfg, a) => correoRenovar(cfg, a, 12.9)],
  ['activada', 'Pagos', 'Renovación activada', 'Al pagar con tarjeta por primera vez.', (cfg, a) => correoPago(cfg, a, 'activada', { precio: 12.9, fecha: a.caduca })],
  ['aviso', 'Pagos', 'Se renueva el día X', '3 días antes de cada cobro.', (cfg, a) => correoPago(cfg, a, 'aviso', { precio: 12.9, fecha: a.caduca })],
  ['cobrado', 'Pagos', 'Recibo', 'Cada vez que Stripe cobra el mes.', (cfg, a) => correoPago(cfg, a, 'cobrado', { precio: 12.9, fecha: a.caduca })],
  ['fallido', 'Pagos', 'Cobro fallido', 'Si no se puede cobrar (tarjeta caducada…).', (cfg, a) => correoPago(cfg, a, 'fallido', { precio: 12.9 })],
  ['baja', 'Pagos', 'Baja confirmada', 'Al darse de baja.', (cfg, a) => correoPago(cfg, a, 'baja', { fecha: a.caduca })],
  ['fin', 'Pagos', 'Anuncio finalizado', 'Cuando se acaba el último mes pagado tras la baja.', (cfg, a) => correoPago(cfg, a, 'fin')]
];

export function paginaCorreos(cfg, a, { ver = 'mejoras', aviso = '', para = '' } = {}) {
  const p = PLANTILLAS.find((x) => x[0] === ver) || PLANTILLAS[1];
  const c = p[4](cfg, a);
  const grupos = [...new Set(PLANTILLAS.map((x) => x[1]))];
  const enlace = (k) => `?estado=correos&ver=${k}${a.id ? `&id=${a.id}` : ''}`;
  return marco('Emails', 'correos', `
${aviso ? `<p class="aviso${/^Error/.test(aviso) ? ' mal' : ''}">${esc(aviso)}</p>` : ''}
<div class="correos">
  <aside>${grupos.map((g) => `<h3>${g}</h3>${PLANTILLAS.filter((x) => x[1] === g).map(([k, , t, cuando]) => `<a href="${enlace(k)}" class="${k === p[0] ? 'on' : ''}"><b>${esc(t)}</b><small>${esc(cuando)}</small></a>`).join('')}`).join('')}</aside>
  <section>
    <form class="con" method="get"><input type="hidden" name="estado" value="correos"><input type="hidden" name="ver" value="${p[0]}">
      <label>Con los datos del anuncio nº <input name="id" type="number" min="1" value="${a.id || ''}" placeholder="ejemplo"></label><button class="boton claro">Ver</button>
      <span class="sub">${a.id ? `«${esc(a.titulo)}» de ${esc(a.vendedor_nombre || '')}` : 'Con un anuncio de ejemplo'}</span></form>
    <div class="sobre"><span>Asunto</span><b>${esc(c.asunto)}</b><span>De</span><b>${esc(cfg.avisosRemitente)}</b></div>
    <iframe title="Vista previa" srcdoc="${esc(c.html)}" loading="lazy"></iframe>
    <form class="con" method="post" action="${enlace(p[0])}"><input type="hidden" name="accion" value="prueba">
      <label>Mandarme una prueba a <input name="para" type="email" required value="${esc(para || cfg.avisosEquipo?.[0] || '')}" placeholder="tu@email.com"></label><button class="boton">Enviar prueba</button></form>
    <p class="nota">Lo que se ha enviado de verdad a cada persona (y si lo ha abierto) está en Resend › Emails. Para cambiar un texto o el diseño, dímelo y lo cambio en la plantilla.</p>
  </section>
</div>`, `
  .correos { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 16px; align-items: start; }
  .correos aside { display: grid; gap: 6px; position: sticky; top: 12px; }
  .correos aside h3 { margin: 10px 0 2px; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: var(--flojo); }
  .correos aside a { display: grid; gap: 2px; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--linea); background: var(--caja); color: var(--texto); text-decoration: none; }
  .correos aside a.on { border-color: var(--verde); background: var(--verde-fondo); }
  .correos aside small { font-size: 12px; line-height: 1.4; color: var(--suave); }
  .correos section { display: grid; gap: 12px; min-width: 0; }
  .correos .con { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; }
  .correos .con label { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 14px; color: var(--suave); }
  .correos .con input { width: auto; min-width: 0; max-width: 240px; }
  .correos .sobre { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 12px; padding: 12px 14px; border-radius: 12px; background: var(--caja); border: 1px solid var(--linea); font-size: 14px; }
  .correos .sobre span { color: var(--flojo); } .correos .sobre b { overflow-wrap: anywhere; }
  .correos iframe { width: 100%; height: 900px; border: 0; border-radius: 16px; background: #f6f5f2; }
  @media (max-width: 800px) { .correos { grid-template-columns: 1fr; } .correos aside { position: static; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); } .correos aside h3 { grid-column: 1 / -1; } .correos aside small { display: none; } .correos iframe { height: 760px; } }`);
}

/** ?estado=correos: ver y mandar una prueba */
export async function rutasCorreos(req, cfg, deps, html) {
  let a = { ...EJEMPLO, email: cfg.avisosEquipo?.[0] || '' };
  const id = Number(req.query.id);
  if (id) {
    try {
      const [x] = await (deps.tabla || tablaAnuncios(cfg, deps.fetch)).leer(`id=eq.${id}&select=*`);
      if (x) a = x;
    } catch (e) { console.error(e); }
  }
  const ver = String(req.query.ver || 'mejoras');
  let aviso = id && !a.id ? `Error: no hay ningún anuncio nº ${id}; se ve con uno de ejemplo.` : '';
  const para = String(req.body?.para || '').trim();
  if (req.method === 'POST' && req.body?.accion === 'prueba') {
    const p = PLANTILLAS.find((x) => x[0] === ver);
    if (!p || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(para)) aviso = 'Error: pon un email válido.';
    else {
      try {
        const c = p[4](cfg, a);
        aviso = (await enviarCorreo(cfg, para, `[Prueba] ${c.asunto}`, c.html, deps.fetch)) ? `Prueba enviada a ${para}.` : 'Error: falta RESEND_API_KEY en Vercel.';
      } catch (e) { aviso = `Error: ${e.message}`; }
    }
  }
  return html(paginaCorreos(cfg, a, { ver, aviso, para }));
}
