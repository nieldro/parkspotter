import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, mensajeDeError } from '../api';
import { useSesion } from '../auth';
import { useAvisos } from '../avisos';
import { Avatar, BotonFoto } from '../fotos';
import { fechaHora, hoyBogota } from '../format';
import { useCarga, useTitulo } from '../hooks';
import { useInstalacion } from '../instalar';
import { aplicarTema, temaGuardado, type Tema } from '../tema';
import type { Notificacion, TipoVehiculo, Usuario } from '../types';
import { Alerta, Dialogo, Esqueletos, Icono, Logo, Vacio } from '../ui';

export function Notificaciones() {
  useTitulo('Notificaciones');
  const navegar = useNavigate();
  const { datos, error, cargando, recargar } = useCarga(() => api.get<{ notificaciones: Notificacion[]; no_leidas: number }>('/notificaciones'), []);

  async function abrir(n: Notificacion) {
    if (!n.leida) {
      await api.post('/notificaciones/leer', { ids: [n.id_notificacion] }).catch(() => {});
      window.dispatchEvent(new Event('parkspotter:avisos'));
    }
    if (n.id_reserva) navegar(`/reservas/${n.id_reserva}`);
    else void recargar(true);
  }

  async function marcarTodas() {
    await api.post('/notificaciones/leer', {});
    window.dispatchEvent(new Event('parkspotter:avisos'));
    void recargar(true);
  }

  return (
    <div className="col" style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="cabecera-pagina">
        <h1>Notificaciones</h1>
        {(datos?.no_leidas ?? 0) > 0 && <button className="btn suave s" onClick={() => void marcarTodas()}>Marcar como leídas</button>}
      </div>
      {error && <Alerta>{error}</Alerta>}
      {cargando && !datos ? (
        <Esqueletos n={3} />
      ) : (datos?.notificaciones.length ?? 0) === 0 ? (
        <div className="card"><Vacio icono="campana" titulo="Sin notificaciones"><p>Aquí verás solicitudes, confirmaciones, cancelaciones y mensajes.</p></Vacio></div>
      ) : (
        <div className="lista">
          {datos?.notificaciones.map((n) => (
            <button key={n.id_notificacion} className={`item-notif ${n.leida ? '' : 'nueva'}`} onClick={() => void abrir(n)}>
              <Icono n={n.tipo === 'mensaje' ? 'chat' : 'campana'} />
              <span className="col s">
                <span className={n.leida ? '' : 'fuerte'}>{n.mensaje}</span>
                <span className="muted pequeno">{fechaHora(n.fecha)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const anios = (n: number) => {
  const h = hoyBogota();
  return `${Number(h.slice(0, 4)) - n}${h.slice(4)}`;
};

export function Perfil() {
  useTitulo('Mi perfil');
  const { usuario, actualizar, salir } = useSesion();
  const avisos = useAvisos();
  const navegar = useNavigate();
  const { instalada, puedeInstalar, esIOS, integrado, instalar } = useInstalacion();
  const [f, setF] = useState({
    nombre: usuario?.nombre ?? '',
    apellido: usuario?.apellido ?? '',
    telefono: usuario?.telefono ?? '',
    fecha_nacimiento: usuario?.fecha_nacimiento ?? '',
  });
  const [veh, setVeh] = useState<{ tipo: TipoVehiculo; placa: string; detalle: string }>(usuario?.vehiculo ?? { tipo: 'carro', placa: '', detalle: '' });
  const [tema, setTema] = useState<Tema>(temaGuardado());
  const [guardando, setGuardando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [errorPerfil, setErrorPerfil] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<'clave' | 'correo' | null>(null);
  const [claves, setClaves] = useState({ actual: '', nueva: '' });
  const [correo, setCorreo] = useState({ correo: '', contrasena: '' });
  const [errorDialogo, setErrorDialogo] = useState<string | null>(null);

  if (!usuario) return null;

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setErrorPerfil(null);
    try {
      const placa = veh.placa.replace(/[\s-]/g, '').toUpperCase();
      const r = await api.patch<{ usuario: Usuario }>('/auth/yo', {
        nombre: f.nombre,
        apellido: f.apellido,
        telefono: f.telefono,
        ...(f.fecha_nacimiento && { fecha_nacimiento: f.fecha_nacimiento }),
        vehiculo: placa ? { tipo: veh.tipo, placa, detalle: veh.detalle } : null,
      });
      actualizar(r.usuario);
      avisos.ok('Perfil actualizado.');
    } catch (err) {
      setErrorPerfil(mensajeDeError(err));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setGuardando(false);
    }
  }

  async function subirFoto(fotos: string[]) {
    setSubiendo(true);
    try {
      const r = await api.post<{ usuario: Usuario }>('/auth/yo/foto', { imagen: fotos[0] });
      actualizar(r.usuario);
      avisos.ok('Foto de perfil actualizada.');
    } catch (err) {
      avisos.error(mensajeDeError(err));
    } finally {
      setSubiendo(false);
    }
  }

  async function quitarFoto() {
    setSubiendo(true);
    try {
      const r = await api.delete<{ usuario: Usuario }>('/auth/yo/foto');
      actualizar(r.usuario);
      avisos.ok('Foto eliminada.');
    } catch (err) {
      avisos.error(mensajeDeError(err));
    } finally {
      setSubiendo(false);
    }
  }

  async function cambiarClave(e: FormEvent) {
    e.preventDefault();
    setErrorDialogo(null);
    try {
      await api.post('/auth/yo/contrasena', claves);
      avisos.ok('Contraseña actualizada.');
      setDialogo(null);
      setClaves({ actual: '', nueva: '' });
    } catch (err) {
      setErrorDialogo(mensajeDeError(err));
    }
  }

  async function cambiarCorreo(e: FormEvent) {
    e.preventDefault();
    setErrorDialogo(null);
    try {
      const r = await api.post<{ usuario: Usuario }>('/auth/yo/correo', correo);
      actualizar(r.usuario);
      avisos.ok('Correo actualizado.');
      setDialogo(null);
      setCorreo({ correo: '', contrasena: '' });
    } catch (err) {
      setErrorDialogo(mensajeDeError(err));
    }
  }

  const abrirDialogo = (d: 'clave' | 'correo') => {
    setErrorDialogo(null);
    setDialogo(d);
  };

  return (
    <div className="col l" style={{ maxWidth: 560, margin: '0 auto' }}>
      <section className="card perfil-cabecera">
        <Avatar foto={usuario.foto} nombre={usuario.nombre} apellido={usuario.apellido} tam={88} />
        <div className="col s grow" style={{ minWidth: 0 }}>
          <b style={{ fontSize: '1.2rem' }}>{usuario.nombre} {usuario.apellido}</b>
          <span className="muted pequeno" style={{ overflowWrap: 'anywhere' }}>{usuario.correo}</span>
          <div className="fila envolver">
            <span className="chip primario">{usuario.tipo_usuario === 'admin' ? 'Administrador' : usuario.es_propietario ? 'Propietario' : 'Conductor'}</span>
          </div>
          <div className="fila envolver" style={{ marginTop: 4 }}>
            <BotonFoto onFotos={subirFoto} onError={avisos.error} disabled={subiendo} lado={800}>
              {subiendo ? <span className="spinner" /> : <><Icono n="camara" /> {usuario.foto ? 'Cambiar foto' : 'Subir foto'}</>}
            </BotonFoto>
            {usuario.foto && (
              <button type="button" className="btn fantasma s" disabled={subiendo} onClick={() => void quitarFoto()}>
                <Icono n="basura" /> Quitar
              </button>
            )}
          </div>
        </div>
      </section>

      {!instalada && (
        <section className="card col">
          <div className="fila"><div style={{ width: 40 }}><Logo /></div><h2>Instala la app en tu celular</h2></div>
          {puedeInstalar ? (
            <>
              <p className="muted">Se abre como cualquier app, a pantalla completa y sin barra del navegador.</p>
              <button className="btn" onClick={() => void instalar()}><Icono n="descargar" /> Instalar ParkSpotter</button>
            </>
          ) : esIOS ? (
            <ol className="muted" style={{ margin: 0, paddingLeft: 20 }}>
              <li>Abre esta página en <b>Safari</b>.</li>
              <li>Toca el botón <b>Compartir</b> (cuadro con flecha hacia arriba).</li>
              <li>Elige <b>Agregar a la pantalla de inicio</b>.</li>
            </ol>
          ) : integrado ? (
            <p className="muted">Estás en el navegador de otra app (WhatsApp, Instagram…). Abre el menú (⋮) y elige <b>Abrir en el navegador</b> o <b>Abrir en Chrome</b>; ahí podrás instalarla.</p>
          ) : (
            <p className="muted">En Chrome abre el menú (⋮) y elige <b>Instalar app</b> o <b>Agregar a la pantalla de inicio</b>.</p>
          )}
        </section>
      )}

      <form className="col l" onSubmit={guardar}>
        {errorPerfil && <Alerta>{errorPerfil}</Alerta>}
        <section className="card col">
          <h2>Datos personales</h2>
          <div className="grid2">
            <div className="campo"><label htmlFor="p-nombre">Nombre</label><input id="p-nombre" className="entrada" autoComplete="given-name" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} required minLength={2} /></div>
            <div className="campo"><label htmlFor="p-ape">Apellido</label><input id="p-ape" className="entrada" autoComplete="family-name" value={f.apellido} onChange={(e) => setF({ ...f, apellido: e.target.value })} required minLength={2} /></div>
          </div>
          <div className="campo"><label htmlFor="p-tel">Celular</label><input id="p-tel" className="entrada" type="tel" inputMode="tel" autoComplete="tel" value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} /><span className="ayuda">Solo se comparte con la otra parte cuando una reserva queda confirmada.</span></div>
          <div className="campo">
            <label htmlFor="p-nac">Fecha de nacimiento</label>
            <input id="p-nac" className="entrada" type="date" min={anios(110)} max={anios(18)} autoComplete="bday" value={f.fecha_nacimiento} onChange={(e) => setF({ ...f, fecha_nacimiento: e.target.value })} />
          </div>
        </section>

        <section className="card col">
          <h2>Mi vehículo</h2>
          <p className="muted pequeno">Lo usamos para llenar tus reservas más rápido. Puedes cambiarlo en cada reserva.</p>
          <div className="segmentado" role="group" aria-label="Tipo de vehículo">
            <button type="button" className="segmento" aria-pressed={veh.tipo === 'carro'} onClick={() => setVeh({ ...veh, tipo: 'carro' })}><Icono n="carro" /> Carro</button>
            <button type="button" className="segmento" aria-pressed={veh.tipo === 'moto'} onClick={() => setVeh({ ...veh, tipo: 'moto' })}><Icono n="moto" /> Moto</button>
          </div>
          <div className="grid2">
            <div className="campo">
              <label htmlFor="v-placa">Placa</label>
              <input id="v-placa" className="entrada" value={veh.placa} onChange={(e) => setVeh({ ...veh, placa: e.target.value.toUpperCase() })} placeholder={veh.tipo === 'carro' ? 'ABC123' : 'ABC12D'} maxLength={7} autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false} />
            </div>
            <div className="campo">
              <label htmlFor="v-det">Marca y color</label>
              <input id="v-det" className="entrada" value={veh.detalle} onChange={(e) => setVeh({ ...veh, detalle: e.target.value })} maxLength={60} placeholder="Mazda 2 rojo" />
            </div>
          </div>
          {veh.placa && <button type="button" className="btn fantasma s" style={{ alignSelf: 'flex-start' }} onClick={() => setVeh({ tipo: 'carro', placa: '', detalle: '' })}><Icono n="basura" /> Quitar vehículo</button>}
        </section>

        <button className="btn bloque" disabled={guardando}>{guardando ? <span className="spinner" /> : 'Guardar cambios'}</button>
      </form>

      <section className="card col">
        <h2>Apariencia</h2>
        <div className="segmentado" role="group" aria-label="Tema de la app">
          {([['auto', 'Automático'], ['claro', 'Claro'], ['oscuro', 'Oscuro']] as const).map(([t, texto]) => (
            <button key={t} type="button" className="segmento" aria-pressed={tema === t} onClick={() => { setTema(t); aplicarTema(t); }}>
              {texto}
            </button>
          ))}
        </div>
        <span className="ayuda">Automático sigue la configuración de tu teléfono.</span>
      </section>

      <section className="card col">
        <h2>Cuenta</h2>
        <Link to="/favoritos" className="btn secundario"><Icono n="corazon" /> Mis favoritos</Link>
        {usuario.tipo_usuario !== 'admin' && (
          <Link to="/propietario" className="btn secundario">{usuario.es_propietario ? 'Administrar mis garajes' : 'Quiero publicar un garaje'}</Link>
        )}
        <button className="btn secundario" onClick={() => abrirDialogo('correo')}>Cambiar correo</button>
        <button className="btn secundario" onClick={() => abrirDialogo('clave')}>Cambiar contraseña</button>
        <button className="btn peligro" onClick={() => { salir(); navegar('/'); }}><Icono n="salir" /> Cerrar sesión</button>
      </section>

      <p className="ayuda centrado">
        ParkSpotter es un proyecto académico (Práctica de Ingeniería III). Los pagos son simulados: no se cobra dinero real.
      </p>

      <Dialogo abierto={dialogo === 'clave'} onCerrar={() => setDialogo(null)} titulo="Cambiar contraseña">
        <form className="col" onSubmit={cambiarClave}>
          {errorDialogo && <Alerta>{errorDialogo}</Alerta>}
          <div className="campo"><label htmlFor="c-actual">Contraseña actual</label><input id="c-actual" className="entrada" type="password" autoComplete="current-password" value={claves.actual} onChange={(e) => setClaves({ ...claves, actual: e.target.value })} required /></div>
          <div className="campo"><label htmlFor="c-nueva">Nueva contraseña</label><input id="c-nueva" className="entrada" type="password" autoComplete="new-password" minLength={8} value={claves.nueva} onChange={(e) => setClaves({ ...claves, nueva: e.target.value })} required /><span className="ayuda">Mínimo 8 caracteres, con letras y al menos un número.</span></div>
          <button className="btn bloque">Actualizar contraseña</button>
        </form>
      </Dialogo>

      <Dialogo abierto={dialogo === 'correo'} onCerrar={() => setDialogo(null)} titulo="Cambiar correo">
        <form className="col" onSubmit={cambiarCorreo}>
          {errorDialogo && <Alerta>{errorDialogo}</Alerta>}
          <div className="campo"><label htmlFor="e-nuevo">Correo nuevo</label><input id="e-nuevo" className="entrada" type="email" inputMode="email" autoCapitalize="none" autoComplete="email" value={correo.correo} onChange={(e) => setCorreo({ ...correo, correo: e.target.value })} required /></div>
          <div className="campo"><label htmlFor="e-clave">Tu contraseña</label><input id="e-clave" className="entrada" type="password" autoComplete="current-password" value={correo.contrasena} onChange={(e) => setCorreo({ ...correo, contrasena: e.target.value })} required /><span className="ayuda">La pedimos para confirmar que eres tú.</span></div>
          <button className="btn bloque">Actualizar correo</button>
        </form>
      </Dialogo>
    </div>
  );
}
