import { useState, type FormEvent } from 'react';
import { api, mensajeDeError } from '../api';
import { useAvisos } from '../avisos';
import { fechaCorta } from '../format';
import { useCarga } from '../hooks';
import type { Opinion } from '../types';
import { Alerta, Esqueletos, Estrellas, Vacio } from '../ui';

interface Respuesta {
  sin_responder: number;
  opiniones: Opinion[];
}

function TarjetaOpinion({ o, onCambio }: { o: Opinion; onCambio: () => void }) {
  const avisos = useAvisos();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(o.respuesta?.texto ?? '');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setError(null);
    try {
      await api.put(`/propietario/opiniones/${o.id_calificacion}/respuesta`, { texto });
      avisos.ok(o.respuesta ? 'Respuesta actualizada.' : 'Respuesta publicada.');
      setEditando(false);
      onCambio();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setOcupado(false);
    }
  }

  async function borrar() {
    setOcupado(true);
    try {
      await api.delete(`/propietario/opiniones/${o.id_calificacion}/respuesta`);
      avisos.ok('Respuesta eliminada.');
      setTexto('');
      onCambio();
    } catch (err) {
      avisos.error(mensajeDeError(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <article className="card col s" aria-label={`Opinión de ${o.autor}`}>
      <div className="fila entre">
        <b>{o.autor}</b>
        <span className="muted pequeno">{fechaCorta(o.fecha.slice(0, 10))}</span>
      </div>
      <span className="muted pequeno">{o.garaje.nombre}</span>
      <Estrellas valor={o.puntuacion} />
      {o.comentario ? <p>{o.comentario}</p> : <p className="muted">Calificó sin comentario.</p>}

      {editando ? (
        <form className="col s" onSubmit={guardar}>
          <div className="campo">
            <label htmlFor={`resp-${o.id_calificacion}`}>Tu respuesta (pública)</label>
            <textarea
              id={`resp-${o.id_calificacion}`}
              className="entrada"
              maxLength={300}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Agradece, aclara o explica lo que cambiaste…"
              autoFocus
            />
            <span className="ayuda">{texto.length}/300 · La verá cualquiera que abra tu garaje.</span>
          </div>
          {error && <Alerta>{error}</Alerta>}
          <div className="acciones">
            <button type="button" className="btn secundario s" onClick={() => { setEditando(false); setError(null); setTexto(o.respuesta?.texto ?? ''); }}>Cancelar</button>
            <button className="btn s" disabled={ocupado || texto.trim().length < 2}>{ocupado ? <span className="spinner" /> : 'Publicar respuesta'}</button>
          </div>
        </form>
      ) : o.respuesta ? (
        <div className="resena-respuesta">
          <b>Tu respuesta</b>
          <p>{o.respuesta.texto}</p>
          <div className="acciones">
            <button className="btn secundario s" onClick={() => setEditando(true)}>Editar</button>
            <button className="btn peligro s" disabled={ocupado} onClick={() => void borrar()}>Quitar</button>
          </div>
        </div>
      ) : (
        <div className="acciones">
          <button className="btn suave s" onClick={() => setEditando(true)}>Responder</button>
        </div>
      )}
    </article>
  );
}

/** Pestaña «Opiniones» del propietario: las calificaciones de todos sus garajes, con respuesta pública. */
export function Opiniones({ onCambio }: { onCambio?: () => void }) {
  const { datos, error, cargando, recargar } = useCarga(() => api.get<Respuesta>('/propietario/opiniones'), []);

  if (error) return <Alerta>{error}</Alerta>;
  if (cargando && !datos) return <Esqueletos n={2} />;
  const lista = datos?.opiniones ?? [];
  if (lista.length === 0) {
    return (
      <div className="card">
        <Vacio icono="estrella" titulo="Aún no te han calificado">
          <p>Cuando alguien califique uno de tus garajes después de usarlo, lo verás aquí y podrás responderle.</p>
        </Vacio>
      </div>
    );
  }
  return (
    <div className="lista">
      {datos && datos.sin_responder > 0 && (
        <Alerta tipo="aviso">Tienes {datos.sin_responder} {datos.sin_responder === 1 ? 'opinión' : 'opiniones'} sin responder. Responder a tiempo genera confianza.</Alerta>
      )}
      {lista.map((o) => <TarjetaOpinion key={o.id_calificacion} o={o} onCambio={() => { void recargar(true); onCambio?.(); }} />)}
    </div>
  );
}
