// Bogotá no tiene horario de verano: siempre UTC-5. Las fechas se guardan en UTC y
// las horas "de pared" (las que ve el usuario) se convierten aquí.
const OFFSET_MS = 5 * 3600 * 1000;

export const HORA_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/;
export const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export function minutos(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function horaDesdeMinutos(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export function esFechaValida(fecha) {
  if (!FECHA_RE.test(fecha)) return false;
  const d = new Date(`${fecha}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === fecha;
}

/** "2026-11-05" + "14:30" (hora de Bogotá) -> "2026-11-05T19:30:00.000Z" */
export function aUtc(fecha, hhmm) {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + minutos(hhmm) * 60000 + OFFSET_MS).toISOString();
}

/** Día ISO de la semana: 1 = lunes ... 7 = domingo. */
export function diaSemanaIso(fecha) {
  const d = new Date(`${fecha}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function hoyBogota() {
  return new Date(Date.now() - OFFSET_MS).toISOString().slice(0, 10);
}

/** ISO UTC -> { fecha, hora } en Bogotá. */
export function aLocal(iso) {
  const l = new Date(Date.parse(iso) - OFFSET_MS).toISOString();
  return { fecha: l.slice(0, 10), hora: l.slice(11, 16) };
}

/** Rango UTC -> { fecha, hora_inicio, hora_fin } local; un fin a medianoche se muestra como 24:00. */
export function rangoLocal(inicioIso, finIso) {
  const a = aLocal(inicioIso);
  const b = aLocal(finIso);
  const hora_fin = b.fecha > a.fecha ? '24:00' : b.hora;
  return { fecha: a.fecha, hora_inicio: a.hora, hora_fin };
}

export const ahoraIso = () => new Date().toISOString();
