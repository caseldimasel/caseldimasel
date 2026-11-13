/* SIDONIA · Si el dueño falla (como Airbnb, y más duro: es el día de una boda)
 *
 * - Si el dueño cancela una reserva ya confirmada, quien alquila recupera el 100 % y el dueño paga una penalización
 *   según lo cerca que esté el día (sobre el precio del alquiler, mínimo 30 €):
 *     más de 30 días antes: 10 % · de 30 a 7 días: 25 % · de 7 días a 48 h: 50 % · menos de 48 h o no se presenta: 100 %
 * - Las fechas quedan bloqueadas en su calendario (no puede alquilar el coche esos días a otra persona).
 * - Su anuncio enseña durante un año que canceló una reserva confirmada.
 * - Cancelar con menos de 48 h o no presentarse: suspensión inmediata de todos sus coches en alquiler. Dos cancelaciones
 *   con penalización en 12 meses: suspensión. Solo Sidonia levanta la suspensión.
 * - La penalización se descuenta de sus próximos cobros en Sidonia; si no los hay, Sidonia se la reclama.
 * - Fuerza mayor justificada (accidente, avería grave imprevista, enfermedad grave, fallecimiento de un familiar
 *   cercano): Sidonia puede anular la penalización desde el panel.
 * - Quien alquila: 100 % devuelto y Sidonia le ayuda a encontrar otro coche al momento; si cuesta más, Sidonia paga la
 *   diferencia hasta el importe de la penalización del dueño (Garantía Sidonia).
 */
export const PENA_MIN = 30;
export const TRAMOS_PENA = [[30 * 24, 10], [7 * 24, 25], [48, 50], [0, 100]];

const inicioDe = (r) => {
  const t = Array.isArray(r.tramos) && r.tramos[0];
  return Date.parse(`${String(t ? t.dia : r.desde).slice(0, 10)}T${t ? t.de : '10:00'}:00+01:00`);
};

/** La penalización si el dueño cancela ahora (o no se presenta) */
export function penalizacionDueno(r, ahora = Date.now(), noPresentado = false) {
  const alquiler = Math.max(0, (Number(r.total) || 0) - (Number(r.tarifa) || 0));
  const horas = (inicioDe(r) - ahora) / 3600e3;
  const pct = noPresentado ? 100 : (TRAMOS_PENA.find(([h]) => horas >= h) || [0, 100])[1];
  const importe = Math.min(alquiler, Math.max(PENA_MIN, Math.round((alquiler * pct) / 100)));
  const grave = noPresentado || horas < 48;
  return { importe, pct, grave, horas: Math.round(horas), no_presentado: noPresentado };
}

/** Lo que se le explica al dueño (y va en el contrato y en las condiciones) */
export const POLITICA_DUENO = [
  'Al aceptar una reserva, el dueño se compromete a estar con el coche en el lugar, el día y la hora acordados. Quien alquila cuenta con ello para un día importante (una boda, un rodaje, un evento) y no puede quedarse sin coche.',
  `Si el dueño cancela una reserva confirmada, a quien alquila se le devuelve el 100 % y el dueño paga a Sidonia una penalización sobre el precio del alquiler (mínimo ${PENA_MIN} €, y como mucho el precio del alquiler): el 10 % si cancela con más de 30 días de antelación; el 25 % entre 30 y 7 días; el 50 % entre 7 días y 48 horas; y el 100 % si cancela con menos de 48 horas o no se presenta.`,
  'Además, las fechas de esa reserva quedan bloqueadas en su calendario, y su anuncio muestra durante 12 meses que canceló una reserva confirmada.',
  'Cancelar con menos de 48 horas o no presentarse supone la suspensión inmediata de todos sus coches en alquiler en Sidonia. Dos cancelaciones con penalización en 12 meses, también. Solo Sidonia puede levantar la suspensión, tras revisar el caso.',
  'Que el coche no esté en condiciones de hacer el servicio por causa del dueño (avería por falta de mantenimiento, ITV o seguro caducados, falta de documentación) se considera cancelación del dueño; si sucede el mismo día, se considera no presentarse.',
  'La penalización se descuenta de los siguientes pagos que el dueño tenga que recibir de Sidonia. Si no hay pagos suficientes, el dueño la pagará en los 15 días siguientes a que Sidonia se la reclame, y Sidonia podrá reclamarla por las vías legales. Todo ello sin perjuicio de la indemnización que pueda reclamar quien alquila por los daños que le cause el incumplimiento.',
  'Solo se anula la penalización por fuerza mayor justificada documentalmente (accidente, avería grave e imprevisible, enfermedad grave u hospitalización, fallecimiento de un familiar cercano o causas similares ajenas al dueño), que el dueño debe comunicar a Sidonia en cuanto la conozca. Sidonia decide a la vista de los justificantes.',
  'El dueño debe confirmar en Sidonia que va a acudir cuando se le pida, unos días antes del servicio. Si no lo confirma, Sidonia avisa a quien alquila para que pueda prepararse y busca alternativas.'
];
export const GARANTIA = 'Garantía Sidonia: si el dueño cancela o no se presenta, se te devuelve el 100 % de lo pagado y te ayudamos al momento a encontrar otro coche. Si el nuevo cuesta más, Sidonia paga la diferencia hasta el importe de la penalización que paga el dueño.';

/** Las cancelaciones con penalización del dueño en los últimos 12 meses (las anuladas por fuerza mayor no cuentan) */
export const penasDe = (rs, ahora = Date.now()) => rs.filter((r) => r.datos?.penalizacion && !r.datos.penalizacion.anulada && ahora - Date.parse(r.datos.penalizacion.fecha) < 365 * 864e5);
/** Lo que aún debe de penalizaciones */
export const deudaDe = (rs) => rs.filter((r) => r.datos?.penalizacion && !r.datos.penalizacion.anulada).map((r) => ({ r, debe: Math.max(0, Number(r.datos.penalizacion.importe) - (Number(r.datos.penalizacion.cobrado) || 0)) })).filter((x) => x.debe > 0);
/** Sus días bloqueados: los que puso él y los de las reservas que canceló (no los puede desbloquear) */
export const bloqueosDe = (c) => [...((c && c.bloqueos) || []), ...((c && c.alq && c.alq.bloqueos_sancion) || [])];
