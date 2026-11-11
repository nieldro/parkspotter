import { all, run } from '../db.js';
import { ahoraIso } from './tiempo.js';

// Estados de reserva que ocupan cupo. "Pendiente" también bloquea para que dos conductores
// no puedan pedir el mismo hueco mientras el propietario decide.
export const ESTADOS_QUE_OCUPAN = ['pendiente', 'confirmada'];

/**
 * Máximo de reservas simultáneas dentro de [ini, fin). `intervalos` son {fecha_inicio, fecha_fin}
 * en ISO UTC. Se cuenta la concurrencia real, no cuántas reservas rozan el rango: con capacidad 2,
 * una reserva de 8-10 y otra de 10-12 no impiden una de 9-11.
 */
export function maxConcurrencia(intervalos, ini, fin) {
  const eventos = [];
  for (const it of intervalos) {
    const a = Math.max(Date.parse(it.fecha_inicio), Date.parse(ini));
    const b = Math.min(Date.parse(it.fecha_fin), Date.parse(fin));
    if (a < b) eventos.push([a, 1], [b, -1]);
  }
  eventos.sort((x, y) => x[0] - y[0] || x[1] - y[1]); // en un mismo instante, primero las salidas
  let actual = 0;
  let max = 0;
  for (const [, delta] of eventos) {
    actual += delta;
    if (actual > max) max = actual;
  }
  return max;
}

/** Tramos (en ms) en los que la ocupación alcanza la capacidad. */
export function tramosLlenos(intervalos, capacidad) {
  const eventos = [];
  for (const it of intervalos) eventos.push([Date.parse(it.fecha_inicio), 1], [Date.parse(it.fecha_fin), -1]);
  eventos.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const tramos = [];
  let actual = 0;
  let desde = null;
  for (const [t, delta] of eventos) {
    actual += delta;
    if (actual >= capacidad && desde === null) desde = t;
    if (actual < capacidad && desde !== null) {
      if (tramos.length && tramos[tramos.length - 1][1] === desde) tramos[tramos.length - 1][1] = t;
      else tramos.push([desde, t]);
      desde = null;
    }
  }
  return tramos;
}

export function ventanaCubre(ventanas, dia, horaIni, horaFin) {
  return ventanas.some(
    (v) => v.dia_semana === dia && v.estado === 'disponible' && v.hora_inicio <= horaIni && v.hora_fin >= horaFin,
  );
}

export async function ventanasDe(ex, idsGaraje) {
  if (!idsGaraje.length) return new Map();
  const filas = await all(
    ex,
    `SELECT id_garaje, dia_semana, hora_inicio, hora_fin, estado FROM disponibilidad
      WHERE id_garaje IN (${idsGaraje.map(() => '?').join(',')})
      ORDER BY dia_semana, hora_inicio`,
    idsGaraje,
  );
  const mapa = new Map();
  for (const f of filas) {
    if (!mapa.has(f.id_garaje)) mapa.set(f.id_garaje, []);
    mapa.get(f.id_garaje).push(f);
  }
  return mapa;
}

export async function reservasQueOcupan(ex, idsGaraje, desdeIso, hastaIso) {
  if (!idsGaraje.length) return new Map();
  const filas = await all(
    ex,
    `SELECT id_garaje, fecha_inicio, fecha_fin FROM reserva
      WHERE id_garaje IN (${idsGaraje.map(() => '?').join(',')})
        AND estado IN ('pendiente', 'confirmada')
        AND fecha_inicio < ? AND fecha_fin > ?`,
    [...idsGaraje, hastaIso, desdeIso],
  );
  const mapa = new Map();
  for (const f of filas) {
    if (!mapa.has(f.id_garaje)) mapa.set(f.id_garaje, []);
    mapa.get(f.id_garaje).push(f);
  }
  return mapa;
}

/** Las solicitudes que el propietario no respondió antes de la hora de inicio se cancelan solas. */
export async function expirarPendientes(ex) {
  const ahora = ahoraIso();
  // Antes de cancelar, se avisa al conductor (una sola vez por reserva).
  await run(
    ex,
    `INSERT INTO notificacion (id_usuario, id_reserva, tipo, mensaje)
     SELECT r.id_usuario, r.id_reserva, 'reserva_vencida',
            'Tu solicitud en "' || g.nombre || '" se canceló porque el propietario no respondió a tiempo. Prueba con otro garaje.'
       FROM reserva r JOIN garaje g ON g.id_garaje = r.id_garaje
      WHERE r.estado = 'pendiente' AND r.fecha_inicio <= ?
        AND NOT EXISTS (SELECT 1 FROM notificacion n WHERE n.id_reserva = r.id_reserva AND n.tipo = 'reserva_vencida')`,
    [ahora],
  );
  await run(
    ex,
    `UPDATE pago SET estado_pago = 'rechazado'
      WHERE estado_pago = 'pendiente'
        AND id_reserva IN (SELECT id_reserva FROM reserva WHERE estado = 'pendiente' AND fecha_inicio <= ?)`,
    [ahora],
  );
  await run(
    ex,
    `UPDATE reserva SET estado = 'cancelada', motivo = 'El propietario no respondió a tiempo.'
      WHERE estado = 'pendiente' AND fecha_inicio <= ?`,
    [ahora],
  );
}

/** Distancia en km entre dos coordenadas (fórmula de Haversine). */
export function distanciaKm(lat1, lon1, lat2, lon2) {
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}
