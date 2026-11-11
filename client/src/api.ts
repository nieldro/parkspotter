const CLAVE_TOKEN = 'parkspotter.token';

export class ApiError extends Error {
  constructor(
    public status: number,
    mensaje: string,
    /** Campos extra de la respuesta de error (p. ej. { codigo: 'correo_sin_verificar', correo }). */
    public datos: Record<string, unknown> | null = null,
  ) {
    super(mensaje);
  }
}

export const obtenerToken = () => localStorage.getItem(CLAVE_TOKEN);
export const guardarToken = (t: string) => localStorage.setItem(CLAVE_TOKEN, t);
export const borrarToken = () => localStorage.removeItem(CLAVE_TOKEN);

// Avisa a la app que la sesión ya no sirve (token vencido, cuenta desactivada).
export const EVENTO_SESION_CADUCADA = 'parkspotter:sesion-caducada';

async function pedir<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
  const token = obtenerToken();
  let respuesta: Response;
  try {
    respuesta = await fetch(`/api${ruta}`, {
      method: metodo,
      headers: {
        ...(cuerpo !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    throw new ApiError(0, 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.');
  }
  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    if (respuesta.status === 401 && token) window.dispatchEvent(new Event(EVENTO_SESION_CADUCADA));
    // Una respuesta sin JSON es de un intermediario (túnel o proxy caído, 502/503/504/530), no de la app.
    const sinServicio = datos === null && (respuesta.status >= 502 || respuesta.status === 0);
    throw new ApiError(
      respuesta.status,
      datos?.error ?? (sinServicio ? 'El servicio no está disponible en este momento. Inténtalo de nuevo en unos minutos.' : 'Ocurrió un error inesperado.'),
      datos,
    );
  }
  return (datos ?? {}) as T;
}

export const api = {
  get: <T,>(ruta: string) => pedir<T>('GET', ruta),
  post: <T,>(ruta: string, cuerpo?: unknown) => pedir<T>('POST', ruta, cuerpo ?? {}),
  put: <T,>(ruta: string, cuerpo: unknown) => pedir<T>('PUT', ruta, cuerpo),
  patch: <T,>(ruta: string, cuerpo: unknown) => pedir<T>('PATCH', ruta, cuerpo),
  delete: <T,>(ruta: string) => pedir<T>('DELETE', ruta),
};

export function mensajeDeError(e: unknown): string {
  return e instanceof Error ? e.message : 'Ocurrió un error inesperado.';
}
