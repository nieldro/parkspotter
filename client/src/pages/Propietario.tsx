import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, mensajeDeError } from '../api';
import { useSesion } from '../auth';
import { useAvisos } from '../avisos';
import { Portada } from '../fotos';
import { Estadisticas } from './Estadisticas';
import { Opiniones } from './Opiniones';
import { dinero, etiquetaVehiculo } from '../format';
import { useCarga, useTitulo } from '../hooks';
import { ReservaCard } from '../ReservaCard';
import type { GarajePropio, Reserva, ResumenPropietario, Usuario } from '../types';
import { Alerta, Esqueletos, Estado, Estrellas, Icono, Vacio } from '../ui';

function HacerseDueno() {
  const { actualizar } = useSesion();
  const avisos = useAvisos();
  const [tipo, setTipo] = useState('CC');
  const [numero, setNumero] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const r = await api.post<{ usuario: Usuario }>('/auth/yo/propietario', { tipo_documento: tipo, numero_documento: numero });
      actualizar(r.usuario);
      avisos.ok('¡Listo! Ya puedes publicar tu garaje.');
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="col l" style={{ maxWidth: 560, margin: '0 auto' }}>
      <section className="hero">
        <h1>Ponle ingresos a tu garaje vacío</h1>
        <p>Publica tu espacio, define tarifa y horarios, y acepta solo las reservas que quieras.</p>
      </section>
      <form className="card col" onSubmit={enviar}>
        <h2>Activa tu perfil de propietario</h2>
        <p className="muted">Necesitamos tu documento para identificar a quienes publican garajes.</p>
        {error && <Alerta>{error}</Alerta>}
        <div className="grid2">
          <div className="campo">
            <label htmlFor="o-tdoc">Documento</label>
            <select id="o-tdoc" className="entrada" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="CC">Cédula (CC)</option>
              <option value="CE">Cédula de extranjería</option>
              <option value="NIT">NIT</option>
              <option value="PASAPORTE">Pasaporte</option>
            </select>
          </div>
          <div className="campo">
            <label htmlFor="o-ndoc">Número</label>
            <input id="o-ndoc" className="entrada" value={numero} onChange={(e) => setNumero(e.target.value)} required autoComplete="off" />
          </div>
        </div>
        <button className="btn bloque" disabled={enviando || !numero}>{enviando ? <span className="spinner" /> : 'Activar'}</button>
      </form>
    </div>
  );
}

function Panel() {
  const avisos = useAvisos();
  const [pestana, setPestana] = useState<'pendientes' | 'proximas' | 'historial'>('pendientes');
  const [vista, setVista] = useState<'solicitudes' | 'garajes' | 'opiniones' | 'estadisticas'>('solicitudes');
  const cuentaOpiniones = useCarga(() => api.get<{ sin_responder: number }>('/propietario/opiniones'), []);
  const sinResponder = cuentaOpiniones.datos?.sin_responder ?? 0;
  const resumen = useCarga(() => api.get<{ resumen: ResumenPropietario }>('/propietario/resumen'), []);
  const reservas = useCarga(() => api.get<{ reservas: Reserva[] }>('/propietario/reservas'), []);
  const garajes = useCarga(() => api.get<{ garajes: GarajePropio[] }>('/propietario/garajes'), []);

  const refrescar = () => {
    void resumen.recargar(true);
    void reservas.recargar(true);
    void garajes.recargar(true);
    window.dispatchEvent(new Event('parkspotter:avisos'));
  };

  const todas = reservas.datos?.reservas ?? [];
  const pendientes = todas.filter((r) => r.estado_efectivo === 'pendiente');
  const proximas = todas.filter((r) => r.estado_efectivo === 'confirmada');
  const historial = todas.filter((r) => !pendientes.includes(r) && !proximas.includes(r));
  const lista = { pendientes, proximas: [...proximas].reverse(), historial }[pestana];
  const r = resumen.datos?.resumen;

  async function cambiarEstado(g: GarajePropio) {
    try {
      await api.patch(`/propietario/garajes/${g.id_garaje}/estado`, { estado: g.estado === 'activo' ? 'inactivo' : 'activo' });
      avisos.ok(g.estado === 'activo' ? 'Garaje pausado: no recibirá nuevas reservas.' : 'Garaje publicado.');
      refrescar();
    } catch (e) {
      avisos.error(mensajeDeError(e));
    }
  }

  return (
    <>
      <div className="cabecera-pagina">
        <div>
          <h1>Mis garajes</h1>
          <p>Gestiona tus publicaciones y solicitudes.</p>
        </div>
        <Link to="/propietario/garajes/nuevo" className="btn"><Icono n="mas" /> Publicar</Link>
      </div>

      {garajes.datos && garajes.datos.garajes.length === 0 && (
        <section className="card col empezar" aria-label="Cómo publicar tu primer garaje" style={{ marginBottom: 16 }}>
          <h2>Publica tu primer garaje</h2>
          <p className="muted">Toma unos minutos. Esto es lo que te vamos a pedir:</p>
          <ol className="pasos-garaje">
            <li><b>Datos y ubicación:</b> el nombre, la dirección y el pin en el mapa.</li>
            <li><b>Fotos:</b> hasta 6 (la primera es la portada). Genera mucha confianza.</li>
            <li><b>Servicios, tarifa y horarios:</b> cuánto cobras por hora y qué días y horas lo ofreces.</li>
            <li><b>Cómo entrar:</b> solo lo ve quien tenga una reserva confirmada por ti.</li>
          </ol>
          <Link to="/propietario/garajes/nuevo" className="btn bloque"><Icono n="mas" /> Publicar mi garaje</Link>
        </section>
      )}

      <div className="stats" style={{ marginBottom: 16 }}>
        <div className="stat"><b>{r?.solicitudes_pendientes ?? '–'}</b><span>Por responder</span></div>
        <div className="stat"><b>{r?.reservas_proximas ?? '–'}</b><span>Reservas próximas</span></div>
        <div className="stat"><b>{r ? dinero(r.ingresos_proyectados) : '–'}</b><span>Por recibir</span></div>
        <div className="stat"><b>{r ? dinero(r.ingresos_realizados) : '–'}</b><span>Ya realizados</span></div>
      </div>

      <div className="segmentado" role="tablist" aria-label="Sección" style={{ marginBottom: 16 }}>
        <button role="tab" className="segmento" aria-selected={vista === 'solicitudes'} onClick={() => setVista('solicitudes')}>
          Solicitudes {pendientes.length > 0 && <span className="contador">{pendientes.length}</span>}
        </button>
        <button role="tab" className="segmento" aria-selected={vista === 'garajes'} onClick={() => setVista('garajes')}>Garajes</button>
        <button role="tab" className="segmento" aria-selected={vista === 'opiniones'} onClick={() => setVista('opiniones')}>
          Opiniones {sinResponder > 0 && <span className="contador">{sinResponder}</span>}
        </button>
        <button role="tab" className="segmento" aria-selected={vista === 'estadisticas'} onClick={() => setVista('estadisticas')}>Estadísticas</button>
      </div>

      {vista === 'solicitudes' ? (
        <>
          <div className="fila envolver" role="group" aria-label="Filtrar solicitudes" style={{ marginBottom: 12 }}>
            {([['pendientes', 'Por responder'], ['proximas', 'Confirmadas'], ['historial', 'Historial']] as const).map(([k, t]) => (
              <button key={k} className="chip" aria-pressed={pestana === k} onClick={() => setPestana(k)}>{t}</button>
            ))}
          </div>
          {reservas.error && <Alerta>{reservas.error}</Alerta>}
          {reservas.cargando && !reservas.datos ? (
            <Esqueletos />
          ) : lista.length === 0 ? (
            <div className="card">
              <Vacio icono="calendario" titulo={pestana === 'pendientes' ? 'Nada por responder' : 'Sin reservas aquí'}>
                <p>Cuando alguien reserve uno de tus garajes lo verás en esta lista.</p>
              </Vacio>
            </div>
          ) : (
            <div className="lista">
              {lista.map((x) => <ReservaCard key={x.id_reserva} r={x} vista="propietario" onCambio={refrescar} />)}
            </div>
          )}
        </>
      ) : vista === 'opiniones' ? (
        <Opiniones onCambio={() => void cuentaOpiniones.recargar(true)} />
      ) : vista === 'estadisticas' ? (
        <Estadisticas />
      ) : garajes.cargando && !garajes.datos ? (
        <Esqueletos n={2} />
      ) : (garajes.datos?.garajes.length ?? 0) === 0 ? (
        <div className="card">
          <Vacio icono="casa" titulo="Aún no has publicado garajes">
            <p>Publica tu primer garaje en menos de cinco minutos.</p>
            <Link to="/propietario/garajes/nuevo" className="btn">Publicar mi garaje</Link>
          </Vacio>
        </div>
      ) : (
        <div className="lista">
          {garajes.datos?.garajes.map((g) => (
            <article key={g.id_garaje} className="card col">
              <Portada foto={g.foto} alto={120} />
              <div className="fila entre" style={{ alignItems: 'flex-start' }}>
                <div className="col s">
                  <h3>{g.nombre}</h3>
                  <span className="muted pequeno">{g.direccion}</span>
                </div>
                <Estado valor={g.estado} />
              </div>
              <div className="fila envolver">
                <span className="chip">{dinero(g.tarifa_hora)} / h</span>
                <span className="chip">{g.capacidad_total} {g.capacidad_total === 1 ? 'cupo' : 'cupos'}</span>
                <span className="chip">{etiquetaVehiculo(g.tipo_vehiculo)}</span>
                <Estrellas valor={g.calificacion_promedio} total={g.total_calificaciones} />
              </div>
              {g.estado === 'suspendido' && <Alerta tipo="aviso">Un administrador suspendió esta publicación. No recibe reservas.</Alerta>}
              <div className="acciones">
                <Link to={`/propietario/garajes/${g.id_garaje}/editar`} className="btn secundario s"><Icono n="editar" /> Editar</Link>
                <Link to={`/garaje/${g.id_garaje}`} className="btn secundario s">Ver como conductor</Link>
                {g.estado !== 'suspendido' && (
                  <button className="btn suave s" onClick={() => void cambiarEstado(g)}>
                    <Icono n={g.estado === 'activo' ? 'pausa' : 'play'} /> {g.estado === 'activo' ? 'Pausar' : 'Publicar'}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

export function Propietario() {
  const { usuario, cargando } = useSesion();
  useTitulo('Mis garajes');
  if (cargando) return <Esqueletos n={2} />;
  if (!usuario) return <HeroOfrecer />;
  return usuario.es_propietario ? <Panel /> : <HacerseDueno />;
}

// Visitante sin sesión: explica la propuesta y lo lleva a crear su cuenta de propietario.
function HeroOfrecer() {
  return (
    <div className="col l" style={{ maxWidth: 560, margin: '0 auto' }}>
      <section className="hero">
        <h1>Ponle ingresos a tu garaje vacío</h1>
        <p>Publica tu espacio en ParkSpotter, define tarifa y horarios, y acepta solo las reservas que quieras.</p>
      </section>
      <div className="card col">
        <ul className="col s" style={{ margin: 0, paddingLeft: 20 }}>
          <li>Tú fijas el precio, los días y las horas.</li>
          <li>Apruebas cada solicitud antes de confirmarla.</li>
          <li>El conductor solo ve cómo entrar cuando confirmas.</li>
        </ul>
        <Link to="/registro?rol=propietario&volver=/propietario" className="btn bloque">Crear cuenta de propietario</Link>
        <Link to="/login?volver=/propietario" className="btn secundario bloque">Ya tengo cuenta</Link>
      </div>
    </div>
  );
}
