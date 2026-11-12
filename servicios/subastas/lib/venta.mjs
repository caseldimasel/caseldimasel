/* SIDONIA · «Te ayudamos a venderlo» (gestión de venta) desde el formulario de una sola pantalla (como Wallapop).
 *
 * POST api/venta { fotos: [rutas], tipo, marca, modelo, anio, km, precio, ubicacion, historia, nombre, telefono, email }
 *   Con su sesión (la firma del tema). Las fotos se suben antes como las de los anuncios (api/anuncio/fotos).
 *   Al equipo le llega todo (con las fotos) y al cliente, la confirmación. No se guarda en ninguna tabla: lo lleva el
 *   equipo desde el email, como las solicitudes del formulario de contacto de antes.
 */
import { avisarEquipo, esc, telefono as normTel, urlFoto } from './circulo.mjs';
import { enviarCorreo, P, plantilla } from './correos.mjs';
import { guardarGestion } from './solicitudes.mjs';

const texto = (v, n) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);

/** Limpia la solicitud: { ok, datos } o { ok: false, error, campo } */
export function leerVenta(b = {}, cliente = '') {
  const fallo = (campo) => ({ ok: false, error: 'datos', campo });
  const carpeta = String(cliente).replace(/\W/g, '');
  const propia = new RegExp(`^${carpeta}/[a-z0-9-]{8,64}\\.(jpg|png|webp)$`);
  const fotos = (Array.isArray(b.fotos) ? b.fotos : []).map(String).filter((f) => propia.test(f)).slice(0, 30);
  const d = {
    tipo: b.tipo === 'moto' ? 'moto' : 'coche',
    marca: texto(b.marca, 40), modelo: texto(b.modelo, 60),
    anio: /^\d{4}$/.test(String(b.anio || '').trim()) ? String(b.anio).trim() : '',
    km: texto(b.km, 20).replace(/[^\d.]/g, ''), precio: texto(b.precio, 20).replace(/[^\d.]/g, ''),
    ubicacion: texto(b.ubicacion, 120), historia: texto(b.historia, 6000), mecanica: texto(b.mecanica, 6000),
    ficha: (Array.isArray(b.ficha) ? b.ficha : []).map((x) => [texto(Array.isArray(x) ? x[0] : '', 40), texto(Array.isArray(x) ? x[1] : '', 300)]).filter(([k, v]) => k && v).slice(0, 40),
    nombre: texto(b.nombre, 80), telefono: normTel(b.telefono), email: texto(b.email, 160), fotos
  };
  if (!fotos.length) return fallo('fotos');
  if (!d.marca) return fallo('marca');
  if (!d.modelo) return fallo('modelo');
  if (d.nombre.length < 2) return fallo('nombre');
  if (!d.telefono) return fallo('telefono');
  return { ok: true, datos: d };
}

export async function recibirVenta(body, cliente, cfg, deps = {}) {
  if (!cliente) return { ok: false, error: 'login' };
  const v = leerVenta(body, cliente);
  if (!v.ok) return v;
  const d = v.datos;
  const titulo = [d.marca, d.modelo, d.anio].filter(Boolean).join(' ');
  const filas = [['Vehículo', `${titulo}${d.tipo === 'moto' ? ' (moto)' : ''}`], ['Kilómetros', d.km], ['Precio que le gustaría', d.precio ? `${d.precio} €` : ''], ['Dónde está', d.ubicacion],
    ['Nombre', d.nombre], ['Teléfono', d.telefono], ['Email', d.email], ['Cliente', String(cliente)]].filter(([, x]) => x);
  const html = `<p><b>Nueva solicitud de gestión de venta</b> desde la web.</p>
<table>${filas.map(([k, x]) => `<tr><td style="padding:2px 12px 2px 0;color:#666">${esc(k)}</td><td><b>${esc(x)}</b></td></tr>`).join('')}</table>
${d.historia ? `<h3>Su historia</h3><p style="white-space:pre-line">${esc(d.historia)}</p>` : ''}
${d.ficha.length ? `<h3>Ficha técnica</h3><ul>${d.ficha.map(([k, x]) => `<li>${esc(k)}: <b>${esc(x)}</b></li>`).join('')}</ul>` : ''}
${d.mecanica ? `<h3>Mecánica y estado</h3><p style="white-space:pre-line">${esc(d.mecanica)}</p>` : ''}
<p>${d.fotos.map((f, i) => `<a href="${esc(urlFoto(cfg, f))}"><img src="${esc(urlFoto(cfg, f))}" alt="Foto ${i + 1}" width="180" style="margin:0 6px 6px 0;border-radius:8px"></a>`).join('')}</p>
<p><a href="https://wa.me/${esc(d.telefono.replace('+', ''))}">Escribirle por WhatsApp</a></p>`;
  // Al panel (Gestiones de venta) y al equipo por email
  const g = await guardarGestion(cfg, deps, cliente, d);
  const panel = cfg.servidor ? `<p><a href="${esc(cfg.servidor)}/admin?estado=gestiones${g?.id ? `#g${Number(g.id)}` : ''}">Verla en el panel</a></p>` : '';
  await avisarEquipo(cfg, `Gestión de venta: ${titulo}`, html + panel, deps.fetch).catch((e) => console.error(e));
  if (d.email) {
    const c = plantilla(cfg, null, { titulo: '¡Lo tenemos!', previa: `Hemos recibido tu ${titulo}.`,
      cuerpo: P(`Hola ${esc(d.nombre.split(/\s+/)[0])}:`) + P(`Hemos recibido tu <b>${esc(titulo)}</b> para que te ayudemos a venderlo. Te escribimos por WhatsApp en menos de 48 horas para contarte cómo lo haríamos: el vídeo contando su historia, nuestras redes y las visitas.`) + P('Solo cobramos si se vende.'),
      boton: 'Ver Sidonia', enlace: cfg.tienda || 'https://sidonia.es' });
    await enviarCorreo(cfg, d.email, `Hemos recibido tu ${titulo}`, c, deps.fetch).catch((e) => console.error(e));
  }
  return { ok: true };
}
