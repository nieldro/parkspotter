import { all, one, run } from '../db.js';
import { urlDeImagen } from './imagenes.js';
import { ahoraIso, rangoLocal } from './tiempo.js';

export const SELECT_RESERVA = `
  SELECT r.*,
         g.nombre AS g_nombre, g.direccion AS g_direccion, g.barrio AS g_barrio, g.localidad AS g_localidad,
         g.latitud AS g_latitud, g.longitud AS g_longitud, g.instrucciones_acceso AS g_instrucciones,
         g.tarifa_hora AS g_tarifa_hora,
         ou.id_usuario AS dueno_id_usuario, ou.nombre AS dueno_nombre, ou.apellido AS dueno_apellido,
         ou.telefono AS dueno_telefono,
         cu.nombre AS cond_nombre, cu.apellido AS cond_apellido, cu.telefono AS cond_telefono,
         pg.metodo_pago, pg.estado_pago, pg.referencia, pg.monto AS pago_monto, pg.fecha_pago,
         cal.puntuacion AS cal_puntuacion, cal.comentario AS cal_comentario,
         ou.foto AS dueno_foto, cu.foto AS cond_foto,
         (SELECT f.archivo FROM garaje_foto f WHERE f.id_garaje = g.id_garaje ORDER BY f.orden, f.id_foto LIMIT 1) AS g_foto,
         (SELECT COUNT(*) FROM mensaje m WHERE m.id_reserva = r.id_reserva AND m.leido = 0 AND m.id_usuario <> r.id_usuario) AS msgs_para_conductor,
         (SELECT COUNT(*) FROM mensaje m WHERE m.id_reserva = r.id_reserva AND m.leido = 0 AND m.id_usuario = r.id_usuario) AS msgs_para_propietario
    FROM reserva r
    JOIN garaje g ON g.id_garaje = r.id_garaje
    JOIN propietario p ON p.id_propietario = g.id_propietario
    JOIN usuario ou ON ou.id_usuario = p.id_usuario
    JOIN usuario cu ON cu.id_usuario = r.id_usuario
    LEFT JOIN pago pg ON pg.id_reserva = r.id_reserva
    LEFT JOIN calificacion cal ON cal.id_reserva = r.id_reserva`;

export async function cargarReserva(ex, id) {
  return one(ex, `${SELECT_RESERVA} WHERE r.id_reserva = ?`, [id]);
}

export async function listarReservas(ex, donde, args) {
  return all(ex, `${SELECT_RESERVA} WHERE ${donde} ORDER BY r.fecha_inicio DESC LIMIT 200`, args);
}

/**
 * Forma de una reserva para la pantalla. `vista` indica quién mira:
 * el conductor ve los datos de acceso solo con la reserva confirmada;
 * el propietario ve el teléfono del conductor solo con la reserva confirmada.
 */
/** El chat está abierto mientras la reserva esté viva: pendiente o confirmada hasta 24 h después de terminar. */
export function chatAbierto(r) {
  if (r.estado === 'pendiente') return r.fecha_inicio > ahoraIso();
  if (r.estado !== 'confirmada') return false;
  return Date.parse(r.fecha_fin) + 24 * 3600e3 > Date.now();
}

/** El propietario puede registrar la llegada desde 30 min antes de la entrada hasta la hora de salida. */
export function ventanaDeLlegada(r, ahoraMs = Date.now()) {
  return ahoraMs >= Date.parse(r.fecha_inicio) - 30 * 60000 && ahoraMs < Date.parse(r.fecha_fin);
}

export function formatoReserva(r, vista) {
  const ahora = ahoraIso();
  const estadoEfectivo = r.estado === 'confirmada' && r.fecha_fin < ahora ? 'finalizada' : r.estado;
  const confirmada = r.estado === 'confirmada';
  const activaFutura = (r.estado === 'pendiente' || r.estado === 'confirmada') && r.fecha_inicio > ahora;

  return {
    id_reserva: r.id_reserva,
    estado: r.estado,
    estado_efectivo: estadoEfectivo,
    ...rangoLocal(r.fecha_inicio, r.fecha_fin),
    fecha_inicio: r.fecha_inicio,
    fecha_fin: r.fecha_fin,
    costo_total: r.costo_total,
    tipo_vehiculo: r.tipo_vehiculo,
    placa: r.placa,
    motivo: r.motivo,
    fecha_solicitud: r.fecha_solicitud,
    garaje: {
      id_garaje: r.id_garaje,
      nombre: r.g_nombre,
      direccion: r.g_direccion,
      barrio: r.g_barrio,
      localidad: r.g_localidad,
      latitud: r.g_latitud,
      longitud: r.g_longitud,
      foto: urlDeImagen(r.g_foto),
      ...(vista !== 'conductor' || confirmada ? { instrucciones_acceso: r.g_instrucciones } : {}),
    },
    pago: r.metodo_pago
      ? { metodo_pago: r.metodo_pago, estado_pago: r.estado_pago, referencia: r.referencia, monto: r.pago_monto, simulado: true }
      : null,
    calificacion: r.cal_puntuacion ? { puntuacion: r.cal_puntuacion, comentario: r.cal_comentario } : null,
    propietario: {
      nombre: `${r.dueno_nombre} ${r.dueno_apellido.charAt(0)}.`,
      foto: urlDeImagen(r.dueno_foto),
      ...(vista === 'conductor' && confirmada ? { telefono: r.dueno_telefono } : {}),
    },
    conductor: {
      nombre: vista === 'conductor' ? undefined : `${r.cond_nombre} ${r.cond_apellido}`,
      foto: vista === 'conductor' ? undefined : urlDeImagen(r.cond_foto),
      ...(vista !== 'conductor' && confirmada ? { telefono: r.cond_telefono } : {}),
    },
    // El código de llegada lo muestra solo el conductor y solo con la reserva confirmada;
    // el propietario lo digita al recibirlo (así se confirma que llegó quien reservó).
    ...(vista === 'conductor' && confirmada ? { codigo: r.codigo } : {}),
    llegada: r.llegada ?? null,
    puede_registrar_llegada: vista === 'propietario' && confirmada && !r.llegada && ventanaDeLlegada(r),
    mensajes_sin_leer: vista === 'conductor' ? r.msgs_para_conductor : r.msgs_para_propietario,
    puede_chatear: chatAbierto(r),
    puede_cancelar: activaFutura,
    puede_responder: vista === 'propietario' && r.estado === 'pendiente' && activaFutura,
    puede_calificar: vista === 'conductor' && estadoEfectivo === 'finalizada' && !r.cal_puntuacion,
  };
}

export async function notificar(ex, idUsuario, tipo, mensaje, idReserva = null) {
  await run(ex, 'INSERT INTO notificacion (id_usuario, id_reserva, tipo, mensaje) VALUES (?, ?, ?, ?)', [
    idUsuario,
    idReserva,
    tipo,
    mensaje,
  ]);
}
