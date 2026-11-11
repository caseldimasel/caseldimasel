/* SIDONIA · Los documentos del alquiler entre usuarios:
 *   - Condiciones del servicio de alquiler (las aceptan los dos: el dueño al activar los cobros y quien alquila al reservar).
 *     Sidonia es un intermediario de la sociedad de la información (Ley 34/2002, LSSI): pone en contacto, cobra por cuenta
 *     del dueño a través de Stripe y se queda su tarifa de servicio. No es parte del contrato de alquiler.
 *   - Contrato de arrendamiento del vehículo, entre el dueño (arrendador) y quien alquila (arrendatario), sin conductor
 *     o con conductor. Se rellena con los datos de la reserva y lo firman los dos electrónicamente (firma electrónica
 *     simple, Reglamento (UE) 910/2014 «eIDAS» y Ley 6/2020): quien alquila al reservar y el dueño al aceptar.
 *     Se guarda el texto exacto firmado y su huella (SHA-256), con la fecha, la IP y el navegador de cada firma.
 *   - Anexo: acta de entrega y devolución.
 *
 * IMPORTANTE: son modelos redactados con cuidado, pero deben revisarlos un abogado antes de abrir el alquiler.
 * Los datos de Sidonia (razón social, NIF y domicilio) salen de las variables SIDONIA_RAZON_SOCIAL, SIDONIA_NIF y
 * SIDONIA_DOMICILIO de Vercel.
 */
import { createHash } from 'node:crypto';

export const VERSION_CONDICIONES = '2026-11-11b';
export const VERSION_CONTRATO = '2026-11-03';

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (n) => `${(Math.round(Number(n || 0) * 100) / 100).toLocaleString('es-ES', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 })} €`;
const fecha = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' }) : '');
const hueco = (v, txt = '______________') => (v ? esc(v) : `<span class="hueco">${txt}</span>`);

/** Los datos de Sidonia para los documentos */
export const sidonia = (cfg = {}) => ({
  razon: cfg.razonSocial || 'Sidonia', nif: cfg.nif || '', domicilio: cfg.domicilio || '',
  email: cfg.emailLegal || 'hola@sidonia.es', web: cfg.tienda || 'https://sidonia.es'
});

/* ---------------------------------------------------------------------------- Cancelaciones (las mismas en todo) */
/** Política de cancelación. Devuelve lo que se devuelve a quien alquila (en euros) y si se devuelve la tarifa de Sidonia.
 *  - Cancela el dueño, o el dueño no acepta / caduca: se devuelve todo.
 *  - Cancela quien alquila con 7 días o más de antelación: se devuelve todo.
 *  - Entre 7 días y 48 horas antes: se devuelve la mitad del alquiler (la tarifa de servicio no).
 *  - Con menos de 48 horas: no se devuelve nada.
 */
export function reembolso(r, quien, ahora = Date.now()) {
  const total = Number(r.total) || 0, tarifa = Number(r.tarifa) || 0, alquiler = total - tarifa;
  if (quien === 'dueno' || quien === 'sistema') return { importe: total, tarifa: true, motivo: 'Se devuelve todo.' };
  const inicio = Date.parse(`${String(r.desde).slice(0, 10)}T10:00:00+01:00`);
  const horas = (inicio - ahora) / 3600e3;
  if (horas >= 7 * 24) return { importe: total, tarifa: true, motivo: 'Cancelas con 7 días o más de antelación: se te devuelve todo.' };
  if (horas >= 48) return { importe: Math.round(alquiler * 50) / 100, tarifa: false, motivo: 'Cancelas entre 7 días y 48 horas antes: se te devuelve la mitad del alquiler (la tarifa de servicio no).' };
  return { importe: 0, tarifa: false, motivo: 'Cancelas con menos de 48 horas: no se devuelve el importe.' };
}
export const POLITICA_CANCELACION = [
  'Si el dueño no acepta la solicitud en 24 horas, la rechaza o cancela una reserva ya aceptada, se devuelve a quien alquila el 100 % de lo pagado, tarifa de servicio incluida.',
  'Si quien alquila cancela con 7 días o más de antelación al inicio, se le devuelve el 100 % de lo pagado.',
  'Si cancela entre 7 días y 48 horas antes del inicio, se le devuelve el 50 % del precio del alquiler; la tarifa de servicio no se devuelve.',
  'Si cancela con menos de 48 horas, o no se presenta a la entrega, no se devuelve el importe.',
  'Si el vehículo no puede entregarse por causa del dueño (avería, falta de documentación o de seguro en vigor, etc.), se considera cancelación del dueño.'
];

/* ---------------------------------------------------------------------------- Condiciones del servicio de alquiler */
export function condicionesAlquiler(cfg = {}) {
  const s = sidonia(cfg);
  const pct = Number(cfg.alquilerComision) || 0;
  const sec = (t, ...ps) => `<h2>${t}</h2>${ps.map((p) => (p.startsWith('<') ? p : `<p>${p}</p>`)).join('')}`;
  const ul = (l) => `<ul>${l.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  return `<h1>Condiciones del servicio de alquiler entre usuarios</h1>
<p class="meta">Versión ${VERSION_CONDICIONES}. ${esc(s.razon)}${s.nif ? `, NIF ${esc(s.nif)}` : ''}${s.domicilio ? `, con domicilio en ${esc(s.domicilio)}` : ''} (en adelante, «Sidonia»). Contacto: ${esc(s.email)}.</p>
${sec('1. Qué hace Sidonia',
  'Sidonia es una plataforma en línea que pone en contacto a personas que tienen un vehículo y quieren alquilarlo (los «dueños») con personas que quieren alquilarlo (los «arrendatarios»). Sidonia actúa exclusivamente como prestador de un servicio de intermediación de la sociedad de la información, en los términos de la Ley 34/2002, de servicios de la sociedad de la información y de comercio electrónico (LSSI).',
  'El servicio de Sidonia consiste en: publicar los anuncios; gestionar las solicitudes y reservas; facilitar la mensajería entre las partes; poner a su disposición un modelo de contrato que las partes rellenan y firman electrónicamente; y gestionar, a través del proveedor de pagos Stripe, el cobro del precio por cuenta del dueño y su abono al dueño, descontando la tarifa de servicio de Sidonia.')}
${sec('2. Qué no es Sidonia',
  ul(['Sidonia <b>no es parte</b> del contrato de alquiler. El contrato se celebra única y directamente entre el dueño y el arrendatario.',
    'Sidonia <b>no es propietaria</b> de los vehículos, no los alquila, no los entrega ni los recoge, y no presta servicios de transporte.',
    'Sidonia <b>no es aseguradora</b> ni mediadora de seguros, y no ofrece ningún seguro.',
    'Sidonia <b>no garantiza</b> el estado, la seguridad, la legalidad ni la idoneidad de los vehículos, ni la veracidad de los anuncios, ni la conducta, solvencia o capacidad de los usuarios, más allá de las comprobaciones que se indican expresamente en estas condiciones.']))}
${sec('3. Requisitos para usar el servicio',
  ul(['Ser mayor de edad, tener capacidad para contratar y facilitar datos verdaderos, completos y actualizados.',
    '<b>Dueños:</b> ser titular del vehículo o estar autorizado por su titular para alquilarlo; tener en vigor el seguro obligatorio y la ITV; tener un seguro que cubra la conducción por el arrendatario durante el alquiler (muchas pólizas particulares lo excluyen: es responsabilidad del dueño comprobarlo con su aseguradora); entregar el vehículo en buen estado y con su documentación; y cumplir sus obligaciones fiscales.',
    '<b>Alquiler con conductor:</b> el alquiler de un vehículo con conductor a cambio de un precio puede requerir en España una autorización administrativa (por ejemplo, VTC) y el seguro obligatorio de viajeros. Es responsabilidad exclusiva del dueño tenerlos y cumplir la normativa de transporte; el conductor lo pone y lo designa el dueño, bajo su responsabilidad.',
    '<b>Declaración responsable del dueño:</b> al publicar su anuncio, el dueño declara que es titular del vehículo o está autorizado para alquilarlo; que tiene en vigor el seguro, la ITV, las licencias y las autorizaciones que exija el uso que ofrece; que el conductor que, en su caso, designe tiene el permiso y la habilitación necesarios; y que responde frente al arrendatario y frente a terceros de todo ello. Sidonia no comprueba estos extremos ni responde de ellos.',
    '<b>Siempre con su dueño al volante:</b> en Sidonia no hay alquiler sin conductor. El vehículo lo conduce siempre su dueño (o el conductor que él ponga, bajo su exclusiva responsabilidad); el arrendatario y sus acompañantes viajan como pasajeros y nunca lo conducen.']))}
${sec('4. Cómo funciona una reserva',
  ul(['El arrendatario elige fechas, rellena sus datos, acepta estas condiciones y firma el contrato de alquiler.',
    'Al enviar la solicitud, se <b>retiene</b> el importe en su tarjeta, pero no se cobra. El dueño tiene 24 horas para aceptarla.',
    'Si el dueño la acepta, firma el contrato y se cobra el importe. Si la rechaza o no responde en 24 horas, la retención se anula y no se cobra nada.',
    'Si el dueño tiene la «reserva inmediata», el contrato queda firmado por él de antemano y el importe se cobra al reservar.',
    'Cuando la reserva está confirmada, las partes ven el contacto del otro y el lugar de entrega, y acuerdan por la mensajería de Sidonia la hora de entrega y de devolución.']))}
${sec('5. Precio, pagos y tarifa de servicio',
  `El precio del alquiler lo fija libremente el dueño. Al precio se suma la tarifa de servicio de Sidonia${pct ? ` (${pct} % del precio del alquiler)` : ''}, que se muestra antes de reservar, incluye los impuestos aplicables y retribuye el servicio de intermediación.`,
  'Los pagos los procesa Stripe Payments Europe, Ltd., entidad autorizada, a través de su servicio Stripe Connect. El dueño debe darse de alta en Stripe (datos de identidad y cuenta bancaria) para poder recibir reservas. El precio del alquiler se cobra por cuenta del dueño, que figura como vendedor del cargo, y se le transfiere el día en que empieza el alquiler; desde ahí, Stripe lo abona en su cuenta bancaria según su calendario de pagos. Sidonia no tiene a su disposición fondos de los usuarios fuera de la cuenta de pagos gestionada por Stripe.',
  'El pago de la reserva por la plataforma libera al arrendatario de su obligación de pago frente al dueño por el importe pagado. Las partes no deben pagarse el alquiler fuera de Sidonia. Los importes adicionales que prevea el contrato (horas o kilómetros extra, combustible, daños, sanciones) los liquidan las partes directamente entre sí.',
  'El servicio es siempre <b>con conductor</b>: el dueño conduce y el arrendatario y sus acompañantes viajan como pasajeros, con el itinerario, las paradas y las horas que se acuerden. El precio es por horas según el plan (boda, rodaje, evento, ruta…), con un mínimo de horas por día.')}
${sec('6. Cancelaciones y devoluciones', ul(POLITICA_CANCELACION), 'Las devoluciones se hacen a la misma tarjeta con la que se pagó, normalmente en un plazo de 5 a 10 días hábiles según el banco.')}
${sec('7. Fianza, daños, multas y combustible',
  'La fianza, si el dueño la pide, la entregan y devuelven las partes directamente entre ellas, en la forma que acuerden, según el contrato de alquiler. Sidonia no cobra, retiene ni devuelve fianzas, y no decide sobre daños, combustible, kilómetros, multas ni otras reclamaciones entre las partes, que se rigen por su contrato.',
  'Recomendamos hacer y enviar por la mensajería de Sidonia fotos fechadas del vehículo, del cuentakilómetros y del nivel de combustible en la entrega y en la devolución, y rellenar el acta del anexo del contrato.')}
${sec('8. Impuestos',
  'Cada dueño es responsable de declarar los ingresos que obtenga por el alquiler y de cumplir sus obligaciones fiscales. Como operador de plataforma, Sidonia puede estar obligada a comunicar a la Agencia Tributaria información sobre los dueños y sus ingresos (Directiva (UE) 2021/514, «DAC7», y su normativa española de desarrollo); el dueño se compromete a facilitar los datos necesarios (nombre, NIF, domicilio y cuenta) y queda informado de esa comunicación.')}
${sec('9. Contenidos y reseñas',
  'Cada usuario es responsable de lo que publica. Las reseñas deben ser verdaderas y referirse a un alquiler realmente hecho. Sidonia puede retirar contenidos ilícitos, falsos o contrarios a estas condiciones en cuanto tenga conocimiento efectivo de ellos.')}
${sec('10. Usos prohibidos',
  ul(['Pagar o cobrar el alquiler fuera de la plataforma una vez contactados por ella.', 'Publicar vehículos de los que no se es titular o sin autorización, sin seguro o sin ITV en vigor.',
    'Ofrecer alquiler con conductor sin la autorización necesaria.', 'Facilitar datos falsos o suplantar a otra persona.', 'Cualquier uso ilegal, fraudulento o que perjudique a otros usuarios o a Sidonia.']),
  'Sidonia puede suspender o cerrar la cuenta de quien incumpla estas condiciones, y cancelar sus reservas pendientes.')}
${sec('11. Responsabilidad',
  'Sidonia responde del correcto funcionamiento de su servicio de intermediación con la diligencia debida. Al no ser parte del contrato de alquiler, Sidonia no responde del cumplimiento de ese contrato por el dueño o por el arrendatario, ni de los daños personales o materiales, accidentes, robos, sanciones, averías, retrasos o pérdidas que se produzcan con ocasión del alquiler o del uso del vehículo, que corresponden a quien los cause según el contrato y la ley, ni de la falta de seguro o de autorizaciones del dueño.',
  'Conforme a la LSSI, Sidonia no responde de la información publicada por los usuarios salvo que, teniendo conocimiento efectivo de su ilicitud, no actúe con diligencia para retirarla.',
  'Nada de lo anterior excluye ni limita la responsabilidad que la ley no permita excluir o limitar, en particular la que corresponda por dolo o culpa grave, ni los derechos que la normativa de consumidores reconoce a los usuarios que tengan esa condición.',
  'Cada usuario mantendrá indemne a Sidonia frente a reclamaciones de terceros derivadas de su propio incumplimiento de estas condiciones, del contrato de alquiler o de la ley.')}
${sec('12. Si algo va mal',
  `Escríbenos a ${esc(s.email)} o por WhatsApp. Podemos ayudaros a entenderos y facilitar la información de la reserva, pero no actuamos como árbitro ni decidimos sobre las reclamaciones entre las partes. Los consumidores pueden acudir además a los servicios de consumo y a los sistemas de resolución alternativa de litigios de su comunidad autónoma.`)}
${sec('13. Datos personales',
  'Sidonia trata los datos de los usuarios para prestar el servicio, gestionar los pagos con Stripe, cumplir sus obligaciones legales (incluidas las fiscales) y prevenir el fraude. Al confirmarse una reserva, cada parte recibe los datos del otro necesarios para celebrar y cumplir el contrato (nombre, documento de identidad, domicilio, teléfono, email y, en su caso, permiso de conducción), y los tratará únicamente para eso y para las obligaciones legales que deriven de él (por ejemplo, identificar al conductor ante la autoridad de tráfico), como responsable independiente. Puedes ejercer tus derechos escribiendo a ' + esc(s.email) + '.')}
${sec('14. Cambios, ley aplicable y jurisdicción',
  'Sidonia puede modificar estas condiciones avisando con antelación; las reservas ya hechas se rigen por la versión que se aceptó. Estas condiciones se rigen por la ley española. Para cualquier controversia con un consumidor serán competentes los juzgados de su domicilio; en los demás casos, los que correspondan según la ley.')}`;
}

/* ---------------------------------------------------------------------------- El contrato de arrendamiento */
/**
 * d = {
 *   reserva: { id, desde, hasta, dias, precio_dia, total, tarifa, para, conductor ('sin'|'con'), lugar },
 *   coche:   { marca, modelo, anio, matricula, seguro_compania, seguro_poliza, seguro_tipo, itv_hasta, plazas, km, km_extra, fianza, normas, vtc, edad_min, carne_min },
 *   dueno:   { nombre, dni, domicilio, telefono, email },
 *   cliente: { nombre, dni, nacimiento, domicilio, telefono, email, carne_num, carne_fecha },
 *   firmas:  { cliente: { nombre, fecha, ip }, dueno: { nombre, fecha, ip } }
 * }
 */
export function contratoAlquiler(cfg, d) {
  const s = sidonia(cfg);
  const r = d.reserva || {}, c = d.coche || {}, a = d.dueno || {}, b = d.cliente || {};
  const conConductor = r.conductor === 'con';
  const alquiler = (Number(r.total) || 0) - (Number(r.tarifa) || 0);
  const veh = [c.marca, c.modelo, c.anio].filter(Boolean).join(' ');
  const n = { i: 0 };
  const cl = (t, ...ps) => `<h3>${++n.i}. ${t}</h3>${ps.filter(Boolean).map((p) => (p.startsWith('<') ? p : `<p>${p}</p>`)).join('')}`;
  const ul = (l) => `<ul>${l.filter(Boolean).map((x) => `<li>${x}</li>`).join('')}</ul>`;
  const kmTxt = Number(c.km) > 0
    ? `El precio incluye ${Number(c.km)} km por día de alquiler (${Number(c.km) * (Number(r.dias) || 1)} km en total). Cada kilómetro adicional se abonará al Arrendador a ${eur(Number(c.km_extra) || 0.5)} por km.`
    : 'El precio incluye kilometraje ilimitado, dentro de un uso razonable conforme a este contrato.';
  const cabecera = `<h1>${conConductor ? 'Contrato de arrendamiento de vehículo con conductor' : 'Contrato de arrendamiento de vehículo sin conductor'}</h1>
<p class="meta">Reserva n.º ${esc(r.id || '—')} · Modelo ${VERSION_CONTRATO} · Celebrado a través de la plataforma Sidonia (${esc(s.web)})</p>
<h2>Reunidos</h2>
<p><b>De una parte, como ARRENDADOR</b> (el «Arrendador» o «dueño»): D./D.ª ${hueco(a.nombre)}, con DNI/NIE/NIF ${hueco(a.dni)}, con domicilio en ${hueco(a.domicilio, '______________________________')}, teléfono ${hueco(a.telefono)} y email ${hueco(a.email)}.</p>
<p><b>De otra parte, como ARRENDATARIO</b> (el «Arrendatario»): D./D.ª ${hueco(b.nombre)}, con DNI/NIE/pasaporte ${hueco(b.dni)}, nacido/a el ${hueco(fecha(b.nacimiento))}, con domicilio en ${hueco(b.domicilio, '______________________________')}, teléfono ${hueco(b.telefono)} y email ${hueco(b.email)}${conConductor ? '' : `, titular del permiso de conducción n.º ${hueco(b.carne_num)}, expedido el ${hueco(fecha(b.carne_fecha))}`}.</p>
<p>Ambas partes intervienen en su propio nombre, se reconocen capacidad legal suficiente para contratar y</p>
<h2>Exponen</h2>
<p>I. Que el Arrendador es titular del vehículo que se describe en este contrato, o está autorizado por su titular para arrendarlo, y que el vehículo cumple todos los requisitos legales para circular.</p>
<p>II. Que el Arrendatario desea arrendarlo${conConductor ? ', con conductor,' : ''} durante el periodo indicado${r.para ? `, para ${esc(r.para)}` : ''}.</p>
<p>III. Que las partes han contactado a través de la plataforma Sidonia, titularidad de ${esc(s.razon)}${s.nif ? ` (NIF ${esc(s.nif)})` : ''}, que actúa únicamente como intermediario y <b>no es parte de este contrato</b>.</p>
<p>Y acuerdan celebrar este contrato con arreglo a las siguientes</p>
<h2>Cláusulas</h2>`;

  const objeto = cl('Objeto',
    `El Arrendador cede al Arrendatario el uso temporal del vehículo ${hueco(veh)}, matrícula ${hueco(c.matricula)}${conConductor ? `, con conductor facilitado por el Arrendador, para el traslado del Arrendatario y de sus acompañantes (${r.pasajeros ? `${esc(r.pasajeros)} ${Number(r.pasajeros) === 1 ? 'pasajero' : 'pasajeros'}` : 'los pasajeros que se indiquen'}, con un máximo de ${hueco(c.plazas ? Number(c.plazas) - 1 : '', '___')})` : ''}, a cambio del precio pactado y en las condiciones de este contrato. Los datos del vehículo y su documentación figuran en el Anexo I.`);
  const duracion = cl('Duración, entrega y devolución',
    Array.isArray(r.tramos) && r.tramos.length
      ? `El ${conConductor ? 'servicio' : 'arrendamiento'} se presta en estos días y horas: <b>${r.tramos.map((x) => `${esc(fecha(x.dia))}, de ${esc(x.de)} a ${esc(x.a)} h`).join('; ')}</b> (${Number(r.horas) || ''} horas facturadas en total, contando el mínimo por día del plan).`
      : `El arrendamiento empieza el <b>${hueco(fecha(r.desde))}</b> y termina el <b>${hueco(fecha(r.hasta))}</b> (${hueco(r.dias, '__')} ${Number(r.dias) === 1 ? 'día' : 'días'}).`,
    `${conConductor ? 'La recogida de los pasajeros' : 'La entrega y la devolución del vehículo'} se harán en ${hueco(r.lugar, '______________________________')}, o en el lugar que las partes acuerden por la mensajería de Sidonia, a la hora acordada por ese mismo medio. A falta de acuerdo, ${conConductor ? 'el servicio empezará a las 10:00 horas de cada día' : 'la entrega será a las 10:00 horas del primer día y la devolución a las 20:00 horas del último'}.`,
    conConductor ? `El precio incluye hasta <b>${hueco(c.horas || 8, '__')} horas de servicio por día</b>, contadas desde la hora de recogida pactada hasta el fin del servicio, incluidas las esperas. El horario, el itinerario y las paradas se acordarán por escrito por la mensajería de Sidonia antes del inicio. Cada hora adicional, o fracción superior a 15 minutos, que el Arrendatario solicite y el conductor acepte se abonará a razón de <b>${Number(c.hora_extra) > 0 ? eur(c.hora_extra) : hueco('', '____ €')} por hora</b>. Los cambios de itinerario no pactados podrán ser rechazados por el conductor.`
      : 'Si el vehículo se devuelve con más de 2 horas de retraso sin acuerdo del Arrendador, el Arrendatario abonará el precio de un día adicional por cada día o fracción de retraso, sin perjuicio de los daños y perjuicios que el retraso cause. La no devolución del vehículo podrá ser denunciada por el Arrendador ante la autoridad.');
  const precioCl = cl('Precio y pago',
    `El precio del ${conConductor ? 'servicio' : 'alquiler'} es de <b>${eur(alquiler)}</b> (${Array.isArray(r.tramos) && r.tramos.length ? `${eur(r.precio_dia)} por hora` : `${eur(r.precio_dia)} por día`}${conConductor ? ' de servicio con conductor' : ''}). El Arrendatario lo ha abonado a través de la plataforma Sidonia, mediante el proveedor de pagos Stripe, por cuenta del Arrendador. El pago así hecho libera al Arrendatario de su obligación de pago por ese importe. ${Number(r.tarifa) ? `La tarifa de servicio de Sidonia (${eur(r.tarifa)}) retribuye el servicio de intermediación de Sidonia y no forma parte del precio del alquiler.` : ''}`,
    'Los importes adicionales que prevé este contrato (horas o kilómetros extra, combustible, daños, sanciones o gastos) no están incluidos en el precio y los liquidan las partes directamente entre sí, contra justificante.',
    'El Arrendador es el único responsable de declarar los ingresos que obtenga por este contrato y de cumplir las obligaciones fiscales que le correspondan.',
    !conConductor && Number(c.fianza) > 0
      ? `<p><b>Fianza.</b> El Arrendatario entregará al Arrendador en el momento de la entrega una fianza de <b>${eur(c.fianza)}</b>, por el medio que acuerden (transferencia, Bizum, efectivo dentro de los límites legales u otro), para garantizar el cumplimiento de este contrato. El Arrendador la devolverá en un plazo máximo de 7 días desde la devolución del vehículo, descontando únicamente los importes debidos conforme a este contrato (daños imputables al Arrendatario, combustible, kilómetros adicionales, retrasos, sanciones o gastos de limpieza extraordinaria), que deberá justificar por escrito con fotos, facturas o presupuestos. La fianza no limita la responsabilidad del Arrendatario.</p>`
      : '<p><b>Fianza.</b> No se pacta fianza.</p>');
  const condiciones = conConductor ? [
    cl('Conductor y servicio',
      'El vehículo será conducido exclusivamente por el Arrendador o por el conductor que este designe, que deberá tener permiso de conducción en vigor y adecuado al vehículo. El Arrendatario y sus acompañantes no conducirán el vehículo en ningún caso.',
      `El Arrendador declara que dispone de la autorización administrativa necesaria para el arrendamiento de vehículos con conductor (autorización n.º ${hueco(c.vtc)}), del seguro obligatorio de viajeros y de un seguro de responsabilidad civil que cubre este servicio, y responde frente al Arrendatario y frente a terceros de su falta.`,
      'El conductor podrá negarse a realizar trayectos o maniobras que considere peligrosos o contrarios a las normas de tráfico, y no está obligado a superar el horario pactado ni las plazas homologadas del vehículo.',
      `${Number(c.km) > 0 ? `El precio incluye hasta ${Number(c.km)} km por día de servicio; cada kilómetro adicional se abonará a ${eur(Number(c.km_extra) || 0.5)}.` : 'El precio incluye los kilómetros del itinerario pactado.'} El combustible, los peajes y los aparcamientos del itinerario pactado son por cuenta del Arrendador, salvo que las partes acuerden otra cosa por escrito.`),
    cl('Obligaciones del Arrendatario y de sus acompañantes',
      ul(['Respetar el número máximo de pasajeros y llevar puesto el cinturón de seguridad.', 'Seguir las indicaciones del conductor y las normas particulares del Arrendador (Anexo II).',
        'No consumir sustancias ilegales en el vehículo ni llevar objetos peligrosos o prohibidos.', 'Cuidar el vehículo: el Arrendatario responde de los daños que él o sus acompañantes causen al vehículo por dolo o negligencia, incluida la limpieza extraordinaria si fuera necesaria.']))
  ] : [
    cl('Conductores autorizados',
      `Solo podrá conducir el vehículo el Arrendatario, y las personas que el Arrendador autorice expresamente por escrito por la mensajería de Sidonia indicando su nombre, documento y permiso de conducción. Todo conductor deberá tener al menos ${hueco(c.edad_min || 25, '__')} años y ${hueco(c.carne_min || 3, '__')} años de antigüedad del permiso de conducción, tenerlo en vigor y válido en España, y no estar privado del derecho a conducir. El Arrendatario responde de los conductores que autorice.`,
      'En la entrega, el Arrendatario mostrará al Arrendador el original de su documento de identidad y de su permiso de conducción. El Arrendador podrá negarse a entregar el vehículo si no coinciden con los datos de este contrato o no cumplen estos requisitos, lo que se considerará cancelación por el Arrendatario.'),
    cl('Uso del vehículo',
      'El Arrendatario usará el vehículo con la diligencia de un buen padre de familia (artículo 1555 del Código Civil), conforme a su naturaleza, a las normas de tráfico y a las normas particulares del Arrendador (Anexo II). Queda prohibido en todo caso:',
      ul(['Subarrendarlo o cederlo a terceros.', 'Usarlo para transportar personas o mercancías a cambio de un precio, o para enseñar a conducir.',
        'Participar en competiciones, carreras, pruebas, rallies o circuitos, o usarlo fuera de vías aptas.', 'Conducir bajo los efectos del alcohol, drogas o medicamentos que afecten a la conducción.',
        'Remolcar o empujar otros vehículos, o cargarlo por encima de lo autorizado.', 'Salir de España sin autorización escrita del Arrendador.',
        'Fumar en el vehículo o llevar animales, salvo que el Arrendador lo permita.']),
      'El incumplimiento de estas prohibiciones hace al Arrendatario responsable de todos los daños y perjuicios que cause, aunque estén cubiertos por el seguro, y faculta al Arrendador a resolver el contrato y recuperar el vehículo.'),
    cl('Kilometraje y combustible',
      kmTxt,
      'El vehículo se entrega con el nivel de combustible (o de carga) que conste en el acta de entrega y debe devolverse con el mismo nivel. La diferencia se abonará al Arrendador al precio de mercado, más 10 € por la gestión. Los peajes, aparcamientos y gastos de combustible durante el alquiler son por cuenta del Arrendatario.')
  ];
  const estado = cl('Estado del vehículo y acta de entrega y devolución',
    'En la entrega y en la devolución, las partes revisarán juntas el vehículo y harán fotos fechadas de su exterior, interior, cuentakilómetros y nivel de combustible, que compartirán por la mensajería de Sidonia, y rellenarán el acta del Anexo III. Los daños o faltas que no consten en el acta de entrega y aparezcan en la devolución se presumirán producidos durante el alquiler, salvo prueba en contrario.',
    'El Arrendador entrega el vehículo en buen estado de funcionamiento, limpio, con la ITV en vigor y con su documentación (permiso de circulación, ficha técnica o tarjeta ITV y justificante del seguro), y el Arrendatario lo devolverá en el mismo estado, salvo el desgaste normal por el uso.');
  const seguro = cl('Seguro y daños',
    `El Arrendador declara que el vehículo tiene en vigor el seguro obligatorio de responsabilidad civil (Real Decreto Legislativo 8/2004) con la compañía ${hueco(c.seguro_compania)}, póliza n.º ${hueco(c.seguro_poliza)}, con cobertura de ${hueco(c.seguro_tipo, '____________')}, y que ${conConductor ? 'cubre el servicio objeto de este contrato' : 'esa póliza cubre la conducción del vehículo por el Arrendatario durante el alquiler'}. El Arrendador responde de la veracidad de esta declaración y de las consecuencias de su falta.`,
    conConductor ? 'El Arrendador responde de los daños que el vehículo o el conductor causen a los pasajeros o a terceros, conforme a la ley y a su seguro.'
      : 'El Arrendatario responde frente al Arrendador de los daños que sufra el vehículo durante el alquiler por su culpa o negligencia, o por la de los conductores que autorice, en la parte no cubierta por el seguro, incluida la franquicia, así como de la pérdida del vehículo, sus llaves o su documentación. No responde del desgaste normal ni de las averías que no le sean imputables.',
    !conConductor && 'En caso de accidente, el Arrendatario lo comunicará de inmediato al Arrendador, rellenará la declaración amistosa de accidente si es posible, no reconocerá responsabilidades por cuenta del Arrendador y, si hay heridos o el otro conductor se niega a identificarse, avisará a las autoridades. En caso de robo, lo denunciará de inmediato ante la policía y entregará la denuncia al Arrendador.');
  const averias = cl('Averías',
    conConductor ? 'Si el servicio no puede prestarse o se interrumpe por avería u otra causa imputable al Arrendador, este devolverá al Arrendatario la parte proporcional del precio por el servicio no prestado, sin perjuicio de otros derechos del Arrendatario.'
      : 'En caso de avería, el Arrendatario avisará al Arrendador y no hará reparaciones sin su autorización, salvo las urgentes de poco importe, que el Arrendador le reembolsará contra factura. Si el vehículo queda inmovilizado por causa no imputable al Arrendatario, el Arrendador le devolverá la parte proporcional del precio por los días no disfrutados.');
  const multas = cl('Multas, sanciones y gastos',
    `El ${conConductor ? 'Arrendador' : 'Arrendatario'} responde de las infracciones de tráfico, sanciones, peajes, aparcamientos, retiradas por grúa y demás gastos que se produzcan durante el alquiler${conConductor ? ' por la conducción' : ''}.${conConductor ? '' : ' A efectos de lo previsto en el artículo 11 del Real Decreto Legislativo 6/2015 (Ley sobre Tráfico), el Arrendatario consiente que el Arrendador lo identifique como conductor ante la autoridad que lo requiera, facilitando sus datos y una copia de este contrato.'}`);
  const cancelacion = cl('Cancelación', 'Se aplica la política de cancelación publicada en Sidonia, que las partes aceptan:', ul(POLITICA_CANCELACION),
    'Las devoluciones las tramita Sidonia a través de Stripe con cargo a lo pagado.');
  const resolucion = cl('Resolución',
    'El incumplimiento grave de este contrato por cualquiera de las partes faculta a la otra para resolverlo, con la indemnización de daños y perjuicios que corresponda conforme a la ley.');
  const intermediacion = cl('Intervención de Sidonia',
    `Sidonia (${esc(s.razon)}) actúa únicamente como intermediario y gestor del cobro por cuenta del Arrendador. No es parte de este contrato, no es propietaria ni arrendadora del vehículo, no presta el servicio de transporte, no ofrece ningún seguro y no responde del cumplimiento de este contrato por las partes ni de los daños, accidentes, sanciones o perjuicios derivados del alquiler, sin perjuicio de su responsabilidad por su propio servicio en los términos de sus condiciones y de la ley. Las partes lo reconocen y aceptan expresamente.`,
    'Sidonia podrá facilitar a las partes la información de la reserva y ayudarles a entenderse, pero no actúa como árbitro ni resuelve sus reclamaciones.');
  const datos = cl('Protección de datos',
    'Cada parte tratará los datos personales de la otra que figuran en este contrato únicamente para celebrarlo, cumplirlo y atender las obligaciones legales que deriven de él, como responsable independiente, y los conservará solo el tiempo necesario para ello y para atender posibles reclamaciones.');
  const firma = cl('Firma electrónica',
    'Las partes firman este contrato electrónicamente a través de Sidonia, mediante firma electrónica simple conforme al Reglamento (UE) n.º 910/2014 y a la Ley 6/2020, y reconocen su plena validez y eficacia. Sidonia conserva el texto firmado, su huella digital (SHA-256) y el registro de fecha, hora, dirección IP y dispositivo de cada firma, y lo pone a disposición de ambas partes.');
  const ley = cl('Ley aplicable y jurisdicción',
    'Este contrato se rige por la ley española, en particular por los artículos 1542 y siguientes del Código Civil. Para cualquier controversia, las partes se someten a los juzgados y tribunales que correspondan conforme a la ley; si el Arrendatario actúa como consumidor frente a un Arrendador profesional, serán competentes los de su domicilio.');

  const anexos = `<h2>Anexo I · Vehículo y documentación</h2>
<table class="t"><tr><th>Vehículo</th><td>${hueco(veh)}</td></tr><tr><th>Matrícula</th><td>${hueco(c.matricula)}</td></tr>
<tr><th>Seguro</th><td>${hueco(c.seguro_compania)} · póliza ${hueco(c.seguro_poliza)} · ${hueco(c.seguro_tipo)}</td></tr><tr><th>ITV en vigor hasta</th><td>${hueco(fecha(c.itv_hasta))}</td></tr>
${conConductor ? `<tr><th>Autorización con conductor</th><td>${hueco(c.vtc)}</td></tr><tr><th>Horas incluidas por día</th><td>${esc(c.horas || 8)} h${Number(c.hora_extra) > 0 ? `; hora extra ${eur(c.hora_extra)}` : ''}</td></tr><tr><th>Kilometraje</th><td>${Number(c.km) > 0 ? `${Number(c.km)} km/día; extra ${eur(Number(c.km_extra) || 0.5)}/km` : 'El del itinerario pactado'}</td></tr>` : `<tr><th>Kilometraje</th><td>${Number(c.km) > 0 ? `${Number(c.km)} km/día; extra ${eur(Number(c.km_extra) || 0.5)}/km` : 'Ilimitado'}</td></tr>`}
<tr><th>Documentación a bordo</th><td>Permiso de circulación, ficha técnica o tarjeta ITV y justificante del seguro</td></tr></table>
<h2>Anexo II · Normas particulares del Arrendador</h2>
<p>${c.normas ? esc(c.normas).replace(/\n/g, '<br>') : 'Ninguna además de las de este contrato.'}</p>
<h2>Anexo III · Acta de entrega y devolución</h2>
<table class="t acta"><tr><th></th><th>Entrega</th><th>Devolución</th></tr>
<tr><th>Fecha y hora</th><td></td><td></td></tr><tr><th>Lugar</th><td></td><td></td></tr><tr><th>Kilómetros</th><td></td><td></td></tr>
<tr><th>Combustible / carga</th><td></td><td></td></tr><tr><th>Daños o faltas observados</th><td></td><td></td></tr>
<tr><th>Fotos enviadas por Sidonia</th><td>☐ Sí</td><td>☐ Sí</td></tr><tr><th>Conformes (nombre)</th><td></td><td></td></tr></table>
<p class="meta">El acta puede rellenarse a mano o sustituirse por las fotos y los datos que las partes se envíen por la mensajería de Sidonia en la entrega y en la devolución.</p>`;

  const firmas = bloqueFirmas(d.firmas);

  return cabecera + objeto + duracion + precioCl + condiciones.join('') + estado + seguro + averias + multas + cancelacion + resolucion + intermediacion + datos + firma + ley + firmas + anexos;
}

/** El bloque de firmas (se cambia al mostrar el contrato firmado; lo firmado es el resto del texto) */
export function bloqueFirmas(f = {}) {
  const linea = (rol, x) => `<div class="firma"><b>${rol}</b>${x ? `<span>${esc(x.nombre)}${x.documento ? ` · ${esc(x.documento)}` : ''}</span><small>Firmado electrónicamente el ${esc(new Date(x.fecha).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }))}${x.ip ? ` · IP ${esc(x.ip)}` : ''}${x.inmediata ? ' · reserva inmediata, con su autorización previa' : ''}</small>` : '<span class="hueco">Pendiente de firma</span>'}</div>`;
  return `<section id="firmas"><h2>Firmas</h2><div class="firmas">${linea('El Arrendador', f && f.dueno)}${linea('El Arrendatario', f && f.cliente)}</div></section>`;
}
export const conFirmas = (html, f) => String(html || '').replace(/<section id="firmas">[\s\S]*?<\/section>/, bloqueFirmas(f));

/** El contenido que se firma (sin las firmas), su huella y la versión: se guarda en la reserva */
export function huella(html) {
  return createHash('sha256').update(String(html), 'utf8').digest('hex');
}
export function contratoParaFirmar(cfg, d) {
  const html = contratoAlquiler(cfg, { ...d, firmas: {} });
  return { version: VERSION_CONTRATO, html, hash: huella(html) };
}

/** La página para leer, imprimir o guardar en PDF un documento */
export function paginaDocumento(titulo, cuerpo, { pie = '' } = {}) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(titulo)} · SIDONIA</title>
<style>
body{margin:0;background:#f4f4f4;color:#1a1a1a;font:15px/1.6 Inter,system-ui,-apple-system,sans-serif}
main{max-width:780px;margin:24px auto;background:#fff;border-radius:18px;padding:36px clamp(18px,5vw,48px);box-shadow:0 20px 50px -30px rgba(0,0,0,.35)}
.l{letter-spacing:6px;font-weight:700;margin-bottom:22px}
h1{font-size:24px;line-height:1.2;margin:0 0 6px;text-transform:uppercase}h2{font-size:17px;margin:26px 0 8px}h3{font-size:15px;margin:18px 0 6px}
p,li{margin:0 0 8px}ul{padding-left:20px}.meta{color:#666;font-size:13px}
.hueco{display:inline-block;min-width:110px;border-bottom:1px solid #999;color:#999}
table.t{width:100%;border-collapse:collapse;margin:6px 0 10px;font-size:14px}table.t th,table.t td{border:1px solid #ddd;padding:7px 9px;text-align:left;vertical-align:top}table.t th{background:#f7f7f5;width:34%}
table.acta td{height:26px}
.firmas{display:grid;grid-template-columns:1fr 1fr;gap:16px}.firma{border:1px solid #ddd;border-radius:12px;padding:12px}.firma b,.firma span,.firma small{display:block}.firma small{color:#666;font-size:12px}
.acc{display:flex;gap:10px;justify-content:flex-end;max-width:780px;margin:18px auto 0;padding:0 16px}.acc button,.acc a{border:0;border-radius:999px;background:#1a1a1a;color:#fff;padding:11px 18px;font-weight:700;text-decoration:none;cursor:pointer;font:inherit}
.pie{color:#666;font-size:12px;word-break:break-all;margin-top:24px;border-top:1px solid #eee;padding-top:12px}
@media print{body{background:#fff}main{box-shadow:none;margin:0;padding:0;max-width:none}.acc{display:none}}
@media (max-width:560px){.firmas{grid-template-columns:1fr}}
</style></head><body><div class="acc"><button onclick="print()">Imprimir o guardar en PDF</button></div>
<main><div class="l">SIDONIA</div>${cuerpo}${pie ? `<p class="pie">${pie}</p>` : ''}</main></body></html>`;
}
