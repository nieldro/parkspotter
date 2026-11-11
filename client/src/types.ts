export type TipoVehiculo = 'carro' | 'moto';
export type TipoVehiculoGaraje = TipoVehiculo | 'ambos';
export type MetodoPago = 'tarjeta' | 'pse' | 'efectivo';

export interface Usuario {
  id_usuario: number;
  nombre: string;
  apellido: string;
  correo: string;
  telefono: string | null;
  foto: string | null;
  fecha_nacimiento: string | null;
  vehiculo: { tipo: TipoVehiculo; placa: string; detalle: string } | null;
  tipo_usuario: 'conductor' | 'propietario' | 'admin';
  es_propietario: boolean;
  estado: 'activo' | 'inactivo';
}

export interface Garaje {
  id_garaje: number;
  nombre: string;
  direccion: string;
  barrio: string | null;
  localidad: string | null;
  latitud: number;
  longitud: number;
  tarifa_hora: number;
  capacidad_total: number;
  tipo_vehiculo: TipoVehiculoGaraje;
  descripcion: string | null;
  estado: 'activo' | 'inactivo' | 'suspendido';
  calificacion_promedio: number | null;
  total_calificaciones: number;
  propietario: string;
  propietario_foto?: string | null;
  foto?: string | null;
  fotos?: FotoGaraje[];
  servicios?: string[];
  distancia_km?: number;
  cupos_libres?: number;
  costo_estimado?: number;
  instrucciones_acceso?: string | null;
  telefono_propietario?: string | null;
  acceso_privado_visible?: boolean;
}

export interface FotoGaraje {
  id_foto: number;
  url: string;
}

export interface Ventana {
  dia_semana: number;
  hora_inicio: string;
  hora_fin: string;
}

export interface RespuestaPropietario {
  texto: string;
  fecha: string;
}

export interface Calificacion {
  id_calificacion: number;
  puntuacion: number;
  comentario: string | null;
  fecha: string;
  autor: string;
  respuesta: RespuestaPropietario | null;
}

/** Una opinión recibida, vista por el propietario (con el garaje al que pertenece). */
export interface Opinion {
  id_calificacion: number;
  garaje: { id_garaje: number; nombre: string };
  puntuacion: number;
  comentario: string | null;
  fecha: string;
  autor: string;
  respuesta: RespuestaPropietario | null;
}

export interface Bloqueo {
  fecha: string;
  motivo: string | null;
}

export interface DetalleGaraje {
  garaje: Garaje;
  disponibilidad: Ventana[];
  calificaciones: Calificacion[];
}

export interface Ocupacion {
  fecha: string;
  dia_semana: number;
  bloqueado: boolean;
  motivo_bloqueo: string | null;
  ventanas: { hora_inicio: string; hora_fin: string }[];
  llenos: { hora_inicio: string; hora_fin: string }[];
  capacidad_total: number;
}

export type EstadoReserva = 'pendiente' | 'confirmada' | 'rechazada' | 'cancelada';
export type EstadoEfectivo = EstadoReserva | 'finalizada';

export interface Reserva {
  id_reserva: number;
  estado: EstadoReserva;
  estado_efectivo: EstadoEfectivo;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  fecha_inicio: string;
  fecha_fin: string;
  costo_total: number;
  tipo_vehiculo: TipoVehiculo;
  placa: string;
  motivo: string | null;
  fecha_solicitud: string;
  garaje: {
    id_garaje: number;
    nombre: string;
    direccion: string;
    barrio: string | null;
    localidad: string | null;
    latitud: number;
    longitud: number;
    foto?: string | null;
    instrucciones_acceso?: string | null;
  };
  pago: { metodo_pago: MetodoPago; estado_pago: string; referencia: string | null; monto: number; simulado: boolean } | null;
  calificacion: { puntuacion: number; comentario: string | null } | null;
  propietario: { nombre: string; foto?: string | null; telefono?: string | null };
  conductor: { nombre?: string; foto?: string | null; telefono?: string | null };
  /** Solo lo ve el conductor, con la reserva confirmada: el propietario lo digita al recibirlo. */
  codigo?: string;
  llegada: string | null;
  puede_registrar_llegada: boolean;
  mensajes_sin_leer: number;
  puede_chatear: boolean;
  puede_cancelar: boolean;
  puede_responder: boolean;
  puede_calificar: boolean;
}

export interface GarajePropio extends Omit<Garaje, 'propietario'> {
  instrucciones_acceso: string | null;
  solicitudes_pendientes?: number;
  disponibilidad?: Ventana[];
  foto?: string | null;
  fotos?: FotoGaraje[];
  servicios?: string[];
}

export interface Estadisticas {
  totales: {
    ingresos_realizados: number;
    ingresos_proyectados: number;
    horas_reservadas: number;
    reservas_confirmadas: number;
    tasa_aceptacion: number | null;
    calificacion_promedio: number | null;
    total_calificaciones: number;
  };
  estados: Record<'pendiente' | 'confirmada' | 'rechazada' | 'cancelada', number>;
  semanas: { inicio: string; ingresos: number; proyectados: number; reservas: number }[];
  por_garaje: { id_garaje: number; nombre: string; ingresos: number; proyectados: number; reservas: number; horas: number }[];
}

export interface ResumenPropietario {
  garajes: number;
  solicitudes_pendientes: number;
  reservas_proximas: number;
  ingresos_realizados: number;
  ingresos_proyectados: number;
}

export type MotivoReporte = 'informacion_falsa' | 'no_existe' | 'inseguro' | 'cobro' | 'otro';

export interface ReporteFila {
  id_reporte: number;
  motivo: MotivoReporte;
  detalle: string | null;
  estado: 'abierto' | 'resuelto';
  fecha: string;
  id_garaje: number;
  garaje: string;
  garaje_estado: string;
  reportante: string;
  abiertos_del_garaje: number;
}

export interface Notificacion {
  id_notificacion: number;
  id_reserva: number | null;
  tipo: string;
  mensaje: string;
  leida: number;
  fecha: string;
}

export interface Mensaje {
  id_mensaje: number;
  mio: boolean;
  texto: string;
  fecha: string;
}

export interface TarjetaAsistente {
  id_garaje: number;
  nombre: string;
  barrio: string | null;
  localidad: string | null;
  tarifa_hora: number;
  costo_estimado: number | null;
  calificacion_promedio: number | null;
  total_calificaciones: number;
  foto: string | null;
  distancia_km: number | null;
  enlace: string;
}

export interface RespuestaAsistente {
  respuesta: string;
  motor: 'local' | 'modelo';
  sugerencias: string[];
  garajes?: TarjetaAsistente[];
  total?: number;
  enlace?: string;
  reservas?: { id_reserva: number; garaje: string; fecha: string; hora_inicio: string; hora_fin: string; estado: string }[];
  pedirUbicacion?: boolean;
  accion?: { tipo: 'login' };
  contexto: Record<string, unknown>;
}
