import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, mensajeDeError } from '../api';
import { useSesion } from '../auth';
import { Portada } from '../fotos';
import { dinero, fechaCorta } from '../format';
import { ubicacionActual } from '../geocodificar';
import { useTitulo } from '../hooks';
import type { RespuestaAsistente } from '../types';
import { Estrellas, Icono } from '../ui';

interface Item {
  id: number;
  rol: 'yo' | 'asistente';
  texto: string;
  datos?: RespuestaAsistente;
  error?: boolean;
  pregunta?: string; // la pregunta que originó esta respuesta (para reintentar con la ubicación)
}

const CLAVE = 'parkspotter.asistente';
const INICIALES = [
  'Parqueadero para moto mañana de 8 a 12',
  'Garaje barato en Chapinero hoy a las 3 pm por 2 horas',
  '¿Cómo cancelo una reserva?',
  'Muéstrame mis reservas',
];

interface Reconocimiento {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
const VozNavegador = (window as unknown as { SpeechRecognition?: new () => Reconocimiento; webkitSpeechRecognition?: new () => Reconocimiento }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => Reconocimiento }).webkitSpeechRecognition;

function cargarGuardado(): { items: Item[]; contexto: Record<string, unknown> } {
  try {
    const g = JSON.parse(sessionStorage.getItem(CLAVE) ?? 'null');
    if (g && Array.isArray(g.items)) return g;
  } catch {
    /* sin historial */
  }
  return { items: [], contexto: {} };
}

export function Asistente() {
  useTitulo('Asistente');
  const { usuario } = useSesion();
  const guardado = useRef(cargarGuardado());
  const [items, setItems] = useState<Item[]>(guardado.current.items);
  const [contexto, setContexto] = useState<Record<string, unknown>>(guardado.current.contexto);
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  const [escuchando, setEscuchando] = useState(false);
  const [ubicando, setUbicando] = useState(false);
  const lista = useRef<HTMLDivElement>(null);
  const siguiente = useRef(items.reduce((m, i) => Math.max(m, i.id), 0) + 1);
  const voz = useRef<Reconocimiento | null>(null);

  useEffect(() => {
    sessionStorage.setItem(CLAVE, JSON.stringify({ items: items.slice(-30), contexto }));
    lista.current?.scrollTo({ top: lista.current.scrollHeight, behavior: 'smooth' });
  }, [items, contexto, pensando]);

  const ultimasSugerencias = [...items].reverse().find((i) => i.datos?.sugerencias)?.datos?.sugerencias ?? INICIALES;

  async function preguntar(mensaje: string, ubicacion?: { lat: number; lng: number }, mostrar = true) {
    const m = mensaje.trim();
    if (!m || pensando) return;
    if (mostrar) setItems((l) => [...l, { id: siguiente.current++, rol: 'yo', texto: m }]);
    setTexto('');
    setPensando(true);
    try {
      const r = await api.post<RespuestaAsistente>('/asistente', { mensaje: m, contexto, ...(ubicacion && { ubicacion }) });
      setContexto(r.contexto ?? {});
      setItems((l) => [...l, { id: siguiente.current++, rol: 'asistente', texto: r.respuesta, datos: r, pregunta: m }]);
    } catch (e) {
      setItems((l) => [...l, { id: siguiente.current++, rol: 'asistente', texto: mensajeDeError(e), error: true }]);
    } finally {
      setPensando(false);
    }
  }

  async function conUbicacion(pregunta: string) {
    setUbicando(true);
    try {
      const u = await ubicacionActual();
      await preguntar(pregunta, { lat: u.lat, lng: u.lng }, false);
    } catch (e) {
      setItems((l) => [...l, { id: siguiente.current++, rol: 'asistente', texto: mensajeDeError(e), error: true }]);
    } finally {
      setUbicando(false);
    }
  }

  function dictar() {
    if (!VozNavegador) return;
    if (escuchando) return voz.current?.stop();
    const rec = new VozNavegador();
    voz.current = rec;
    rec.lang = 'es-CO';
    rec.interimResults = false;
    rec.onresult = (e) => {
      const dicho = e.results[0]?.[0]?.transcript ?? '';
      if (dicho) void preguntar(dicho);
    };
    rec.onerror = () => setEscuchando(false);
    rec.onend = () => setEscuchando(false);
    setEscuchando(true);
    rec.start();
  }

  function nueva() {
    setItems([]);
    setContexto({});
    sessionStorage.removeItem(CLAVE);
  }

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    void preguntar(texto);
  };
  const alTeclear = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void preguntar(texto);
    }
  };

  return (
    <div className="asistente">
      <div className="asistente-cabeza">
        <span className="asistente-icono" aria-hidden="true"><Icono n="chispa" /></span>
        <div className="col s grow">
          <b>Asistente ParkSpotter</b>
          <span className="muted pequeno">Busca parqueadero hablando normal, consulta tus reservas o resuelve dudas.</span>
        </div>
        {items.length > 0 && <button type="button" className="btn fantasma s" onClick={nueva}>Nueva</button>}
      </div>

      <div className="asistente-lista" ref={lista} role="log" aria-live="polite">
        <div className="burbuja otra">
          <span>
            ¡Hola{usuario ? `, ${usuario.nombre}` : ''}! Cuéntame qué necesitas, por ejemplo: <i>«moto en Chapinero mañana de 8 a 12»</i>.
            Puedo buscar parqueaderos disponibles, mostrarte tus reservas y explicarte cómo funciona todo.
          </span>
        </div>

        {items.map((i) => (
          <div key={i.id} className={`asistente-item ${i.rol}`}>
            <div className={`burbuja ${i.rol === 'yo' ? 'mia' : 'otra'} ${i.error ? 'error' : ''}`}>
              <span>{i.texto}</span>
            </div>

            {i.datos?.garajes && i.datos.garajes.length > 0 && (
              <ul className="asistente-tarjetas">
                {i.datos.garajes.map((g) => (
                  <li key={g.id_garaje}>
                    <Link to={g.enlace} className="card enlace tarjeta-mini">
                      <Portada foto={g.foto} alto={92} />
                      <div className="col s" style={{ padding: '0 2px' }}>
                        <b className="recorte">{g.nombre}</b>
                        <span className="muted pequeno recorte">{[g.barrio, g.localidad].filter(Boolean).join(' · ')}</span>
                        <Estrellas valor={g.calificacion_promedio} total={g.total_calificaciones} />
                        <div className="fila entre">
                          <b>{dinero(g.tarifa_hora)}<small className="muted"> /h</small></b>
                          {g.costo_estimado !== null && <span className="chip primario">Total {dinero(g.costo_estimado)}</span>}
                        </div>
                        {g.distancia_km !== null && <span className="muted pequeno">{g.distancia_km < 1 ? `${Math.round(g.distancia_km * 1000)} m` : `${g.distancia_km} km`}</span>}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {i.datos?.enlace && (i.datos.total ?? 0) > (i.datos.garajes?.length ?? 0) && (
              <Link to={i.datos.enlace} className="btn secundario s">Ver los {i.datos.total} resultados</Link>
            )}

            {i.datos?.reservas && i.datos.reservas.length > 0 && (
              <ul className="asistente-reservas">
                {i.datos.reservas.map((r) => (
                  <li key={r.id_reserva}>
                    <Link to={`/reservas/${r.id_reserva}`} className="card enlace fila entre">
                      <span className="col s"><b>{r.garaje}</b><span className="muted pequeno">{fechaCorta(r.fecha)} · {r.hora_inicio}–{r.hora_fin}</span></span>
                      <span className={`chip ${r.estado === 'confirmada' ? 'primario' : ''}`}>{r.estado}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {i.datos?.accion?.tipo === 'login' && <Link to="/login?volver=/asistente" className="btn s">Iniciar sesión</Link>}
            {i.datos?.pedirUbicacion && i.pregunta && (
              <button type="button" className="btn s" disabled={ubicando} onClick={() => void conUbicacion(i.pregunta!)}>
                {ubicando ? <span className="spinner" /> : <><Icono n="mira" /> Usar mi ubicación</>}
              </button>
            )}
          </div>
        ))}

        {pensando && (
          <div className="burbuja otra escribiendo" aria-label="El asistente está escribiendo">
            <i /><i /><i />
          </div>
        )}
      </div>

      <div className="asistente-pie">
        {!pensando && (
          <div className="sugerencias" aria-label="Sugerencias">
            {ultimasSugerencias.map((s) => (
              <button key={s} type="button" className="chip" onClick={() => void preguntar(s)}>{s}</button>
            ))}
          </div>
        )}
        <form className="chat-envio" onSubmit={enviar}>
          <textarea
            className="entrada"
            rows={1}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={alTeclear}
            maxLength={300}
            placeholder={escuchando ? 'Te escucho…' : 'Escribe lo que necesitas…'}
            aria-label="Mensaje para el asistente"
            enterKeyHint="send"
          />
          {VozNavegador && (
            <button type="button" className={`btn icono secundario ${escuchando ? 'grabando' : ''}`} aria-label={escuchando ? 'Detener dictado' : 'Dictar con la voz'} aria-pressed={escuchando} onClick={dictar}>
              <Icono n="micro" />
            </button>
          )}
          <button className="btn icono" disabled={pensando || !texto.trim()} aria-label="Enviar">
            <Icono n="enviar" />
          </button>
        </form>
      </div>
    </div>
  );
}
