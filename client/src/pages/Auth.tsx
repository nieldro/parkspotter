import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, api, mensajeDeError } from '../api';
import { guardarFotoPendiente, useSesion } from '../auth';
import { useAvisos } from '../avisos';
import { Avatar, BotonFoto } from '../fotos';
import { hoyBogota } from '../format';
import { useTitulo } from '../hooks';
import { Alerta, Icono, Logo } from '../ui';

export function destinoSeguro(volver: string | null, porDefecto = '/') {
  return volver && volver.startsWith('/') && !volver.startsWith('//') ? volver : porDefecto;
}

// En pantallas táctiles no se enfoca solo el primer campo: abriría el teclado antes de que la persona lea.
export const enfocarSolo = () => window.matchMedia('(pointer: fine)').matches;

function Requisitos({ clave }: { clave: string }) {
  const reglas = [
    { ok: clave.length >= 8, texto: 'Mínimo 8 caracteres' },
    { ok: /[A-Za-z]/.test(clave), texto: 'Una letra' },
    { ok: /\d/.test(clave), texto: 'Un número' },
  ];
  return (
    <ul className="requisitos" aria-label="Requisitos de la contraseña">
      {reglas.map((r) => (
        <li key={r.texto} className={r.ok ? 'cumple' : ''}>
          <Icono n={r.ok ? 'check' : 'mas'} />
          {r.texto}
          <span className="solo-lectores">{r.ok ? ' (cumplido)' : ' (pendiente)'}</span>
        </li>
      ))}
    </ul>
  );
}

export function Marca({ lema }: { lema: string }) {
  return (
    <div className="marca-grande">
      <Logo />
      <span>ParkSpotter</span>
      <p>{lema}</p>
    </div>
  );
}

export function CampoClave({ id, etiqueta, valor, onChange, nueva = false }: { id: string; etiqueta: string; valor: string; onChange: (v: string) => void; nueva?: boolean }) {
  const [ver, setVer] = useState(false);
  return (
    <div className="campo">
      <label htmlFor={id}>{etiqueta}</label>
      <div style={{ position: 'relative' }}>
        <input
          id={id}
          className="entrada"
          type={ver ? 'text' : 'password'}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={nueva ? 'new-password' : 'current-password'}
          required
          minLength={nueva ? 8 : undefined}
          style={{ paddingRight: 48 }}
        />
        <button
          type="button"
          className="btn icono fantasma"
          style={{ position: 'absolute', right: 2, top: 1 }}
          onClick={() => setVer(!ver)}
          aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        >
          <Icono n={ver ? 'ojoNo' : 'ojo'} />
        </button>
      </div>
      {nueva && <Requisitos clave={valor} />}
    </div>
  );
}

export function Login() {
  useTitulo('Ingresar');
  const { entrar, entrarDemo } = useSesion();
  const avisos = useAvisos();
  const navegar = useNavigate();
  const [params] = useSearchParams();
  const volver = params.get('volver');
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<'clave' | 'conductor' | 'propietario' | null>(null);
  const [demo, setDemo] = useState(false);
  const [recuperacion, setRecuperacion] = useState(false);

  useEffect(() => {
    api
      .get<{ demo: boolean; recuperacion?: boolean }>('/auth/config')
      .then((r) => {
        setDemo(r.demo);
        setRecuperacion(Boolean(r.recuperacion));
      })
      .catch(() => {});
  }, []);

  async function ingresar(accion: () => ReturnType<typeof entrar>, quien: NonNullable<typeof enviando>) {
    setError(null);
    setEnviando(quien);
    try {
      const u = await accion();
      avisos.ok(`¡Hola, ${u.nombre}!`);
      navegar(destinoSeguro(volver, u.tipo_usuario === 'admin' ? '/admin' : '/'), { replace: true });
    } catch (err) {
      // La clave era correcta pero falta confirmar el correo: se pasa a escribir el código que ya se envió.
      if (err instanceof ApiError && err.datos?.codigo === 'correo_sin_verificar') {
        navegar(`/verificar?correo=${encodeURIComponent(String(err.datos.correo ?? correo))}${volver ? `&volver=${encodeURIComponent(volver)}` : ''}`);
        return;
      }
      setError(mensajeDeError(err));
      setEnviando(null);
    }
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    void ingresar(() => entrar(correo.trim(), clave), 'clave');
  }

  return (
    <div className="auth">
      <Marca lema="Tu parqueadero en Bogotá, a un toque." />
      <form className="card col auth-tarjeta" onSubmit={enviar} noValidate>
        <h1>Ingresa a tu cuenta</h1>
        {volver && <p className="muted">Inicia sesión para continuar.</p>}
        {error && <Alerta>{error}</Alerta>}
        <div className="campo">
          <label htmlFor="correo">Correo</label>
          <input id="correo" className="entrada" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" autoFocus={enfocarSolo()} value={correo} onChange={(e) => setCorreo(e.target.value)} required />
        </div>
        <CampoClave id="clave" etiqueta="Contraseña" valor={clave} onChange={setClave} />
        {recuperacion && (
          <Link to={`/recuperar${correo.trim() ? `?correo=${encodeURIComponent(correo.trim())}` : ''}`} className="olvide">¿Olvidaste tu contraseña?</Link>
        )}
        <button className="btn bloque" disabled={enviando !== null || !correo || !clave}>
          {enviando === 'clave' ? <span className="spinner" /> : 'Ingresar'}
        </button>
        {demo && (
          <>
            <div className="separador"><span>o prueba la demostración</span></div>
            <div className="grid2">
              <button type="button" className="btn secundario" disabled={enviando !== null} onClick={() => void ingresar(() => entrarDemo('conductor'), 'conductor')}>
                {enviando === 'conductor' ? <span className="spinner" /> : <><Icono n="carro" /> Conductor</>}
              </button>
              <button type="button" className="btn secundario" disabled={enviando !== null} onClick={() => void ingresar(() => entrarDemo('propietario'), 'propietario')}>
                {enviando === 'propietario' ? <span className="spinner" /> : <><Icono n="casa" /> Propietario</>}
              </button>
            </div>
          </>
        )}
        <p className="centrado muted">
          ¿Primera vez? <Link to={`/registro${volver ? `?volver=${encodeURIComponent(volver)}` : ''}`}>Crea tu cuenta</Link>
        </p>
      </form>
    </div>
  );
}

const anios = (n: number) => {
  const h = hoyBogota();
  return `${Number(h.slice(0, 4)) - n}${h.slice(4)}`;
};
const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function Registro() {
  useTitulo('Crear cuenta');
  const { registrar } = useSesion();
  const avisos = useAvisos();
  const navegar = useNavigate();
  const [params] = useSearchParams();
  const volver = params.get('volver');
  const [paso, setPaso] = useState<1 | 2>(1);
  const [tipo, setTipo] = useState<'conductor' | 'propietario'>(params.get('rol') === 'propietario' ? 'propietario' : 'conductor');
  const [f, setF] = useState({ nombre: '', apellido: '', correo: '', telefono: '', contrasena: '', fecha_nacimiento: '', tipo_documento: 'CC', numero_documento: '' });
  const [veh, setVeh] = useState<{ tipo: 'carro' | 'moto'; placa: string; detalle: string }>({ tipo: 'carro', placa: '', detalle: '' });
  const [conVehiculo, setConVehiculo] = useState(false);
  const [terminos, setTerminos] = useState(false);
  const [foto, setFoto] = useState<string | null>(null); // opcional: se sube cuando ya hay sesión
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const cambiar = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  function continuar(e: FormEvent) {
    e.preventDefault();
    if (!CORREO_RE.test(f.correo.trim())) return setError('Escribe un correo válido.');
    if (f.contrasena.length < 8 || !/[A-Za-z]/.test(f.contrasena) || !/\d/.test(f.contrasena)) {
      return setError('La contraseña debe tener mínimo 8 caracteres, con letras y al menos un número.');
    }
    setError(null);
    setPaso(2);
    window.scrollTo({ top: 0 });
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!terminos) return setError('Debes aceptar los términos y el tratamiento de datos para continuar.');
    setEnviando(true);
    try {
      const placa = veh.placa.replace(/[\s-]/g, '').toUpperCase();
      guardarFotoPendiente(foto);
      const r = await registrar({
        nombre: f.nombre,
        apellido: f.apellido,
        correo: f.correo.trim(),
        telefono: f.telefono,
        contrasena: f.contrasena,
        fecha_nacimiento: f.fecha_nacimiento,
        acepto_terminos: true,
        tipo_usuario: tipo,
        ...(conVehiculo && placa && { vehiculo: { tipo: veh.tipo, placa, detalle: veh.detalle } }),
        ...(tipo === 'propietario' && { tipo_documento: f.tipo_documento, numero_documento: f.numero_documento }),
      });
      if ('requiere_verificacion' in r) {
        // Se envió un código al correo: sin él no hay sesión.
        avisos.ok('Te enviamos un código de 6 dígitos a tu correo.');
        navegar(`/verificar?correo=${encodeURIComponent(r.correo)}${volver ? `&volver=${encodeURIComponent(volver)}` : ''}`, { replace: true });
        return;
      }
      avisos.ok(`¡Bienvenido a ParkSpotter, ${f.nombre.trim()}!`);
      navegar(destinoSeguro(volver, tipo === 'propietario' ? '/propietario' : '/'), { replace: true });
    } catch (err) {
      guardarFotoPendiente(null);
      setError(mensajeDeError(err));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="auth">
      <Marca lema="Reserva o publica un garaje en minutos." />
      <div className="card col auth-tarjeta">
        <div className="pasos" aria-label={`Paso ${paso} de 2`}>
          <span className="barra"><span style={{ width: paso === 1 ? '50%' : '100%' }} /></span>
          <span className="muted pequeno">Paso {paso} de 2 · {paso === 1 ? 'Tu cuenta' : 'Tus datos'}</span>
        </div>
        {error && <Alerta>{error}</Alerta>}

        {paso === 1 ? (
          <form className="col" onSubmit={continuar} noValidate>
            <h1>Crea tu cuenta</h1>
            <div className="segmentado" role="group" aria-label="¿Qué quieres hacer?">
              <button type="button" className="segmento" aria-pressed={tipo === 'conductor'} onClick={() => setTipo('conductor')}>
                Quiero parquear
              </button>
              <button type="button" className="segmento" aria-pressed={tipo === 'propietario'} onClick={() => setTipo('propietario')}>
                Tengo un garaje
              </button>
            </div>
            <p className="muted pequeno">Con cualquier cuenta puedes reservar parqueaderos; si ofreces un garaje, también puedes publicarlo.</p>
            <div className="campo">
              <label htmlFor="correo">Correo</label>
              <input id="correo" className="entrada" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" autoFocus={enfocarSolo()} value={f.correo} onChange={(e) => cambiar('correo')(e.target.value)} required />
            </div>
            <CampoClave id="clave" etiqueta="Contraseña" valor={f.contrasena} onChange={cambiar('contrasena')} nueva />
            <button className="btn bloque">Continuar</button>
            <p className="centrado muted">
              ¿Ya tienes cuenta? <Link to={`/login${volver ? `?volver=${encodeURIComponent(volver)}` : ''}`}>Ingresa</Link>
            </p>
          </form>
        ) : (
          <form className="col" onSubmit={enviar}>
            <h1>Cuéntanos de ti</h1>
            <div className="grid2">
              <div className="campo">
                <label htmlFor="nombre">Nombre</label>
                <input id="nombre" className="entrada" autoComplete="given-name" autoFocus={enfocarSolo()} value={f.nombre} onChange={(e) => cambiar('nombre')(e.target.value)} required minLength={2} />
              </div>
              <div className="campo">
                <label htmlFor="apellido">Apellido</label>
                <input id="apellido" className="entrada" autoComplete="family-name" value={f.apellido} onChange={(e) => cambiar('apellido')(e.target.value)} required minLength={2} />
              </div>
            </div>
            <div className="fila foto-registro">
              <Avatar foto={foto} nombre={f.nombre || '?'} apellido={f.apellido} tam={64} />
              <div className="col s">
                <BotonFoto lado={800} onFotos={([primera]) => setFoto(primera ?? null)} onError={setError}>
                  <Icono n="camara" /> {foto ? 'Cambiar foto' : 'Agregar foto de perfil'}
                </BotonFoto>
                <span className="ayuda">Opcional. También puedes hacerlo después, desde tu perfil.</span>
              </div>
            </div>
            <div className="campo">
              <label htmlFor="nacimiento">Fecha de nacimiento</label>
              <input id="nacimiento" className="entrada" type="date" min={anios(110)} max={anios(18)} autoComplete="bday" value={f.fecha_nacimiento} onChange={(e) => cambiar('fecha_nacimiento')(e.target.value)} required />
              <span className="ayuda">Debes ser mayor de 18 años.</span>
            </div>
            <div className="campo">
              <label htmlFor="telefono">Celular (opcional)</label>
              <input id="telefono" className="entrada" type="tel" inputMode="tel" autoComplete="tel" value={f.telefono} onChange={(e) => cambiar('telefono')(e.target.value)} />
              <span className="ayuda">Solo se comparte con la otra parte cuando una reserva queda confirmada.</span>
            </div>
            {tipo === 'propietario' && (
              <div className="grid2">
                <div className="campo">
                  <label htmlFor="tdoc">Documento</label>
                  <select id="tdoc" className="entrada" value={f.tipo_documento} onChange={(e) => cambiar('tipo_documento')(e.target.value)}>
                    <option value="CC">Cédula (CC)</option>
                    <option value="CE">Cédula de extranjería</option>
                    <option value="NIT">NIT</option>
                    <option value="PASAPORTE">Pasaporte</option>
                  </select>
                </div>
                <div className="campo">
                  <label htmlFor="ndoc">Número</label>
                  <input id="ndoc" className="entrada" inputMode="text" autoComplete="off" value={f.numero_documento} onChange={(e) => cambiar('numero_documento')(e.target.value)} required />
                </div>
              </div>
            )}

            <label className="casilla">
              <input type="checkbox" checked={conVehiculo} onChange={(e) => setConVehiculo(e.target.checked)} />
              <span>Quiero guardar mi vehículo para reservar más rápido <span className="muted">(opcional)</span></span>
            </label>
            {conVehiculo && (
              <div className="col suave-caja">
                <div className="segmentado" role="group" aria-label="Tipo de vehículo">
                  <button type="button" className="segmento" aria-pressed={veh.tipo === 'carro'} onClick={() => setVeh({ ...veh, tipo: 'carro' })}><Icono n="carro" /> Carro</button>
                  <button type="button" className="segmento" aria-pressed={veh.tipo === 'moto'} onClick={() => setVeh({ ...veh, tipo: 'moto' })}><Icono n="moto" /> Moto</button>
                </div>
                <div className="grid2">
                  <div className="campo">
                    <label htmlFor="rv-placa">Placa</label>
                    <input id="rv-placa" className="entrada" value={veh.placa} onChange={(e) => setVeh({ ...veh, placa: e.target.value.toUpperCase() })} placeholder={veh.tipo === 'carro' ? 'ABC123' : 'ABC12D'} maxLength={7} autoCapitalize="characters" autoCorrect="off" autoComplete="off" spellCheck={false} />
                  </div>
                  <div className="campo">
                    <label htmlFor="rv-det">Marca y color</label>
                    <input id="rv-det" className="entrada" value={veh.detalle} onChange={(e) => setVeh({ ...veh, detalle: e.target.value })} maxLength={60} placeholder="Mazda 2 rojo" />
                  </div>
                </div>
              </div>
            )}

            <label className="casilla">
              <input type="checkbox" checked={terminos} onChange={(e) => setTerminos(e.target.checked)} required />
              <span>Acepto los términos de uso y el tratamiento de mis datos personales, conforme a la Ley 1581 de 2012 (habeas data).</span>
            </label>

            <div className="grid2">
              <button type="button" className="btn secundario" onClick={() => { setError(null); setPaso(1); }}>Atrás</button>
              <button className="btn" disabled={enviando}>{enviando ? <span className="spinner" /> : 'Crear cuenta'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}