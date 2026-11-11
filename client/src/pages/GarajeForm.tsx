import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, mensajeDeError } from '../api';
import { useAvisos } from '../avisos';
import { DiasBloqueados } from '../DiasBloqueados';
import { BotonFoto } from '../fotos';
import { DIAS_CORTOS, INICIALES_DIAS, aMinutos, deMinutos, hora12 } from '../format';
import { ubicacionActual, ubicarDireccion as buscarDireccion, type Precision } from '../geocodificar';
import { useTitulo } from '../hooks';
import { MapaSelector } from '../mapas';
import { SERVICIOS } from '../servicios';
import type { FotoGaraje, GarajePropio, TipoVehiculoGaraje } from '../types';
import { Alerta, Esqueletos, Icono } from '../ui';

const LOCALIDADES = [
  'Usaquén', 'Chapinero', 'Santa Fe', 'San Cristóbal', 'Usme', 'Tunjuelito', 'Bosa', 'Kennedy', 'Fontibón', 'Engativá',
  'Suba', 'Barrios Unidos', 'Teusaquillo', 'Los Mártires', 'Antonio Nariño', 'Puente Aranda', 'La Candelaria',
  'Rafael Uribe Uribe', 'Ciudad Bolívar', 'Sumapaz',
];
const MAX_FOTOS = 6;
const INICIOS = Array.from({ length: 48 }, (_, i) => deMinutos(i * 30));
const FINES = Array.from({ length: 48 }, (_, i) => deMinutos((i + 1) * 30)).map((h) => (h === '00:00' ? '24:00' : h));

interface Regla {
  dias: number[];
  ini: string;
  fin: string;
}

const PRESETS: { texto: string; dias: number[] }[] = [
  { texto: 'Lun–Vie', dias: [1, 2, 3, 4, 5] },
  { texto: 'Fines de semana', dias: [6, 7] },
  { texto: 'Todos los días', dias: [1, 2, 3, 4, 5, 6, 7] },
];

function aReglas(ventanas: { dia_semana: number; hora_inicio: string; hora_fin: string }[]): Regla[] {
  const mapa = new Map<string, Regla>();
  for (const v of ventanas) {
    const k = `${v.hora_inicio}|${v.hora_fin}`;
    const r = mapa.get(k) ?? { dias: [], ini: v.hora_inicio, fin: v.hora_fin };
    r.dias.push(v.dia_semana);
    mapa.set(k, r);
  }
  return [...mapa.values()];
}

export function GarajeForm() {
  const { id } = useParams();
  const editando = Boolean(id);
  useTitulo(editando ? 'Editar garaje' : 'Publicar garaje');
  const navegar = useNavigate();
  const avisos = useAvisos();

  const [cargando, setCargando] = useState(editando);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [f, setF] = useState({
    nombre: '', direccion: '', barrio: '', localidad: '', tarifa_hora: '4000', capacidad_total: '1',
    tipo_vehiculo: 'carro' as TipoVehiculoGaraje, descripcion: '', instrucciones_acceso: '',
  });
  const [servicios, setServicios] = useState<string[]>([]);
  const [punto, setPunto] = useState<{ lat: number; lng: number } | null>(null);
  // Resultado de «Ubicar la dirección»: qué tan precisa fue (null = no se encontró nada).
  const [notaMapa, setNotaMapa] = useState<{ precision: Precision | null; nombre: string } | null>(null);
  const [reglas, setReglas] = useState<Regla[]>([{ dias: [1, 2, 3, 4, 5], ini: '06:00', fin: '20:00' }]);
  const [fotos, setFotos] = useState<FotoGaraje[]>([]); // ya subidas (al editar)
  const [cola, setCola] = useState<string[]>([]); // por subir al publicar un garaje nuevo
  const [subiendo, setSubiendo] = useState(false);
  const cambiar = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!id) return;
    api
      .get<{ garaje: GarajePropio }>(`/propietario/garajes/${id}`)
      .then(({ garaje: g }) => {
        setF({
          nombre: g.nombre, direccion: g.direccion, barrio: g.barrio ?? '', localidad: g.localidad ?? '',
          tarifa_hora: String(g.tarifa_hora), capacidad_total: String(g.capacidad_total), tipo_vehiculo: g.tipo_vehiculo,
          descripcion: g.descripcion ?? '', instrucciones_acceso: g.instrucciones_acceso ?? '',
        });
        setPunto({ lat: g.latitud, lng: g.longitud });
        setReglas(aReglas(g.disponibilidad ?? []));
        setFotos(g.fotos ?? []);
        setServicios(g.servicios ?? []);
      })
      .catch((e) => setError(mensajeDeError(e)))
      .finally(() => setCargando(false));
  }, [id]);

  async function ubicarDireccion() {
    if (!f.direccion.trim()) return setError('Escribe la dirección para ubicarla en el mapa.');
    setBuscando(true);
    setError(null);
    setNotaMapa(null);
    try {
      const lugar = await buscarDireccion({ direccion: f.direccion, barrio: f.barrio, localidad: f.localidad });
      if (lugar) {
        setPunto({ lat: lugar.lat, lng: lugar.lng });
        setNotaMapa({ precision: lugar.precision, nombre: lugar.nombre });
      } else {
        setNotaMapa({ precision: null, nombre: '' });
      }
    } catch (e) {
      avisos.error(mensajeDeError(e));
    } finally {
      setBuscando(false);
    }
  }

  async function ubicarme() {
    setBuscando(true);
    try {
      setPunto(await ubicacionActual());
    } catch (e) {
      avisos.error(mensajeDeError(e));
    } finally {
      setBuscando(false);
    }
  }

  const totalFotos = fotos.length + cola.length;

  async function agregarFotos(nuevas: string[]) {
    const caben = nuevas.slice(0, MAX_FOTOS - totalFotos);
    if (nuevas.length > caben.length) avisos.error(`Máximo ${MAX_FOTOS} fotos por garaje.`);
    if (!editando) return setCola((c) => [...c, ...caben]);
    setSubiendo(true);
    try {
      for (const imagen of caben) {
        const r = await api.post<{ fotos: FotoGaraje[] }>(`/propietario/garajes/${id}/fotos`, { imagen });
        setFotos(r.fotos);
      }
    } catch (e) {
      avisos.error(mensajeDeError(e));
    } finally {
      setSubiendo(false);
    }
  }

  async function borrarFoto(idFoto: number) {
    try {
      const r = await api.delete<{ fotos: FotoGaraje[] }>(`/propietario/garajes/${id}/fotos/${idFoto}`);
      setFotos(r.fotos);
    } catch (e) {
      avisos.error(mensajeDeError(e));
    }
  }

  async function fotoPrincipal(idFoto: number) {
    try {
      const r = await api.post<{ fotos: FotoGaraje[] }>(`/propietario/garajes/${id}/fotos/${idFoto}/principal`);
      setFotos(r.fotos);
    } catch (e) {
      avisos.error(mensajeDeError(e));
    }
  }

  const actualizarRegla = (i: number, cambios: Partial<Regla>) => setReglas((rs) => rs.map((r, j) => (j === i ? { ...r, ...cambios } : r)));
  const alternarDia = (i: number, d: number) =>
    setReglas((rs) => rs.map((r, j) => (j === i ? { ...r, dias: r.dias.includes(d) ? r.dias.filter((x) => x !== d) : [...r.dias, d].sort() } : r)));

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!punto) return setError('Marca en el mapa dónde queda tu garaje.');
    for (const r of reglas) {
      if (r.dias.length === 0) return setError('Cada horario debe tener al menos un día seleccionado.');
      if (aMinutos(r.ini) >= aMinutos(r.fin)) return setError('En cada horario, la hora de cierre debe ser posterior a la de apertura.');
    }
    const disponibilidad = reglas.flatMap((r) => r.dias.map((d) => ({ dia_semana: d, hora_inicio: r.ini, hora_fin: r.fin })));
    setEnviando(true);
    try {
      const cuerpo = {
        ...f,
        tarifa_hora: Number(f.tarifa_hora),
        capacidad_total: Number(f.capacidad_total),
        latitud: punto.lat,
        longitud: punto.lng,
        servicios,
        disponibilidad,
      };
      if (editando) await api.put(`/propietario/garajes/${id}`, cuerpo);
      else {
        const r = await api.post<{ garaje: { id_garaje: number } }>('/propietario/garajes', cuerpo);
        let fallidas = 0;
        for (const imagen of cola) {
          try {
            await api.post(`/propietario/garajes/${r.garaje.id_garaje}/fotos`, { imagen });
          } catch {
            fallidas += 1;
          }
        }
        if (fallidas) avisos.error(`Publicado, pero ${fallidas} foto(s) no se pudieron subir. Agrégalas desde «Editar».`);
      }
      avisos.ok(editando ? 'Cambios guardados.' : '¡Garaje publicado!');
      navegar('/propietario');
    } catch (err) {
      setError(mensajeDeError(err));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setEnviando(false);
    }
  }

  if (cargando) return <Esqueletos n={2} />;

  return (
    <form className="col l" onSubmit={enviar} style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="col">
        <Link to="/propietario">← Mis garajes</Link>
        <h1>{editando ? 'Editar garaje' : 'Publica tu garaje'}</h1>
      </div>
      {error && <Alerta>{error}</Alerta>}

      <section className="card col">
        <h2>Datos básicos</h2>
        <div className="campo">
          <label htmlFor="g-nombre">Nombre de la publicación</label>
          <input id="g-nombre" className="entrada" value={f.nombre} onChange={(e) => cambiar('nombre')(e.target.value)} required minLength={3} maxLength={100} placeholder="Ej: Garaje cubierto cerca a la Javeriana" />
        </div>
        <div className="campo">
          <label htmlFor="g-dir">Dirección</label>
          <input id="g-dir" className="entrada" value={f.direccion} onChange={(e) => cambiar('direccion')(e.target.value)} required minLength={5} maxLength={150} placeholder="Ej: Cra. 7 # 40-30" autoComplete="street-address" />
        </div>
        <div className="grid2">
          <div className="campo">
            <label htmlFor="g-barrio">Barrio</label>
            <input id="g-barrio" className="entrada" value={f.barrio} onChange={(e) => cambiar('barrio')(e.target.value)} maxLength={50} />
          </div>
          <div className="campo">
            <label htmlFor="g-loc">Localidad</label>
            <select id="g-loc" className="entrada" value={f.localidad} onChange={(e) => cambiar('localidad')(e.target.value)}>
              <option value="">Elige</option>
              {LOCALIDADES.map((l) => <option key={l}>{l}</option>)}
            </select>
          </div>
        </div>
      </section>

      <section className="card col">
        <h2>Ubicación en el mapa</h2>
        <p className="muted pequeno">Toca el mapa o arrastra el pin hasta la entrada de tu garaje. Los conductores lo usarán para llegar.</p>
        <div className="fila envolver">
          <button type="button" className="btn suave s" onClick={() => void ubicarDireccion()} disabled={buscando}><Icono n="buscar" /> Ubicar la dirección</button>
          <button type="button" className="btn secundario s" onClick={() => void ubicarme()} disabled={buscando}><Icono n="mira" /> Estoy aquí</button>
          {buscando && <span className="spinner" />}
        </div>
        {notaMapa && (
          <Alerta tipo={notaMapa.precision === 'exacta' ? 'ok' : 'aviso'}>
            {notaMapa.precision === null
              ? 'No encontramos esa dirección en el buscador (las direcciones de Bogotá están poco mapeadas). Toca el mapa en el lugar exacto de tu garaje.'
              : notaMapa.precision === 'exacta'
                ? `Ubicamos «${notaMapa.nombre}». Confirma que el pin quede sobre tu garaje.`
                : notaMapa.precision === 'calle'
                  ? `Encontramos la vía («${notaMapa.nombre}») pero no el número exacto. Arrastra el pin o toca el mapa en la entrada de tu garaje.`
                  : `Solo pudimos ubicar la zona («${notaMapa.nombre}»). Acerca el mapa y toca el lugar exacto de tu garaje.`}
          </Alerta>
        )}
        <MapaSelector lat={punto?.lat ?? null} lng={punto?.lng ?? null} onElegir={(lat, lng) => { setPunto({ lat, lng }); setNotaMapa(null); }} />
        <span className="ayuda">{punto ? `Ubicación marcada (${punto.lat.toFixed(5)}, ${punto.lng.toFixed(5)})` : 'Aún no has marcado la ubicación.'}</span>
      </section>

      <section className="card col">
        <h2>Fotos</h2>
        <p className="muted pequeno">Las fotos generan confianza: muestra la entrada, el espacio y la altura. La primera es la portada (hasta {MAX_FOTOS}).</p>
        {totalFotos > 0 && (
          <ul className="galeria-edicion">
            {fotos.map((fo, i) => (
              <li key={fo.id_foto}>
                <img src={fo.url} alt={`Foto ${i + 1} del garaje`} />
                {i === 0 ? (
                  <span className="chip primario portada-chip">Portada</span>
                ) : (
                  <button type="button" className="btn icono secundario hacer-portada" aria-label="Hacer portada" onClick={() => void fotoPrincipal(fo.id_foto)}><Icono n="estrella" /></button>
                )}
                <button type="button" className="btn icono peligro quitar-foto" aria-label="Borrar foto" onClick={() => void borrarFoto(fo.id_foto)}><Icono n="basura" /></button>
              </li>
            ))}
            {cola.map((src, i) => (
              <li key={`n${i}`}>
                <img src={src} alt={`Foto nueva ${i + 1}`} />
                {fotos.length === 0 && i === 0 && <span className="chip primario portada-chip">Portada</span>}
                <button type="button" className="btn icono peligro quitar-foto" aria-label="Quitar foto" onClick={() => setCola((c) => c.filter((_, j) => j !== i))}><Icono n="basura" /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="fila envolver">
          <BotonFoto multiple onFotos={agregarFotos} onError={avisos.error} disabled={subiendo || totalFotos >= MAX_FOTOS}>
            {subiendo ? <span className="spinner" /> : <><Icono n="camara" /> {totalFotos ? 'Agregar otra foto' : 'Subir fotos'}</>}
          </BotonFoto>
          <span className="ayuda">{totalFotos}/{MAX_FOTOS}</span>
        </div>
      </section>

      <section className="card col">
        <h2>Tarifa y espacio</h2>
        <div className="grid2">
          <div className="campo">
            <label htmlFor="g-tarifa">Tarifa por hora (COP)</label>
            <input id="g-tarifa" className="entrada" type="number" inputMode="numeric" min={500} max={100000} step={100} value={f.tarifa_hora} onChange={(e) => cambiar('tarifa_hora')(e.target.value)} required />
          </div>
          <div className="campo">
            <label htmlFor="g-cupos">Cupos disponibles</label>
            <input id="g-cupos" className="entrada" type="number" inputMode="numeric" min={1} max={50} value={f.capacidad_total} onChange={(e) => cambiar('capacidad_total')(e.target.value)} required />
          </div>
        </div>
        <div className="campo">
          <span className="etiqueta" id="g-veh">Admite</span>
          <div className="segmentado" role="group" aria-labelledby="g-veh">
            {(['carro', 'moto', 'ambos'] as const).map((v) => (
              <button key={v} type="button" className="segmento" aria-pressed={f.tipo_vehiculo === v} onClick={() => cambiar('tipo_vehiculo')(v)}>
                {v === 'carro' ? 'Carros' : v === 'moto' ? 'Motos' : 'Ambos'}
              </button>
            ))}
          </div>
        </div>
        <div className="campo">
          <label htmlFor="g-desc">Descripción</label>
          <textarea id="g-desc" className="entrada" value={f.descripcion} onChange={(e) => cambiar('descripcion')(e.target.value)} maxLength={500} placeholder="Altura máxima, si es cubierto, seguridad, referencias cercanas…" />
        </div>
        <div className="campo">
          <label htmlFor="g-acc">Instrucciones de acceso (privadas)</label>
          <textarea id="g-acc" className="entrada" value={f.instrucciones_acceso} onChange={(e) => cambiar('instrucciones_acceso')(e.target.value)} maxLength={500} placeholder="Cómo entrar, a quién llamar, piso o puerta…" />
          <span className="ayuda">Solo las ve quien tenga una reserva confirmada.</span>
        </div>
      </section>

      <section className="card col">
        <h2>Servicios</h2>
        <p className="muted pequeno">Marca lo que ofrece tu garaje: los conductores pueden filtrar la búsqueda por estos servicios.</p>
        <div className="fila envolver" style={{ gap: 8 }} role="group" aria-label="Servicios del garaje">
          {SERVICIOS.map((s) => (
            <button
              key={s.id}
              type="button"
              className="chip"
              aria-pressed={servicios.includes(s.id)}
              onClick={() => setServicios((l) => (l.includes(s.id) ? l.filter((x) => x !== s.id) : [...l, s.id]))}
            >
              <Icono n={s.icono} /> {s.etiqueta}
            </button>
          ))}
        </div>
      </section>

      <section className="card col">
        <h2>Horarios disponibles</h2>
        <p className="muted pequeno">Indica en qué días y horas puede parquear alguien en tu garaje. Las reservas son por bloques de 30 minutos.</p>
        <div className="fila envolver">
          {PRESETS.map((p) => (
            <button key={p.texto} type="button" className="chip" onClick={() => setReglas((rs) => [...rs, { dias: p.dias, ini: '08:00', fin: '18:00' }])}>
              <Icono n="mas" /> {p.texto}
            </button>
          ))}
        </div>
        {reglas.map((r, i) => (
          <div key={i} className="regla-horario">
            <div className="dias" role="group" aria-label="Días">
              {INICIALES_DIAS.map((l, k) => (
                <button key={k} type="button" aria-pressed={r.dias.includes(k + 1)} aria-label={DIAS_CORTOS[k]} onClick={() => alternarDia(i, k + 1)}>{l}</button>
              ))}
            </div>
            <div className="grid2">
              <div className="campo">
                <label htmlFor={`ini-${i}`}>Abre</label>
                <select id={`ini-${i}`} className="entrada" value={r.ini} onChange={(e) => actualizarRegla(i, { ini: e.target.value })}>
                  {INICIOS.map((h) => <option key={h} value={h}>{hora12(h)}</option>)}
                </select>
              </div>
              <div className="campo">
                <label htmlFor={`fin-${i}`}>Cierra</label>
                <select id={`fin-${i}`} className="entrada" value={r.fin} onChange={(e) => actualizarRegla(i, { fin: e.target.value })}>
                  {FINES.map((h) => <option key={h} value={h}>{h === '24:00' ? '12:00 a. m. (medianoche)' : hora12(h)}</option>)}
                </select>
              </div>
            </div>
            {reglas.length > 1 && (
              <button type="button" className="btn peligro s" style={{ alignSelf: 'flex-start' }} onClick={() => setReglas((rs) => rs.filter((_, j) => j !== i))}>Quitar horario</button>
            )}
          </div>
        ))}
        <button type="button" className="btn secundario s" style={{ alignSelf: 'flex-start' }} onClick={() => setReglas((rs) => [...rs, { dias: [], ini: '08:00', fin: '18:00' }])}>
          <Icono n="mas" /> Agregar otro horario
        </button>
      </section>

      {editando && id && <DiasBloqueados idGaraje={id} />}

      <button className="btn bloque" disabled={enviando}>
        {enviando ? <span className="spinner" /> : editando ? 'Guardar cambios' : 'Publicar garaje'}
      </button>
    </form>
  );
}
