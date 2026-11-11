// Cliente mínimo de Supabase Auth (GoTrue) con fetch: sin dependencias.
// Supabase guarda y verifica las credenciales; la app sigue emitiendo su propia sesión (lib/auth.js).
//
//  · verificar    → POST /auth/v1/token?grant_type=password   (clave pública anon)
//  · crear        → POST /auth/v1/admin/users                 (clave de servicio: correo ya confirmado)
//  · actualizar   → PUT  /auth/v1/admin/users/:id             (cambiar correo o contraseña)
//  · borrar       → DELETE /auth/v1/admin/users/:id           (deshacer un registro que falló a medias)
import { config } from '../config.js';
import { HttpError } from './http.js';

export const supabaseActivo = () => Boolean(config.supabase.url && config.supabase.serviceKey && config.supabase.anonKey);

async function pedir(ruta, { metodo = 'POST', clave, cuerpo } = {}) {
  let r;
  try {
    r = await fetch(`${config.supabase.url}/auth/v1${ruta}`, {
      method: metodo,
      headers: {
        apikey: clave,
        authorization: `Bearer ${clave}`,
        ...(cuerpo ? { 'content-type': 'application/json' } : {}),
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(12_000),
    });
  } catch (e) {
    console.error('Supabase Auth no respondió:', e.cause?.code ?? e.message);
    throw new HttpError(503, 'No pudimos verificar tu cuenta en este momento. Inténtalo de nuevo en un momento.');
  }
  const datos = await r.json().catch(() => ({}));
  return { estado: r.status, datos };
}

const codigoDe = (d) => d?.error_code || d?.code || d?.error || '';

function falloInesperado(estado, datos) {
  console.error('Supabase Auth respondió', estado, codigoDe(datos), datos?.msg || datos?.message || '');
  if (codigoDe(datos) === 'weak_password') return new HttpError(400, 'Esa contraseña es demasiado fácil de adivinar. Elige otra.');
  if (estado === 429) return new HttpError(429, 'Demasiados intentos. Espera un momento e inténtalo de nuevo.');
  return new HttpError(503, 'No pudimos verificar tu cuenta en este momento. Inténtalo de nuevo en un momento.');
}

/** Comprueba correo + contraseña. Devuelve el id de Supabase si son correctos y null si no lo son. */
export async function verificarCredenciales(correo, contrasena) {
  const { estado, datos } = await pedir('/token?grant_type=password', {
    clave: config.supabase.anonKey,
    cuerpo: { email: correo, password: contrasena },
  });
  if (estado === 200 && datos.user?.id) return datos.user.id;
  if (estado === 400 || estado === 401 || estado === 422) return null; // invalid_credentials, email_not_confirmed…
  throw falloInesperado(estado, datos);
}

/** Crea la cuenta (correo ya confirmado: no depende del envío de correos del plan gratis). Devuelve su id, o null si el correo ya existía. */
export async function crearCuenta({ correo, contrasena, nombre }) {
  const { estado, datos } = await pedir('/admin/users', {
    clave: config.supabase.serviceKey,
    cuerpo: { email: correo, password: contrasena, email_confirm: true, user_metadata: { nombre, app: 'parkspotter' } },
  });
  if ((estado === 200 || estado === 201) && datos.id) return datos.id;
  if (codigoDe(datos) === 'email_exists' || codigoDe(datos) === 'user_already_exists') return null;
  throw falloInesperado(estado, datos);
}

async function actualizar(authId, cambios) {
  const { estado, datos } = await pedir(`/admin/users/${encodeURIComponent(authId)}`, {
    metodo: 'PUT',
    clave: config.supabase.serviceKey,
    cuerpo: cambios,
  });
  if (estado === 200) return true;
  if (codigoDe(datos) === 'email_exists') return false;
  throw falloInesperado(estado, datos);
}

export const cambiarContrasenaCuenta = (authId, nueva) => actualizar(authId, { password: nueva });
/** false si ese correo ya lo usa otra cuenta. */
export const cambiarCorreoCuenta = (authId, correo) => actualizar(authId, { email: correo, email_confirm: true });

export async function borrarCuenta(authId) {
  await pedir(`/admin/users/${encodeURIComponent(authId)}`, { metodo: 'DELETE', clave: config.supabase.serviceKey }).catch(() => {});
}
