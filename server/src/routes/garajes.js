import { Router } from 'express';
import { z } from 'zod';
import { getDb, all, one, run } from '../db.js';
import { autenticacionOpcional, requiereSesion } from '../lib/auth.js';
import {
  distanciaKm,
  expirarPendientes,
  maxConcurrencia,
  reservasQueOcupan,
  tramosLlenos,
  ventanaCubre,
  ventanasDe,
} from '../lib/disponibilidad.js';
import { HttpError, conflicto, idDeParametro, noEncontrado, prohibido, validar } from '../lib/http.js';
import { urlDeImagen } from '../lib/imagenes.js';
import { SERVICIOS, aLista } from '../lib/servicios.js';
import { bloqueadosEn } from '../lib/bloqueos.js';
import {
  HORA_RE,
  aUtc,
  diaSemanaIso,
  esFechaValida,
  hoyBogota,
  horaDesdeMinutos,
  minutos,
} from '../lib/tiempo.js';

export const rutasGarajes = Router();

const quitarTildes = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const SELECT_GARAJE = `
  SELECT g.*, u.nombre AS prop_nombre, u.apellido AS prop_apellido, u.telefono AS prop_telefono,
         u.id_usuario AS prop_id_usuario, u.foto AS prop_foto,
    (SELECT f.archivo FROM garaje_foto f WHERE f.id_garaje = g.id_garaje ORDER BY f.orden, f.id_foto LIMIT 1) AS foto_principal,
    (SELECT ROUND(AVG(c.puntuacion), 1) FROM calificacion c WHERE c.id_garaje = g.id_garaje) AS calificacion_promedio,
    (SELECT COUNT(*) FROM calificacion c WHERE c.id_garaje = g.id_garaje) AS total_calificaciones
  FROM garaje g
  JOIN propietario p ON p.id_propietario = g.id_propietario
  JOIN usuario u ON u.id_usuario = p.id_usuario`;

/** Forma pública de un garaje (sin datos privados: instrucciones de acceso y teléfono). */
export function garajePublico(g) {
  return {
    id_garaje: g.id_garaje,
    nombre: g.nombre,
    direccion: g.direccion,
    barrio: g.barrio,
    localidad: g.localidad,
    latitud: g.latitud,
    longitud: g.longitud,
    tarifa_hora: g.tarifa_hora,
    capacidad_total: g.capacidad_total,
    tipo_vehiculo: g.tipo_vehiculo,
    descripcion: g.descripcion,
    estado: g.estado,
    calificacion_promedio: g.calificacion_promedio,
    total_calificaciones: g.total_calificaciones,
    propietario: `${g.prop_nombre} ${g.prop_apellido.charAt(0)}.`,
    propietario_foto: urlDeImagen(g.prop_foto),
    foto: urlDeImagen(g.foto_principal),
    servicios: aLista(g.servicios),
  };
}

const horaOpcional = z.string().regex(HORA_RE, 'Hora inválida (usa HH:MM).');

const esquemaBusqueda = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radio_km: z.coerce.number().min(0.2).max(50).default(5),
  q: z.string().trim().max(80).optional(),
  fecha: z.string().optional(),
  desde: horaOpcional.optional(),
  hasta: horaOpcional.optional(),
  vehiculo: z.enum(['carro', 'moto']).optional(),
  precio_max: z.coerce.number().int().positive().optional(),
  // Lista separada por comas: el garaje debe ofrecer TODOS los servicios pedidos.
  servicios: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (v === undefined ? [] : (Array.isArray(v) ? v.join(',') : v).split(',').map((s) => s.trim()).filter(Boolean)))
    .refine((l) => l.every((s) => SERVICIOS.includes(s)), 'Servicio desconocido.'),
  orden: z.enum(['distancia', 'precio', 'calificacion']).optional(),
});

function validarRangoHorario(fecha, desde, hasta) {
  if (!esFechaValida(fecha)) throw new HttpError(400, 'fecha: usa el formato AAAA-MM-DD.');
  if (fecha < hoyBogota()) throw new HttpError(400, 'La fecha no puede estar en el pasado.');
  if (desde && hasta) {
    if (minutos(desde) >= minutos(hasta)) throw new HttpError(400, 'La hora de salida debe ser posterior a la de entrada.');
    if (Date.parse(aUtc(fecha, desde)) <= Date.now()) throw new HttpError(400, 'La hora de entrada ya pasó.');
  }
}

/** Valida los filtros de búsqueda (los mismos que usa la pantalla y el asistente). */
export function validarFiltros(entrada) {
  const f = validar(esquemaBusqueda, entrada);
  if ((f.lat === undefined) !== (f.lng === undefined)) throw new HttpError(400, 'Envía lat y lng juntas.');
  if ((f.desde || f.hasta) && !(f.desde && f.hasta && f.fecha)) {
    throw new HttpError(400, 'Para filtrar por horario indica fecha, hora de entrada y hora de salida.');
  }
  if (f.fecha) validarRangoHorario(f.fecha, f.desde, f.hasta);
  return f;
}

// GET /api/garajes  — búsqueda pública con filtros
rutasGarajes.get('/', async (req, res) => {
  res.json(await buscarGarajes(validarFiltros(req.query)));
});

export async function buscarGarajes(f) {
  const db = getDb();
  await expirarPendientes(db);

  const condiciones = ["g.estado = 'activo'", "u.estado = 'activo'"];
  const args = [];
  if (f.vehiculo) {
    condiciones.push("g.tipo_vehiculo IN (?, 'ambos')");
    args.push(f.vehiculo);
  }
  if (f.precio_max) {
    condiciones.push('g.tarifa_hora <= ?');
    args.push(f.precio_max);
  }
  let filas = await all(db, `${SELECT_GARAJE} WHERE ${condiciones.join(' AND ')}`, args);

  if (f.servicios?.length) filas = filas.filter((g) => f.servicios.every((s) => aLista(g.servicios).includes(s)));

  if (f.q) {
    const buscado = quitarTildes(f.q);
    filas = filas.filter((g) =>
      quitarTildes([g.nombre, g.direccion, g.barrio, g.localidad].filter(Boolean).join(' ')).includes(buscado),
    );
  }

  const conCoordenadas = f.lat !== undefined;
  if (conCoordenadas) {
    for (const g of filas) g.distancia_km = distanciaKm(f.lat, f.lng, g.latitud, g.longitud);
    filas = filas.filter((g) => g.distancia_km <= f.radio_km);
  }

  if (f.fecha) {
    const bloqueados = await bloqueadosEn(db, filas.map((g) => g.id_garaje), f.fecha);
    filas = filas.filter((g) => !bloqueados.has(g.id_garaje));
    const ids = filas.map((g) => g.id_garaje);
    const ventanas = await ventanasDe(db, ids);
    const dia = diaSemanaIso(f.fecha);
    const hIni = f.desde ?? '00:00';
    const hFin = f.hasta ?? '24:00';
    const ini = aUtc(f.fecha, hIni);
    const fin = aUtc(f.fecha, hFin);
    const ocupadas = f.desde ? await reservasQueOcupan(db, ids, ini, fin) : new Map();
    const horas = f.desde ? (minutos(f.hasta) - minutos(f.desde)) / 60 : null;

    filas = filas.filter((g) => {
      const vs = ventanas.get(g.id_garaje) ?? [];
      if (f.desde) {
        if (!ventanaCubre(vs, dia, hIni, hFin)) return false;
        const usados = maxConcurrencia(ocupadas.get(g.id_garaje) ?? [], ini, fin);
        if (usados >= g.capacidad_total) return false;
        g.cupos_libres = g.capacidad_total - usados;
        g.costo_estimado = Math.round(g.tarifa_hora * horas);
        return true;
      }
      return vs.some((v) => v.dia_semana === dia && v.estado === 'disponible');
    });
  }

  const orden = f.orden ?? (conCoordenadas ? 'distancia' : 'precio');
  const comparar = {
    distancia: (a, b) => (a.distancia_km ?? 0) - (b.distancia_km ?? 0),
    precio: (a, b) => a.tarifa_hora - b.tarifa_hora,
    calificacion: (a, b) => (b.calificacion_promedio ?? 0) - (a.calificacion_promedio ?? 0),
  }[orden];
  filas.sort(comparar);

  return {
    garajes: filas.slice(0, 100).map((g) => ({
      ...garajePublico(g),
      ...(g.distancia_km !== undefined && { distancia_km: Math.round(g.distancia_km * 10) / 10 }),
      ...(g.cupos_libres !== undefined && { cupos_libres: g.cupos_libres, costo_estimado: g.costo_estimado }),
    })),
    total: filas.length,
  };
}

// GET /api/garajes/:id
rutasGarajes.get('/:id', autenticacionOpcional, async (req, res) => {
  const id = idDeParametro(req.params.id);
  const db = getDb();
  const g = await one(db, `${SELECT_GARAJE} WHERE g.id_garaje = ?`, [id]);
  if (!g) throw noEncontrado('Garaje');

  const u = req.usuario;
  const esDueno = u && g.prop_id_usuario === u.id_usuario;
  const esAdmin = u?.tipo_usuario === 'admin';
  if (g.estado !== 'activo' && !esDueno && !esAdmin) throw noEncontrado('Garaje');

  let verPrivado = Boolean(esDueno || esAdmin);
  if (u && !verPrivado) {
    verPrivado = Boolean(
      await one(db, "SELECT 1 AS x FROM reserva WHERE id_garaje = ? AND id_usuario = ? AND estado = 'confirmada' LIMIT 1", [
        id,
        u.id_usuario,
      ]),
    );
  }

  const ventanas = (await ventanasDe(db, [id])).get(id) ?? [];
  const calificaciones = await all(
    db,
    `SELECT c.id_calificacion, c.puntuacion, c.comentario, c.fecha_calificacion, c.respuesta, c.respuesta_fecha, u.nombre, u.apellido
       FROM calificacion c JOIN usuario u ON u.id_usuario = c.id_usuario
      WHERE c.id_garaje = ? ORDER BY c.fecha_calificacion DESC LIMIT 10`,
    [id],
  );

  const fotos = (await all(db, 'SELECT id_foto, archivo FROM garaje_foto WHERE id_garaje = ? ORDER BY orden, id_foto', [id])).map(
    (f) => ({ id_foto: f.id_foto, url: urlDeImagen(f.archivo) }),
  );

  res.json({
    garaje: {
      ...garajePublico(g),
      fotos,
      ...(verPrivado && { instrucciones_acceso: g.instrucciones_acceso, telefono_propietario: g.prop_telefono }),
      acceso_privado_visible: verPrivado,
    },
    disponibilidad: ventanas.filter((v) => v.estado === 'disponible'),
    calificaciones: calificaciones.map((c) => ({
      id_calificacion: c.id_calificacion,
      puntuacion: c.puntuacion,
      comentario: c.comentario,
      fecha: c.fecha_calificacion,
      respuesta: c.respuesta ? { texto: c.respuesta, fecha: c.respuesta_fecha } : null,
      autor: `${c.nombre} ${c.apellido.charAt(0)}.`,
    })),
  });
});

// POST /api/garajes/:id/reportar — cualquier usuario con sesión avisa de un problema con la publicación
const MOTIVOS_REPORTE = ['informacion_falsa', 'no_existe', 'inseguro', 'cobro', 'otro'];
rutasGarajes.post('/:id/reportar', requiereSesion, async (req, res) => {
  const id = idDeParametro(req.params.id);
  const d = validar(
    z.object({ motivo: z.enum(MOTIVOS_REPORTE), detalle: z.string().trim().max(300, 'Máximo 300 caracteres.').optional() }),
    req.body,
  );
  const db = getDb();
  const g = await one(db, 'SELECT g.id_garaje, p.id_usuario AS dueno FROM garaje g JOIN propietario p ON p.id_propietario = g.id_propietario WHERE g.id_garaje = ?', [id]);
  if (!g) throw noEncontrado('Garaje');
  if (g.dueno === req.usuario.id_usuario) throw prohibido('No puedes reportar tu propio garaje.');
  if (d.motivo === 'otro' && !d.detalle) throw new HttpError(400, 'detalle: cuéntanos qué pasa.');
  if (await one(db, "SELECT 1 AS x FROM reporte WHERE id_garaje = ? AND id_usuario = ? AND estado = 'abierto'", [id, req.usuario.id_usuario])) {
    throw conflicto('Ya reportaste este garaje y lo estamos revisando.');
  }
  await run(db, 'INSERT INTO reporte (id_garaje, id_usuario, motivo, detalle) VALUES (?, ?, ?, ?)', [id, req.usuario.id_usuario, d.motivo, d.detalle || null]);
  res.status(201).json({ ok: true });
});

// GET /api/garajes/:id/ocupacion?fecha=AAAA-MM-DD — qué horas ofrece y cuáles ya están llenas ese día
rutasGarajes.get('/:id/ocupacion', async (req, res) => {
  const id = idDeParametro(req.params.id);
  const { fecha } = validar(z.object({ fecha: z.string() }), req.query);
  if (!esFechaValida(fecha)) throw new HttpError(400, 'fecha: usa el formato AAAA-MM-DD.');

  const db = getDb();
  const g = await one(db, "SELECT id_garaje, capacidad_total FROM garaje WHERE id_garaje = ? AND estado = 'activo'", [id]);
  if (!g) throw noEncontrado('Garaje');
  await expirarPendientes(db);

  const dia = diaSemanaIso(fecha);
  const bloqueo = await one(db, 'SELECT motivo FROM bloqueo WHERE id_garaje = ? AND fecha = ?', [id, fecha]);
  const ventanas = bloqueo
    ? [] // el propietario no recibe reservas ese día
    : ((await ventanasDe(db, [id])).get(id) ?? []).filter((v) => v.dia_semana === dia && v.estado === 'disponible');
  const inicioDia = aUtc(fecha, '00:00');
  const finDia = aUtc(fecha, '24:00');
  const ocupadas = (await reservasQueOcupan(db, [id], inicioDia, finDia)).get(id) ?? [];
  const base = Date.parse(inicioDia);
  const aHora = (ms) => (ms - base >= 24 * 3600e3 ? '24:00' : horaDesdeMinutos(Math.round((ms - base) / 60000)));
  const llenos = tramosLlenos(ocupadas, g.capacidad_total)
    .map(([a, b]) => ({ hora_inicio: aHora(Math.max(a, base)), hora_fin: aHora(Math.min(b, base + 24 * 3600e3)) }))
    .filter((t) => t.hora_inicio < t.hora_fin);

  res.json({
    fecha,
    dia_semana: dia,
    bloqueado: Boolean(bloqueo),
    motivo_bloqueo: bloqueo?.motivo ?? null,
    ventanas: ventanas.map((v) => ({ hora_inicio: v.hora_inicio, hora_fin: v.hora_fin })),
    llenos,
    capacidad_total: g.capacidad_total,
  });
});
