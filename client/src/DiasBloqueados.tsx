import { useState } from 'react';
import { api, mensajeDeError } from './api';
import { useAvisos } from './avisos';
import { fechaLarga, hoyBogota, sumarDias } from './format';
import { useCarga } from './hooks';
import type { Bloqueo } from './types';
import { Alerta, Icono } from './ui';

/**
 * Días en que el garaje no recibe reservas (vacaciones, arreglos…). Va dentro del formulario de edición,
 * por eso ningún botón envía el formulario (todos son type="button") y no usa <form> propio.
 */
export function DiasBloqueados({ idGaraje }: { idGaraje: string }) {
  const avisos = useAvisos();
  const hoy = hoyBogota();
  const { datos, error, recargar } = useCarga(() => api.get<{ bloqueos: Bloqueo[] }>(`/propietario/garajes/${idGaraje}/bloqueos`), [idGaraje]);
  const [fecha, setFecha] = useState(sumarDias(hoy, 1));
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [problema, setProblema] = useState<string | null>(null);

  async function bloquear() {
    setOcupado(true);
    setProblema(null);
    try {
      await api.post(`/propietario/garajes/${idGaraje}/bloqueos`, { fecha, motivo: motivo.trim() || undefined });
      avisos.ok('Día bloqueado: nadie podrá reservar ese día.');
      setMotivo('');
      setFecha(sumarDias(fecha, 1));
      await recargar(true);
    } catch (e) {
      setProblema(mensajeDeError(e));
    } finally {
      setOcupado(false);
    }
  }

  async function quitar(f: string) {
    try {
      await api.delete(`/propietario/garajes/${idGaraje}/bloqueos/${f}`);
      avisos.ok('Día desbloqueado.');
      await recargar(true);
    } catch (e) {
      avisos.error(mensajeDeError(e));
    }
  }

  const lista = datos?.bloqueos ?? [];
  return (
    <section className="card col">
      <h2>Días sin servicio</h2>
      <p className="muted pequeno">
        Bloquea los días en que no quieres recibir reservas (vacaciones, arreglos…). No se puede bloquear un día que ya tenga
        reservas pendientes o confirmadas: primero respóndelas o cancélalas.
      </p>
      {error && <Alerta>{error}</Alerta>}
      {lista.length > 0 && (
        <ul className="lista-bloqueos">
          {lista.map((b) => (
            <li key={b.fecha}>
              <div className="col" style={{ gap: 0 }}>
                <span className="fuerte primera-mayuscula">{fechaLarga(b.fecha)}</span>
                {b.motivo && <span className="muted pequeno">{b.motivo}</span>}
              </div>
              <button type="button" className="btn icono fantasma" aria-label={`Desbloquear ${fechaLarga(b.fecha)}`} onClick={() => void quitar(b.fecha)}>
                <Icono n="x" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid2">
        <div className="campo">
          <label htmlFor="bq-fecha">Día a bloquear</label>
          <input id="bq-fecha" className="entrada" type="date" min={hoy} max={sumarDias(hoy, 365)} value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="bq-motivo">Motivo (opcional)</label>
          <input id="bq-motivo" className="entrada" maxLength={80} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Vacaciones" />
        </div>
      </div>
      {problema && <Alerta>{problema}</Alerta>}
      <button type="button" className="btn secundario s" style={{ alignSelf: 'flex-start' }} disabled={ocupado || !fecha} onClick={() => void bloquear()}>
        {ocupado ? <span className="spinner" /> : <><Icono n="mas" /> Bloquear este día</>}
      </button>
    </section>
  );
}
