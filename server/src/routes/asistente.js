import { Router } from 'express';
import { z } from 'zod';
import { all, getDb } from '../db.js';
import { autenticacionOpcional } from '../lib/auth.js';
import { PREGUNTAS, SUGERENCIAS, entender } from '../lib/asistente.js';
import { HttpError, validar } from '../lib/http.js';
import { formatoReserva, listarReservas } from '../lib/reservas.js';
import { SERVICIOS } from '../lib/servicios.js';
import { aUtc, hoyBogota } from '../lib/tiempo.js';
import { buscarGarajes, validarFiltros } from './garajes.js';

export const rutasAsistente = Router();
rutasAsistente.use(autenticacionOpcional);

const plata = (n) => `$${Number(n).toLocaleString('es-CO')}`;
const fechaLarga = (f) =>
  new Date(`${f}T12:00:00Z`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const NOMBRE_VEHICULO = { moto: 'moto', carro: 'carro' };
const ETIQUETA_SERVICIO = {
  cubierto: 'techo',
  vigilancia: 'vigilancia',
  camaras: 'cámaras',
  porton_electrico: 'portón eléctrico',
  techo_alto: 'techo alto',
  cargador_ev: 'cargador eléctrico',
  abierto_24h: 'acceso 24 horas',
};

const esquema = z.object({
  mensaje: z.string().trim().min(1, 'Escribe tu mensaje.').max(300, 'Máximo 300 caracteres.'),
  contexto: z.record(z.string(), z.unknown()).optional(),
  ubicacion: z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }).optional(),
});

// Filtros que el cliente pudo haber devuelto como contexto: solo se aceptan los conocidos y con tipo correcto.
function contextoSeguro(c = {}) {
  const r = {};
  if (['carro', 'moto'].includes(c.vehiculo)) r.vehiculo = c.vehiculo;
  if (typeof c.fecha === 'string') r.fecha = c.fecha;
  if (typeof c.desde === 'string' && typeof c.hasta === 'string') {
    r.desde = c.desde;
    r.hasta = c.hasta;
  }
  if (Number.isInteger(c.precio_max)) r.precio_max = c.precio_max;
  if (typeof c.q === 'string') r.q = c.q.slice(0, 60);
  if (['precio', 'calificacion', 'distancia'].includes(c.orden)) r.orden = c.orden;
  if (c.cerca_de_mi === true) r.cerca_de_mi = true;
  if (Array.isArray(c.servicios)) {
    const s = c.servicios.filter((x) => SERVICIOS.includes(x));
    if (s.length) r.servicios = s;
  }
  return r;
}

function tarjeta(g) {
  return {
    id_garaje: g.id_garaje,
    nombre: g.nombre,
    barrio: g.barrio,
    localidad: g.localidad,
    tarifa_hora: g.tarifa_hora,
    costo_estimado: g.costo_estimado ?? null,
    calificacion_promedio: g.calificacion_promedio,
    total_calificaciones: g.total_calificaciones,
    foto: g.foto,
    distancia_km: g.distancia_km ?? null,
    tipo_vehiculo: g.tipo_vehiculo,
  };
}

function describir(f) {
  const partes = [];
  if (f.vehiculo) partes.push(`para ${NOMBRE_VEHICULO[f.vehiculo]}`);
  if (f.q) partes.push(`en ${f.q}`);
  if (f.cerca_de_mi) partes.push('cerca de ti');
  if (f.fecha) partes.push(`el ${fechaLarga(f.fecha)}`);
  if (f.desde) partes.push(`de ${f.desde} a ${f.hasta}`);
  if (f.precio_max) partes.push(`hasta ${plata(f.precio_max)} por hora`);
  if (f.servicios?.length) partes.push(`con ${f.servicios.map((s) => ETIQUETA_SERVICIO[s]).join(' y ')}`);
  return partes.join(' ');
}

function enlaceBusqueda(f, ubicacion) {
  const p = new URLSearchParams();
  if (f.q) p.set('donde', f.q);
  if (f.cerca_de_mi && ubicacion) {
    p.set('lat', String(ubicacion.lat));
    p.set('lng', String(ubicacion.lng));
  }
  for (const k of ['fecha', 'desde', 'hasta', 'vehiculo', 'precio_max', 'orden']) if (f[k] !== undefined) p.set(k, String(f[k]));
  if (f.servicios?.length) p.set('servicios', f.servicios.join(','));
  const s = p.toString();
  return s ? `/?${s}` : '/';
}

function enlaceGaraje(id, f) {
  const p = new URLSearchParams();
  for (const k of ['fecha', 'desde', 'hasta', 'vehiculo']) if (f[k] !== undefined) p.set(k, String(f[k]));
  const s = p.toString();
  return `/garaje/${id}${s ? `?${s}` : ''}`;
}

async function misReservas(usuario) {
  const db = getDb();
  const filas = await listarReservas(db, 'r.id_usuario = ?', [usuario.id_usuario]);
  const vivas = filas
    .map((r) => formatoReserva(r, 'conductor'))
    .filter((r) => (r.estado === 'pendiente' || r.estado === 'confirmada') && r.fecha_fin > new Date().toISOString())
    .sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio));
  if (!vivas.length) {
    return { respuesta: 'No tienes reservas próximas. Si quieres, te ayudo a buscar un parqueadero: dime destino, día y hora.', reservas: [] };
  }
  const items = vivas.slice(0, 4).map((r) => ({
    id_reserva: r.id_reserva,
    garaje: r.garaje.nombre,
    fecha: r.fecha,
    hora_inicio: r.hora_inicio,
    hora_fin: r.hora_fin,
    estado: r.estado,
  }));
  const prox = items[0];
  return {
    respuesta: `Tienes ${vivas.length} reserva${vivas.length === 1 ? '' : 's'} próxima${vivas.length === 1 ? '' : 's'}. La más cercana: «${prox.garaje}» el ${fechaLarga(prox.fecha)} de ${prox.hora_inicio} a ${prox.hora_fin} (${prox.estado}).`,
    reservas: items,
  };
}

rutasAsistente.post('/', async (req, res) => {
  const d = validar(esquema, req.body);
  const db = getDb();
  const vocabulario = [
    ...new Set(
      (await all(db, "SELECT barrio AS v FROM garaje WHERE estado = 'activo' AND barrio IS NOT NULL UNION SELECT localidad FROM garaje WHERE estado = 'activo' AND localidad IS NOT NULL")).map((f) => f.v),
    ),
  ];
  const contexto = contextoSeguro(d.contexto);
  const e = await entender(d.mensaje, { contexto, vocabulario });
  const usuario = req.usuario;
  const base = { motor: e.motor, sugerencias: SUGERENCIAS };

  if (e.intencion === 'saludo') {
    return res.json({
      ...base,
      respuesta: `¡Hola${usuario ? `, ${usuario.nombre}` : ''}! Soy el asistente de ParkSpotter. Puedo buscarte parqueadero (dime destino, día y hora), mostrarte tus reservas y resolver dudas sobre pagos, cancelaciones o cómo publicar tu garaje.`,
      contexto,
    });
  }
  if (e.intencion === 'faq') {
    return res.json({ ...base, respuesta: e.respuestaLibre ?? e.faq ?? PREGUNTAS[PREGUNTAS.length - 1].texto, contexto });
  }
  if (e.intencion === 'otro') {
    return res.json({
      ...base,
      respuesta:
        e.respuestaLibre ??
        'No estoy seguro de haberte entendido. Puedo buscar parqueadero (por ejemplo «moto en Chapinero mañana de 8 a 12»), mostrarte tus reservas o responder dudas sobre ParkSpotter.',
      contexto,
    });
  }
  if (e.intencion === 'mis_reservas') {
    if (!usuario) return res.json({ ...base, respuesta: 'Para ver tus reservas necesitas iniciar sesión.', accion: { tipo: 'login' }, contexto });
    return res.json({ ...base, ...(await misReservas(usuario)), contexto });
  }

  // ---- Buscar parqueadero ----
  const f = { ...e.filtros };
  const notas = [];
  if (f.cerca_de_mi && !d.ubicacion) {
    return res.json({
      ...base,
      respuesta: 'Para buscar cerca de ti necesito tu ubicación. Toca «Usar mi ubicación» y te muestro lo más cercano.',
      pedirUbicacion: true,
      contexto: f,
    });
  }
  if (f.desde && !f.fecha) {
    const hoy = hoyBogota();
    f.fecha = Date.parse(aUtc(hoy, f.desde)) > Date.now() ? hoy : new Date(Date.parse(`${hoy}T00:00:00Z`) + 86400e3).toISOString().slice(0, 10);
    notas.push(`Como no dijiste el día, usé ${f.fecha === hoy ? 'hoy' : 'mañana'}.`);
  }
  if (e.duracionSupuesta) notas.push('Supuse 2 horas de estadía; dime si necesitas otro tiempo.');

  const consulta = { ...f };
  delete consulta.cerca_de_mi;
  if (f.cerca_de_mi && d.ubicacion) {
    consulta.lat = d.ubicacion.lat;
    consulta.lng = d.ubicacion.lng;
    consulta.radio_km = 3;
  }
  let resultado;
  try {
    resultado = await buscarGarajes(validarFiltros(consulta));
    if (!resultado.total && consulta.q) {
      const sinLugar = { ...consulta };
      delete sinLugar.q;
      const otro = await buscarGarajes(validarFiltros(sinLugar));
      if (otro.total) {
        notas.push(`No encontré garajes en «${consulta.q}»; te muestro otras opciones.`);
        resultado = otro;
        delete f.q;
      }
    }
  } catch (err) {
    if (err instanceof HttpError && err.status === 400) {
      return res.json({ ...base, respuesta: `No pude buscar con eso: ${err.message.replace(/^[a-z_]+: /, '')}`, contexto: contextoSeguro(contexto) });
    }
    throw err;
  }

  const descripcion = describir(f);
  if (!resultado.total) {
    let sugerencia = 'Prueba con otro horario o día';
    if (f.precio_max) {
      const sinPrecio = { ...consulta };
      delete sinPrecio.precio_max;
      const caro = await buscarGarajes(validarFiltros(sinPrecio));
      if (caro.total) {
        const min = Math.min(...caro.garajes.map((g) => g.tarifa_hora));
        sugerencia = `Hay ${caro.total} opción${caro.total === 1 ? '' : 'es'} sin límite de precio; la más económica cuesta ${plata(min)} por hora`;
      }
    }
    return res.json({
      ...base,
      respuesta: `No encontré garajes disponibles ${descripcion}. ${sugerencia}.`,
      garajes: [],
      total: 0,
      enlace: enlaceBusqueda(f, d.ubicacion),
      contexto: f,
    });
  }

  const top = resultado.garajes.slice(0, 4);
  const mejor = top[0];
  const detalleMejor = mejor.costo_estimado
    ? `«${mejor.nombre}» (${mejor.barrio ?? mejor.localidad ?? 'Bogotá'}) a ${plata(mejor.tarifa_hora)}/h, ${plata(mejor.costo_estimado)} en total`
    : `«${mejor.nombre}» (${mejor.barrio ?? mejor.localidad ?? 'Bogotá'}) a ${plata(mejor.tarifa_hora)} por hora`;
  const orden = f.orden === 'calificacion' ? 'mejor calificado' : f.orden === 'distancia' ? 'más cercano' : 'más económico';
  res.json({
    ...base,
    respuesta: `Encontré ${resultado.total} garaje${resultado.total === 1 ? '' : 's'}${descripcion ? ` ${descripcion}` : ''}. ${resultado.total === 1 ? 'Es' : `El ${orden} es`} ${detalleMejor}.${notas.length ? ` ${notas.join(' ')}` : ''}`,
    garajes: top.map((g) => ({ ...tarjeta(g), enlace: enlaceGaraje(g.id_garaje, f) })),
    total: resultado.total,
    enlace: enlaceBusqueda(f, d.ubicacion),
    contexto: f,
  });
});
