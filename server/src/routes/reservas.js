import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { all, getDb, one, run, transaccion } from '../db.js';
import { requiereSesion } from '../lib/auth.js';
import {
  expirarPendientes,
  maxConcurrencia,
  reservasQueOcupan,
  ventanaCubre,
  ventanasDe,
} from '../lib/disponibilidad.js';
import { HttpError, conflicto, idDeParametro, noEncontrado, prohibido, validar } from '../lib/http.js';
import { cargarReserva, chatAbierto, formatoReserva, listarReservas, notificar, ventanaDeLlegada } from '../lib/reservas.js';
import { HORA_RE, aUtc, diaSemanaIso, esFechaValida, hoyBogota, minutos } from '../lib/tiempo.js';

export const rutasReservas = Router();
rutasReservas.use(requiereSesion);

const MAX_DIAS_ADELANTE = 60;
const PLACA = { carro: /^[A-Z]{3}\d{3}$/, moto: /^[A-Z]{3}\d{2}[A-Z]$/ };

const esquemaReserva = z.object({
  id_garaje: z.coerce.number().int().positive(),
  fecha: z.string(),
  hora_inicio: z.string().regex(HORA_RE, 'Hora de entrada inválida.'),
  hora_fin: z.string().regex(HORA_RE, 'Hora de salida inválida.'),
  tipo_vehiculo: z.enum(['carro', 'moto']),
  placa: z.string().trim().transform((p) => p.replace(/[\s-]/g, '').toUpperCase()),
  metodo_pago: z.enum(['tarjeta', 'pse', 'efectivo']),
});

function validarTiempos(d) {
  if (!esFechaValida(d.fecha)) throw new HttpError(400, 'fecha: usa el formato AAAA-MM-DD.');
  const a = minutos(d.hora_inicio);
  const b = minutos(d.hora_fin);
  if (a % 30 !== 0 || b % 30 !== 0) throw new HttpError(400, 'Las horas deben ir en bloques de 30 minutos.');
  if (b <= a) throw new HttpError(400, 'La hora de salida debe ser posterior a la de entrada.');
  const inicio = aUtc(d.fecha, d.hora_inicio);
  if (Date.parse(inicio) <= Date.now()) throw new HttpError(400, 'La hora de entrada ya pasó.');
  const limite = new Date(Date.parse(`${hoyBogota()}T00:00:00Z`) + MAX_DIAS_ADELANTE * 86400e3).toISOString().slice(0, 10);
  if (d.fecha > limite) throw new HttpError(400, `Solo puedes reservar con hasta ${MAX_DIAS_ADELANTE} días de anticipación.`);
  return { inicio, fin: aUtc(d.fecha, d.hora_fin), minutos: b - a };
}

// POST /api/reservas — solicita una reserva (queda pendiente hasta que el propietario responda)
rutasReservas.post('/', async (req, res) => {
  const d = validar(esquemaReserva, req.body);
  if (!PLACA[d.tipo_vehiculo].test(d.placa)) {
    throw new HttpError(400, d.tipo_vehiculo === 'carro' ? 'placa: formato de carro inválido (ej. ABC123).' : 'placa: formato de moto inválido (ej. ABC12D).');
  }
  const t = validarTiempos(d);
  const u = req.usuario;

  const idReserva = await transaccion(async (tx) => {
    const g = await one(
      tx,
      `SELECT g.*, p.id_usuario AS dueno_id, ou.estado AS dueno_estado
         FROM garaje g JOIN propietario p ON p.id_propietario = g.id_propietario
         JOIN usuario ou ON ou.id_usuario = p.id_usuario WHERE g.id_garaje = ?
        FOR UPDATE OF g`, // bloquea el garaje: dos solicitudes del mismo cupo no pueden colarse a la vez
      [d.id_garaje],
    );
    if (!g || g.estado !== 'activo' || g.dueno_estado !== 'activo') throw noEncontrado('Garaje');
    if (g.dueno_id === u.id_usuario) throw prohibido('No puedes reservar tu propio garaje.');
    if (g.tipo_vehiculo !== 'ambos' && g.tipo_vehiculo !== d.tipo_vehiculo) {
      throw conflicto(`Este garaje solo admite ${g.tipo_vehiculo === 'carro' ? 'carros' : 'motos'}.`);
    }

    const ventanas = (await ventanasDe(tx, [g.id_garaje])).get(g.id_garaje) ?? [];
    if (!ventanaCubre(ventanas, diaSemanaIso(d.fecha), d.hora_inicio, d.hora_fin)) {
      throw conflicto('El garaje no está ofrecido en ese horario.');
    }

    const bloqueo = await one(tx, 'SELECT motivo FROM bloqueo WHERE id_garaje = ? AND fecha = ?', [g.id_garaje, d.fecha]);
    if (bloqueo) {
      throw conflicto(`El propietario no recibe reservas ese día${bloqueo.motivo ? ` (${bloqueo.motivo})` : ''}. Elige otra fecha.`);
    }

    await expirarPendientes(tx);
    const ocupadas = (await reservasQueOcupan(tx, [g.id_garaje], t.inicio, t.fin)).get(g.id_garaje) ?? [];
    if (maxConcurrencia(ocupadas, t.inicio, t.fin) >= g.capacidad_total) {
      throw conflicto('Ese horario ya no está disponible. Elige otro.');
    }

    const mismaPlaca = await one(
      tx,
      `SELECT 1 AS x FROM reserva WHERE placa = ? AND estado IN ('pendiente', 'confirmada')
          AND fecha_inicio < ? AND fecha_fin > ? LIMIT 1`,
      [d.placa, t.fin, t.inicio],
    );
    if (mismaPlaca) throw conflicto('Ese vehículo ya tiene una reserva en ese horario.');

    const costo = Math.round((g.tarifa_hora * t.minutos) / 60);
    const r = await run(
      tx,
      `INSERT INTO reserva (id_usuario, id_garaje, fecha_inicio, fecha_fin, costo_total, tipo_vehiculo, placa)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [u.id_usuario, g.id_garaje, t.inicio, t.fin, costo, d.tipo_vehiculo, d.placa],
    );
    const id = Number(r.lastInsertRowid);
    await run(
      tx,
      `INSERT INTO pago (id_reserva, metodo_pago, monto, estado_pago, referencia)
       VALUES (?, ?, ?, 'pendiente', ?)`,
      [id, d.metodo_pago, costo, `SIM-${crypto.randomBytes(4).toString('hex').toUpperCase()}`],
    );
    await notificar(
      tx,
      g.dueno_id,
      'solicitud_nueva',
      `${u.nombre} solicitó "${g.nombre}" el ${d.fecha} de ${d.hora_inicio} a ${d.hora_fin}.`,
      id,
    );
    return id;
  });

  const r = await cargarReserva(getDb(), idReserva);
  res.status(201).json({ reserva: formatoReserva(r, 'conductor') });
});

// GET /api/reservas — mis reservas como conductor
rutasReservas.get('/', async (req, res) => {
  const db = getDb();
  await expirarPendientes(db);
  const filas = await listarReservas(db, 'r.id_usuario = ?', [req.usuario.id_usuario]);
  res.json({ reservas: filas.map((r) => formatoReserva(r, 'conductor')) });
});

async function reservaVisible(req) {
  const id = idDeParametro(req.params.id);
  const db = getDb();
  await expirarPendientes(db);
  const r = await cargarReserva(db, id);
  if (!r) throw noEncontrado('Reserva');
  const u = req.usuario;
  const vista = r.id_usuario === u.id_usuario ? 'conductor' : r.dueno_id_usuario === u.id_usuario ? 'propietario' : null;
  if (!vista && u.tipo_usuario !== 'admin') throw noEncontrado('Reserva');
  return { r, vista: vista ?? 'propietario' };
}

rutasReservas.get('/:id', async (req, res) => {
  const { r, vista } = await reservaVisible(req);
  res.json({ reserva: formatoReserva(r, vista) });
});

// ---- Calendario: archivo .ics para agregar la reserva al calendario del celular ----

const escIcs = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
const fechaIcs = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
// RFC 5545: las líneas no pasan de 75 bytes; las largas se parten con un espacio de continuación.
function plegar(linea) {
  const bytes = Buffer.from(linea, 'utf8');
  if (bytes.length <= 75) return linea;
  const partes = [];
  let i = 0;
  while (i < bytes.length) {
    let fin = Math.min(i + (i === 0 ? 75 : 74), bytes.length);
    while (fin < bytes.length && (bytes[fin] & 0xc0) === 0x80) fin -= 1; // no cortar un carácter UTF-8 a la mitad
    partes.push(bytes.subarray(i, fin).toString('utf8'));
    i = fin;
  }
  return partes.join('\r\n ');
}

rutasReservas.get('/:id/calendario', async (req, res) => {
  const { r, vista } = await reservaVisible(req);
  if (r.estado === 'rechazada' || r.estado === 'cancelada') throw conflicto('Esta reserva ya no está activa.');
  const f = formatoReserva(r, vista);
  const descripcion = [
    `Vehículo: ${f.tipo_vehiculo === 'carro' ? 'Carro' : 'Moto'} ${f.placa}`,
    `Total: $${f.costo_total.toLocaleString('es-CO')} (pago simulado)`,
    f.estado === 'confirmada' ? (f.garaje.instrucciones_acceso ? `Cómo entrar: ${f.garaje.instrucciones_acceso}` : '') : 'Pendiente de confirmación del propietario.',
  ].filter(Boolean).join('\n');
  const lineas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ParkSpotter//Reservas//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:reserva-${f.id_reserva}@parkspotter`,
    `DTSTAMP:${fechaIcs(new Date().toISOString())}`,
    `DTSTART:${fechaIcs(f.fecha_inicio)}`,
    `DTEND:${fechaIcs(f.fecha_fin)}`,
    `SUMMARY:${escIcs(`Parqueadero: ${f.garaje.nombre}`)}`,
    `LOCATION:${escIcs(`${f.garaje.direccion}${f.garaje.barrio ? `, ${f.garaje.barrio}` : ''}, Bogotá`)}`,
    `GEO:${f.garaje.latitud};${f.garaje.longitud}`,
    `DESCRIPTION:${escIcs(descripcion)}`,
    `STATUS:${f.estado === 'confirmada' ? 'CONFIRMED' : 'TENTATIVE'}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT60M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Tu parqueadero empieza en una hora',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  res.set({
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': `attachment; filename="reserva-${f.id_reserva}.ics"`,
  });
  res.send(`${lineas.map(plegar).join('\r\n')}\r\n`);
});

// ---- Chat de la reserva (solo conductor y propietario; ni siquiera el administrador lo lee) ----

async function reservaDelChat(req) {
  const { r, vista } = await reservaVisible(req);
  const u = req.usuario;
  if (r.id_usuario !== u.id_usuario && r.dueno_id_usuario !== u.id_usuario) throw noEncontrado('Reserva');
  return { r, vista };
}

const formatoMensaje = (m, yo) => ({ id_mensaje: m.id_mensaje, mio: m.id_usuario === yo, texto: m.texto, fecha: m.fecha });

// GET /api/reservas/:id/mensajes?despues=<id> — devuelve los nuevos y marca como leídos los del otro
rutasReservas.get('/:id/mensajes', async (req, res) => {
  const { r } = await reservaDelChat(req);
  const { despues } = validar(z.object({ despues: z.coerce.number().int().min(0).default(0) }), req.query);
  const db = getDb();
  const filas = await all(
    db,
    'SELECT * FROM mensaje WHERE id_reserva = ? AND id_mensaje > ? ORDER BY id_mensaje LIMIT 200',
    [r.id_reserva, despues],
  );
  if (filas.some((m) => m.id_usuario !== req.usuario.id_usuario && !m.leido)) {
    await run(db, 'UPDATE mensaje SET leido = 1 WHERE id_reserva = ? AND id_usuario <> ? AND leido = 0', [
      r.id_reserva,
      req.usuario.id_usuario,
    ]);
  }
  res.json({ mensajes: filas.map((m) => formatoMensaje(m, req.usuario.id_usuario)), puede_escribir: chatAbierto(r) });
});

// POST /api/reservas/:id/mensajes
rutasReservas.post('/:id/mensajes', async (req, res) => {
  const { r } = await reservaDelChat(req);
  const { texto } = validar(z.object({ texto: z.string().trim().min(1, 'Escribe un mensaje.').max(500, 'Máximo 500 caracteres.') }), req.body);
  if (!chatAbierto(r)) throw conflicto('El chat de esta reserva ya está cerrado.');
  const u = req.usuario;
  const db = getDb();
  const { n } = await one(
    db,
    'SELECT COUNT(*) AS n FROM mensaje WHERE id_usuario = ? AND fecha > ?',
    [u.id_usuario, new Date(Date.now() - 60_000).toISOString()],
  );
  if (n >= 20) throw new HttpError(429, 'Estás escribiendo muy rápido. Espera un momento.');

  const otro = r.id_usuario === u.id_usuario ? r.dueno_id_usuario : r.id_usuario;
  const id = await transaccion(async (tx) => {
    const ins = await run(tx, 'INSERT INTO mensaje (id_reserva, id_usuario, texto) VALUES (?, ?, ?)', [r.id_reserva, u.id_usuario, texto]);
    // Un solo aviso sin leer por conversación: no se llena la campana con cada mensaje.
    const yaAvisado = await one(
      tx,
      "SELECT 1 AS x FROM notificacion WHERE id_usuario = ? AND id_reserva = ? AND tipo = 'mensaje' AND leida = 0",
      [otro, r.id_reserva],
    );
    if (!yaAvisado) await notificar(tx, otro, 'mensaje', `${u.nombre} te escribió sobre "${r.g_nombre}".`, r.id_reserva);
    return Number(ins.lastInsertRowid);
  });
  const m = await one(db, 'SELECT * FROM mensaje WHERE id_mensaje = ?', [id]);
  res.status(201).json({ mensaje: formatoMensaje(m, u.id_usuario) });
});

const esquemaMotivo = z.object({ motivo: z.string().trim().max(200).optional() });

// POST /api/reservas/:id/cancelar — la cancela el conductor o el propietario, antes del inicio
rutasReservas.post('/:id/cancelar', async (req, res) => {
  const { motivo } = validar(esquemaMotivo, req.body);
  const id = idDeParametro(req.params.id);
  const u = req.usuario;

  await transaccion(async (tx) => {
    await expirarPendientes(tx);
    const r = await cargarReserva(tx, id);
    if (!r) throw noEncontrado('Reserva');
    const esConductor = r.id_usuario === u.id_usuario;
    const esDueno = r.dueno_id_usuario === u.id_usuario;
    if (!esConductor && !esDueno) throw noEncontrado('Reserva');
    if (!['pendiente', 'confirmada'].includes(r.estado)) throw conflicto(`La reserva ya está ${r.estado}.`);
    if (r.fecha_inicio <= new Date().toISOString()) throw conflicto('La reserva ya comenzó y no se puede cancelar.');

    await run(tx, "UPDATE reserva SET estado = 'cancelada', motivo = ? WHERE id_reserva = ?", [
      motivo ?? (esConductor ? 'Cancelada por el conductor.' : 'Cancelada por el propietario.'),
      id,
    ]);
    await run(
      tx,
      `UPDATE pago SET estado_pago = CASE estado_pago WHEN 'aprobado' THEN 'reembolsado' ELSE 'rechazado' END
        WHERE id_reserva = ? AND estado_pago IN ('pendiente', 'aprobado')`,
      [id],
    );
    await notificar(
      tx,
      esConductor ? r.dueno_id_usuario : r.id_usuario,
      'reserva_cancelada',
      `La reserva de "${r.g_nombre}" fue cancelada por ${esConductor ? 'el conductor' : 'el propietario'}.`,
      id,
    );
  });

  const r = await cargarReserva(getDb(), id);
  res.json({ reserva: formatoReserva(r, r.id_usuario === u.id_usuario ? 'conductor' : 'propietario') });
});

const esquemaRespuesta = z.object({
  accion: z.enum(['aceptar', 'rechazar']),
  motivo: z.string().trim().max(200).optional(),
});

// POST /api/reservas/:id/responder — el propietario acepta o rechaza una solicitud pendiente
rutasReservas.post('/:id/responder', async (req, res) => {
  const { accion, motivo } = validar(esquemaRespuesta, req.body);
  const id = idDeParametro(req.params.id);
  const u = req.usuario;

  await transaccion(async (tx) => {
    await expirarPendientes(tx);
    const r = await cargarReserva(tx, id);
    if (!r || r.dueno_id_usuario !== u.id_usuario) throw noEncontrado('Reserva');
    if (r.estado !== 'pendiente') throw conflicto(`Esta solicitud ya está ${r.estado}.`);

    if (accion === 'aceptar') {
      await run(tx, "UPDATE reserva SET estado = 'confirmada' WHERE id_reserva = ?", [id]);
      // Pago simulado: tarjeta/PSE se "aprueban" al confirmar; en efectivo se paga en el garaje.
      await run(
        tx,
        `UPDATE pago SET estado_pago = 'aprobado', fecha_pago = ?
          WHERE id_reserva = ? AND metodo_pago IN ('tarjeta', 'pse')`,
        [new Date().toISOString(), id],
      );
      await notificar(tx, r.id_usuario, 'reserva_confirmada', `Tu reserva en "${r.g_nombre}" fue confirmada.`, id);
    } else {
      await run(tx, "UPDATE reserva SET estado = 'rechazada', motivo = ? WHERE id_reserva = ?", [
        motivo ?? 'El propietario rechazó la solicitud.',
        id,
      ]);
      await run(tx, "UPDATE pago SET estado_pago = 'rechazado' WHERE id_reserva = ?", [id]);
      await notificar(tx, r.id_usuario, 'reserva_rechazada', `Tu solicitud en "${r.g_nombre}" fue rechazada.`, id);
    }
  });

  const r = await cargarReserva(getDb(), id);
  res.json({ reserva: formatoReserva(r, 'propietario') });
});

// ---- Llegada: el propietario digita el código que le muestra el conductor ----

const MAX_INTENTOS_CODIGO = 5;
const ESPERA_CODIGO_MS = 10 * 60 * 1000;
const fallosCodigo = new Map(); // id_reserva -> { n, hasta }

// POST /api/reservas/:id/llegada — solo el propietario, de 30 min antes de la entrada hasta la salida
rutasReservas.post('/:id/llegada', async (req, res) => {
  const { codigo } = validar(z.object({ codigo: z.string().trim().min(4).max(10) }), req.body);
  const id = idDeParametro(req.params.id);
  const u = req.usuario;

  const f = fallosCodigo.get(id);
  if (f && f.hasta > Date.now()) {
    throw new HttpError(429, `Demasiados códigos incorrectos. Espera ${Math.ceil((f.hasta - Date.now()) / 60000)} min.`);
  }

  await transaccion(async (tx) => {
    const r = await cargarReserva(tx, id);
    if (!r || r.dueno_id_usuario !== u.id_usuario) throw noEncontrado('Reserva');
    if (r.estado !== 'confirmada') throw conflicto('Solo se registra la llegada de una reserva confirmada.');
    if (r.llegada) throw conflicto('La llegada de esta reserva ya fue registrada.');
    if (!ventanaDeLlegada(r)) {
      throw conflicto(Date.parse(r.fecha_fin) <= Date.now() ? 'Esta reserva ya terminó.' : 'Aún es muy pronto: la llegada se registra desde 30 minutos antes de la entrada.');
    }
    if (codigo.toUpperCase() !== String(r.codigo).toUpperCase()) {
      const n = (f && f.hasta === 0 ? f.n : 0) + 1; // si venía de un bloqueo ya cumplido, se empieza de cero
      fallosCodigo.set(id, { n, hasta: n >= MAX_INTENTOS_CODIGO ? Date.now() + ESPERA_CODIGO_MS : 0 });
      throw new HttpError(400, 'El código no coincide. Pídele al conductor que te muestre el de su reserva.');
    }
    fallosCodigo.delete(id);
    await run(tx, 'UPDATE reserva SET llegada = ? WHERE id_reserva = ?', [new Date().toISOString(), id]);
    await notificar(tx, r.id_usuario, 'llegada_registrada', `Registraron tu llegada a "${r.g_nombre}". ¡Buen estacionamiento!`, id);
  });

  res.json({ reserva: formatoReserva(await cargarReserva(getDb(), id), 'propietario') });
});

const esquemaCalificacion = z.object({
  puntuacion: z.coerce.number().int().min(1).max(5),
  comentario: z.string().trim().max(255).optional(),
});

// POST /api/reservas/:id/calificar — el conductor califica el garaje tras usarlo
rutasReservas.post('/:id/calificar', async (req, res) => {
  const d = validar(esquemaCalificacion, req.body);
  const id = idDeParametro(req.params.id);
  const u = req.usuario;

  await transaccion(async (tx) => {
    const r = await cargarReserva(tx, id);
    if (!r || r.id_usuario !== u.id_usuario) throw noEncontrado('Reserva');
    if (r.estado !== 'confirmada' || r.fecha_fin >= new Date().toISOString()) {
      throw conflicto('Solo puedes calificar una reserva confirmada que ya terminó.');
    }
    if (r.cal_puntuacion) throw conflicto('Ya calificaste esta reserva.');
    await run(
      tx,
      'INSERT INTO calificacion (id_reserva, id_usuario, id_garaje, puntuacion, comentario) VALUES (?, ?, ?, ?, ?)',
      [id, u.id_usuario, r.id_garaje, d.puntuacion, d.comentario || null],
    );
    await notificar(tx, r.dueno_id_usuario, 'calificacion_nueva', `Te calificaron con ${d.puntuacion}/5 en "${r.g_nombre}".`, id);
  });

  const r = await cargarReserva(getDb(), id);
  res.status(201).json({ reserva: formatoReserva(r, 'conductor') });
});
