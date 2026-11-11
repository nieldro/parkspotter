import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, mensajeDeError, obtenerToken } from './api';
import { useAvisos } from './avisos';
import { Avatar } from './fotos';
import { dinero, enlaceComoLlegar, etiquetaPago, fechaLarga, rangoHoras } from './format';
import type { Reserva } from './types';
import { Alerta, Dialogo, Estado, Icono, SelectorEstrellas } from './ui';

type Accion = 'cancelar' | 'rechazar' | 'calificar' | 'llegada' | null;

const horaDe = (iso: string) => new Date(iso).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });

const ESTADO_PAGO: Record<string, string> = {
  pendiente: 'Pendiente',
  aprobado: 'Aprobado',
  rechazado: 'No realizado',
  reembolsado: 'Reembolsado',
};

export function ReservaCard({ r, vista, onCambio, detalle = false }: { r: Reserva; vista: 'conductor' | 'propietario'; onCambio: () => void; detalle?: boolean }) {
  const avisos = useAvisos();
  const [accion, setAccion] = useState<Accion>(null);
  const [motivo, setMotivo] = useState('');
  const [puntos, setPuntos] = useState(5);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cerrar = () => {
    setAccion(null);
    setError(null);
    setMotivo('');
  };

  async function ejecutar(fn: () => Promise<unknown>, exito: string) {
    setOcupado(true);
    setError(null);
    try {
      await fn();
      avisos.ok(exito);
      cerrar();
      onCambio();
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setOcupado(false);
    }
  }

  const aceptar = async () => {
    setOcupado(true);
    try {
      await api.post(`/reservas/${r.id_reserva}/responder`, { accion: 'aceptar' });
      avisos.ok('Reserva confirmada.');
      onCambio();
    } catch (e) {
      avisos.error(mensajeDeError(e));
      onCambio();
    } finally {
      setOcupado(false);
    }
  };

  // Descarga el .ics con la sesión (un enlace directo no llevaría el token) y lo abre con el calendario del celular.
  async function agregarAlCalendario() {
    try {
      const resp = await fetch(`/api/reservas/${r.id_reserva}/calendario`, { headers: { Authorization: `Bearer ${obtenerToken() ?? ''}` } });
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error ?? 'No se pudo generar el evento.');
      const url = URL.createObjectURL(await resp.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `reserva-${r.id_reserva}.ics`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      avisos.ok('Evento listo: ábrelo para guardarlo en tu calendario.');
    } catch (e) {
      avisos.error(mensajeDeError(e));
    }
  }

  const otro = vista === 'conductor' ? r.propietario : r.conductor;
  const g = r.garaje;

  return (
    <article className="card reserva-card" aria-label={`Reserva en ${g.nombre}`}>
      <div className="cabeza">
        <div className="fila" style={{ alignItems: 'flex-start', minWidth: 0 }}>
          {vista === 'propietario' ? (
            <Avatar foto={r.conductor.foto} nombre={r.conductor.nombre ?? 'C'} tam={44} />
          ) : (
            <span className="mini-portada">{g.foto ? <img src={g.foto} alt="" loading="lazy" /> : <Icono n="casa" />}</span>
          )}
          <div className="col s" style={{ minWidth: 0 }}>
            <h3>{vista === 'propietario' ? `${r.conductor.nombre ?? 'Conductor'} · ${g.nombre}` : g.nombre}</h3>
            <span className="muted pequeno">{g.direccion}</span>
          </div>
        </div>
        <Estado valor={r.estado_efectivo} />
      </div>

      <div className="fecha-bloque">
        <Icono n="reloj" />
        <div>
          <div className="fuerte primera-mayuscula">{fechaLarga(r.fecha)}</div>
          <div className="muted">{rangoHoras(r.hora_inicio, r.hora_fin)} · {r.tipo_vehiculo === 'carro' ? 'Carro' : 'Moto'} {r.placa}</div>
        </div>
      </div>

      <div className="fila entre">
        <span className="muted pequeno">
          {r.pago ? `Pago simulado · ${etiquetaPago(r.pago.metodo_pago)} · ${ESTADO_PAGO[r.pago.estado_pago] ?? r.pago.estado_pago}` : ''}
        </span>
        <b>{dinero(r.costo_total)}</b>
      </div>

      {r.motivo && (r.estado === 'rechazada' || r.estado === 'cancelada') && <Alerta tipo="aviso">{r.motivo}</Alerta>}

      {r.estado === 'confirmada' && (
        <div className="ok-caja">
          <Icono n="check" />
          <div className="col s">
            {vista === 'conductor' && <span><b>Cómo entrar:</b> {g.instrucciones_acceso || 'Sin instrucciones adicionales.'}</span>}
            {otro.telefono && (
              <a href={`tel:${otro.telefono}`} className="fila" style={{ color: 'inherit', textDecoration: 'underline' }}>
                Llamar {vista === 'conductor' ? 'al propietario' : 'al conductor'}: {otro.telefono}
              </a>
            )}
            {vista === 'propietario' && !otro.telefono && <span>Reserva confirmada.</span>}
          </div>
        </div>
      )}

      {vista === 'conductor' && r.codigo && r.estado_efectivo === 'confirmada' && !r.llegada && (
        <div className="codigo-llegada">
          <span className="muted pequeno">Código de llegada</span>
          <b aria-label={`Código de llegada: ${r.codigo.split('').join(' ')}`}>{r.codigo}</b>
          <span className="muted pequeno">Muéstraselo al propietario cuando llegues.</span>
        </div>
      )}
      {r.llegada && (
        <Alerta tipo="ok">
          {vista === 'propietario' ? 'Llegada registrada' : 'El propietario registró tu llegada'} a las {horaDe(r.llegada)}.
        </Alerta>
      )}

      {r.calificacion && (
        <span className="muted pequeno">Calificación: {'★'.repeat(r.calificacion.puntuacion)}{'☆'.repeat(5 - r.calificacion.puntuacion)} {r.calificacion.comentario ? `· “${r.calificacion.comentario}”` : ''}</span>
      )}

      <div className="acciones">
        {r.puede_responder && (
          <>
            <button className="btn" disabled={ocupado} onClick={() => void aceptar()}><Icono n="check" /> Aceptar</button>
            <button className="btn peligro" disabled={ocupado} onClick={() => setAccion('rechazar')}>Rechazar</button>
          </>
        )}
        {r.puede_registrar_llegada && (
          <button className="btn" onClick={() => setAccion('llegada')}><Icono n="porton" /> Registrar llegada</button>
        )}
        {r.puede_calificar && <button className="btn suave" onClick={() => setAccion('calificar')}>Calificar</button>}
        {r.estado !== 'rechazada' && r.estado !== 'cancelada' && (
          <a className="btn secundario s" href={enlaceComoLlegar(g.latitud, g.longitud)} target="_blank" rel="noopener noreferrer"><Icono n="ruta" /> Cómo llegar</a>
        )}
        {(r.estado === 'pendiente' || r.estado === 'confirmada') && r.estado_efectivo !== 'finalizada' && (
          <button className="btn secundario s" onClick={() => void agregarAlCalendario()}><Icono n="calendario" /> Al calendario</button>
        )}
        {vista === 'conductor' && (r.estado_efectivo === 'finalizada' || r.estado === 'cancelada' || r.estado === 'rechazada') && (
          <Link className="btn suave s" to={`/garaje/${g.id_garaje}?vehiculo=${r.tipo_vehiculo}`}><Icono n="reloj" /> Reservar de nuevo</Link>
        )}
        {!detalle && (
          <Link className="btn secundario s" to={`/reservas/${r.id_reserva}`}>
            {r.puede_chatear || r.mensajes_sin_leer > 0 ? <Icono n="chat" /> : null} Ver detalle
            {r.mensajes_sin_leer > 0 && <span className="contador-msg" aria-label={`${r.mensajes_sin_leer} mensajes sin leer`}>{r.mensajes_sin_leer}</span>}
          </Link>
        )}
        {r.puede_cancelar && <button className="btn peligro s" onClick={() => setAccion('cancelar')}>Cancelar reserva</button>}
      </div>

      <Dialogo abierto={accion === 'cancelar'} onCerrar={cerrar} titulo="¿Cancelar la reserva?">
        <p className="muted">
          {vista === 'conductor' ? 'Se liberará el horario y avisaremos al propietario.' : 'Se liberará el horario y avisaremos al conductor.'}
          {r.pago?.estado_pago === 'aprobado' && ' Tu pago simulado quedará como reembolsado.'}
        </p>
        <div className="campo">
          <label htmlFor={`m-${r.id_reserva}`}>Motivo (opcional)</label>
          <input id={`m-${r.id_reserva}`} className="entrada" maxLength={200} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </div>
        {error && <Alerta>{error}</Alerta>}
        <div className="acciones">
          <button className="btn secundario" onClick={cerrar}>Volver</button>
          <button className="btn peligro" disabled={ocupado} onClick={() => void ejecutar(() => api.post(`/reservas/${r.id_reserva}/cancelar`, { motivo: motivo || undefined }), 'Reserva cancelada.')}>
            Sí, cancelar
          </button>
        </div>
      </Dialogo>

      <Dialogo abierto={accion === 'llegada'} onCerrar={cerrar} titulo="Registrar llegada">
        <p className="muted">Pídele al conductor el código de 6 caracteres que ve en su reserva. Así confirmas que llegó quien reservó.</p>
        <form
          className="col"
          onSubmit={(e) => {
            e.preventDefault();
            void ejecutar(() => api.post(`/reservas/${r.id_reserva}/llegada`, { codigo: motivo }), 'Llegada registrada.');
          }}
        >
          <div className="campo">
            <label htmlFor={`cod-${r.id_reserva}`}>Código</label>
            <input
              id={`cod-${r.id_reserva}`}
              className="entrada entrada-codigo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              maxLength={10}
              autoComplete="off"
              autoCapitalize="characters"
              inputMode="text"
              placeholder="A1B2C3"
              required
            />
          </div>
          {error && <Alerta>{error}</Alerta>}
          <button className="btn bloque" disabled={ocupado || motivo.length < 4}>{ocupado ? <span className="spinner" /> : 'Confirmar llegada'}</button>
        </form>
      </Dialogo>

      <Dialogo abierto={accion === 'rechazar'} onCerrar={cerrar} titulo="Rechazar solicitud">
        <div className="campo">
          <label htmlFor={`rm-${r.id_reserva}`}>Motivo (se lo mostramos al conductor)</label>
          <input id={`rm-${r.id_reserva}`} className="entrada" maxLength={200} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej: Ese día no estaré" />
        </div>
        {error && <Alerta>{error}</Alerta>}
        <div className="acciones">
          <button className="btn secundario" onClick={cerrar}>Volver</button>
          <button className="btn peligro" disabled={ocupado} onClick={() => void ejecutar(() => api.post(`/reservas/${r.id_reserva}/responder`, { accion: 'rechazar', motivo: motivo || undefined }), 'Solicitud rechazada.')}>
            Rechazar
          </button>
        </div>
      </Dialogo>

      <Dialogo abierto={accion === 'calificar'} onCerrar={cerrar} titulo={`Califica ${g.nombre}`}>
        <SelectorEstrellas valor={puntos} onChange={setPuntos} />
        <div className="campo">
          <label htmlFor={`c-${r.id_reserva}`}>Comentario (opcional)</label>
          <textarea id={`c-${r.id_reserva}`} className="entrada" maxLength={255} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="¿Cómo fue tu experiencia?" />
        </div>
        {error && <Alerta>{error}</Alerta>}
        <button className="btn bloque" disabled={ocupado} onClick={() => void ejecutar(() => api.post(`/reservas/${r.id_reserva}/calificar`, { puntuacion: puntos, comentario: motivo || undefined }), '¡Gracias por tu opinión!')}>
          Enviar calificación
        </button>
      </Dialogo>
    </article>
  );
}
