import { api } from '../api';
import { dinero, fechaCorta } from '../format';
import { useCarga } from '../hooks';
import type { Estadisticas as Datos } from '../types';
import { Alerta, Esqueletos, Estrellas, Vacio } from '../ui';

// Gráfico de barras en SVG: ingresos ya realizados (sólido) y por recibir (claro), 8 semanas.
function Barras({ semanas }: { semanas: Datos['semanas'] }) {
  const maximo = Math.max(1, ...semanas.map((s) => s.ingresos + s.proyectados));
  const alto = 150;
  const ancho = 100 / semanas.length;
  const resumen = semanas.map((s) => `semana del ${fechaCorta(s.inicio)}: ${dinero(s.ingresos)} realizados y ${dinero(s.proyectados)} por recibir`).join('; ');
  return (
    <figure className="grafico">
      <svg viewBox={`0 0 100 ${alto + 22}`} preserveAspectRatio="none" role="img" aria-label={`Ingresos por semana. ${resumen}`}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1="0" x2="100" y1={alto - alto * f} y2={alto - alto * f} className="rejilla" />
        ))}
        {semanas.map((s, i) => {
          const hReal = (s.ingresos / maximo) * alto;
          const hProy = (s.proyectados / maximo) * alto;
          const x = i * ancho + ancho * 0.18;
          const w = ancho * 0.64;
          return (
            <g key={s.inicio}>
              <rect x={x} y={alto - hReal} width={w} height={hReal} className="barra real" rx="1.2" />
              <rect x={x} y={alto - hReal - hProy} width={w} height={hProy} className="barra proyectada" rx="1.2" />
            </g>
          );
        })}
      </svg>
      <div className="grafico-ejes" aria-hidden="true">
        {semanas.map((s) => (
          <span key={s.inicio}>{fechaCorta(s.inicio).replace(/ de .*/, '')}</span>
        ))}
      </div>
      <figcaption className="fila envolver" style={{ gap: 14, justifyContent: 'center' }}>
        <span className="leyenda"><i className="real" /> Realizados</span>
        <span className="leyenda"><i className="proyectada" /> Por recibir</span>
      </figcaption>
    </figure>
  );
}

export function Estadisticas() {
  const { datos, error, cargando } = useCarga(() => api.get<Datos>('/propietario/estadisticas'), []);
  if (cargando && !datos) return <Esqueletos n={2} />;
  if (error || !datos) return <Alerta>{error ?? 'No pudimos cargar las estadísticas.'}</Alerta>;
  const { totales: t, semanas, por_garaje: garajes, estados } = datos;
  const sinDatos = estados.confirmada + estados.rechazada + estados.cancelada + estados.pendiente === 0;

  if (sinDatos) {
    return (
      <div className="card">
        <Vacio icono="panel" titulo="Todavía no hay datos">
          <p>Cuando recibas y confirmes reservas verás aquí tus ingresos, las horas reservadas y cómo rinde cada garaje.</p>
        </Vacio>
      </div>
    );
  }

  return (
    <div className="col l">
      <div className="stats">
        <div className="stat"><b>{dinero(t.ingresos_realizados)}</b><span>Ingresos realizados</span></div>
        <div className="stat"><b>{dinero(t.ingresos_proyectados)}</b><span>Por recibir</span></div>
        <div className="stat"><b>{t.horas_reservadas} h</b><span>Horas reservadas</span></div>
        <div className="stat"><b>{t.tasa_aceptacion === null ? '–' : `${t.tasa_aceptacion} %`}</b><span>Solicitudes aceptadas</span></div>
      </div>

      <section className="card col">
        <h2>Ingresos por semana</h2>
        <Barras semanas={semanas} />
      </section>

      <section className="card col">
        <h2>Rendimiento por garaje</h2>
        {garajes.length === 0 ? (
          <p className="muted">Aún no hay reservas confirmadas.</p>
        ) : (
          <ul className="ranking">
            {garajes.map((g, i) => {
              const total = g.ingresos + g.proyectados;
              const mayor = garajes[0].ingresos + garajes[0].proyectados || 1;
              return (
                <li key={g.id_garaje}>
                  <div className="fila entre">
                    <span className="fuerte">{i + 1}. {g.nombre}</span>
                    <b>{dinero(total)}</b>
                  </div>
                  <span className="barra-fina"><span style={{ width: `${Math.max(4, (total / mayor) * 100)}%` }} /></span>
                  <span className="muted pequeno">{g.reservas} {g.reservas === 1 ? 'reserva' : 'reservas'} · {g.horas} h realizadas</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card col">
        <h2>Tus solicitudes</h2>
        <div className="fila envolver" style={{ gap: 8 }}>
          <span className="chip primario">Confirmadas: {estados.confirmada}</span>
          <span className="chip">Pendientes: {estados.pendiente}</span>
          <span className="chip">Rechazadas: {estados.rechazada}</span>
          <span className="chip">Canceladas: {estados.cancelada}</span>
        </div>
        <div className="fila" style={{ gap: 10 }}>
          <Estrellas valor={t.calificacion_promedio} total={t.total_calificaciones} />
        </div>
      </section>
    </div>
  );
}
