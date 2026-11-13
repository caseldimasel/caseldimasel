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

export const VERSION_CONDICIONES = '2026-11-12c';
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
/* Pago en dos veces (como «paga una parte ahora» de Airbnb): si faltan más de DIAS_RESTO días, al reservar se paga la
 * señal (SENAL_PCT % del alquiler) más la tarifa de Sidonia, y el resto se cobra solo DIAS_RESTO días antes. */
export const SENAL_PCT = 30, DIAS_RESTO = 14, DIAS_MITAD = 7;
/** Lo que ha pagado de verdad del alquiler (sin la tarifa): todo, o la señal si el resto aún no se ha cobrado */
export const alquilerPagado = (r) => { const alquiler = (Number(r.total) || 0) - (Number(r.tarifa) || 0); return Number(r.resto) > 0 && !r.resto_pagado ? alquiler - Number(r.resto) : alquiler; };
export function reembolso(r, quien, ahora = Date.now()) {
  const tarifa = Number(r.tarifa) || 0, alquiler = (Number(r.total) || 0) - tarifa, pagadoAlq = alquilerPagado(r), pagado = pagadoAlq + tarifa;
  if (quien === 'dueno' || quien === 'sistema') return { importe: pagado, tarifa: true, motivo: 'Se devuelve todo lo pagado.' };
  const inicio = Date.parse(`${String(r.desde).slice(0, 10)}T10:00:00+01:00`);
  const horas = (inicio - ahora) / 3600e3;
  if (horas >= DIAS_RESTO * 24) return { importe: pagado, tarifa: true, motivo: `Cancelas con ${DIAS_RESTO} días o más de antelación: se te devuelve todo lo pagado.` };
  if (horas >= DIAS_MITAD * 24) return { importe: Math.max(0, Math.round((pagadoAlq - alquiler * 0.5) * 100) / 100), tarifa: false, motivo: `Cancelas entre ${DIAS_RESTO} y ${DIAS_MITAD} días antes: el dueño se queda la mitad del alquiler y se te devuelve el resto de lo pagado (la tarifa de servicio no).` };
  return { importe: 0, tarifa: false, motivo: `Cancelas con menos de ${DIAS_MITAD} días: no se devuelve el importe.` };
}
export const POLITICA_CANCELACION = [
  'Si el dueño no acepta la solicitud en 24 horas, la rechaza o cancela una reserva ya aceptada, se devuelve a quien alquila el 100 % de lo pagado, tarifa de servicio incluida.',
  'Cancelación gratuita: si quien alquila cancela con 14 días o más de antelación al inicio, se le devuelve el 100 % de lo pagado, tarifa de servicio incluida.',
  'Si cancela entre 14 y 7 días antes del inicio, el dueño se queda la mitad del precio del alquiler y se devuelve el resto de lo pagado; la tarifa de servicio no se devuelve.',
  'Si cancela con menos de 7 días, o no se presenta, no se devuelve el importe.',
  'Si la reserva se hace con más de 14 días de antelación, al reservar se paga una señal del 30 % del alquiler más la tarifa de servicio, y el resto se cobra automáticamente en la misma tarjeta 14 días antes del inicio. Si ese cobro no se puede hacer y no se paga en las 48 horas siguientes con el enlace que se envía, la reserva se cancela con las reglas anteriores.',
  'Si el vehículo no puede entregarse por causa del dueño (avería, falta de documentación o de seguro en vigor, etc.), se considera cancelación del dueño.'
];

/* ---------------------------------------------------------------------------- Condiciones del servicio de alquiler */
export function condicionesAlquiler(cfg = {}) {
  const s = sidonia(cfg);
  const pct = Number(cfg.alquilerComision) || 0;
  const iva = Number.isFinite(cfg.alquilerIva) ? cfg.alquilerIva : 21;
  const sec = (t, ...ps) => `<h2>${t}</h2>${ps.map((p) => (p.startsWith('<') ? p : `<p>${p}</p>`)).join('')}`;
  const ul = (l) => `<ul>${l.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  return `<h1>Condiciones del servicio de alquiler entre usuarios</h1>
<p class="meta">Versión ${VERSION_CONDICIONES}. ${esc(s.razon)}${s.nif ? `, NIF ${esc(s.nif)}` : ''}${s.domicilio ? `, con domicilio en ${esc(s.domicilio)}` : ''} (en adelante, «Sidonia»). Contacto: ${esc(s.email)}.</p>
${sec('1. Qué hace Sidonia',
  'Sidonia es una plataforma en línea que pone en contacto a personas que tienen un vehículo y quieren alquilarlo (los «dueños») con personas que quieren alquilarlo (los «arrendatarios»). Sidonia actúa exclusivamente como prestador de un servicio de intermediación de la sociedad de la información, en los términos de la Ley 34/2002, de servicios de la sociedad de la información y de comercio electrónico (LSSI).',
  'El servicio de Sidonia consiste en: publicar los anuncios; gestionar las solicitudes y reservas; facilitar la mensajería entre las partes; poner a su disposición un contrato tipo que las partes rellenan y firman entre ellas antes del servicio; y gestionar, a través del proveedor de pagos Stripe, el cobro del precio por cuenta del dueño y su abono al dueño, descontando la tarifa de servicio de Sidonia.')}
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
  ul(['El arrendatario elige fechas, acepta estas condiciones y se compromete a firmar con el dueño el contrato de alquiler antes del servicio.',
    'Al enviar la solicitud, se <b>retiene</b> el importe en su tarjeta, pero no se cobra. El dueño tiene 24 horas para aceptarla.',
    'Si el dueño la acepta (y se compromete a firmar el contrato de alquiler antes del servicio), se cobra el importe. Si la rechaza o no responde en 24 horas, la retención se anula y no se cobra nada.',
    'Si el dueño tiene la «reserva inmediata», la reserva queda aceptada al hacerla y el importe se cobra al reservar.',
    'Con la reserva confirmada, los dos reciben el contrato tipo de Sidonia. Antes del servicio, el dueño y el arrendatario lo rellenan con sus datos, los del vehículo (matrícula, seguro e ITV), las fechas y el precio, y lo firman los dos. Sidonia no lo rellena ni comprueba sus datos.',
    'Cuando la reserva está confirmada, las partes ven el contacto del otro y acuerdan por la mensajería de Sidonia dónde y a qué hora el dueño recoge a los pasajeros, y dónde los deja. Quien alquila nunca recoge ni conduce el vehículo.']))}
${sec('5. Precio, pagos y tarifa de servicio',
  `El precio del alquiler lo fija libremente el dueño. Al precio se suma la tarifa de servicio de Sidonia${pct ? ` (${pct} % del precio del alquiler, más el ${iva} % de IVA)` : ''}, que se muestra antes de reservar, lleva el IVA incluido en el importe que se muestra y retribuye el servicio de intermediación.`,
  'Los pagos los procesa Stripe Payments Europe, Ltd., entidad autorizada, a través de su servicio Stripe Connect. El dueño debe darse de alta en Stripe (datos de identidad y cuenta bancaria) para poder recibir reservas. El precio del alquiler se cobra por cuenta del dueño, que figura como vendedor del cargo, y se le transfiere 24 horas después de terminar el servicio, si no hay una reclamación abierta (apartado 6 quáter); desde ahí, Stripe lo abona en su cuenta bancaria según su calendario de pagos. Sidonia no tiene a su disposición fondos de los usuarios fuera de la cuenta de pagos gestionada por Stripe.',
  'El pago de la reserva por la plataforma libera al arrendatario de su obligación de pago frente al dueño por el importe pagado. Las partes no deben pagarse el alquiler fuera de Sidonia. Los importes adicionales que prevea el contrato (horas o kilómetros extra, combustible, daños, sanciones) los liquidan las partes directamente entre sí.',
  'El servicio es siempre <b>con conductor</b>: el dueño conduce y el arrendatario y sus acompañantes viajan como pasajeros, con el itinerario, las paradas y las horas que se acuerden. El precio es por horas según el plan (boda, rodaje, evento, ruta…), con un mínimo de horas por día.')}
${sec('6. Cancelaciones y devoluciones', ul(POLITICA_CANCELACION), 'Las devoluciones se hacen a la misma tarjeta con la que se pagó, normalmente en un plazo de 5 a 10 días hábiles según el banco.',
  'Al tratarse de un servicio de alquiler de vehículos para una fecha o un periodo determinados, no se aplica el derecho de desistimiento de 14 días previsto para los contratos a distancia (artículo 103, letra l, del texto refundido de la Ley General para la Defensa de los Consumidores y Usuarios). La cancelación se rige por la política anterior.')}
${sec('6 bis. Calendario y disponibilidad',
  'El dueño es el único responsable de mantener al día el calendario de su vehículo: los días que no puede alquilarlo (viajes, taller, uso propio…) debe marcarlos como no disponibles. Si acepta una reserva y después no puede prestar el servicio, se considera cancelación del dueño: se devuelve a quien alquila todo lo pagado y Sidonia puede ocultar o retirar sus anuncios.')}
${sec('6 ter. Qué pasa si…',
  'Para que cualquiera de estos casos cuente, hay que <b>comunicarlo por el chat de Sidonia</b> (o al email de Sidonia) en el plazo indicado y, si se puede, con fotos o vídeos con fecha. Lo que no quede por escrito en Sidonia será difícil de comprobar.',
  ul([
    '<b>El dueño no se presenta</b>, o llega más de 30 minutos tarde sin avisar y sin acuerdo con quien alquila: se considera cancelación del dueño. Se devuelve a quien alquila todo lo pagado, tarifa de servicio incluida; el dueño no cobra nada y Sidonia puede retirar sus anuncios. Hay que comunicarlo en las 24 horas siguientes a la hora prevista.',
    '<b>Quien alquila no se presenta</b> o no está en el lugar acordado: el dueño espera al menos 30 minutos, que cuentan dentro del tiempo contratado. Si pasada 1 hora desde la hora acordada no se presenta ni avisa, se considera no presentado y no se devuelve el importe.',
    '<b>Retrasos</b> de cualquiera de las partes: el tiempo del servicio cuenta desde la hora acordada. Si quien alquila llega tarde, no se amplía el servicio salvo que el dueño acepte; si el dueño llega tarde, debe compensar ese tiempo dentro de lo posible o se descuenta la parte proporcional.',
    '<b>El vehículo no está en condiciones o no es el anunciado</b> (otro vehículo, averiado, inseguro o en un estado muy distinto del de las fotos): quien alquila puede rechazarlo al empezar, comunicándolo con fotos o vídeo por el chat de Sidonia en esa misma hora. Se considera cancelación del dueño y se devuelve todo lo pagado.',
    '<b>Avería durante el servicio</b>: el dueño hará lo posible por continuar o por ofrecer una alternativa que quien alquila acepte. Si el servicio no puede terminarse, se devuelve la parte proporcional de las horas no prestadas; si la avería impide lo esencial del servicio (por ejemplo, llegar a la ceremonia), se devuelve todo lo pagado. Los daños o gastos adicionales se reclaman entre las partes.',
    '<b>Más tiempo del contratado</b>: solo si el dueño acepta. Las horas adicionales se acuerdan por escrito en el chat de Sidonia, al mismo precio por hora del anuncio y por fracciones de media hora. Hasta que Sidonia permita pagarlas en la plataforma, se pagan directamente al dueño, que debe dar un justificante; Sidonia no interviene en ese pago ni responde de él.',
    '<b>El dueño pide más dinero</b> del precio de la reserva (salvo horas adicionales aceptadas por escrito o daños acreditados): quien alquila no está obligado a pagarlo y debe comunicarlo a Sidonia. Pedir pagos fuera de lo acordado puede suponer la suspensión de la cuenta del dueño.',
    '<b>Daños al vehículo</b> causados por quien alquila o sus acompañantes (manchas, roturas, quemaduras…): responde quien alquila frente al dueño, que debe comunicarlo en las 24 horas siguientes con fotos. Las partes lo arreglan entre ellas; Sidonia no retiene, cobra ni decide sobre los daños, aunque puede facilitar la información de la reserva.',
    '<b>Accidente</b>: se aplica el seguro del vehículo, que es responsabilidad del dueño. Las partes deben avisar a los servicios de emergencia si hace falta y hacer el parte. Sidonia no es parte del accidente ni de su indemnización.',
    '<b>Fuerza mayor</b> (alerta meteorológica roja, cierre de carreteras, catástrofe, orden de la autoridad o enfermedad grave acreditada de una de las partes que impida el servicio): cualquiera de las partes puede cancelar y se devuelve todo lo pagado, tarifa de servicio incluida, sin indemnización entre ellas.',
    '<b>Comportamiento</b>: está prohibido fumar dentro del vehículo, llevar más pasajeros que plazas, consumir alcohol de forma que ponga en riesgo la seguridad o comportarse de manera peligrosa u ofensiva. Si ocurre, el dueño puede dar por terminado el servicio sin devolución. El dueño debe conducir de forma prudente, sin alcohol ni drogas y respetando las normas de tráfico.',
    '<b>Itinerario y paradas</b>: se acuerdan antes por el chat. El dueño puede negarse a recorridos o paradas inseguros o que no permitan las normas de tráfico. Los peajes y aparcamientos que generen las paradas pedidas por quien alquila los paga quien alquila, salvo otro acuerdo.',
    '<b>Decoración, fotos y rodajes</b>: decorar el vehículo necesita permiso del dueño y no puede dañarlo. Hacer fotos personales está permitido; el uso profesional o publicitario de las imágenes (rodajes, anuncios) necesita acuerdo expreso con el dueño.',
    '<b>Niños</b>: quien alquila se ocupa de que los menores viajen conforme a la normativa de seguridad vial (por ejemplo, con el sistema de retención que corresponda). El dueño puede negarse a llevarlos si no se cumple.',
    '<b>Objetos olvidados</b>: el dueño los guardará y los devolverá a quien alquila, que se hace cargo de recogerlos o de los gastos de envío.',
    '<b>Comunicaciones</b>: recomendamos hablar siempre por el chat de Sidonia. Lo que se acuerde por otros medios no podrá comprobarse si hay un problema.'
  ]))}
${sec('6 quáter. Reclamaciones entre las partes',
  'Si algo sale mal, cualquiera de las partes puede reclamar a Sidonia por el chat o por email en las 24 horas siguientes al final del servicio, explicando qué ha pasado y aportando pruebas (fotos, vídeos, mensajes).',
  'Mientras Sidonia revisa la reclamación puede retener la transferencia al dueño, como máximo 15 días. Sidonia escuchará a las dos partes y decidirá, aplicando estas condiciones y las pruebas aportadas, solo sobre el destino de las cantidades que tenga retenidas (pagar al dueño o devolver a quien alquila, en todo o en parte). Esta decisión no impide que cualquiera de las partes acuda a los tribunales o a los servicios de consumo, y Sidonia no responde de otras cantidades ni de los daños que reclamen entre ellas.',
  'Sidonia puede cancelar una reserva y devolver lo pagado si detecta fraude, un riesgo para la seguridad de las personas o un incumplimiento grave de estas condiciones.')}
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
  'Cada usuario mantendrá indemne a Sidonia frente a reclamaciones de terceros derivadas de su propio incumplimiento de estas condiciones, del contrato de alquiler o de la ley.',
  'En particular, el dueño responde en exclusiva de su vehículo, de su estado y documentación, del seguro (incluida la cobertura de ocupantes y de responsabilidad civil), de la conducción, de las licencias y autorizaciones que exija el servicio que ofrece y de sus obligaciones fiscales, y mantendrá indemne a Sidonia de cualquier reclamación, sanción o gasto que se derive de ello.',
  'Sidonia puede retener temporalmente la transferencia al dueño si recibe una reclamación fundada o detecta indicios de fraude, hasta que se aclare, y avisará a las dos partes.')}
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
      'El Arrendador declara que el vehículo cuenta con un seguro de responsabilidad civil en vigor que cubre a los ocupantes y a terceros durante el servicio, que cumple la normativa que le resulte aplicable a este servicio ocasional y que responde frente al Arrendatario y frente a terceros de su falta.',
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
  const firma = d.papel ? cl('Firma',
    'Las partes firman este contrato en papel, por duplicado y a un solo efecto, antes del inicio del servicio, y cada una conserva un ejemplar. Las partes son las únicas responsables de que los datos que figuran en él sean completos y correctos.')
    : cl('Firma electrónica',
    'Las partes firman este contrato electrónicamente a través de Sidonia, mediante firma electrónica simple conforme al Reglamento (UE) n.º 910/2014 y a la Ley 6/2020, y reconocen su plena validez y eficacia. Sidonia conserva el texto firmado, su huella digital (SHA-256) y el registro de fecha, hora, dirección IP y dispositivo de cada firma, y lo pone a disposición de ambas partes.');
  const ley = cl('Ley aplicable y jurisdicción',
    'Este contrato se rige por la ley española, en particular por los artículos 1542 y siguientes del Código Civil. Para cualquier controversia, las partes se someten a los juzgados y tribunales que correspondan conforme a la ley; si el Arrendatario actúa como consumidor frente a un Arrendador profesional, serán competentes los de su domicilio.');

  const anexos = `<h2>Anexo I · Vehículo y documentación</h2>
<table class="t"><tr><th>Vehículo</th><td>${hueco(veh)}</td></tr><tr><th>Matrícula</th><td>${hueco(c.matricula)}</td></tr>
<tr><th>Seguro</th><td>${hueco(c.seguro_compania)} · póliza ${hueco(c.seguro_poliza)} · ${hueco(c.seguro_tipo)}</td></tr><tr><th>ITV en vigor hasta</th><td>${hueco(fecha(c.itv_hasta))}</td></tr>
${conConductor ? `<tr><th>Horas incluidas por día</th><td>${esc(c.horas || 8)} h${Number(c.hora_extra) > 0 ? `; hora extra ${eur(c.hora_extra)}` : ''}</td></tr><tr><th>Kilometraje</th><td>${Number(c.km) > 0 ? `${Number(c.km)} km/día; extra ${eur(Number(c.km_extra) || 0.5)}/km` : 'El del itinerario pactado'}</td></tr>` : `<tr><th>Kilometraje</th><td>${Number(c.km) > 0 ? `${Number(c.km)} km/día; extra ${eur(Number(c.km_extra) || 0.5)}/km` : 'Ilimitado'}</td></tr>`}
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

/** El contrato tipo, en blanco: Sidonia no rellena nada. Las partes lo imprimen (o lo guardan en PDF), lo rellenan a
 *  mano con sus datos, los del coche (matrícula, seguro, ITV), las fechas y el precio, y lo firman los dos antes del
 *  servicio. ref: el n.º de reserva de Sidonia, si lo hay (solo como referencia). */
export function contratoTipo(cfg, ref = '') {
  const html = contratoAlquiler(cfg, { reserva: { id: ref, conductor: 'con' }, coche: {}, dueno: {}, cliente: {}, firmas: {}, papel: true });
  const aMano = `<section id="firmas"><h2>Firmas</h2><p>En ${hueco('', '________________')}, a ${hueco('', '____')} de ${hueco('', '______________')} de 20${hueco('', '____')}.</p>
<div class="firmas"><div class="firma firma--mano"><b>El Arrendador</b><small>Nombre y firma</small></div><div class="firma firma--mano"><b>El Arrendatario</b><small>Nombre y firma</small></div></div></section>`;
  const nota = `<div class="nota"><b>Contrato tipo para rellenar y firmar antes del alquiler.</b> Imprímelo o guárdalo en PDF. El dueño y quien alquila lo rellenan con sus datos, los del coche (matrícula, seguro e ITV), las fechas y el precio, y lo firman los dos antes de empezar. Cada uno se queda una copia. Sidonia no lo rellena ni es parte de él.</div>`;
  return nota + String(html).replace(/<section id="firmas">[\s\S]*?<\/section>/, aMano);
}

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
.nota{margin:0 0 20px;padding:14px 16px;border-radius:12px;background:#f4f4f4;font-size:14px}.firma--mano{min-height:110px}
@media print{.nota{display:none}}
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

/* ---------------------------------------------------------------------------- Condiciones de las subastas
 * Las acepta quien se registra para pujar (motor.mjs › registro). Generales: la comisión, el precio de reserva y el
 * calendario de cada subasta se publican en su ficha antes de pujar. Revisarlas con un abogado antes de la primera subasta.
 */
export const VERSION_SUBASTAS = '2026-11-12';
export function condicionesSubasta(cfg = {}) {
  const s = sidonia(cfg);
  const sec = (t, ...ps) => `<h2>${t}</h2>${ps.map((p) => (p.startsWith('<') ? p : `<p>${p}</p>`)).join('')}`;
  const ul = (l) => `<ul>${l.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  return `<h1>Condiciones de las subastas</h1>
<p class="meta">Versión ${VERSION_SUBASTAS}. ${esc(s.razon)}${s.nif ? `, NIF ${esc(s.nif)}` : ''}${s.domicilio ? `, con domicilio en ${esc(s.domicilio)}` : ''} (en adelante, «Sidonia»). Contacto: ${esc(s.email)}.</p>
${sec('1. Qué hace Sidonia',
    'Sidonia organiza en su web y en su app subastas en línea de vehículos de sus propietarios (los «vendedores»). Sidonia no es la dueña de los vehículos ni la vendedora: el contrato de compraventa se celebra entre el vendedor y quien gana la subasta (el «comprador»). Sidonia presta un servicio de intermediación y cobra por él la comisión indicada en cada subasta.')}
${sec('2. Quién puede pujar',
    ul(['Personas mayores de 18 años con cuenta en Sidonia, nombre de usuario, móvil verificado y una tarjeta guardada con Stripe, que sirve para identificar a quien puja y cobrar la comisión si gana.',
      'Cada persona puede tener una sola cuenta. Sidonia puede no admitir o dar de baja a quien incumpla estas condiciones o dé datos falsos.',
      'Si pujas en nombre de una empresa, declaras que tienes poder para obligarla.']))}
${sec('3. La ficha de cada subasta',
    'Antes de pujar, en la ficha de cada vehículo se indica: la descripción, las fotos y los datos que da el vendedor, el lugar donde está, la fecha y hora de cierre, el incremento mínimo de puja, si tiene precio de reserva y <b>la comisión de Sidonia</b> que paga el comprador. Lee la ficha entera y, si puedes, ve el vehículo antes de pujar: las fichas las prepara Sidonia con la información del vendedor, que responde de su veracidad.')}
${sec('4. Cómo funciona',
    ul(['<b>Cada puja es una oferta firme e irrevocable de compra</b> por el importe pujado, más la comisión indicada. No se puede retirar.',
      'Gana la puja más alta al cierre. Si alguien puja en los últimos minutos, el cierre puede alargarse unos minutos, como se indica en la ficha, para que todos puedan responder.',
      '<b>Precio de reserva</b>: el vendedor puede fijar un mínimo secreto. Si al cierre no se alcanza, no hay venta, salvo que el vendedor acepte la puja más alta en las 48 horas siguientes.',
      'Sidonia puede cancelar una subasta o anular pujas si hay un error en la ficha, indicios de fraude, pujas del propio vendedor o de personas relacionadas con él para subir el precio, o un fallo técnico grave. Si se anula, no se cobra nada.']))}
${sec('5. Si ganas',
    ul(['Te avisamos al cerrar con los datos del vendedor y del vehículo.',
      '<b>Pagas el precio del vehículo directamente al vendedor</b> en un plazo máximo de 7 días hábiles, por transferencia bancaria o el medio que acordéis, y firmáis el contrato de compraventa y el cambio de titularidad en Tráfico. Los impuestos (Impuesto de Transmisiones Patrimoniales o IVA, según el vendedor) y la gestión del cambio de nombre corren a cargo del comprador, salvo que la ficha diga otra cosa.',
      '<b>La comisión de Sidonia</b> se cobra en la tarjeta que guardaste al cerrar la subasta con venta. Se te envía su factura.',
      'La recogida del vehículo, en el lugar indicado en la ficha, es por cuenta del comprador una vez pagado.']))}
${sec('6. Si no pagas',
    'Si el comprador no paga el vehículo en plazo, el vendedor puede dar la venta por resuelta y ofrecerlo al siguiente mejor postor. La comisión de Sidonia no se devuelve, como compensación por el servicio prestado y los perjuicios causados, sin perjuicio de que el vendedor pueda reclamar los daños que sufra. Sidonia podrá dar de baja la cuenta del comprador.')}
${sec('7. Estado del vehículo y garantías',
    ul(['Los vehículos se venden en el estado en que están, que el comprador ha podido conocer por la ficha y viéndolos antes de pujar.',
      'Si el vendedor es un particular, la compraventa se rige por el Código Civil (incluido el saneamiento por vicios ocultos). Si el vendedor es un profesional y el comprador un consumidor, este tiene la garantía legal que corresponda (en vehículos de segunda mano, al menos 1 año desde la entrega).',
      'Sidonia no inspecciona los vehículos salvo que la ficha diga lo contrario, ni responde de su estado, de su titularidad, de cargas o de la veracidad de los datos del vendedor, sin perjuicio de su responsabilidad por la diligencia en su propio servicio.']))}
${sec('8. Derecho de desistimiento',
    'Las compras en subasta pública no tienen derecho de desistimiento cuando así lo prevé la ley (artículo 103 k del texto refundido de la Ley General para la Defensa de los Consumidores y Usuarios). Si en algún caso fuera aplicable, se informará en la ficha.')}
${sec('9. Para los vendedores',
    'Quien pone un vehículo en subasta firma con Sidonia un acuerdo aparte: declara que es su dueño o que puede venderlo, que no tiene cargas no declaradas, que los datos de la ficha son ciertos y que venderá al ganador si se alcanza el precio de reserva. No puede pujar por su propio vehículo ni pedir a otros que lo hagan.')}
${sec('10. Datos personales',
    `Tratamos tus datos para gestionar tu registro, tus pujas, la comunicación del resultado al vendedor y el cobro de la comisión, como explica la política de privacidad de Sidonia. Al ganar, damos al vendedor tu nombre y tu contacto para cerrar la venta. Puedes ejercer tus derechos escribiendo a ${esc(s.email)}.`)}
${sec('11. Ley y reclamaciones',
    `Se aplica la ley española. Si eres consumidor, son competentes los juzgados de tu domicilio y puedes acudir a los servicios de consumo de tu comunidad autónoma. Antes, escríbenos a ${esc(s.email)} e intentaremos resolverlo.`)}`;
}
