// Tareas periódicas del servidor (no dependen de que alguien abra la app).
import { all } from '../db.js';
import { expirarPendientes } from './disponibilidad.js';
import { notificar } from './reservas.js';
import { aLocal } from './tiempo.js';

const HORAS_ANTES = 3;

/**
 * Avisa al propietario de las solicitudes pendientes que empiezan en las próximas 3 horas (una sola vez por solicitud):
 * si no responde antes de la hora de entrada, se cancelan solas.
 */
export async function recordarPendientes(ex, ahoraMs = Date.now()) {
  const ahora = new Date(ahoraMs).toISOString();
  const limite = new Date(ahoraMs + HORAS_ANTES * 3600e3).toISOString();
  const filas = await all(
    ex,
    `SELECT r.id_reserva, r.fecha_inicio, g.nombre AS garaje, p.id_usuario AS dueno, u.nombre AS conductor
       FROM reserva r
       JOIN garaje g ON g.id_garaje = r.id_garaje
       JOIN propietario p ON p.id_propietario = g.id_propietario
       JOIN usuario u ON u.id_usuario = r.id_usuario
      WHERE r.estado = 'pendiente' AND r.fecha_inicio > ? AND r.fecha_inicio <= ?
        AND NOT EXISTS (SELECT 1 FROM notificacion n WHERE n.id_reserva = r.id_reserva AND n.tipo = 'recordatorio_solicitud')`,
    [ahora, limite],
  );
  for (const f of filas) {
    await notificar(
      ex,
      f.dueno,
      'recordatorio_solicitud',
      `${f.conductor} espera tu respuesta para "${f.garaje}" (entra a las ${aLocal(f.fecha_inicio).hora}). Si no respondes antes, se cancela sola.`,
      f.id_reserva,
    );
  }
  return filas.length;
}

/** Una pasada: recordar las que están por vencer y cancelar (avisando) las que ya vencieron. */
export async function pasadaPeriodica(ex) {
  await expirarPendientes(ex);
  return recordarPendientes(ex);
}

const CADA_MS = 5 * 60 * 1000;
let temporizador = null;

export function iniciarTareas(ex) {
  const correr = () => pasadaPeriodica(ex).catch((e) => console.error('Tarea periódica:', e.message));
  void correr();
  temporizador = setInterval(correr, CADA_MS);
  temporizador.unref?.();
}

export function detenerTareas() {
  clearInterval(temporizador);
  temporizador = null;
}
