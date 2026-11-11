import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { Chat } from '../Chat';
import { useCarga, useTitulo } from '../hooks';
import { ReservaCard } from '../ReservaCard';
import type { Reserva } from '../types';
import { Alerta, Esqueletos, Vacio } from '../ui';

export function MisReservas() {
  useTitulo('Mis reservas');
  const { datos, error, cargando, recargar } = useCarga(() => api.get<{ reservas: Reserva[] }>('/reservas'), []);
  const [pestana, setPestana] = useState<'proximas' | 'historial'>('proximas');

  const reservas = datos?.reservas ?? [];
  const activas = reservas.filter((r) => r.estado_efectivo === 'pendiente' || (r.estado_efectivo === 'confirmada'));
  const historial = reservas.filter((r) => !activas.includes(r));
  const lista = pestana === 'proximas' ? [...activas].sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio)) : historial;

  return (
    <>
      <div className="cabecera-pagina">
        <div>
          <h1>Mis reservas</h1>
          <p>Tus solicitudes y parqueaderos reservados.</p>
        </div>
      </div>

      <div className="segmentado" role="tablist" aria-label="Reservas" style={{ marginBottom: 16 }}>
        <button role="tab" className="segmento" aria-selected={pestana === 'proximas'} onClick={() => setPestana('proximas')}>
          Próximas {activas.length > 0 && <span className="contador">{activas.length}</span>}
        </button>
        <button role="tab" className="segmento" aria-selected={pestana === 'historial'} onClick={() => setPestana('historial')}>Historial</button>
      </div>

      {error && <Alerta>{error}</Alerta>}
      {cargando && !datos ? (
        <Esqueletos />
      ) : lista.length === 0 ? (
        <div className="card">
          <Vacio icono="calendario" titulo={pestana === 'proximas' ? 'No tienes reservas próximas' : 'Aún no hay historial'}>
            <p>Encuentra un garaje cerca de tu destino y resérvalo en un minuto.</p>
            <Link to="/" className="btn">Buscar parqueadero</Link>
          </Vacio>
        </div>
      ) : (
        <div className="lista">
          {lista.map((r) => (
            <ReservaCard key={r.id_reserva} r={r} vista="conductor" onCambio={() => void recargar(true)} />
          ))}
        </div>
      )}
    </>
  );
}

export function DetalleReserva() {
  const { id } = useParams();
  const { datos, error, cargando, recargar } = useCarga(() => api.get<{ reserva: Reserva }>(`/reservas/${id}`), [id]);
  useTitulo('Reserva');

  if (cargando && !datos) return <Esqueletos n={1} />;
  if (error || !datos) {
    return (
      <div className="col">
        <Alerta>{error ?? 'No encontramos esta reserva.'}</Alerta>
        <Link to="/reservas" className="btn secundario">Mis reservas</Link>
      </div>
    );
  }
  // Si el garaje es del usuario, la API devuelve al conductor como "conductor.nombre"; esa es la señal de vista de propietario.
  const vista = datos.reserva.conductor.nombre ? 'propietario' : 'conductor';
  return (
    <div className="col" style={{ maxWidth: 640, margin: '0 auto' }}>
      <Link to={vista === 'propietario' ? '/propietario' : '/reservas'}>← Volver</Link>
      <ReservaCard r={datos.reserva} vista={vista} detalle onCambio={() => void recargar(true)} />
      {datos.reserva.estado !== 'rechazada' && datos.reserva.estado !== 'cancelada' && (
        <Chat
          key={datos.reserva.id_reserva}
          idReserva={datos.reserva.id_reserva}
          otro={vista === 'conductor' ? { nombre: datos.reserva.propietario.nombre, foto: datos.reserva.propietario.foto } : { nombre: datos.reserva.conductor.nombre ?? 'Conductor', foto: datos.reserva.conductor.foto }}
          abiertoInicial={datos.reserva.puede_chatear}
          vista={vista}
        />
      )}
    </div>
  );
}
