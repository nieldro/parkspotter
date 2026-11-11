import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, mensajeDeError } from '../api';
import { useSesion } from '../auth';
import { useFavoritos } from '../favoritos';
import { SERVICIOS, servicioDe } from '../servicios';
import { aMinutos, deMinutos, dinero, etiquetaVehiculo, hora12, hoyBogota, minutosAhoraBogota, sumarDias } from '../format';
import { geocodificar, ubicacionActual } from '../geocodificar';
import { Portada } from '../fotos';
import { useTitulo } from '../hooks';
import { useInstalacion } from '../instalar';
import { MapaGarajes } from '../mapas';
import type { Garaje } from '../types';
import { Alerta, Esqueletos, Estrellas, Icono, Logo, Vacio } from '../ui';

const HORAS = Array.from({ length: 48 }, (_, i) => deMinutos(i * 30)); // 00:00 ... 23:30

function BannerInstalar() {
  const { instalada, puedeInstalar, esIOS, esAndroid, integrado, instalar } = useInstalacion();
  const [oculto, setOculto] = useState(() => localStorage.getItem('parkspotter.banner') === '1');
  if (instalada || oculto || (!puedeInstalar && !esIOS && !esAndroid)) return null;
  const indicacion = integrado
    ? esIOS
      ? 'Ábrela en Safari (menú ⋯ → Abrir en Safari) para poder instalarla.'
      : 'Ábrela en Chrome (menú ⋮ → Abrir en el navegador) para poder instalarla.'
    : puedeInstalar
      ? 'Ábrela como una app, sin tiendas ni descargas pesadas.'
      : esIOS
        ? 'En Safari: toca Compartir y luego «Agregar a inicio».'
        : 'En Chrome: menú ⋮ y luego «Instalar app».';
  return (
    <div className="banner-instalar">
      <Logo />
      <div className="grow">
        <b>Instala ParkSpotter</b>
        <div className="pequeno muted">{indicacion}</div>
      </div>
      {puedeInstalar && (
        <button className="btn s" onClick={() => void instalar()}>
          Instalar
        </button>
      )}
      <button
        className="btn icono fantasma"
        aria-label="Ocultar"
        onClick={() => {
          localStorage.setItem('parkspotter.banner', '1');
          setOculto(true);
        }}
      >
        <Icono n="x" />
      </button>
    </div>
  );
}

/** Corazón para guardar un garaje. Sin sesión, lleva a ingresar y vuelve a la misma pantalla. */
export function BotonCorazon({ id, className = '' }: { id: number; className?: string }) {
  const { usuario, cargando } = useSesion();
  const { ids, alternar } = useFavoritos();
  const navegar = useNavigate();
  const ubicacion = useLocation();
  const activo = ids.has(id);
  return (
    <button
      type="button"
      className={`corazon ${activo ? 'activo' : ''} ${className}`}
      aria-pressed={activo}
      aria-label={activo ? 'Quitar de favoritos' : 'Guardar en favoritos'}
      onClick={() => {
        if (!usuario && cargando) return; // la sesión aún se está confirmando: no mandar a ingresar a quien ya entró
        if (usuario) void alternar(id);
        else navegar(`/login?volver=${encodeURIComponent(ubicacion.pathname + ubicacion.search)}`);
      }}
    >
      <Icono n="corazon" relleno={activo} />
    </button>
  );
}

export function ChipsServicios({ ids, max = 3 }: { ids?: string[]; max?: number }) {
  const lista = (ids ?? []).map(servicioDe).filter((s): s is NonNullable<typeof s> => Boolean(s));
  if (!lista.length) return null;
  return (
    <div className="fila envolver" style={{ gap: 6 }}>
      {lista.slice(0, max).map((s) => (
        <span key={s.id} className="chip servicio"><Icono n={s.icono} /> {s.etiqueta}</span>
      ))}
      {lista.length > max && <span className="chip servicio">+{lista.length - max}</span>}
    </div>
  );
}

export function TarjetaGaraje({ g, busqueda }: { g: Garaje; busqueda: string }) {
  return (
    <li className="con-corazon">
      <BotonCorazon id={g.id_garaje} className="corazon-tarjeta" />
      <Link to={`/garaje/${g.id_garaje}${busqueda}`} className="card enlace garaje-card">
        <Portada foto={g.foto} alto={140} />
        <div className="fila entre" style={{ alignItems: 'flex-start' }}>
          <div className="col s">
            <h3>{g.nombre}</h3>
            <span className="muted pequeno fila" style={{ gap: 4 }}>
              <span style={{ width: 16, display: 'inline-flex' }}><Icono n="pin" /></span>
              {[g.barrio, g.localidad].filter(Boolean).join(' · ') || g.direccion}
            </span>
          </div>
          <div className="precio centrado">
            {dinero(g.tarifa_hora)}
            <br />
            <small>por hora</small>
          </div>
        </div>
        <div className="fila envolver">
          <Estrellas valor={g.calificacion_promedio} total={g.total_calificaciones} />
          {g.distancia_km !== undefined && <span className="chip primario">{g.distancia_km < 1 ? `${Math.round(g.distancia_km * 1000)} m` : `${g.distancia_km} km`}</span>}
          <span className="chip">{etiquetaVehiculo(g.tipo_vehiculo)}</span>
          {g.cupos_libres !== undefined && <span className="chip">{g.cupos_libres} {g.cupos_libres === 1 ? 'cupo libre' : 'cupos libres'}</span>}
        </div>
        <ChipsServicios ids={g.servicios} />
        {g.costo_estimado !== undefined && (
          <div className="fila entre" style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '8px 12px' }}>
            <span className="muted pequeno">Tu reserva costaría</span>
            <b>{dinero(g.costo_estimado)}</b>
          </div>
        )}
      </Link>
    </li>
  );
}

/**
 * Las dos formas de usar ParkSpotter, a la vista desde la portada:
 *  · quien NECESITA parquear (conductor) baja al buscador;
 *  · quien TIENE un garaje (arrendador) va a publicarlo (o a su panel si ya es propietario).
 */
function DosCaminos() {
  const { usuario } = useSesion();
  const esDueno = Boolean(usuario?.es_propietario);
  const irABuscar = () => document.getElementById('buscador')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <section className="dos-caminos" aria-label="¿Qué quieres hacer?">
      <button type="button" className="camino" onClick={irABuscar}>
        <span className="camino-icono"><Icono n="carro" /></span>
        <b>Necesito parqueadero</b>
        <span>Busca, compara y reserva un garaje por horas.</span>
      </button>
      <Link
        className="camino camino-dueno"
        to={esDueno ? '/propietario' : usuario ? '/propietario' : '/registro?rol=propietario&volver=/propietario'}
      >
        <span className="camino-icono"><Icono n="casa" /></span>
        <b>{esDueno ? 'Administrar mis garajes' : 'Tengo un garaje'}</b>
        <span>{esDueno ? 'Solicitudes, opiniones y ganancias.' : 'Publícalo y gana dinero cuando no lo uses.'}</span>
      </Link>
    </section>
  );
}

export function Buscar() {
  useTitulo('');
  const [params, setParams] = useSearchParams();
  const hoy = hoyBogota();

  // La búsqueda vive en la URL: al volver desde un garaje se conservan los filtros.
  const lat = params.get('lat');
  const lng = params.get('lng');
  const donde = params.get('donde') ?? '';
  const fecha = params.get('fecha') ?? '';
  const desde = params.get('desde') ?? '';
  const hasta = params.get('hasta') ?? '';
  const vehiculo = params.get('vehiculo') ?? '';
  const precioMax = params.get('precio_max') ?? '';
  const orden = params.get('orden') ?? '';
  const serviciosParam = params.get('servicios') ?? '';
  const serviciosSel = serviciosParam.split(',').filter(Boolean);

  const [texto, setTexto] = useState(donde);
  const [garajes, setGarajes] = useState<Garaje[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [buscandoLugar, setBuscandoLugar] = useState(false);
  const [vista, setVista] = useState<'lista' | 'mapa'>('lista');

  const yo = lat && lng && donde === 'Mi ubicación' ? { lat: Number(lat), lng: Number(lng) } : null;

  useEffect(() => setTexto(donde), [donde]);

  const consulta = useMemo(() => {
    const q = new URLSearchParams();
    if (lat && lng) {
      q.set('lat', lat);
      q.set('lng', lng);
      q.set('radio_km', '5');
    } else if (donde) q.set('q', donde); // sin coordenadas: filtra por nombre, barrio o localidad
    if (fecha) q.set('fecha', fecha);
    if (fecha && desde && hasta) {
      q.set('desde', desde);
      q.set('hasta', hasta);
    }
    if (vehiculo) q.set('vehiculo', vehiculo);
    if (precioMax) q.set('precio_max', precioMax);
    if (orden) q.set('orden', orden);
    if (serviciosParam) q.set('servicios', serviciosParam);
    return q.toString();
  }, [lat, lng, donde, fecha, desde, hasta, vehiculo, precioMax, orden, serviciosParam]);

  useEffect(() => {
    let vigente = true;
    setError(null);
    api
      .get<{ garajes: Garaje[] }>(`/garajes?${consulta}`)
      .then((r) => vigente && setGarajes(r.garajes))
      .catch((e) => {
        if (vigente) {
          setError(mensajeDeError(e));
          setGarajes([]);
        }
      });
    return () => {
      vigente = false;
    };
  }, [consulta]);

  function cambiar(cambios: Record<string, string | null>) {
    const siguiente = new URLSearchParams(params);
    for (const [k, v] of Object.entries(cambios)) {
      if (v) siguiente.set(k, v);
      else siguiente.delete(k);
    }
    setParams(siguiente, { replace: true });
  }

  async function buscarLugar(e?: FormEvent) {
    e?.preventDefault();
    const t = texto.trim();
    setAviso(null);
    if (!t) return cambiar({ donde: null, lat: null, lng: null });
    setBuscandoLugar(true);
    try {
      const lugar = await geocodificar(t);
      if (lugar) cambiar({ donde: t, lat: String(lugar.lat), lng: String(lugar.lng) });
      else {
        setAviso(`No ubicamos «${t}» en el mapa; mostramos garajes que coinciden con ese nombre.`);
        cambiar({ donde: t, lat: null, lng: null });
      }
    } catch {
      setAviso('No se pudo consultar el mapa; filtramos por nombre de barrio o garaje.');
      cambiar({ donde: t, lat: null, lng: null });
    } finally {
      setBuscandoLugar(false);
    }
  }

  async function usarMiUbicacion() {
    setBuscandoLugar(true);
    setAviso(null);
    try {
      const p = await ubicacionActual();
      cambiar({ donde: 'Mi ubicación', lat: String(p.lat), lng: String(p.lng) });
    } catch (e) {
      setAviso(mensajeDeError(e));
    } finally {
      setBuscandoLugar(false);
    }
  }

  const ahora = minutosAhoraBogota();
  const horasDesde = HORAS.filter((h) => fecha !== hoy || aMinutos(h) > ahora);
  const horasHasta = HORAS.slice(1).concat('24:00').filter((h) => !desde || aMinutos(h) > aMinutos(desde));
  const nFiltros = [fecha, vehiculo, precioMax].filter(Boolean).length + serviciosSel.length;
  const alternarServicio = (id: string) =>
    cambiar({ servicios: (serviciosSel.includes(id) ? serviciosSel.filter((s) => s !== id) : [...serviciosSel, id]).join(',') || null });
  const busqueda = params.toString() ? `?${params.toString()}` : '';

  return (
    <>
      <BannerInstalar />
      <section className="hero">
        <h1>Parqueadero cerca de tu destino</h1>
        <p>Garajes privados de Bogotá, reservados en minutos.</p>
      </section>
      <DosCaminos />

      <form id="buscador" className="card filtros" onSubmit={buscarLugar} role="search" style={{ marginBottom: 16, scrollMarginTop: 72 }}>
        <div className="fila">
          <div className="busqueda-ubicacion grow">
            <Icono n="buscar" />
            <input
              className="entrada"
              type="search"
              enterKeyHint="search"
              placeholder="¿A dónde vas? Ej: Javeriana, Zona T"
              aria-label="Destino"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              autoComplete="off"
            />
          </div>
          <button type="button" className="btn icono suave" onClick={() => void usarMiUbicacion()} aria-label="Usar mi ubicación" title="Usar mi ubicación">
            <Icono n="mira" />
          </button>
        </div>

        <div className="grid3">
          <div className="campo">
            <label htmlFor="f-fecha">Día</label>
            <input
              id="f-fecha"
              className="entrada"
              type="date"
              min={hoy}
              max={sumarDias(hoy, 60)}
              value={fecha}
              onChange={(e) => cambiar({ fecha: e.target.value || null, desde: e.target.value ? desde || null : null, hasta: e.target.value ? hasta || null : null })}
            />
          </div>
          <div className="campo">
            <label htmlFor="f-desde">Entrada</label>
            <select id="f-desde" className="entrada" disabled={!fecha} value={desde} onChange={(e) => cambiar({ desde: e.target.value || null, hasta: hasta && aMinutos(hasta) <= aMinutos(e.target.value) ? null : hasta || null })}>
              <option value="">Cualquiera</option>
              {horasDesde.map((h) => (
                <option key={h} value={h}>{hora12(h)}</option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="f-hasta">Salida</label>
            <select id="f-hasta" className="entrada" disabled={!fecha || !desde} value={hasta} onChange={(e) => cambiar({ hasta: e.target.value || null })}>
              <option value="">Elige</option>
              {horasHasta.map((h) => (
                <option key={h} value={h}>{hora12(h)}</option>
              ))}
            </select>
          </div>
        </div>
        {fecha && desde && !hasta && <span className="ayuda">Elige la hora de salida para ver solo los garajes libres en ese horario.</span>}

        <details className="mas" open={Boolean(vehiculo || precioMax || serviciosParam)}>
          <summary>Más filtros{nFiltros ? ` (${nFiltros})` : ''}</summary>
          <div className="grid2">
            <div className="campo">
              <label htmlFor="f-veh">Vehículo</label>
              <select id="f-veh" className="entrada" value={vehiculo} onChange={(e) => cambiar({ vehiculo: e.target.value || null })}>
                <option value="">Carro o moto</option>
                <option value="carro">Carro</option>
                <option value="moto">Moto</option>
              </select>
            </div>
            <div className="campo">
              <label htmlFor="f-precio">Precio máx. por hora</label>
              <select id="f-precio" className="entrada" value={precioMax} onChange={(e) => cambiar({ precio_max: e.target.value || null })}>
                <option value="">Sin límite</option>
                {[3000, 4000, 5000, 6000, 8000].map((p) => (
                  <option key={p} value={p}>{dinero(p)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="campo" role="group" aria-label="Servicios">
            <span className="etiqueta">Servicios</span>
            <div className="fila envolver" style={{ gap: 8 }}>
              {SERVICIOS.map((s) => (
                <button key={s.id} type="button" className="chip" aria-pressed={serviciosSel.includes(s.id)} onClick={() => alternarServicio(s.id)}>
                  <Icono n={s.icono} /> {s.etiqueta}
                </button>
              ))}
            </div>
          </div>
        </details>

        <button className="btn bloque" disabled={buscandoLugar}>
          {buscandoLugar ? <span className="spinner" /> : <><Icono n="buscar" /> Buscar parqueadero</>}
        </button>
      </form>

      {aviso && <div style={{ marginBottom: 12 }}><Alerta tipo="aviso">{aviso}</Alerta></div>}
      {error && <div style={{ marginBottom: 12 }}><Alerta>{error}</Alerta></div>}

      <div className="fila entre" style={{ marginBottom: 12 }}>
        <h2 aria-live="polite">
          {garajes === null ? 'Buscando…' : `${garajes.length} ${garajes.length === 1 ? 'garaje' : 'garajes'}`}
          {donde && lat && <span className="muted" style={{ fontWeight: 500 }}> cerca de {donde}</span>}
        </h2>
        <select className="entrada" style={{ width: 'auto', minHeight: 40 }} aria-label="Ordenar por" value={orden} onChange={(e) => cambiar({ orden: e.target.value || null })}>
          <option value="">{lat ? 'Más cercano' : 'Menor precio'}</option>
          {lat && <option value="precio">Menor precio</option>}
          <option value="calificacion">Mejor calificado</option>
        </select>
      </div>

      <div className="segmentado solo-movil" role="group" aria-label="Vista" style={{ marginBottom: 12 }}>
        <button type="button" className="segmento" aria-pressed={vista === 'lista'} onClick={() => setVista('lista')}>Lista</button>
        <button type="button" className="segmento" aria-pressed={vista === 'mapa'} onClick={() => setVista('mapa')}>Mapa</button>
      </div>

      {garajes === null ? (
        <Esqueletos />
      ) : (
        <div className="resultados">
          <div className={vista === 'mapa' ? 'oculto-movil' : undefined}>
            {garajes.length === 0 ? (
              <div className="card">
                <Vacio icono="buscar" titulo="No encontramos garajes">
                  <p>Prueba con otro horario, quita algún filtro o amplía la zona.</p>
                  <button className="btn suave" onClick={() => setParams({}, { replace: true })}>Limpiar filtros</button>
                </Vacio>
              </div>
            ) : (
              <ul className="lista">
                {garajes.map((g) => (
                  <TarjetaGaraje key={g.id_garaje} g={g} busqueda={busqueda} />
                ))}
              </ul>
            )}
          </div>
          <div className="mapa-lado" style={vista === 'lista' ? undefined : { display: 'block' }}>
            {(vista === 'mapa' || window.matchMedia('(min-width: 880px)').matches) && <MapaGarajes garajes={garajes} yo={yo} />}
          </div>
        </div>
      )}
    </>
  );
}
