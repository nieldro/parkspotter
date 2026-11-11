import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { api, mensajeDeError } from './api';
import { Avatar } from './fotos';
import type { Mensaje } from './types';
import { Alerta, Icono } from './ui';

const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
const dia = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
const mismoDia = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString();

// Respuestas de un toque, según quién escribe: lo que casi siempre hay que decir antes de llegar.
const RAPIDOS = {
  conductor: ['Voy en camino', 'Ya llegué', '¿Me abren el portón?', '¿Cómo entro?'],
  propietario: ['Te estoy esperando', 'Ya te abro', 'Entra por el portón principal', 'Llámame al llegar'],
};

/** Chat de una reserva entre conductor y propietario. Se actualiza solo cada pocos segundos. */
export function Chat({ idReserva, otro, abiertoInicial, vista = 'conductor' }: { idReserva: number; otro: { nombre: string; foto?: string | null }; abiertoInicial: boolean; vista?: 'conductor' | 'propietario' }) {
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [puedeEscribir, setPuedeEscribir] = useState(abiertoInicial);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargado, setCargado] = useState(false);
  const ultimo = useRef(0);
  const lista = useRef<HTMLDivElement>(null);
  const pegado = useRef(true); // si la persona estaba al final, seguimos bajando con cada mensaje nuevo

  const traer = useCallback(async () => {
    try {
      const r = await api.get<{ mensajes: Mensaje[]; puede_escribir: boolean }>(`/reservas/${idReserva}/mensajes?despues=${ultimo.current}`);
      setPuedeEscribir(r.puede_escribir);
      if (r.mensajes.length) {
        actividad.current = Date.now();
        ultimo.current = Math.max(ultimo.current, r.mensajes[r.mensajes.length - 1].id_mensaje);
        // Sin repetidos: el mensaje que acabas de enviar puede llegar también por esta consulta.
        setMensajes((m) => {
          const vistos = new Set(m.map((x) => x.id_mensaje));
          const nuevos = r.mensajes.filter((x) => !vistos.has(x.id_mensaje));
          return nuevos.length ? [...m, ...nuevos] : m;
        });
        if (r.mensajes.some((x) => !x.mio)) window.dispatchEvent(new Event('parkspotter:avisos'));
      }
      setError(null);
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setCargado(true);
    }
  }, [idReserva]);

  // Consulta cada 4 s mientras hay conversación reciente y baja a cada 12 s si lleva un minuto en silencio.
  const actividad = useRef(Date.now());
  useEffect(() => {
    let vivo = true;
    let temporizador: ReturnType<typeof setTimeout>;
    const ciclo = async () => {
      if (!vivo) return;
      if (document.visibilityState === 'visible') await traer();
      if (!vivo) return;
      temporizador = setTimeout(() => void ciclo(), Date.now() - actividad.current < 60_000 ? 4000 : 12_000);
    };
    void traer().then(() => {
      if (vivo) temporizador = setTimeout(() => void ciclo(), 4000);
    });
    return () => {
      vivo = false;
      clearTimeout(temporizador);
    };
  }, [traer]);

  useEffect(() => {
    const el = lista.current;
    if (el && pegado.current) el.scrollTop = el.scrollHeight;
  }, [mensajes]);

  async function enviar(e?: FormEvent, rapido?: string) {
    e?.preventDefault();
    const t = (rapido ?? texto).trim();
    if (!t || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await api.post<{ mensaje: Mensaje }>(`/reservas/${idReserva}/mensajes`, { texto: t });
      if (rapido === undefined) setTexto('');
      pegado.current = true;
      actividad.current = Date.now();
      ultimo.current = Math.max(ultimo.current, r.mensaje.id_mensaje);
      setMensajes((m) => (m.some((x) => x.id_mensaje === r.mensaje.id_mensaje) ? m : [...m, r.mensaje]));
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setEnviando(false);
    }
  }

  const alTeclear = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) {
      e.preventDefault();
      void enviar();
    }
  };

  if (cargado && !puedeEscribir && mensajes.length === 0) return null; // chat cerrado y sin historia: no estorba

  return (
    <section className="card chat" aria-label={`Chat con ${otro.nombre}`}>
      <div className="fila chat-cabeza">
        <Avatar foto={otro.foto} nombre={otro.nombre} tam={36} />
        <div className="col s grow">
          <b>Chat con {otro.nombre}</b>
          <span className="muted pequeno">{puedeEscribir ? 'Coordina la llegada, el vehículo o cualquier duda.' : 'El chat de esta reserva está cerrado.'}</span>
        </div>
      </div>

      <div
        className="chat-lista"
        ref={lista}
        role="log"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          pegado.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {!cargado ? (
          <span className="muted pequeno centrado"><span className="spinner" /></span>
        ) : mensajes.length === 0 ? (
          <p className="muted centrado pequeno" style={{ margin: 'auto' }}>Aún no hay mensajes. Escribe el primero.</p>
        ) : (
          mensajes.map((m, i) => (
            <div key={m.id_mensaje} className="chat-bloque">
              {(i === 0 || !mismoDia(mensajes[i - 1].fecha, m.fecha)) && <div className="chat-dia primera-mayuscula">{dia(m.fecha)}</div>}
              <div className={`burbuja ${m.mio ? 'mia' : 'otra'}`}>
                <span>{m.texto}</span>
                <time dateTime={m.fecha}>{hora(m.fecha)}</time>
              </div>
            </div>
          ))
        )}
      </div>

      {error && <Alerta>{error}</Alerta>}
      {puedeEscribir && (
        <div className="chat-rapidos" role="group" aria-label="Mensajes rápidos">
          {RAPIDOS[vista].map((m) => (
            <button key={m} type="button" className="chip" disabled={enviando} onClick={() => void enviar(undefined, m)}>{m}</button>
          ))}
        </div>
      )}
      {puedeEscribir && (
        <form className="chat-envio" onSubmit={(e) => void enviar(e)}>
          <textarea
            className="entrada"
            rows={1}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={alTeclear}
            maxLength={500}
            placeholder="Escribe un mensaje…"
            aria-label="Mensaje"
            enterKeyHint="send"
          />
          <button className="btn icono" disabled={enviando || !texto.trim()} aria-label="Enviar mensaje">
            {enviando ? <span className="spinner" /> : <Icono n="enviar" />}
          </button>
        </form>
      )}
    </section>
  );
}
