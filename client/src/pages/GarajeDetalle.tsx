import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, mensajeDeError } from '../api';
import { useSesion } from '../auth';
import { useAvisos } from '../avisos';
import {
  aMinutos, deMinutos, dinero, enlaceComoLlegar, etiquetaPago, etiquetaVehiculo, fechaCorta, hora12, hoyBogota,
  minutosAhoraBogota, rangoHoras, resumirHorarios, segmentosLibres, sumarDias,
} from '../format';
import { Avatar } from '../fotos';
import { BotonCorazon, ChipsServicios } from './Buscar';
import { useCarga, useTitulo } from '../hooks';
import { MapaFijo } from '../mapas';
import type { DetalleGaraje, MetodoPago, MotivoReporte, Ocupacion, Reserva, TipoVehiculo } from '../types';
import { Alerta, Dialogo, Esqueletos, Estrellas, Icono } from '../ui';

const PLACA = { carro: /^[A-Z]{3}\d{3}$/, moto: /^[A-Z]{3}\d{2}[A-Z]$/ };

function FormularioReserva({ detalle, onReservada }: { detalle: DetalleGaraje; onReservada: () => void }) {
  const { garaje: g } = detalle;
  const { usuario } = useSesion();
  const avisos = useAvisos();
  const navegar = useNavigate();
  const ubicacion = useLocation();
  const [params] = useSearchParams();
  const hoy = hoyBogota();

  const [fecha, setFecha] = useState(params.get('fecha') || hoy);
  const [desde, setDesde] = useState(params.get('desde') || '');
  const [hasta, setHasta] = useState(params.get('hasta') || '');
  // El vehículo guardado en el perfil rellena la reserva; si el garaje no lo admite, se ignora.
  const guardado = usuario?.vehiculo && (g.tipo_vehiculo === 'ambos' || g.tipo_vehiculo === usuario.vehiculo.tipo) ? usuario.vehiculo : null;
  const [vehiculo, setVehiculo] = useState<TipoVehiculo>(
    g.tipo_vehiculo === 'moto' ? 'moto' : (params.get('vehiculo') as TipoVehiculo) || guardado?.tipo || 'carro',
  );
  const [placa, setPlaca] = useState(() => guardado?.placa || localStorage.getItem('parkspotter.placa') || '');
  // Al abrir el link directo, la sesión llega un instante después: se completa con el perfil si aún no escribieron nada.
  const prellenado = useRef(Boolean(guardado));
  useEffect(() => {
    if (!guardado || prellenado.current) return;
    prellenado.current = true;
    setPlaca((p) => p || guardado.placa);
    if (!params.get('vehiculo')) setVehiculo(guardado.tipo);
  }, [guardado, params]);
  const [metodo, setMetodo] = useState<MetodoPago>('tarjeta');
  const [ocupacion, setOcupacion] = useState<Ocupacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let vigente = true;
    setOcupacion(null);
    api
      .get<Ocupacion>(`/garajes/${g.id_garaje}/ocupacion?fecha=${fecha}`)
      .then((o) => vigente && setOcupacion(o))
      .catch((e) => vigente && setError(mensajeDeError(e)));
    return () => {
      vigente = false;
    };
  }, [g.id_garaje, fecha, version]);

  const segmentos = useMemo(
    () => (ocupacion ? segmentosLibres(ocupacion.ventanas, ocupacion.llenos, fecha === hoy ? minutosAhoraBogota() + 1 : 0) : []),
    [ocupacion, fecha, hoy],
  );
  const entradas = useMemo(() => segmentos.flatMap((s) => Array.from({ length: (s.fin - s.ini) / 30 }, (_, i) => deMinutos(s.ini + i * 30))), [segmentos]);
  const salidas = useMemo(() => {
    if (!desde) return [];
    const seg = segmentos.find((s) => aMinutos(desde) >= s.ini && aMinutos(desde) < s.fin);
    if (!seg) return [];
    return Array.from({ length: (seg.fin - aMinutos(desde)) / 30 }, (_, i) => deMinutos(aMinutos(desde) + (i + 1) * 30));
  }, [segmentos, desde]);

  // Si el horario elegido dejó de ser válido (otro día, otra ocupación), se limpia.
  useEffect(() => {
    if (!ocupacion) return;
    if (desde && !entradas.includes(desde)) {
      setDesde('');
      setHasta('');
    } else if (hasta && !salidas.includes(hasta)) setHasta('');
  }, [ocupacion, entradas, salidas, desde, hasta]);

  const minutos = desde && hasta ? aMinutos(hasta) - aMinutos(desde) : 0;
  const costo = Math.round((g.tarifa_hora * minutos) / 60);
  const placaNorm = placa.replace(/[\s-]/g, '').toUpperCase();
  const placaOk = PLACA[vehiculo].test(placaNorm);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!usuario) {
      navegar(`/login?volver=${encodeURIComponent(ubicacion.pathname + ubicacion.search)}`);
      return;
    }
    setError(null);
    setEnviando(true);
    try {
      localStorage.setItem('parkspotter.placa', placaNorm);
      const r = await api.post<{ reserva: Reserva }>('/reservas', {
        id_garaje: g.id_garaje,
        fecha,
        hora_inicio: desde,
        hora_fin: hasta,
        tipo_vehiculo: vehiculo,
        placa: placaNorm,
        metodo_pago: metodo,
      });
      avisos.ok('Solicitud enviada. El propietario te responderá pronto.');
      onReservada();
      navegar(`/reservas/${r.reserva.id_reserva}`);
    } catch (err) {
      setError(mensajeDeError(err));
      setVersion((v) => v + 1); // refresca los cupos por si alguien reservó antes
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="card col" id="reservar" onSubmit={enviar}>
      <h2>Reserva tu cupo</h2>
      {error && <Alerta>{error}</Alerta>}

      <div className="campo">
        <label htmlFor="r-fecha">Día</label>
        <input id="r-fecha" className="entrada" type="date" min={hoy} max={sumarDias(hoy, 60)} value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} required />
      </div>

      {ocupacion === null ? (
        <div className="muted fila"><span className="spinner" /> Consultando horarios…</div>
      ) : ocupacion.bloqueado ? (
        <Alerta tipo="aviso">
          El propietario no recibe reservas ese día{ocupacion.motivo_bloqueo ? ` (${ocupacion.motivo_bloqueo})` : ''}. Prueba con otra fecha.
        </Alerta>
      ) : entradas.length === 0 ? (
        <Alerta tipo="aviso">
          {ocupacion.ventanas.length === 0 ? 'Este garaje no se ofrece ese día.' : 'No quedan horarios libres ese día.'} Prueba con otra fecha.
        </Alerta>
      ) : (
        <>
          <div className="grid2">
            <div className="campo">
              <label htmlFor="r-desde">Entrada</label>
              <select id="r-desde" className="entrada" value={desde} onChange={(e) => { setDesde(e.target.value); setHasta(''); }} required>
                <option value="">Elige</option>
                {entradas.map((h) => <option key={h} value={h}>{hora12(h)}</option>)}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="r-hasta">Salida</label>
              <select id="r-hasta" className="entrada" value={hasta} onChange={(e) => setHasta(e.target.value)} disabled={!desde} required>
                <option value="">Elige</option>
                {salidas.map((h) => <option key={h} value={h}>{hora12(h)}</option>)}
              </select>
            </div>
          </div>
          {ocupacion.llenos.length > 0 && (
            <span className="ayuda">Ocupado ese día: {ocupacion.llenos.map((l) => rangoHoras(l.hora_inicio, l.hora_fin)).join(', ')}.</span>
          )}
        </>
      )}

      {g.tipo_vehiculo === 'ambos' ? (
        <div className="campo">
          <span className="etiqueta" id="r-veh">Vehículo</span>
          <div className="segmentado" role="group" aria-labelledby="r-veh">
            <button type="button" className="segmento" aria-pressed={vehiculo === 'carro'} onClick={() => setVehiculo('carro')}><Icono n="carro" /> Carro</button>
            <button type="button" className="segmento" aria-pressed={vehiculo === 'moto'} onClick={() => setVehiculo('moto')}><Icono n="moto" /> Moto</button>
          </div>
        </div>
      ) : (
        <span className="chip primario" style={{ alignSelf: 'flex-start' }}>Solo {etiquetaVehiculo(g.tipo_vehiculo).toLowerCase()}</span>
      )}

      <div className="campo">
        <label htmlFor="r-placa">Placa</label>
        <input
          id="r-placa"
          className="entrada"
          value={placa}
          onChange={(e) => setPlaca(e.target.value.toUpperCase())}
          placeholder={vehiculo === 'carro' ? 'ABC123' : 'ABC12D'}
          maxLength={7}
          autoCapitalize="characters"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={placa !== '' && !placaOk}
          required
        />
        {placa !== '' && !placaOk && <span className="ayuda" style={{ color: 'var(--error)' }}>Formato {vehiculo === 'carro' ? 'de carro: 3 letras y 3 números' : 'de moto: 3 letras, 2 números y 1 letra'}.</span>}
      </div>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="etiqueta muted pequeno fuerte" style={{ marginBottom: 6 }}>Método de pago (simulado)</legend>
        <div className="opciones-pago">
          {(['tarjeta', 'pse', 'efectivo'] as MetodoPago[]).map((m) => (
            <label key={m} className="opcion">
              <input type="radio" name="metodo" value={m} checked={metodo === m} onChange={() => setMetodo(m)} />
              <span>{etiquetaPago(m)}</span>
            </label>
          ))}
        </div>
        <span className="ayuda">Esta versión de prueba no cobra dinero ni pide datos de tarjeta.</span>
      </fieldset>

      <div className="resumen-precio" aria-live="polite">
        <div className="fila entre"><span className="muted">Tarifa</span><span>{dinero(g.tarifa_hora)} / hora</span></div>
        <div className="fila entre"><span className="muted">Duración</span><span>{minutos ? `${minutos / 60} h` : '—'}</span></div>
        <div className="fila entre"><span className="fuerte">Total</span><span className="total">{minutos ? dinero(costo) : '—'}</span></div>
      </div>

      <button className="btn bloque" disabled={enviando || !desde || !hasta || !placaOk}>
        {enviando ? <span className="spinner" /> : usuario ? 'Solicitar reserva' : 'Ingresa para reservar'}
      </button>
      <p className="ayuda centrado">El propietario debe aceptar tu solicitud. Si no responde antes de la hora de entrada, se cancela sola.</p>
    </form>
  );
}

function Galeria({ fotos, nombre }: { fotos: { id_foto: number; url: string }[]; nombre: string }) {
  const [actual, setActual] = useState(0);
  if (fotos.length === 0) {
    return (
      <div className="galeria vacia" role="img" aria-label="Este garaje aún no tiene fotos">
        <Icono n="casa" />
        <span>Sin fotos todavía</span>
      </div>
    );
  }
  return (
    <div className="galeria">
      <div
        className="galeria-pista"
        onScroll={(e) => {
          const el = e.currentTarget;
          setActual(Math.round(el.scrollLeft / el.clientWidth));
        }}
        tabIndex={0}
        aria-label={`Fotos de ${nombre}`}
      >
        {fotos.map((f, i) => (
          <img key={f.id_foto} src={f.url} alt={`${nombre}, foto ${i + 1} de ${fotos.length}`} loading={i === 0 ? 'eager' : 'lazy'} />
        ))}
      </div>
      {fotos.length > 1 && (
        <>
          <span className="galeria-contador" aria-hidden="true">{actual + 1} / {fotos.length}</span>
          <span className="galeria-puntos" aria-hidden="true">
            {fotos.map((f, i) => <i key={f.id_foto} className={i === actual ? 'on' : ''} />)}
          </span>
        </>
      )}
    </div>
  );
}

// Comparte el garaje con el menú nativo del celular (WhatsApp, etc.); en el computador copia el enlace.
async function compartir(nombre: string, id: number, avisos: { ok: (t: string) => void; error: (t: string) => void }) {
  const url = `${location.origin}/garaje/${id}`;
  try {
    if (navigator.share) await navigator.share({ title: nombre, text: `Mira este garaje para parquear en Bogotá: ${nombre}`, url });
    else {
      await navigator.clipboard.writeText(url);
      avisos.ok('Enlace copiado.');
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return; // la persona cerró el menú: no es un error
    avisos.error('No se pudo compartir. Copia el enlace desde la barra del navegador.');
  }
}

const MOTIVOS_REPORTE: { id: MotivoReporte; texto: string }[] = [
  { id: 'informacion_falsa', texto: 'La información o las fotos no son reales' },
  { id: 'no_existe', texto: 'El garaje no existe o no está disponible' },
  { id: 'inseguro', texto: 'Parece un lugar inseguro' },
  { id: 'cobro', texto: 'Me cobraron algo distinto al precio publicado' },
  { id: 'otro', texto: 'Otro motivo' },
];

/** Enlace discreto al final de la página para avisar de un problema con la publicación. */
function ReportarGaraje({ idGaraje, nombre }: { idGaraje: number; nombre: string }) {
  const { usuario } = useSesion();
  const avisos = useAvisos();
  const navegar = useNavigate();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState<MotivoReporte>('informacion_falsa');
  const [detalle, setDetalle] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      await api.post(`/garajes/${idGaraje}/reportar`, { motivo, detalle: detalle.trim() || undefined });
      avisos.ok('Gracias: un administrador revisará esta publicación.');
      setAbierto(false);
      setDetalle('');
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn fantasma s reportar"
        onClick={() => (usuario ? setAbierto(true) : navegar(`/login?volver=${encodeURIComponent(`/garaje/${idGaraje}`)}`))}
      >
        <Icono n="alerta" /> Reportar esta publicación
      </button>
      <Dialogo abierto={abierto} onCerrar={() => setAbierto(false)} titulo={`Reportar «${nombre}»`}>
        <form className="col" onSubmit={enviar}>
          <fieldset className="opciones-reporte">
            <legend className="muted pequeno">¿Qué pasa con esta publicación?</legend>
            {MOTIVOS_REPORTE.map((m) => (
              <label key={m.id} className="opcion-reporte">
                <input type="radio" name="motivo-reporte" checked={motivo === m.id} onChange={() => setMotivo(m.id)} />
                <span>{m.texto}</span>
              </label>
            ))}
          </fieldset>
          <div className="campo">
            <label htmlFor="rep-detalle">Cuéntanos más {motivo === 'otro' ? '' : '(opcional)'}</label>
            <textarea id="rep-detalle" className="entrada" maxLength={300} value={detalle} onChange={(e) => setDetalle(e.target.value)} required={motivo === 'otro'} />
          </div>
          {error && <Alerta>{error}</Alerta>}
          <button className="btn bloque" disabled={enviando}>{enviando ? <span className="spinner" /> : 'Enviar reporte'}</button>
        </form>
      </Dialogo>
    </>
  );
}

export function GarajeDetalle() {
  const { id } = useParams();
  const avisos = useAvisos();
  const { datos, error, cargando, recargar } = useCarga(() => api.get<DetalleGaraje>(`/garajes/${id}`), [id]);
  useTitulo(datos?.garaje.nombre ?? 'Garaje');

  if (cargando && !datos) return <Esqueletos n={2} />;
  if (error || !datos) {
    return (
      <div className="col">
        <Alerta>{error ?? 'No encontramos este garaje.'}</Alerta>
        <Link to="/" className="btn secundario">Volver a buscar</Link>
      </div>
    );
  }

  const { garaje: g, disponibilidad, calificaciones } = datos;
  const horarios = resumirHorarios(disponibilidad);

  return (
    <div className="detalle">
      <div className="col l">
        <div className="col">
          <Link to={`/${window.location.search}`} className="fila" style={{ width: 'fit-content' }}>← Volver a resultados</Link>
          <Galeria fotos={g.fotos ?? []} nombre={g.nombre} />
          <div className="fila entre" style={{ alignItems: 'flex-start' }}>
            <div className="col s">
              <h1>{g.nombre}</h1>
              <span className="muted">{g.direccion}{g.barrio ? ` · ${g.barrio}` : ''}</span>
              <Estrellas valor={g.calificacion_promedio} total={g.total_calificaciones} />
            </div>
            <div className="precio centrado">{dinero(g.tarifa_hora)}<br /><small>por hora</small></div>
          </div>
          <div className="fila">
            <BotonCorazon id={g.id_garaje} className="corazon-barra" />
            <button type="button" className="btn secundario s" onClick={() => void compartir(g.nombre, g.id_garaje, avisos)}>
              <Icono n="compartir" /> Compartir
            </button>
          </div>
          <ChipsServicios ids={g.servicios} max={9} />
          {g.estado !== 'activo' && <Alerta tipo="aviso">Este garaje está {g.estado === 'inactivo' ? 'pausado' : 'suspendido'} y no recibe reservas.</Alerta>}
          <a className="btn solo-movil" href="#reservar">Reservar este garaje</a>
        </div>

        <MapaFijo lat={g.latitud} lng={g.longitud} />
        <a className="btn secundario" href={enlaceComoLlegar(g.latitud, g.longitud)} target="_blank" rel="noopener noreferrer">
          <Icono n="ruta" /> Cómo llegar
        </a>

        <div className="card col">
          <h2>Sobre este garaje</h2>
          {g.descripcion && <p>{g.descripcion}</p>}
          <dl className="datos">
            <div><dt>Admite</dt><dd>{etiquetaVehiculo(g.tipo_vehiculo)}</dd></div>
            <div><dt>Cupos</dt><dd>{g.capacidad_total}</dd></div>
            <div><dt>Zona</dt><dd>{[g.barrio, g.localidad].filter(Boolean).join(', ') || '—'}</dd></div>
            <div><dt>Ofrecido por</dt><dd className="fila" style={{ gap: 8 }}><Avatar foto={g.propietario_foto} nombre={g.propietario} tam={26} />{g.propietario}</dd></div>
          </dl>
        </div>

        <div className="card col">
          <h2>Horarios disponibles</h2>
          <ul className="horarios">
            {horarios.map((h) => (
              <li key={h.dias + h.horas}><span className="fuerte">{h.dias}</span><span className="muted">{h.horas}</span></li>
            ))}
          </ul>
        </div>

        <div className="card col">
          <h2>Cómo entrar</h2>
          {g.acceso_privado_visible ? (
            <>
              <p>{g.instrucciones_acceso || 'El propietario no dejó instrucciones adicionales.'}</p>
              {g.telefono_propietario && <a className="btn suave" href={`tel:${g.telefono_propietario}`}><Icono n="telefono" /> Llamar al propietario</a>}
            </>
          ) : (
            <p className="muted">Las instrucciones de acceso y el teléfono del propietario se muestran cuando tu reserva queda confirmada.</p>
          )}
        </div>

        <div className="card col">
          <h2>Opiniones</h2>
          {calificaciones.length === 0 ? (
            <p className="muted">Aún no hay opiniones. Sé la primera persona en calificarlo después de usarlo.</p>
          ) : (
            calificaciones.map((c) => (
              <div key={c.id_calificacion} className="resena col s">
                <div className="fila entre"><b>{c.autor}</b><span className="muted pequeno">{fechaCorta(c.fecha.slice(0, 10))}</span></div>
                <Estrellas valor={c.puntuacion} />
                {c.comentario && <p>{c.comentario}</p>}
                {c.respuesta && (
                  <div className="resena-respuesta">
                    <b>Respuesta del propietario</b>
                    <p>{c.respuesta.texto}</p>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <ReportarGaraje idGaraje={g.id_garaje} nombre={g.nombre} />
      </div>

      <aside className="lateral">
        {g.estado === 'activo' && <FormularioReserva detalle={datos} onReservada={() => void recargar(true)} />}
      </aside>
    </div>
  );
}
