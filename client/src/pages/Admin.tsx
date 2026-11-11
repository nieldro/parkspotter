import { useState } from 'react';
import { api, mensajeDeError } from '../api';
import { useAvisos } from '../avisos';
import { Link } from 'react-router-dom';
import { dinero, fechaHora } from '../format';
import { useCarga, useTitulo } from '../hooks';
import type { MotivoReporte, ReporteFila } from '../types';
import { Alerta, Esqueletos, Estado, Vacio } from '../ui';

const MOTIVO: Record<MotivoReporte, string> = {
  informacion_falsa: 'Información o fotos falsas',
  no_existe: 'No existe o no está disponible',
  inseguro: 'Lugar inseguro',
  cobro: 'Cobro distinto al publicado',
  otro: 'Otro',
};

interface Resumen {
  usuarios: { total: number; conductores: number; propietarios: number; inactivos: number };
  garajes: { total: number; activos: number; suspendidos: number };
  reservas: Record<string, number>;
  valor_reservas_confirmadas: number;
  reportes_abiertos: number;
}
interface UsuarioFila { id_usuario: number; nombre: string; apellido: string; correo: string; tipo_usuario: string; estado: string }
interface GarajeFila { id_garaje: number; nombre: string; barrio: string | null; tarifa_hora: number; estado: string; propietario: string; correo_propietario: string }

export function Admin() {
  useTitulo('Administración');
  const avisos = useAvisos();
  const [vista, setVista] = useState<'resumen' | 'usuarios' | 'garajes' | 'reportes'>('resumen');
  const resumen = useCarga(() => api.get<Resumen>('/admin/resumen'), []);
  const reportes = useCarga(() => api.get<{ reportes: ReporteFila[] }>('/admin/reportes'), []);
  const usuarios = useCarga(() => api.get<{ usuarios: UsuarioFila[] }>('/admin/usuarios'), []);
  const garajes = useCarga(() => api.get<{ garajes: GarajeFila[] }>('/admin/garajes'), []);

  async function accion(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      avisos.ok(ok);
      void resumen.recargar(true);
      void usuarios.recargar(true);
      void garajes.recargar(true);
      void reportes.recargar(true);
    } catch (e) {
      avisos.error(mensajeDeError(e));
    }
  }

  const r = resumen.datos;
  return (
    <>
      <div className="cabecera-pagina"><div><h1>Administración</h1><p>Moderación y vista general de la plataforma.</p></div></div>
      <div className="segmentado" role="tablist" aria-label="Sección" style={{ marginBottom: 16 }}>
        {(['resumen', 'usuarios', 'garajes', 'reportes'] as const).map((v) => (
          <button key={v} role="tab" className="segmento" aria-selected={vista === v} onClick={() => setVista(v)} style={{ textTransform: 'capitalize' }}>
            {v} {v === 'reportes' && (r?.reportes_abiertos ?? 0) > 0 && <span className="contador">{r?.reportes_abiertos}</span>}
          </button>
        ))}
      </div>

      {vista === 'resumen' && (
        resumen.error ? <Alerta>{resumen.error}</Alerta> : !r ? <Esqueletos n={2} /> : (
          <div className="col l">
            <div className="stats">
              <div className="stat"><b>{r.usuarios.total}</b><span>Usuarios ({r.usuarios.conductores} conductores, {r.usuarios.propietarios} propietarios)</span></div>
              <div className="stat"><b>{r.garajes.activos}/{r.garajes.total}</b><span>Garajes activos</span></div>
              <div className="stat"><b>{Object.values(r.reservas).reduce((a, b) => a + b, 0)}</b><span>Reservas en total</span></div>
              <div className="stat"><b>{dinero(r.valor_reservas_confirmadas)}</b><span>Valor confirmado (simulado)</span></div>
            </div>
            <div className="card col">
              <h2>Reservas por estado</h2>
              <div className="fila envolver">
                {Object.entries(r.reservas).map(([k, n]) => <span key={k} className="fila"><Estado valor={k} /> <b>{n}</b></span>)}
                {Object.keys(r.reservas).length === 0 && <span className="muted">Todavía no hay reservas.</span>}
              </div>
            </div>
          </div>
        )
      )}

      {vista === 'usuarios' && (
        <div className="card scroll-x">
          <table className="tabla">
            <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {usuarios.datos?.usuarios.map((u) => (
                <tr key={u.id_usuario}>
                  <td>{u.nombre} {u.apellido}</td>
                  <td style={{ overflowWrap: 'anywhere' }}>{u.correo}</td>
                  <td>{u.tipo_usuario}</td>
                  <td><Estado valor={u.estado} /></td>
                  <td>
                    {u.tipo_usuario !== 'admin' && (
                      <button className="btn s secundario" onClick={() => void accion(() => api.patch(`/admin/usuarios/${u.id_usuario}`, { estado: u.estado === 'activo' ? 'inactivo' : 'activo' }), u.estado === 'activo' ? 'Usuario desactivado.' : 'Usuario reactivado.')}>
                        {u.estado === 'activo' ? 'Desactivar' : 'Reactivar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {vista === 'reportes' && (
        reportes.error ? <Alerta>{reportes.error}</Alerta> : !reportes.datos ? <Esqueletos n={2} /> : reportes.datos.reportes.length === 0 ? (
          <div className="card"><Vacio icono="escudo" titulo="Sin reportes"><p>Nadie ha reportado publicaciones.</p></Vacio></div>
        ) : (
          <div className="lista">
            {reportes.datos.reportes.map((x) => (
              <article key={x.id_reporte} className="card col s" aria-label={`Reporte sobre ${x.garaje}`}>
                <div className="fila entre" style={{ alignItems: 'flex-start' }}>
                  <div className="col s" style={{ minWidth: 0 }}>
                    <h3><Link to={`/garaje/${x.id_garaje}`}>{x.garaje}</Link></h3>
                    <span className="muted pequeno">{MOTIVO[x.motivo]} · por {x.reportante} · {fechaHora(x.fecha)}</span>
                  </div>
                  <Estado valor={x.estado} />
                </div>
                {x.detalle && <p>“{x.detalle}”</p>}
                {x.estado === 'abierto' && x.abiertos_del_garaje > 1 && (
                  <Alerta tipo="aviso">Esta publicación tiene {x.abiertos_del_garaje} reportes abiertos.</Alerta>
                )}
                {x.estado === 'abierto' && (
                  <div className="acciones">
                    <button className="btn secundario s" onClick={() => void accion(() => api.patch(`/admin/reportes/${x.id_reporte}`, {}), 'Reporte resuelto.')}>
                      Resolver sin sanción
                    </button>
                    {x.garaje_estado !== 'suspendido' && (
                      <button className="btn peligro s" onClick={() => void accion(() => api.patch(`/admin/reportes/${x.id_reporte}`, { suspender_garaje: true }), 'Garaje suspendido y reportes cerrados.')}>
                        Suspender el garaje
                      </button>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        )
      )}

      {vista === 'garajes' && (
        <div className="card scroll-x">
          <table className="tabla">
            <thead><tr><th>Garaje</th><th>Propietario</th><th>Tarifa</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {garajes.datos?.garajes.map((g) => (
                <tr key={g.id_garaje}>
                  <td><b>{g.nombre}</b><br /><span className="muted pequeno">{g.barrio}</span></td>
                  <td>{g.propietario}<br /><span className="muted pequeno">{g.correo_propietario}</span></td>
                  <td>{dinero(g.tarifa_hora)}</td>
                  <td><Estado valor={g.estado} /></td>
                  <td>
                    <button className="btn s secundario" onClick={() => void accion(() => api.patch(`/admin/garajes/${g.id_garaje}`, { estado: g.estado === 'suspendido' ? 'activo' : 'suspendido' }), g.estado === 'suspendido' ? 'Garaje reactivado.' : 'Garaje suspendido.')}>
                      {g.estado === 'suspendido' ? 'Reactivar' : 'Suspender'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
