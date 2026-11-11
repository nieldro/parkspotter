import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, mensajeDeError } from '../api';
import { useSesion } from '../auth';
import { useAvisos } from '../avisos';
import { useTitulo } from '../hooks';
import { Alerta } from '../ui';
import { CampoClave, Marca, destinoSeguro, enfocarSolo } from './Auth';

const ESPERA_REENVIO = 60;

/** Cuenta regresiva para poder pedir otro código (el servidor también limita: uno por minuto). */
function useEspera(inicial = ESPERA_REENVIO) {
  const [segundos, setSegundos] = useState(inicial);
  useEffect(() => {
    if (segundos <= 0) return;
    const t = setTimeout(() => setSegundos((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [segundos]);
  return [segundos, () => setSegundos(ESPERA_REENVIO)] as const;
}

const soloDigitos = (v: string) => v.replace(/\D/g, '').slice(0, 6);

function CampoCodigo({ valor, onChange, autoFocus }: { valor: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <div className="campo">
      <label htmlFor="codigo">Código de 6 dígitos</label>
      <input
        id="codigo"
        className="entrada entrada-codigo"
        value={valor}
        onChange={(e) => onChange(soloDigitos(e.target.value))}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        placeholder="······"
        autoFocus={autoFocus}
        required
      />
    </div>
  );
}

function BotonReenviar({ espera, ocupado, onClick }: { espera: number; ocupado: boolean; onClick: () => void }) {
  return (
    <button type="button" className="btn secundario bloque" disabled={espera > 0 || ocupado} onClick={onClick}>
      {espera > 0 ? `Reenviar código en ${espera} s` : 'Reenviar código'}
    </button>
  );
}

/** Pantalla que aparece al crear la cuenta (o al ingresar sin haber confirmado): escribe el código que llegó al correo. */
export function Verificar() {
  useTitulo('Confirma tu correo');
  const { verificar } = useSesion();
  const avisos = useAvisos();
  const navegar = useNavigate();
  const [params] = useSearchParams();
  const correo = params.get('correo') ?? '';
  const volver = params.get('volver');
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  const [espera, reiniciarEspera] = useEspera();

  useEffect(() => {
    if (!correo) navegar('/registro', { replace: true });
  }, [correo, navegar]);

  async function confirmar(valor: string) {
    if (enviando || valor.length !== 6) return;
    setEnviando(true);
    setError(null);
    try {
      const u = await verificar(correo, valor);
      avisos.ok(`¡Correo confirmado! Bienvenido, ${u.nombre}.`);
      navegar(destinoSeguro(volver, u.tipo_usuario === 'propietario' ? '/propietario' : '/'), { replace: true });
    } catch (err) {
      setError(mensajeDeError(err));
      setCodigo('');
    } finally {
      setEnviando(false);
    }
  }

  async function reenviar() {
    setReenviando(true);
    setError(null);
    try {
      await api.post('/auth/reenviar', { correo });
      avisos.ok('Te enviamos un código nuevo.');
      reiniciarEspera();
      setCodigo('');
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setReenviando(false);
    }
  }

  return (
    <div className="auth">
      <Marca lema="Un último paso para entrar." />
      <form className="card col auth-tarjeta" onSubmit={(e: FormEvent) => { e.preventDefault(); void confirmar(codigo); }}>
        <h1>Revisa tu correo</h1>
        <p>
          Enviamos un código de 6 dígitos a <b style={{ overflowWrap: 'anywhere' }}>{correo}</b>. Escríbelo aquí para confirmar que el correo es tuyo.
        </p>
        <p className="muted pequeno">¿No lo ves? Mira en «Spam» o «Promociones»: puede tardar un par de minutos. El código vence a los 15 minutos.</p>
        {error && <Alerta>{error}</Alerta>}
        <CampoCodigo
          valor={codigo}
          onChange={(v) => {
            setCodigo(v);
            if (v.length === 6) void confirmar(v); // al completar los 6 dígitos se confirma solo
          }}
          autoFocus={enfocarSolo()}
        />
        <button className="btn bloque" disabled={enviando || codigo.length !== 6}>
          {enviando ? <span className="spinner" /> : 'Confirmar'}
        </button>
        <BotonReenviar espera={espera} ocupado={reenviando} onClick={() => void reenviar()} />
        <p className="centrado muted">
          ¿Te equivocaste de correo? <Link to="/registro">Crea la cuenta de nuevo</Link>
        </p>
      </form>
    </div>
  );
}

/** «Olvidé mi contraseña»: 1) el correo, 2) el código que llega + la contraseña nueva. */
export function Recuperar() {
  useTitulo('Recuperar contraseña');
  const { restablecer } = useSesion();
  const avisos = useAvisos();
  const navegar = useNavigate();
  const [params] = useSearchParams();
  const [paso, setPaso] = useState<1 | 2>(1);
  const [correo, setCorreo] = useState(params.get('correo') ?? '');
  const [codigo, setCodigo] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [espera, reiniciarEspera] = useEspera();

  async function pedirCodigo(e?: FormEvent) {
    e?.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      await api.post('/auth/olvide', { correo: correo.trim() });
      if (paso === 1) setPaso(2);
      else avisos.ok('Si el correo está registrado, te enviamos un código nuevo.');
      reiniciarEspera();
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setEnviando(false);
    }
  }

  async function cambiar(e: FormEvent) {
    e.preventDefault();
    if (clave.length < 8 || !/[A-Za-z]/.test(clave) || !/\d/.test(clave)) {
      return setError('La contraseña debe tener mínimo 8 caracteres, con letras y al menos un número.');
    }
    setEnviando(true);
    setError(null);
    try {
      const u = await restablecer(correo.trim(), codigo, clave);
      avisos.ok(`Contraseña cambiada. ¡Hola de nuevo, ${u.nombre}!`);
      navegar(u.tipo_usuario === 'admin' ? '/admin' : '/', { replace: true });
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="auth">
      <Marca lema="Recupera el acceso a tu cuenta." />
      {paso === 1 ? (
        <form className="card col auth-tarjeta" onSubmit={pedirCodigo} noValidate>
          <h1>¿Olvidaste tu contraseña?</h1>
          <p className="muted">Escribe el correo de tu cuenta y te enviamos un código para crear una contraseña nueva.</p>
          {error && <Alerta>{error}</Alerta>}
          <div className="campo">
            <label htmlFor="correo">Correo</label>
            <input id="correo" className="entrada" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" autoFocus={enfocarSolo()} value={correo} onChange={(e) => setCorreo(e.target.value)} required />
          </div>
          <button className="btn bloque" disabled={enviando || !correo.trim()}>
            {enviando ? <span className="spinner" /> : 'Enviar código'}
          </button>
          <p className="centrado muted"><Link to="/login">Volver a ingresar</Link></p>
        </form>
      ) : (
        <form className="card col auth-tarjeta" onSubmit={cambiar}>
          <h1>Crea tu contraseña nueva</h1>
          <p>
            Si <b style={{ overflowWrap: 'anywhere' }}>{correo.trim()}</b> tiene cuenta, ya te enviamos un código de 6 dígitos. Revisa también «Spam».
          </p>
          {error && <Alerta>{error}</Alerta>}
          <CampoCodigo valor={codigo} onChange={setCodigo} autoFocus={enfocarSolo()} />
          <CampoClave id="clave" etiqueta="Contraseña nueva" valor={clave} onChange={setClave} nueva />
          <button className="btn bloque" disabled={enviando || codigo.length !== 6 || !clave}>
            {enviando ? <span className="spinner" /> : 'Cambiar contraseña'}
          </button>
          <BotonReenviar espera={espera} ocupado={enviando} onClick={() => void pedirCodigo()} />
          <p className="centrado muted"><Link to="/login">Volver a ingresar</Link></p>
        </form>
      )}
    </div>
  );
}
