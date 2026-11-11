import { Router } from 'express';
import { z } from 'zod';
import { all, getDb, one, run, transaccion } from '../db.js';
import { requierePropietario, requiereSesion } from '../lib/auth.js';
import { expirarPendientes, ventanasDe } from '../lib/disponibilidad.js';
import { HttpError, conflicto, idDeParametro, noEncontrado, prohibido, validar } from '../lib/http.js';
import { borrarImagen, guardarImagen, urlDeImagen } from '../lib/imagenes.js';
import { SERVICIOS, aLista, aTexto } from '../lib/servicios.js';
import { formatoReserva, listarReservas, notificar } from '../lib/reservas.js';
import { aLocal, aUtc, diaSemanaIso, esFechaValida, hoyBogota, minutos } from '../lib/tiempo.js';

export const rutasPropietario = Router();
rutasPropietario.use(requiereSesion, requierePropietario);

const HORA_INICIO_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const HORA_FIN_RE = /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/;

const esquemaVentana = z
  .object({
    dia_semana: z.coerce.number().int().min(1).max(7),
    hora_inicio: z.string().regex(HORA_INICIO_RE, 'Hora de inicio inválida.'),
    hora_fin: z.string().regex(HORA_FIN_RE, 'Hora de fin inválida.'),
  })
  .refine((v) => minutos(v.hora_inicio) % 30 === 0 && minutos(v.hora_fin) % 30 === 0, {
    message: 'Las horas deben ir en bloques de 30 minutos.',
  })
  .refine((v) => minutos(v.hora_inicio) < minutos(v.hora_fin), {
    message: 'La hora de fin debe ser posterior a la de inicio.',
  });

const opcional = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((s) => s || null);

const esquemaGaraje = z
  .object({
    nombre: z.string().trim().min(3).max(100),
    direccion: z.string().trim().min(5).max(150),
    barrio: opcional(50),
    localidad: opcional(50),
    // ParkSpotter opera solo en Bogotá: esta caja evita publicaciones con coordenadas por error.
    latitud: z.coerce.number().min(4.45, 'El garaje debe estar en Bogotá.').max(4.85, 'El garaje debe estar en Bogotá.'),
    longitud: z.coerce.number().min(-74.25, 'El garaje debe estar en Bogotá.').max(-73.98, 'El garaje debe estar en Bogotá.'),
    tarifa_hora: z.coerce.number().int().min(500, 'La tarifa mínima es $500 por hora.').max(100000),
    capacidad_total: z.coerce.number().int().min(1).max(50),
    tipo_vehiculo: z.enum(['carro', 'moto', 'ambos']),
    descripcion: opcional(500),
    instrucciones_acceso: opcional(500),
    servicios: z.array(z.enum(SERVICIOS)).max(SERVICIOS.length).optional().default([]),
    disponibilidad: z.array(esquemaVentana).min(1, 'Agrega al menos un horario disponible.').max(42),
  })
  .superRefine((g, ctx) => {
    const porDia = new Map();
    for (const v of g.disponibilidad) {
      if (!porDia.has(v.dia_semana)) porDia.set(v.dia_semana, []);
      porDia.get(v.dia_semana).push(v);
    }
    for (const vs of porDia.values()) {
      vs.sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
      for (let i = 1; i < vs.length; i++) {
        if (vs[i].hora_inicio < vs[i - 1].hora_fin) {
          ctx.addIssue({ code: 'custom', path: ['disponibilidad'], message: 'Hay horarios que se cruzan en un mismo día.' });
          return;
        }
      }
    }
  });

async function guardarVentanas(tx, idGaraje, ventanas) {
  await run(tx, 'DELETE FROM disponibilidad WHERE id_garaje = ?', [idGaraje]);
  for (const v of ventanas) {
    await run(tx, 'INSERT INTO disponibilidad (id_garaje, dia_semana, hora_inicio, hora_fin) VALUES (?, ?, ?, ?)', [
      idGaraje,
      v.dia_semana,
      v.hora_inicio,
      v.hora_fin,
    ]);
  }
}

async function detalleGaraje(ex, idGaraje) {
  const g = await one(
    ex,
    `SELECT g.*,
       (SELECT ROUND(AVG(c.puntuacion), 1) FROM calificacion c WHERE c.id_garaje = g.id_garaje) AS calificacion_promedio,
       (SELECT COUNT(*) FROM calificacion c WHERE c.id_garaje = g.id_garaje) AS total_calificaciones
     FROM garaje g WHERE g.id_garaje = ?`,
    [idGaraje],
  );
  const disponibilidad = ((await ventanasDe(ex, [idGaraje])).get(idGaraje) ?? []).map(
    ({ dia_semana, hora_inicio, hora_fin }) => ({ dia_semana, hora_inicio, hora_fin }),
  );
  return { ...g, servicios: aLista(g.servicios), disponibilidad, fotos: await fotosDe(ex, idGaraje) };
}

async function fotosDe(ex, idGaraje) {
  const filas = await all(ex, 'SELECT id_foto, archivo FROM garaje_foto WHERE id_garaje = ? ORDER BY orden, id_foto', [idGaraje]);
  return filas.map((f) => ({ id_foto: f.id_foto, url: urlDeImagen(f.archivo) }));
}

const MAX_FOTOS = 6;

async function garajeDelPropietario(req) {
  const id = idDeParametro(req.params.id);
  const g = await one(getDb(), 'SELECT id_garaje, estado FROM garaje WHERE id_garaje = ? AND id_propietario = ?', [
    id,
    req.usuario.id_propietario,
  ]);
  if (!g) throw noEncontrado('Garaje');
  return g;
}

// GET /api/propietario/resumen
rutasPropietario.get('/resumen', async (req, res) => {
  const db = getDb();
  await expirarPendientes(db);
  const ahora = new Date().toISOString();
  const fila = await one(
    db,
    `SELECT
       (SELECT COUNT(*) FROM garaje WHERE id_propietario = ?) AS garajes,
       COALESCE(SUM(CASE WHEN r.estado = 'pendiente' THEN 1 ELSE 0 END), 0) AS solicitudes_pendientes,
       COALESCE(SUM(CASE WHEN r.estado = 'confirmada' AND r.fecha_fin >= ? THEN 1 ELSE 0 END), 0) AS reservas_proximas,
       COALESCE(SUM(CASE WHEN r.estado = 'confirmada' AND r.fecha_fin < ? THEN r.costo_total ELSE 0 END), 0) AS ingresos_realizados,
       COALESCE(SUM(CASE WHEN r.estado = 'confirmada' AND r.fecha_fin >= ? THEN r.costo_total ELSE 0 END), 0) AS ingresos_proyectados
     FROM reserva r JOIN garaje g ON g.id_garaje = r.id_garaje WHERE g.id_propietario = ?`,
    [req.usuario.id_propietario, ahora, ahora, ahora, req.usuario.id_propietario],
  );
  res.json({ resumen: fila });
});

const sumarDias = (fecha, n) => new Date(Date.parse(`${fecha}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

// GET /api/propietario/estadisticas — ingresos por semana, rendimiento por garaje y tasa de aceptación
rutasPropietario.get('/estadisticas', async (req, res) => {
  const db = getDb();
  await expirarPendientes(db);
  const filas = await all(
    db,
    `SELECT r.estado, r.fecha_inicio, r.fecha_fin, r.costo_total, g.id_garaje, g.nombre
       FROM reserva r JOIN garaje g ON g.id_garaje = r.id_garaje WHERE g.id_propietario = ?`,
    [req.usuario.id_propietario],
  );
  const ahora = new Date().toISOString();
  const hoy = hoyBogota();
  const lunes = (fecha) => sumarDias(fecha, -(diaSemanaIso(fecha) - 1));
  const semanaActual = lunes(hoy);
  const NUM_SEMANAS = 8;
  const semanas = Array.from({ length: NUM_SEMANAS }, (_, i) => ({
    inicio: sumarDias(semanaActual, -7 * (NUM_SEMANAS - 1 - i)),
    ingresos: 0,
    proyectados: 0,
    reservas: 0,
  }));
  const porGaraje = new Map();
  const conteo = { pendiente: 0, confirmada: 0, rechazada: 0, cancelada: 0 };
  let ingresos = 0;
  let proyectados = 0;
  let horas = 0;

  for (const r of filas) {
    conteo[r.estado] += 1;
    if (r.estado !== 'confirmada') continue;
    const terminada = r.fecha_fin < ahora;
    const hrs = (Date.parse(r.fecha_fin) - Date.parse(r.fecha_inicio)) / 3600e3;
    const g = porGaraje.get(r.id_garaje) ?? { id_garaje: r.id_garaje, nombre: r.nombre, ingresos: 0, proyectados: 0, reservas: 0, horas: 0 };
    g.reservas += 1;
    if (terminada) {
      ingresos += r.costo_total;
      horas += hrs;
      g.ingresos += r.costo_total;
      g.horas += hrs;
    } else {
      proyectados += r.costo_total;
      g.proyectados += r.costo_total;
    }
    porGaraje.set(r.id_garaje, g);

    const semana = semanas.find((s) => s.inicio === lunes(aLocal(r.fecha_inicio).fecha));
    if (semana) {
      semana.reservas += 1;
      if (terminada) semana.ingresos += r.costo_total;
      else semana.proyectados += r.costo_total;
    }
  }
  const respondidas = conteo.confirmada + conteo.rechazada;
  const cal = await one(
    db,
    `SELECT ROUND(AVG(c.puntuacion), 1) AS promedio, COUNT(*) AS total
       FROM calificacion c JOIN garaje g ON g.id_garaje = c.id_garaje WHERE g.id_propietario = ?`,
    [req.usuario.id_propietario],
  );
  res.json({
    totales: {
      ingresos_realizados: ingresos,
      ingresos_proyectados: proyectados,
      horas_reservadas: Math.round(horas * 10) / 10,
      reservas_confirmadas: conteo.confirmada,
      tasa_aceptacion: respondidas ? Math.round((conteo.confirmada / respondidas) * 100) : null,
      calificacion_promedio: cal.promedio,
      total_calificaciones: cal.total,
    },
    estados: conteo,
    semanas,
    por_garaje: [...porGaraje.values()]
      .map((g) => ({ ...g, horas: Math.round(g.horas * 10) / 10 }))
      .sort((a, b) => b.ingresos + b.proyectados - (a.ingresos + a.proyectados)),
  });
});

// GET /api/propietario/garajes
rutasPropietario.get('/garajes', async (req, res) => {
  const db = getDb();
  await expirarPendientes(db);
  const garajes = await all(
    db,
    `SELECT g.*,
       (SELECT ROUND(AVG(c.puntuacion), 1) FROM calificacion c WHERE c.id_garaje = g.id_garaje) AS calificacion_promedio,
       (SELECT COUNT(*) FROM calificacion c WHERE c.id_garaje = g.id_garaje) AS total_calificaciones,
       (SELECT COUNT(*) FROM reserva r WHERE r.id_garaje = g.id_garaje AND r.estado = 'pendiente') AS solicitudes_pendientes,
       (SELECT f.archivo FROM garaje_foto f WHERE f.id_garaje = g.id_garaje ORDER BY f.orden, f.id_foto LIMIT 1) AS foto_principal
     FROM garaje g WHERE g.id_propietario = ? ORDER BY g.fecha_creacion DESC`,
    [req.usuario.id_propietario],
  );
  res.json({ garajes: garajes.map(({ foto_principal, ...g }) => ({ ...g, servicios: aLista(g.servicios), foto: urlDeImagen(foto_principal) })) });
});

// POST /api/propietario/garajes
rutasPropietario.post('/garajes', async (req, res) => {
  const { disponibilidad, ...g } = validar(esquemaGaraje, req.body);
  const id = await transaccion(async (tx) => {
    const r = await run(
      tx,
      `INSERT INTO garaje (id_propietario, nombre, direccion, barrio, localidad, latitud, longitud,
                           tarifa_hora, capacidad_total, tipo_vehiculo, descripcion, instrucciones_acceso, servicios)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.usuario.id_propietario, g.nombre, g.direccion, g.barrio, g.localidad, g.latitud, g.longitud,
        g.tarifa_hora, g.capacidad_total, g.tipo_vehiculo, g.descripcion, g.instrucciones_acceso, aTexto(g.servicios),
      ],
    );
    const idGaraje = Number(r.lastInsertRowid);
    await guardarVentanas(tx, idGaraje, disponibilidad);
    return idGaraje;
  });
  res.status(201).json({ garaje: await detalleGaraje(getDb(), id) });
});

// GET /api/propietario/garajes/:id
rutasPropietario.get('/garajes/:id', async (req, res) => {
  const { id_garaje } = await garajeDelPropietario(req);
  res.json({ garaje: await detalleGaraje(getDb(), id_garaje) });
});

// PUT /api/propietario/garajes/:id
rutasPropietario.put('/garajes/:id', async (req, res) => {
  const actual = await garajeDelPropietario(req);
  const { disponibilidad, ...g } = validar(esquemaGaraje, req.body);
  await transaccion(async (tx) => {
    await run(
      tx,
      `UPDATE garaje SET nombre = ?, direccion = ?, barrio = ?, localidad = ?, latitud = ?, longitud = ?,
              tarifa_hora = ?, capacidad_total = ?, tipo_vehiculo = ?, descripcion = ?, instrucciones_acceso = ?,
              servicios = ?
        WHERE id_garaje = ?`,
      [
        g.nombre, g.direccion, g.barrio, g.localidad, g.latitud, g.longitud,
        g.tarifa_hora, g.capacidad_total, g.tipo_vehiculo, g.descripcion, g.instrucciones_acceso, aTexto(g.servicios),
        actual.id_garaje,
      ],
    );
    await guardarVentanas(tx, actual.id_garaje, disponibilidad);
  });
  res.json({ garaje: await detalleGaraje(getDb(), actual.id_garaje) });
});

// POST /api/propietario/garajes/:id/fotos — sube una foto (máximo 6 por garaje)
rutasPropietario.post('/garajes/:id/fotos', async (req, res) => {
  const actual = await garajeDelPropietario(req);
  const { imagen } = validar(z.object({ imagen: z.string().max(8_000_000) }), req.body);
  const { n } = await one(getDb(), 'SELECT COUNT(*) AS n FROM garaje_foto WHERE id_garaje = ?', [actual.id_garaje]);
  if (n >= MAX_FOTOS) throw conflicto(`Un garaje admite hasta ${MAX_FOTOS} fotos. Borra alguna para subir otra.`);
  const archivo = await guardarImagen(imagen, 'garaje');
  await run(
    getDb(),
    'INSERT INTO garaje_foto (id_garaje, archivo, orden) VALUES (?, ?, (SELECT COALESCE(MAX(orden), -1) + 1 FROM garaje_foto WHERE id_garaje = ?))',
    [actual.id_garaje, archivo, actual.id_garaje],
  );
  res.status(201).json({ fotos: await fotosDe(getDb(), actual.id_garaje) });
});

async function fotoDelGaraje(req, actual) {
  const idFoto = idDeParametro(req.params.idFoto);
  const f = await one(getDb(), 'SELECT * FROM garaje_foto WHERE id_foto = ? AND id_garaje = ?', [idFoto, actual.id_garaje]);
  if (!f) throw noEncontrado('Foto');
  return f;
}

// DELETE /api/propietario/garajes/:id/fotos/:idFoto
rutasPropietario.delete('/garajes/:id/fotos/:idFoto', async (req, res) => {
  const actual = await garajeDelPropietario(req);
  const f = await fotoDelGaraje(req, actual);
  await run(getDb(), 'DELETE FROM garaje_foto WHERE id_foto = ?', [f.id_foto]);
  await borrarImagen(f.archivo);
  res.json({ fotos: await fotosDe(getDb(), actual.id_garaje) });
});

// POST /api/propietario/garajes/:id/fotos/:idFoto/principal — la deja como primera
rutasPropietario.post('/garajes/:id/fotos/:idFoto/principal', async (req, res) => {
  const actual = await garajeDelPropietario(req);
  const f = await fotoDelGaraje(req, actual);
  await run(
    getDb(),
    'UPDATE garaje_foto SET orden = (SELECT COALESCE(MIN(orden), 0) - 1 FROM garaje_foto WHERE id_garaje = ?) WHERE id_foto = ?',
    [actual.id_garaje, f.id_foto],
  );
  res.json({ fotos: await fotosDe(getDb(), actual.id_garaje) });
});

// PATCH /api/propietario/garajes/:id/estado — publicar o pausar (las reservas ya hechas se respetan)
rutasPropietario.patch('/garajes/:id/estado', async (req, res) => {
  const actual = await garajeDelPropietario(req);
  const { estado } = validar(z.object({ estado: z.enum(['activo', 'inactivo']) }), req.body);
  if (actual.estado === 'suspendido') {
    throw prohibido('Este garaje fue suspendido por un administrador. Contáctanos para revisarlo.');
  }
  await run(getDb(), 'UPDATE garaje SET estado = ? WHERE id_garaje = ?', [estado, actual.id_garaje]);
  res.json({ garaje: await detalleGaraje(getDb(), actual.id_garaje) });
});

// GET /api/propietario/reservas?estado=pendiente|confirmada|...
rutasPropietario.get('/reservas', async (req, res) => {
  const { estado } = validar(
    z.object({ estado: z.enum(['pendiente', 'confirmada', 'rechazada', 'cancelada']).optional() }),
    req.query,
  );
  const db = getDb();
  await expirarPendientes(db);
  const filas = await listarReservas(
    db,
    `g.id_propietario = ?${estado ? ' AND r.estado = ?' : ''}`,
    estado ? [req.usuario.id_propietario, estado] : [req.usuario.id_propietario],
  );
  res.json({ reservas: filas.map((r) => formatoReserva(r, 'propietario')) });
});

// ---- Días bloqueados: vacaciones, arreglos… (el garaje no recibe reservas ese día) ----

const MAX_DIAS_BLOQUEO = 365;

// GET /api/propietario/garajes/:id/bloqueos — los de hoy en adelante
rutasPropietario.get('/garajes/:id/bloqueos', async (req, res) => {
  const actual = await garajeDelPropietario(req);
  const bloqueos = await all(
    getDb(),
    'SELECT fecha, motivo FROM bloqueo WHERE id_garaje = ? AND fecha >= ? ORDER BY fecha',
    [actual.id_garaje, hoyBogota()],
  );
  res.json({ bloqueos });
});

// POST /api/propietario/garajes/:id/bloqueos — bloquea un día (no se puede si ya hay reservas ese día)
rutasPropietario.post('/garajes/:id/bloqueos', async (req, res) => {
  const actual = await garajeDelPropietario(req);
  const d = validar(z.object({ fecha: z.string(), motivo: z.string().trim().max(80).optional() }), req.body);
  if (!esFechaValida(d.fecha)) throw new HttpError(400, 'fecha: usa el formato AAAA-MM-DD.');
  const hoy = hoyBogota();
  if (d.fecha < hoy) throw new HttpError(400, 'No puedes bloquear un día que ya pasó.');
  const limite = new Date(Date.parse(`${hoy}T00:00:00Z`) + MAX_DIAS_BLOQUEO * 86400e3).toISOString().slice(0, 10);
  if (d.fecha > limite) throw new HttpError(400, `Solo puedes bloquear días dentro del próximo año.`);

  await transaccion(async (tx) => {
    // Con reservas vivas ese día no se bloquea: primero hay que responderlas o cancelarlas.
    const vivas = await one(
      tx,
      `SELECT COUNT(*) AS n FROM reserva
        WHERE id_garaje = ? AND estado IN ('pendiente', 'confirmada') AND fecha_inicio < ? AND fecha_fin > ?`,
      [actual.id_garaje, aUtc(d.fecha, '24:00'), aUtc(d.fecha, '00:00')],
    );
    if (vivas.n > 0) {
      throw conflicto(`Ese día ya tiene ${vivas.n} reserva${vivas.n === 1 ? '' : 's'} (pendientes o confirmadas). Cancélalas o respóndelas antes de bloquearlo.`);
    }
    await run(tx, 'INSERT INTO bloqueo (id_garaje, fecha, motivo) VALUES (?, ?, ?) ON CONFLICT (id_garaje, fecha) DO UPDATE SET motivo = EXCLUDED.motivo', [
      actual.id_garaje,
      d.fecha,
      d.motivo || null,
    ]);
  });
  res.status(201).json({ ok: true });
});

// DELETE /api/propietario/garajes/:id/bloqueos/:fecha
rutasPropietario.delete('/garajes/:id/bloqueos/:fecha', async (req, res) => {
  const actual = await garajeDelPropietario(req);
  if (!esFechaValida(req.params.fecha)) throw new HttpError(400, 'fecha: usa el formato AAAA-MM-DD.');
  const r = await run(getDb(), 'DELETE FROM bloqueo WHERE id_garaje = ? AND fecha = ?', [actual.id_garaje, req.params.fecha]);
  if (!r.rowsAffected) throw noEncontrado('Bloqueo');
  res.json({ ok: true });
});

// ---- Opiniones: el propietario responde en público a las calificaciones de sus garajes ----

// GET /api/propietario/opiniones — las de todos sus garajes, las sin responder primero
rutasPropietario.get('/opiniones', async (req, res) => {
  const filas = await all(
    getDb(),
    `SELECT c.id_calificacion, c.puntuacion, c.comentario, c.fecha_calificacion, c.respuesta, c.respuesta_fecha,
            g.id_garaje, g.nombre AS garaje, u.nombre, u.apellido
       FROM calificacion c
       JOIN garaje g ON g.id_garaje = c.id_garaje
       JOIN usuario u ON u.id_usuario = c.id_usuario
      WHERE g.id_propietario = ?
      ORDER BY (c.respuesta IS NULL) DESC, c.fecha_calificacion DESC LIMIT 100`,
    [req.usuario.id_propietario],
  );
  res.json({
    sin_responder: filas.filter((f) => !f.respuesta).length,
    opiniones: filas.map((f) => ({
      id_calificacion: f.id_calificacion,
      garaje: { id_garaje: f.id_garaje, nombre: f.garaje },
      puntuacion: f.puntuacion,
      comentario: f.comentario,
      fecha: f.fecha_calificacion,
      autor: `${f.nombre} ${f.apellido.charAt(0)}.`,
      respuesta: f.respuesta ? { texto: f.respuesta, fecha: f.respuesta_fecha } : null,
    })),
  });
});

async function opinionDelPropietario(req) {
  const id = idDeParametro(req.params.id);
  const o = await one(
    getDb(),
    `SELECT c.*, g.nombre AS g_nombre FROM calificacion c JOIN garaje g ON g.id_garaje = c.id_garaje
      WHERE c.id_calificacion = ? AND g.id_propietario = ?`,
    [id, req.usuario.id_propietario],
  );
  if (!o) throw noEncontrado('Opinión');
  return o;
}

// PUT /api/propietario/opiniones/:id/respuesta — responde (o corrige la respuesta) y avisa a quien calificó
rutasPropietario.put('/opiniones/:id/respuesta', async (req, res) => {
  const o = await opinionDelPropietario(req);
  const { texto } = validar(z.object({ texto: z.string().trim().min(2, 'Escribe una respuesta.').max(300, 'Máximo 300 caracteres.') }), req.body);
  await transaccion(async (tx) => {
    await run(tx, 'UPDATE calificacion SET respuesta = ?, respuesta_fecha = ? WHERE id_calificacion = ?', [
      texto,
      new Date().toISOString(),
      o.id_calificacion,
    ]);
    if (!o.respuesta) {
      await notificar(tx, o.id_usuario, 'opinion_respondida', `El propietario respondió tu opinión sobre "${o.g_nombre}".`, o.id_reserva);
    }
  });
  res.json({ respuesta: { texto, fecha: (await one(getDb(), 'SELECT respuesta_fecha FROM calificacion WHERE id_calificacion = ?', [o.id_calificacion])).respuesta_fecha } });
});

// DELETE /api/propietario/opiniones/:id/respuesta
rutasPropietario.delete('/opiniones/:id/respuesta', async (req, res) => {
  const o = await opinionDelPropietario(req);
  await run(getDb(), 'UPDATE calificacion SET respuesta = NULL, respuesta_fecha = NULL WHERE id_calificacion = ?', [o.id_calificacion]);
  res.json({ ok: true });
});
