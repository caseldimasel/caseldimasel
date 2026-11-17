/* SIDONIA · Centro operativo: el expediente de cada coche que vende Sidonia, de principio a fin.
 *
 *   1. Captado      llega por el formulario (Gestiones de venta › «Abrir expediente») o en persona / por teléfono
 *                   («+ Nuevo coche»): los datos del propietario, del coche y las condiciones (comisión, exclusividad…)
 *   2. Contrato     el contrato de intermediación y exclusividad, con sus datos: se envía por email o WhatsApp con un
 *                   enlace; el propietario lo lee, completa lo que falte (DNI, domicilio) y lo firma (firma electrónica
 *                   simple: nombre, fecha, IP, dispositivo y huella SHA-256 del texto)
 *   3. En venta     firmado: se enlaza con su anuncio de la web
 *   4. Vendido      precio final, fecha y comprador
 *   5. Facturado    la factura de la comisión: % sobre el precio final (editable), a nombre del propietario o de otra
 *                   persona o empresa, forma de pago; se envía por email o WhatsApp (enlace a la factura, para PDF)
 *   6. Cobrado      fecha y forma de cobro. En efectivo, solo por debajo de 1.000 € (Ley 7/2012, art. 7)
 *
 * Se guarda en la venta (tabla operaciones, columna expediente) y la factura en facturas (con su venta). Los datos del
 * emisor de las facturas y las condiciones por defecto, en ajustes (clave «facturacion»), editables en el panel.
 * Base de datos: sql/centro-operativo.sql. Páginas públicas (enlace firmado): /tienda/intermediacion y /tienda/factura.
 */
import { createHash, createHmac } from 'node:crypto';
import { esc, tablaAnuncios } from './circulo.mjs';
import { documentoValido, normDoc } from './cobros.mjs';
import { enviarCorreo, P, plantilla } from './correos.mjs';
import { importe, n } from './estadisticas.mjs';
import { marco, parecido } from './operaciones.mjs';

export const VERSION_INTERMEDIACION = '2026-11-17';
export const LIMITE_EFECTIVO = 1000;
export const FORMAS_PAGO = { transferencia: 'Transferencia', bizum: 'Bizum', tarjeta: 'Tarjeta', efectivo: 'Efectivo' };
export const FASES = [['captado', 'Ficha creada'], ['contrato', 'Contrato enviado'], ['firmado', 'Firmado · vídeo'], ['en_web', 'En la web'], ['vendido', 'Vendido'], ['facturado', 'Facturado'], ['cobrado', 'Cobrado']];
const ORIGENES = { persona: 'En persona', llamada: 'Por teléfono', web: 'Formulario de la web', recomendacion: 'Recomendación', otro: 'Otro' };
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const hoyISO = () => new Date().toISOString().slice(0, 10);
const t = (v, max = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const num = importe;
const r2 = (x) => Math.round(n(x) * 100) / 100;
export const eur = (x) => `${n(x).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' })} €`;
const eur0 = (x) => `${Math.round(n(x)).toLocaleString('es-ES', { useGrouping: 'always' })} €`;
const fechaTxt = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' }) : '');

/* ---------------------------------------------------------------------------- Ajustes: el emisor de las facturas */
export const EMISOR_VACIO = { nombre: '', nif: '', direccion: '', email: '', telefono: '', iban: '', marca: 'Sidonia', comision_pct: 5, comision_min: 0, exclusividad_meses: 3, iva_pct: 21 };
export const leerEmisor = (v) => ({ ...EMISOR_VACIO, ...(v || {}) });
export const emisorCompleto = (e) => Boolean(e.nombre && e.nif && e.direccion);
export function leerAjustesForm(b) {
  const e = { nombre: t(b.nombre, 120), nif: normDoc(b.nif).slice(0, 20), direccion: t(b.direccion, 250), email: t(b.email, 160), telefono: t(b.telefono, 40), iban: t(b.iban, 40).toUpperCase(), marca: t(b.marca, 60) || 'Sidonia',
    comision_pct: num(b.comision_pct) ?? 5, comision_min: num(b.comision_min) ?? 0, exclusividad_meses: Math.max(1, Math.min(24, Math.round(num(b.exclusividad_meses) ?? 3))), iva_pct: num(b.iva_pct) ?? 21 };
  if (!(e.comision_pct >= 0 && e.comision_pct <= 50)) return { error: 'La comisión por defecto no es válida.' };
  return { emisor: e };
}

/* ---------------------------------------------------------------------------- Enlaces firmados (sin sesión) */
const firma = (cfg, tipo, id) => createHmac('sha256', String(cfg.clave || cfg.secreto || 'sidonia')).update(`${tipo}.${Number(id)}`).digest('hex').slice(0, 32);
export const urlIntermediacion = (cfg, id) => `${cfg.servidor}/tienda/intermediacion?o=${Number(id)}&f=${firma(cfg, 'intermediacion', id)}`;
export const urlFactura = (cfg, id) => `${cfg.servidor}/tienda/factura?n=${Number(id)}&f=${firma(cfg, 'factura', id)}`;
export const firmaOk = (cfg, tipo, id, f) => Boolean(Number(id)) && String(f || '') === firma(cfg, tipo, id);

/* ---------------------------------------------------------------------------- El expediente */
/** La fase en la que está: la del contrato y la venta, y la de su factura (si la tiene) */
export function faseDe(o, factura = null) {
  const x = o.expediente || {};
  if (factura && factura.estado !== 'anulada') return factura.cobrada ? 'cobrado' : 'facturado';
  if (o.estado === 'vendido') return 'vendido';
  if (x.contrato?.firma) return o.handle ? 'en_web' : 'firmado';
  if (x.contrato?.enviado) return 'contrato';
  if (o.estado === 'captado') return 'captado';
  return o.handle || !Object.keys(x).length ? 'en_web' : 'firmado';
}
export const tituloCoche = (c = {}) => [c.marca, c.modelo, c.anio].filter(Boolean).join(' ').toUpperCase();

/** Lee el formulario del expediente: { op, error } (op: las columnas de la venta + expediente) */
export function leerExpediente(b, antes = {}) {
  const x = antes.expediente || {};
  const propietario = { nombre: t(b.p_nombre, 120), dni: normDoc(b.p_dni).slice(0, 20), direccion: t(b.p_direccion, 250), email: t(b.p_email, 160).toLowerCase(), telefono: t(b.p_telefono, 40) };
  const coche = { marca: t(b.c_marca, 40), modelo: t(b.c_modelo, 80), anio: t(b.c_anio, 4), matricula: t(b.c_matricula, 15).toUpperCase().replace(/[\s-]/g, ''), bastidor: t(b.c_bastidor, 20).toUpperCase(), km: t(b.c_km, 20) };
  const condiciones = { comision_pct: num(b.k_pct), comision_min: num(b.k_min), precio_salida: num(b.k_salida), precio_minimo: num(b.k_minimo), exclusividad_meses: Math.max(1, Math.min(24, Math.round(num(b.k_meses) ?? 3))) };
  if (!coche.marca || !coche.modelo) return { error: 'Pon la marca y el modelo.' };
  if (!propietario.nombre) return { error: 'Pon el nombre del propietario.' };
  if (propietario.dni && !documentoValido(propietario.dni)) return { error: 'Revisa el DNI, NIE o CIF del propietario.' };
  if (propietario.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(propietario.email)) return { error: 'Revisa el email del propietario.' };
  if (condiciones.comision_pct == null || condiciones.comision_pct < 0 || condiciones.comision_pct > 50) return { error: 'Pon la comisión (%).' };
  const exp = { ...x, origen: ORIGENES[b.origen] ? b.origen : x.origen || 'persona', propietario, coche, condiciones, notas: t(b.notas, 1000) };
  // Si cambian los datos del contrato después de enviarlo (y antes de firmarlo), hay que volver a enviarlo
  if (x.contrato?.enviado && !x.contrato?.firma && JSON.stringify([x.propietario, x.coche, x.condiciones]) !== JSON.stringify([propietario, coche, condiciones])) exp.contrato = { ...x.contrato, cambiado: true };
  return { op: { titulo: tituloCoche(coche), tipo: antes.tipo || 'coche', modalidad: 'gestion', comercial: t(b.comercial, 60) || null,
    ...(!antes.id && b.handle ? { handle: String(b.handle).replace(/[^a-z0-9-]/g, '').slice(0, 160) || null } : {}), propietario_nombre: propietario.nombre, propietario_email: propietario.email || null, propietario_telefono: propietario.telefono || null,
    precio_anunciado: condiciones.precio_salida, expediente: exp } };
}
/** «PORSCHE 911 CARRERA 3.2 1986» → { marca: 'Porsche', modelo: '911 Carrera 3.2', anio: '1986' } */
const DOBLES = ['land rover', 'range rover', 'aston martin', 'alfa romeo', 'rolls royce', 'austin healey', 'mercedes benz', 'de tomaso'];
export function cocheDeTitulo(titulo) {
  const s = String(titulo || '').replace(/\s+/g, ' ').trim();
  const anio = (s.match(/\b(19|20)\d{2}\b(?!.*\b(19|20)\d{2}\b)/) || [''])[0];
  const sin = s.replace(anio, '').trim();
  const bajo = sin.toLowerCase().replace(/-/g, ' ');
  const doble = DOBLES.find((d) => bajo.startsWith(`${d} `));
  const partes = sin.split(' ');
  const n = doble && partes[0].toLowerCase().replace(/-/g, ' ') !== doble ? doble.split(' ').length : 1;
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  return { marca: partes.slice(0, n).map((w) => w.split('-').map(cap).join('-')).join(' '), modelo: partes.slice(n).join(' '), anio, matricula: '', bastidor: '', km: '' };
}
const conHistorial = (exp, texto) => ({ ...exp, historial: [...(exp.historial || []), { fecha: new Date().toISOString(), texto }].slice(-80) });

/* ---------------------------------------------------------------------------- El contrato de intermediación */
const hueco = (v, txt = '______________') => (v || v === 0 ? esc(v) : `<span class="hueco">${txt}</span>`);
/** El contrato (HTML): con los datos del expediente; firmado, con su bloque de firmas */
export function contratoIntermediacion(o, emisor, { firmado = null } = {}) {
  const x = o.expediente || {}, p = { ...(x.propietario || {}), ...(firmado ? { nombre: firmado.nombre, dni: firmado.dni, direccion: firmado.direccion || x.propietario?.direccion } : {}) }, c = x.coche || {}, k = x.condiciones || {};
  const e = leerEmisor(emisor);
  const cl = (() => { let i = 0; return (titulo, ...ps) => `<h3>${++i}. ${titulo}</h3>${ps.filter(Boolean).map((q) => (q.startsWith('<') ? q : `<p>${q}</p>`)).join('')}`; })();
  const veh = [c.marca, c.modelo, c.anio].filter(Boolean).join(' ');
  // Un ejemplo con sus números: si se vende por el precio de salida
  const pct = Number(k.comision_pct), ej = Number(k.precio_salida) > 0 && pct >= 0 ? Math.max(Number(k.precio_salida) * pct / 100, Number(k.comision_min) || 0) : 0;
  const ivaPct = Number(e.iva_pct) || 21;
  const ejemplo = ej ? `Por ejemplo: si el Vehículo se vende por ${eur0(k.precio_salida)}, los honorarios serían ${eur(ej)} más ${eur(ej * ivaPct / 100)} de IVA (${eur(ej * (1 + ivaPct / 100))} en total).` : '';
  const marca = esc(e.marca || 'Sidonia');
  return `<h1>Contrato de intermediación y exclusividad de venta</h1>
<p class="meta">Expediente n.º ${Number(o.id) || '—'} · Modelo ${VERSION_INTERMEDIACION}</p>
<div class="nota"><b>Lo importante, en claro</b> (resumen informativo; lo que vale es el texto de las cláusulas):
<ul style="margin:8px 0 0">
<li><b>Qué hace ${marca}:</b> anuncia y vende tu ${hueco(veh)} por ti (fotos y vídeo, web y redes, interesados, visitas, negociación y papeles). No compra el coche: lo vendes tú al comprador y tú decides si aceptas cada oferta.</li>
<li><b>Exclusiva ${hueco(k.exclusividad_meses, '__')} meses:</b> durante ese tiempo solo lo vende ${marca}; no lo anuncias ni lo vendes por otro lado.</li>
<li><b>Cuánto cuesta:</b> el ${hueco(k.comision_pct, '__')} % del precio final de venta${k.comision_min ? ` (mínimo ${eur0(k.comision_min)})` : ''} + IVA, y solo si se vende. Si no se vende, no pagas nada. ${ejemplo}</li>
<li><b>Puedes echarte atrás:</b> tienes 14 días desde que firmas para desistir sin dar explicaciones y sin coste (tienes el formulario al final).</li>
<li><b>Firma:</b> firmas desde el móvil; te llega una copia por email y queda registrada con fecha, hora y huella digital.</li></ul></div>
<h2>Reunidos</h2>
<p><b>De una parte</b>, ${hueco(e.nombre)}, con NIF ${hueco(e.nif)} y domicilio en ${hueco(e.direccion, '______________________________')}${e.email ? `, email ${esc(e.email)}` : ''}${e.telefono ? ` y teléfono ${esc(e.telefono)}` : ''}, que actúa con la marca comercial «${marca}» (en adelante, «Sidonia»).</p>
<p><b>De otra parte</b>, D./D.ª ${hueco(p.nombre)}, con DNI/NIE/CIF ${hueco(p.dni)}, con domicilio en ${hueco(p.direccion, '______________________________')}, teléfono ${hueco(p.telefono)} y email ${hueco(p.email)}, que actúa en su propio nombre o en representación de la sociedad indicada (en adelante, «el Propietario»).</p>
<p>Ambas partes se reconocen capacidad legal para contratar y</p>
<h2>Exponen</h2>
<p>I. Que el Propietario es titular del vehículo <b>${hueco(veh)}</b>, matrícula ${hueco(c.matricula)}, número de bastidor ${hueco(c.bastidor)}${c.km ? `, con ${esc(c.km)} km` : ''} (en adelante, «el Vehículo»), y que puede venderlo libremente, sin cargas, embargos ni reservas de dominio, salvo los que comunique por escrito a Sidonia antes de firmar.</p>
<p>II. Que Sidonia se dedica a la intermediación en la compraventa de vehículos clásicos y especiales, y que el Propietario le encarga la venta del Vehículo con arreglo a las siguientes</p>
<h2>Cláusulas</h2>
${cl('Objeto y naturaleza', 'El Propietario encarga a Sidonia, que acepta, la intermediación para la venta del Vehículo: hacer fotos y vídeo, anunciarlo en sidonia.es y en sus redes y canales, atender a los interesados, enseñar el Vehículo, transmitir y negociar las ofertas y acompañar a las partes hasta la firma de la compraventa y el cambio de titularidad.', 'Es un contrato de mediación o corretaje (artículo 1255 del Código Civil): Sidonia no compra el Vehículo, no lo vende en su nombre ni es parte de la compraventa, que se celebra directamente entre el Propietario y el comprador. El Propietario decide siempre si acepta o no cada oferta. Sidonia pone los medios para venderlo, pero no garantiza que se venda ni en qué plazo.')}
${cl('Precio', `El precio de salida es de <b>${k.precio_salida ? eur0(k.precio_salida) : hueco('', '________ €')}</b>${k.precio_minimo ? ` y el Propietario acepta vender a partir de <b>${eur0(k.precio_minimo)}</b>` : ''}. Sidonia consultará al Propietario cualquier oferta por debajo de ese precio y no cerrará ninguna venta sin su conformidad. Las partes pueden cambiar el precio de común acuerdo por escrito (por email o WhatsApp).`)}
${cl('Exclusividad y duración', `Este encargo se hace <b>en exclusiva</b> durante <b>${hueco(k.exclusividad_meses, '__')} meses</b> desde su firma. Durante ese plazo, el Propietario no venderá el Vehículo por sí mismo ni a través de otros intermediarios, ni lo anunciará en otros medios (portales, redes, concesionarios), salvo que Sidonia lo autorice por escrito.`, 'Al terminar el plazo, el encargo seguirá sin exclusividad mientras ninguna de las partes lo dé por terminado por escrito, con un preaviso de 7 días. Las partes pueden prorrogar la exclusividad de común acuerdo por escrito.')}
${cl('Honorarios de Sidonia', `Por su intermediación, Sidonia cobrará el <b>${hueco(k.comision_pct, '__')} %</b> del precio final de venta${k.comision_min ? `, con un mínimo de <b>${eur0(k.comision_min)}</b>` : ''}, más el IVA correspondiente (hoy, el ${ivaPct} %). ${ejemplo}`, 'Los honorarios se ganan cuando se firma la compraventa del Vehículo con un comprador presentado o atendido por Sidonia, y se pagan cuando el Propietario cobra el precio, contra la factura de Sidonia, por transferencia, Bizum o tarjeta (o en efectivo si el total es inferior a 1.000 €, como exige la Ley 7/2012). La factura puede ir a nombre de otra persona o empresa si el Propietario lo pide.', 'También se deben si, durante la exclusividad, el Propietario vende el Vehículo por su cuenta o por otro medio, o si en los 6 meses siguientes al fin del encargo lo vende a un comprador que conoció a través de Sidonia.', '<b>Si el Vehículo no se vende, el Propietario no paga nada a Sidonia</b>, salvo los gastos extraordinarios que hubiera autorizado antes por escrito.')}
${cl('Gastos', 'Los gastos de anuncio, fotografía, vídeo y gestión ordinaria de la venta corren a cargo de Sidonia. Los del cambio de titularidad, la ITV, las reparaciones, la limpieza a fondo, el transporte y cualquier otro gasto del Vehículo corren a cargo del Propietario, salvo que se acuerde otra cosa por escrito.')}
${cl('Fotos, vídeo y anuncio', 'El Propietario autoriza a Sidonia a hacer fotos y vídeos del Vehículo y a publicarlos en su web, sus redes y otros canales mientras dure el encargo. Las fotos y los vídeos son de Sidonia, que podrá seguir usándolos después para dar a conocer su trabajo (por ejemplo, «vendido por Sidonia»), sin mostrar la matrícula ni datos personales del Propietario.')}
${cl('Obligaciones del Propietario', 'El Propietario garantiza que los datos del Vehículo son ciertos y se compromete a: tener en regla y facilitar su documentación (permiso de circulación, ficha técnica, ITV y, si las hay, facturas de mantenimiento); informar a Sidonia y a los interesados de cualquier defecto, siniestro o carga que conozca; mantener el Vehículo asegurado y en buen estado mientras esté en venta; facilitar que los interesados lo vean y lo prueben en las condiciones que acuerden las partes; y avisar a Sidonia de inmediato si recibe una oferta por otro medio.', 'El Propietario responde frente al comprador de lo que diga la compraventa (estado del Vehículo, vicios ocultos y documentación). Sidonia responde de su propia actuación como intermediario.')}
${cl('El Vehículo bajo la custodia de Sidonia', 'Si el Propietario deja el Vehículo o sus llaves a Sidonia (para fotos, vídeo o visitas), Sidonia lo cuidará con diligencia y solo lo moverá para esos fines. El seguro del Vehículo sigue siendo el del Propietario. Las condiciones de un depósito prolongado se acordarán por escrito.')}
${cl('Desistimiento', 'Si el Propietario actúa como consumidor y firma este contrato a distancia o fuera de un establecimiento de Sidonia, puede desistir de él en un plazo de <b>14 días naturales</b> desde su firma, sin indicar el motivo y sin ningún coste. Para hacerlo, basta con comunicarlo a Sidonia de forma inequívoca por email o WhatsApp, o con el formulario del final. Si pide que Sidonia empiece a anunciar el Vehículo durante ese plazo y después desiste, no tendrá que pagar nada.', 'Pasado ese plazo, si el Propietario termina el encargo antes de acabar la exclusividad sin causa imputable a Sidonia, abonará a Sidonia los gastos extraordinarios que hubiera autorizado por escrito y que estén justificados.')}
${cl('Protección de datos', `Responsable: ${hueco(e.nombre)} (${marca}). Sidonia trata los datos del Propietario y del Vehículo para cumplir este contrato, anunciar el Vehículo (sin datos personales en los anuncios) y cumplir sus obligaciones legales y fiscales (como emitir la factura), con base en el propio contrato y en esas obligaciones. No los cede salvo al comprador, en lo necesario para la compraventa, a la gestoría y a la Administración cuando la ley lo exija. Los conserva mientras dure el contrato y los plazos legales. El Propietario puede ejercer sus derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a ${hueco(e.email)}, y reclamar ante la Agencia Española de Protección de Datos.`)}
${cl('Firma electrónica', 'Las partes firman este contrato electrónicamente mediante firma electrónica simple (Reglamento (UE) n.º 910/2014 y Ley 6/2020), con plena validez. Sidonia conserva el texto firmado, su huella digital (SHA-256) y el registro de la fecha, la hora, la dirección IP y el dispositivo de la firma, y envía una copia al Propietario.')}
${cl('Comunicaciones y reclamaciones', `Las partes se comunican por email o WhatsApp en los datos de este contrato. Cualquier queja o reclamación puede dirigirse a ${hueco(e.email)}; Sidonia responderá en el plazo más breve posible y, como máximo, en un mes.`)}
${cl('Ley aplicable', 'Este contrato se rige por la ley española. Si el Propietario es consumidor, son competentes los juzgados de su domicilio; en los demás casos, los que correspondan según la ley.')}
<section id="firmas"><h2>Firmas</h2><div class="firmas">
  <div class="firma"><b>Sidonia</b><span>${esc(e.nombre || '')}</span><small>Ofrece el contrato a la firma el ${fechaTxt(x.contrato?.enviado || hoyISO())}</small></div>
  <div class="firma"><b>El Propietario</b>${firmado ? `<span>${esc(firmado.nombre)} · ${esc(firmado.dni)}</span><small>Firmado electrónicamente el ${esc(new Date(firmado.fecha).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }))}${firmado.ip ? ` · IP ${esc(firmado.ip)}` : ''}</small>` : '<span class="hueco">Pendiente de firma</span>'}</div>
</div></section>
<h2>Anexo · Formulario de desistimiento</h2>
<p class="meta">Solo debe rellenarlo y enviarlo si desea desistir del contrato.</p>
<p>A la atención de ${hueco(e.nombre)} (${marca}), ${hueco(e.direccion, '______________________________')}, ${hueco(e.email)}:</p>
<p>Por la presente le comunico que desisto de mi contrato de intermediación para la venta del vehículo ${hueco(veh)}, matrícula ${hueco(c.matricula)}, firmado el __________. Nombre del Propietario: __________________. Domicilio: __________________. Firma (solo si se presenta en papel) y fecha: __________________.</p>`;
}
const huella = (html) => createHash('sha256').update(String(html), 'utf8').digest('hex');

/* ---------------------------------------------------------------------------- La factura */
/** El siguiente número de factura del año: «2026-021» */
export function siguienteNumero(facturas, fecha = hoyISO()) {
  const ano = String(fecha).slice(0, 4);
  const max = facturas.map((f) => String(f.numero).match(new RegExp(`^${ano}-(\\d+)$`))).filter(Boolean).reduce((m, x) => Math.max(m, Number(x[1])), 0);
  return `${ano}-${String(max + 1).padStart(3, '0')}`;
}
/** La factura propuesta para una venta: % sobre el precio final (con el mínimo), a nombre del propietario */
export function facturaPropuesta(o, emisor, facturas) {
  const x = o.expediente || {}, k = x.condiciones || {}, e = leerEmisor(emisor);
  const precio = n(o.precio_venta);
  // Las ventas de antes (sin condiciones): la comisión que tenían apuntada
  const viejo = k.comision_pct == null && n(o.comision) > 0;
  const pct = viejo ? (precio ? Math.round((n(o.comision) / precio) * 10000) / 100 : null) : k.comision_pct ?? e.comision_pct;
  const base = viejo ? r2(o.comision) : r2(Math.max(precio * n(pct) / 100, n(k.comision_min)));
  const c = x.coche || {};
  return { numero: siguienteNumero(facturas), fecha: hoyISO(), pct, precio_venta: precio, base: base || n(o.comision) || 0, iva_pct: e.iva_pct,
    concepto: `Gestión de Venta ${[c.marca, c.modelo].filter(Boolean).join(' ') || o.titulo}${c.matricula ? ` ${c.matricula}` : ''}`.trim(),
    destinatario: { nombre: x.propietario?.nombre || o.propietario_nombre || '', nif: x.propietario?.dni || '', direccion: x.propietario?.direccion || '' }, forma_pago: 'transferencia' };
}
/** Lee el formulario de la factura: { factura, error } */
export function leerFacturaForm(b, o) {
  const numero = t(b.numero, 30), fecha = String(b.fecha || '');
  if (!numero) return { error: 'Pon el número de factura.' };
  if (!DIA.test(fecha)) return { error: 'Pon la fecha de la factura.' };
  const base = num(b.base), pct = num(b.iva_pct) ?? 21;
  if (base == null || base < 0) return { error: 'La base (nuestra comisión, sin IVA) no es un número.' };
  const destinatario = { nombre: t(b.d_nombre, 160), nif: normDoc(b.d_nif).slice(0, 20), direccion: t(b.d_direccion, 250) };
  if (!destinatario.nombre) return { error: 'Pon a nombre de quién va la factura.' };
  if (destinatario.nif && !documentoValido(destinatario.nif)) return { error: 'Revisa el NIF de la factura.' };
  const forma = FORMAS_PAGO[b.forma_pago] ? b.forma_pago : 'transferencia';
  const iva = r2(base * pct / 100), total = r2(base + iva);
  if (forma === 'efectivo' && total >= LIMITE_EFECTIVO) return { error: `En efectivo solo se puede cobrar si el total es menor de ${eur0(LIMITE_EFECTIVO)} (Ley 7/2012: el límite es para la operación entera, no se puede partir). Esta factura es de ${eur(total)}: cobradla por transferencia, Bizum o tarjeta.` };
  return { factura: { numero, fecha, cliente: destinatario.nombre, nif: destinatario.nif, concepto: t(b.concepto, 300) || 'Gestión de venta', base: r2(base), iva, total, operacion_id: Number(o.id), forma_pago: forma, estado: 'emitida',
    datos: { destinatario, pct: num(b.pct), precio_venta: num(b.precio_venta), iva_pct: pct } } };
}
/** La factura (HTML para ver, imprimir o guardar en PDF), con el diseño de las facturas de Sidonia */
export function facturaHTML(cfg, f, emisor) {
  const e = leerEmisor(f.datos?.emisor || emisor), d = f.datos?.destinatario || { nombre: f.cliente, nif: f.nif };
  const logo = cfg.servidor ? `<img src="${esc(cfg.servidor)}/admin?recurso=logo" alt="SIDONIA" class="logo" onerror="this.outerHTML='<div class=&quot;logo-t&quot;>SIDONIA</div>'">` : '<div class="logo-t">SIDONIA</div>';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Factura ${esc(f.numero)} · SIDONIA</title>
<style>
body{margin:0;background:#f2f2f2;color:#2b2b2b;font:15px/1.5 Montserrat,Inter,system-ui,-apple-system,sans-serif}
.hoja{max-width:794px;margin:24px auto;background:#fff;padding:56px 70px 40px;box-shadow:0 20px 50px -30px rgba(0,0,0,.35);min-height:1000px;display:flex;flex-direction:column}
.logo{display:block;width:280px;margin:0 auto 54px}.logo-t{text-align:center;font:600 54px/1 Georgia,serif;letter-spacing:4px;margin-bottom:54px}
.cab{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}.cab h1{margin:0;color:#a3171b;font-size:40px;letter-spacing:1px}
.cab .n{text-align:right;font-size:16px}.cab .n b{font-weight:700}
.emisor{margin:26px 0 34px;font-size:16px}.cliente h2{margin:0 0 4px;font-size:16px;letter-spacing:1px}.cliente{font-size:16px;margin-bottom:34px}
table{width:100%;border-collapse:collapse;font-size:16px}th{text-align:left;padding:12px 2px;border-top:2px solid #a3171b;border-bottom:2px solid #a3171b}th:last-child,td:last-child{text-align:right;width:140px}
td{padding:22px 2px;border-bottom:2px solid #a3171b}
.tot{margin:18px 0 0 auto;width:300px;font-size:16px}.tot div{display:flex;justify-content:space-between;padding:4px 0}.tot .t{border-top:2px solid #a3171b;border-bottom:2px solid #a3171b;margin-top:8px;padding:10px 0;font-size:21px;font-weight:700}
.pago{margin-top:auto;text-align:center;font-size:14px;padding-top:60px}.pago b{font-weight:700}.gracias{text-align:center;font-size:20px;font-weight:700;margin:40px 0 0;padding-bottom:12px;border-bottom:3px solid #a3171b}
.nota{max-width:794px;margin:0 auto;color:#666;font-size:12px;padding:0 16px}
.acc{display:flex;gap:10px;justify-content:flex-end;max-width:794px;margin:18px auto 0;padding:0 16px}.acc button{border:0;border-radius:999px;background:#1a1a1a;color:#fff;padding:11px 18px;font-weight:700;cursor:pointer;font:inherit}
.anulada{color:#a3171b;font-weight:700;text-align:center;font-size:22px;border:3px solid #a3171b;padding:8px;margin-bottom:20px}
@media print{body{background:#fff}.hoja{box-shadow:none;margin:0;padding:40px 50px;min-height:0;height:100vh;box-sizing:border-box}.acc,.nota{display:none}}
@media (max-width:640px){.hoja{padding:32px 20px}.logo{width:200px;margin-bottom:30px}.cab h1{font-size:30px}}
</style></head><body><div class="acc"><button onclick="print()">Imprimir o guardar en PDF</button></div>
<div class="hoja">${logo}
${f.estado === 'anulada' ? '<div class="anulada">FACTURA ANULADA</div>' : ''}
<div class="cab"><h1>FACTURA</h1><div class="n">Fecha: <b>${esc(new Date(`${String(f.fecha).slice(0, 10)}T12:00:00Z`).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Madrid' }))}</b><br>Factura n.º <b>${esc(f.numero)}</b></div></div>
<div class="emisor">${esc(e.nombre)}<br>${esc(e.nif)}<br>${esc(e.direccion)}</div>
<div class="cliente"><h2>CLIENTE</h2>${esc(d.nombre || '')}${d.nif ? `<br>${esc(d.nif)}` : ''}${d.direccion ? `<br>${esc(d.direccion)}` : ''}</div>
<table><thead><tr><th>Servicio</th><th>Total</th></tr></thead><tbody><tr><td>${esc(f.concepto)}${f.datos?.precio_venta && f.datos?.pct ? `<br><small style="color:#777">${esc(String(f.datos.pct).replace('.', ','))} % sobre el precio de venta de ${eur(f.datos.precio_venta)}</small>` : ''}</td><td>${eur(f.base)}</td></tr></tbody></table>
<div class="tot"><div><span>Base imponible:</span><span>${eur(f.base)}</span></div><div><span>I.V.A. ${esc(String(f.datos?.iva_pct ?? (n(f.base) ? Math.round((n(f.iva) / n(f.base)) * 100) : 21)))} %:</span><span>${eur(f.iva)}</span></div><div class="t"><span>Total:</span><span>${eur(f.total)}</span></div></div>
<div class="pago">Forma de pago: <b>${esc(FORMAS_PAGO[f.forma_pago] || 'Transferencia')}</b>${(f.forma_pago || 'transferencia') === 'transferencia' && e.iban ? `<br>N.º de cuenta: ${esc(e.iban)}` : ''}</div>
<div class="gracias">¡Gracias por tu confianza!</div></div>
<p class="nota">Factura de ${esc(e.marca || 'Sidonia')}. Guárdala en PDF con el botón de arriba.</p></body></html>`;
}

/* ---------------------------------------------------------------------------- WhatsApp y email */
const telWa = (tel) => { const d = String(tel || '').replace(/[^\d+]/g, '').replace(/^\+/, '').replace(/^00/, ''); return d.length === 9 ? `34${d}` : d; };
export const enlaceWa = (tel, texto) => (telWa(tel) ? `https://wa.me/${telWa(tel)}?text=${encodeURIComponent(texto)}` : '');
const primerNombre = (s) => (/\b(s\.?\s?l\.?|s\.?\s?a\.?|sociedad|slu)\b/i.test(String(s || '')) ? String(s) : String(s || '').split(' ')[0]);
export const textoWaContrato = (cfg, o) => `Hola ${primerNombre(o.expediente?.propietario?.nombre)}, soy de Sidonia. Aquí tienes el contrato de intermediación para la venta de tu ${tituloCoche(o.expediente?.coche)}: léelo, completa tus datos y fírmalo desde el móvil en un minuto: ${urlIntermediacion(cfg, o.id)}`;
export const textoWaFactura = (cfg, o, f) => `Hola ${primerNombre(f.datos?.destinatario?.nombre || o.propietario_nombre)}, ¡enhorabuena por la venta de tu ${o.titulo}! Aquí tienes nuestra factura ${f.numero} (${eur(f.total)}): ${urlFactura(cfg, f.id)}`;

/* ---------------------------------------------------------------------------- Páginas del panel */
const CSS = `
  .exp-cab { display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: center; }
  .exp-cab h2 { margin: 0 0 4px; font-size: 22px; } .exp-cab p { margin: 2px 0; color: var(--suave); }
  .pasos { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; margin: 14px 0 16px; counter-reset: p; }
  .pasos li { list-style: none; padding: 10px 10px 10px 36px; position: relative; border-radius: 12px; background: var(--caja); border: 1px solid var(--linea); font-size: 13px; font-weight: 700; color: var(--flojo); }
  .pasos li::before { counter-increment: p; content: counter(p); position: absolute; left: 10px; top: 50%; transform: translateY(-50%); width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; background: var(--caja-3); color: var(--suave); font-size: 11px; }
  .pasos li.ok { color: var(--texto); } .pasos li.ok::before { content: '✓'; background: var(--verde); color: var(--verde-tinta); }
  .pasos li.on { color: var(--texto); border-color: var(--verde); box-shadow: 0 0 0 1px var(--verde) inset; } .pasos li.on::before { background: var(--verde); color: var(--verde-tinta); }
  .bloque { border-left: 3px solid var(--linea-2); } .bloque.on { border-left-color: var(--verde); } .bloque.hecho { opacity: .92; }
  .bloque h2 { display: flex; gap: 10px; align-items: center; } .bloque h2 small { font-size: 12px; font-weight: 600; color: var(--suave); letter-spacing: 0; text-transform: none; }
  .chip { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 800; background: var(--caja-3); color: var(--suave); }
  .chip.si { background: var(--verde-fondo); color: var(--verde); } .chip.am { background: rgba(255,196,0,.14); color: #f0b400; } .chip.no { background: var(--rojo-fondo); color: var(--rojo); }
  .acc-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; }
  .acc-row .boton { padding: 9px 14px; font-size: 14px; } .boton.wa { background: #25d366; color: #04150c !important; }
  .g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; } .g3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 14px; }
  .g2 label, .g3 label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--suave); } .g2 .ancho { grid-column: 1 / -1; }
  fieldset.fs { border: 1px solid var(--linea); border-radius: 14px; padding: 12px 14px 14px; margin: 0 0 12px; } fieldset.fs legend { padding: 0 6px; font-weight: 800; font-size: 13px; }
  .resumen-f { display: grid; grid-template-columns: repeat(4, auto); gap: 6px 22px; justify-content: start; font-size: 14px; } .resumen-f span { color: var(--suave); }
  .aviso-ef { margin: 8px 0 0; font-size: 13px; color: #f0b400; }
  .check { list-style: none; padding: 0; margin: 0 0 12px; display: flex; flex-wrap: wrap; gap: 8px 18px; font-size: 14px; } .check li { display: flex; align-items: center; gap: 8px; color: var(--suave); }
  .check li::before { content: ''; width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--linea-2); flex: none; } .check li.ok { color: var(--texto); } .check li.ok::before { background: var(--verde); border-color: var(--verde); }
  .check .mini { padding: 5px 10px; font-size: 12px; }
  .anu { display: grid; grid-template-columns: 96px 1fr auto; gap: 12px; align-items: center; padding: 10px; border: 1px solid var(--linea); border-radius: 14px; margin: 0 0 8px; background: var(--caja-2); }
  .anu img, .anu .anu-f { width: 96px; height: 72px; object-fit: cover; border-radius: 10px; display: block; background: var(--caja-3); } .anu b { display: block; } .anu span { font-size: 12px; color: var(--suave); }
  .hist { list-style: none; padding: 0; margin: 0; font-size: 13px; } .hist li { padding: 6px 0; border-bottom: 1px solid var(--linea); } .hist time { color: var(--flojo); margin-right: 8px; }
  .kanban { display: grid; grid-template-columns: repeat(7, minmax(170px, 1fr)); gap: 10px; overflow-x: auto; padding-bottom: 6px; }
  .col { background: var(--caja); border: 1px solid var(--linea); border-radius: 16px; padding: 10px; min-height: 120px; }
  .col h3 { margin: 2px 4px 10px; font-size: 13px; display: flex; justify-content: space-between; } .col h3 b { color: var(--suave); }
  .tarj { display: block; background: var(--caja-2); border: 1px solid var(--linea); border-radius: 12px; padding: 10px; margin-bottom: 8px; text-decoration: none; color: inherit; }
  .tarj:hover { border-color: var(--verde); } .tarj b { display: block; font-size: 13px; line-height: 1.3; } .tarj span { display: block; font-size: 12px; color: var(--suave); margin-top: 3px; }
  .tarj .dinero { color: var(--verde); font-weight: 800; }
  @media (max-width: 800px) { .pasos { grid-template-columns: repeat(4, 1fr); } .g2, .g3 { grid-template-columns: 1fr; } .exp-cab { grid-template-columns: 1fr; } .resumen-f { grid-template-columns: auto auto; } }`;

const campo = (etq, nombre, valor, extra = '') => `<label>${etq}<input name="${nombre}" value="${esc(valor ?? '')}"${extra}></label>`;
function formExpediente(o = {}, emisor = {}, { accion = 'guardar', boton = 'Guardar' } = {}) {
  const x = o.expediente || {}, p = x.propietario || {}, c = x.coche || {}, k = x.condiciones || {}, e = leerEmisor(emisor);
  return `<form method="post" action="?estado=expediente${o.id ? `&id=${Number(o.id)}` : ''}">
  <fieldset class="fs"><legend>Propietario</legend><div class="g2">
    ${campo('Nombre y apellidos (o empresa)', 'p_nombre', p.nombre || o.propietario_nombre, ' required')}${campo('DNI / NIE / CIF', 'p_dni', p.dni, ' placeholder="Si no lo tienes, lo pone al firmar"')}
    ${campo('Teléfono', 'p_telefono', p.telefono || o.propietario_telefono, ' inputmode="tel"')}${campo('Email', 'p_email', p.email || o.propietario_email, ' type="email"')}
    <label class="ancho">Domicilio<input name="p_direccion" value="${esc(p.direccion || '')}" placeholder="Calle, n.º, CP y ciudad"></label></div></fieldset>
  <fieldset class="fs"><legend>Vehículo</legend><div class="g3">
    ${campo('Marca', 'c_marca', c.marca, ' required')}${campo('Modelo', 'c_modelo', c.modelo, ' required')}${campo('Año', 'c_anio', c.anio, ' inputmode="numeric" maxlength="4"')}
    ${campo('Matrícula', 'c_matricula', c.matricula, ' style="text-transform:uppercase"')}${campo('N.º de bastidor', 'c_bastidor', c.bastidor, ' style="text-transform:uppercase"')}${campo('Kilómetros', 'c_km', c.km)}</div></fieldset>
  <fieldset class="fs"><legend>Condiciones</legend><div class="g3">
    ${campo('Comisión (%)', 'k_pct', k.comision_pct ?? e.comision_pct, ' inputmode="decimal" required')}${campo('Comisión mínima (€, opcional)', 'k_min', k.comision_min ?? (e.comision_min || ''), ' inputmode="decimal"')}${campo('Exclusividad (meses)', 'k_meses', k.exclusividad_meses ?? e.exclusividad_meses, ' inputmode="numeric"')}
    ${campo('Precio de salida (€)', 'k_salida', k.precio_salida ?? o.precio_anunciado, ' inputmode="decimal"')}${campo('Precio mínimo que acepta (€, opcional)', 'k_minimo', k.precio_minimo, ' inputmode="decimal"')}
    <label>Cómo llegó<select name="origen">${Object.entries(ORIGENES).map(([a, b]) => `<option value="${a}"${(x.origen || 'persona') === a ? ' selected' : ''}>${b}</option>`).join('')}</select></label></div>
    <div class="g2" style="margin-top:10px"><label>Lo lleva<input name="comercial" value="${esc(o.comercial ?? 'Hugo')}" placeholder="Hugo"></label><label>Notas<input name="notas" value="${esc(x.notas || '')}"></label></div>
    ${o.handle ? `<input type="hidden" name="handle" value="${esc(o.handle)}">` : ''}</fieldset>
  <button class="boton" name="accion" value="${accion}">${boton}</button></form>`;
}

/** Un expediente: los 6 pasos, cada uno con lo que se puede hacer */
export function paginaExpediente(cfg, o, { factura = null, facturas = [], emisor = {}, aviso = '', anuncios = [], ligados = new Set() } = {}) {
  const x = o.expediente || {}, p = x.propietario || {}, c = x.coche || {}, k = x.condiciones || {}, e = leerEmisor(emisor);
  const fase = faseDe(o, factura), i = FASES.findIndex(([f]) => f === fase);
  const pasos = `<ol class="pasos">${FASES.map(([f, nombre], j) => `<li class="${j < i || fase === 'cobrado' ? 'ok' : ''}${j === i ? ' on' : ''}">${nombre}</li>`).join('')}</ol>`;
  // (cada bloque, con sus fases: el de vídeo y web son dos)
  const blq = (js, titulo, estado, cuerpo) => { const [a, z] = [].concat(js); const hasta = z ?? a; return `<div class="card bloque${i >= a && i <= hasta ? ' on' : hasta < i ? ' hecho' : ''}"><h2>${titulo} ${estado}</h2>${cuerpo}</div>`; };
  const id = Number(o.id);
  const f = (accion, txt, clase = 'boton claro', extra = '') => `<form method="post" action="?estado=expediente&id=${id}" style="display:inline"><button class="${clase}" name="accion" value="${accion}"${extra}>${txt}</button></form>`;
  const faltanContrato = [!emisorCompleto(e) && 'los datos de Sidonia (Finanzas › Datos de facturación)', !c.matricula && 'la matrícula', !k.comision_pct && k.comision_pct !== 0 && 'la comisión'].filter(Boolean);
  const ct = x.contrato || {};
  const contrato = ct.firma
    ? `<p>Firmado por <b>${esc(ct.firma.nombre)}</b> (${esc(ct.firma.dni)}) el ${esc(new Date(ct.firma.fecha).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }))} · IP ${esc(ct.firma.ip || '—')}.</p><div class="acc-row"><a class="boton" href="${esc(urlIntermediacion(cfg, id))}" target="_blank" rel="noopener">Ver el contrato firmado</a></div>`
    : `${faltanContrato.length ? `<p class="aviso">Antes de enviarlo, completa ${faltanContrato.join(', ')}.</p>` : ''}${ct.cambiado ? '<p class="aviso">Has cambiado datos después de enviarlo: vuelve a enviárselo.</p>' : ''}
      <p>${ct.enviado ? `Enviado el ${esc(fechaTxt(ct.enviado))} por ${esc(ct.via || '—')}. Aún no lo ha firmado.` : 'El propietario lo recibe con un enlace: lo lee, completa sus datos (DNI y domicilio) y lo firma desde el móvil.'}</p>
      <div class="acc-row"><a class="boton claro" href="${esc(urlIntermediacion(cfg, id))}" target="_blank" rel="noopener">Ver el contrato</a>
        ${p.email ? f('contrato-email', `Enviar por email${ct.enviado ? ' otra vez' : ''}`, 'boton') : '<span class="sub">Sin email</span>'}
        ${p.telefono ? `<a class="boton wa" href="?estado=expediente&id=${id}&wa=contrato" target="_blank" rel="noopener">Enviar por WhatsApp</a>` : '<span class="sub">Sin teléfono</span>'}
        ${!ct.enviado ? f('contrato-firmado-papel', 'Lo ha firmado en papel', 'boton claro', ' onclick="return confirm(\'¿Lo ha firmado en papel? Guarda el papel firmado.\')"') : ''}</div>`;
  const chipC = ct.firma ? '<span class="chip si">Firmado</span>' : ct.enviado ? '<span class="chip am">Enviado</span>' : '<span class="chip">Sin enviar</span>';
  const venta = o.estado === 'vendido'
    ? `<div class="resumen-f"><span>Vendido por</span><b>${eur0(o.precio_venta)}</b><span>Fecha</span><b>${esc(fechaTxt(o.fecha_venta))}</b><span>Comprador</span><b>${esc(o.comprador_nombre || '—')}</b><span>Comisión</span><b>${o.comision ? eur(o.comision) : '—'}</b></div>
       <details style="margin-top:10px"><summary>Cambiar la venta</summary>${formVenta(o)}</details>`
    : formVenta(o);
  // 3. Vídeo y anuncio en la web: con el contrato firmado se hace el vídeo, se sube a Shopify y se liga aquí
  const enWeb = o.handle ? anuncios.find((a) => a.handle === o.handle) : null;
  const sugeridos = o.handle ? [] : anuncios.filter((a) => !a.comunidad && !ligados.has(a.handle)).map((a) => ({ ...a, puntos: parecido(o.titulo || tituloCoche(c), a.titulo, { anioDistinto: 0.25 }) })).filter((a) => a.puntos >= 0.45).sort((a, b) => b.puntos - a.puntos).slice(0, 3);
  const tarjAnuncio = (a, boton) => `<div class="anu">${a.foto ? `<img src="${esc(a.foto)}" alt="">` : '<span class="anu-f"></span>'}<div><b>${esc(a.titulo)}</b><span>${a.situacion === 'vendido' ? 'Vendido en la web' : a.situacion === 'oculto' ? 'Oculto en la web' : 'En venta en la web'}${a.puntos ? ` · se parece un ${Math.round(a.puntos * 100)} %` : ''}</span></div>${boton}</div>`;
  const anuncio = `<ol class="check"><li class="${ct.firma ? 'ok' : ''}">Contrato firmado</li><li class="${x.video ? 'ok' : ''}">Vídeo hecho ${x.video ? `<small>(${esc(fechaTxt(x.video))})</small>` : f('video', 'Ya está el vídeo', 'boton claro mini')}</li><li class="${o.handle ? 'ok' : ''}">Subido a Shopify y ligado con su ficha</li></ol>
    ${enWeb ? tarjAnuncio(enWeb, `<div class="acc-row" style="margin:0"><a class="boton claro" href="${esc(cfg.tienda)}/products/${esc(o.handle)}" target="_blank" rel="noopener">Ver en la web</a><a class="boton claro" href="?estado=anuncio&h=${encodeURIComponent(o.handle)}">Sus números</a></div>`)
      : o.handle ? `<p>Ligado con <b>${esc(o.handle)}</b> (ya no está en la tienda).</p>` : ''}
    ${enWeb && enWeb.situacion === 'vendido' && o.estado !== 'vendido' ? '<p class="aviso">En la web ya está vendido: ponle abajo el precio final para hacer la factura.</p>' : ''}
    ${!o.handle ? `${sugeridos.length ? `<p>¿Es alguno de estos anuncios de la web?</p>${sugeridos.map((a) => tarjAnuncio(a, `<form method="post" action="?estado=expediente&id=${id}"><input type="hidden" name="handle" value="${esc(a.handle)}"><button class="boton" name="accion" value="anuncio">Es este, ligar</button></form>`)).join('')}` : `<p class="sub">${ct.firma ? 'Cuando lo subáis a Shopify, aparecerá aquí para ligarlo.' : 'Primero, el contrato firmado; luego el vídeo y subirlo a Shopify.'}</p>`}` : ''}
    <details${o.handle || sugeridos.length ? '' : ' open'}><summary>${o.handle ? 'Cambiar el anuncio' : 'Buscar otro anuncio'}</summary><form method="post" action="?estado=expediente&id=${id}" class="acc-row"><input name="handle" list="anuncios-web" value="${esc(o.handle || '')}" placeholder="Busca su anuncio…" style="min-width:280px"><button class="boton claro" name="accion" value="anuncio">Ligar</button></form>
    <datalist id="anuncios-web">${anuncios.filter((a) => !a.comunidad).map((a) => `<option value="${esc(a.handle)}">${esc(a.titulo)}</option>`).join('')}</datalist></details>`;
  const prop = facturaPropuesta(o, e, facturas);
  const fact = factura
    ? `<div class="resumen-f"><span>Factura</span><b>${esc(factura.numero)}</b><span>Total</span><b>${eur(factura.total)}</b><span>A nombre de</span><b>${esc(factura.cliente)}</b><span>Pago</span><b>${esc(FORMAS_PAGO[factura.forma_pago] || '—')}</b></div>
      <p>${factura.datos?.enviada ? `Enviada el ${esc(fechaTxt(factura.datos.enviada.fecha))} por ${esc(factura.datos.enviada.via)}.` : 'Aún no se ha enviado.'}</p>
      <div class="acc-row"><a class="boton claro" href="${esc(urlFactura(cfg, factura.id))}" target="_blank" rel="noopener">Ver / PDF</a>
        ${(factura.datos?.destinatario?.email || p.email) ? f('factura-email', 'Enviar por email', 'boton') : ''}
        ${p.telefono ? `<a class="boton wa" href="?estado=expediente&id=${id}&wa=factura" target="_blank" rel="noopener">Enviar por WhatsApp</a>` : ''}
        ${f('factura-anular', 'Anular', 'boton claro', ' onclick="return confirm(\'¿Anular la factura? Queda como anulada (no se borra) y puedes hacer otra.\')"')}</div>`
    : o.estado !== 'vendido' ? '<p class="sub">Cuando lo marques como vendido, aquí harás la factura.</p>' : formFactura(prop, e, id);
  const cobro = factura
    ? factura.cobrada ? `<p>Cobrada el <b>${esc(fechaTxt(factura.cobrada))}</b> por ${esc(FORMAS_PAGO[factura.forma_pago] || '—')}.</p>${f('cobro-deshacer', 'Deshacer el cobro')}`
      : `<form method="post" action="?estado=expediente&id=${id}" class="acc-row"><label>Fecha<input type="date" name="cobrada" value="${hoyISO()}"></label><label>Cómo<select name="forma_pago">${Object.entries(FORMAS_PAGO).map(([a, b]) => `<option value="${a}"${factura.forma_pago === a ? ' selected' : ''}>${b}</option>`).join('')}</select></label><button class="boton" name="accion" value="cobrada">Marcar como cobrada</button></form>
        ${n(factura.total) >= LIMITE_EFECTIVO ? `<p class="aviso-ef">Esta factura es de ${eur0(LIMITE_EFECTIVO)} o más: no se puede cobrar en efectivo (Ley 7/2012).</p>` : ''}`
    : '<p class="sub">Primero, la factura.</p>';
  const hist = (x.historial || []).slice().reverse().map((h) => `<li><time>${esc(new Date(h.fecha).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }))}</time>${esc(h.texto)}</li>`).join('');
  return marco(o.titulo || 'Expediente', 'expedientes', `
<p><a href="?estado=expedientes">‹ Coches de Sidonia</a></p>
${aviso ? `<p class="aviso${/^Error/.test(aviso) ? ' mal' : ''}">${esc(aviso)}</p>` : ''}
<div class="card exp-cab"><div><h2>${esc(o.titulo || tituloCoche(c))}</h2><p>${esc([c.matricula, c.km && `${c.km} km`, ORIGENES[x.origen], o.comercial && `lo lleva ${o.comercial}`].filter(Boolean).join(' · '))}</p>
  <p>Propietario: <b>${esc(p.nombre || o.propietario_nombre || '—')}</b>${p.telefono ? ` · <a href="tel:${esc(p.telefono)}">${esc(p.telefono)}</a>` : ''}${p.email ? ` · <a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ''}</p></div>
  <div style="text-align:right"><span class="chip si">${esc(FASES[i][1])}</span><p>Comisión ${esc(String(k.comision_pct ?? '—').replace('.', ','))} %${k.precio_salida ? ` · sale a ${eur0(k.precio_salida)}` : ''}</p><p><a href="?estado=operacion&id=${id}">Todos los datos de la venta ›</a></p></div></div>
${pasos}
${blq(0, '1. La ficha: el coche y su propietario', '', `<details${p.dni && c.matricula ? '' : ' open'}><summary>Ver y cambiar</summary>${formExpediente(o, e)}</details>`)}
${blq(1, '2. Contrato de intermediación y exclusividad', chipC, contrato)}
${blq([2, 3], '3. Vídeo y anuncio en la web', o.handle ? '<span class="chip si">En la web</span>' : x.video ? '<span class="chip am">Vídeo hecho</span>' : '', anuncio)}
${blq(4, '4. Vendido', o.estado === 'vendido' ? '<span class="chip si">Vendido</span>' : '', venta)}
${blq(5, '5. Factura', factura ? '<span class="chip si">Emitida</span>' : '', fact)}
${blq(6, '6. Cobro', factura?.cobrada ? '<span class="chip si">Cobrada</span>' : factura ? '<span class="chip am">Pendiente</span>' : '', cobro)}
${hist ? `<div class="card"><h2>Historial</h2><ul class="hist">${hist}</ul></div>` : ''}`, CSS);
}
function formVenta(o) {
  return `<form method="post" action="?estado=expediente&id=${Number(o.id)}"><div class="g3">
    ${campo('Precio final de venta (€)', 'precio_venta', o.precio_venta, ' inputmode="decimal" required')}<label>Fecha de venta<input type="date" name="fecha_venta" value="${esc(String(o.fecha_venta || hoyISO()).slice(0, 10))}" required></label>${campo('Comprador', 'comprador_nombre', o.comprador_nombre)}
    ${campo('Teléfono del comprador', 'comprador_telefono', o.comprador_telefono)}${campo('Email del comprador', 'comprador_email', o.comprador_email)}</div>
    <div class="acc-row"><button class="boton" name="accion" value="vendido">${o.estado === 'vendido' ? 'Guardar' : 'Marcar como vendido'}</button></div></form>`;
}
function formFactura(pr, e, id) {
  return `<form method="post" action="?estado=expediente&id=${Number(id)}" class="factura-f">
  <fieldset class="fs"><legend>A nombre de</legend><p class="sub" style="margin-top:0">Por defecto, el propietario. Cámbialo si la quiere a nombre de otra persona o empresa.</p><div class="g2">
    ${campo('Nombre o empresa', 'd_nombre', pr.destinatario.nombre, ' required')}${campo('NIF / CIF', 'd_nif', pr.destinatario.nif)}
    <label class="ancho">Domicilio<input name="d_direccion" value="${esc(pr.destinatario.direccion)}"></label></div></fieldset>
  <fieldset class="fs"><legend>Importe</legend><div class="g3">
    ${campo('Precio final de venta (€)', 'precio_venta', pr.precio_venta, ' inputmode="decimal" data-pv')}${campo('Nuestra comisión (%)', 'pct', pr.pct, ' inputmode="decimal" data-pct')}${campo('Base: nuestra comisión sin IVA (€)', 'base', pr.base, ' inputmode="decimal" required data-base')}
    ${campo('IVA (%)', 'iva_pct', pr.iva_pct, ' inputmode="decimal" data-iva')}<label>Total con IVA<input data-total readonly></label>
    <label>Forma de pago<select name="forma_pago" data-forma>${Object.entries(FORMAS_PAGO).map(([a, b]) => `<option value="${a}">${b}</option>`).join('')}</select></label></div>
    <p class="aviso-ef" data-ef hidden>En efectivo solo si el total es menor de ${eur0(LIMITE_EFECTIVO)} (Ley 7/2012). Si es más, por transferencia, Bizum o tarjeta.</p></fieldset>
  <fieldset class="fs"><legend>Factura</legend><div class="g3">${campo('N.º de factura', 'numero', pr.numero, ' required')}<label>Fecha<input type="date" name="fecha" value="${esc(pr.fecha)}" required></label>${campo('Concepto', 'concepto', pr.concepto)}</div></fieldset>
  ${!emisorCompleto(e) ? '<p class="aviso mal">Faltan los datos de Sidonia para la factura: Finanzas › Datos de facturación.</p>' : ''}
  <button class="boton" name="accion" value="factura">Crear la factura</button></form>
  <script>(() => { const f = document.querySelector('.factura-f'); const q = (s) => f.querySelector(s); const nn = (v) => { const s = String(v || '').replace(/\\s|€|%/g, ''); return Number(/,\\d{1,2}$/.test(s) ? s.replace(/\\./g, '').replace(',', '.') : s.replace(/,/g, '')) || 0; };
    const fmt = (x) => x.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
    const tot = () => { const t = nn(q('[data-base]').value) * (1 + nn(q('[data-iva]').value) / 100); q('[data-total]').value = fmt(t); q('[data-ef]').hidden = !(q('[data-forma]').value === 'efectivo' && t >= ${LIMITE_EFECTIVO}); };
    const base = () => { const b = Math.round(nn(q('[data-pv]').value) * nn(q('[data-pct]').value)) / 100; if (b) q('[data-base]').value = String(b).replace('.', ','); tot(); };
    q('[data-pv]').addEventListener('input', base); q('[data-pct]').addEventListener('input', base); ['[data-base]', '[data-iva]', '[data-forma]'].forEach((s) => q(s).addEventListener('input', tot)); tot(); })();</script>`;
}

/** Coches en gestión: un tablero con cada fase */
export function paginaExpedientes(ops, facturas, { aviso = '', todos = false } = {}) {
  const facDe = new Map(facturas.filter((f) => f.operacion_id && f.estado !== 'anulada').map((f) => [Number(f.operacion_id), f]));
  const lista = ops.filter((o) => todos || (o.expediente && Object.keys(o.expediente).length) || o.estado === 'captado');
  const porFase = Object.fromEntries(FASES.map(([f]) => [f, []]));
  for (const o of lista) porFase[faseDe(o, facDe.get(Number(o.id)))]?.push(o);
  const tarj = (o) => { const x = o.expediente || {}, fa = facDe.get(Number(o.id));
    return `<a class="tarj" href="?estado=expediente&id=${Number(o.id)}"><b>${esc(o.titulo)}</b><span>${esc(x.propietario?.nombre || o.propietario_nombre || '—')}</span>${fa ? `<span class="dinero">${eur(fa.total)}</span>` : o.precio_venta ? `<span class="dinero">Vendido por ${eur0(o.precio_venta)}</span>` : x.condiciones?.precio_salida ? `<span>Sale a ${eur0(x.condiciones.precio_salida)}</span>` : ''}${x.contrato?.enviado && !x.contrato?.firma ? `<span>Contrato enviado el ${esc(fechaTxt(x.contrato.enviado))}</span>` : ''}</a>`; };
  return marco('Coches de Sidonia', 'expedientes', `
${aviso ? `<p class="aviso${/^Error/.test(aviso) ? ' mal' : ''}">${esc(aviso)}</p>` : ''}
<div class="barra"><a class="boton" href="?estado=expediente&nuevo=1">+ Nuevo coche (su ficha y su contrato)</a><a class="boton claro" href="?estado=gestiones">Los del formulario de la web (Gestiones de venta)</a>
  <a class="boton claro" href="?estado=expedientes${todos ? '' : '&todos=1'}">${todos ? 'Solo los expedientes' : 'Ver también las ventas de antes'}</a></div>
<div class="kanban">${FASES.map(([f, nombre]) => `<div class="col"><h3>${nombre}<b>${porFase[f].length}</b></h3>${porFase[f].slice(0, 60).map(tarj).join('') || '<p class="sub" style="margin:4px">—</p>'}</div>`).join('')}</div>
<p class="nota">Cada coche que vende Sidonia, de principio a fin: la ficha (propietario y coche), el contrato de intermediación y exclusividad (se le envía por email o WhatsApp y lo firma desde el móvil), el vídeo y el anuncio en Shopify, la venta, la factura y el cobro. Pulsa en uno para seguir.</p>`, CSS);
}

/** Finanzas › Datos de facturación */
export function paginaAjustes(emisor, { aviso = '' } = {}) {
  const e = leerEmisor(emisor);
  return marco('Datos de facturación', 'facturacion', `
${aviso ? `<p class="aviso${/^Error/.test(aviso) ? ' mal' : ''}">${esc(aviso)}</p>` : ''}
<div class="card"><h2>Quién emite las facturas y los contratos</h2><p class="sub">Salen en cada factura y en el contrato de intermediación. Cuando tengáis la sociedad, cambiad aquí el nombre, el CIF y la dirección: las facturas ya hechas no cambian.</p>
<form method="post" action="?estado=facturacion"><div class="g2">
  ${campo('Nombre o razón social', 'nombre', e.nombre, ' required')}${campo('NIF / CIF', 'nif', e.nif, ' required')}
  <label class="ancho">Domicilio fiscal<input name="direccion" value="${esc(e.direccion)}" required placeholder="Calle, n.º, CP y ciudad"></label>
  ${campo('Email', 'email', e.email)}${campo('Teléfono', 'telefono', e.telefono)}
  ${campo('IBAN (para cobrar por transferencia)', 'iban', e.iban)}${campo('Marca comercial', 'marca', e.marca)}</div>
  <h3 style="margin:18px 0 8px">Condiciones por defecto de los coches nuevos</h3><div class="g3">
  ${campo('Comisión (%)', 'comision_pct', e.comision_pct, ' inputmode="decimal"')}${campo('Comisión mínima (€)', 'comision_min', e.comision_min || '', ' inputmode="decimal"')}${campo('Exclusividad (meses)', 'exclusividad_meses', e.exclusividad_meses, ' inputmode="numeric"')}
  ${campo('IVA (%)', 'iva_pct', e.iva_pct, ' inputmode="decimal"')}</div>
  <div class="acc-row"><button class="boton" name="accion" value="guardar">Guardar</button></div></form></div>`, CSS);
}

/* ---------------------------------------------------------------------------- Rutas del panel */
const AJUSTE = 'facturacion';
export async function leerAjuste(tA) { try { return leerEmisor((await tA.leer(`clave=eq.${AJUSTE}&limit=1`))[0]?.valor); } catch (e) { return leerEmisor(); } }

export async function rutasExpedientes(req, cfg, deps, html) {
  const estado = req.query.estado, b = req.body || {};
  const tO = deps.operaciones || tablaAnuncios(cfg, deps.fetch, 'operaciones');
  const tF = deps.facturas || tablaAnuncios(cfg, deps.fetch, 'facturas');
  const tA = deps.ajustes || tablaAnuncios(cfg, deps.fetch, 'ajustes');
  const tG = deps.gestiones || tablaAnuncios(cfg, deps.fetch, 'gestiones');
  const emisor = await leerAjuste(tA);
  const errorSql = (e) => (/expediente|ajustes|facturas|column|relation|schema/.test(String(e.message || e)) ? 'Error: falta ejecutar sql/centro-operativo.sql en Supabase › SQL Editor (entero; se puede repetir).' : `Error: ${e.message || e}`);
  const leerFacturas = async () => { try { return (await tF.leer('select=*&order=fecha.asc&limit=5000')).map((f) => ({ ...f, fecha: String(f.fecha).slice(0, 10), base: n(f.base), iva: n(f.iva), total: n(f.total), datos: f.datos || {} })); } catch (e) { return []; } };

  if (estado === 'facturacion') {
    let aviso = '';
    if (req.method === 'POST') {
      const { emisor: nuevo, error } = leerAjustesForm(b);
      if (error) aviso = `Error: ${error}`;
      else { try { await tA.guardar({ clave: AJUSTE, valor: nuevo, actualizado: new Date().toISOString() }, 'clave'); aviso = 'Guardado.'; } catch (e) { aviso = errorSql(e); } }
    }
    return html(paginaAjustes(req.method === 'POST' && !/^Error/.test(aviso) ? leerAjustesForm(b).emisor : emisor, { aviso }));
  }

  // Ligar un anuncio de la web con la ficha de su propietario (desde Anuncios › En la web)
  if (estado === 'ligar') {
    const h = String(req.query.h || '').replace(/[^a-z0-9-]/g, '').slice(0, 160);
    let ficha = null, ops = [];
    try { const { catalogoTienda } = await import('./actividad.mjs'); ficha = (await catalogoTienda(cfg, deps)).get(h) || null; } catch (e) { ficha = null; }
    try { ops = await tO.leer('select=*&order=id.desc&limit=5000'); } catch (e) { ops = []; }
    if (req.method === 'POST' && Number(b.id) && h) {
      const [o] = ops.filter((x) => Number(x.id) === Number(b.id));
      if (o) {
        await tO.cambiar(Number(o.id), { handle: h, expediente: conHistorial(o.expediente || {}, `Ligado con su anuncio de la web (${ficha?.titulo || h})`), actualizado: new Date().toISOString() });
        return { status: 303, headers: { Location: `?estado=expediente&id=${Number(o.id)}`, 'Cache-Control': 'no-store' }, body: '' };
      }
    }
    const ya = ops.find((x) => x.handle === h);
    const cand = ops.filter((x) => !x.handle && x.modalidad !== 'encargo' && x.estado !== 'retirado').map((x) => ({ ...x, puntos: ficha ? parecido(x.titulo, ficha.titulo, { anioDistinto: 0.25 }) : 0 }))
      .sort((a, b) => b.puntos - a.puntos || Number(Boolean(b.expediente?.contrato?.firma)) - Number(Boolean(a.expediente?.contrato?.firma))).slice(0, 12);
    return html(marco('Ligar con su propietario', 'expedientes', `<p><a href="?estado=fichas">‹ Anuncios en la web</a></p>
<div class="card">${ficha ? `<div class="anu">${ficha.foto ? `<img src="${esc(ficha.foto)}" alt="">` : '<span class="anu-f"></span>'}<div><b>${esc(ficha.titulo)}</b><span>Anuncio de la web</span></div><span></span></div>` : `<p>${esc(h)}</p>`}
${ya ? `<p>Ya está ligado con la ficha de <b>${esc(ya.propietario_nombre || ya.titulo)}</b>. <a href="?estado=expediente&id=${Number(ya.id)}">Abrir su ficha ›</a></p>` : `<h3>¿De quién es? Elige su ficha</h3>
${cand.map((x) => `<form method="post" action="?estado=ligar&h=${encodeURIComponent(h)}" class="anu"><span class="anu-f"></span><div><b>${esc(x.titulo)}</b><span>${esc(x.expediente?.propietario?.nombre || x.propietario_nombre || 'Sin propietario')}${x.expediente?.contrato?.firma ? ' · contrato firmado' : x.expediente?.contrato?.enviado ? ' · contrato enviado' : ''}${x.puntos ? ` · se parece un ${Math.round(x.puntos * 100)} %` : ''}</span></div><input type="hidden" name="id" value="${Number(x.id)}"><button class="boton">Es esta, ligar</button></form>`).join('') || '<p class="sub">No hay fichas sin anuncio.</p>'}
<div class="acc-row"><a class="boton" href="?estado=expediente&nuevo=1&h=${encodeURIComponent(h)}">+ Crear su ficha (propietario y contrato)</a></div>`}</div>`, CSS));
  }

  if (estado === 'expedientes') {
    let ops = [], aviso = '';
    try { ops = await tO.leer('select=*&order=id.desc&limit=5000'); } catch (e) { aviso = errorSql(e); }
    return html(paginaExpedientes(ops, await leerFacturas(), { aviso, todos: Boolean(req.query.todos) }));
  }

  // estado === 'expediente'
  const id = Number(req.query.id) || 0;
  // Nuevo: a mano o desde una gestión de venta (el formulario de la web)
  if (!id) {
    if (req.method === 'POST' && b.accion === 'desde-gestion' && Number(b.gestion)) {
      try {
        const [g] = await tG.leer(`id=eq.${Number(b.gestion)}&limit=1`);
        if (!g) return html(paginaExpedientes([], [], { aviso: 'Error: no encuentro esa gestión.' }));
        const d = g.datos || {};
        const exp = conHistorial({ origen: 'web', gestion_id: Number(g.id), propietario: { nombre: t(d.nombre, 120), email: t(d.email, 160).toLowerCase(), telefono: t(d.telefono, 40), dni: '', direccion: '' },
          coche: { marca: t(d.marca, 40), modelo: t(d.modelo, 80), anio: t(d.anio, 4), km: t(d.km, 20), matricula: '', bastidor: '' },
          condiciones: { comision_pct: emisor.comision_pct, comision_min: emisor.comision_min || null, exclusividad_meses: emisor.exclusividad_meses, precio_salida: num(d.precio), precio_minimo: null } }, 'Expediente abierto desde el formulario de la web');
        const o = await tO.guardar({ titulo: tituloCoche(exp.coche) || 'VEHÍCULO', tipo: 'coche', estado: 'captado', modalidad: 'gestion', propietario_nombre: exp.propietario.nombre, propietario_email: exp.propietario.email || null,
          propietario_telefono: exp.propietario.telefono || null, precio_anunciado: exp.condiciones.precio_salida, origen: 'panel', expediente: exp }, 'id');
        await tG.cambiar(Number(g.id), { estado: g.estado === 'nueva' || g.estado === 'contactado' ? 'en_gestion' : g.estado, nota: `${g.nota ? `${g.nota} · ` : ''}Expediente n.º ${o.id}`, actualizado: new Date().toISOString() }).catch(() => null);
        return { status: 303, headers: { Location: `?estado=expediente&id=${Number(o.id)}`, 'Cache-Control': 'no-store' }, body: '' };
      } catch (e) { return html(paginaExpedientes([], [], { aviso: errorSql(e) })); }
    }
    let aviso = '';
    if (req.method === 'POST' && b.accion === 'crear') {
      const { op, error } = leerExpediente(b);
      if (error) aviso = `Error: ${error}`;
      else {
        try {
          const o = await tO.guardar({ ...op, estado: 'captado', origen: 'panel', expediente: conHistorial(op.expediente, `Coche captado (${ORIGENES[op.expediente.origen]})`) }, 'id');
          return { status: 303, headers: { Location: `?estado=expediente&id=${Number(o.id)}`, 'Cache-Control': 'no-store' }, body: '' };
        } catch (e) { aviso = errorSql(e); }
      }
    }
    // Desde un anuncio de la web (Anuncios › En la web › «Ligar con su propietario» › «Crear su ficha»): con su coche
    let base = aviso ? { comercial: b.comercial, handle: b.handle, expediente: { propietario: { nombre: b.p_nombre, dni: b.p_dni, telefono: b.p_telefono, email: b.p_email, direccion: b.p_direccion }, coche: { marca: b.c_marca, modelo: b.c_modelo, anio: b.c_anio, matricula: b.c_matricula, bastidor: b.c_bastidor, km: b.c_km } } } : {};
    let deLaWeb = null;
    if (!aviso && req.query.h) {
      try { const { catalogoTienda } = await import('./actividad.mjs'); deLaWeb = (await catalogoTienda(cfg, deps)).get(String(req.query.h)) || null; } catch (e) { deLaWeb = null; }
      if (deLaWeb) base = { handle: deLaWeb.handle, expediente: { coche: cocheDeTitulo(deLaWeb.titulo) } };
    }
    return html(marco('Nuevo coche', 'expedientes', `<p><a href="?estado=expedientes">‹ Coches de Sidonia</a></p>${aviso ? `<p class="aviso mal">${esc(aviso)}</p>` : ''}
<div class="card"><h2>Nuevo coche: su ficha</h2><p class="sub">${deLaWeb ? `Para el anuncio <b>${esc(deLaWeb.titulo)}</b> de la web: pon los datos de su propietario y se quedan ligados.` : 'Los datos del propietario y del coche. Con ellos se hace el contrato de intermediación y exclusividad, que le envías para que lo firme desde el móvil. Los que llegan por el formulario de la web, ábrelos desde Gestiones de venta.'}</p>${formExpediente(base, emisor, { accion: 'crear', boton: 'Crear la ficha' })}</div>`, CSS));
  }

  let [o] = await tO.leer(`id=eq.${id}&select=*&limit=1`).catch(() => []);
  if (!o) return html(marco('Expediente', 'expedientes', '<p class="aviso mal">No encuentro ese coche.</p><p><a href="?estado=expedientes">‹ Coches en gestión</a></p>'));
  o.expediente = o.expediente || {};
  let facturas = await leerFacturas();
  let factura = facturas.filter((f) => Number(f.operacion_id) === id && f.estado !== 'anulada').pop() || null;
  const guardar = async (cambios, texto) => {
    const exp = texto ? conHistorial(cambios.expediente || o.expediente, texto) : (cambios.expediente || o.expediente);
    await tO.cambiar(id, { ...cambios, expediente: exp, actualizado: new Date().toISOString() });
    o = { ...o, ...cambios, expediente: exp };
  };
  const p = o.expediente.propietario || {};
  let aviso = '';

  // WhatsApp: se apunta como enviado y se abre WhatsApp con el mensaje y el enlace
  if (req.method === 'GET' && (req.query.wa === 'contrato' || req.query.wa === 'factura')) {
    const tel = p.telefono || o.propietario_telefono;
    if (req.query.wa === 'contrato') {
      if (!o.expediente.contrato?.firma) await guardar({ expediente: { ...o.expediente, contrato: { ...(o.expediente.contrato || {}), enviado: new Date().toISOString(), via: 'WhatsApp', cambiado: false } } }, 'Contrato enviado por WhatsApp').catch(() => null);
      return { status: 302, headers: { Location: enlaceWa(tel, textoWaContrato(cfg, o)) || '?estado=expediente&id=' + id, 'Cache-Control': 'no-store' }, body: '' };
    }
    if (factura) {
      await tF.cambiar(factura.id, { datos: { ...factura.datos, enviada: { fecha: new Date().toISOString(), via: 'WhatsApp' } } }).catch(() => null);
      await guardar({}, `Factura ${factura.numero} enviada por WhatsApp`).catch(() => null);
      return { status: 302, headers: { Location: enlaceWa(tel, textoWaFactura(cfg, o, factura)) || '?estado=expediente&id=' + id, 'Cache-Control': 'no-store' }, body: '' };
    }
  }

  if (req.method === 'POST') {
    try {
      const a = b.accion;
      if (a === 'guardar') {
        const { op, error } = leerExpediente(b, o);
        if (error) aviso = `Error: ${error}`; else { await guardar(op, 'Datos cambiados'); aviso = 'Guardado.'; }
      } else if (a === 'contrato-email') {
        if (!p.email) aviso = 'Error: el propietario no tiene email.';
        else {
          const cuerpo = P(`Hola ${esc(primerNombre(p.nombre))},`) + P(`Aquí tienes el <b>contrato de intermediación y exclusividad</b> para la venta de tu <b>${esc(o.titulo)}</b> con Sidonia. Léelo, completa tus datos y fírmalo desde el móvil: es un minuto.`) + P('Cualquier duda, responde a este email o escríbenos por WhatsApp.');
          const ok = await enviarCorreo(cfg, p.email, `Tu contrato con Sidonia: ${o.titulo}`, plantilla(cfg, null, { titulo: 'Tu contrato con Sidonia', previa: `Firma el contrato para vender tu ${o.titulo}.`, cuerpo, boton: 'Leer y firmar el contrato', enlace: urlIntermediacion(cfg, id), sinDudas: true }), deps.fetch).catch((e) => { console.error(e); return false; });
          if (!ok) aviso = 'Error: no se ha podido enviar el email (revisa RESEND_API_KEY en Vercel).';
          else { await guardar({ expediente: { ...o.expediente, contrato: { ...(o.expediente.contrato || {}), enviado: new Date().toISOString(), via: 'email', cambiado: false } } }, `Contrato enviado por email a ${p.email}`); aviso = `Enviado a ${p.email}.`; }
        }
      } else if (a === 'contrato-firmado-papel') {
        await guardar({ estado: o.estado === 'captado' ? 'en_venta' : o.estado, expediente: { ...o.expediente, contrato: { ...(o.expediente.contrato || {}), enviado: new Date().toISOString(), via: 'en papel', firma: { nombre: p.nombre, dni: p.dni, fecha: new Date().toISOString(), ip: '', papel: true } } } }, 'Contrato firmado en papel');
        aviso = 'Apuntado: firmado en papel. Guarda el original.';
      } else if (a === 'video') {
        await guardar({ expediente: { ...o.expediente, video: new Date().toISOString() } }, 'Vídeo hecho'); aviso = '¡Vídeo hecho! Ahora, a subirlo a Shopify y ligarlo aquí.';
      } else if (a === 'anuncio') {
        const h = String(b.handle || '').replace(/^.*\/products\//, '').replace(/[?#].*$/, '').trim().toLowerCase();
        await guardar({ handle: h || null }, h ? `Enlazado con su anuncio (${h})` : 'Quitado el anuncio'); aviso = 'Guardado.';
      } else if (a === 'vendido') {
        const precio = num(b.precio_venta), fecha = String(b.fecha_venta || '');
        if (!(precio > 0)) aviso = 'Error: pon el precio final de venta.';
        else if (!DIA.test(fecha)) aviso = 'Error: pon la fecha de venta.';
        else {
          const k = o.expediente.condiciones || {};
          const comision = r2(Math.max(precio * n(k.comision_pct ?? emisor.comision_pct) / 100, n(k.comision_min)));
          await guardar({ estado: 'vendido', precio_venta: precio, fecha_venta: fecha, comprador_nombre: t(b.comprador_nombre, 120) || null, comprador_telefono: t(b.comprador_telefono, 40) || null, comprador_email: t(b.comprador_email, 160) || null,
            ...(factura ? {} : { comision }) }, `Vendido por ${eur0(precio)}`);
          aviso = factura ? 'Guardado.' : `¡Vendido! Ahora, la factura (comisión prevista: ${eur(comision)} + IVA).`;
        }
      } else if (a === 'factura') {
        if (!emisorCompleto(emisor)) aviso = 'Error: faltan los datos de Sidonia para la factura (Finanzas › Datos de facturación).';
        else if (factura) aviso = 'Error: ya tiene factura. Anúlala antes para hacer otra.';
        else {
          const { factura: nueva, error } = leerFacturaForm(b, o);
          if (error) aviso = `Error: ${error}`;
          else if (facturas.some((f) => f.numero === nueva.numero)) aviso = `Error: ya hay una factura ${nueva.numero}.`;
          else {
            nueva.datos = { ...nueva.datos, emisor, destinatario: { ...nueva.datos.destinatario, email: p.email || '' } };
            const g = await tF.guardar(nueva, 'id');
            // La comisión de la venta, la de la factura (por si se ha bajado)
            await guardar({ comision: nueva.base }, `Factura ${nueva.numero} de ${eur(nueva.total)} a nombre de ${nueva.cliente}`);
            facturas = await leerFacturas(); factura = facturas.find((f) => Number(f.id) === Number(g.id)) || { ...nueva, id: g.id };
            aviso = `Factura ${nueva.numero} creada. Envíasela por email o WhatsApp.`;
          }
        }
      } else if (a === 'factura-email' && factura) {
        const para = factura.datos?.destinatario?.email || p.email;
        const cuerpo = P(`Hola ${esc(primerNombre(factura.datos?.destinatario?.nombre || p.nombre))},`) + P(`¡Enhorabuena por la venta de tu <b>${esc(o.titulo)}</b>! Te enviamos nuestra factura <b>${esc(factura.numero)}</b> por <b>${eur(factura.total)}</b>.`) + P(factura.forma_pago === 'transferencia' && emisor.iban ? `Puedes pagarla por transferencia a la cuenta ${esc(emisor.iban)}.` : `Forma de pago: ${esc(FORMAS_PAGO[factura.forma_pago] || '')}.`) + P('Gracias por confiar en Sidonia.');
        const ok = await enviarCorreo(cfg, para, `Factura ${factura.numero} · Sidonia`, plantilla(cfg, null, { titulo: `Factura ${factura.numero}`, previa: `${eur(factura.total)} · venta de tu ${o.titulo}`, cuerpo, boton: 'Ver la factura (PDF)', enlace: urlFactura(cfg, factura.id), sinDudas: true }), deps.fetch).catch((e) => { console.error(e); return false; });
        if (!ok) aviso = 'Error: no se ha podido enviar el email.';
        else { await tF.cambiar(factura.id, { datos: { ...factura.datos, enviada: { fecha: new Date().toISOString(), via: `email (${para})` } } }); factura.datos = { ...factura.datos, enviada: { fecha: new Date().toISOString(), via: `email (${para})` } }; await guardar({}, `Factura ${factura.numero} enviada por email a ${para}`); aviso = `Enviada a ${para}.`; }
      } else if (a === 'factura-anular' && factura) {
        await tF.cambiar(factura.id, { estado: 'anulada' }); await guardar({}, `Factura ${factura.numero} anulada`);
        factura = null; facturas = await leerFacturas(); aviso = 'Factura anulada. Puedes hacer otra.';
      } else if (a === 'cobrada' && factura) {
        const forma = FORMAS_PAGO[b.forma_pago] ? b.forma_pago : factura.forma_pago;
        if (forma === 'efectivo' && n(factura.total) >= LIMITE_EFECTIVO) aviso = `Error: una factura de ${eur(factura.total)} no se puede cobrar en efectivo (límite de ${eur0(LIMITE_EFECTIVO)}, Ley 7/2012).`;
        else {
          const fecha = DIA.test(String(b.cobrada || '')) ? String(b.cobrada) : hoyISO();
          await tF.cambiar(factura.id, { cobrada: fecha, forma_pago: forma }); factura = { ...factura, cobrada: fecha, forma_pago: forma };
          await guardar({}, `Cobrada la factura ${factura.numero} (${FORMAS_PAGO[forma]})`); aviso = '¡Cobrada!';
        }
      } else if (a === 'cobro-deshacer' && factura) {
        await tF.cambiar(factura.id, { cobrada: null }); factura = { ...factura, cobrada: null }; await guardar({}, `Deshecho el cobro de la factura ${factura.numero}`); aviso = 'Deshecho.';
      }
    } catch (e) { aviso = errorSql(e); }
  }
  let anuncios = [];
  try { const { catalogoTienda } = await import('./actividad.mjs'); anuncios = [...(await catalogoTienda(cfg, deps)).values()]; } catch (e) { anuncios = []; }
  let ligados = new Set();
  try { ligados = new Set((await tO.leer('select=id,handle&limit=5000')).filter((x) => x.handle && Number(x.id) !== id).map((x) => x.handle)); } catch (e) { ligados = new Set(); }
  return html(paginaExpediente(cfg, o, { factura, facturas, emisor, aviso, anuncios, ligados }));
}

/* ---------------------------------------------------------------------------- Páginas públicas (enlace firmado) */
const pagina = (titulo, cuerpo) => ({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }, body: cuerpo });
export async function rutasDocumentos({ ruta, method = 'GET', query = {}, body = {}, ip = '', ua = '' }, cfg, deps) {
  const { paginaDocumento } = await import('./contratos.mjs');
  const tO = deps.operaciones || tablaAnuncios(cfg, deps.fetch, 'operaciones');
  const tF = deps.facturas || tablaAnuncios(cfg, deps.fetch, 'facturas');
  const tA = deps.ajustes || tablaAnuncios(cfg, deps.fetch, 'ajustes');
  const mal = (texto) => pagina('Enlace no válido', paginaDocumento('Enlace no válido', `<h1>Enlace no válido</h1><p>${esc(texto)}</p>`));
  if (ruta === 'factura') {
    if (!firmaOk(cfg, 'factura', query.n, query.f)) return mal('Este enlace no es correcto. Pídenos la factura otra vez.');
    const [f] = await tF.leer(`id=eq.${Number(query.n)}&limit=1`).catch(() => []);
    if (!f) return mal('No encontramos esta factura.');
    return pagina(`Factura ${f.numero}`, facturaHTML(cfg, { ...f, datos: f.datos || {} }, await leerAjuste(tA)));
  }
  // ruta === 'intermediacion'
  if (!firmaOk(cfg, 'intermediacion', query.o, query.f)) return mal('Este enlace no es correcto. Pídenos el contrato otra vez.');
  const [o] = await tO.leer(`id=eq.${Number(query.o)}&select=*&limit=1`).catch(() => []);
  if (!o) return mal('No encontramos este contrato.');
  o.expediente = o.expediente || {};
  const emisor = await leerAjuste(tA);
  const x = o.expediente, p = x.propietario || {};
  let error = '';
  if (method === 'POST' && !x.contrato?.firma) {
    const nombre = t(body.nombre, 120), dni = normDoc(body.dni), direccion = t(body.direccion, 250) || p.direccion || '';
    if (nombre.length < 4) error = 'Escribe tu nombre y apellidos.';
    else if (!documentoValido(dni)) error = 'Revisa tu DNI, NIE o CIF (con su letra).';
    else if (direccion.length < 8) error = 'Escribe tu domicilio completo.';
    else if (!body.acepto) error = 'Marca la casilla para aceptar el contrato.';
    else {
      const fecha = new Date().toISOString();
      const firmado = { nombre, dni, direccion, fecha, ip: String(ip || '').slice(0, 60), ua: String(ua || '').slice(0, 200) };
      const expediente = { ...x, propietario: { ...p, nombre, dni, direccion } };
      const html = contratoIntermediacion({ ...o, expediente }, emisor, { firmado });
      const contrato = { ...(x.contrato || {}), enviado: x.contrato?.enviado || fecha, firma: firmado, version: VERSION_INTERMEDIACION, html, hash: huella(html) };
      const hist = [...(x.historial || []), { fecha, texto: `Contrato firmado por ${nombre} (${dni})` }];
      await tO.cambiar(Number(o.id), { estado: o.estado === 'captado' ? 'en_venta' : o.estado, propietario_nombre: nombre, expediente: { ...expediente, contrato, historial: hist }, actualizado: fecha });
      o.expediente = { ...expediente, contrato, historial: hist };
      for (const e of cfg.avisosEquipo || []) await enviarCorreo(cfg, e, `[Sidonia] Contrato firmado: ${o.titulo}`, plantilla(cfg, null, { titulo: 'Contrato firmado', previa: `${nombre} ha firmado el contrato de intermediación.`, cuerpo: P(`<b>${esc(nombre)}</b> (${esc(dni)}) ha firmado el contrato de intermediación y exclusividad del <b>${esc(o.titulo)}</b>.`), boton: 'Abrir el expediente', enlace: `${cfg.servidor}/admin?estado=expediente&id=${Number(o.id)}`, sinDudas: true }), deps.fetch).catch(() => null);
      if (p.email) await enviarCorreo(cfg, p.email, `Tu contrato firmado: ${o.titulo}`, plantilla(cfg, null, { titulo: '¡Contrato firmado!', previa: 'Tu copia del contrato.', cuerpo: P(`Gracias, ${esc(primerNombre(nombre))}. Ya está firmado el contrato para vender tu <b>${esc(o.titulo)}</b>. Aquí tienes tu copia; guárdala en PDF desde el enlace.`), boton: 'Ver mi contrato', enlace: urlIntermediacion(cfg, o.id), sinDudas: true }), deps.fetch).catch(() => null);
    }
  }
  const ct = o.expediente.contrato || {};
  if (ct.firma) {
    const cuerpo = ct.html || contratoIntermediacion(o, emisor, { firmado: ct.firma });
    return pagina('Contrato firmado', paginaDocumento('Contrato de intermediación', `${method === 'POST' ? '<div class="nota"><b>¡Firmado!</b> Te hemos enviado una copia. Puedes guardarla en PDF con el botón de arriba.</div>' : ''}${cuerpo}`, { pie: ct.hash ? `Firmado electrónicamente. Modelo ${esc(ct.version || VERSION_INTERMEDIACION)} · Huella SHA-256 del texto firmado: ${esc(ct.hash)}` : 'Firmado en papel.' }));
  }
  const form = `<form method="post" class="firmar"><h2>Firma el contrato</h2>
  <label>Nombre y apellidos (o empresa)<input name="nombre" required value="${esc(body.nombre || p.nombre || '')}" autocomplete="name"></label>
  <label>DNI / NIE / CIF<input name="dni" required value="${esc(body.dni || p.dni || '')}" autocomplete="off"></label>
  <label>Domicilio<input name="direccion" required value="${esc(body.direccion || p.direccion || '')}" placeholder="Calle, n.º, CP y ciudad" autocomplete="street-address"></label>
  <label class="chk"><input type="checkbox" name="acepto" value="1" required> He leído el contrato y lo acepto. Firmo electrónicamente.</label>
  ${error ? `<p class="err">${esc(error)}</p>` : ''}<button>Firmar el contrato</button></form>
  <style>.firmar{margin-top:28px;padding:20px;border-radius:16px;background:#f6f4ef}.firmar label{display:flex;flex-direction:column;gap:4px;margin:0 0 12px;font-weight:600;font-size:14px}.firmar input:not([type=checkbox]){font:inherit;padding:11px 12px;border:1px solid #ccc;border-radius:10px}.firmar .chk{flex-direction:row;align-items:flex-start;gap:10px;font-weight:500}.firmar .chk input{width:18px;height:18px;margin-top:2px}.firmar button{width:100%;border:0;border-radius:999px;background:#1a1a1a;color:#fff;padding:14px;font:700 16px/1 inherit;cursor:pointer}.err{color:#b00020;font-weight:700}</style>`;
  return pagina('Contrato de intermediación', paginaDocumento('Contrato de intermediación', `<div class="nota">Lee el contrato y fírmalo abajo. Comprueba tus datos y completa lo que falte.</div>${contratoIntermediacion(o, emisor)}${form}`));
}
